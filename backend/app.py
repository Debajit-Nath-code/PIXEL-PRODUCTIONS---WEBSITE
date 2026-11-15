"""
Pixel Productions Contact Form Backend API

Production-ready Flask application providing:
- POST /api/contact: Validated, rate-limited, honeypot-protected contact endpoint
- GET /api/health: Service health-check endpoint for Render monitoring
- Email delivery via the official Resend Python SDK
"""

from __future__ import annotations

import html
import logging
import math
import os
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Any

import resend
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix

# Load environment variables from .env in local development (no-op in Render if unset)
load_dotenv()

# Configure structured application logging
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pixel_productions.contact_api")

# ---------------------------------------------------------------------------
# Constants & Validation Rules
# ---------------------------------------------------------------------------

ALLOWED_PROJECT_TYPES = (
    "YouTube Video Editing",
    "Short-form Video Editing",
    "Reels / Instagram Content",
    "Motion Graphics",
    "Other",
)

ALLOWED_BUDGET_RANGES = (
    "Under ₹15,000",
    "₹15,000 – ₹35,000",
    "₹35,000 – ₹75,000",
    "₹75,000 – ₹1,50,000",
    "₹1,50,000+",
)

MAX_NAME_LENGTH = 100
MIN_NAME_LENGTH = 2
MAX_EMAIL_LENGTH = 254
MIN_MESSAGE_LENGTH = 10
MAX_MESSAGE_LENGTH = 5000
MAX_REQUEST_BYTES = 16 * 1024  # 16 KB payload limit to prevent abuse

# Strict email format regex (rejects spaces, newlines, missing TLD, etc.)
EMAIL_REGEX = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$"
)

# Control character stripper (keeps \n and \t only when explicitly allowed)
CONTROL_CHARS_ALL_RE = re.compile(r"[\x00-\x1f\x7f]")
CONTROL_CHARS_TEXT_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

EMAIL_SUBJECT = "New Project Enquiry – Pixel Productions"
IST_OFFSET = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------------------
# Rate Limiter (Thread-Safe Sliding Window)
# ---------------------------------------------------------------------------


class SlidingWindowRateLimiter:
    """In-memory per-IP sliding-window rate limiter suitable for single-instance WSGI."""

    def __init__(self, max_requests: int = 5, window_seconds: int = 900) -> None:
        self.max_requests = max(1, max_requests)
        self.window_seconds = max(1, window_seconds)
        self._requests: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def is_allowed(self, key: str, now: float | None = None) -> tuple[bool, int]:
        """
        Check whether a request from `key` is permitted.
        Returns (allowed: bool, retry_after_seconds: int).
        """
        current_time = time.monotonic() if now is None else now
        cutoff = current_time - self.window_seconds

        with self._lock:
            timestamps = self._requests.get(key)
            if timestamps is None:
                timestamps = deque()
                self._requests[key] = timestamps

            # Evict expired timestamps outside the active window
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()

            if len(timestamps) >= self.max_requests:
                oldest = timestamps[0]
                retry_after = max(1, math.ceil(self.window_seconds - (current_time - oldest)))
                return False, retry_after

            timestamps.append(current_time)

            # Opportunistic cleanup of stale IP buckets if map grows large
            if len(self._requests) > 5000:
                stale_keys = [
                    k for k, dq in self._requests.items() if not dq or dq[-1] <= cutoff
                ]
                for stale_key in stale_keys:
                    del self._requests[stale_key]

            return True, 0

    def reset(self) -> None:
        """Clear all tracked rate-limit buckets (useful in automated tests)."""
        with self._lock:
            self._requests.clear()


# ---------------------------------------------------------------------------
# Input Sanitization & Validation
# ---------------------------------------------------------------------------


def sanitize_single_line(value: str) -> str:
    """Strip whitespace and remove all ASCII control characters."""
    cleaned = CONTROL_CHARS_ALL_RE.sub("", value)
    return " ".join(cleaned.strip().split())


def sanitize_multiline(value: str) -> str:
    """Normalize line endings, strip unsafe control characters, and trim outer whitespace."""
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = CONTROL_CHARS_TEXT_RE.sub("", normalized)
    return cleaned.strip()


def validate_contact_payload(data: Any) -> tuple[dict[str, str] | None, dict[str, str] | None]:
    """
    Validate and sanitize incoming contact form JSON payload.
    Returns (cleaned_data, field_errors). One of the two is always None.
    """
    if not isinstance(data, dict):
        return None, {"form": "Request body must be a valid JSON object."}

    errors: dict[str, str] = {}

    # Support camelCase (frontend) and snake_case field aliases
    raw_name = data.get("fullName", data.get("full_name"))
    raw_email = data.get("email")
    raw_project_type = data.get("projectType", data.get("project_type"))
    raw_budget = data.get("budgetRange", data.get("budget_range", ""))
    raw_message = data.get("message")

    # Ensure non-string types are rejected safely
    for field_key, raw_val in (
        ("fullName", raw_name),
        ("email", raw_email),
        ("projectType", raw_project_type),
        ("message", raw_message),
    ):
        if raw_val is not None and not isinstance(raw_val, str):
            errors[field_key] = "Invalid field format."

    if raw_budget is not None and not isinstance(raw_budget, str):
        errors["budgetRange"] = "Invalid budget range format."

    if errors:
        return None, errors

    # 1. Full Name (required)
    full_name = sanitize_single_line(raw_name) if isinstance(raw_name, str) else ""
    if not full_name:
        errors["fullName"] = "Full name is required."
    elif len(full_name) < MIN_NAME_LENGTH:
        errors["fullName"] = f"Full name must be at least {MIN_NAME_LENGTH} characters."
    elif len(full_name) > MAX_NAME_LENGTH:
        errors["fullName"] = f"Full name must be {MAX_NAME_LENGTH} characters or fewer."

    # 2. Email Address (required)
    email = sanitize_single_line(raw_email).lower() if isinstance(raw_email, str) else ""
    if not email:
        errors["email"] = "Email address is required."
    elif len(email) > MAX_EMAIL_LENGTH or ".." in email or not EMAIL_REGEX.match(email):
        errors["email"] = "Please enter a valid email address."

    # 3. Project Type (required)
    project_type = (
        sanitize_single_line(raw_project_type) if isinstance(raw_project_type, str) else ""
    )
    if not project_type:
        errors["projectType"] = "Please select a project type."
    elif project_type not in ALLOWED_PROJECT_TYPES:
        errors["projectType"] = "Please select a valid project type."

    # 4. Budget Range (optional)
    budget_range = sanitize_single_line(raw_budget) if isinstance(raw_budget, str) else ""
    if budget_range and budget_range not in ALLOWED_BUDGET_RANGES:
        errors["budgetRange"] = "Please select a valid budget range."

    # 5. Project Description / Message (required)
    message = sanitize_multiline(raw_message) if isinstance(raw_message, str) else ""
    if not message:
        errors["message"] = "Project description is required."
    elif len(message) < MIN_MESSAGE_LENGTH:
        errors["message"] = (
            f"Please provide at least {MIN_MESSAGE_LENGTH} characters describing your project."
        )
    elif len(message) > MAX_MESSAGE_LENGTH:
        errors["message"] = (
            f"Project description must not exceed {MAX_MESSAGE_LENGTH} characters."
        )

    if errors:
        return None, errors

    return {
        "fullName": full_name,
        "email": email,
        "projectType": project_type,
        "budgetRange": budget_range or "Not specified",
        "message": message,
    }, None


def is_honeypot_triggered(data: dict[str, Any]) -> bool:
    """Detect automated spam bots that populate hidden trap fields."""
    for trap_field in ("website", "honeypot", "company_url"):
        val = data.get(trap_field)
        if isinstance(val, str) and val.strip():
            return True
        if val not in (None, ""):
            return True
    return False


# ---------------------------------------------------------------------------
# Email Formatting & Resend Delivery
# ---------------------------------------------------------------------------


def build_enquiry_email(cleaned_data: dict[str, str], submitted_at: datetime | None = None) -> tuple[str, str]:
    """
    Build clean, XSS-safe HTML and plain-text email bodies for a contact enquiry.
    Returns (html_body, text_body).
    """
    ts_utc = submitted_at or datetime.now(timezone.utc)
    ts_ist = ts_utc.astimezone(IST_OFFSET)
    timestamp_display = f"{ts_ist.strftime('%d %b %Y, %I:%M %p IST')} ({ts_utc.strftime('%Y-%m-%d %H:%M:%S UTC')})"

    escaped_name = html.escape(cleaned_data["fullName"])
    escaped_email = html.escape(cleaned_data["email"])
    escaped_project = html.escape(cleaned_data["projectType"])
    escaped_budget = html.escape(cleaned_data["budgetRange"])
    escaped_message_html = html.escape(cleaned_data["message"]).replace("\n", "<br>")
    escaped_timestamp = html.escape(timestamp_display)

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(EMAIL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background-color:#0a0a0a;color:#ffffff;border:1px solid #262626;">
          <tr>
            <td style="padding:28px 32px;background-color:#7B2EFF;">
              <p style="margin:0 0 6px 0;font-family:monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#FFD600;font-weight:700;">
                PIXEL PRODUCTIONS // NEW ENQUIRY
              </p>
              <h1 style="margin:0;font-size:24px;line-height:1.2;font-weight:700;text-transform:uppercase;letter-spacing:-0.02em;color:#ffffff;">
                New Project Enquiry
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;width:150px;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#a1a1aa;vertical-align:top;">
                    Full Name
                  </td>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-size:15px;font-weight:600;color:#ffffff;">
                    {escaped_name}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#a1a1aa;vertical-align:top;">
                    Email Address
                  </td>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-size:15px;color:#FFD600;">
                    <a href="mailto:{escaped_email}" style="color:#FFD600;text-decoration:none;">{escaped_email}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#a1a1aa;vertical-align:top;">
                    Project Type
                  </td>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-size:15px;color:#ffffff;">
                    {escaped_project}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#a1a1aa;vertical-align:top;">
                    Budget Range
                  </td>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-size:15px;color:#ffffff;">
                    {escaped_budget}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#a1a1aa;vertical-align:top;">
                    Submitted At
                  </td>
                  <td style="padding:10px 0;border-bottom:1px solid #262626;font-size:13px;font-family:monospace;color:#d4d4d8;">
                    {escaped_timestamp}
                  </td>
                </tr>
              </table>

              <div style="margin-top:24px;">
                <p style="margin:0 0 10px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#FFD600;">
                  Project Description
                </p>
                <div style="padding:18px;background-color:#141414;border-left:3px solid #7B2EFF;font-size:14px;line-height:1.65;color:#f4f4f5;">
                  {escaped_message_html}
                </div>
              </div>

              <p style="margin:24px 0 0 0;font-size:12px;color:#a1a1aa;">
                Reply directly to this email to respond to {escaped_name} ({escaped_email}).
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    text_body = (
        "NEW PROJECT ENQUIRY – PIXEL PRODUCTIONS\n"
        "=========================================\n\n"
        f"Full Name:     {cleaned_data['fullName']}\n"
        f"Email Address: {cleaned_data['email']}\n"
        f"Project Type:  {cleaned_data['projectType']}\n"
        f"Budget Range:  {cleaned_data['budgetRange']}\n"
        f"Submitted At:  {timestamp_display}\n\n"
        "Project Description:\n"
        "--------------------\n"
        f"{cleaned_data['message']}\n"
    )

    return html_body, text_body


def send_enquiry_email(cleaned_data: dict[str, str]) -> dict[str, Any]:
    """Send contact enquiry notification via official Resend Python SDK."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    contact_email = os.environ.get("CONTACT_EMAIL", "").strip()
    from_email = os.environ.get("FROM_EMAIL", "").strip()

    if not api_key or not contact_email or not from_email:
        raise RuntimeError("Missing required Resend email configuration.")

    html_body, text_body = build_enquiry_email(cleaned_data)

    resend.api_key = api_key
    params: resend.Emails.SendParams = {
        "from": from_email,
        "to": [contact_email],
        "reply_to": cleaned_data["email"],
        "subject": EMAIL_SUBJECT,
        "html": html_body,
        "text": text_body,
    }
    return resend.Emails.send(params)


# ---------------------------------------------------------------------------
# Flask Application Factory & Configuration
# ---------------------------------------------------------------------------


def parse_allowed_origins() -> list[str]:
    """Parse allowed CORS origins from FRONTEND_URL (supports comma-separated list)."""
    raw_origins = os.environ.get("FRONTEND_URL", "https://pixelproductions.netlify.app")
    origins = [
        origin.strip().rstrip("/")
        for origin in raw_origins.split(",")
        if origin.strip()
    ]
    return origins or ["https://pixelproductions.netlify.app"]


def get_client_ip() -> str:
    """
    Extract client IP safely.
    ProxyFix rewrites remote_addr from X-Forwarded-For behind Render's proxy.
    """
    return request.remote_addr or "unknown"


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES

    # Respect Render's reverse-proxy headers for accurate client IP rate limiting
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    allowed_origins = parse_allowed_origins()
    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": allowed_origins,
                "methods": ["GET", "POST", "OPTIONS"],
                "allow_headers": ["Content-Type"],
                "max_age": 600,
            }
        },
    )

    rate_limit_max = int(os.environ.get("RATE_LIMIT_MAX_REQUESTS", "5"))
    rate_limit_window = int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS", "900"))
    rate_limiter = SlidingWindowRateLimiter(
        max_requests=rate_limit_max,
        window_seconds=rate_limit_window,
    )
    app.extensions["rate_limiter"] = rate_limiter

    # -----------------------------------------------------------------------
    # Routes
    # -----------------------------------------------------------------------

    @app.get("/api/health")
    def health_check():
        """Render health-check endpoint."""
        return jsonify(
            {
                "status": "ok",
                "service": "pixel-productions-contact-api",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ), 200

    @app.post("/api/contact")
    def submit_contact():
        """Handle contact form submissions with validation, spam protection, and Resend email."""
        client_ip = get_client_ip()

        # 1. Rate limiting check
        allowed, retry_after = rate_limiter.is_allowed(client_ip)
        if not allowed:
            logger.warning("Rate limit exceeded for IP %s", client_ip)
            response = jsonify(
                {
                    "success": False,
                    "error": "Too many enquiries sent from your connection. Please wait a few minutes and try again.",
                }
            )
            response.status_code = 429
            response.headers["Retry-After"] = str(retry_after)
            return response

        # 2. Parse JSON request body safely
        if not request.is_json:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Invalid request format. Content-Type must be application/json.",
                    }
                ),
                400,
            )

        try:
            payload = request.get_json(silent=False)
        except BadRequest:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Malformed JSON payload.",
                    }
                ),
                400,
            )

        if not isinstance(payload, dict):
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Request body must be a JSON object.",
                    }
                ),
                400,
            )

        # 3. Honeypot spam check (do not reveal trap field details in response)
        if is_honeypot_triggered(payload):
            logger.warning("Honeypot triggered from IP %s", client_ip)
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Unable to process submission.",
                    }
                ),
                400,
            )

        # 4. Validate & sanitize fields
        cleaned_data, field_errors = validate_contact_payload(payload)
        if field_errors or cleaned_data is None:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Please review the highlighted fields and try again.",
                        "fieldErrors": field_errors,
                    }
                ),
                400,
            )

        # 5. Send email via Resend
        try:
            send_enquiry_email(cleaned_data)
        except RuntimeError as exc:
            logger.error("Email service misconfigured: %s", exc)
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "The contact service is temporarily unavailable. Please email pixelproductions170@gmail.com directly.",
                    }
                ),
                503,
            )
        except Exception as exc:
            logger.exception("Resend API error while delivering enquiry: %s", type(exc).__name__)
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "We couldn't deliver your message right now. Please try again in a moment.",
                    }
                ),
                502,
            )

        logger.info(
            "Contact enquiry delivered successfully (projectType=%s)",
            cleaned_data["projectType"],
        )
        return (
            jsonify(
                {
                    "success": True,
                    "message": "Your enquiry has been sent. We'll respond within 24 hours.",
                }
            ),
            200,
        )

    # -----------------------------------------------------------------------
    # Global Safe JSON Error Handlers
    # -----------------------------------------------------------------------

    @app.errorhandler(RequestEntityTooLarge)
    def handle_payload_too_large(_err):
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Request payload exceeds the maximum allowed size.",
                }
            ),
            413,
        )

    @app.errorhandler(404)
    def handle_not_found(_err):
        return jsonify({"success": False, "error": "Endpoint not found."}), 404

    @app.errorhandler(405)
    def handle_method_not_allowed(_err):
        return jsonify({"success": False, "error": "Method not allowed."}), 405

    @app.errorhandler(Exception)
    def handle_unexpected_error(err):
        logger.exception("Unhandled server exception: %s", type(err).__name__)
        return (
            jsonify(
                {
                    "success": False,
                    "error": "An unexpected server error occurred. Please try again later.",
                }
            ),
            500,
        )

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug_mode = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug_mode)

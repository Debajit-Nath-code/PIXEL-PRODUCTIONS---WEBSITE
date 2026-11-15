"""
Automated test suite for the Pixel Productions Flask Contact API.

Covers:
1. Successful contact form submission (with & without optional budget range)
2. Invalid email address & header injection attempts
3. Empty / invalid required fields & message length boundaries
4. Invalid or malformed JSON & wrong Content-Type
5. Missing email configuration (503 safe error)
6. Spam / honeypot submission rejection
7. Rate-limited requests (429 + Retry-After)
8. Resend Email API failure (502 safe error without secret leakage)
9. Health check endpoint (GET /api/health) and CORS origin parsing
"""

from __future__ import annotations

import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _install_stdlib_flask_shims_if_needed() -> bool:
    """
    Provide minimal test-only shims when third-party packages are not installed
    in the current Python environment (e.g., Node-only container).
    When Flask is installed (normal Python venv), real Flask is used untouched.
    """
    try:
        import flask  # noqa: F401
        return False
    except ImportError:
        pass

    # Minimal dotenv stub
    dotenv_mod = types.ModuleType("dotenv")
    dotenv_mod.load_dotenv = lambda *a, **kw: False
    sys.modules["dotenv"] = dotenv_mod

    # Minimal resend stub
    resend_mod = types.ModuleType("resend")

    class _Emails:
        SendParams = dict

        @staticmethod
        def send(params):
            return {"id": "mock_email_id"}

    resend_mod.Emails = _Emails
    resend_mod.api_key = ""
    sys.modules["resend"] = resend_mod

    # Minimal werkzeug exceptions & ProxyFix stub
    werkzeug_mod = types.ModuleType("werkzeug")
    werkzeug_exc = types.ModuleType("werkzeug.exceptions")

    class BadRequest(Exception):
        pass

    class RequestEntityTooLarge(Exception):
        pass

    werkzeug_exc.BadRequest = BadRequest
    werkzeug_exc.RequestEntityTooLarge = RequestEntityTooLarge
    werkzeug_mw = types.ModuleType("werkzeug.middleware")
    werkzeug_proxy = types.ModuleType("werkzeug.middleware.proxy_fix")
    werkzeug_proxy.ProxyFix = lambda wsgi_app, **kwargs: wsgi_app

    sys.modules["werkzeug"] = werkzeug_mod
    sys.modules["werkzeug.exceptions"] = werkzeug_exc
    sys.modules["werkzeug.middleware"] = werkzeug_mw
    sys.modules["werkzeug.middleware.proxy_fix"] = werkzeug_proxy

    # Minimal flask_cors stub
    cors_mod = types.ModuleType("flask_cors")

    def _cors(app, resources=None):
        app._cors_resources = resources
        return app

    cors_mod.CORS = _cors
    sys.modules["flask_cors"] = cors_mod

    # Minimal Flask & test_client stub
    flask_mod = types.ModuleType("flask")

    class _Response:
        def __init__(self, data: bytes, status_code: int = 200, headers: dict | None = None):
            self.data = data
            self.status_code = status_code
            self.headers = headers or {}

        def get_json(self):
            return json.loads(self.data.decode("utf-8"))

    class _RequestProxy:
        def __init__(self):
            self.remote_addr = "127.0.0.1"
            self.headers = {}
            self._raw_data = b""
            self._content_type = ""

        @property
        def is_json(self) -> bool:
            return "application/json" in self._content_type.lower()

        def get_json(self, silent=False):
            try:
                return json.loads(self._raw_data.decode("utf-8"))
            except Exception as exc:
                if silent:
                    return None
                raise BadRequest("Invalid JSON") from exc

    request_proxy = _RequestProxy()

    def jsonify(obj):
        return _Response(json.dumps(obj).encode("utf-8"), 200, {"Content-Type": "application/json"})

    class _TestClient:
        def __init__(self, app):
            self.app = app

        def _dispatch(self, method: str, path: str, data=None, content_type: str = "application/json", remote_addr: str = "127.0.0.1"):
            handler = self.app._routes.get((method, path))
            if handler is None:
                return _Response(json.dumps({"success": False, "error": "Not found"}).encode(), 404)

            raw_bytes = data.encode("utf-8") if isinstance(data, str) else (data or b"")
            max_len = self.app.config.get("MAX_CONTENT_LENGTH")
            if max_len and len(raw_bytes) > max_len:
                err_handler = self.app._error_handlers.get(RequestEntityTooLarge)
                if err_handler:
                    res = err_handler(RequestEntityTooLarge())
                    if isinstance(res, tuple):
                        resp, code = res
                        resp.status_code = code
                        return resp
                    return res

            request_proxy.remote_addr = remote_addr
            request_proxy._raw_data = raw_bytes
            request_proxy._content_type = content_type

            res = handler()
            if isinstance(res, tuple):
                resp, code = res
                resp.status_code = code
                return resp
            return res

        def get(self, path: str, **kwargs):
            return self._dispatch("GET", path, **kwargs)

        def post(self, path: str, json=None, data=None, content_type="application/json", environ_base=None):
            import json as _json
            body = _json.dumps(json) if json is not None else data
            ip = (environ_base or {}).get("REMOTE_ADDR", "127.0.0.1")
            return self._dispatch("POST", path, data=body, content_type=content_type, remote_addr=ip)

    class Flask:
        def __init__(self, import_name: str):
            self.import_name = import_name
            self.config = {}
            self.extensions = {}
            self.wsgi_app = lambda *a, **kw: None
            self._routes = {}
            self._error_handlers = {}

        def get(self, path: str):
            def decorator(fn):
                self._routes[("GET", path)] = fn
                return fn
            return decorator

        def post(self, path: str):
            def decorator(fn):
                self._routes[("POST", path)] = fn
                return fn
            return decorator

        def errorhandler(self, exc_or_code):
            def decorator(fn):
                self._error_handlers[exc_or_code] = fn
                return fn
            return decorator

        def test_client(self):
            return _TestClient(self)

    flask_mod.Flask = Flask
    flask_mod.jsonify = jsonify
    flask_mod.request = request_proxy
    sys.modules["flask"] = flask_mod
    return True


USING_SHIMS = _install_stdlib_flask_shims_if_needed()

import app as backend_app  # noqa: E402


VALID_PAYLOAD = {
    "fullName": "Aarav Sharma",
    "email": "aarav@creatorstudio.in",
    "projectType": "YouTube Video Editing",
    "budgetRange": "₹35,000 – ₹75,000",
    "message": "Looking for a long-term editor for 2 weekly 15-minute documentary-style YouTube videos with motion graphics.",
    "website": "",
}


class ContactApiTests(unittest.TestCase):
    def setUp(self):
        self.env_patcher = patch.dict(
            os.environ,
            {
                "RESEND_API_KEY": "re_test_key_12345",
                "CONTACT_EMAIL": "owner@pixelproductions.com",
                "FROM_EMAIL": "Pixel Productions <contact@pixelproductions.com>",
                "FRONTEND_URL": "https://pixelproductions.netlify.app",
                "RATE_LIMIT_MAX_REQUESTS": "5",
                "RATE_LIMIT_WINDOW_SECONDS": "900",
            },
        )
        self.env_patcher.start()
        self.flask_app = backend_app.create_app()
        self.client = self.flask_app.test_client()

    def tearDown(self):
        self.env_patcher.stop()

    def test_01_health_check(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], "pixel-productions-contact-api")
        self.assertIn("timestamp", body)

    def test_02_successful_submission(self):
        captured = {}

        def fake_send(params):
            captured.update(params)
            return {"id": "email_123"}

        with patch.object(backend_app.resend.Emails, "send", side_effect=fake_send):
            resp = self.client.post("/api/contact", json=VALID_PAYLOAD)

        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(captured["subject"], "New Project Enquiry – Pixel Productions")
        self.assertEqual(captured["reply_to"], "aarav@creatorstudio.in")
        self.assertEqual(captured["to"], ["owner@pixelproductions.com"])
        self.assertEqual(captured["from"], "Pixel Productions <contact@pixelproductions.com>")
        self.assertIn("Aarav Sharma", captured["html"])
        self.assertIn("₹35,000 – ₹75,000", captured["text"])

    def test_03_successful_submission_without_optional_budget(self):
        payload = {**VALID_PAYLOAD}
        payload.pop("budgetRange")
        captured = {}

        with patch.object(backend_app.resend.Emails, "send", side_effect=lambda p: captured.update(p) or {"id": "ok"}):
            resp = self.client.post("/api/contact", json=payload)

        self.assertEqual(resp.status_code, 200)
        self.assertIn("Not specified", captured["text"])

    def test_04_invalid_email_rejected(self):
        for bad_email in ("not-an-email", "test@invalid", "bad..dots@example.com", "a@b\ncc:evil@x.com"):
            payload = {**VALID_PAYLOAD, "email": bad_email}
            resp = self.client.post("/api/contact", json=payload)
            self.assertEqual(resp.status_code, 400, f"Expected 400 for email {bad_email!r}")
            body = resp.get_json()
            self.assertFalse(body["success"])
            self.assertIn("email", body["fieldErrors"])

    def test_05_empty_and_invalid_required_fields(self):
        payload = {
            "fullName": " ",
            "email": "",
            "projectType": "Invalid Service",
            "budgetRange": "Invalid Budget",
            "message": "Too short",
        }
        resp = self.client.post("/api/contact", json=payload)
        self.assertEqual(resp.status_code, 400)
        body = resp.get_json()
        self.assertFalse(body["success"])
        errors = body["fieldErrors"]
        self.assertIn("fullName", errors)
        self.assertIn("email", errors)
        self.assertIn("projectType", errors)
        self.assertIn("budgetRange", errors)
        self.assertIn("message", errors)

    def test_06_excessively_long_message_rejected(self):
        payload = {**VALID_PAYLOAD, "message": "A" * (backend_app.MAX_MESSAGE_LENGTH + 1)}
        resp = self.client.post("/api/contact", json=payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("message", resp.get_json()["fieldErrors"])

    def test_07_malformed_json_and_wrong_content_type(self):
        resp_bad_json = self.client.post(
            "/api/contact",
            data="{bad json",
            content_type="application/json",
        )
        self.assertEqual(resp_bad_json.status_code, 400)
        self.assertFalse(resp_bad_json.get_json()["success"])

        resp_wrong_ct = self.client.post(
            "/api/contact",
            data="fullName=Test",
            content_type="text/plain",
        )
        self.assertEqual(resp_wrong_ct.status_code, 400)
        self.assertFalse(resp_wrong_ct.get_json()["success"])

        resp_array = self.client.post(
            "/api/contact",
            data='["not", "an", "object"]',
            content_type="application/json",
        )
        self.assertEqual(resp_array.status_code, 400)

    def test_08_honeypot_blocks_spam_without_sending_email(self):
        spam_payload = {**VALID_PAYLOAD, "website": "https://spam-bot.example"}
        with patch.object(backend_app.resend.Emails, "send") as mock_send:
            resp = self.client.post("/api/contact", json=spam_payload)

        self.assertEqual(resp.status_code, 400)
        self.assertFalse(resp.get_json()["success"])
        mock_send.assert_not_called()

    def test_09_rate_limiting_enforced(self):
        with patch.object(backend_app.resend.Emails, "send", return_value={"id": "ok"}):
            for _ in range(5):
                resp = self.client.post(
                    "/api/contact",
                    json=VALID_PAYLOAD,
                    environ_base={"REMOTE_ADDR": "203.0.113.10"},
                )
                self.assertEqual(resp.status_code, 200)

            blocked = self.client.post(
                "/api/contact",
                json=VALID_PAYLOAD,
                environ_base={"REMOTE_ADDR": "203.0.113.10"},
            )
            self.assertEqual(blocked.status_code, 429)
            self.assertFalse(blocked.get_json()["success"])
            self.assertIn("Retry-After", blocked.headers)

            # Different IP remains unaffected
            other_ip = self.client.post(
                "/api/contact",
                json=VALID_PAYLOAD,
                environ_base={"REMOTE_ADDR": "203.0.113.11"},
            )
            self.assertEqual(other_ip.status_code, 200)

    def test_10_resend_api_failure_handled_safely(self):
        with patch.object(
            backend_app.resend.Emails,
            "send",
            side_effect=Exception("Resend internal error with re_test_key_12345"),
        ):
            resp = self.client.post("/api/contact", json=VALID_PAYLOAD)

        self.assertEqual(resp.status_code, 502)
        body = resp.get_json()
        self.assertFalse(body["success"])
        self.assertNotIn("re_test_key_12345", json.dumps(body))
        self.assertNotIn("Traceback", json.dumps(body))

    def test_11_missing_email_config_returns_503(self):
        with patch.dict(os.environ, {"RESEND_API_KEY": ""}, clear=False):
            resp = self.client.post("/api/contact", json=VALID_PAYLOAD)
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.get_json()["success"])

    def test_12_html_escaping_prevents_email_xss(self):
        xss_payload = {
            **VALID_PAYLOAD,
            "fullName": "<script>alert(1)</script>",
            "message": "Please check <img src=x onerror=alert(1)> in my edit brief.",
        }
        captured = {}
        with patch.object(backend_app.resend.Emails, "send", side_effect=lambda p: captured.update(p) or {"id": "ok"}):
            resp = self.client.post("/api/contact", json=xss_payload)

        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("<script>", captured["html"])
        self.assertIn("&lt;script&gt;", captured["html"])
        self.assertNotIn("<img ", captured["html"])
        self.assertIn("&lt;img ", captured["html"])

    def test_13_cors_origins_normalized(self):
        with patch.dict(
            os.environ,
            {"FRONTEND_URL": "https://pixelproductions.netlify.app/, https://preview.netlify.app/"},
        ):
            origins = backend_app.parse_allowed_origins()
        self.assertEqual(
            origins,
            ["https://pixelproductions.netlify.app", "https://preview.netlify.app"],
        )

    def test_14_oversized_payload_returns_413(self):
        oversized = json.dumps({**VALID_PAYLOAD, "message": "X" * (backend_app.MAX_REQUEST_BYTES + 1024)})
        resp = self.client.post(
            "/api/contact",
            data=oversized,
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 413)
        self.assertFalse(resp.get_json()["success"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

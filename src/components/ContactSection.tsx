import React, { useId, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Mail,
} from 'lucide-react';

const PROJECT_TYPES = [
  'YouTube Video Editing',
  'Short-form Video Editing',
  'Reels / Instagram Content',
  'Motion Graphics',
  'Other',
] as const;

const BUDGET_RANGES = [
  'Under ₹15,000',
  '₹15,000 – ₹35,000',
  '₹35,000 – ₹75,000',
  '₹75,000 – ₹1,50,000',
  '₹1,50,000+',
] as const;

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 5000;
const REQUEST_TIMEOUT_MS = 20000;

interface ContactFormValues {
  fullName: string;
  email: string;
  projectType: string;
  budgetRange: string;
  message: string;
  website: string; // Hidden honeypot trap field
}

type FieldName = keyof Omit<ContactFormValues, 'website'>;
type FormErrors = Partial<Record<FieldName, string>>;

const INITIAL_VALUES: ContactFormValues = {
  fullName: '',
  email: '',
  projectType: '',
  budgetRange: '',
  message: '',
  website: '',
};

function validateField(name: FieldName, value: string): string | undefined {
  const trimmed = value.trim();

  switch (name) {
    case 'fullName': {
      if (!trimmed) return 'Full name is required.';
      if (trimmed.length < MIN_NAME_LENGTH) {
        return `Full name must be at least ${MIN_NAME_LENGTH} characters.`;
      }
      if (trimmed.length > MAX_NAME_LENGTH) {
        return `Full name must be ${MAX_NAME_LENGTH} characters or fewer.`;
      }
      return undefined;
    }
    case 'email': {
      if (!trimmed) return 'Email address is required.';
      if (
        trimmed.length > MAX_EMAIL_LENGTH ||
        trimmed.includes('..') ||
        !EMAIL_REGEX.test(trimmed)
      ) {
        return 'Please enter a valid email address.';
      }
      return undefined;
    }
    case 'projectType': {
      if (!trimmed) return 'Please select a project type.';
      if (!PROJECT_TYPES.includes(trimmed as (typeof PROJECT_TYPES)[number])) {
        return 'Please select a valid project type.';
      }
      return undefined;
    }
    case 'budgetRange': {
      if (
        trimmed &&
        !BUDGET_RANGES.includes(trimmed as (typeof BUDGET_RANGES)[number])
      ) {
        return 'Please select a valid budget range.';
      }
      return undefined;
    }
    case 'message': {
      if (!trimmed) return 'Project description is required.';
      if (trimmed.length < MIN_MESSAGE_LENGTH) {
        return `Please share at least ${MIN_MESSAGE_LENGTH} characters about your project.`;
      }
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        return `Project description cannot exceed ${MAX_MESSAGE_LENGTH} characters.`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function validateAllFields(values: ContactFormValues): FormErrors {
  const errors: FormErrors = {};
  const fields: FieldName[] = [
    'fullName',
    'email',
    'projectType',
    'budgetRange',
    'message',
  ];

  for (const field of fields) {
    const error = validateField(field, values[field]);
    if (error) {
      errors[field] = error;
    }
  }
  return errors;
}

export default function ContactSection() {
  const baseId = useId();
  const fullNameInputRef = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState<ContactFormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>(
    'idle',
  );
  const [feedbackMessage, setFeedbackMessage] = useState('');

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));

    if (submitStatus === 'error') {
      setSubmitStatus('idle');
      setFeedbackMessage('');
    }

    if (name !== 'website' && touched[name as FieldName]) {
      const fieldName = name as FieldName;
      const nextError = validateField(fieldName, value);
      setErrors((prev) => {
        const updated = { ...prev };
        if (nextError) {
          updated[fieldName] = nextError;
        } else {
          delete updated[fieldName];
        }
        return updated;
      });
    }
  };

  const handleBlur = (
    e: React.FocusEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const name = e.target.name as FieldName;
    if (!name || (name as string) === 'website') return;

    setTouched((prev) => ({ ...prev, [name]: true }));
    const fieldError = validateField(name, e.target.value);
    setErrors((prev) => {
      const updated = { ...prev };
      if (fieldError) {
        updated[name] = fieldError;
      } else {
        delete updated[name];
      }
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Prevent duplicate concurrent submissions
    if (isSubmitting) return;

    setTouched({
      fullName: true,
      email: true,
      projectType: true,
      budgetRange: true,
      message: true,
    });

    const validationErrors = validateAllFields(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setSubmitStatus('error');
      setFeedbackMessage('Please review the highlighted fields before submitting.');
      return;
    }

    const configuredApiUrl = (import.meta.env.VITE_API_URL || '')
      .trim()
      .replace(/\/+$/, '');

    if (!configuredApiUrl) {
      setSubmitStatus('error');
      setFeedbackMessage(
        'The contact form backend URL (VITE_API_URL) is not configured yet. Please email pixelproductions170@gmail.com directly.',
      );
      return;
    }

    setErrors({});
    setSubmitStatus('idle');
    setFeedbackMessage('');
    setIsSubmitting(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${configuredApiUrl}/api/contact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: values.fullName.trim(),
          email: values.email.trim(),
          projectType: values.projectType.trim(),
          budgetRange: values.budgetRange.trim(),
          message: values.message.trim(),
          website: values.website,
        }),
        signal: controller.signal,
      });

      let data: {
        success?: boolean;
        message?: string;
        error?: string;
        fieldErrors?: Record<string, string>;
      } | null = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || !data?.success) {
        if (data?.fieldErrors) {
          setErrors(data.fieldErrors as FormErrors);
        }

        if (response.status === 429) {
          setSubmitStatus('error');
          setFeedbackMessage(
            data?.error ||
              'Too many requests sent recently. Please wait a few minutes and try again.',
          );
          return;
        }

        setSubmitStatus('error');
        setFeedbackMessage(
          data?.error ||
            'Unable to send your enquiry right now. Please try again or email pixelproductions170@gmail.com.',
        );
        return;
      }

      // Clear form ONLY after confirmed successful submission
      setValues(INITIAL_VALUES);
      setErrors({});
      setTouched({});
      setSubmitStatus('success');
      setFeedbackMessage(
        data.message ||
          "Your enquiry has been sent. We'll review your brief and respond within 24 hours.",
      );
    } catch (err) {
      setSubmitStatus('error');
      if (err instanceof DOMException && err.name === 'AbortError') {
        setFeedbackMessage(
          'The request timed out while waiting for the server. Please try again in a moment.',
        );
      } else {
        setFeedbackMessage(
          'Unable to reach the contact server right now. Please check your connection or email pixelproductions170@gmail.com.',
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  };

  const handleResetSuccess = () => {
    setSubmitStatus('idle');
    setFeedbackMessage('');
    window.setTimeout(() => {
      fullNameInputRef.current?.focus();
    }, 50);
  };

  const messageLength = values.message.trim().length;

  return (
    <section
      id="contact"
      className="bg-brand-purple relative overflow-hidden text-white mt-12 pt-24 pb-28 md:py-32 px-6 md:px-12"
    >
      {/* Background Texture/glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent opacity-50 blur-2xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
        {/* Left Editorial Column */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="lg:col-span-5 flex flex-col justify-between"
        >
          <div>
            <p className="font-mono text-brand-yellow uppercase tracking-widest text-xs md:text-sm mb-5">
              Taking on select new partners
            </p>
            <h2 className="font-display font-bold text-5xl sm:text-6xl xl:text-8xl leading-[0.9] tracking-tighter uppercase mb-6">
              Scale Your
              <br />
              Content.
            </h2>
            <p className="text-white/85 font-medium text-base md:text-lg max-w-md mb-10 leading-relaxed">
              Stop losing watch time to bad editing. Tell us about your channel
              or campaign and let&apos;s engineer videos that actually convert.
            </p>
          </div>

          <div className="border-t border-white/20 pt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-6 max-w-lg">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-white/60 mb-2">
                Direct Email
              </p>
              <a
                href="mailto:pixelproductions170@gmail.com"
                className="inline-flex items-center gap-2.5 text-sm font-medium text-brand-yellow hover:text-white transition-colors focus-visible:outline-none focus-visible:underline"
              >
                <Mail className="w-4 h-4 shrink-0" />
                pixelproductions170@gmail.com
              </a>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-white/60 mb-2">
                Turnaround SLA
              </p>
              <p className="text-sm font-medium text-white">
                Replies within 24 hours
              </p>
            </div>
          </div>
        </motion.div>

        {/* Right Form Container */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="lg:col-span-7 bg-[#0a0a0a] border border-white/15 p-6 sm:p-8 md:p-10 shadow-2xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-5 mb-8">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-yellow font-bold">
              Project Brief // Enquiry
            </p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-gray-400">
              <span className="text-brand-yellow">*</span> Required fields
            </p>
          </div>

          {submitStatus === 'success' ? (
            <div
              role="status"
              aria-live="polite"
              className="py-10 px-4 sm:px-6 text-left border border-brand-yellow/40 bg-brand-yellow/5"
            >
              <div className="w-12 h-12 bg-brand-yellow text-black flex items-center justify-center mb-6">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-2xl sm:text-3xl uppercase tracking-tight text-white mb-3">
                Enquiry Received.
              </h3>
              <p className="text-gray-300 text-sm sm:text-base leading-relaxed max-w-lg mb-8">
                {feedbackMessage}
              </p>
              <button
                type="button"
                onClick={handleResetSuccess}
                className="inline-flex items-center gap-3 bg-brand-yellow text-black px-6 py-3.5 font-display font-bold uppercase tracking-widest text-xs hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Send Another Enquiry <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-6">
              {/* Hidden Honeypot Trap Field for Bots */}
              <div
                aria-hidden="true"
                className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden opacity-0 pointer-events-none"
              >
                <label htmlFor={`${baseId}-website`}>Website</label>
                <input
                  id={`${baseId}-website`}
                  name="website"
                  type="text"
                  value={values.website}
                  onChange={handleChange}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              {/* Row 1: Full Name + Email Address */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label
                    htmlFor={`${baseId}-fullName`}
                    className="block font-mono text-[11px] uppercase tracking-widest text-gray-300 mb-2"
                  >
                    Full Name <span className="text-brand-yellow" aria-hidden="true">*</span>
                  </label>
                  <input
                    ref={fullNameInputRef}
                    id={`${baseId}-fullName`}
                    name="fullName"
                    type="text"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.fullName)}
                    aria-describedby={
                      errors.fullName ? `${baseId}-fullName-error` : undefined
                    }
                    value={values.fullName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    disabled={isSubmitting}
                    maxLength={MAX_NAME_LENGTH}
                    autoComplete="name"
                    placeholder="Aarav Sharma"
                    className={`w-full bg-[#141414] border px-4 py-3.5 text-sm text-white placeholder:text-gray-500 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50 ${
                      errors.fullName
                        ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                        : 'border-gray-800 hover:border-gray-600 focus:border-brand-yellow focus:ring-brand-yellow'
                    }`}
                  />
                  {errors.fullName && (
                    <p
                      id={`${baseId}-fullName-error`}
                      role="alert"
                      className="mt-2 text-xs text-red-400 font-medium"
                    >
                      {errors.fullName}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor={`${baseId}-email`}
                    className="block font-mono text-[11px] uppercase tracking-widest text-gray-300 mb-2"
                  >
                    Email Address <span className="text-brand-yellow" aria-hidden="true">*</span>
                  </label>
                  <input
                    id={`${baseId}-email`}
                    name="email"
                    type="email"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={
                      errors.email ? `${baseId}-email-error` : undefined
                    }
                    value={values.email}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    disabled={isSubmitting}
                    maxLength={MAX_EMAIL_LENGTH}
                    autoComplete="email"
                    placeholder="aarav@creatorstudio.in"
                    className={`w-full bg-[#141414] border px-4 py-3.5 text-sm text-white placeholder:text-gray-500 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50 ${
                      errors.email
                        ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                        : 'border-gray-800 hover:border-gray-600 focus:border-brand-yellow focus:ring-brand-yellow'
                    }`}
                  />
                  {errors.email && (
                    <p
                      id={`${baseId}-email-error`}
                      role="alert"
                      className="mt-2 text-xs text-red-400 font-medium"
                    >
                      {errors.email}
                    </p>
                  )}
                </div>
              </div>

              {/* Row 2: Project Type + Budget Range */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label
                    htmlFor={`${baseId}-projectType`}
                    className="block font-mono text-[11px] uppercase tracking-widest text-gray-300 mb-2"
                  >
                    Project Type <span className="text-brand-yellow" aria-hidden="true">*</span>
                  </label>
                  <div className="relative">
                    <select
                      id={`${baseId}-projectType`}
                      name="projectType"
                      required
                      aria-required="true"
                      aria-invalid={Boolean(errors.projectType)}
                      aria-describedby={
                        errors.projectType
                          ? `${baseId}-projectType-error`
                          : undefined
                      }
                      value={values.projectType}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      disabled={isSubmitting}
                      className={`w-full appearance-none bg-[#141414] border px-4 py-3.5 pr-10 text-sm transition-colors focus:outline-none focus:ring-1 disabled:opacity-50 ${
                        values.projectType ? 'text-white' : 'text-gray-500'
                      } ${
                        errors.projectType
                          ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                          : 'border-gray-800 hover:border-gray-600 focus:border-brand-yellow focus:ring-brand-yellow'
                      }`}
                    >
                      <option value="" className="bg-[#0a0a0a] text-gray-400">
                        Select project type...
                      </option>
                      {PROJECT_TYPES.map((option) => (
                        <option
                          key={option}
                          value={option}
                          className="bg-[#0a0a0a] text-white"
                        >
                          {option}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      aria-hidden="true"
                      className="w-4 h-4 text-gray-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2"
                    />
                  </div>
                  {errors.projectType && (
                    <p
                      id={`${baseId}-projectType-error`}
                      role="alert"
                      className="mt-2 text-xs text-red-400 font-medium"
                    >
                      {errors.projectType}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor={`${baseId}-budgetRange`}
                    className="block font-mono text-[11px] uppercase tracking-widest text-gray-300 mb-2"
                  >
                    Budget Range (INR){' '}
                    <span className="text-gray-500 lowercase">(optional)</span>
                  </label>
                  <div className="relative">
                    <select
                      id={`${baseId}-budgetRange`}
                      name="budgetRange"
                      aria-invalid={Boolean(errors.budgetRange)}
                      aria-describedby={
                        errors.budgetRange
                          ? `${baseId}-budgetRange-error`
                          : undefined
                      }
                      value={values.budgetRange}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      disabled={isSubmitting}
                      className={`w-full appearance-none bg-[#141414] border px-4 py-3.5 pr-10 text-sm transition-colors focus:outline-none focus:ring-1 disabled:opacity-50 ${
                        values.budgetRange ? 'text-white' : 'text-gray-500'
                      } ${
                        errors.budgetRange
                          ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                          : 'border-gray-800 hover:border-gray-600 focus:border-brand-yellow focus:ring-brand-yellow'
                      }`}
                    >
                      <option value="" className="bg-[#0a0a0a] text-gray-400">
                        Select a budget range...
                      </option>
                      {BUDGET_RANGES.map((range) => (
                        <option
                          key={range}
                          value={range}
                          className="bg-[#0a0a0a] text-white"
                        >
                          {range}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      aria-hidden="true"
                      className="w-4 h-4 text-gray-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2"
                    />
                  </div>
                  {errors.budgetRange && (
                    <p
                      id={`${baseId}-budgetRange-error`}
                      role="alert"
                      className="mt-2 text-xs text-red-400 font-medium"
                    >
                      {errors.budgetRange}
                    </p>
                  )}
                </div>
              </div>

              {/* Row 3: Project Description */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor={`${baseId}-message`}
                    className="block font-mono text-[11px] uppercase tracking-widest text-gray-300"
                  >
                    Project Description{' '}
                    <span className="text-brand-yellow" aria-hidden="true">*</span>
                  </label>
                  <span className="font-mono text-[11px] text-gray-500">
                    {messageLength} / {MAX_MESSAGE_LENGTH}
                  </span>
                </div>
                <textarea
                  id={`${baseId}-message`}
                  name="message"
                  rows={5}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(errors.message)}
                  aria-describedby={
                    errors.message ? `${baseId}-message-error` : undefined
                  }
                  value={values.message}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  disabled={isSubmitting}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder="Share your content style, video length, posting frequency, reference links, and target timeline..."
                  className={`w-full bg-[#141414] border px-4 py-3.5 text-sm text-white placeholder:text-gray-500 transition-colors focus:outline-none focus:ring-1 resize-y min-h-[132px] disabled:opacity-50 ${
                    errors.message
                      ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                      : 'border-gray-800 hover:border-gray-600 focus:border-brand-yellow focus:ring-brand-yellow'
                  }`}
                />
                {errors.message && (
                  <p
                    id={`${baseId}-message-error`}
                    role="alert"
                    className="mt-2 text-xs text-red-400 font-medium"
                  >
                    {errors.message}
                  </p>
                )}
              </div>

              {/* Form-level Error Feedback */}
              {submitStatus === 'error' && feedbackMessage && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="flex items-start gap-3 p-4 border border-red-400/50 bg-red-500/10 text-red-200 text-xs sm:text-sm"
                >
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{feedbackMessage}</span>
                </div>
              )}

              {/* Submit Action */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center gap-3 bg-brand-yellow text-black px-8 py-4 font-display font-bold uppercase tracking-widest text-xs sm:text-sm hover:bg-white hover:scale-[1.01] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending Enquiry...
                    </>
                  ) : (
                    <>
                      Send Project Enquiry
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <p className="font-mono text-[11px] text-gray-500">
                  Protected against spam. No newsletters.
                </p>
              </div>
            </form>
          )}
        </motion.div>
      </div>

      {/* Footer Metadata Bar */}
      <div className="relative z-10 max-w-[1600px] mx-auto mt-16 pt-6 border-t border-white/15 flex flex-col sm:flex-row justify-between items-center gap-3 text-[10px] font-mono tracking-widest uppercase opacity-60">
        <p>Based in TR // Working globally</p>
        <p>&copy; {new Date().getFullYear()} PIXEL PRODUCTIONS.</p>
      </div>
    </section>
  );
}

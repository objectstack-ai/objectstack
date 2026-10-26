/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * EmbeddableForm Component
 *
 * A standalone embeddable form that can be accessed without authentication.
 * Designed for external data collection use cases (surveys, registrations, etc.).
 *
 * Features:
 * - Renders from ObjectFormSchema or inline field definitions
 * - No authentication required (public access)
 * - URL prefill parameters support (?name=John&email=...)
 * - Configurable branding (logo, colors, title)
 * - Success/thank-you page after submission
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { DataSource, FormField } from '@object-ui/types';
import { Button } from '@object-ui/components';
import { CheckCircle2, Lock, Loader2, ShieldCheck } from 'lucide-react';
import { RICH_TEXT_FIELD_TYPES } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import {
  useThankYouRedirectNavigation,
  type PendingThankYouRedirect,
} from './thankYouRedirectNavigation';
import { useRedirectCountdownSeconds } from './thankYouRedirectCountdown';

export interface EmbeddableFormTexts {
  submit?: string;
  submitting?: string;
  submitAnother?: string;
  poweredBy?: string;
  secureNotice?: string;
  thankYouTitle?: string;
  thankYouMessage?: string;
  /** Template string. `{{seconds}}` will be replaced with the remaining seconds. */
  redirecting?: string;
  requiredHint?: string;
  consentLabelDefault?: string;
  consentLink?: string;
  consentRequired?: string;
  rateLimited?: string;
  redirectBlocked?: string;
}

export interface EmbeddableFormConfig {
  /** Unique form ID */
  formId: string;
  /** Object name to create records in */
  objectName: string;
  /** Form title displayed at the top */
  title?: string;
  /** Form description / instructions */
  description?: string;
  /** Fields to include in the form (subset of object fields) */
  fields?: string[];
  /** Custom field definitions for inline forms */
  customFields?: FormField[];
  /** Branding configuration */
  branding?: {
    logo?: string;
    /** Hero cover image rendered above the form card (Airtable-style). */
    coverImage?: string;
    primaryColor?: string;
    backgroundColor?: string;
  };
  /** Thank you page configuration */
  thankYouPage?: {
    title?: string;
    message?: string;
    redirectUrl?: string;
    redirectDelay?: number;
  };
  /** Allow multiple submissions */
  allowMultiple?: boolean;
  /** Localized UI chrome strings (submit label, footer, thank-you defaults). */
  texts?: EmbeddableFormTexts;

  // ── Anti-spam / security ─────────────────────────────────────────────────

  /**
   * Honeypot field name. The form renders an invisible input by this name —
   * humans never see/fill it, bots almost always do. When non-empty on submit
   * we silently accept (showing the thank-you screen) but never call the
   * backend. Set to `false` to disable, omit to use the default `_company_website_2`.
   */
  honeypot?: string | false;

  /**
   * Minimum time (in ms) between mount and submit. Submissions faster than
   * this are silently rejected with a "please review" hint — bots typically
   * submit within milliseconds. Defaults to 1500 ms. Set to 0 to disable.
   */
  minFillTime?: number;

  /**
   * URL prefill whitelist. Only field names in this list will be populated
   * from `?key=value` query string parameters. When `undefined`, **no** URL
   * prefill is applied (secure-by-default). Explicit `prefillParams` prop
   * still bypasses this gate for trusted host-side prefills.
   */
  allowedPrefillFields?: string[];

  /**
   * Hosts that `thankYouPage.redirectUrl` is allowed to point at, in addition
   * to the form's own origin. Cross-origin redirects to anything else are
   * blocked to prevent the form from being weaponised as a phishing relay.
   * @example ['example.com', '*.example.com']
   */
  allowedRedirectHosts?: string[];

  /** GDPR-style consent checkbox shown above the submit button. */
  consent?: {
    /** When true (default), the form cannot be submitted until the box is checked. */
    required?: boolean;
    /** Inline label. Defaults to a localized "I agree to the privacy policy". */
    label?: string;
    /** When set, a link rendered next to the label opens this URL in a new tab. */
    privacyUrl?: string;
  };

  /** Privacy policy URL rendered in the footer (separate from the consent link). */
  privacyPolicyUrl?: string;

  /** Optional anti-spam token (e.g. hCaptcha/Turnstile) attached to the submit payload. */
  captchaToken?: string;
}

export interface EmbeddableFormProps {
  /** Form configuration */
  config: EmbeddableFormConfig;
  /** Data source for creating records */
  dataSource?: DataSource;
  /** URL search parameters for prefilling fields (bypasses the URL whitelist). */
  prefillParams?: Record<string, string>;
  /** Additional CSS class */
  className?: string;
}

/** The long-form cap, shared by `textarea` and every rich-content type. */
const LONG_TEXT_MAX_LENGTH = 5000;

/**
 * Hardened default caps applied to text-shaped customFields when the spec
 * doesn't already define one. Mirrors Airtable/Tally defaults.
 *
 * ## The rich-content entries are DERIVED, not enumerated (objectui#8438)
 *
 * `markdown` and `html` used to be written out here while `richtext` — the
 * THIRD registry key of the same one widget — was absent, so a public form's
 * `richtext` field took unbounded input. That is the fourth instance of a
 * root cause objectui#4831 named in its own body and its fix declined to
 * remove: *hand-written type lists that stop at two of this widget's three
 * keys* (objectui#4250 and objectui#4831 are the other two).
 *
 * Spreading {@link RICH_TEXT_FIELD_TYPES} is that question answered rather
 * than deferred again: this table no longer names a rich-content type, so it
 * can no longer omit one, and a fourth key added to the widget's display table
 * arrives here in the same commit that adds it.
 *
 * ⛔ The four short-text entries above stay literal ON PURPOSE. Each is a
 * distinct widget with a distinct cap, and there is no table to derive them
 * from — a predicate wide enough to cover them would be an invention, not a
 * derivation. The root cause being removed is "one widget, N keys, a list that
 * knows N-1", which is a statement about the rich-content trio alone.
 */
const DEFAULT_MAX_LENGTH: Record<string, number> = {
  text: 200,
  email: 254, // RFC 5321
  url: 2048,
  phone: 32,
  textarea: LONG_TEXT_MAX_LENGTH,
  ...Object.fromEntries(RICH_TEXT_FIELD_TYPES.map((t) => [t, LONG_TEXT_MAX_LENGTH])),
};

const DEFAULT_HONEYPOT_NAME = '_company_website_2';
const DEFAULT_MIN_FILL_MS = 1500;

/** Same-origin or explicit-host allowlist guard for thank-you redirects.
 *  Exported for unit-testing; treat as internal API. */
export function isRedirectUrlSafe(rawUrl: string, allowedHosts: string[] = []): boolean {
  try {
    const url = new URL(rawUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    if (typeof window !== 'undefined' && url.origin === window.location.origin) return true;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return allowedHosts.some((pattern) => {
      if (pattern === url.host) return true;
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1); // ".example.com"
        return url.host.endsWith(suffix) && url.host.length > suffix.length;
      }
      return false;
    });
  } catch {
    return false;
  }
}

/** Apply default max-length caps to a custom-field list (non-destructive).
 *  Exported for unit-testing; treat as internal API. */
export function applyDefaultMaxLengths(fields: FormField[] | undefined): FormField[] | undefined {
  if (!fields) return fields;
  return fields.map((f) => {
    const t = String((f as any).type || '').toLowerCase();
    const cap = DEFAULT_MAX_LENGTH[t];
    if (!cap) return f;
    // The spec's `maxLength` (which `FormField` declares by reference) is the
    // one spelling read. The snake_case `max_length` this also read until
    // objectui#11070 is retired: it no longer opts a field out of the default.
    if (f.maxLength) return f;
    return { ...f, maxLength: cap } as FormField;
  });
}

/**
 * EmbeddableForm — Standalone form for external data collection.
 *
 * Can be rendered at a public URL (e.g., `/forms/:formId`) without auth.
 * Submissions create records in the specified object via DataSource.
 */
export const EmbeddableForm: React.FC<EmbeddableFormProps> = ({
  config,
  dataSource,
  prefillParams,
  className,
}) => {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState<boolean>(
    !(config.consent?.required ?? !!config.consent),
  );
  const [consentError, setConsentError] = useState<string | null>(null);

  // The accepted thank-you destination, together with the delay declared for
  // it, held from the moment the write succeeds until the wait below elapses
  // (objectui#5049).
  //
  // The wait used to be a bare `setTimeout` armed inside the submit handler:
  // nothing stored the handle and nothing cleared it, so a full-page navigation
  // stayed pending for the whole delay and OUTLIVED this component. With the
  // default delay that window is 3 seconds on every submit, not an edge
  // authoring. Recording the destination here hands the wait to the effect
  // below, which owns it for exactly as long as this component is mounted and
  // for exactly as long as the destination stands.
  //
  // The delay travels WITH the destination rather than being re-read from
  // `config.thankYouPage` at wait time: the value honoured is the one declared
  // when the write was accepted, so a host re-rendering with a different
  // `redirectDelay` mid-wait cannot restart the pause under the submitter.
  const [pendingRedirect, setPendingRedirect] = useState<PendingThankYouRedirect | null>(null);

  // Whether the guard below refused the authored destination (objectui#5073).
  //
  // Held apart from `error` on purpose. The refusal used to be recorded as
  // `setError(texts.redirectBlocked ?? null)`, but the error banner lives in the
  // form branch and `setSubmitted(true)` has already run one statement earlier —
  // so that assignment, the only one of that key anywhere, could never reach a
  // screen in any locale. This flag is read by the thank-you panel, which is the
  // screen the submitter is actually looking at when a redirect is refused.
  //
  // A fact, not a copy of the string: the panel's other copy is read from
  // `config.texts` at render time, and the author's `redirectBlocked` wording is
  // read the same way. Only `pendingRedirect` captures its value at accept time,
  // and for a reason that does not apply here — it feeds a running timer.
  const [redirectRefused, setRedirectRefused] = useState(false);

  const honeypotRef = useRef<HTMLInputElement | null>(null);
  // Seeded lazily by the mount effect below — Date.now() is impure and must not
  // run during render. The effect always overwrites this before any submit.
  const mountedAtRef = useRef<number>(0);
  useEffect(() => {
    // Reset the mount timestamp whenever the form returns from the thank-you
    // screen so anti-bot timing measures the next interaction, not the first.
    if (!submitted) mountedAtRef.current = Date.now();
  }, [submitted]);

  // The delayed leg of a thank-you redirect: the wait, and who travels at the
  // end of it (`thankYouRedirectNavigation.ts`).
  //
  // Which destinations are followed and which are refused is decided before a
  // destination ever reaches this state (`isRedirectUrlSafe` in the submit
  // handler); nothing downstream re-judges a URL, and the seam is never a route
  // around that verdict. What the hook owns is the wait — unmounting, or
  // dropping the destination, cancels it (objectui#5049) — and the arm split
  // objectui#5112 added on top of it: an app-relative destination goes through
  // the host's injected navigate when a host supplied one, so a mounted host
  // keeps the submitter inside the application, while an external destination
  // admitted by `allowedRedirectHosts` stays a browser-level navigation
  // unconditionally.
  useThankYouRedirectNavigation(pendingRedirect);

  // The ticking half of the same promise: "Redirecting in {{seconds}}
  // seconds…" is documented, in all ten locale packs, as counting down the
  // REMAINING wait — not a number frozen at the instant the panel first
  // paints (objectui#5083). Owned the same way as the wait above: an effect
  // keyed on `pendingRedirect`, cancelled on unmount and on `handleReset`
  // dropping the destination (`thankYouRedirectCountdown.ts`).
  const remainingRedirectSeconds = useRedirectCountdownSeconds(pendingRedirect);

  const honeypotName = config.honeypot === false ? null : config.honeypot || DEFAULT_HONEYPOT_NAME;
  const minFillTime = config.minFillTime ?? DEFAULT_MIN_FILL_MS;

  // Apply hardened default max-length caps before the form ever sees the spec.
  const safeCustomFields = useMemo(
    () => applyDefaultMaxLengths(config.customFields),
    [config.customFields],
  );

  // When config provides a `fields: string[]` list (the public-form path),
  // ObjectForm needs `dataSource.getObjectSchema()` to render the inputs. We
  // pass a read-only wrapper that exposes schema lookup but neutralises any
  // mutating ops so EmbeddableForm's security gates remain the *only* path
  // to the backend (no double-write, no bypassed consent/honeypot checks).
  const formDataSource = useMemo(() => {
    if (!dataSource) return undefined;
    if (safeCustomFields && safeCustomFields.length > 0) return undefined;
    if (!config.fields || config.fields.length === 0) return undefined;
    const stub = async (_name: string, data: Record<string, unknown>) => data;
    return {
      ...dataSource,
      create: stub,
      update: (_n: string, _id: string, data: Record<string, unknown>) => Promise.resolve(data),
      delete: () => Promise.reject(new Error('Not permitted on public form')),
    } as typeof dataSource;
  }, [dataSource, safeCustomFields, config.fields]);

  // Build initial data — URL prefill is gated by an explicit field whitelist.
  const initialData = useMemo(() => {
    const data: Record<string, string> = {};
    // Explicit prefillParams (set programmatically by the host) bypass the
    // URL whitelist — they're trusted by definition.
    if (prefillParams) {
      for (const [key, value] of Object.entries(prefillParams)) {
        data[key] = value;
      }
    }
    if (typeof window !== 'undefined' && config.allowedPrefillFields?.length) {
      const allowed = new Set(config.allowedPrefillFields);
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.forEach((value, key) => {
        if (allowed.has(key) && !(key in data)) {
          data[key] = value;
        }
      });
    }
    return Object.keys(data).length > 0 ? data : undefined;
  }, [prefillParams, config.allowedPrefillFields]);

  const handleSubmit = useCallback(
    async (formData: Record<string, any>) => {
      // 0. Consent gate
      if (config.consent?.required && !consentAccepted) {
        setConsentError(config.texts?.consentRequired ?? 'Please accept the privacy policy to continue.');
        return;
      }
      setConsentError(null);

      // 1. Honeypot — silently accept and fake success without calling backend
      if (honeypotName && honeypotRef.current?.value) {
        setSubmitted(true);
        return;
      }

      // 2. Min-fill-time — softly reject (shows the "review your answers" hint)
      if (minFillTime > 0 && Date.now() - mountedAtRef.current < minFillTime) {
        setError(config.texts?.rateLimited ?? 'Please take a moment to review your answers before submitting.');
        return;
      }

      // Strip the honeypot from the outgoing payload defensively, even if the
      // current ObjectForm shouldn't carry it.
      const payload: Record<string, any> = { ...formData };
      if (honeypotName) delete payload[honeypotName];
      if (config.captchaToken) payload._captcha = config.captchaToken;

      setSubmitting(true);
      setError(null);

      try {
        if (dataSource) {
          await dataSource.create(config.objectName, payload);
        }
        setSubmitted(true);

        // Handle redirect after delay — guarded against open-redirect abuse
        const rawRedirect = config.thankYouPage?.redirectUrl;
        if (rawRedirect) {
          if (isRedirectUrlSafe(rawRedirect, config.allowedRedirectHosts)) {
            const delay = config.thankYouPage?.redirectDelay ?? 3000;
            // Record the destination; the effect that owns the wait takes it
            // from here (objectui#5049). This arm still decides WHETHER to
            // navigate — the guard above is untouched — only no longer WHEN,
            // because a timer armed here answered to nobody.
            setPendingRedirect({ url: rawRedirect, delayMs: delay });
          } else {
            console.warn('[EmbeddableForm] Blocked unsafe redirect target:', rawRedirect);
            // The author keeps their console channel; the submitter gets the
            // panel to match the verdict (objectui#5073). Nothing here re-judges
            // the URL — `isRedirectUrlSafe` and `allowedRedirectHosts` are
            // untouched; only the record of what they decided is now readable
            // where the copy is rendered.
            setRedirectRefused(true);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit form. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [dataSource, config, consentAccepted, honeypotName, minFillTime],
  );

  const handleReset = useCallback(() => {
    setSubmitted(false);
    setError(null);
    // "Submit Another Response" cancels a pending thank-you redirect
    // (objectui#5049). The button offers the submitter a fresh form; that offer
    // and throwing the whole page away a moment later cannot both be honoured,
    // and the one the submitter just chose is the form. Dropping the
    // destination re-runs the effect above, whose cleanup clears the timer —
    // the cancellation is done by that `clearTimeout`, not by this line alone.
    setPendingRedirect(null);
    // This is the only route back to the form, so it is also the only place the
    // refusal has to be forgotten: a later submit that IS accepted must not
    // inherit the previous attempt's refusal notice next to its countdown.
    setRedirectRefused(false);
  }, []);

  // Branding styles
  const brandingStyle = useMemo(() => {
    const style: React.CSSProperties = {};
    if (config.branding?.backgroundColor) {
      style.backgroundColor = config.branding.backgroundColor;
    }
    return style;
  }, [config.branding]);

  // Thank you page
  if (submitted) {
    const thankYou = config.thankYouPage;
    const texts = config.texts ?? {};
    // The countdown describes the destination that was ACCEPTED, not the one
    // that was authored (objectui#5073). Keyed on `thankYou?.redirectUrl`, this
    // line told a submitter `Redirecting in 3 seconds…` even when the guard in
    // the submit handler had just refused that destination — on the terminal
    // screen of a public form, where nothing comes after to correct it.
    //
    // Reading the delay off `pendingRedirect` rather than re-deriving it from
    // `config.thankYouPage` also leaves exactly one default for it (the `?? 3000`
    // in the submit handler): the seconds displayed are the seconds being
    // served, and a host that re-renders with a different `redirectDelay`
    // mid-wait cannot make the two disagree.
    //
    // The number itself now TICKS (objectui#5083): `remainingRedirectSeconds`
    // is owned by the effect above, counting down once per second rather than
    // being computed once from `pendingRedirect.delayMs` and left to go stale
    // for the whole wait.
    const redirectingText = pendingRedirect && remainingRedirectSeconds !== null
      ? (texts.redirecting ?? 'Redirecting in {{seconds}} seconds…').replace(
          '{{seconds}}',
          String(remainingRedirectSeconds),
        )
      : null;
    return (
      <div
        className={`min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-muted/40 via-background to-background ${className || ''}`}
        style={brandingStyle}
      >
        <div className="max-w-md w-full bg-card border rounded-xl shadow-sm p-8 text-center space-y-4">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            {thankYou?.title || texts.thankYouTitle || 'Thank You!'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {thankYou?.message || texts.thankYouMessage || 'Your submission has been received successfully.'}
          </p>
          {config.allowMultiple && (
            <Button variant="outline" size="sm" onClick={handleReset} className="mt-2">
              {texts.submitAnother ?? 'Submit Another Response'}
            </Button>
          )}
          {redirectingText && (
            <p className="text-xs text-muted-foreground">{redirectingText}</p>
          )}
          {/* Refused destination: the author's own words to the public, shown
              only because the author declared them for this case. Undeclared
              means silence here — an operational message the author did not
              write is not the submitter's to read, and `console.warn` above
              already told the one person who can fix the declaration. */}
          {redirectRefused && texts.redirectBlocked && (
            <p className="text-xs text-muted-foreground">{texts.redirectBlocked}</p>
          )}
        </div>
      </div>
    );
  }

  const texts = config.texts ?? {};
  const consentRequired = !!config.consent?.required;
  const consentId = `${config.formId}-consent`;
  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 sm:p-6 bg-gradient-to-b from-muted/40 via-background to-background ${className || ''}`}
      style={brandingStyle}
    >
      <div className="max-w-2xl w-full bg-card border rounded-xl shadow-sm overflow-hidden">
        {/* Optional Airtable-style cover banner */}
        {config.branding?.coverImage && (
          <div
            className="h-28 sm:h-32 w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${JSON.stringify(config.branding.coverImage)})` }}
            role="presentation"
          />
        )}

        {/* Header */}
        <div
          className="px-6 sm:px-8 pt-7 pb-5 border-b bg-muted/20"
          style={config.branding?.primaryColor ? { borderBottomColor: config.branding.primaryColor } : undefined}
        >
          {config.branding?.logo && (
            <img src={config.branding.logo} alt="" className="h-8 mb-4" />
          )}
          {config.title && (
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {config.title}
            </h1>
          )}
          {config.description && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {config.description}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/70 mt-3" aria-hidden="true">
            {texts.requiredHint ?? '* Required field'}
          </p>
        </div>

        {/* Form body */}
        <div className="relative px-6 sm:px-8 py-6">
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <ObjectForm
            schema={{
              type: 'object-form',
              objectName: config.objectName,
              mode: 'create',
              fields: config.fields,
              customFields: safeCustomFields,
              initialData,
              onSuccess: handleSubmit,
              submitText: submitting
                ? texts.submitting ?? 'Submitting...'
                : texts.submit ?? 'Submit',
            }}
            dataSource={formDataSource}
            // NOTE: when `formDataSource` is provided (the public-form
            // `fields: string[]` path) it is a read-only wrapper whose
            // `create/update/delete` are neutralised — ObjectForm can fetch
            // the object schema to render inputs, but only EmbeddableForm's
            // own `handleSubmit` (above) ever talks to the real backend, so
            // consent / honeypot / min-fill / redirect gates always run.
          />

          {/* Honeypot — visually & a11y hidden, off-screen, no autofocus */}
          {honeypotName && (
            <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
              <label htmlFor={`${config.formId}-${honeypotName}`}>Do not fill this field</label>
              <input
                ref={honeypotRef}
                id={`${config.formId}-${honeypotName}`}
                type="text"
                name={honeypotName}
                tabIndex={-1}
                autoComplete="off"
                defaultValue=""
              />
            </div>
          )}

          {/* GDPR-style consent checkbox */}
          {config.consent && (
            <div className="mt-4">
              <label className="flex items-start gap-2 text-sm text-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  id={consentId}
                  checked={consentAccepted}
                  onChange={(e) => {
                    setConsentAccepted(e.target.checked);
                    if (e.target.checked) setConsentError(null);
                  }}
                  aria-required={consentRequired || undefined}
                  aria-invalid={consentError ? 'true' : undefined}
                  aria-describedby={consentError ? `${consentId}-error` : undefined}
                  className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                />
                <span className="leading-relaxed">
                  {config.consent.label ?? texts.consentLabelDefault ?? 'I agree to the privacy policy.'}
                  {consentRequired && (
                    <span aria-hidden="true" className="text-destructive ml-0.5">*</span>
                  )}
                  {config.consent.privacyUrl && (
                    <>
                      {' '}
                      <a
                        href={config.consent.privacyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-primary hover:opacity-80"
                      >
                        {texts.consentLink ?? 'Privacy policy'}
                      </a>
                    </>
                  )}
                </span>
              </label>
              {consentError && (
                <p
                  id={`${consentId}-error`}
                  role="alert"
                  className="mt-1.5 text-xs text-destructive"
                >
                  {consentError}
                </p>
              )}
            </div>
          )}

          {submitting && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>{texts.submitting ?? 'Submitting…'}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-8 py-4 border-t bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden="true" />
            <span>
              {texts.secureNotice ??
                'Your information is transmitted securely and only used to respond to your request.'}
            </span>
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground/80">
            {config.privacyPolicyUrl && (
              <a
                href={config.privacyPolicyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline hover:text-foreground"
              >
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {texts.consentLink ?? 'Privacy policy'}
              </a>
            )}
            <span>{texts.poweredBy ?? 'Powered by ObjectStack'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmbeddableForm;

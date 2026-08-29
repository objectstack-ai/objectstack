// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';
import type { SettingsActionHandler } from '../settings-service.types.js';

/**
 * ⚠️ This list is a CONTRACT, not a menu of aspirations: every value here must
 * be one `@objectstack/plugin-email` can actually build a transport for, and
 * every transport it can build must appear here. The two sets are held equal by
 * an executable assertion —
 * `packages/plugins/plugin-email/src/mail-manifest-providers.contract.test.ts`
 * compares these values against `EMAIL_TRANSPORT_PROVIDERS` / `makeTransport`
 * and goes red the moment they diverge, in either direction.
 *
 * Both directions had drifted (#5094): `sendgrid` and `ses` were offered here
 * with no transport behind them — selecting one validated, saved, and then
 * delivered nothing — while `resend`, which has shipped a working transport all
 * along, could not be picked at all. Neither SendGrid nor SES lost any
 * capability by being removed: both publish SMTP endpoints, so they are
 * configured through `smtp` (see the field description below), which is a
 * working route rather than a dead end.
 *
 * `log` is listed, and labelled for what it does. It is the one option that
 * does not deliver, but it does not *pretend* to: the label says so, the
 * runtime honours it (`LogTransport` records to `sys_email`), and `mail/test`
 * answers `ok: false` for it. That is the deliberate, visible opt-out
 * AGENTS.md asks a degradation to be, and it is what makes "offered" and
 * "deliverable" exactly the same set instead of merely overlapping.
 */
const PROVIDER_OPTIONS = [
  { value: 'smtp', label: 'SMTP' },
  { value: 'resend', label: 'Resend' },
  { value: 'postmark', label: 'Postmark' },
  { value: 'log', label: 'None (log only — no real delivery)' },
];

/** Providers that need `api_key` — kept in step with the `visible` expressions below. */
const API_KEY_PROVIDERS: readonly string[] = ['resend', 'postmark'];

// Visibility expressions are written as inline strings here for
// readability. The spec's ExpressionInputSchema accepts a bare string
// and normalises it at parse time, but the inferred TypeScript output
// type expects `{ dialect, source }` objects. Build the manifest as
// `unknown` first, then cast — keeps the manifest source compact.
const manifest = {
  namespace: 'mail',
  version: 1,
  label: 'Mail Delivery',
  icon: 'Mail',
  description: 'SMTP and transactional email provider configuration.',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  category: 'Communication',
  order: 10,
  specifiers: [
    { type: 'group', id: 'provider', label: 'Provider', required: false,
      description: 'Choose how this workspace sends outbound email.' },

    // See PROVIDER_OPTIONS above — the option list is a contract with
    // @objectstack/plugin-email, not a wish list.
    { type: 'select', key: 'provider', label: 'Provider', required: true, default: 'smtp',
      description: 'Only providers this server can actually deliver through are listed. '
        + 'SendGrid and Amazon SES are configured as SMTP — host smtp.sendgrid.net '
        + '(username "apikey", password = your API key), or email-smtp.<region>.amazonaws.com '
        + 'with SES SMTP credentials.',
      options: PROVIDER_OPTIONS,
    },

    { type: 'group', id: 'smtp', label: 'SMTP', required: false, visible: "${data.provider === 'smtp'}" },
    { type: 'text', key: 'smtp_host', label: 'Host', required: true,
      description: 'Example: smtp.example.com', visible: "${data.provider === 'smtp'}" },
    // ⚠️ `min`/`max` here are the SMTP port contract, and this service ENFORCES
    // them (`declaredBounds` / `validatePatch`) — so this is a real door, not a
    // decoration. Its ONE declaration lives in `@objectstack/plugin-email`
    // (`src/transports/smtp-port-contract.ts`), beside the refusal that actually
    // rejects a bad port. This is a MIRROR, not a second source: importing it
    // would add a runtime edge from a service to a plugin and invert the
    // layering, so the two are held equal by an executable cross-package
    // assertion instead — exactly as the provider list above is. See
    // `packages/plugins/plugin-email/src/transports/smtp-port-contract.test.ts`,
    // which goes red the moment these numbers stop matching the transport's
    // (#12993).
    // ⛔ Never "unify" this floor with the CLI's listen range, which floors at 0
    // (`0` = let the OS choose a port to LISTEN on). 0 is not a destination you
    // can connect to, so it is not a legal SMTP port.
    { type: 'number', key: 'smtp_port', label: 'Port', required: false, default: 587,
      min: 1, max: 65535, visible: "${data.provider === 'smtp'}" },
    { type: 'toggle', key: 'smtp_secure', label: 'Use TLS', required: false, default: true,
      visible: "${data.provider === 'smtp'}" },
    { type: 'text', key: 'smtp_user', label: 'Username', required: false,
      visible: "${data.provider === 'smtp'}" },
    { type: 'password', key: 'smtp_password', label: 'Password', required: false,
      visible: "${data.provider === 'smtp'}" },

    // Named positively — `provider !== 'smtp'` was only ever correct because
    // every non-SMTP option happened to be an HTTP API. `log` is not, and a
    // REQUIRED field is enforced server-side exactly when it is visible
    // (`SettingsService.validatePatch`), so the negative form would refuse to
    // save "None (log only)" until an API key it never uses was typed in.
    { type: 'group', id: 'api_key', label: 'API key', required: false,
      visible: "${data.provider === 'resend' || data.provider === 'postmark'}" },
    { type: 'password', key: 'api_key', label: 'API key', required: true, encrypted: true,
      visible: "${data.provider === 'resend' || data.provider === 'postmark'}" },

    { type: 'group', id: 'from_address', label: 'From address', required: false },
    { type: 'email', key: 'from_email', label: 'From email', required: true,
      description: 'Example: no-reply@example.com' },
    { type: 'text', key: 'from_name', label: 'From name', required: false, default: 'ObjectStack' },

    // Delivery mode (framework#5160). Off by default: turning it on changes
    // what `send()` returns (`queued` instead of `sent`/`failed`), so it is
    // an opt-in, never a silent upgrade.
    { type: 'group', id: 'delivery', label: 'Delivery', required: false,
      description: 'How outbound mail is handed to the provider.' },
    { type: 'toggle', key: 'queue_delivery', label: 'Durable queue delivery', required: false,
      default: false,
      description: 'Hand each message to the job queue (sys_job_queue) instead of sending it inline. '
        + 'Sends return as soon as the message is recorded, and a delivery that fails is retried with '
        + 'backoff by a worker — so it survives a restart — reaching the dead-letter queue only after the '
        + 'attempts are exhausted. Requires the queue capability with a durable adapter; without one, mail '
        + 'is still sent inline and the server logs why. "Send test email" below always sends inline, so it '
        + 'can still report the provider\'s own answer.' },

    { type: 'action_button', id: 'test', label: 'Send test email', required: false, icon: 'Send',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/mail/test' } },
  ],
};

/** Mail Delivery — SMTP / API provider configuration. */
export const mailSettingsManifest = manifest as unknown as SettingsManifest;

/** Provider values the dropdown offers — the same array the manifest renders. */
const OFFERED_PROVIDERS: readonly string[] = PROVIDER_OPTIONS.map((o) => o.value);

/**
 * Built-in FALLBACK handler for `mail/test`.
 *
 * The real one lives in `@objectstack/plugin-email`, which overrides this
 * via `registerAction` on `kernel:ready` and actually delivers a message
 * through the configured transport (same pattern as `storage/test`). This
 * fallback therefore runs only where no email plugin is mounted — it can
 * check the form, and it cannot send anything.
 *
 * So it reports `ok: false`. It previously answered `ok: true` with
 * "Configuration looks valid … Wire @objectstack/plugin-mail for actual
 * delivery": a success toast for a mail nobody sent, naming a package that
 * has never existed. An action button that says "Send test email" must
 * never report success for a send that did not happen (framework#5087).
 *
 * It also refuses a `provider` value the dropdown does not offer. Workspaces
 * that saved `sendgrid` / `ses` while those options existed still carry the
 * value (#5094), and "the form is well-formed" is the wrong answer for a
 * provider nothing can deliver through.
 */
export const mailTestActionHandler: SettingsActionHandler = async ({ values }) => {
  const provider = String(values.provider ?? 'smtp');
  const fromEmail = values.from_email as string | undefined;
  if (!fromEmail) {
    return { ok: false, severity: 'error', message: 'Configure a from address before testing.' };
  }
  if (!OFFERED_PROVIDERS.includes(provider)) {
    return {
      ok: false,
      severity: 'error',
      message: `provider='${provider}' is not a delivery provider this server supports, so NO mail is being sent `
        + `(a stored value from an older release, most likely). Fix: pick one of ${OFFERED_PROVIDERS.join(' / ')} `
        + 'in Settings → Mail → Provider and save. SendGrid and Amazon SES are configured as SMTP — '
        + 'smtp.sendgrid.net (username "apikey", password = your API key), or '
        + 'email-smtp.<region>.amazonaws.com with SES SMTP credentials.',
    };
  }
  if (provider === 'smtp' && !values.smtp_host) {
    return { ok: false, severity: 'error', message: 'SMTP host is required.' };
  }
  if (API_KEY_PROVIDERS.includes(provider) && !values.api_key) {
    return { ok: false, severity: 'error', message: 'API key is required.' };
  }
  return {
    ok: false,
    severity: 'warning',
    message: `No email service is mounted, so NO test message was sent (the form itself is well-formed, provider=${provider}). `
      + 'Add the "email" capability (@objectstack/plugin-email) to deliver mail and to make this button send a real test.',
  };
};

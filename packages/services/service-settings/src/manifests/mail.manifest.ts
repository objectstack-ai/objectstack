// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';
import type { SettingsActionHandler } from '../settings-service.types.js';

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

    { type: 'select', key: 'provider', label: 'Provider', required: true, default: 'smtp',
      options: [
        { value: 'smtp', label: 'SMTP' },
        { value: 'sendgrid', label: 'SendGrid' },
        { value: 'ses', label: 'Amazon SES' },
        { value: 'postmark', label: 'Postmark' },
      ],
    },

    { type: 'group', id: 'smtp', label: 'SMTP', required: false, visible: "${data.provider === 'smtp'}" },
    { type: 'text', key: 'smtp_host', label: 'Host', required: true,
      description: 'Example: smtp.example.com', visible: "${data.provider === 'smtp'}" },
    { type: 'number', key: 'smtp_port', label: 'Port', required: false, default: 587,
      min: 1, max: 65535, visible: "${data.provider === 'smtp'}" },
    { type: 'toggle', key: 'smtp_secure', label: 'Use TLS', required: false, default: true,
      visible: "${data.provider === 'smtp'}" },
    { type: 'text', key: 'smtp_user', label: 'Username', required: false,
      visible: "${data.provider === 'smtp'}" },
    { type: 'password', key: 'smtp_password', label: 'Password', required: false,
      visible: "${data.provider === 'smtp'}" },

    { type: 'group', id: 'api_key', label: 'API key', required: false, visible: "${data.provider !== 'smtp'}" },
    { type: 'password', key: 'api_key', label: 'API key', required: true, encrypted: true,
      visible: "${data.provider !== 'smtp'}" },

    { type: 'group', id: 'from_address', label: 'From address', required: false },
    { type: 'email', key: 'from_email', label: 'From email', required: true,
      description: 'Example: no-reply@example.com' },
    { type: 'text', key: 'from_name', label: 'From name', required: false, default: 'ObjectStack' },

    { type: 'action_button', id: 'test', label: 'Send test email', required: false, icon: 'Send',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/mail/test' } },
  ],
};

/** Mail Delivery — SMTP / API provider configuration. */
export const mailSettingsManifest = manifest as unknown as SettingsManifest;

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
 */
export const mailTestActionHandler: SettingsActionHandler = async ({ values }) => {
  const provider = String(values.provider ?? 'smtp');
  const fromEmail = values.from_email as string | undefined;
  if (!fromEmail) {
    return { ok: false, severity: 'error', message: 'Configure a from address before testing.' };
  }
  if (provider === 'smtp' && !values.smtp_host) {
    return { ok: false, severity: 'error', message: 'SMTP host is required.' };
  }
  if (provider !== 'smtp' && !values.api_key) {
    return { ok: false, severity: 'error', message: 'API key is required.' };
  }
  return {
    ok: false,
    severity: 'warning',
    message: `No email service is mounted, so NO test message was sent (the form itself is well-formed, provider=${provider}). `
      + 'Add the "email" capability (@objectstack/plugin-email) to deliver mail and to make this button send a real test.',
  };
};

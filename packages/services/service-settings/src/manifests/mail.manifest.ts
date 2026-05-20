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
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
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

/** Built-in action handler stub for `mail/test`. */
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
    ok: true,
    severity: 'info',
    message: `Configuration looks valid (provider=${provider}). Wire @objectstack/plugin-mail for actual delivery.`,
  };
};

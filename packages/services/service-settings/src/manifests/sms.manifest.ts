// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';
import type { SettingsActionHandler } from '../settings-service.types.js';

// Visibility expressions are written as inline strings here for
// readability (same pattern as mail.manifest.ts) — build as `unknown`,
// then cast.
const manifest = {
  namespace: 'sms',
  version: 1,
  label: 'SMS Delivery',
  icon: 'MessageSquare',
  description: 'SMS provider configuration for OTP sign-in, invitations and notifications.',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  category: 'Communication',
  order: 11,
  specifiers: [
    { type: 'group', id: 'provider', label: 'Provider', required: false,
      description: 'Choose how this workspace sends outbound SMS.' },

    // ⚠️ This options table is a CONTRACT, not a menu of aspirations: every
    // value here must be one `@objectstack/service-sms` can actually build a
    // transport for, and every transport it can build must appear here. The two
    // sets are held equal by an executable assertion —
    // `packages/services/service-sms/src/sms-manifest-providers.contract.test.ts`
    // compares these values against `SMS_TRANSPORT_PROVIDERS` / `makeSmsTransport`
    // and goes red the moment they diverge, in either direction, naming the
    // value that drifted.
    //
    // Adding an option without a transport is not a harmless placeholder: the
    // form validates, the save succeeds, and every send is silently downgraded
    // to `LogSmsTransport` — a workspace that reports `status: 'sent'` and
    // delivers nothing. That is exactly what mail shipped before #5094
    // (`sendgrid` / `ses` offered with nothing behind them, while `resend` had a
    // working transport nobody could pick), and what `os serve` did with an
    // out-of-table `OS_SMS_PROVIDER` before #5713.
    //
    // `log` is listed and labelled for what it does. It is the one option that
    // does not deliver, but it does not *pretend* to — which is what makes
    // "offered" and "deliverable" the same set rather than merely overlapping.
    { type: 'select', key: 'provider', label: 'Provider', required: true, default: 'log',
      options: [
        { value: 'log', label: 'None (log only — no real delivery)' },
        { value: 'aliyun', label: 'Aliyun SMS (阿里云短信)' },
        { value: 'twilio', label: 'Twilio' },
      ],
    },

    { type: 'group', id: 'aliyun', label: 'Aliyun SMS', required: false, visible: "${data.provider === 'aliyun'}" },
    { type: 'text', key: 'aliyun_access_key_id', label: 'AccessKey ID', required: true,
      visible: "${data.provider === 'aliyun'}" },
    { type: 'password', key: 'aliyun_access_key_secret', label: 'AccessKey Secret', required: true, encrypted: true,
      visible: "${data.provider === 'aliyun'}" },
    { type: 'text', key: 'aliyun_sign_name', label: 'Sign name (短信签名)', required: true,
      visible: "${data.provider === 'aliyun'}" },
    { type: 'text', key: 'aliyun_template_code', label: 'Default template code (短信模板)', required: false,
      description: 'Used when a send carries no explicit template. A catch-all template with a single ${content} variable enables generic notification SMS.',
      visible: "${data.provider === 'aliyun'}" },

    { type: 'group', id: 'twilio', label: 'Twilio', required: false, visible: "${data.provider === 'twilio'}" },
    { type: 'text', key: 'twilio_account_sid', label: 'Account SID', required: true,
      visible: "${data.provider === 'twilio'}" },
    { type: 'password', key: 'twilio_auth_token', label: 'Auth token', required: true, encrypted: true,
      visible: "${data.provider === 'twilio'}" },
    { type: 'text', key: 'twilio_from_number', label: 'From number', required: false,
      description: 'E.164 sender, e.g. +15005550006. Either this or a Messaging Service SID.',
      visible: "${data.provider === 'twilio'}" },
    { type: 'text', key: 'twilio_messaging_service_sid', label: 'Messaging Service SID', required: false,
      visible: "${data.provider === 'twilio'}" },

    { type: 'group', id: 'limits', label: 'Spend limits', required: false,
      description: 'Caps the deployment’s outbound SMS volume. SMS is a paid channel and every send costs real money.' },
    { type: 'number', key: 'daily_quota', label: 'Daily send limit', required: false, default: 0, min: 0,
      description: 'Maximum SMS this deployment may send per UTC day, across OTP sign-in, invitations and notifications. 0 means no limit. Sends beyond the limit are refused until 00:00 UTC.' },

    { type: 'action_button', id: 'test', label: 'Send test SMS', required: false, icon: 'Send',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/sms/test' } },
  ],
};

/** SMS Delivery — provider configuration (#2780). */
export const smsSettingsManifest = manifest as unknown as SettingsManifest;

/**
 * Built-in action handler stub for `sms/test` — configuration shape check
 * only. SmsServicePlugin overrides it with a real send when installed
 * (mirrors mail/test).
 */
export const smsTestActionHandler: SettingsActionHandler = async ({ values }) => {
  const provider = String(values.provider ?? 'log');
  if (provider === 'aliyun') {
    if (!values.aliyun_access_key_id || !values.aliyun_access_key_secret || !values.aliyun_sign_name) {
      return { ok: false, severity: 'error', message: 'Aliyun SMS requires AccessKey ID, AccessKey Secret and a sign name.' };
    }
  } else if (provider === 'twilio') {
    if (!values.twilio_account_sid || !values.twilio_auth_token) {
      return { ok: false, severity: 'error', message: 'Twilio requires an Account SID and auth token.' };
    }
    if (!values.twilio_from_number && !values.twilio_messaging_service_sid) {
      return { ok: false, severity: 'error', message: 'Twilio requires a From number or a Messaging Service SID.' };
    }
  }
  return {
    ok: true,
    severity: 'info',
    message: `Configuration looks valid (provider=${provider}). Wire @objectstack/service-sms for actual delivery.`,
  };
};

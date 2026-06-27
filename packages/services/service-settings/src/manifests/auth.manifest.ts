// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

// Open-source auth settings intentionally stay small: platform-wide auth
// policy toggles plus the baseline Google social-login provider.
const manifest = {
  namespace: 'auth',
  version: 1,
  label: 'Authentication',
  icon: 'LockKeyhole',
  description: 'Sign-in, registration, and built-in auth feature controls.',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  category: 'Security',
  order: 15,
  specifiers: [
    {
      type: 'group',
      id: 'email_password',
      label: 'Email and password',
      required: false,
      description: 'Control local email/password sign-in and self-service registration.',
    },
    {
      type: 'toggle',
      key: 'email_password_enabled',
      label: 'Enable email/password login',
      required: false,
      default: true,
    },
    {
      type: 'toggle',
      key: 'signup_enabled',
      label: 'Allow self-service registration',
      required: false,
      default: true,
      visible: "${data.email_password_enabled !== false}",
    },
    {
      type: 'toggle',
      key: 'require_email_verification',
      label: 'Require email verification',
      required: false,
      default: false,
      visible: "${data.email_password_enabled !== false}",
    },

    {
      type: 'group',
      id: 'password_policy',
      label: 'Password policy',
      required: false,
      description: 'Length bounds enforced by the auth provider on sign-up and password reset.',
    },
    {
      type: 'number',
      key: 'password_min_length',
      label: 'Minimum password length',
      required: false,
      default: 8,
      min: 6,
      max: 64,
      visible: "${data.email_password_enabled !== false}",
    },
    {
      type: 'number',
      key: 'password_max_length',
      label: 'Maximum password length',
      required: false,
      default: 128,
      min: 16,
      max: 256,
      description: 'Upper bound guards against denial-of-service via very long password hashing.',
      visible: "${data.email_password_enabled !== false}",
    },
    {
      type: 'toggle',
      key: 'password_reject_breached',
      label: 'Reject breached passwords',
      required: false,
      default: false,
      description:
        'Block passwords found in public breach corpora via Have I Been Pwned (k-anonymity range check; the password is never sent in full).',
      visible: "${data.email_password_enabled !== false}",
    },

    {
      type: 'group',
      id: 'sessions',
      label: 'Sessions',
      required: false,
      description: 'How long a signed-in session stays valid.',
    },
    {
      type: 'number',
      key: 'session_expiry_days',
      label: 'Session lifetime (days)',
      required: false,
      default: 7,
      min: 1,
      max: 365,
      description: 'A session expires this many days after sign-in.',
    },
    {
      type: 'number',
      key: 'session_refresh_days',
      label: 'Refresh threshold (days)',
      required: false,
      default: 1,
      min: 1,
      max: 90,
      description: 'An active session is extended when it is older than this.',
    },

    {
      type: 'group',
      id: 'social',
      label: 'Social sign-in',
      required: false,
      description:
        'Configure the built-in Google sign-in provider. Deployment env vars still win.',
    },
    {
      type: 'toggle',
      key: 'google_enabled',
      label: 'Enable Google login',
      required: false,
      default: true,
      description:
        'Requires a Google OAuth client ID and secret from Google Cloud Console.',
    },
    {
      type: 'text',
      key: 'google_client_id',
      label: 'Google client ID',
      required: true,
      description:
        'OAuth client ID from Google Cloud Console. GOOGLE_CLIENT_ID can also be set on the server.',
      visible: "${data.google_enabled !== false}",
    },
    {
      type: 'password',
      key: 'google_client_secret',
      label: 'Google client secret',
      required: true,
      encrypted: true,
      description:
        'Stored encrypted at rest. GOOGLE_CLIENT_SECRET can also be set on the server.',
      visible: "${data.google_enabled !== false}",
    },

  ],
};

/** Authentication - sign-in, registration, and built-in auth controls. */
export const authSettingsManifest = manifest as unknown as SettingsManifest;

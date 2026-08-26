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

    // ADR-0093 D1 — deliberately its OWN group, not a member of
    // `email_password`: membership is decided for EVERY creation path (email
    // sign-up, SSO just-in-time provisioning, admin create-user, bulk import),
    // so hiding it behind `email_password_enabled` would leave an SSO-only
    // deployment unable to configure the one posture it most needs.
    {
      type: 'group',
      id: 'membership',
      label: 'Membership',
      required: false,
      description: 'What a newly created user joins. Pairs with self-service registration above.',
    },
    {
      type: 'select',
      key: 'membership_policy',
      label: 'New user membership',
      required: false,
      default: 'auto',
      options: [
        { value: 'auto', label: 'Join the default organization automatically' },
        { value: 'invite-only', label: 'Invitation only — never join automatically' },
      ],
      description:
        'Automatic binds every new user to this deployment\'s default organization. Invitation only grants membership solely through an explicit act — creating a workspace, accepting an invitation, being added by an admin, or SSO just-in-time provisioning. Applies to the backfill of pre-existing member-less users too.',
    },

    // [#11768] Audience posture (#11739, epic #11723) — who may BECOME a user
    // of this environment's apps. Like `membership` above, deliberately its
    // OWN group and never gated on `email_password_enabled`: the posture
    // judges every self-serve creation path (email sign-up AND social-provider
    // OAuth), so a social-login-only deployment still needs the switch. The
    // three keys are ONE atomic declaration — `bindAuthSettings` writes the
    // full audience object in one stroke (the #11767 contract: the patch
    // replaces the whole object and validates the MERGED result), so the
    // domain list and permission set only apply together with an explicitly
    // selected posture.
    {
      type: 'group',
      id: 'audience',
      label: 'Audience',
      required: false,
      description:
        'Who may become a user of this environment\'s apps. Postures other than invitation-only force email verification on. Invitations, admin-created users, SCIM provisioning, and enterprise SSO are admitted under every posture.',
    },
    {
      type: 'select',
      key: 'audience_posture',
      label: 'Self-registration audience',
      required: false,
      default: 'invite_only',
      options: [
        { value: 'invite_only', label: 'Invitation only — no self-registration (default)' },
        { value: 'email_domain', label: 'Allowlisted email domains only' },
        { value: 'open', label: 'Open — anyone may self-register' },
      ],
      description:
        'invite_only closes self-registration: users come into existence only through an operator-side act (invitation, admin create/import, SCIM, enterprise SSO). email_domain opens it to the allowlisted domains below. open admits anyone. Any posture other than invite_only forces email verification on and requires the self-registration permission set below.',
    },
    {
      type: 'textarea',
      key: 'audience_allowed_email_domains',
      label: 'Allowed email domains',
      required: false,
      description:
        'Bare domains, one per line or comma-separated (e.g. acme.com). Matching is exact and case-insensitive; subdomains need their own entries; no wildcards. Required (non-empty) when the audience is allowlisted email domains.',
      visible: "${data.audience_posture === 'email_domain'}",
    },
    {
      type: 'text',
      key: 'audience_self_registration_permission_set',
      label: 'Self-registration permission set',
      required: false,
      description:
        'sys_permission_set name granted to each self-registrant (declaring member_default explicitly is fine; admin_full_access is refused). Required whenever the posture permits self-registration.',
      visible: "${data.audience_posture === 'email_domain' || data.audience_posture === 'open'}",
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
      type: 'toggle',
      key: 'password_require_complexity',
      label: 'Require complex passwords',
      required: false,
      default: false,
      description:
        'Require passwords to mix character classes (uppercase, lowercase, digits, symbols) on sign-up and password change/reset.',
      visible: "${data.email_password_enabled !== false}",
    },
    {
      type: 'number',
      key: 'password_min_classes',
      label: 'Minimum character classes',
      required: false,
      default: 3,
      min: 1,
      max: 4,
      description: 'How many of the four classes (upper / lower / digit / symbol) a password must include.',
      visible: "${data.email_password_enabled !== false && data.password_require_complexity === true}",
    },
    {
      type: 'number',
      key: 'password_history_count',
      label: 'Password history (no reuse)',
      required: false,
      default: 0,
      min: 0,
      max: 24,
      description: 'Block reusing this many previous passwords on change/reset. 0 disables the check.',
      visible: "${data.email_password_enabled !== false}",
    },
    {
      type: 'number',
      key: 'password_expiry_days',
      label: 'Password expiry (days)',
      required: false,
      default: 0,
      min: 0,
      max: 3650,
      description: 'Force a password change after this many days. 0 disables expiry. While expired, the user is blocked from data until they change their password.',
      visible: "${data.email_password_enabled !== false}",
    },

    {
      type: 'group',
      id: 'anti_abuse',
      label: 'Anti-abuse',
      required: false,
      description:
        'Brute-force protection: per-identity account lockout and per-IP rate limiting on auth endpoints.',
    },
    // [#3690] The threshold/duration pair governs BOTH sign-in stages — the
    // password check and the second factor. Always visible: two-factor
    // verification exists in passwordless deployments too, so gating these on
    // `email_password_enabled` would leave the 2FA lockout untunable there.
    {
      type: 'number',
      key: 'lockout_threshold',
      label: 'Account lockout threshold',
      required: false,
      default: 0,
      min: 0,
      max: 20,
      description:
        'Lock an account after this many consecutive failed sign-in attempts — wrong passwords and wrong two-factor codes alike. While locked, sign-in is rejected even with the correct credentials. 0 disables the password-stage lockout; two-factor verification then keeps its built-in limit of 10 attempts per 15 minutes, since it is the last check before a session is issued.',
    },
    {
      type: 'number',
      key: 'lockout_duration_minutes',
      label: 'Lockout duration (minutes)',
      required: false,
      default: 15,
      min: 1,
      max: 1440,
      description: 'How long an account stays locked once the threshold is crossed, at either sign-in stage.',
      visible: '${data.lockout_threshold > 0}',
    },
    {
      type: 'number',
      key: 'rate_limit_max',
      label: 'Auth rate-limit: max requests',
      required: false,
      default: 10,
      min: 1,
      max: 1000,
      description: 'Maximum requests per IP, per window, to the sign-in / sign-up / password-reset endpoints.',
    },
    {
      type: 'number',
      key: 'rate_limit_window_seconds',
      label: 'Auth rate-limit: window (seconds)',
      required: false,
      default: 60,
      min: 1,
      max: 3600,
      description: 'Sliding window over which the request cap above is counted.',
    },
    {
      type: 'group',
      id: 'multi_factor',
      label: 'Multi-factor',
      required: false,
      description: 'Require members to protect their account with an authenticator app (TOTP).',
    },
    {
      type: 'toggle',
      key: 'mfa_required',
      label: 'Require multi-factor authentication',
      required: false,
      default: false,
      description:
        'Users without an authenticator enrolled are blocked from data once their grace period ends. Enabling this also turns on the two-factor feature so users can enroll.',
      visible: "${data.email_password_enabled !== false}",
    },
    {
      type: 'number',
      key: 'mfa_grace_period_days',
      label: 'MFA grace period (days)',
      required: false,
      default: 7,
      min: 0,
      max: 90,
      description: 'How long users may defer enrollment before the hard block. 0 blocks immediately.',
      visible: "${data.mfa_required === true}",
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
      type: 'number',
      key: 'session_idle_timeout_minutes',
      label: 'Idle timeout (minutes)',
      required: false,
      default: 0,
      min: 0,
      max: 10080,
      description: 'Sign a user out after this many minutes of inactivity. 0 disables.',
    },
    {
      type: 'number',
      key: 'session_absolute_max_hours',
      label: 'Absolute session lifetime (hours)',
      required: false,
      default: 0,
      min: 0,
      max: 8760,
      description: 'Force re-authentication this many hours after sign-in, regardless of activity. 0 disables.',
    },
    {
      type: 'number',
      key: 'max_concurrent_sessions_per_user',
      label: 'Max concurrent sessions per user',
      required: false,
      default: 0,
      min: 0,
      max: 100,
      description: 'Cap simultaneous signed-in sessions per user; the oldest are signed out past the cap. 0 = unlimited.',
    },

    {
      type: 'group',
      id: 'network',
      label: 'Network',
      required: false,
      description: 'Restrict where users can authenticate from.',
    },
    {
      type: 'textarea',
      key: 'allowed_ip_ranges',
      label: 'Allowed IP ranges',
      required: false,
      description:
        'CIDR ranges or exact IPs (one per line, or comma-separated), e.g. 203.0.113.0/24. When set, sign-in from outside these ranges is rejected. Empty = no restriction. Requires a trusted proxy to set X-Forwarded-For.',
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

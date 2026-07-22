// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_device_code — System Device Authorization Code Object
 *
 * Stores pending RFC 8628 OAuth Device Authorization Grant requests.
 * Backed by better-auth's `device-authorization` plugin (`deviceCode` model).
 *
 * Lifecycle:
 *   1. CLI calls `POST /device/code` → row inserted with status='pending'
 *   2. Browser visits `verification_uri_complete` and the signed-in user
 *      calls `POST /device/approve` (or `/device/deny`) → status flips
 *   3. CLI's next `POST /device/token` poll either receives a session token
 *      (status=approved) or one of the standard error codes
 *      (`authorization_pending`, `slow_down`, `expired_token`,
 *      `access_denied`). Approved rows are deleted on token issuance.
 *
 * @namespace sys
 */
export const SysDeviceCode = ObjectSchema.create({
  name: 'sys_device_code',
  label: 'Device Code',
  pluralLabel: 'Device Codes',
  icon: 'key-round',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0057: device codes are dead the moment `expires_at` passes — keep a
  // 1d grace for post-mortem, then reap.
  lifecycle: {
    class: 'transient',
    ttl: { field: 'expires_at', expireAfter: '1d' },
  },
  // [ADR-0066 D2/④] Secure-by-default: rows are LIVE pending device-grant
  // codes — reading `user_code`/`device_code` lets an attacker hijack a
  // pending CLI login. Not covered by the wildcard `'*'` grant; admins retain
  // access via the superuser bypass; better-auth reads via its adapter
  // (system context), so the device-grant flow is unaffected.
  access: { default: 'private' },
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'OAuth 2.0 Device Authorization Grant (RFC 8628) pending requests',
  nameField: 'user_code', // [ADR-0079] canonical primary-title pointer (single-field titleFormat)
  titleFormat: '{user_code}',
  highlightFields: ['user_code', 'status', 'client_id', 'expires_at'],

  fields: {
    id: Field.text({
      label: 'Device Code ID',
      required: true,
      readonly: true,
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    /** High-entropy token returned to the device (CLI). Polled at /device/token. */
    device_code: Field.text({
      label: 'Device Code',
      required: true,
      description: 'High-entropy token returned to the polling device',
    }),

    /** Human-readable short code displayed to the user (e.g. ABCD-EFGH). */
    user_code: Field.text({
      label: 'User Code',
      required: true,
      description: 'Short user-facing code (e.g. ABCD-EFGH)',
    }),

    /** Owning user — populated when the request is approved. */
    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: false,
      description: 'User who approved the device authorization',
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
      description: 'When the device & user codes are no longer valid',
    }),

    /** 'pending' | 'approved' | 'denied' */
    status: Field.text({
      label: 'Status',
      required: true,
      description: "Current status: 'pending' | 'approved' | 'denied'",
    }),

    last_polled_at: Field.datetime({
      label: 'Last Polled At',
      required: false,
      description: 'Timestamp of the most recent /device/token poll',
    }),

    polling_interval: Field.number({
      label: 'Polling Interval (ms)',
      required: false,
      description: 'Server-recommended minimum polling interval, in ms',
    }),

    client_id: Field.text({
      label: 'Client ID',
      required: false,
      description: 'OAuth client identifier of the requesting device',
    }),

    scope: Field.text({
      label: 'Scope',
      required: false,
      description: 'Space-separated OAuth scopes requested by the device',
    }),
  },

  indexes: [
    { fields: ['device_code'], unique: true },
    { fields: ['user_code'], unique: true },
    { fields: ['status'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // #1591 — reads only: writes are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth. HTTP answers 405 before the 403.
    apiMethods: ['get'],
  },
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

/**
 * `lifecycle` settings namespace (ADR-0057 P4 — governance).
 *
 * Registered by ObjectQLPlugin at kernel:ready when a SettingsService is
 * present. Every value follows the standard cascade (OS_LIFECYCLE_* env >
 * global > tenant > default), which is exactly ADR-0057 §3.2's "regulated
 * tenants set years; dev sets days — the same knob at different settings":
 * `retention_overrides` is tenant-scoped, so one deployment can carry both.
 */
export const lifecycleSettingsManifest = {
  namespace: 'lifecycle',
  version: 1,
  label: 'Data Lifecycle',
  icon: 'Timer',
  description:
    'How long system data is kept: override retention windows, cap row counts ' +
    'per table, and get alerted when a table grows unexpectedly. The platform ' +
    'applies these on its periodic cleanup sweep.',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  category: 'Infrastructure',
  order: 40,
  specifiers: [
    {
      type: 'toggle',
      key: 'enabled',
      label: 'Enforce lifecycle policies',
      required: false,
      default: true,
      description:
        'Master switch for the periodic sweep. Off = declared retention/ttl/rotation policies stop being enforced (data grows unbounded again).',
    },
    {
      type: 'json',
      key: 'retention_overrides',
      label: 'Retention overrides',
      required: false,
      scope: 'tenant',
      default: {},
      description:
        'Per-object window overrides: { "<object>": { "maxAge": "1y", "expireAfter": "30d" } }. ' +
        'Durations use h/d/w/y. Set per organization, so a regulated organization can keep years while a development one keeps days. ' +
        'An override shorter than the minimum a platform feature needs (for example the job queue\'s duplicate-detection window) ' +
        'is ignored and logged as an error, and the default window keeps applying.',
    },
    {
      type: 'json',
      key: 'quotas',
      label: 'Row quotas',
      required: false,
      default: {},
      description:
        'Per-object max row counts: { "<object>": 1000000 }. A breach raises a governance alert — quotas never delete beyond the declared policy.',
    },
    {
      type: 'json',
      key: 'quota_defaults',
      label: 'Per-class quota defaults',
      required: false,
      default: {},
      description: 'Fallback quotas by lifecycle class: { "telemetry": 1000000, "transient": 500000, "event": 100000, "audit": 5000000 }.',
    },
    {
      type: 'number',
      key: 'growth_alert_rows',
      label: 'Growth alert threshold (rows per sweep)',
      required: false,
      default: 0,
      description:
        'Alert when a lifecycle-declared table grows by more than this many rows between two sweeps. 0 disables growth alerts.',
    },
  ],
} as unknown as SettingsManifest;

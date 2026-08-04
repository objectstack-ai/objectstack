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
    'Governance for ADR-0057 data lifecycle enforcement: retention window ' +
    'overrides, per-table row quotas, and growth alerts for the platform ' +
    'LifecycleService (Reaper / Rotator / Archiver).',
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
        'Duration literals: h/d/w/y. Tenant-scoped — a regulated tenant sets years while dev keeps days (ADR-0057 §3.2). ' +
        'An override BELOW a retention floor a consumer registered (e.g. the job queue\'s dedup window) is rejected at ' +
        'sweep time and logged at error — the declared window keeps running (#5195).',
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

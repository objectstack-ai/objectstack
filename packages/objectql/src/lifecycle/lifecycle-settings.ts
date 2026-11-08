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
 *
 * The three maps are `map` specifiers (#30208, ADR-0007 as amended 2026-11-08):
 * a key column, then typed value columns. Their stored shapes are the ones the
 * sweep has always read (`Record<object, { maxAge?, expireAfter? }>`,
 * `Record<object, number>`, `Record<class, number>`), unchanged. The keys each
 * admits are served at run time (`lifecycle-key-options.ts`), never listed here.
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
      type: 'map',
      key: 'retention_overrides',
      label: 'Retention overrides',
      required: false,
      scope: 'tenant',
      default: {},
      keyColumn: { label: 'Object' },
      columns: [
        { name: 'maxAge', label: 'Keep rows for', kind: 'duration' },
        { name: 'expireAfter', label: 'Expire rows after', kind: 'duration' },
      ],
      description:
        'Per-object windows that replace the declared ones. Durations use h, d, w or y, for example 30d or 7y. ' +
        'Set per organization, so a regulated organization can keep years while a development one keeps days. ' +
        'An override shorter than the minimum a platform feature needs (for example the job queue\'s duplicate-detection window) ' +
        'is ignored and logged as an error, and the default window keeps applying.',
    },
    {
      type: 'map',
      key: 'quotas',
      label: 'Row quotas',
      required: false,
      default: {},
      keyColumn: { label: 'Object' },
      columns: [{ name: 'max_rows', label: 'Max rows', kind: 'positive_integer' }],
      description:
        'Per-object maximum row counts. A breach raises a governance alert — quotas never delete beyond the declared policy.',
    },
    {
      type: 'map',
      key: 'quota_defaults',
      label: 'Per-class quota defaults',
      required: false,
      default: {},
      keyColumn: { label: 'Lifecycle class' },
      columns: [{ name: 'max_rows', label: 'Max rows', kind: 'positive_integer' }],
      description:
        'Fallback row quotas by lifecycle class (telemetry, transient, event, audit), for objects with no quota of their own.',
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

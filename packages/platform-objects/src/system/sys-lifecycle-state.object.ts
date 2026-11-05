// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_lifecycle_state — the lifecycle sweeper's own clock state (ADR-0057).
 *
 * One row per CLOCK, keyed by a well-known id. The only clock today is the
 * ObjectQL `LifecycleService` sweep (row id `lifecycle`), which the
 * dangling-reference audit rides. The row holds when that sweep last
 * COMPLETED on this datastore, so a kernel that reboots onto an existing store
 * reads one row at the initial delay and skips a sweep the interval has not
 * yet come due for, instead of re-reading every declared object, the
 * governance settings and every audited reference within a minute of each
 * boot.
 *
 * Internal state, not a setting: ⛔ no settings key, no env override, no
 * audit row per sweep, no data API (`apiEnabled: false` below). The sole
 * writer is the sweeper itself, under a system context, after a sweep that
 * finished with no policy error; a failed or partial sweep leaves the row as
 * it was. The sole reader is the same sweeper, once per boot. A missing row,
 * a missing object (a kernel that does not compose this package) or a read
 * that fails all mean "sweep": the row can only ever save work, never
 * withhold it.
 *
 * Row identity: one row per datastore. The sweep is per store, not per
 * organization — it reaps every tenant's rows in one pass — so the row
 * describes the store it lives in, and carries no tenant column (see
 * `systemFields`).
 *
 * Lifecycle: **no `lifecycle` block on purpose.** The absent block is the
 * back-compat `record` class — never swept. Reaping the row that records the
 * sweep would only make the next boot sweep again.
 *
 * Registered by `PlatformObjectsPlugin` (`../plugin.ts`) beside the other
 * deployment-level plumbing it resembles (`sys_migration`).
 *
 * @namespace sys
 */
export const SysLifecycleState = ObjectSchema.create({
  name: 'sys_lifecycle_state',
  label: 'Lifecycle State',
  pluralLabel: 'Lifecycle States',
  icon: 'timer',
  isSystem: true,
  managedBy: 'engine-owned',
  // [ADR-0131 D7] Deployment-level state: NO tenant column. The sole writer is
  // the lifecycle sweeper, under a system context, and one sweep covers every
  // organization's rows at once, so there is no organization to stamp. Who may
  // read is object permission (D7): the platform-only capability below.
  systemFields: { tenant: false },
  requiredPermissions: ['manage_platform_settings'],
  description:
    'Lifecycle sweeper clock state: when the scheduled retention sweep last completed on this datastore. One row per clock.',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer
  highlightFields: ['id', 'last_swept_at'],

  fields: {
    id: Field.text({
      label: 'Clock ID',
      required: true,
      readonly: true,
      description: 'Well-known clock id. `lifecycle` is the ObjectQL lifecycle sweep. One row per clock.',
    }),

    last_swept_at: Field.datetime({
      label: 'Last Swept At',
      required: true,
      readonly: true,
      description:
        'When the sweep last completed with no policy error on this datastore. On a datastore the ' +
        'process created from empty it is the time the store was found empty, since no row there ' +
        'can be older.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      readonly: true,
    }),
  },

  enable: {
    trackHistory: false,
    searchable: false,
    // Internal clock state — no data API at all. The sweeper reads and writes
    // it in process, under a system context.
    apiEnabled: false,
  },
});

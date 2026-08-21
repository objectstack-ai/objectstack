// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_migration — Deployment-level data-migration flags (#3617)
 *
 * One row per DATA migration (row rewrites — distinct from the DDL ChangeSet
 * surface `os migrate plan/apply` covers), recording whether THIS deployment
 * has run it and whether its self-check passed. ObjectStack is a development
 * platform: every deployment upgrades on its own schedule and its data is
 * observable only by itself, so "the migration is done" can never be inferred
 * from the installed version — it is evidence each deployment produces by
 * running `os migrate <migration>` against its own database.
 *
 * Consumers gate on the row rather than the version, and WHICH predicate they
 * gate on depends on what they are about to do (#4797):
 *
 *  - recoverable behaviour — the strict media value-shape default (#3438),
 *    tombstoning a released file into its grace window (#3459 PR-5b) — reads
 *    `isDataMigrationFlagVerified` (verified_at set AND blocking = 0);
 *  - irreversible behaviour — the reap guard's byte delete — reads
 *    `authorisesIrreversibleAction`, which additionally requires that no
 *    deviation has been observed since the certificate was earned.
 *
 * No row / failed self-check → consumers stay in their safe legacy posture:
 * files are retained forever, lax values keep warning. Fail toward retention,
 * per deployment.
 *
 * Writes flow through `recordDataMigrationRun` (system context, from the
 * migration commands) — the API surface is read-only diagnostics. Two other
 * writers exist, both narrow: the engine's admit path, which sets
 * `deviation_observed_at` and nothing else (#4797), and the #8686 seed-tenancy
 * repair, which records its own applied runs from a boot hook against the
 * `@objectstack/spec/system` row contract rather than through the helper above
 * (#9451 — `metadata-protocol` must not take a dependency on this package).
 * That row gates nothing: it is a receipt an operator reads, so it carries
 * `verified_at: null` and `blocking: 0` by construction.
 *
 * Registered by `PlatformObjectsPlugin` (`./plugin.ts`) — the ledger is
 * platform infrastructure, present on every kernel that composes the platform
 * objects, not owned by any one consuming service (#4243; it was originally
 * registered by its first consumer, `@objectstack/service-storage`, until the
 * storage-independent consumers of #4215/#4235 arrived). The row contract
 * lives in `@objectstack/spec/system` (`DataMigrationFlagSchema`) so any
 * package can read flags without depending on this one.
 *
 * @namespace sys
 */
export const SysMigration = ObjectSchema.create({
  name: 'sys_migration',
  label: 'Data Migration',
  pluralLabel: 'Data Migrations',
  icon: 'database',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Deployment-level data-migration flags: which gated data migrations ran here and whether their self-check passed.',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{id}',
  highlightFields: ['id', 'blocking', 'verified_at', 'last_run_at'],

  fields: {
    id: Field.text({
      label: 'Migration ID',
      required: true,
      readonly: true,
      maxLength: 128,
      description: 'Well-known migration id (e.g. adr-0104-file-references). One row per migration.',
    }),

    last_run_at: Field.datetime({
      label: 'Last Run At',
      required: true,
      readonly: true,
      description: 'When this migration last completed a gated (apply-mode) run on this deployment.',
    }),

    verified_at: Field.datetime({
      label: 'Verified At',
      readonly: true,
      description:
        'When the self-check last PASSED. Null until it does, and cleared again by a later failing ' +
        'run — a regression closes the gate. Consumers require this to be set AND blocking = 0.',
    }),

    applied_at: Field.datetime({
      label: 'Applied At',
      readonly: true,
      description: 'When the backfill last ran in apply mode (writes enabled).',
    }),

    blocking: Field.number({
      label: 'Blocking Discrepancies',
      required: true,
      readonly: true,
      description: 'Blocking discrepancies reported by the last self-check. The gate requires 0.',
    }),

    advisory: Field.number({
      label: 'Advisory Findings',
      readonly: true,
      description:
        'Advisory findings from the last run (external URLs, stale owners, …) — cost storage or ' +
        'need a modelling decision, never block the gate.',
    }),

    details: Field.text({
      label: 'Details (JSON)',
      readonly: true,
      description: 'JSON-encoded counts from the last run, for diagnostics.',
    }),

    deviation_observed_at: Field.datetime({
      label: 'Deviation Observed At',
      readonly: true,
      description:
        'When this deployment last ADMITTED a value its own verified contract rejects, through an ' +
        'OS_ALLOW_LAX_* escape hatch. Deliberately does NOT clear verified_at: it withdraws only the ' +
        'irreversible half of what the certificate authorises — byte deletion stops, validation and ' +
        'tombstoning continue. Cleared by the next apply-mode run.',
    }),

    deviation_detail: Field.text({
      label: 'Deviation Detail (JSON)',
      readonly: true,
      description:
        'JSON-encoded first counterexample behind deviation_observed_at (object, field, type, parse ' +
        'issue), so an operator can find the value that closed the irreversible gate.',
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
    apiEnabled: true,
    // Diagnostic read surface only — writes go through recordDataMigrationRun
    // (system context) so the gate cannot be flipped by hand from the API.
    apiMethods: ['get', 'list'],
  },
});

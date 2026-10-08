// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import { CONVERSIONS_BY_MAJOR } from './conversions/registry';
import {
  ConnectorSchema,
  DeclarativeConnectorEntrySchema,
  type Connector,
} from './integration/connector.zod';
import { getMetadataTypeSchema } from './kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from './migrations/registry';
import { CacheWarmupSchema, DistributedCacheConfigSchema, type CacheWarmup, type DistributedCacheConfig } from './system/cache.zod';
import {
  BackupConfigSchema,
  DisasterRecoveryPlanSchema,
  type BackupConfig,
  type DisasterRecoveryPlan,
} from './system/disaster-recovery.zod';

// ─── [#16320] the seven cron-typed positions nothing evaluated are DELETED ────
//
// ADR-0049 enforce-or-remove. Every position was declared, parsed into the
// `{ dialect: 'cron', source }` envelope and read by NOTHING (the ADR-0058 D7
// ledger row `cron-declared-unwired` had all seven `unevaluated`).
//
// ⚠️ The removal route is BARE DELETION, by maintainer ruling of 2026-09-10 on
// the retirement PR — 「直接删」, taken over the seat's written recommendation to
// keep a tombstone and the connector family's D2 conversion, on the reading that
// customers do not upgrade major by major in order. So NONE of the seven carries
// a `retiredKey()` tombstone, a `RETIRED_KEYS_BY_MAJOR[18]` entry, an ADR-0087 D2
// conversion or a D3 semantic entry.
//
// That makes the PARSE-layer consequence a SILENT STRIP, not a refusal: none of
// the five schemas is `.strict()`, so zod drops an authored value and answers
// `success: true` (ADR-0104's shape). These pins record exactly that — what an
// author who keeps writing one of these keys gets from the SCHEMA — so the day
// someone changes the route, the change is loud here rather than invisible in
// the field.
//
// ⚠️ The parse is NOT the whole channel, and the difference is measured rather
// than reasoned. Above the parse, `lintUnknownAuthoringKeys` (#3786) walks every
// `PLURAL_TO_SINGULAR` collection whose entry schema is strip-mode, and
// `connectors: 'connector'` is one of them — so for the ONE of the seven a stack
// manifest reaches, the CLI NAMES the dropped key:
//
//   • `os validate` — exit 0, and prints (`--json` carries the same string in
//     `warnings`):
//       connectors.sap_erp.syncConfig.schedule: 'schedule' is not a declared
//       connector key, so its value is dropped at load.
//   • `os validate --strict` — exit 1. Measured on an otherwise-clean stack:
//     the same manifest WITHOUT the key is 0 warnings / exit 0, WITH it is
//     1 warning / exit 1. A CI running `--strict` REFUSES the upgraded manifest.
//   • `os build` — the same line, under `Undeclared authoring keys (1) —
//     dropped at load (#3786)`.
//   • `os migrate meta` — still lists nothing, in either direction. There is no
//     prescription to make, which is the half the bare deletion really does own.
//
// ⇒ ⛔ Do not read these pins as "the author is never told". They pin the schema
// layer. The author-facing loss is louder than a bare `safeParse` suggests, and
// it is louder than the ruling comment's cost statement assumed.
//
// ─── [#17158] three of the seven left WITH THEIR DEFS ─────────────────────────
//
// `ScheduledExport.schedule.cronExpression`, `ScheduleExportRequest.schedule.cronExpression`
// and `ScheduleState.cronExpression` sat on defs that were themselves declared
// and unserved: the export-job API family and `ScheduleState` were retired
// WHOLE in the same major (ADR-0049, maintainer ruling A on #17158), so those
// three schemas no longer exist to strip anything. Their strip pins are gone
// with them; `LEFT_WITH_THEIR_DEFS` below keeps the two facts that still
// hold — no key-level registration was ever made for the three positions, and
// each enclosing def is now a `RETIRED_DEFS_BY_MAJOR[18]` entry. The four
// positions on live schemas are pinned exactly as before.
//
// ─── Protocol 18: `DataSyncConfig.schedule` joined them ───────────────────────
//
// The connector's whole `syncConfig` block was retired later in the same major
// (ADR-0049 — no engine ever ran a connector-attached sync; the definition
// moved to the target `mapping`'s `connectorSource`, with a `job` for the
// cadence). `DataSyncConfig` left whole, so its `schedule` position moved from
// the strip pins to `LEFT_WITH_THEIR_DEFS`. The 直接删 ruling on the KEY stands
// — still no key-level registration, conversion or D3 names `schedule` — but
// the manifest-reachable path is now LOUDER than the strip it replaced: the
// `syncConfig` CONTAINER is a `retiredKey()` tombstone, so a stack still
// carrying a cadence there meets a refusal whose prescription names the `job`,
// and the container's own D2 (`connector-sync-keys-removed`) strips it whole,
// `schedule` included, without naming it. The last describe block of the
// connector half below pins that.

const CRON = '0 6 * * MON';
/** The envelope the old schema normalized the bare string into — dropped just the same. */
const CRON_ENVELOPE = { dialect: 'cron', source: CRON };

// ── Well-formed fixtures: every required key, none of the deleted ones ──────

const SYNC_WELL_FORMED = { strategy: 'incremental' as const, direction: 'bidirectional' as const, batchSize: 500 };
const CONNECTOR_WELL_FORMED = { name: 'sap_erp', label: 'SAP ERP', type: 'saas' as const };
// [#17157] was `strategy: 'scheduled'` — that enum member was itself retired one card
// later, in this same major, precisely because the cron key stripped below was its
// only referent. A fixture must be well-formed under the CURRENT schema, so it now
// carries `eager`; what this file pins is the absence of `schedule`, unchanged.
const WARMUP_WELL_FORMED = { enabled: true, strategy: 'eager' as const, patterns: ['config:*'] };
const CACHE_WELL_FORMED = {
  enabled: true,
  tiers: [{ name: 'l1', type: 'memory' as const }],
  invalidation: [],
  warmup: WARMUP_WELL_FORMED,
};
const BACKUP_WELL_FORMED = { retention: { days: 30 }, destination: { type: 's3' as const, bucket: 'backups' } };
const DR_TESTING_WELL_FORMED = { enabled: true, notificationChannel: '#dr-alerts' };
const DR_PLAN_WELL_FORMED = {
  rpo: { value: 15 },
  rto: { value: 1, unit: 'hours' as const },
  backup: BACKUP_WELL_FORMED,
  testing: DR_TESTING_WELL_FORMED,
};

interface DeletedSite {
  /** The spelling the key WOULD have had in `RETIRED_KEYS_BY_MAJOR` — pinned absent below. */
  registered: string;
  /** How the position reads to an author. */
  qualified: string;
  schema: ZodTypeAny;
  wellFormed: Record<string, unknown>;
  authored: unknown;
  /** Path to the deleted key inside the parsed document. */
  keyPath: (string | number)[];
}

/**
 * [#17158] The three positions whose enclosing def retired whole — the key-level
 * spelling (never registered) and the def-level entry (now registered).
 */
const LEFT_WITH_THEIR_DEFS = [
  { registered: 'api/ScheduledExport:schedule.cronExpression', def: 'api/ScheduledExport' },
  { registered: 'api/ScheduleExportRequest:schedule.cronExpression', def: 'api/ScheduleExportRequest' },
  { registered: 'automation/ScheduleState:cronExpression', def: 'automation/ScheduleState' },
  // Protocol 18: the connector's `syncConfig` retired whole (ADR-0049).
  { registered: 'integration/DataSyncConfig:schedule', def: 'integration/DataSyncConfig' },
] as const;

/** The three positions whose schemas are still published. */
const SITES: DeletedSite[] = [
  {
    registered: 'system/CacheWarmup:schedule',
    qualified: 'CacheWarmup.schedule',
    schema: CacheWarmupSchema,
    wellFormed: WARMUP_WELL_FORMED,
    authored: { ...WARMUP_WELL_FORMED, schedule: CRON },
    keyPath: ['schedule'],
  },
  {
    registered: 'system/BackupConfig:schedule',
    qualified: 'BackupConfig.schedule',
    schema: BackupConfigSchema,
    wellFormed: BACKUP_WELL_FORMED,
    authored: { ...BACKUP_WELL_FORMED, schedule: CRON },
    keyPath: ['schedule'],
  },
  {
    registered: 'system/DisasterRecoveryPlan:testing.schedule',
    qualified: 'DisasterRecoveryPlan.testing.schedule',
    schema: DisasterRecoveryPlanSchema,
    wellFormed: DR_PLAN_WELL_FORMED,
    authored: { ...DR_PLAN_WELL_FORMED, testing: { ...DR_TESTING_WELL_FORMED, schedule: CRON } },
    keyPath: ['testing', 'schedule'],
  },
];

/** The same deletions seen through the shapes that nest them. */
const CARRIERS: Array<Pick<DeletedSite, 'qualified' | 'schema' | 'wellFormed' | 'authored' | 'keyPath'> & { via: string }> = [
  // (`Connector.syncConfig` and `DeclarativeConnectorEntry.syncConfig` stood
  // here until protocol 18 retired the container: they no longer strip the key,
  // they REFUSE the block — pinned in the connector describe block below.)
  {
    via: 'DisasterRecoveryPlan.backup',
    qualified: 'BackupConfig.schedule',
    schema: DisasterRecoveryPlanSchema,
    wellFormed: DR_PLAN_WELL_FORMED,
    authored: { ...DR_PLAN_WELL_FORMED, backup: { ...BACKUP_WELL_FORMED, schedule: CRON } },
    keyPath: ['backup', 'schedule'],
  },
  {
    via: 'DistributedCacheConfig.warmup',
    qualified: 'CacheWarmup.schedule',
    schema: DistributedCacheConfigSchema,
    wellFormed: CACHE_WELL_FORMED,
    authored: { ...CACHE_WELL_FORMED, warmup: { ...WARMUP_WELL_FORMED, schedule: CRON } },
    keyPath: ['warmup', 'schedule'],
  },
];

/** The five ADR-0087 entry ids an earlier round of this card carried — pinned absent. */
const NEVER_REGISTERED_IDS = [
  'connector-sync-schedule-removed',
  'connector-sync-schedule-retired',
  'export-schedule-cron-retired',
  'schedule-state-cron-expression-retired',
  'cache-warmup-schedule-retired',
  'disaster-recovery-schedules-retired',
];

/** Walk to the enclosing block of a key path, then read the leaf. */
function readAt(doc: unknown, keyPath: (string | number)[]): { block: Record<string, unknown>; leaf: string } {
  let at: unknown = doc;
  for (const seg of keyPath.slice(0, -1)) at = (at as Record<string, unknown>)[seg as string];
  return { block: at as Record<string, unknown>, leaf: String(keyPath[keyPath.length - 1]) };
}

describe('the three surviving cron-typed positions no longer exist on their schemas', () => {
  for (const site of SITES) {
    it(`\`${site.qualified}\` is gone — an authored value is accepted and STRIPPED, never materialized`, () => {
      const parsed = site.schema.safeParse(site.authored);
      // Bare deletion on a non-strict schema: no refusal, the value is dropped.
      expect(parsed.success, `${site.qualified}: a non-strict schema strips, it does not refuse`).toBe(true);
      if (!parsed.success) return;
      const { block, leaf } = readAt(parsed.data, site.keyPath);
      expect(block, `${site.qualified}: the enclosing block must still parse`).toBeDefined();
      expect(block).not.toHaveProperty(leaf);
      // Attribution control: the same document WITHOUT the key parses too, so
      // the absence above is the deletion and not a broken parse.
      expect(site.schema.safeParse(site.wellFormed).success, `${site.qualified}: well-formed control must parse`).toBe(true);
    });
  }

  it('the envelope spelling is dropped too — both shapes the old schema accepted are gone', () => {
    const site = (qualified: string): DeletedSite => {
      const found = SITES.find((s) => s.qualified === qualified);
      expect(found, `no site named ${qualified}`).toBeDefined();
      return found!;
    };
    const envelopeSites: Array<[DeletedSite, unknown]> = [
      [site('CacheWarmup.schedule'), { ...WARMUP_WELL_FORMED, schedule: CRON_ENVELOPE }],
      [site('BackupConfig.schedule'), { ...BACKUP_WELL_FORMED, schedule: CRON_ENVELOPE }],
    ];
    for (const [site, authored] of envelopeSites) {
      const parsed = site.schema.safeParse(authored);
      expect(parsed.success, `${site.qualified} (envelope)`).toBe(true);
      if (!parsed.success) continue;
      const { block, leaf } = readAt(parsed.data, site.keyPath);
      expect(block).not.toHaveProperty(leaf);
    }
  });

  for (const carrier of CARRIERS) {
    it(`\`${carrier.qualified}\` is gone through \`${carrier.via}\` as well`, () => {
      const parsed = carrier.schema.safeParse(carrier.authored);
      expect(parsed.success, carrier.via).toBe(true);
      if (!parsed.success) return;
      const { block, leaf } = readAt(parsed.data, carrier.keyPath);
      expect(block, `${carrier.via}: the enclosing block must still parse`).toBeDefined();
      expect(block).not.toHaveProperty(leaf);
      expect(carrier.schema.safeParse(carrier.wellFormed).success, `${carrier.via}: well-formed control must parse`).toBe(true);
    });
  }

  it('the surviving keys still materialize — the absences above are the deletions, not a dead parse', () => {
    expect(CacheWarmupSchema.parse(WARMUP_WELL_FORMED).concurrency).toBe(10);
    expect(BackupConfigSchema.parse(BACKUP_WELL_FORMED).verifyAfterBackup).toBe(true);
  });
});

describe('the one manifest-reachable position — what an upgrading stack actually gets', () => {
  // ⚠️ REWRITTEN IN PROTOCOL 18, and the direction of every assertion here
  // INVERTED. These pins used to record the 直接删 consequence — the key
  // accepted and silently stripped from `syncConfig`. The connector's
  // `syncConfig` container has since been retired whole (ADR-0049), as a
  // `retiredKey()` tombstone: a stack still carrying a cadence there is now
  // REFUSED at the container, and the prescription names the `job` that owns a
  // cadence. Louder than the strip, on every door the strip used to reach.
  const WITH_CADENCE = { ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } };

  it('`Connector`, `/meta/connector` (the registry-bound door) and `stack.connectors[]` refuse the container, naming the `job`', async () => {
    const door = getMetadataTypeSchema('connector');
    expect(door, 'no schema bound for `connector`').toBeDefined();
    const { ObjectStackSchema } = await import('./stack.zod');
    for (const [label, result, at] of [
      ['Connector', ConnectorSchema.safeParse(WITH_CADENCE), 'syncConfig'],
      ['DeclarativeConnectorEntry', DeclarativeConnectorEntrySchema.safeParse(WITH_CADENCE), 'syncConfig'],
      ['/meta/connector', door!.safeParse(WITH_CADENCE), 'syncConfig'],
      ['stack.connectors[]', ObjectStackSchema.safeParse({ connectors: [WITH_CADENCE] }), 'connectors.0.syncConfig'],
    ] as const) {
      expect(result.success, `${label} must refuse the retired container`).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === at);
      expect(issue, `${label}: the refusal must name the container`).toBeDefined();
      expect(issue!.message).toMatch(/^`connector\.syncConfig` was removed/);
      expect(issue!.message).toContain('`job`');
    }
    // Positive control: the identical connector minus the container parses on
    // every door, so each refusal above is the container's alone.
    expect(ConnectorSchema.safeParse(CONNECTOR_WELL_FORMED).success).toBe(true);
    expect(door!.safeParse(CONNECTOR_WELL_FORMED).success).toBe(true);
    expect(ObjectStackSchema.safeParse({ connectors: [CONNECTOR_WELL_FORMED] }).success).toBe(true);
  });
});

describe('the tsc channel: the deleted keys are not in their input types', () => {
  it('fails tsc at every authoring site', () => {
    const connector: Connector = {
      ...CONNECTOR_WELL_FORMED,
      // @ts-expect-error — protocol 18 retired the whole container: `syncConfig` is a `retiredKey()` tombstone.
      syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON },
    };
    const warmup: CacheWarmup = {
      ...WARMUP_WELL_FORMED,
      // @ts-expect-error — `schedule` was deleted.
      schedule: CRON,
    };
    const cache: DistributedCacheConfig = {
      ...CACHE_WELL_FORMED,
      // @ts-expect-error — the deletion reaches through the carrier.
      warmup: { ...WARMUP_WELL_FORMED, schedule: CRON },
    };
    const backup: BackupConfig = {
      ...BACKUP_WELL_FORMED,
      // @ts-expect-error — `schedule` was deleted.
      schedule: CRON,
    };
    const plan: DisasterRecoveryPlan = {
      ...DR_PLAN_WELL_FORMED,
      // @ts-expect-error — `testing.schedule` was deleted.
      testing: { ...DR_TESTING_WELL_FORMED, schedule: CRON },
    };
    // tsc is the assertion above. At runtime the same values parse and lose the
    // key, which is what keeps this case from being vacuous — and is precisely
    // why the tsc channel is the ONLY loud one the bare deletion leaves.
    // The connector literal is the one exception since protocol 18: its
    // container is refused at runtime too, so tsc and parse agree.
    expect(ConnectorSchema.safeParse(connector).success).toBe(false);
    for (const [schema, value, keyPath] of [
      [CacheWarmupSchema, warmup, ['schedule']],
      [DistributedCacheConfigSchema, cache, ['warmup', 'schedule']],
      [BackupConfigSchema, backup, ['schedule']],
      [DisasterRecoveryPlanSchema, plan, ['testing', 'schedule']],
    ] as Array<[ZodTypeAny, unknown, (string | number)[]]>) {
      const parsed = schema.safeParse(value);
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;
      const { block, leaf } = readAt(parsed.data, keyPath);
      expect(block).not.toHaveProperty(leaf);
    }
  });
});

describe('直接删 — the ADR-0087 surfaces carry NOTHING for these seven', () => {
  it('the four positions that left with their defs (the export-job family, `ScheduleState`, the connector `DataSyncConfig`) are covered at DEF grain, not key grain', () => {
    const retiredDefs18 = new Set(RETIRED_DEFS_BY_MAJOR[18] ?? []);
    for (const gone of LEFT_WITH_THEIR_DEFS) {
      expect(retiredDefs18.has(gone.def), `${gone.def} must be a RETIRED_DEFS_BY_MAJOR[18] entry`).toBe(true);
    }
    // Dark control — a def that was never retired reads absent.
    expect(retiredDefs18.has('integration/RetryConfig')).toBe(false);
  });

  const registered = new Set(Object.values(RETIRED_KEYS_BY_MAJOR).flatMap((keys) => [...keys]));

  it('no `RETIRED_KEYS_BY_MAJOR` entry names any of the seven, at any major', () => {
    for (const site of SITES) expect(registered.has(site.registered), site.registered).toBe(false);
    for (const gone of LEFT_WITH_THEIR_DEFS) expect(registered.has(gone.registered), gone.registered).toBe(false);
    // Lit control — the table is populated and this reader can see it. A key
    // retired the tombstone way on the very same connector schema.
    expect(registered.has('integration/Connector:errorMapping')).toBe(true);
    // Dark control — a fabricated spelling must read absent, so the assertions
    // above are membership readings and not a broken lookup.
    expect(registered.has('integration/DataSyncConfig:noSuchKeyEverExisted')).toBe(false);
  });

  it('no D2 conversion covers them — not by id, and not by surface', () => {
    const conversions = Object.values(CONVERSIONS_BY_MAJOR).flatMap((entries) => [...entries]);
    const ids = new Set(conversions.map((c) => c.id));
    for (const id of NEVER_REGISTERED_IDS) expect(ids.has(id), id).toBe(false);
    const surfaces = conversions.map((c) => c.surface);
    expect(surfaces.some((s) => s.includes('syncConfig.schedule'))).toBe(false);
    expect(surfaces.some((s) => s.includes('cronExpression'))).toBe(false);
    // Lit control — the registry really is loaded and its surfaces really are
    // readable: the sibling connector retirement that DID convert is here.
    expect(ids.has('connector-error-mapping-removed')).toBe(true);
    expect(surfaces.some((s) => s.includes('errorMapping'))).toBe(true);
    // Dark control.
    expect(ids.has('no-such-conversion-ever-existed')).toBe(false);
  });

  it('no D3 semantic entry and no step-18 chain reference survives', () => {
    const step18 = MIGRATIONS_BY_MAJOR[18];
    expect(step18, 'step 18 must exist').toBeDefined();
    for (const id of NEVER_REGISTERED_IDS) {
      expect(step18!.conversionIds.includes(id), `step18.conversionIds must not name ${id}`).toBe(false);
    }
    const semanticIds = new Set(Object.values(MIGRATIONS_BY_MAJOR).flatMap((step) => step.semantic.map((s) => s.id)));
    for (const id of NEVER_REGISTERED_IDS) expect(semanticIds.has(id), id).toBe(false);
    // Lit control — the semantic table is loaded and this reader sees it.
    expect(semanticIds.has('connector-error-mapping-removed') || semanticIds.size > 0).toBe(true);
    expect(step18!.conversionIds.includes('connector-error-mapping-removed')).toBe(true);
    // Dark control.
    expect(semanticIds.has('no-such-semantic-entry-ever-existed')).toBe(false);
  });
});

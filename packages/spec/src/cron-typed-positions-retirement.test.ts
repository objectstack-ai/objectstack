// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import { ScheduledExportSchema, ScheduleExportRequestSchema, type ScheduledExport, type ScheduleExportRequest } from './api/export.zod';
import { ScheduleStateSchema, type ScheduleState } from './automation/execution.zod';
import { CONVERSIONS_BY_MAJOR } from './conversions/registry';
import {
  ConnectorSchema,
  DataSyncConfigSchema,
  DeclarativeConnectorEntrySchema,
  type Connector,
  type DataSyncConfig,
} from './integration/connector.zod';
import { getMetadataTypeSchema } from './kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from './migrations/registry';
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

const CRON = '0 6 * * MON';
/** The envelope the old schema normalized the bare string into — dropped just the same. */
const CRON_ENVELOPE = { dialect: 'cron', source: CRON };

// ── Well-formed fixtures: every required key, none of the deleted ones ──────

const EXPORT_WELL_FORMED = {
  name: 'weekly_account_export',
  object: 'account',
  schedule: { timezone: 'America/New_York' },
  delivery: { method: 'email' as const, recipients: ['admin@example.com'] },
};
const STATE_WELL_FORMED = { id: 'sched_001', flowName: 'daily_report', createdAt: '2026-01-01T00:00:00Z' };
const SYNC_WELL_FORMED = { strategy: 'incremental' as const, direction: 'bidirectional' as const, batchSize: 500 };
const CONNECTOR_WELL_FORMED = { name: 'sap_erp', label: 'SAP ERP', type: 'saas' as const, syncConfig: SYNC_WELL_FORMED };
const WARMUP_WELL_FORMED = { enabled: true, strategy: 'scheduled' as const, patterns: ['config:*'] };
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

const SITES: DeletedSite[] = [
  {
    registered: 'api/ScheduledExport:schedule.cronExpression',
    qualified: 'ScheduledExport.schedule.cronExpression',
    schema: ScheduledExportSchema,
    wellFormed: EXPORT_WELL_FORMED,
    authored: { ...EXPORT_WELL_FORMED, schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON } },
    keyPath: ['schedule', 'cronExpression'],
  },
  {
    registered: 'api/ScheduleExportRequest:schedule.cronExpression',
    qualified: 'ScheduleExportRequest.schedule.cronExpression',
    schema: ScheduleExportRequestSchema,
    wellFormed: EXPORT_WELL_FORMED,
    authored: { ...EXPORT_WELL_FORMED, schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON } },
    keyPath: ['schedule', 'cronExpression'],
  },
  {
    registered: 'automation/ScheduleState:cronExpression',
    qualified: 'ScheduleState.cronExpression',
    schema: ScheduleStateSchema,
    wellFormed: STATE_WELL_FORMED,
    authored: { ...STATE_WELL_FORMED, cronExpression: CRON },
    keyPath: ['cronExpression'],
  },
  {
    registered: 'integration/DataSyncConfig:schedule',
    qualified: 'connector.syncConfig.schedule',
    schema: DataSyncConfigSchema,
    wellFormed: SYNC_WELL_FORMED,
    authored: { ...SYNC_WELL_FORMED, schedule: CRON },
    keyPath: ['schedule'],
  },
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
  {
    via: 'Connector.syncConfig',
    qualified: 'connector.syncConfig.schedule',
    schema: ConnectorSchema,
    wellFormed: CONNECTOR_WELL_FORMED,
    authored: { ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } },
    keyPath: ['syncConfig', 'schedule'],
  },
  {
    via: 'DeclarativeConnectorEntry.syncConfig (the `/meta/connector` write door inherits it)',
    qualified: 'connector.syncConfig.schedule',
    schema: DeclarativeConnectorEntrySchema,
    wellFormed: CONNECTOR_WELL_FORMED,
    authored: { ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } },
    keyPath: ['syncConfig', 'schedule'],
  },
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

describe('[#16320] the seven cron-typed positions no longer exist on their schemas', () => {
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
    const envelopeSites: Array<[DeletedSite, unknown]> = [
      [SITES[3]!, { ...SYNC_WELL_FORMED, schedule: CRON_ENVELOPE }],
      [SITES[0]!, { ...EXPORT_WELL_FORMED, schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON_ENVELOPE } }],
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
    expect(ScheduledExportSchema.parse(EXPORT_WELL_FORMED).schedule.timezone).toBe('America/New_York');
    expect(ScheduleExportRequestSchema.parse({ ...EXPORT_WELL_FORMED, schedule: {} }).schedule.timezone).toBe('UTC');
    expect(ScheduleStateSchema.parse(STATE_WELL_FORMED).timezone).toBe('UTC');
    expect(DataSyncConfigSchema.parse(SYNC_WELL_FORMED).realtimeSync).toBe(false);
    expect(CacheWarmupSchema.parse(WARMUP_WELL_FORMED).concurrency).toBe(10);
    expect(BackupConfigSchema.parse(BACKUP_WELL_FORMED).verifyAfterBackup).toBe(true);
  });

  it('`ScheduleState.cronExpression` was REQUIRED — the requiredness left with the key', () => {
    const parsed = ScheduleStateSchema.parse(STATE_WELL_FORMED);
    expect(parsed.status).toBe('active');
    expect(parsed.timezone).toBe('UTC');
    // The other required keys are still required — the requiredness that left
    // is exactly the deleted key's.
    expect(ScheduleStateSchema.safeParse({ id: 'sched_002', createdAt: '2026-01-01T00:00:00Z' }).success).toBe(false);
  });
});

describe('[#16320] the one manifest-reachable position — what an upgrading stack actually gets', () => {
  it('`/meta/connector` (the registry-bound door) accepts the key and strips it', () => {
    // The registry lookup is the real `/meta` entry point — a future rebinding
    // that pointed `connector` at some third shape would pass the carrier pins
    // above and still behave differently in production.
    const schema = getMetadataTypeSchema('connector');
    expect(schema, 'no schema bound for `connector`').toBeDefined();
    const parsed = schema!.safeParse({ ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect((parsed.data as { syncConfig: Record<string, unknown> }).syncConfig).not.toHaveProperty('schedule');
    expect((parsed.data as { syncConfig: Record<string, unknown> }).syncConfig.batchSize).toBe(500);
  });

  it('`stack.connectors[]` — the real authoring path — accepts the key and strips it', async () => {
    // ⚠️ THE CONSEQUENCE OF THE 直接删 RULING, pinned. `DataSyncConfig.schedule`
    // is the only one of the seven a stack manifest reaches (`stack.zod.ts`
    // `connectors[]` → `connector.zod.ts` `syncConfig` → `schedule`). With no
    // tombstone the manifest still LOADS and the cadence the author wrote is
    // dropped — the ADR-0104 silent-strip shape at the PARSE, accepted
    // deliberately by the ruling.
    //
    // ⛔ Silent at the parse is not silent to the author, and the module
    // docblock carries the measurement: on this exact path `os validate` prints
    // `connectors.<name>.syncConfig.schedule: 'schedule' is not a declared
    // connector key, so its value is dropped at load.`, `os build` prints it
    // under its undeclared-keys block, and `os validate --strict` EXITS 1 on it.
    // This assertion is about `ObjectStackSchema` alone; it does not measure —
    // and must not be quoted as — what the CLI tells the author.
    const { ObjectStackSchema } = await import('./stack.zod');
    const parsed = ObjectStackSchema.safeParse({
      connectors: [{ ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const connectors = (parsed.data as { connectors: Array<{ syncConfig: Record<string, unknown> }> }).connectors;
    expect(connectors[0]!.syncConfig).not.toHaveProperty('schedule');
    expect(connectors[0]!.syncConfig.strategy).toBe('incremental');
    // Positive control: the identical stack minus the deleted key parses too.
    expect(ObjectStackSchema.safeParse({ connectors: [CONNECTOR_WELL_FORMED] }).success).toBe(true);
  });
});

describe('[#16320] the tsc channel: the seven keys are not in their input types', () => {
  it('fails tsc at every authoring site', () => {
    const sched: ScheduledExport = {
      ...EXPORT_WELL_FORMED,
      // @ts-expect-error — `schedule.cronExpression` was deleted; it is not a key of this type.
      schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON },
    };
    const request: ScheduleExportRequest = {
      ...EXPORT_WELL_FORMED,
      // @ts-expect-error — the request body's twin position, deleted with it.
      schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON },
    };
    const state: ScheduleState = {
      ...STATE_WELL_FORMED,
      // @ts-expect-error — `cronExpression` was deleted (and was required before).
      cronExpression: CRON,
    };
    const sync: DataSyncConfig = {
      ...SYNC_WELL_FORMED,
      // @ts-expect-error — `schedule` was deleted.
      schedule: CRON,
    };
    const connector: Connector = {
      ...CONNECTOR_WELL_FORMED,
      // @ts-expect-error — the deletion reaches through the carrier.
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
    for (const [schema, value, keyPath] of [
      [ScheduledExportSchema, sched, ['schedule', 'cronExpression']],
      [ScheduleExportRequestSchema, request, ['schedule', 'cronExpression']],
      [ScheduleStateSchema, state, ['cronExpression']],
      [DataSyncConfigSchema, sync, ['schedule']],
      [ConnectorSchema, connector, ['syncConfig', 'schedule']],
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

describe('[#16320] 直接删 — the ADR-0087 surfaces carry NOTHING for these seven', () => {
  const registered = new Set(Object.values(RETIRED_KEYS_BY_MAJOR).flatMap((keys) => [...keys]));

  it('no `RETIRED_KEYS_BY_MAJOR` entry names any of the seven, at any major', () => {
    for (const site of SITES) expect(registered.has(site.registered), site.registered).toBe(false);
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

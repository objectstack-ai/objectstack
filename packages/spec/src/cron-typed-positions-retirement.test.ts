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

// ─── [#16320] the seven cron-typed positions nothing evaluated are REMOVED ────
//
// ADR-0049 enforce-or-remove. The #15954 ruling (director decision batch #56,
// maintainer 「其他同意」, 2026-09-06) is option A — retire — PER FAMILY, and the
// tree forces the split: of the seven positions, exactly ONE is reachable from
// a stack manifest (`stack.connectors[]` → `Connector.syncConfig` →
// `DataSyncConfig.schedule`), so only that family carries an ADR-0087 D2
// conversion and the house `os migrate meta` sentence; the other six (export
// API bodies, runtime schedule state, cache / DR operator config) are no stack
// collection member and no metadata type, so a conversion there would be a
// transform with no seam that ever runs — they take a D3 semantic entry each
// and their prescriptions carry NO migrate sentence (the sentence must be true
// of the tool, `shared/retired-key.ts`). Nothing in the gate set catches the
// two ways to get that split wrong — a conversion omitted for the connector
// family, or the migrate sentence written on all seven — which is what the
// per-family assertions below are for.
//
// Every position was declared, parsed into the `{ dialect: 'cron', source }`
// envelope and read by NOTHING (the ADR-0058 D7 ledger row
// `cron-declared-unwired` had all seven `unevaluated`). None of the five
// schemas is `.strict()`, so the route is `retiredKey()` tombstones, NOT plain
// deletion — a bare deletion would make zod strip the key in silence
// (ADR-0104). Audible in two channels: `tsc` (the input type is `never`) and
// the parse (the prescription is the message).
//
// On the assertion set (the #8586 / #14676 / #14477 precedent): a schema
// refusal raises a `ZodError` whose issues carry `code` and `path` but no
// ADR-0112 `status` — that envelope belongs to the API error surface. So these
// pins assert the strongest set this surface really has: refusal, the issue
// `code`, the `path` naming WHICH site refused, and the prescription text
// (#5240: where the wording is the contract, pin the wording).

const CRON = '0 6 * * MON';
/** The envelope the old schema normalized the bare string into — refused just the same. */
const CRON_ENVELOPE = { dialect: 'cron', source: CRON };

// ── Well-formed fixtures: every required key, none of the retired ones ──────

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
const BACKUP_WELL_FORMED = { retention: { days: 30 }, destination: { type: 's3' as const, bucket: 'backups' } };
const DR_TESTING_WELL_FORMED = { enabled: true, notificationChannel: '#dr-alerts' };
const DR_PLAN_WELL_FORMED = {
  rpo: { value: 15 },
  rto: { value: 1, unit: 'hours' as const },
  backup: BACKUP_WELL_FORMED,
  testing: DR_TESTING_WELL_FORMED,
};

interface RetiredSite {
  /** The exact `RETIRED_KEYS_BY_MAJOR` spelling. */
  registered: string;
  /** How the prescription opens (its backtick-wrapped qualified key). */
  qualified: string;
  schema: ZodTypeAny;
  wellFormed: Record<string, unknown>;
  authored: unknown;
  issuePath: (string | number)[];
  /** Only the one stack-collection member owes the `os migrate meta` sentence. */
  migrateSentence: boolean;
}

const SITES: RetiredSite[] = [
  {
    registered: 'api/ScheduledExport:schedule.cronExpression',
    qualified: 'ScheduledExport.schedule.cronExpression',
    schema: ScheduledExportSchema,
    wellFormed: EXPORT_WELL_FORMED,
    authored: { ...EXPORT_WELL_FORMED, schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON } },
    issuePath: ['schedule', 'cronExpression'],
    migrateSentence: false,
  },
  {
    registered: 'api/ScheduleExportRequest:schedule.cronExpression',
    qualified: 'ScheduleExportRequest.schedule.cronExpression',
    schema: ScheduleExportRequestSchema,
    wellFormed: EXPORT_WELL_FORMED,
    authored: { ...EXPORT_WELL_FORMED, schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON } },
    issuePath: ['schedule', 'cronExpression'],
    migrateSentence: false,
  },
  {
    registered: 'automation/ScheduleState:cronExpression',
    qualified: 'ScheduleState.cronExpression',
    schema: ScheduleStateSchema,
    wellFormed: STATE_WELL_FORMED,
    authored: { ...STATE_WELL_FORMED, cronExpression: CRON },
    issuePath: ['cronExpression'],
    migrateSentence: false,
  },
  {
    registered: 'integration/DataSyncConfig:schedule',
    qualified: 'connector.syncConfig.schedule',
    schema: DataSyncConfigSchema,
    wellFormed: SYNC_WELL_FORMED,
    authored: { ...SYNC_WELL_FORMED, schedule: CRON },
    issuePath: ['schedule'],
    migrateSentence: true,
  },
  {
    registered: 'system/CacheWarmup:schedule',
    qualified: 'CacheWarmup.schedule',
    schema: CacheWarmupSchema,
    wellFormed: WARMUP_WELL_FORMED,
    authored: { ...WARMUP_WELL_FORMED, schedule: CRON },
    issuePath: ['schedule'],
    migrateSentence: false,
  },
  {
    registered: 'system/BackupConfig:schedule',
    qualified: 'BackupConfig.schedule',
    schema: BackupConfigSchema,
    wellFormed: BACKUP_WELL_FORMED,
    authored: { ...BACKUP_WELL_FORMED, schedule: CRON },
    issuePath: ['schedule'],
    migrateSentence: false,
  },
  {
    registered: 'system/DisasterRecoveryPlan:testing.schedule',
    qualified: 'DisasterRecoveryPlan.testing.schedule',
    schema: DisasterRecoveryPlanSchema,
    wellFormed: DR_PLAN_WELL_FORMED,
    authored: { ...DR_PLAN_WELL_FORMED, testing: { ...DR_TESTING_WELL_FORMED, schedule: CRON } },
    issuePath: ['testing', 'schedule'],
    migrateSentence: false,
  },
];

/** The same tombstones seen through the shapes that nest them. */
const CARRIERS: Array<Pick<RetiredSite, 'qualified' | 'schema' | 'wellFormed' | 'authored' | 'issuePath'> & { via: string }> = [
  {
    via: 'Connector.syncConfig',
    qualified: 'connector.syncConfig.schedule',
    schema: ConnectorSchema,
    wellFormed: CONNECTOR_WELL_FORMED,
    authored: { ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } },
    issuePath: ['syncConfig', 'schedule'],
  },
  {
    via: 'DeclarativeConnectorEntry.syncConfig (the `/meta/connector` write door inherits it)',
    qualified: 'connector.syncConfig.schedule',
    schema: DeclarativeConnectorEntrySchema,
    wellFormed: CONNECTOR_WELL_FORMED,
    authored: { ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } },
    issuePath: ['syncConfig', 'schedule'],
  },
  {
    via: 'DisasterRecoveryPlan.backup',
    qualified: 'BackupConfig.schedule',
    schema: DisasterRecoveryPlanSchema,
    wellFormed: DR_PLAN_WELL_FORMED,
    authored: { ...DR_PLAN_WELL_FORMED, backup: { ...BACKUP_WELL_FORMED, schedule: CRON } },
    issuePath: ['backup', 'schedule'],
  },
  {
    via: 'DistributedCacheConfig.warmup',
    qualified: 'CacheWarmup.schedule',
    schema: DistributedCacheConfigSchema,
    wellFormed: { warmup: WARMUP_WELL_FORMED },
    authored: { warmup: { ...WARMUP_WELL_FORMED, schedule: CRON } },
    issuePath: ['warmup', 'schedule'],
  },
];

const CONVERSION_ID = 'connector-sync-schedule-removed';
const SEMANTIC_IDS = [
  'export-schedule-cron-retired',
  'schedule-state-cron-expression-retired',
  'cache-warmup-schedule-retired',
  'disaster-recovery-schedules-retired',
];
const HOUSE_MIGRATE_SENTENCE =
  /Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand\.$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findIssue(schema: ZodTypeAny, authored: unknown, issuePath: (string | number)[], label: string) {
  const result = schema.safeParse(authored);
  expect(result.success, `${label} must be refused`).toBe(false);
  if (result.success) return undefined; // narrowing; the assertion above already failed
  const wanted = issuePath.join('.');
  const issue = result.error.issues.find((i) => i.path.join('.') === wanted);
  expect(issue, `the refusal must surface at ${wanted}`).toBeDefined();
  return issue!;
}

function expectTombstoneRefusal(
  site: Pick<RetiredSite, 'qualified' | 'schema' | 'authored' | 'issuePath'>,
  migrateSentence: boolean,
) {
  const issue = findIssue(site.schema, site.authored, site.issuePath, site.qualified);
  if (!issue) return;
  // The machine-readable half of the envelope this surface actually has: a
  // `retiredKey()` tombstone raises `invalid_type` from its `z.never()`.
  expect(issue.code).toBe('invalid_type');
  expect(issue.path).toEqual(site.issuePath);
  // The prescription IS the migration doc for whoever hits it — contract, not
  // commentary: it opens with the qualified key, names the version and the
  // ADR, says why the key was inert, and tells the author what to do.
  expect(issue.message).toMatch(
    new RegExp('^`' + escapeRegExp(site.qualified) + '` was removed in @objectstack/spec 17 \\(ADR-0049 enforce-or-remove\\) — nothing ever read it'),
  );
  expect(issue.message).toMatch(/Delete the key/);
  // Every prescription points the reader at the ONE cron slot the platform
  // evaluates, so nobody re-declares the retired key as a repair.
  expect(issue.message).toMatch(/`Job\.schedule\.expression`/);
  // Customer-facing text carries the ADR, never an issue id.
  expect(issue.message).toMatch(/ADR-0049/);
  expect(issue.message).not.toMatch(/#\d{3,}/);
  // ⭐ The per-family split, pinned in both directions. The sentence states a
  // property of the TOOL — `os migrate meta` lists an edit for a key only where
  // the chain has a seam that sees it — so it is TRUE for the one stack
  // collection member and FALSE for the six others; the class pin
  // (`retired-key-migrate-sentence.test.ts`) holds the wording, this pin holds
  // WHERE it may appear.
  if (migrateSentence) {
    expect(issue.message).toMatch(HOUSE_MIGRATE_SENTENCE);
  } else {
    expect(issue.message).not.toMatch(/os migrate meta/);
  }
}

describe('[#16320] cron-typed positions retirement — refusal at every site', () => {
  for (const site of SITES) {
    it(`REJECTS an authored \`${site.qualified}\` at path \`${site.issuePath.join('.')}\`, carrying the prescription`, () => {
      expectTombstoneRefusal(site, site.migrateSentence);
      // Attribution control: the same document WITHOUT the key is accepted, so
      // the refusal above is attributable to the retired key and nothing else.
      expect(site.schema.safeParse(site.wellFormed).success, `${site.qualified}: well-formed control must parse`).toBe(true);
    });
  }

  it('refuses the envelope spelling too — both shapes the old schema accepted are gone', () => {
    // One site per shape of the old input: the bare string (above, all seven)
    // and the `{ dialect, source }` envelope the parse used to normalize to.
    const envelopeSites: Array<[RetiredSite, unknown]> = [
      [SITES[3]!, { ...SYNC_WELL_FORMED, schedule: CRON_ENVELOPE }],
      [SITES[0]!, { ...EXPORT_WELL_FORMED, schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON_ENVELOPE } }],
    ];
    for (const [site, authored] of envelopeSites) {
      const issue = findIssue(site.schema, authored, site.issuePath, `${site.qualified} (envelope)`);
      expect(issue?.code).toBe('invalid_type');
    }
  });

  for (const carrier of CARRIERS) {
    it(`REJECTS \`${carrier.qualified}\` through \`${carrier.via}\`, at path \`${carrier.issuePath.join('.')}\``, () => {
      expectTombstoneRefusal(carrier, carrier.qualified === 'connector.syncConfig.schedule');
      expect(carrier.schema.safeParse(carrier.wellFormed).success, `${carrier.via}: well-formed control must parse`).toBe(true);
    });
  }

  it('REJECTS `connector.syncConfig.schedule` through the registry-bound `/meta/connector` schema', () => {
    // The registry lookup is the real `/meta` entry point — a future rebinding
    // that pointed `connector` at some third shape would pass the carrier pin
    // above and still accept the key in production.
    const schema = getMetadataTypeSchema('connector');
    expect(schema, 'no schema bound for `connector`').toBeDefined();
    const authored = { ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } };
    expect(schema!.safeParse(authored).success).toBe(false);
    expect(schema!.safeParse(CONNECTOR_WELL_FORMED).success).toBe(true);
  });

  it('REJECTS it in `stack.connectors[]` — the real authoring path, and the reason this family converts', async () => {
    const { ObjectStackSchema } = await import('./stack.zod');
    const rejected = ObjectStackSchema.safeParse({
      connectors: [{ ...CONNECTOR_WELL_FORMED, syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON } }],
    });
    expect(rejected.success).toBe(false);
    if (rejected.success) return;
    const issue = rejected.error.issues.find((i) => i.path.join('.') === 'connectors.0.syncConfig.schedule');
    expect(issue, 'the refusal must surface through `connectors[]`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['connectors', 0, 'syncConfig', 'schedule']);
    expect(issue!.message).toMatch(HOUSE_MIGRATE_SENTENCE);
    // Positive control: the identical stack minus the retired key parses.
    expect(ObjectStackSchema.safeParse({ connectors: [CONNECTOR_WELL_FORMED] }).success).toBe(true);
  });
});

describe('[#16320] no-materialize: parsed documents carry none of the seven keys', () => {
  it('on every base schema', () => {
    for (const site of SITES) {
      const parsed = site.schema.parse(site.wellFormed) as Record<string, unknown>;
      let at: unknown = parsed;
      for (const seg of site.issuePath.slice(0, -1)) at = (at as Record<string, unknown>)[seg as string];
      expect(at, `${site.qualified}: the enclosing block must still parse`).toBeDefined();
      expect(at).not.toHaveProperty(String(site.issuePath[site.issuePath.length - 1]));
    }
    // Attribution: the surviving defaults still materialize, so the absences
    // above are the tombstones' doing and not a broken parse.
    expect(ScheduledExportSchema.parse(EXPORT_WELL_FORMED).schedule.timezone).toBe('America/New_York');
    expect(ScheduleExportRequestSchema.parse({ ...EXPORT_WELL_FORMED, schedule: {} }).schedule.timezone).toBe('UTC');
    expect(ScheduleStateSchema.parse(STATE_WELL_FORMED).timezone).toBe('UTC');
    expect(DataSyncConfigSchema.parse(SYNC_WELL_FORMED).realtimeSync).toBe(false);
    expect(CacheWarmupSchema.parse(WARMUP_WELL_FORMED).concurrency).toBe(10);
    expect(BackupConfigSchema.parse(BACKUP_WELL_FORMED).verifyAfterBackup).toBe(true);
  });

  it('`ScheduleState.cronExpression` was REQUIRED — the requiredness left with the key', () => {
    // A tombstone accepts only absence, so a state that never declares a cron
    // now parses; `timezone` / `status` / `nextRunAt` stay by the ruling (it
    // retires the cron position, not the def) and keep their defaults.
    const parsed = ScheduleStateSchema.parse(STATE_WELL_FORMED);
    expect(parsed.status).toBe('active');
    expect(parsed.timezone).toBe('UTC');
    // The other required keys are still required — the requiredness that
    // left is exactly the retired key's.
    expect(ScheduleStateSchema.safeParse({ id: 'sched_002', createdAt: '2026-01-01T00:00:00Z' }).success).toBe(false);
  });
});

describe('[#16320] the tsc channel: the input type of all seven keys is `never`', () => {
  it('fails tsc at every authoring site', () => {
    const sched: ScheduledExport = {
      ...EXPORT_WELL_FORMED,
      // @ts-expect-error — `schedule.cronExpression` is a retiredKey() tombstone: its input type is `never`.
      schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON },
    };
    const request: ScheduleExportRequest = {
      ...EXPORT_WELL_FORMED,
      // @ts-expect-error — the request body's twin tombstone.
      schedule: { ...EXPORT_WELL_FORMED.schedule, cronExpression: CRON },
    };
    const state: ScheduleState = {
      ...STATE_WELL_FORMED,
      // @ts-expect-error — `cronExpression` is a retiredKey() tombstone (and no longer required).
      cronExpression: CRON,
    };
    const sync: DataSyncConfig = {
      ...SYNC_WELL_FORMED,
      // @ts-expect-error — `schedule` is a retiredKey() tombstone.
      schedule: CRON,
    };
    const connector: Connector = {
      ...CONNECTOR_WELL_FORMED,
      // @ts-expect-error — the tombstone reaches through the carrier.
      syncConfig: { ...SYNC_WELL_FORMED, schedule: CRON },
    };
    const warmup: CacheWarmup = {
      ...WARMUP_WELL_FORMED,
      // @ts-expect-error — `schedule` is a retiredKey() tombstone.
      schedule: CRON,
    };
    const cache: DistributedCacheConfig = {
      // @ts-expect-error — the tombstone reaches through the carrier.
      warmup: { ...WARMUP_WELL_FORMED, schedule: CRON },
    };
    const backup: BackupConfig = {
      ...BACKUP_WELL_FORMED,
      // @ts-expect-error — `schedule` is a retiredKey() tombstone.
      schedule: CRON,
    };
    const plan: DisasterRecoveryPlan = {
      ...DR_PLAN_WELL_FORMED,
      // @ts-expect-error — `testing.schedule` is a retiredKey() tombstone.
      testing: { ...DR_TESTING_WELL_FORMED, schedule: CRON },
    };
    // The literals above are typed, so tsc is the assertion; at runtime the
    // same values are refused, which keeps this case from being vacuous.
    for (const [schema, value] of [
      [ScheduledExportSchema, sched],
      [ScheduleExportRequestSchema, request],
      [ScheduleStateSchema, state],
      [DataSyncConfigSchema, sync],
      [ConnectorSchema, connector],
      [CacheWarmupSchema, warmup],
      [DistributedCacheConfigSchema, cache],
      [BackupConfigSchema, backup],
      [DisasterRecoveryPlanSchema, plan],
    ] as Array<[ZodTypeAny, unknown]>) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe('[#16320] ADR-0087 registration — one shape per family', () => {
  it('declares all seven sites under major 18', () => {
    for (const site of SITES) {
      expect(RETIRED_KEYS_BY_MAJOR[18], `${site.registered} must be declared`).toContain(site.registered);
    }
  });

  it('the connector family converts (D2, retired from the load path) and is wired into the step-18 chain', () => {
    const conversion = CONVERSIONS_BY_MAJOR[18]!.find((c) => c.id === CONVERSION_ID);
    expect(conversion, `${CONVERSION_ID} must exist`).toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    // The tombstone owns the live refusal; the conversion replays stored rows
    // and feeds `os migrate meta` — which is what makes the migrate sentence on
    // the connector prescription TRUE of the tool.
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.surface).toBe('connector.syncConfig.schedule');
    // One notice per connector that authored the key — the fixture carries
    // exactly one such connector beside two that keep their identity.
    expect(conversion!.fixture.expectedNotices).toBe(1);
    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step).toBeDefined();
    expect(step!.conversionIds, `${CONVERSION_ID} must be graduated into the step-18 chain`).toContain(CONVERSION_ID);
    // No D3 semantic twin: the strip is fully mechanical, and the `semantic`
    // list is the residue D2 cannot express.
    expect(step!.semantic.filter((s) => /sync-schedule|connector-sync/.test(s.id))).toEqual([]);
  });

  it('the other four families take a D3 semantic entry each, and NO D2 conversion', () => {
    const step = MIGRATIONS_BY_MAJOR[18]!;
    for (const id of SEMANTIC_IDS) {
      const entry = step.semantic.find((s) => s.id === id);
      expect(entry, `${id} must be wired into the step-18 chain`).toBeDefined();
      expect(entry!.reason.length).toBeGreaterThan(0);
      expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
      // The route is stated where the next reader looks: why D3 semantic and
      // not D2 — no stack seam (the additionalTypes precedent).
      expect(entry!.reason).toMatch(/not a D2 conversion/);
    }
    // Deliberately no mechanical conversion for any of them — a transform
    // with no seam that ever runs is the predicted failure this pin closes.
    const strayConversions = step.conversionIds.filter((id) => /export|schedule-state|warmup|backup|disaster/.test(id));
    expect(strayConversions).toEqual([]);
    expect(CONVERSIONS_BY_MAJOR[18]!.filter((c) => /export|schedule-state|warmup|backup|disaster/.test(c.id))).toEqual([]);
  });
});

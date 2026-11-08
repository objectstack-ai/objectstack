// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ceremony's `not-null` step (18.x step 5d, ADR-0131 8e) on a run that
 * resumes from its checkpoint, over a REAL SQLite driver: the NOT NULL is the
 * driver's own drift apply door (the table rebuild), read back from the
 * database's own catalog.
 *
 * The step leaves a table nullable for one of two reasons it states: the
 * composition the run booted declares no object for it (`not-declared`, "re-run
 * the ceremony where the deployment's composition is declared to apply it"), or
 * the table still holds a NULL row the operator must resolve by hand
 * (`UNATTRIBUTABLE_REMEDY`, "then re-run --apply"). Either way the step itself
 * finished, so it is checkpointed. The re-run each advice line names must then
 * apply the NOT NULL it left, not read the checkpoint and skip the step:
 *
 *  - (1) certified with two tables `not-declared`, re-run under a composition
 *    that declares them: both end NOT NULL;
 *  - (2) the walled recovery path — apply, fix the held rows by hand, plan,
 *    apply — ends with NOT NULL on the fixed table, and certifies;
 *  - (3) control: a first run with nothing pending checkpoints exactly as
 *    before, and a re-run of it stays `checkpointed` and rebuilds nothing;
 *  - (4) a re-run whose NOT NULL fails blocks and does not certify, as the
 *    same failure does on a first run.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { buildOrganizationOwnershipPlan, inventoryDigest } from './organization-ownership-plan.js';
import {
  applyOrganizationOwnership,
  reviewedConflictsOf,
  type ApplyExecutor,
  type CeremonyCheckpoint,
  type CeremonyLedgerPort,
  type NotNullPort,
  type OrganizationOwnershipApplyReport,
} from './organization-ownership-apply.js';
import { applyNotNullThroughDrift } from './organization-ownership-not-null.js';

const ORG = 'org_default';
const TABLES = ['crm_deal', 'crm_note', 'crm_task'] as const;

let dir: string;
let file: string;
let db: Database.Database;
let driver: SqlDriver;
/** Tables the drift apply door rebuilt, in order. */
let rebuilt: string[];

function executor(): ApplyExecutor {
  return {
    dialect: 'sqlite',
    client: 'better-sqlite3',
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[];
    },
    async execute(sql, params = []) {
      db.prepare(sql).run(...(params as unknown[]));
    },
  };
}

function ledger(): CeremonyLedgerPort & { stored: () => CeremonyCheckpoint | null } {
  let stored: CeremonyCheckpoint | null = null;
  return {
    stored: () => stored,
    async read() {
      return stored ? (JSON.parse(JSON.stringify(stored)) as CeremonyCheckpoint) : null;
    },
    async write(checkpoint) {
      stored = JSON.parse(JSON.stringify(checkpoint)) as CeremonyCheckpoint;
    },
  };
}

/** Whether the table's tenant column is NOT NULL, read from the database's own catalog. */
const isNotNull = (table: string): boolean =>
  (db.prepare(`SELECT "notnull" AS nn FROM pragma_table_info('${table}') WHERE name = 'organization_id'`).get() as { nn: number }).nn === 1;

/**
 * The command's `notNull` port, as `os migrate organization-ownership` wires
 * it: the drift apply door of the driver, for the tables `declared` (the
 * composition this run booted), the column's nullability read from the catalog.
 */
function schemaDoor(declared: ReadonlySet<string>, opts: { failOn?: string } = {}): NotNullPort {
  return {
    apply: (columns) =>
      applyNotNullThroughDrift(
        {
          isDeclared: (table) => declared.has(table),
          isNotNull: async (table) => isNotNull(table),
          driverFor: () => ({
            applyMigrationEntries: async (entries: never[], options: never) => {
              const table = (entries[0] as { table: string }).table;
              if (table === opts.failOn) throw new Error(`SQLITE_BUSY: ${table} is locked`);
              rebuilt.push(table);
              return driver.applyMigrationEntries(entries, options);
            },
          }) as never,
        },
        columns,
      ),
  };
}

async function apply(
  l: CeremonyLedgerPort,
  notNull: NotNullPort,
  posture = 'single',
): Promise<OrganizationOwnershipApplyReport> {
  const reviewed = await buildOrganizationOwnershipPlan({ reader: executor(), posture, database: file });
  return applyOrganizationOwnership({
    executor: executor(),
    posture,
    database: file,
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: reviewed.generatedAt,
      database: file,
      inventoryDigest: inventoryDigest(),
      posture,
      conflicts: reviewedConflictsOf(reviewed),
    },
    catalog: { async resolve() { return undefined; } },
    notNull,
    door: {
      async save(type, name) {
        throw new Error(`no environment save is expected here (${type} ${name})`);
      },
    },
    templates: { async find() { return undefined; } },
    views: { async list() { return []; } },
    lock: { async verdict() { return { editable: true }; } },
    columnDrops: { async drop(columns) { return columns.map((c) => ({ ...c, outcome: 'dropped' as const })); } },
    ledger: l,
    now: () => new Date('2026-11-08T00:00:00Z'),
  });
}

const step = (report: OrganizationOwnershipApplyReport) => report.steps.find((s) => s.step === 'not-null')!;
const certified = (report: OrganizationOwnershipApplyReport): boolean => report.complete && report.blocking === 0;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-not-null-resume-'));
  file = join(dir, 'db.sqlite');
  rebuilt = [];
  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  (driver as any).logger = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };
  await driver.initObjects(
    TABLES.map((name) => ({
      name,
      fields: { name: { type: 'text' }, organization_id: { type: 'lookup', reference: 'sys_organization', required: false } },
    })) as never,
  );
  // The tables an earlier release built: their tenant column nullable, which a
  // table this release creates never is (ADR-0131 D1). Relaxed through the
  // driver's own drift apply door, the shape of that store.
  for (const table of TABLES) {
    const { applied } = await driver.applyMigrationEntries([
      {
        kind: 'nullability_mismatch', remoteName: table, table, column: 'organization_id', category: 'needs_confirm',
        op: { type: 'relax_not_null', table, column: 'organization_id' },
      } as never,
    ]);
    if (applied.length !== 1) throw new Error(`${table} was not returned to its pre-18 shape`);
  }
  db = new Database(file);
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('${ORG}', 'default');
    INSERT INTO crm_deal (id, name, organization_id) VALUES ('deal_1', 'Acme', '${ORG}');
    INSERT INTO crm_note (id, name, organization_id) VALUES ('note_1', 'Call back', '${ORG}');
    INSERT INTO crm_task (id, name, organization_id) VALUES ('task_1', 'Send quote', '${ORG}');
  `);
  for (const table of TABLES) expect(isNotNull(table)).toBe(false);
});

afterEach(async () => {
  db.close();
  await driver.disconnect?.();
  rmSync(dir, { recursive: true, force: true });
});

describe('the not-null step on a resumed ceremony', () => {
  it('⭐ (1) certified with tables not-declared, re-run under a composition that declares them: they receive NOT NULL', async () => {
    const l = ledger();
    const first = await apply(l, schemaDoor(new Set(['crm_deal'])));
    expect(step(first)).toMatchObject({ status: 'done', summary: { due: 3, applied: 1, notDeclared: 2 } });
    expect(step(first).notes.filter((n) => /re-run the ceremony where the deployment's composition is declared/.test(n))).toHaveLength(2);
    expect(certified(first)).toBe(true);
    expect(TABLES.map(isNotNull)).toEqual([true, false, false]);

    const again = await apply(l, schemaDoor(new Set(TABLES)));
    expect(step(again)).toMatchObject({ status: 'done', summary: { due: 3, applied: 2, alreadyNotNull: 1, notDeclared: 0 } });
    expect(TABLES.map(isNotNull)).toEqual([true, true, true]);
    // The table tightened by the first run is not rebuilt again.
    expect(rebuilt).toEqual(['crm_deal', 'crm_note', 'crm_task']);
    expect(l.stored()!.completed['not-null']!.summary).toMatchObject({ applied: 2, alreadyNotNull: 1, notDeclared: 0 });
    expect(certified(again)).toBe(true);
  });

  it('⭐ (2) the walled recovery path — apply, fix the held rows, plan, apply — ends with NOT NULL on the fixed table', async () => {
    db.exec(`INSERT INTO crm_note (id, name, organization_id) VALUES ('note_orphan', 'nobody', NULL)`);
    const l = ledger();
    const door = schemaDoor(new Set(TABLES));
    const first = await apply(l, door, 'isolated');
    expect(step(first)).toMatchObject({ status: 'done', summary: { due: 2, applied: 2 } });
    expect(TABLES.map(isNotNull)).toEqual([true, false, true]);
    // The held row stops certification, and names the remedy: resolve it by hand, re-run --apply.
    expect(certified(first)).toBe(false);
    expect(first.tables.find((t) => t.object === 'crm_note')!.held).toMatchObject({ rows: 1 });

    db.exec(`UPDATE crm_note SET organization_id = '${ORG}' WHERE id = 'note_orphan'`);
    const plan = await buildOrganizationOwnershipPlan({ reader: executor(), posture: 'isolated', database: file });
    expect(plan.tables.find((t) => t.object === 'crm_note')!.notNull.willReceive).toBe(true);

    const again = await apply(l, door, 'isolated');
    expect(step(again)).toMatchObject({ status: 'done', summary: { due: 3, applied: 1, alreadyNotNull: 2 } });
    expect(TABLES.map(isNotNull)).toEqual([true, true, true]);
    expect(certified(again)).toBe(true);
  });

  it('(3) control — a first run with nothing pending checkpoints as before; its re-run stays checkpointed and rebuilds nothing', async () => {
    const l = ledger();
    const door = schemaDoor(new Set(TABLES));
    const first = await apply(l, door);
    const summary = { applied: 3, alreadyNotNull: 0, due: 3, notDeclared: 0, unsupported: 0 };
    expect(step(first)).toEqual({ step: 'not-null', status: 'done', summary, blockers: [], notes: [] });
    expect(l.stored()!.completed['not-null']).toEqual({ at: '2026-11-08T00:00:00.000Z', summary });
    expect(certified(first)).toBe(true);
    expect(rebuilt).toEqual([...TABLES]);

    const again = await apply(l, door);
    expect(step(again)).toEqual({ step: 'not-null', status: 'checkpointed', summary, blockers: [], notes: [] });
    expect(l.stored()!.completed['not-null']).toEqual({ at: '2026-11-08T00:00:00.000Z', summary });
    expect(rebuilt).toEqual([...TABLES]);
    expect(certified(again)).toBe(true);
  });

  it('(4) a re-run whose NOT NULL fails blocks and does not certify, as the same failure does on a first run', async () => {
    const l = ledger();
    await apply(l, schemaDoor(new Set(['crm_deal'])));
    const again = await apply(l, schemaDoor(new Set(TABLES), { failOn: 'crm_task' }));
    expect(step(again)).toMatchObject({ status: 'blocked', blockers: [expect.stringMatching(/NOT NULL on crm_task\.organization_id failed: SQLITE_BUSY/)] });
    expect(TABLES.map(isNotNull)).toEqual([true, true, false]);
    expect(certified(again)).toBe(false);
    expect(l.stored()!.completed['not-null']).toBeUndefined();
  });
});

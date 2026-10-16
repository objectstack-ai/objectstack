// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 `--apply` on a database whose packages declare sharing
 * rules, while this release's own boot still seeds them
 * (`DECLARED_SHARING_RULE_SEEDER_RUNS`, the inventory).
 *
 * The fixture is HotCRM's measured shape: eleven uncustomized declared rules
 * the seeder wrote organization-less (`managed_by 'package'`, `customized 0`),
 * beside an organization-authored rule and a customized declared rule with no
 * organization, plus a column-drop table still carrying `organization_id`.
 *
 *  - On this release the eleven are the `declared-rule-mirrors` departure, and
 *    no step of it can remove them: the run reports them as advisory — named,
 *    counted, still NULL, never deleted — and the verdict is `blocking 0`.
 *  - The restore: the release that retires the seeder flips the constant, and
 *    the same fixture then holds certification on the same eleven rows again.
 *  - The rule is keyed on the table AND the departure id: a host fate
 *    supplement departure of the same id on its own table still blocks.
 *
 * The command face of the same verdict (the ledger marker, the boot guard,
 * the served boot that seeds the rows) is
 * `commands/migrate/organization-ownership.declared-rule-mirrors.integration.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOrganizationOwnershipPlan, inventoryDigest } from './organization-ownership-plan.js';
import {
  applyOrganizationOwnership,
  reviewedConflictsOf,
  type ApplyExecutor,
  type CeremonyCheckpoint,
  type CeremonyLedgerPort,
  type ColumnDropPort,
  type OrganizationOwnershipApplyReport,
  type TableOutcome,
} from './organization-ownership-apply.js';
import { mergeHostFateSupplement, type InventoryEntry } from './organization-ownership-inventory.js';

/**
 * The restore case answers as the release that retires the seeder will
 * (`runs: false`); every other case reads the shipped constant, through the
 * real function, untouched (`runs: undefined`).
 */
const seeder = vi.hoisted(() => ({ runs: undefined as boolean | undefined }));
vi.mock('./organization-ownership-inventory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./organization-ownership-inventory.js')>();
  return {
    ...actual,
    advisoryDepartureReason: (object: string, departureId: string) =>
      seeder.runs === undefined
        ? actual.advisoryDepartureReason(object, departureId)
        : actual.advisoryDepartureReason(object, departureId, seeder.runs),
  };
});

const MIRRORS = 11;
const CITE = 'fixture: a host-declared fate (test data, not any host\'s declaration)';

let dir: string;
let db: Database.Database;
/** Every write statement the ceremony issued, in order. */
let writes: string[];

function executor(): ApplyExecutor {
  return {
    dialect: 'sqlite',
    client: 'better-sqlite3',
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[];
    },
    async execute(sql, params = []) {
      writes.push(sql);
      db.prepare(sql).run(...(params as unknown[]));
    },
  };
}

const columnDrops: ColumnDropPort = {
  async drop(columns) {
    return columns.map(({ table, column }) => {
      writes.push(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      return { table, column, outcome: 'dropped' as const };
    });
  },
};

type Verdict = { complete: boolean; blocking: number; advisory: number };

function ledger(): CeremonyLedgerPort & { verdicts: Verdict[] } {
  let stored: CeremonyCheckpoint | null = null;
  const verdicts: Verdict[] = [];
  return {
    verdicts,
    async read() {
      return stored ? (JSON.parse(JSON.stringify(stored)) as CeremonyCheckpoint) : null;
    },
    async write(checkpoint, verdict) {
      stored = JSON.parse(JSON.stringify(checkpoint)) as CeremonyCheckpoint;
      verdicts.push(verdict);
    },
  };
}

/** Plan, then apply that reviewed plan, under `single`, as the command does. */
async function apply(l: ReturnType<typeof ledger>, inventory?: readonly InventoryEntry[]): Promise<OrganizationOwnershipApplyReport> {
  const database = join(dir, 'fixture.db');
  const reviewed = await buildOrganizationOwnershipPlan({
    reader: executor(),
    posture: 'single',
    database,
    ...(inventory ? { inventory } : {}),
  });
  return applyOrganizationOwnership({
    executor: executor(),
    posture: 'single',
    database,
    ...(inventory ? { inventory } : {}),
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: reviewed.generatedAt,
      database,
      inventoryDigest: inventoryDigest(inventory),
      posture: 'single',
      conflicts: reviewedConflictsOf(reviewed),
    },
    catalog: { async resolve() { return undefined; } },
    door: {
      async save(type, name) {
        throw new Error(`no environment save is expected here (${type} ${name})`);
      },
    },
    templates: { async find() { return undefined; } },
    views: { async list() { return []; } },
    lock: { async verdict() { return { editable: true }; } },
    columnDrops,
    ledger: l,
    now: () => new Date('2026-10-16T00:00:00Z'),
  });
}

const rows = (sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[];
const tableOf = (report: OrganizationOwnershipApplyReport, object: string): TableOutcome =>
  report.tables.find((t) => t.object === object)!;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-declared-rule-mirrors-'));
  db = new Database(join(dir, 'fixture.db'));
  writes = [];
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default');
    CREATE TABLE sys_sharing_rule (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, object_name TEXT,
      managed_by TEXT, customized INTEGER);
    INSERT INTO sys_sharing_rule VALUES
      ('rule_org', 'org_default', 'mine', 'crm_deal', 'admin', 0),
      ('rule_customized', NULL, 'share_custom', 'crm_deal', 'package', 1);
    CREATE TABLE sys_job (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    INSERT INTO sys_job VALUES ('job_v17', NULL, 'nightly');
  `);
  const mirror = db.prepare(`INSERT INTO sys_sharing_rule VALUES (?, NULL, ?, 'crm_deal', 'package', 0)`);
  for (let i = 1; i <= MIRRORS; i++) mirror.run(`rule_declared_${String(i).padStart(2, '0')}`, `share_declared_${i}`);
});

afterEach(() => {
  seeder.runs = undefined;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the declared sharing-rule mirrors while this release\'s boot still seeds them', () => {
  it('blocking 0: the eleven are advisory — named, counted, still NULL, never deleted — and the verdict certifies', async () => {
    const l = ledger();
    const report = await apply(l);

    expect([report.complete, report.blocking, report.advisory]).toEqual([true, 0, MIRRORS]);
    expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: 0, advisory: MIRRORS });
    const rule = tableOf(report, 'sys_sharing_rule');
    expect(rule.departures).toEqual([
      {
        id: 'declared-rule-mirrors',
        label: expect.stringMatching(/^uncustomized declared sharing rules/),
        as: 'mirror-deletion',
        rows: MIRRORS,
        advisory: expect.stringMatching(/^this release's own boot still writes them .* \(ADR-0131 D2\) deletes them$/),
      },
    ]);
    expect(rule.remaining).toBe(0);
    expect(rule.notNull).toEqual({
      willReceive: false,
      reason: `${MIRRORS} row(s) stay NULL on this release, reported as advisory: ${rule.departures[0]!.label}`,
    });
    expect(report.warnings).toEqual([expect.stringMatching(new RegExp(`^sys_sharing_rule holds ${MIRRORS} organization-less row\\(s\\) of `))]);
    // The customized rule is no mirror: it took the Default Organization. The
    // mirrors kept NULL, and nothing of the table was deleted.
    expect(rows(`SELECT COUNT(*) AS n, SUM(organization_id IS NULL) AS nulls FROM sys_sharing_rule`)).toEqual([{ n: MIRRORS + 2, nulls: MIRRORS }]);
    expect(rows(`SELECT organization_id FROM sys_sharing_rule WHERE id = 'rule_customized'`)).toEqual([{ organization_id: 'org_default' }]);
    expect(writes.filter((w) => /^DELETE/i.test(w))).toEqual([]);
    expect(tableOf(report, 'sys_job').columnDropped).toBe(true);
  });

  it('the restore: once the seeder retires, the same fixture holds certification on the same eleven rows again', async () => {
    seeder.runs = false;
    const l = ledger();
    const report = await apply(l);

    expect([report.complete, report.blocking, report.advisory]).toEqual([true, MIRRORS, 0]);
    expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: MIRRORS, advisory: 0 });
    const rule = tableOf(report, 'sys_sharing_rule');
    expect(rule.departures).toEqual([{ id: 'declared-rule-mirrors', label: expect.any(String), as: 'mirror-deletion', rows: MIRRORS }]);
    expect(rule.remaining).toBe(MIRRORS);
    expect(rule.notNull).toEqual({ willReceive: false, reason: expect.stringMatching(new RegExp(`^${MIRRORS} row\\(s\\) still wait for a step not yet run: `)) });
    expect(report.warnings).toEqual([]);
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: MIRRORS + 2 }]);
  });

  it('keyed on the table: a host-declared departure under the same id on its own table still blocks, beside the advisory mirrors', async () => {
    db.exec(`
      CREATE TABLE sys_fixture_rule_copy (id TEXT PRIMARY KEY, organization_id TEXT, managed_by TEXT);
      INSERT INTO sys_fixture_rule_copy VALUES ('copy_1', NULL, 'package'), ('copy_2', NULL, 'package');
    `);
    const inventory = mergeHostFateSupplement(
      [
        {
          object: 'sys_fixture_rule_copy',
          fate: 'report',
          citation: CITE,
          departures: [
            {
              id: 'declared-rule-mirrors',
              label: 'a host table\'s seeded copies, removed by a step no ceremony runs',
              citation: CITE,
              as: 'mirror-deletion',
              where: [{ column: 'managed_by', equals: 'package' }],
            },
          ],
        },
      ],
      'host-fates.json',
    );
    const l = ledger();
    const report = await apply(l, inventory);

    expect([report.complete, report.blocking, report.advisory]).toEqual([true, 2, MIRRORS]);
    expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: 2, advisory: MIRRORS });
    const copy = tableOf(report, 'sys_fixture_rule_copy');
    expect(copy.remaining).toBe(2);
    expect(copy.departures).toEqual([{ id: 'declared-rule-mirrors', label: expect.any(String), as: 'mirror-deletion', rows: 2 }]);
    expect(tableOf(report, 'sys_sharing_rule').remaining).toBe(0);
  });
});

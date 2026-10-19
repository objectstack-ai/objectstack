// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 `--apply` on `sys_activity`'s organization-less rows
 * (ruling record 6257510973 item 3, Q3 A): activity is written only when an
 * organization is derivable, never as a NULL row, and the ceremony deletes the
 * existing NULL rows no anchor attributes — 14-day telemetry, whose change the
 * deployment ledger (`sys_audit_log`, D7) keeps.
 *
 * The fixture is a sign-up's measured shape: activity about a `sys_user` (an
 * object with no organization column) written NULL, beside a NULL activity
 * row about an organization's record and an activity row already stamped.
 *
 *  - Walled (`isolated`): the row about the organization's record takes its
 *    organization from the subject anchor; the two about the user, which no
 *    anchor attributes, are deleted by the mirror-deletion step; the stamped
 *    row is untouched. The plan says so before the first write, and the
 *    verdict certifies with nothing remaining.
 *  - `single`: the Default Organization takes the user's rows, as a
 *    single-posture boot gives it every row it writes; nothing is deleted.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOrganizationOwnershipPlan, inventoryDigest, type OrganizationOwnershipPlan } from './organization-ownership-plan.js';
import {
  applyOrganizationOwnership,
  reviewedConflictsOf,
  type ApplyExecutor,
  type CeremonyCheckpoint,
  type CeremonyLedgerPort,
  type ColumnDropPort,
  type OrganizationOwnershipApplyReport,
} from './organization-ownership-apply.js';

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
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      return { table, column, outcome: 'dropped' as const };
    });
  },
};

function ledger(): CeremonyLedgerPort {
  let stored: CeremonyCheckpoint | null = null;
  return {
    async read() {
      return stored ? (JSON.parse(JSON.stringify(stored)) as CeremonyCheckpoint) : null;
    },
    async write(checkpoint) {
      stored = JSON.parse(JSON.stringify(checkpoint)) as CeremonyCheckpoint;
    },
  };
}

const database = (): string => join(dir, 'fixture.db');

const plan = (posture: string): Promise<OrganizationOwnershipPlan> =>
  buildOrganizationOwnershipPlan({ reader: executor(), posture, database: database() });

/** Plan, then apply that reviewed plan, as the command does. */
async function apply(posture: string, l = ledger()): Promise<OrganizationOwnershipApplyReport> {
  const reviewed = await plan(posture);
  return applyOrganizationOwnership({
    executor: executor(),
    posture,
    database: database(),
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: reviewed.generatedAt,
      database: database(),
      inventoryDigest: inventoryDigest(),
      posture,
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
    now: () => new Date('2026-10-19T00:00:00Z'),
  });
}

const activity = (): Record<string, unknown>[] =>
  db.prepare(`SELECT id, organization_id FROM sys_activity ORDER BY id`).all() as Record<string, unknown>[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-underivable-activity-'));
  db = new Database(database());
  writes = [];
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default'), ('org_a', 'acme');
    CREATE TABLE sys_user (id TEXT PRIMARY KEY, name TEXT, email TEXT);
    INSERT INTO sys_user VALUES ('usr_1', 'Ada', 'ada@example.com');
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    INSERT INTO crm_deal VALUES ('deal_1', 'org_a', 'Acme renewal');
    CREATE TABLE sys_activity (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, object_name TEXT, record_id TEXT);
    INSERT INTO sys_activity VALUES
      ('act_deal_null', NULL, 'created', 'crm_deal', 'deal_1'),
      ('act_deal_stamped', 'org_a', 'updated', 'crm_deal', 'deal_1'),
      ('act_user_created', NULL, 'created', 'sys_user', 'usr_1'),
      ('act_user_updated', NULL, 'updated', 'sys_user', 'usr_1');
  `);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('sys_activity rows no organization is derivable for (ruling record 6257510973 item 3)', () => {
  it('walled: the plan counts the two underivable rows as departing, says so before the first write, and reports none', async () => {
    const reviewed = await plan('isolated');
    const table = reviewed.tables.find((t) => t.object === 'sys_activity')!;
    expect(table.fateCounts).toMatchObject({ rowsToAttribute: 1, departingRows: 2, unattributableRows: 0 });
    expect(table.departures).toEqual([expect.objectContaining({ id: 'underivable-activity', as: 'mirror-deletion', rows: 2 })]);
    expect(table.unattributable).toEqual([]);
    expect(table.notNull.willReceive).toBe(true);
    expect(reviewed.warnings).toEqual([expect.stringMatching(/^sys_activity holds 2 organization-less row\(s\) no anchor attributes: .*--apply deletes them/)]);
  });

  it('walled: the anchored row takes its organization, the two about the user are deleted, the stamped row stays; nothing remains', async () => {
    const report = await apply('isolated');

    expect([report.complete, report.blocking]).toEqual([true, 0]);
    const table = report.tables.find((t) => t.object === 'sys_activity')!;
    expect(table).toMatchObject({ attributed: 1, deleted: 2, remaining: 0, unattributable: [], departures: [] });
    expect(table.after).toEqual({ total: 2, organizationNull: 0 });
    expect(activity()).toEqual([
      { id: 'act_deal_null', organization_id: 'org_a' },
      { id: 'act_deal_stamped', organization_id: 'org_a' },
    ]);
    // Deleted after attribution, by the mirror-deletion step, NULL rows only.
    const deletes = writes.filter((w) => /^DELETE FROM "sys_activity"/i.test(w));
    expect(deletes).toEqual(['DELETE FROM "sys_activity" WHERE "organization_id" IS NULL']);
    expect(writes.findIndex((w) => /^UPDATE "sys_activity"/i.test(w))).toBeLessThan(writes.indexOf(deletes[0]!));
    expect(report.steps.find((s) => s.step === 'mirror-deletion')).toMatchObject({ status: 'done', summary: { deleted: 2 } });
  });

  it('walled: a second run finds nothing to delete and writes nothing to the table', async () => {
    const l = ledger();
    await apply('isolated', l);
    writes = [];
    const again = await apply('isolated', l);
    expect([again.complete, again.blocking]).toEqual([true, 0]);
    expect(writes.filter((w) => /sys_activity/.test(w))).toEqual([]);
  });

  it('single: the Default Organization takes the user\'s rows, and nothing is deleted', async () => {
    const reviewed = await plan('single');
    const table = reviewed.tables.find((t) => t.object === 'sys_activity')!;
    expect(table.departures).toEqual([]);
    expect(table.attribution).toMatchObject({ 'default-organization': 2 });
    expect(reviewed.warnings).toEqual([]);

    const report = await apply('single');
    expect([report.complete, report.blocking]).toEqual([true, 0]);
    expect(report.tables.find((t) => t.object === 'sys_activity')).toMatchObject({ attributed: 3, deleted: 0, remaining: 0 });
    expect(activity()).toEqual([
      { id: 'act_deal_null', organization_id: 'org_a' },
      { id: 'act_deal_stamped', organization_id: 'org_a' },
      { id: 'act_user_created', organization_id: 'org_default' },
      { id: 'act_user_updated', organization_id: 'org_default' },
    ]);
    expect(writes.filter((w) => /^DELETE FROM "sys_activity"/i.test(w))).toEqual([]);
  });
});

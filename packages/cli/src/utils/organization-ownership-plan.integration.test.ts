// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 preflight against a fixture database carrying each fate:
 * the per-table plan (fate, counts, the unattributable ids, NOT NULL
 * readiness), the refusal of every table it cannot enumerate, and the control
 * — a run leaves the database byte-identical and issues SELECTs only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildOrganizationOwnershipPlan,
  OrganizationOwnershipPlanRefusal,
  type OrganizationOwnershipPlan,
  type PlanReader,
  type TablePlan,
} from './organization-ownership-plan.js';

let dir: string;
let file: string;
let db: Database.Database;

/** Every statement the plan issued, in order. */
let statements: string[];

function reader(opts: { client?: string; failOn?: RegExp } = {}): PlanReader {
  return {
    client: opts.client ?? 'better-sqlite3',
    async query(sql, params = []) {
      statements.push(sql);
      if (opts.failOn?.test(sql)) throw new Error('SQLITE_IOERR: disk I/O error');
      return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[];
    },
  };
}

const plan = (posture: string, r = reader()): Promise<OrganizationOwnershipPlan> =>
  buildOrganizationOwnershipPlan({ reader: r, posture, database: file, now: new Date('2026-10-10T00:00:00Z') });

const table = (p: OrganizationOwnershipPlan, object: string): TablePlan => {
  const found = p.tables.find((t) => t.object === object);
  if (!found) throw new Error(`no ${object} in the plan`);
  return found;
};

async function refusal(promise: Promise<unknown>): Promise<OrganizationOwnershipPlanRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OrganizationOwnershipPlanRefusal) return error;
    throw error;
  }
  throw new Error('the plan did not refuse');
}

/** A 17.x-shaped database carrying every fate. */
function seed(): void {
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default'), ('org_b', 'b');

    -- fate 1: a D7 object whose physical column is still there
    CREATE TABLE sys_job (id TEXT PRIMARY KEY, organization_id TEXT);
    INSERT INTO sys_job VALUES ('job_1', NULL), ('job_2', 'org_b');
    -- fate 1, nothing to drop: better-auth's own table
    CREATE TABLE sys_user (id TEXT PRIMARY KEY, email TEXT);
    INSERT INTO sys_user VALUES ('usr_1', 'a@example.com');
    -- fate 1 with the ruled promotion categories
    CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT, package_id TEXT);
    INSERT INTO sys_metadata VALUES
      ('md_1', NULL, 'object', 'crm_deal', 'active', NULL),
      ('md_2', 'org_default', 'view', 'deal_list', 'active', NULL),
      ('md_3', 'org_b', 'view', 'deal_list', 'active', NULL),
      ('md_4', 'org_b', 'flow', 'escalate', 'active', NULL);

    -- fate 2: the catalog, seeded mirrors beside one Setup-authored row
    CREATE TABLE sys_position (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, managed_by TEXT);
    INSERT INTO sys_position VALUES
      ('pos_1', NULL, 'org_admin', 'platform'),
      ('pos_2', 'org_b', 'org_admin', 'platform'),
      ('pos_3', 'org_b', 'sales_rep', 'admin');

    -- fate 3: a subject anchor, a parent anchor, and one row nothing derives
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    INSERT INTO crm_deal VALUES ('deal_1', 'org_b', 'Acme'), ('deal_2', NULL, 'Orphan');
    CREATE TABLE sys_approval_request (id TEXT PRIMARY KEY, organization_id TEXT, object_name TEXT, record_id TEXT);
    INSERT INTO sys_approval_request VALUES
      ('req_1', NULL, 'crm_deal', 'deal_1'),
      ('req_2', NULL, 'crm_deal', 'deal_missing'),
      ('req_3', 'org_b', 'crm_deal', 'deal_1');
    CREATE TABLE sys_approval_action (id TEXT PRIMARY KEY, organization_id TEXT, request_id TEXT);
    INSERT INTO sys_approval_action VALUES ('act_1', NULL, 'req_3'), ('act_2', NULL, 'req_2');
    -- fate 3 with a departure: the global rung moves out before the gate
    CREATE TABLE sys_setting (id TEXT PRIMARY KEY, organization_id TEXT, scope TEXT);
    INSERT INTO sys_setting VALUES ('set_1', NULL, 'global'), ('set_2', 'org_b', 'tenant');

    -- outside the ceremony: no column, no inventory row
    CREATE TABLE _objectstack_sequences (name TEXT PRIMARY KEY, value INTEGER);
  `);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-c7a-plan-'));
  file = join(dir, 'fixture.db');
  db = new Database(file);
  statements = [];
  seed();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ADR-0131 D10 preflight — the per-table plan', () => {
  it('names each fate with its counts, the unattributable ids, and NOT NULL readiness (isolated)', async () => {
    const p = await plan('isolated');

    expect(p).toMatchObject({ readOnly: true, ceremonyVersion: 1, posture: 'isolated', organizations: 2 });
    expect(p.defaultOrganization).toEqual({ id: 'org_default', slug: 'default' });

    expect(table(p, 'sys_job')).toMatchObject({
      fate: 'column-drop',
      rows: { total: 2, organizationNull: 1, stamped: 1 },
      fateCounts: { columnPresent: true, rowsLosingTheirStamp: 1 },
      notNull: { willReceive: false },
    });
    expect(table(p, 'sys_user')).toMatchObject({ fate: 'column-drop', organizationColumn: 'absent', fateCounts: { columnPresent: false } });

    const metadata = table(p, 'sys_metadata');
    expect(metadata.fate).toBe('column-drop');
    expect(Object.fromEntries(metadata.categories.map((c) => [c.id, c.groups ?? c.rows]))).toEqual({
      'organization-presentational-promotion': 2,
      'organization-presentational-conflicts': 1, // deal_list, held by two organizations
      'organization-scoped-other-types': 1,
      'environment-overlay-duplicates': 1, // (view, deal_list, no package) twice once the organization leaves the key
    });

    expect(table(p, 'sys_position')).toMatchObject({
      fate: 'mirror-deletion',
      fateCounts: { mirrorRows: 2, nonMirrorRows: 1 },
      categories: [expect.objectContaining({ id: 'authored', rows: 1 })],
      notNull: { willReceive: false },
    });

    const requests = table(p, 'sys_approval_request');
    expect(requests).toMatchObject({ fate: 'attribution', attribution: { 'subject:object_name/record_id': 1 } });
    expect(requests.unattributable).toEqual([{ id: 'req_2', reason: 'crm_deal row deal_missing not found' }]);
    expect(requests.notNull.willReceive).toBe(false);

    const actions = table(p, 'sys_approval_action');
    expect(actions.attribution).toEqual({ 'parent:request_id->sys_approval_request': 1 });
    expect(actions.unattributable).toEqual([{ id: 'act_2', reason: 'sys_approval_request row req_2 has no organization' }]);

    // An application object: the default fate, its NULL row reported under a wall.
    expect(table(p, 'crm_deal')).toMatchObject({ source: 'application-default', fate: 'attribution', unattributable: [{ id: 'deal_2' }] });

    const settings = table(p, 'sys_setting');
    expect(settings.departures).toEqual([expect.objectContaining({ id: 'global-rung-move', as: 'moved', rows: 1 })]);
    expect(settings).toMatchObject({ unattributable: [], notNull: { willReceive: true } });

    // An inventoried object with no table here is ABSENT — never a table of zero rows.
    expect(table(p, 'sys_view_definition')).toMatchObject({ physical: 'absent', rows: null, tables: [] });

    expect(p.summary.notNull.willReceive).toEqual(['sys_setting']);
    expect(p.summary.notNull.willNotReceive).toEqual(
      expect.arrayContaining(['sys_approval_action', 'sys_approval_request', 'crm_deal', 'sys_job', 'sys_metadata', 'sys_position']),
    );
    expect(p.summary.unattributableRows).toBe(3);
    expect(p.summary.outsideCeremony).toBe(1);
  });

  it('under single, what no anchor derives falls to the Default Organization, and the tables clear', async () => {
    const p = await plan('single');
    const requests = table(p, 'sys_approval_request');
    expect(requests.attribution).toEqual({ 'subject:object_name/record_id': 1, 'default-organization': 1 });
    expect(requests.unattributable).toEqual([]);
    expect(requests.notNull.willReceive).toBe(true);
    expect(table(p, 'crm_deal').attribution).toEqual({ 'default-organization': 1 });
    expect(p.summary.unattributableRows).toBe(0);
  });

  it('under single with no Default Organization, nothing is assigned and the reason says why', async () => {
    db.exec("UPDATE sys_organization SET slug = 'renamed' WHERE id = 'org_default'");
    const p = await plan('single');
    expect(p.defaultOrganization).toBeNull();
    expect(table(p, 'crm_deal').unattributable).toEqual([
      { id: 'deal_2', reason: expect.stringContaining("no Default Organization (slug 'default')") },
    ]);
  });
});

describe('ADR-0131 D10 preflight — it refuses a table it cannot enumerate, naming it', () => {
  it('a platform table carrying the column that the inventory gives no fate', async () => {
    db.exec('CREATE TABLE sys_mystery (id TEXT PRIMARY KEY, organization_id TEXT)');
    const r = await refusal(plan('isolated'));
    expect(r).toMatchObject({ code: 'PLAN_REFUSED', reason: 'uninventoried-platform-table', table: 'sys_mystery' });
  });

  it('a table whose read fails', async () => {
    const r = await refusal(plan('isolated', reader({ failOn: /FROM "sys_approval_action"/ })));
    expect(r).toMatchObject({ reason: 'unreadable-table', table: 'sys_approval_action' });
  });

  it('a table lacking a column its fate reads', async () => {
    db.exec('DROP TABLE sys_position; CREATE TABLE sys_position (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT)');
    const r = await refusal(plan('isolated'));
    expect(r).toMatchObject({ reason: 'missing-column', table: 'sys_position' });
    expect(r.message).toContain('managed_by');
  });

  it('a driver with no catalog statement', async () => {
    const r = await refusal(plan('isolated', reader({ client: 'oracledb' })));
    expect(r.reason).toBe('driver-unsupported');
  });

  it('a database that is not an ObjectStack one (the wrong --database-url)', async () => {
    db.exec('DROP TABLE sys_organization');
    const r = await refusal(plan('isolated'));
    expect(r.reason).toBe('not-an-objectstack-database');
  });

  it('a table whose name cannot be quoted', async () => {
    db.exec('CREATE TABLE "sys bad" (id TEXT, organization_id TEXT)');
    const r = await refusal(plan('isolated'));
    expect(r).toMatchObject({ reason: 'unsafe-identifier', table: 'sys bad' });
  });
});

describe('ADR-0131 D10 preflight — the control: it writes nothing', () => {
  it('leaves the database byte-identical and issues SELECT statements only', async () => {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const digest = (): string => createHash('sha256').update(readFileSync(file)).digest('hex');
    const dump = (): unknown =>
      (db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all() as Array<{ name: string }>).map((t) => ({
        ...t,
        rows: /^sqlite_/.test(t.name) || !/^[a-z_]+$/.test(t.name) ? null : db.prepare(`SELECT * FROM "${t.name}" ORDER BY 1`).all(),
      }));
    const before = { bytes: digest(), dump: dump() };

    await plan('isolated');
    await plan('single');

    expect({ bytes: digest(), dump: dump() }).toEqual(before);
    expect(statements.length).toBeGreaterThan(20);
    expect(statements.filter((s) => !/^SELECT\b/.test(s.trim()))).toEqual([]);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 plan reading a host fate supplement (the inventory's C10
 * stage): a host declares the fates of the objects it provides, and the plan
 * reads them the way it reads the platform's own rows.
 *
 * The two fixtures are SHAPED like a host's control-plane database and its
 * tenant database. They carry the tables the card names (seven on the control
 * database, three on a tenant database) and labelled placeholders for the two
 * wildcard families (`sys_billing_fixture_N`, `ai_fixture_N`). ⛔ They are not
 * any host's real table list, and the supplement below is test data, not any
 * host's declaration: the real list and its fates are the host's to declare in
 * its own supplement.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildOrganizationOwnershipPlan,
  inventoryDigest,
  OrganizationOwnershipPlanRefusal,
  type OrganizationOwnershipPlan,
  type PlanReader,
  type TablePlan,
} from './organization-ownership-plan.js';
import { readHostFateSupplement, type InventoryEntry } from './organization-ownership-inventory.js';

const CITE = 'fixture: a host-declared fate (test data, not any host\'s declaration)';

/** The card's seven control-database tables, and its three tenant-database tables. */
const CONTROL_NAMED = [
  'sys_quota_usage', 'sys_domain', 'sys_slug_reservation', 'sys_cloud_connection', 'sys_ai_credit_grant',
  'sys_environment_usage', 'sys_environment_revision',
];
const TENANT_NAMED = ['sys_env_artifact_cache', 'sys_seed_replay', 'sys_seed_replay_claim'];
/** Labelled placeholders for the two wildcard families (×7 and ×8). */
const BILLING = Array.from({ length: 7 }, (_, i) => `sys_billing_fixture_${i + 1}`);
const AI = Array.from({ length: 8 }, (_, i) => `ai_fixture_${i + 1}`);

const CONTROL_HOST_TABLES = [...BILLING, ...CONTROL_NAMED, ...AI];
const TENANT_HOST_TABLES = [...AI, ...TENANT_NAMED];

/**
 * ONE supplement for both database kinds: every host object, whichever
 * database holds it. The named tables take fate 4 (listed, nothing guessed);
 * two placeholders exercise fates 3 and 1.
 */
const SUPPLEMENT = [
  ...[...CONTROL_NAMED, ...TENANT_NAMED, ...BILLING.slice(1), ...AI.slice(1)].map((object) => ({ object, fate: 'report', citation: CITE })),
  { object: BILLING[0], fate: 'attribution', citation: CITE, anchors: [{ kind: 'parent', childKey: 'account_id', parentObject: BILLING[1] }] },
  { object: AI[0], fate: 'column-drop', citation: CITE },
];

let dir: string;
const dbs: Database.Database[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-host-supplement-plan-'));
});

afterEach(() => {
  while (dbs.length) dbs.pop()!.close();
  rmSync(dir, { recursive: true, force: true });
});

function open(name: string, ddl: string): { db: Database.Database; file: string; reader: PlanReader } {
  const file = join(dir, `${name}.db`);
  const db = new Database(file);
  dbs.push(db);
  db.exec(ddl);
  return {
    db,
    file,
    reader: { dialect: 'sqlite', client: 'better-sqlite3', query: async (sql, params = []) => db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[] },
  };
}

/** A host table carrying the anchor, one stamped row and one NULL row. */
const hostTable = (name: string, extra = ''): string =>
  `CREATE TABLE ${name} (id TEXT PRIMARY KEY, organization_id TEXT${extra});
   INSERT INTO ${name} (id, organization_id) VALUES ('${name}_1', 'org_b'), ('${name}_2', NULL);`;

const PLATFORM = `
  CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
  INSERT INTO sys_organization VALUES ('org_default', 'default'), ('org_b', 'b');
  CREATE TABLE sys_job (id TEXT PRIMARY KEY, organization_id TEXT);
  INSERT INTO sys_job VALUES ('job_1', NULL);
  CREATE TABLE _objectstack_sequences (name TEXT PRIMARY KEY, value INTEGER);
`;

const controlPlane = (omit: readonly string[] = []) =>
  open('control', [
    PLATFORM,
    ...CONTROL_HOST_TABLES.filter((t) => !omit.includes(t)).map((t) => hostTable(t, t === BILLING[0] ? ', account_id TEXT' : '')),
    `UPDATE ${BILLING[0]} SET account_id = '${BILLING[1]}_1' WHERE id = '${BILLING[0]}_2';`,
  ].join('\n'));

const tenant = (omit: readonly string[] = []) =>
  open('tenant', [PLATFORM, ...TENANT_HOST_TABLES.filter((t) => !omit.includes(t)).map((t) => hostTable(t))].join('\n'));

async function supplement(rows: readonly unknown[] = SUPPLEMENT): Promise<readonly InventoryEntry[]> {
  const file = join(dir, `fates-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(rows));
  return readHostFateSupplement(file);
}

const plan = (reader: PlanReader, database: string, inventory?: readonly InventoryEntry[]): Promise<OrganizationOwnershipPlan> =>
  buildOrganizationOwnershipPlan({ reader, posture: 'isolated', database, now: new Date('2026-10-13T00:00:00Z'), ...(inventory ? { inventory } : {}) });

const tableOf = (p: OrganizationOwnershipPlan, object: string): TablePlan => {
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

describe('pin 1 — a host-declared fate is planned like a platform row', () => {
  it('a host row with a platform row\'s fate and anchor plans to the platform row\'s answer, field for field', async () => {
    // The platform's own sys_approval_action (fate 3, parent request_id -> sys_approval_request)
    // beside a host table holding the same rows under the same declared fate.
    const rows = "('act_1', NULL, 'req_1'), ('act_2', NULL, 'req_2'), ('act_3', 'org_b', 'req_1')";
    const { reader, file } = open('pin1', `
      ${PLATFORM}
      CREATE TABLE sys_approval_request (id TEXT PRIMARY KEY, organization_id TEXT, object_name TEXT, record_id TEXT);
      INSERT INTO sys_approval_request VALUES ('req_1', 'org_b', NULL, NULL), ('req_2', NULL, NULL, NULL);
      CREATE TABLE sys_approval_action (id TEXT PRIMARY KEY, organization_id TEXT, request_id TEXT);
      INSERT INTO sys_approval_action VALUES ${rows};
      CREATE TABLE sys_billing_fixture_1 (id TEXT PRIMARY KEY, organization_id TEXT, request_id TEXT);
      INSERT INTO sys_billing_fixture_1 VALUES ${rows};
    `);
    const inventory = await supplement([
      { object: 'sys_billing_fixture_1', fate: 'attribution', citation: CITE, anchors: [{ kind: 'parent', childKey: 'request_id', parentObject: 'sys_approval_request' }] },
    ]);
    const p = await plan(reader, file, inventory);

    const strip = ({ object: _o, citation: _c, census: _s, tables: _t, ...rest }: TablePlan) => rest;
    const platform = tableOf(p, 'sys_approval_action');
    const declared = tableOf(p, 'sys_billing_fixture_1');
    expect(declared).toMatchObject({ source: 'inventory', census: ['host-supplement'], fate: 'attribution', citation: CITE });
    expect(strip(declared)).toEqual(strip(platform));
    // The answer is a real one, not two empty plans agreeing.
    expect(declared.attribution).toEqual({ 'parent:request_id->sys_approval_request': 1 });
    expect(declared.unattributable).toEqual([{ id: 'act_2', reason: 'sys_approval_request row req_2 has no organization' }]);

    // Control: without the supplement the same database is refused at that table.
    expect(await refusal(plan(reader, file))).toMatchObject({ reason: 'uninventoried-platform-table', table: 'sys_billing_fixture_1' });
  });

  it('the plan\'s inventoryDigest covers the merged list, so the apply checkpoint is keyed on the supplement', async () => {
    const { reader, file } = controlPlane();
    const inventory = await supplement();
    const p = await plan(reader, file, inventory);
    expect(p.inventoryDigest).toBe(inventoryDigest(inventory));
    // Control: the platform inventory alone has another digest.
    expect(p.inventoryDigest).not.toBe(inventoryDigest());
  });
});

describe('pin 2 — an undeclared host table that holds data is still refused, by name, naming the flag', () => {
  it('a supplement that omits one table refuses the plan at that table', async () => {
    const { reader, file } = controlPlane();
    const inventory = await supplement(SUPPLEMENT.filter((row) => row.object !== 'sys_domain'));
    const r = await refusal(plan(reader, file, inventory));
    expect(r).toMatchObject({ reason: 'uninventoried-platform-table', table: 'sys_domain' });
    expect(r.message).toContain('--fate-supplement FILE');
    // Control: the full supplement plans the same database.
    await expect(plan(reader, file, await supplement())).resolves.toMatchObject({ kind: 'organization-ownership-plan' });
  });
});

describe('pin 4 — a supplement row whose table this database lacks is listed absent', () => {
  it('the control-plane rows are absent on a tenant database and present on the control database', async () => {
    const inventory = await supplement();
    const t = tenant();
    const onTenant = await plan(t.reader, t.file, inventory);
    for (const object of CONTROL_NAMED) {
      expect(tableOf(onTenant, object), object).toMatchObject({ physical: 'absent', rows: null, tables: [], census: ['host-supplement'] });
    }
    // Control: the same rows, on the database that holds their tables.
    const c = controlPlane();
    const onControl = await plan(c.reader, c.file, inventory);
    for (const object of CONTROL_NAMED) {
      expect(tableOf(onControl, object).physical, object).toBe('present');
    }
  });
});

describe('pin 5 — the plan names every table, on a control-plane-shaped and a tenant-shaped database', () => {
  for (const [kind, build, hostTables] of [
    ['control-plane', controlPlane, CONTROL_HOST_TABLES],
    ['tenant', tenant, TENANT_HOST_TABLES],
  ] as const) {
    it(`${kind}: every table carrying the column is planned, every other one counted outside the ceremony`, async () => {
      const { db, reader, file } = build();
      const p = await plan(reader, file, await supplement());
      const all = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
      const withColumn = all.filter((t) =>
        (db.prepare('SELECT name FROM pragma_table_info(?)').all(t) as Array<{ name: string }>).some((c) => c.name === 'organization_id'),
      );
      const present = p.tables.filter((t) => t.physical === 'present').map((t) => t.object);

      expect(withColumn.length).toBe(hostTables.length + 1); // + sys_job
      expect(present).toEqual(expect.arrayContaining(withColumn));
      expect(all).toEqual(expect.arrayContaining(present));
      // sys_organization is inventoried (no column); _objectstack_sequences is outside.
      expect(present).toContain('sys_organization');
      expect(p.summary.outsideCeremony).toBe(1);
      for (const object of hostTables) {
        expect(tableOf(p, object), object).toMatchObject({ source: 'inventory', census: ['host-supplement'] });
      }
      expect(tableOf(p, 'sys_job')).toMatchObject({ source: 'inventory', fate: 'column-drop' });

      // Control: the platform inventory alone refuses this database, naming a host table.
      const r = await refusal(plan(reader, file));
      expect(r.reason).toBe('uninventoried-platform-table');
      expect(hostTables).toContain(r.table);
    });
  }

  it('the declared fates are the plan\'s: fate 3 derives through its anchor, fate 1 counts its column, fate 4 lists its NULL rows', async () => {
    const { reader, file } = controlPlane();
    const p = await plan(reader, file, await supplement());
    expect(tableOf(p, BILLING[0]!)).toMatchObject({ fate: 'attribution', attribution: { [`parent:account_id->${BILLING[1]}`]: 1 }, unattributable: [] });
    expect(tableOf(p, AI[0]!)).toMatchObject({ fate: 'column-drop', fateCounts: { columnPresent: true, rowsLosingTheirStamp: 1 } });
    expect(tableOf(p, 'sys_domain')).toMatchObject({
      fate: 'report',
      unattributable: [{ id: 'sys_domain_2', reason: 'fate 4: reported, never guessed' }],
      notNull: { willReceive: false },
    });
  });
});

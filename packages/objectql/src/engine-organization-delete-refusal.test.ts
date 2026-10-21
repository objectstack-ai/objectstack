// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24948] The engine never clears a tenant column: deleting a
 * `sys_organization` row that rows still name in their tenant column is
 * refused, whole, before the cascade writes anything.
 *
 * Before, the tenant column's `set_null` default ran on every such row. On a
 * store whose column is NOT NULL that was a constraint failure in the middle
 * of the delete; on a store born nullable it orphaned the rows to NULL. Here
 * the same delete answers 409 `DELETE_RESTRICTED` naming every table with its
 * count, and every row is as it was. The door half (plugin-auth's refusal
 * before better-auth deletes the members) is pinned in
 * `packages/qa/dogfood/test/organization-delete-refuse-nonempty.dogfood.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;

const PACKAGE_ID = 'test-24948';
const ORG_ID = 'org_24948';
const OTHER_ORG = 'org_other';

/** An in-memory driver that records every write, so "nothing changed" is observable. */
function makeDriver() {
  const tables: Record<string, Row[]> = {};
  const writes: string[] = [];
  const reads: string[] = [];
  const missing = new Set<string>();
  const rowsOf = (o: string): Row[] => (tables[o] ??= []);
  const matches = (row: Row, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const exp = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const missingTable = (o: string) =>
    Object.assign(new Error(`SQLITE_ERROR: no such table: ${o}`), { code: 'SQLITE_ERROR' });
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      reads.push(o);
      if (missing.has(o)) throw missingTable(o);
      const hit = rowsOf(o).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? hit.slice(0, ast.limit) : hit;
    },
    async findOne(o: string, ast: any) {
      const [first] = await this.find(o, { ...ast, limit: 1 });
      return first ?? null;
    },
    async count(o: string, ast: any) {
      if (missing.has(o)) throw missingTable(o);
      return rowsOf(o).filter((r) => matches(r, ast?.where)).length;
    },
    async create(o: string, data: Row) {
      const row = { ...data, id: String(data.id) };
      rowsOf(o).push(row);
      writes.push(`create ${o}`);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      const rows = rowsOf(o);
      const at = rows.findIndex((r) => r.id === String(id));
      if (at < 0) throw new Error(`not found ${o}/${id}`);
      rows[at] = { ...rows[at], ...data, id: String(id) };
      writes.push(`update ${o}/${id}`);
      return rows[at];
    },
    async upsert(o: string, data: Row) { return this.create(o, data); },
    async delete(o: string, id: string) {
      const rows = rowsOf(o);
      const at = rows.findIndex((r) => r.id === String(id));
      if (at < 0) return false;
      rows.splice(at, 1);
      writes.push(`delete ${o}/${id}`);
      return true;
    },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { id: 'trx' }; },
    async commit() {}, async rollback() {},
  };
  return {
    driver,
    writes,
    reads,
    missing,
    rows: (o: string) => rowsOf(o).map((r) => ({ ...r })),
    seed: (o: string, row: Row) => void rowsOf(o).push(row),
  };
}

const ORGANIZATION = {
  name: 'sys_organization',
  label: 'Organization',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** Business objects: the registry injects the tenant column `organization_id`. */
const ACCOUNT = {
  name: 'acct',
  label: 'Account',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};
const CONTACT = {
  name: 'contact',
  label: 'Contact',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** The identity tables' shape: the object DECLARES its own tenant column, `set_null` written out. */
const TEAM = {
  name: 'team',
  label: 'Team',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    organization_id: {
      name: 'organization_id', label: 'Organization', type: 'lookup' as const,
      reference: 'sys_organization', deleteBehavior: 'set_null' as const,
    },
  },
};

/** A cascading child of the organization: it would delete rows if the walk reached it first. */
const ORG_NOTE = {
  name: 'org_note',
  label: 'Organization Note',
  fields: {
    body: { name: 'body', label: 'Body', type: 'text' as const },
    org: { name: 'org', label: 'Organization', type: 'master_detail' as const, reference: 'sys_organization' },
  },
};

/** A lookup to the organization that is NOT a tenant column: its `set_null` is untouched. */
const SESSION = {
  name: 'session_like',
  label: 'Session',
  tenancy: { enabled: false },
  fields: {
    active_organization_id: {
      name: 'active_organization_id', label: 'Active Organization', type: 'lookup' as const,
      reference: 'sys_organization',
    },
  },
};

/** An append-only ledger (the audit bucket): its rows outlive the organization they name. */
const LEDGER = {
  name: 'activity_like',
  label: 'Activity',
  managedBy: 'append-only' as const,
  fields: { summary: { name: 'summary', label: 'Summary', type: 'text' as const } },
};

/** An append-only ledger whose organization lookup is its ATTRIBUTION, not a tenant column (`sys_audit_log.tenant_id`). */
const AUDIT_LIKE = {
  name: 'audit_like',
  label: 'Audit',
  managedBy: 'append-only' as const,
  systemFields: { tenant: false },
  fields: {
    action: { name: 'action', label: 'Action', type: 'text' as const },
    tenant_id: { name: 'tenant_id', label: 'Tenant', type: 'lookup' as const, reference: 'sys_organization', readonly: true },
  },
};

/** Tenancy disabled, with an `organization_id` attribution column (`sys_approval_request`). */
const REQUEST_LIKE = {
  name: 'request_like',
  label: 'Request',
  tenancy: { enabled: false },
  fields: {
    subject: { name: 'subject', label: 'Subject', type: 'text' as const },
    organization_id: { name: 'organization_id', label: 'Organization', type: 'lookup' as const, reference: 'sys_organization' },
  },
};

async function makeEngine(objects: any[]) {
  const engine = new ObjectQL({ logger: { debug() {}, info() {}, warn() {}, error() {} } } as any);
  const store = makeDriver();
  engine.registerDriver(store.driver, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o, PACKAGE_ID);
  store.seed('sys_organization', { id: ORG_ID, name: 'Doomed Org' });
  store.seed('sys_organization', { id: OTHER_ORG, name: 'Other Org' });
  return { engine, store };
}

const deleteOrg = (engine: ObjectQL) =>
  engine.delete('sys_organization', { where: { id: ORG_ID } } as any).then(() => null, (e: any) => e);

describe('[#24948] deleting an organization that rows still name in their tenant column is refused', () => {
  it('refuses with 409 DELETE_RESTRICTED, naming every table with its count', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT, CONTACT]);
    store.seed('acct', { id: 'a1', name: 'A1', organization_id: ORG_ID });
    store.seed('acct', { id: 'a2', name: 'A2', organization_id: ORG_ID });
    store.seed('acct', { id: 'a3', name: 'Elsewhere', organization_id: OTHER_ORG });
    store.seed('contact', { id: 'c1', name: 'C1', organization_id: ORG_ID });

    const err = await deleteOrg(engine);

    expect(err?.code).toBe('DELETE_RESTRICTED');
    expect(err?.status).toBe(409);
    expect(err?.object).toBe('sys_organization');
    expect(err?.dependents).toEqual([
      { object: 'acct', count: 2 },
      { object: 'contact', count: 1 },
    ]);
    // The envelope's own two keys carry the first table.
    expect(err?.dependentObject).toBe('acct');
    expect(err?.dependentCount).toBe(2);
  });

  it('changes nothing: the organization, every row and its tenant column are as they were', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT, ORG_NOTE]);
    store.seed('acct', { id: 'a1', name: 'A1', organization_id: ORG_ID });
    // A cascading child the walk would delete if it ran before the refusal.
    store.seed('org_note', { id: 'n1', body: 'keep me', org: ORG_ID, organization_id: ORG_ID });
    const before = {
      org: store.rows('sys_organization'), acct: store.rows('acct'), note: store.rows('org_note'),
    };

    const err = await deleteOrg(engine);

    expect(err?.code).toBe('DELETE_RESTRICTED');
    expect(store.writes).toEqual([]);
    expect(store.rows('sys_organization')).toEqual(before.org);
    expect(store.rows('acct')).toEqual(before.acct);
    expect(store.rows('acct')[0].organization_id).toBe(ORG_ID);
    expect(store.rows('org_note')).toEqual(before.note);
  });

  it('refuses a declared tenant column that writes `set_null` out, as the identity tables do', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, TEAM]);
    store.seed('team', { id: 't1', name: 'Default Team', organization_id: ORG_ID });

    const err = await deleteOrg(engine);

    expect(err?.code).toBe('DELETE_RESTRICTED');
    expect(err?.dependents).toEqual([{ object: 'team', count: 1 }]);
    expect(store.rows('team')[0].organization_id).toBe(ORG_ID);
  });

  it('CONTROL: an empty organization deletes, and a lookup that is not a tenant column is still cleared', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT, TEAM, SESSION]);
    store.seed('acct', { id: 'a3', name: 'Elsewhere', organization_id: OTHER_ORG });
    store.seed('session_like', { id: 's1', active_organization_id: ORG_ID });

    expect(await deleteOrg(engine)).toBeNull();

    expect(store.rows('sys_organization').map((r) => r.id)).toEqual([OTHER_ORG]);
    expect(store.rows('session_like')[0].active_organization_id).toBeNull();
    expect(store.rows('acct')[0].organization_id).toBe(OTHER_ORG);
  });

  it('CONTROL: a table never provisioned holds no row, so it refuses nothing', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT]);
    store.missing.add('acct');

    expect(await deleteOrg(engine)).toBeNull();
    expect(store.rows('sys_organization').map((r) => r.id)).toEqual([OTHER_ORG]);
  });
});

describe('[#24948] an append-only ledger neither refuses the delete nor is cleared by it (seat decision 6305179819)', () => {
  it('deletes an organization only a ledger still names, and keeps the ledger rows naming it', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT, LEDGER]);
    store.seed('activity_like', { id: 'l1', summary: 'organization created', organization_id: ORG_ID });
    store.seed('activity_like', { id: 'l2', summary: 'team created', organization_id: ORG_ID });

    expect(await deleteOrg(engine)).toBeNull();

    expect(store.rows('sys_organization').map((r) => r.id)).toEqual([OTHER_ORG]);
    // Kept, and still naming the deleted organization: never NULL, never deleted.
    expect(store.rows('activity_like').map((r) => [r.id, r.organization_id])).toEqual([
      ['l1', ORG_ID],
      ['l2', ORG_ID],
    ]);
    expect(store.writes.filter((w) => w.includes('activity_like'))).toEqual([]);
  });

  it('CONTROL: beside a ledger, a record still refuses, and only the record is named', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT, LEDGER]);
    store.seed('activity_like', { id: 'l1', organization_id: ORG_ID });
    store.seed('acct', { id: 'a1', organization_id: ORG_ID });

    const err = await deleteOrg(engine);

    expect(err?.code).toBe('DELETE_RESTRICTED');
    expect(err?.dependents).toEqual([{ object: 'acct', count: 1 }]);
    expect(store.writes).toEqual([]);
  });

  it('organizationOwnedRowCounts never counts a ledger', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT, LEDGER]);
    store.seed('activity_like', { id: 'l1', organization_id: ORG_ID });
    expect(await engine.organizationOwnedRowCounts(ORG_ID)).toEqual([]);
  });
});

describe('[#24948] references the delete keeps as they are (seat decision 6305996369)', () => {
  it("an append-only ledger's non-tenant lookup keeps naming the deleted organization", async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, AUDIT_LIKE]);
    store.seed('audit_like', { id: 'au1', action: 'org.created', tenant_id: ORG_ID });

    expect(await deleteOrg(engine)).toBeNull();

    expect(store.rows('audit_like')).toEqual([{ id: 'au1', action: 'org.created', tenant_id: ORG_ID }]);
    expect(store.writes.filter((w) => w.includes('audit_like'))).toEqual([]);
  });

  it('an organization_id on a tenancy-disabled object is kept, naming it, and is not counted', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, REQUEST_LIKE, SESSION]);
    store.seed('request_like', { id: 'r1', subject: 'Expense', organization_id: ORG_ID });
    store.seed('session_like', { id: 's1', active_organization_id: ORG_ID });
    expect(await engine.organizationOwnedRowCounts(ORG_ID)).toEqual([]);

    expect(await deleteOrg(engine)).toBeNull();

    expect(store.rows('request_like')[0].organization_id).toBe(ORG_ID);
    // CONTROL: a pointer is still cleared.
    expect(store.rows('session_like')[0].active_organization_id).toBeNull();
  });
});

describe('[#24948] the predicate path is refused for an organization', () => {
  it('a multi delete of sys_organization is refused, by id only, before anything is written', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT]);
    const err: any = await engine
      .delete('sys_organization', { where: { name: 'Doomed Org' }, multi: true } as any)
      .then(() => null, (e: any) => e);

    expect(err?.code).toBe('DELETE_RESTRICTED');
    expect(err?.status).toBe(409);
    expect(err?.message).toContain('by id');
    expect(store.writes).toEqual([]);
    expect(store.rows('sys_organization').map((r) => r.id)).toEqual([ORG_ID, OTHER_ORG]);
  });

  it('CONTROL: a multi delete of another object is not refused by this rule', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT]);
    store.seed('acct', { id: 'a1', name: 'gone', organization_id: OTHER_ORG });
    const err = await engine
      .delete('acct', { where: { name: 'gone' }, multi: true } as any)
      .then(() => null, (e: any) => e);
    expect(err?.code).not.toBe('DELETE_RESTRICTED');
  });
});

describe('[#24948] the engine refusal counts, it does not read rows', () => {
  it('refusing an organization that owns rows issues no row read of the owning table', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT]);
    for (let i = 0; i < 5; i++) store.seed('acct', { id: `a${i}`, organization_id: ORG_ID });
    store.reads.length = 0;

    const err = await deleteOrg(engine);

    expect(err?.dependents).toEqual([{ object: 'acct', count: 5 }]);
    expect(store.reads.filter((o) => o === 'acct')).toEqual([]);
  });
});

describe('[#24948] organizationOwnedRowCounts: the question plugin-auth asks before anything is deleted', () => {
  it('counts each table holding rows for the organization, and skips excluded and empty ones', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT, CONTACT, TEAM, SESSION]);
    store.seed('acct', { id: 'a1', organization_id: ORG_ID });
    store.seed('acct', { id: 'a2', organization_id: ORG_ID });
    store.seed('acct', { id: 'a3', organization_id: OTHER_ORG });
    store.seed('team', { id: 't1', organization_id: ORG_ID });
    store.seed('session_like', { id: 's1', active_organization_id: ORG_ID });

    expect(await engine.organizationOwnedRowCounts(ORG_ID)).toEqual([
      { object: 'acct', count: 2 },
      { object: 'team', count: 1 },
    ]);
    expect(await engine.organizationOwnedRowCounts(ORG_ID, { exclude: ['team'] })).toEqual([
      { object: 'acct', count: 2 },
    ]);
    expect(await engine.organizationOwnedRowCounts(OTHER_ORG)).toEqual([{ object: 'acct', count: 1 }]);
    // Reads only: the count wrote nothing.
    expect(store.writes).toEqual([]);
  });

  it('reads a table never provisioned as holding no row', async () => {
    const { engine, store } = await makeEngine([ORGANIZATION, ACCOUNT]);
    store.missing.add('acct');
    expect(await engine.organizationOwnedRowCounts(ORG_ID)).toEqual([]);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 §10] Under a walled tenancy posture every external object states
 * its organization scope — the WRITE half at the dogfood door, on a real boot
 * of the showcase with a writable plugin-driver datasource added.
 *
 * An external object registered AFTER the boot that states no scope answers no
 * row and accepts no write: the Layer 0 verdict is `deny` (pinned on the read
 * side in `federated-rls-injectors.dogfood.test.ts`), and the write wall refuses
 * an insert naming no organization with a sentence that names the undeclared
 * scope and the three ways out — never the missing-organization sentence,
 * because the caller here HAS an active organization. An update and a delete
 * stay refused, and the remote sees no write. The control is the same caller's
 * insert on a declared shared object on the same datasource, which lands.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { type VerifyStack } from '@objectstack/verify';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { DriverQuery, IDataDriver, IObjectQLEngine } from '@objectstack/spec/contracts';
import { RLS_DENY_FILTER } from '@objectstack/plugin-security';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const DATASOURCE = 'dogfood_scope_remote';
/** Registered after the boot, stating nothing. */
const UNDECLARED = 'dogfood_ext_undeclared_writable';
/** Registered after the boot, declared shared — the control. */
const SHARED = 'dogfood_ext_shared_writable';
const ADMIN_ORG = 'org_dogfood_scope_writes';

type Row = Record<string, unknown>;
type Call = { method: string; object?: string; id?: unknown; data?: unknown; query?: unknown };

/** The registry seam the fixture registers through (`IObjectQLEngine` does not declare it). */
interface RegistrarEngine {
  registry: { registerObject(def: Record<string, unknown>): unknown };
  syncObjectSchema(object: string): Promise<unknown>;
}

const matches = (row: Row, where: unknown): boolean => {
  if (where === undefined || where === null) return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === '$and') { if (!(cond as unknown[]).every((w) => matches(row, w))) return false; continue; }
    if (key.startsWith('$')) throw new Error(`dogfood remote: unsupported combinator ${key}`);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, value] of Object.entries(cond as Record<string, unknown>)) {
        if (op === '$eq') { if (row[key] !== value) return false; continue; }
        if (op === '$in') { if (!(value as unknown[]).includes(row[key])) return false; continue; }
        throw new Error(`dogfood remote: unsupported operator ${op} on ${key}`);
      }
      continue;
    }
    if (row[key] !== cond) return false;
  }
  return true;
};

const tables: Record<string, Row[]> = {
  [UNDECLARED]: [{ id: 'u_1', name: 'Undeclared 1' }],
  [SHARED]: [{ id: 's_1', name: 'Shared 1' }],
};
const calls: Call[] = [];
const snapshot = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const refuse = (what: string) => async (): Promise<never> => { throw new Error(`dogfood remote: ${what} is not part of this fixture`); };

/** An in-memory remote that honours `where` and accepts writes — a write that reaches it lands, and is seen. */
const driver = {
  name: DATASOURCE,
  version: '0.0.1',
  supports: { transactionsUnsupported: true },
  async connect() {},
  async disconnect() {},
  async checkHealth() { return true; },
  execute: refuse('execute'),
  async find(object: string, query: DriverQuery = {}) {
    calls.push({ method: 'find', object, query: snapshot(query) });
    return (tables[object] ?? []).filter((r) => matches(r, query.where)).map((r) => ({ ...r }));
  },
  async findOne(object: string, query: DriverQuery = {}) {
    calls.push({ method: 'findOne', object, query: snapshot(query) });
    const hit = (tables[object] ?? []).find((r) => matches(r, query.where));
    return hit ? { ...hit } : null;
  },
  async count(object: string, query: DriverQuery = {}) {
    calls.push({ method: 'count', object, query: snapshot(query) });
    return (tables[object] ?? []).filter((r) => matches(r, query.where)).length;
  },
  async create(object: string, data: Row) {
    calls.push({ method: 'create', object, data: snapshot(data) });
    const row = { id: `c_${calls.length}`, ...data };
    (tables[object] ??= []).push(row);
    return { ...row };
  },
  async update(object: string, id: string | number, data: Row) {
    calls.push({ method: 'update', object, id, data: snapshot(data) });
    const row = (tables[object] ?? []).find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, data, { id: row.id });
    return { ...row };
  },
  async delete(object: string, id: string | number) {
    calls.push({ method: 'delete', object, id });
    const rows = tables[object] ?? [];
    const at = rows.findIndex((r) => r.id === id);
    if (at >= 0) rows.splice(at, 1);
    return at >= 0;
  },
  upsert: refuse('upsert'),
  bulkCreate: refuse('bulkCreate'),
  bulkUpdate: refuse('bulkUpdate'),
  bulkDelete: refuse('bulkDelete'),
  beginTransaction: refuse('beginTransaction'),
  commit: refuse('commit'),
  rollback: refuse('rollback'),
  async syncSchema() {},
  dropTable: refuse('dropTable'),
} as unknown as IDataDriver;

const driverPlugin: Plugin = {
  name: 'com.dogfood.driver-scope-remote',
  version: '1.0.0',
  init: async (ctx: PluginContext) => { ctx.registerService(`driver.${DATASOURCE}`, driver); },
};

/** The showcase, with one writable plugin-driver datasource beside its own. */
const stackWithRemote = {
  ...(showcaseStack as Record<string, unknown>),
  datasources: [
    ...(((showcaseStack as { datasources?: unknown[] }).datasources) ?? []),
    {
      name: DATASOURCE,
      label: 'Dogfood scope remote (plugin driver)',
      driver: DATASOURCE,
      schemaMode: 'external',
      config: {},
      external: { allowWrites: true, validation: { onMismatch: 'fail', checkOnBoot: false } },
    },
  ],
  plugins: [...(((showcaseStack as { plugins?: unknown[] }).plugins) ?? []), driverPlugin],
};

const bodyOf = async (res: Response): Promise<any> => {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
};

describe('[ADR-0015 §10] an external object registered after the boot that states no scope accepts no write', () => {
  let stack: VerifyStack;
  let ql: IObjectQLEngine;
  let adminToken: string;

  beforeAll(async () => {
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootShowcase({ multiTenant: 'posture-only' }, stackWithRemote);
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');

    const registrar = ql as unknown as RegistrarEngine;
    for (const [name, extra] of [
      [UNDECLARED, {}],
      [SHARED, { tenancy: { enabled: false } }],
    ] as const) {
      registrar.registry.registerObject({
        name,
        label: name,
        datasource: DATASOURCE,
        external: { remoteName: name, writable: true },
        sharingModel: 'public_read_write',
        fields: { name: { type: 'text', label: 'Name' } },
        ...extra,
      });
      await registrar.syncObjectSchema(name);
    }

    // [ADR-0123 D2] Seat the harness admin in an organization BEFORE the first
    // sign-in, so the caller below HAS an active organization — the sentence
    // under test is the one that must not tell such a caller to join one.
    const adminUser = (await ql.find('sys_user', { where: { email: 'admin@objectos.ai' }, limit: 1, context: SYS })) as unknown;
    const adminRow = (Array.isArray(adminUser) ? adminUser[0] : undefined) as { id?: unknown } | undefined;
    const adminUserId = String(adminRow?.id ?? '');
    expect(adminUserId, 'the seeded harness admin resolves').toBeTruthy();
    await ql.insert('sys_organization', { id: ADMIN_ORG, name: 'Scope writes org', slug: ADMIN_ORG }, { context: SYS });
    await ql.insert('sys_member', { id: 'mem_scope_writes_admin', organization_id: ADMIN_ORG, user_id: adminUserId, role: 'owner' }, { context: SYS });
    adminToken = await stack.signIn();
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('an insert naming no organization is refused, naming the undeclared scope and the three ways out — never the missing-organization sentence', async () => {
    const mark = calls.length;
    const res = await stack.apiAs(adminToken, 'POST', `/data/${UNDECLARED}`, { name: "Nobody's row" });
    const body = await bodyOf(res);
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(String(body?.error?.code ?? body?.code)).toBe('PERMISSION_DENIED');
    const message = String(body?.error?.message ?? body?.error ?? body?.message ?? '');
    expect(message).toContain(`every external object states its organization scope, and '${UNDECLARED}' states none`);
    expect(message).toContain('`organization_id` field of its own');
    expect(message).toContain('`tenancy: { enabled: false }`');
    expect(message).toContain('`systemFields: { tenant: false }`');
    expect(message).not.toContain('active organization');
    expect(calls.slice(mark).filter((c) => c.object === UNDECLARED && c.method === 'create')).toEqual([]);
    expect(tables[UNDECLARED].map((r) => r.id)).toEqual(['u_1']);
  });

  it('an update and a delete stay refused, and the remote sees no write', async () => {
    const mark = calls.length;
    const updated = await stack.apiAs(adminToken, 'PATCH', `/data/${UNDECLARED}/u_1`, { name: 'Renamed' });
    expect([403, 404], await updated.clone().text()).toContain(updated.status);
    const deleted = await stack.apiAs(adminToken, 'DELETE', `/data/${UNDECLARED}/u_1`);
    expect([403, 404], await deleted.clone().text()).toContain(deleted.status);
    expect(calls.slice(mark).filter((c) => c.object === UNDECLARED && ['create', 'update', 'delete'].includes(c.method))).toEqual([]);
    expect(tables[UNDECLARED]).toEqual([{ id: 'u_1', name: 'Undeclared 1' }]);
  });

  it("…and a member's read of it is denied: the read filter is the deny sentinel", async () => {
    // Read as a member, not as the platform owner: the verified declared
    // owner's READ crossing lifts every armed read wall (a standing ruling the
    // review records as a question for the maintainer, not a change here), so
    // the owner's GET is not the wall's own answer. The member's is.
    const security = stack.kernel.getService<{ getReadFilter(object: string, ctx: unknown): Promise<unknown> }>('security');
    const filter = await security.getReadFilter(UNDECLARED, { userId: 'usr_dogfood_member', tenantId: ADMIN_ORG, positions: [] });
    expect(filter).toBe(RLS_DENY_FILTER);
    // …and a read carrying that filter asks the remote for nothing it holds.
    const rows = await ql.find(UNDECLARED, { where: filter as Record<string, unknown>, context: SYS });
    expect(rows).toEqual([]);
  });

  it("CONTROL: the same caller's insert on the declared shared object on the same datasource reaches the remote and lands", async () => {
    const mark = calls.length;
    const res = await stack.apiAs(adminToken, 'POST', `/data/${SHARED}`, { name: 'Shared 2' });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    expect(calls.slice(mark).some((c) => c.object === SHARED && c.method === 'create')).toBe(true);
    expect(tables[SHARED].map((r) => r.name)).toContain('Shared 2');
  });
});

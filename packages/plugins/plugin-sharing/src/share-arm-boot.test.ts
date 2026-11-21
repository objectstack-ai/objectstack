// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 ② ruled, plan step 6] The two tightenings that land with the
 * switch, each where it takes effect.
 *
 *  - **R2, the storage rows.** On an object whose storage cannot evaluate the
 *    share-grant leaf (another datasource than `sys_record_share`, or a driver
 *    that does not declare `SharedRecordIds`), share grants stop counting: no
 *    scope carries the share arm, the write gate consults no grant, the grant
 *    door and the sharing-rule save door refuse with `SHARING_NOT_ENABLED`, and
 *    the boot names every such object that holds share rows.
 *  - **R1 at boot, the host class.** A middleware or a find hook registered
 *    for `sys_record_share` BY NAME refuses the boot with D4's envelope,
 *    `INTERNAL_ERROR` / 500; one registered with no object, or `'*'`, does not.
 *    A registration made after boot meets the engine seam's refusal at read.
 *
 * Real `ObjectQL`, a real `SqlDriver` holding `sys_record_share`, and, for the
 * other datasource, a recording driver that declares no fixed-read leaf. The
 * recognition of both classes is the engine's own (`fixedReadLeafClassOf`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ERROR_CODE_LEDGER } from '@objectstack/spec/api';
import { isFixedReadLeaf } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingServicePlugin, buildSharingMiddleware } from './sharing-plugin.js';
import { bindRuleObjectEnforcementGuard } from './rule-hooks.js';
import { SysRecordShare } from './objects/sys-record-share.object.js';
import { registeredObjectNames, reportInertShareGrantHolders, shareGrantRegistrationRefusal } from './share-arm-boot.js';

const ORG = 'org_r2';
const ME = 'u_me';
const OTHER = 'u_other';
/** On the datasource of `sys_record_share`, a SQL driver: share grants count. */
const LOCAL = 'r2_local';
/** On another datasource: share grants stop counting, and it holds share rows. */
const FAR = 'r2_far';
/** On another datasource too, holding no share row: not named by the report. */
const FAR_EMPTY = 'r2_far_empty';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as unknown as ExecutionContext;
const ADMIN = {
  userId: 'u_admin', organizationId: ORG, tenantId: ORG, positions: [], permissions: [], systemPermissions: ['manage_sharing'],
} as unknown as ExecutionContext;
const asMe = () => ({ userId: ME }) as unknown as ExecutionContext;

const text = (name: string) => ({ type: 'text', name, label: name });
const RULE_FIELDS = Object.fromEntries(
  ['organization_id', 'name', 'label', 'object_name', 'criteria_json', 'recipient_type', 'recipient_id', 'access_level', 'managed_by']
    .map((f) => [f, text(f)]),
);

type Envelope = { code?: string; status?: number; message?: string };
const refusalOf = (p: Promise<unknown>): Promise<Envelope | null> => p.then(() => null, (e: Envelope) => e);

/** Every fixed-read leaf in `node`, by identity. */
function leavesIn(node: unknown, out: unknown[] = []): unknown[] {
  if (isFixedReadLeaf(node)) out.push(node);
  else if (node !== null && typeof node === 'object') for (const v of Object.values(node)) leavesIn(v, out);
  return out;
}

/** A driver on datasource `legacy` that declares no fixed-read leaf, and records what it is handed. */
function legacyDriver() {
  const seen: Array<{ verb: string; ast: any }> = [];
  const rows = [
    { id: 'f_mine', name: 'mine', owner_id: ME, organization_id: ORG },
    { id: 'f_shared', name: 'shared to me', owner_id: OTHER, organization_id: ORG },
  ];
  const byId = (ast: any) => (typeof ast?.where?.id === 'string' ? rows.filter((r) => r.id === ast.where.id) : rows);
  const driver: any = {
    name: 'legacy', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_object: string, ast: any) { seen.push({ verb: 'find', ast }); return byId(ast); },
    async findOne(_object: string, ast: any) { seen.push({ verb: 'findOne', ast }); return byId(ast)[0] ?? null; },
    async count(_object: string, ast: any) { seen.push({ verb: 'count', ast }); return byId(ast).length; },
    async create(_object: string, data: Record<string, unknown>) { return data; },
    async update(_object: string, _id: string, data: Record<string, unknown>) { return data; },
    async delete() { return true; },
  };
  return { driver, seen };
}

const open: SqlDriver[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.disconnect().catch(() => undefined);
});

async function boot() {
  const sql = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  open.push(sql);
  const legacy = legacyDriver();
  const ql = new ObjectQL();
  ql.registerDriver(sql as never, true);
  ql.registerDriver(legacy.driver);
  await ql.init();
  ql.setTenancyPostureProvider(() => 'single');
  ql.registerObject({ name: LOCAL, label: 'Local', sharingModel: 'private', fields: { name: text('name') } } as never);
  ql.registerObject({ name: FAR, label: 'Far', sharingModel: 'private', datasource: 'legacy', fields: { name: text('name') } } as never);
  ql.registerObject({ name: FAR_EMPTY, label: 'Far, empty', sharingModel: 'private', datasource: 'legacy', fields: { name: text('name') } } as never);
  ql.registerObject(SysRecordShare as never);
  ql.registerObject({
    name: 'sys_sharing_rule', label: 'Sharing Rule', isSystem: true,
    fields: { id: { ...text('id'), primary: true }, ...RULE_FIELDS, active: { type: 'boolean', name: 'active', label: 'Active' } },
  } as never);
  await sql.initObjects([LOCAL, 'sys_record_share', 'sys_sharing_rule'].map((name) => ql.getSchema(name) as never));
  const knex = (sql as unknown as { knex: any }).knex;
  await knex(LOCAL).insert([
    { id: 'l_mine', name: 'mine', owner_id: ME, organization_id: ORG },
    { id: 'l_shared', name: 'shared to me', owner_id: OTHER, organization_id: ORG },
  ]);
  // An edit grant to the caller on one row of each object.
  await knex('sys_record_share').insert([LOCAL, FAR].map((object, i) => ({
    id: `g_${i}`, object_name: object, record_id: object === LOCAL ? 'l_shared' : 'f_shared',
    recipient_type: 'user', recipient_id: ME, access_level: 'edit', source: 'manual', organization_id: ORG,
  })));
  const warn = vi.fn();
  const sharing = new SharingService({ engine: ql as never, logger: { warn, error: vi.fn(), info: vi.fn() } as never });
  ql.registerMiddleware(buildSharingMiddleware(sharing) as never, { object: '*' });
  bindRuleObjectEnforcementGuard(ql as never, sharing);
  return { ql, sql, knex, legacy, sharing, warn };
}

describe('[ADR-0155 ② ruled R2] the storage rows: share grants stop counting where no driver evaluates them', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { h = await boot(); });

  it('the reason names the two datasources; an object beside sys_record_share on a SQL driver has none', () => {
    expect(h.sharing.shareGrantsInertReason(FAR)).toMatch(/'r2_far' is bound to datasource 'legacy' while 'sys_record_share' is bound to/);
    expect(h.sharing.shareGrantsInertReason(LOCAL)).toBeNull();
  });

  it('neither scope carries the share arm there, and the read reaches the driver with no leaf; the control keeps it', async () => {
    expect(leavesIn(await h.sharing.buildReadFilter(FAR, asMe()))).toHaveLength(0);
    expect(await h.sharing.buildWriteFilter(FAR, asMe())).toEqual({ owner_id: ME });
    expect(leavesIn(await h.sharing.buildReadFilter(LOCAL, asMe()))).toHaveLength(1);
    expect(leavesIn(await h.sharing.buildWriteFilter(LOCAL, asMe()))).toHaveLength(1);
    await h.ql.find(FAR, {}, { context: asMe() } as never);
    const read = h.legacy.seen.find((c) => c.verb === 'find');
    expect(read).toBeDefined();
    expect(leavesIn(read!.ast)).toHaveLength(0);
    expect(JSON.stringify(read!.ast.where)).toContain(ME);
  });

  it('the write gate consults no grant there: the edit grant on f_shared does not admit an edit, as l_shared\'s does', async () => {
    expect(await h.sharing.checkEdit(FAR, 'f_shared', asMe())).toBe('deny');
    expect(await h.sharing.checkEdit(FAR, 'f_mine', asMe())).toBe('allow');
    expect(await h.sharing.checkEdit(LOCAL, 'l_shared', asMe())).toBe('allow');
  });

  it('the grant door refuses, system and direct callers alike, with SHARING_NOT_ENABLED and the reason', async () => {
    for (const context of [SYSTEM, ADMIN]) {
      const err = await refusalOf(h.sharing.grant({ object: FAR, recordId: 'f_mine', recipientId: OTHER, accessLevel: 'read' } as never, context));
      // The code is the message prefix the REST share routes map to 422 (`sharing-routes.ts`).
      expect(err?.message).toMatch(/^SHARING_NOT_ENABLED: 'r2_far' is bound to datasource 'legacy'/);
    }
    expect(ERROR_CODE_LEDGER['@objectstack/plugin-sharing']).toContain('SHARING_NOT_ENABLED');
  });

  it('the sharing-rule save door refuses with SHARING_NOT_ENABLED / 422 and says how to share the object again', async () => {
    const row = {
      id: 'sr_far', organization_id: ORG, name: 'far_rule', label: 'far_rule', object_name: FAR, criteria_json: '{}',
      recipient_type: 'position', recipient_id: 'sales_rep', access_level: 'read', active: true, managed_by: 'admin',
    };
    const err = await refusalOf(h.ql.insert('sys_sharing_rule', row, { context: ADMIN } as never));
    expect(err?.code).toBe('SHARING_NOT_ENABLED');
    expect(err?.status).toBe(422);
    expect(err?.message).toContain(`store '${FAR}' on the datasource of 'sys_record_share'`);
  });

  it('the boot names, once at warn, every such object that holds share rows, and only those', async () => {
    const log = { warn: vi.fn() };
    const named = await reportInertShareGrantHolders(h.sharing, registeredObjectNames(h.ql), log);
    expect(named.map((n) => n.object)).toEqual([FAR]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = log.warn.mock.calls[0] as [string, { objects: Array<{ object: string }> }];
    expect(message).toContain(`'${FAR}'`);
    expect(message).not.toContain(`'${FAR_EMPTY}'`);
    expect(message).toContain('SHARING_NOT_ENABLED');
    expect(meta.objects.map((o) => o.object)).toEqual([FAR]);
  });

  it('the boot report is silent when no such object holds a share row', async () => {
    await h.knex('sys_record_share').where({ object_name: FAR }).del();
    const log = { warn: vi.fn() };
    expect(await reportInertShareGrantHolders(h.sharing, registeredObjectNames(h.ql), log)).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('[ADR-0155 ② ruled R2] a driver beside sys_record_share that does not declare the leaf', () => {
  const engineWith = (members: Record<string, unknown>) => new SharingService({
    engine: { getSchema: () => ({ name: 'doc', sharingModel: 'private', fields: { owner_id: { type: 'lookup' } } }), find: async () => [], ...members } as never,
  });

  it('is named by its driver', () => {
    const sharing = engineWith({ getDriverForObject: () => ({ name: 'mongo-like', supports: {} }), fixedReadLeafClassOf: () => null });
    expect(sharing.shareGrantsInertReason('doc')).toMatch(/stored by driver 'mongo-like', which does not evaluate a share grant/);
  });

  it('an engine that cannot say writes the leaf, and the seam stands behind it', () => {
    expect(engineWith({}).shareGrantsInertReason('doc')).toBeNull();
    expect(engineWith({ getDriverForObject: () => { throw new Error('boom'); } }).shareGrantsInertReason('doc')).toBeNull();
    const declaring = { getDriverForObject: () => ({ name: 'sql', supports: { fixedReadLeaves: ['SharedRecordIds'] } }) };
    expect(engineWith({ ...declaring, fixedReadLeafClassOf: () => { throw new Error('boom'); } }).shareGrantsInertReason('doc')).toBeNull();
  });
});

describe('[ADR-0155 ② ruled R1 at boot] a registration for sys_record_share by name refuses the boot', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { h = await boot(); });
  const REFUSED = { code: 'INTERNAL_ERROR', status: 500 };
  const envelope = (e: Envelope | undefined) => ({ code: e?.code, status: e?.status });

  it('a clean host is not refused', () => {
    expect(shareGrantRegistrationRefusal(h.ql as never)).toBeUndefined();
  });

  it('an object-scoped middleware for it', () => {
    h.ql.registerMiddleware((async (_ctx: unknown, next: () => Promise<void>) => next()) as never, { object: 'sys_record_share' });
    const refusal = shareGrantRegistrationRefusal(h.ql as never);
    expect(envelope(refusal)).toEqual(REFUSED);
    expect(refusal?.message).toContain("an object-scoped middleware registered for 'sys_record_share'");
  });

  for (const event of ['beforeFind', 'afterFind']) {
    it(`a ${event} hook naming it, with no exemption for one that skips system reads`, () => {
      h.ql.registerHook(event, (async (ctx: any) => { if (ctx?.session?.isSystem) return; }) as never, { object: 'sys_record_share' });
      const refusal = shareGrantRegistrationRefusal(h.ql as never);
      expect(envelope(refusal)).toEqual(REFUSED);
      expect(refusal?.message).toContain(`a ${event} hook registered for 'sys_record_share' by name`);
    });
  }

  it("a registration that names no object, or '*', is outside the class", () => {
    h.ql.registerMiddleware((async (_ctx: unknown, next: () => Promise<void>) => next()) as never, { object: '*' });
    h.ql.registerHook('beforeFind', (async () => {}) as never);
    h.ql.registerHook('afterFind', (async () => {}) as never, { object: '*' });
    expect(shareGrantRegistrationRefusal(h.ql as never)).toBeUndefined();
  });

  it('an engine without the recognition, or whose recognition throws, logs once at warn and does not refuse', () => {
    const log = { warn: vi.fn() };
    expect(shareGrantRegistrationRefusal({}, log)).toBeUndefined();
    expect(shareGrantRegistrationRefusal({ fixedReadLeafClassOf: () => { throw new Error('boom'); } }, log)).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(String(log.warn.mock.calls[0][0])).toContain('did not run');
  });

  it('a registration made after boot meets the engine seam\'s refusal at read', async () => {
    h.ql.registerMiddleware((async (_ctx: unknown, next: () => Promise<void>) => next()) as never, { object: 'sys_record_share' });
    const err = await refusalOf(h.ql.find(LOCAL, {}, { context: asMe() } as never));
    expect(envelope(err ?? undefined)).toEqual(REFUSED);
  });
});

describe('[ADR-0155 ② ruled R1 at boot] the plugin refuses the boot at kernel:bootstrapped', () => {
  /** Start the plugin over `ql` and run its boot hooks in order, as the kernel does; the first throw is the boot's. */
  async function bootPlugin(ql: ObjectQL): Promise<Envelope | null> {
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
    const hooks: Record<string, Array<() => Promise<void> | void>> = {};
    const ctx = {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      hook: (event: string, handler: () => Promise<void> | void) => { (hooks[event] ??= []).push(handler); },
      getService: <T>(name: string): T => (name === 'objectql' ? (ql as unknown as T) : kernel.getService<T>(name)),
      registerService: vi.fn(),
      getKernel: () => kernel,
    };
    const plugin = new SharingServicePlugin({ enforce: false });
    await plugin.start(ctx as unknown as PluginContext);
    return refusalOf((async () => {
      for (const event of ['kernel:ready', 'kernel:bootstrapped']) for (const handler of hooks[event] ?? []) await handler();
    })());
  }

  it('a host with a find hook for sys_record_share by name does not finish booting; a clean host does', async () => {
    const clean = await boot();
    expect(await bootPlugin(clean.ql)).toBeNull();
    const host = await boot();
    host.ql.registerHook('afterFind', (async () => {}) as never, { object: 'sys_record_share' });
    const err = await bootPlugin(host.ql);
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
    expect(err?.message).toContain("afterFind hook registered for 'sys_record_share' by name");
  });
});

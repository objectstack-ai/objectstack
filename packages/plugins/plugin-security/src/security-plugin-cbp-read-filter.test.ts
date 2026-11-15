// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#33696 · ruling record 6893666857] The controlled-by-parent read leaf over a
// REQUIRED master is dropped by the engine's composition for a reader who holds
// View All on the detail AND whose every master hop answers an unrestricted
// scope: the read carries no parent-chain subquery, and that reader also sees
// the orphan detail rows (a master that no longer exists, or a required master
// left empty) inside its own tenant wall, as View All on the detail reads an
// optional master's null-master rows (#30905 ruling A). Every other reader keeps
// the chain unchanged: a restricted master hop, View All on the detail alone, a
// plain member over an unrestricted master. An OPTIONAL master keeps its `$or`
// leaf whoever reads.
//
// The leaf this module writes (`computeControlledByParentFilter`) is unchanged:
// the drop is the engine's (`composeReadableIdsChain`, step 5), because only the
// engine holds the per-hop answer — the master's scope after `canReadObject` and
// `getReadFilter` — and the ruling keys the drop on that answer, never on View
// All on the detail alone (`hasSuperuserReadBypass`, which does not open the
// master arm).
//
// The real stack: `ObjectQL` over better-sqlite3, the real `SecurityPlugin`
// and the real `SharingService` with its middleware, objects in two
// organizations. The orphans are written the two ways measured on the card: a
// system-context insert naming a master that does not exist (the reference
// check's documented `isSystem` residual), and a row stored through the driver
// with its required master empty (what a promotion of an optional master to
// required leaves behind).
//
//   r4_account (private) <-account- r4_opp (cbp, required) <-opp- r4_line (cbp, required)
//                                   r4_opp <-opp?- r4_note (cbp, OPTIONAL master)
//   r4_pub_account (public_read_write) <-account- r4_pub_line (cbp, required)

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { isComposedReadableIds, isReadableIds } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ORG_A = 'org_r4_a';
const ORG_B = 'org_r4_b';

const ACCOUNT = 'r4_account';
const OPP = 'r4_opp';
const LINE = 'r4_line';
const NOTE = 'r4_note';
const PUB_ACCOUNT = 'r4_pub_account';
const PUB_LINE = 'r4_pub_line';
const OBJECTS = [ACCOUNT, OPP, LINE, NOTE, PUB_ACCOUNT, PUB_LINE];

/** View All on every object of the chain: every hop answers an unrestricted scope. */
const ADMIN_USER = 'usr_r4_admin';
/** Read on every object, View All on none: the private account hop is owner-scoped. */
const MEMBER_USER = 'usr_r4_member';
/** View All on every DETAIL, not on the account: a restricted master hop. */
const DETAIL_ADMIN_USER = 'usr_r4_detail_admin';
/** View All on the read detail (`r4_line`) only. */
const LINE_ADMIN_USER = 'usr_r4_line_admin';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const ADMIN_SET = PermissionSetSchema.parse({
  name: 'r4_admin',
  objects: Object.fromEntries(OBJECTS.map((o) => [o, { ...CRUD, viewAllRecords: true, modifyAllRecords: true }])),
});
const MEMBER_SET = PermissionSetSchema.parse({
  name: 'r4_member',
  objects: Object.fromEntries(OBJECTS.map((o) => [o, CRUD])),
});
const DETAIL_ADMIN_SET = PermissionSetSchema.parse({
  name: 'r4_detail_admin',
  objects: Object.fromEntries(OBJECTS.map((o) => [o, o === ACCOUNT ? CRUD : { ...CRUD, viewAllRecords: true }])),
});
const LINE_ADMIN_SET = PermissionSetSchema.parse({
  name: 'r4_line_admin',
  objects: Object.fromEntries(OBJECTS.map((o) => [o, o === LINE ? { ...CRUD, viewAllRecords: true } : CRUD])),
});
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const SETS = [MEMBER_DEFAULT, ADMIN_SET, MEMBER_SET, DETAIL_ADMIN_SET, LINE_ADMIN_SET];

/** The execution context `resolveAuthzContext` hands the middleware for an organization member holding `set`. */
const memberOf = (userId: string, set: string, tenantId: string) => ({
  userId,
  tenantId,
  positions: ['org_member'],
  permissions: [set, 'member_default'],
  posture: 'MEMBER',
});
const ADMIN = memberOf(ADMIN_USER, ADMIN_SET.name, ORG_A);
const ADMIN_B = memberOf(ADMIN_USER, ADMIN_SET.name, ORG_B);
const MEMBER = memberOf(MEMBER_USER, MEMBER_SET.name, ORG_A);
const DETAIL_ADMIN = memberOf(DETAIL_ADMIN_USER, DETAIL_ADMIN_SET.name, ORG_A);
const LINE_ADMIN = memberOf(LINE_ADMIN_USER, LINE_ADMIN_SET.name, ORG_A);

const detail = (name: string, fk: string, reference: string, required: boolean) => ({
  name,
  label: name,
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    [fk]: { name: fk, type: 'master_detail', reference, required },
  },
});

const ids = (rows: unknown): string[] =>
  (Array.isArray(rows) ? rows : [rows]).filter(Boolean).map((r) => String((r as { id: unknown }).id)).sort();

/** Every `ReadableIds` leaf, composed or not, anywhere in `node`. */
function leavesIn(node: unknown, out: unknown[] = []): unknown[] {
  if (node === null || typeof node !== 'object') return out;
  if (isReadableIds(node) || isComposedReadableIds(node)) {
    out.push(node);
    if (isComposedReadableIds(node)) leavesIn((node as { scope?: unknown }).scope, out);
    return out;
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) leavesIn(value, out);
  return out;
}

type Posture = 'single' | 'isolated';

/** One rig per tenancy posture: the seeded rows are the same in both. */
async function boot(posture: Posture) {
  /** The `where` the driver received for each read of a detail, in order. */
  const received: Array<{ object: string; where: unknown }> = [];
  /** Every SQL statement the driver ran, while `capturing`. */
  const statements: string[] = [];
  let capturing = false;

  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.cbp-unrestricted-chain',
    name: 'A controlled_by_parent chain read over unrestricted hops',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysRecordShare, SysUser, SysOrganization, SysMember, SysUserPosition, SysUserPermissionSet,
      {
        name: ACCOUNT,
        label: 'Account',
        sharingModel: 'private',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
        },
      },
      detail(OPP, 'account', ACCOUNT, true),
      detail(LINE, 'opp', OPP, true),
      detail(NOTE, 'opp', OPP, false),
      {
        name: PUB_ACCOUNT,
        label: 'Public account',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
        },
      },
      detail(PUB_LINE, 'account', PUB_ACCOUNT, true),
    ],
  } as never);
  await engine.syncSchemas();

  await engine.insert('sys_organization', [ORG_A, ORG_B].map((id) => ({ id, name: id, slug: id })), SYS);
  await engine.insert('sys_user', [ADMIN_USER, MEMBER_USER, DETAIL_ADMIN_USER, LINE_ADMIN_USER].map((id) => ({
    id, name: id, email: `${id}@r4.test`,
  })), SYS);

  let securityService: unknown;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? SETS.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => SETS,
    },
    get sharing() { return sharing; },
    tenancy: { posture, isolationActive: posture !== 'single' },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { if (name === 'security') securityService = svc; },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  wireEngineSecuritySource(engine, () => plugin);
  sharing = new SharingService({ engine: engine as never, securityService: () => securityService as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });

  // Seeded as system, in each organization; the member owns acc_a1, the detail admin acc_a2.
  const inOrg = (org: string) => ({ context: { isSystem: true, tenantId: org } }) as never;
  await engine.insert(ACCOUNT, [
    { id: 'acc_a1', name: 'a1', owner_id: MEMBER_USER },
    { id: 'acc_a2', name: 'a2', owner_id: DETAIL_ADMIN_USER },
  ], inOrg(ORG_A));
  await engine.insert(ACCOUNT, [{ id: 'acc_b1', name: 'b1', owner_id: ADMIN_USER }], inOrg(ORG_B));
  await engine.insert(OPP, [
    { id: 'opp_a1', name: 'a1', account: 'acc_a1' },
    { id: 'opp_a2', name: 'a2', account: 'acc_a2' },
    // Orphan one hop up: its required master does not exist.
    { id: 'opp_a_ghost_account', name: 'ghost account', account: 'acc_ghost' },
  ], inOrg(ORG_A));
  await engine.insert(OPP, [{ id: 'opp_b1', name: 'b1', account: 'acc_b1' }], inOrg(ORG_B));
  await engine.insert(LINE, [
    { id: 'line_a1', name: 'a1', opp: 'opp_a1' },
    { id: 'line_a2', name: 'a2', opp: 'opp_a2' },
    // Orphan: a system write naming a master that does not exist (stored, measured).
    { id: 'line_a_ghost', name: 'ghost', opp: 'opp_ghost' },
    // Orphan through its master: the opportunity exists, its account does not.
    { id: 'line_a_ghost_account', name: 'ghost account', opp: 'opp_a_ghost_account' },
  ], inOrg(ORG_A));
  // Organization B: one line on a real chain, one orphan.
  await engine.insert(LINE, [
    { id: 'line_b1', name: 'b1', opp: 'opp_b1' },
    { id: 'line_b_ghost', name: 'ghost', opp: 'opp_ghost_b' },
  ], inOrg(ORG_B));
  // Orphan: the required master left empty — a row stored before the master
  // was declared required. The engine refuses the write, so the driver writes it.
  await (engine as any).getDriver(LINE).create(LINE, { id: 'line_a_null', name: 'null', opp: null, organization_id: ORG_A });
  await engine.insert(NOTE, [
    { id: 'note_a1', name: 'a1', opp: 'opp_a1' },
    // An OPTIONAL master naming one that does not exist: the leaf keeps it hidden.
    { id: 'note_a_ghost', name: 'ghost', opp: 'opp_ghost' },
  ], inOrg(ORG_A));

  // An unrestricted master for a plain member: the public account.
  await engine.insert(PUB_ACCOUNT, [{ id: 'pub_a1', name: 'p1' }], inOrg(ORG_A));
  await engine.insert(PUB_LINE, [
    { id: 'pub_line_1', name: 'p1', account: 'pub_a1' },
    { id: 'pub_line_ghost', name: 'ghost', account: 'pub_ghost' },
  ], inOrg(ORG_A));

  const origFind = (driver as any).find.bind(driver);
  (driver as any).find = async (object: string, query: any, opts: any) => {
    if (object === LINE || object === NOTE || object === PUB_LINE) received.push({ object, where: query?.where });
    return origFind(object, query, opts);
  };
  const origCount = (driver as any).count.bind(driver);
  (driver as any).count = async (object: string, query: any, opts: any) => {
    if (object === LINE || object === NOTE || object === PUB_LINE) received.push({ object, where: query?.where });
    return origCount(object, query, opts);
  };
  (driver as any).knex.on('query', (q: { sql?: unknown }) => {
    if (capturing && typeof q?.sql === 'string') statements.push(q.sql);
  });
  
  const read = async (object: string, context: object, where?: unknown) => {
    received.length = 0;
    statements.length = 0;
    capturing = true;
    try {
      const rows = await engine.find(object, { ...(where === undefined ? {} : { where }), context: { ...context } } as never);
      return { ids: ids(rows), where: received[0]?.where, sql: statements.filter((q) => /^select/i.test(q.trim())) };
    } finally {
      capturing = false;
    }
  };
  const count = async (object: string, context: object) => {
    statements.length = 0;
    capturing = true;
    try {
      return { n: await engine.count(object, { context: { ...context } } as never), sql: statements.filter((q) => /^select/i.test(q.trim())) };
    } finally {
      capturing = false;
    }
  };
  const stored = async (object: string) => ids(await engine.find(object, { context: { isSystem: true } } as never));
  return { engine, security: securityService as { getReadFilter: (o: string, c: unknown) => Promise<unknown> }, read, count, stored };
}

/** A statement that carries a parent-chain subquery. */
const SUBQUERY = /\bin \(select `id` from/i;

/** The rows whose whole master chain resolves: every reader's answer before the ruling. */
const CHAINED_LINES = ['line_a1', 'line_a2', 'line_b1'];
/** The orphans: a missing master, a master whose own master is missing, an empty required master. */
const ORPHAN_LINES = ['line_a_ghost', 'line_a_ghost_account', 'line_a_null', 'line_b_ghost'];

describe('[#33696 ruling 6893666857] the parent chain of a REQUIRED master over unrestricted hops — the real engine', () => {
  let rig: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => { rig = await boot('single'); });
  afterAll(async () => { try { await rig?.engine.destroy(); } catch { /* noop */ } });

  it('(a) View All on the detail over unrestricted hops runs no parent-chain subquery and sees every stored row, orphans included', async () => {
    const r = await rig.read(LINE, ADMIN);
    expect(leavesIn(r.where)).toEqual([]);
    expect(r.sql.filter((q) => /`r4_line`/.test(q))).toHaveLength(1);
    expect(r.sql.some((q) => SUBQUERY.test(q))).toBe(false);
    expect(r.ids).toEqual(await rig.stored(LINE));
    expect(r.ids).toEqual([...CHAINED_LINES, ...ORPHAN_LINES].sort());

    const c = await rig.count(LINE, ADMIN);
    expect(c.n).toBe(CHAINED_LINES.length + ORPHAN_LINES.length);
    expect(c.sql.some((q) => SUBQUERY.test(q))).toBe(false);
    const ghost = await rig.engine.findOne(LINE, { where: { id: 'line_a_ghost' }, context: { ...ADMIN } } as never);
    expect(ids(ghost)).toEqual(['line_a_ghost']);
  });

  it('(1) parity: on the rows whose master chain resolves, the read without the chain answers what the chain answered', async () => {
    const admin = await rig.read(LINE, ADMIN);
    // Every chained row is still served, and nothing beyond the chained rows but the orphans.
    expect(admin.ids.filter((id) => !ORPHAN_LINES.includes(id))).toEqual(CHAINED_LINES);
    // The intermediate hop: the unrestricted reader's direct read of the master drops its own leaf too.
    const opps = await rig.read(OPP, ADMIN);
    expect(opps.sql.some((q) => SUBQUERY.test(q))).toBe(false);
    expect(opps.ids).toEqual(await rig.stored(OPP));
  });

  it('the scope the security service hands a bypassing door (analytics) composes the same way: no subquery, the same rows', async () => {
    const scope = await rig.security.getReadFilter(LINE, { ...ADMIN });
    expect(leavesIn(scope).length).toBeGreaterThan(0);
    const r = await rig.read(LINE, ADMIN, scope);
    expect(r.sql.some((q) => SUBQUERY.test(q))).toBe(false);
    expect(r.ids).toEqual([...CHAINED_LINES, ...ORPHAN_LINES].sort());
  });

  it('(b) a reader with a restricted master hop keeps the whole chain and never sees an orphan', async () => {
    // View All on every detail; the private account stays owner-scoped (the detail admin owns acc_a2).
    const r = await rig.read(LINE, DETAIL_ADMIN);
    expect(r.sql.some((q) => SUBQUERY.test(q))).toBe(true);
    expect(r.ids).toEqual(['line_a2']);
    for (const orphan of ORPHAN_LINES) expect(r.ids).not.toContain(orphan);
  });

  it('(c) a reader with View All on the detail only keeps the whole chain and never sees an orphan', async () => {
    const r = await rig.read(LINE, LINE_ADMIN);
    expect(r.sql.some((q) => SUBQUERY.test(q))).toBe(true);
    expect(r.ids).toEqual([]);
    for (const orphan of ORPHAN_LINES) expect(r.ids).not.toContain(orphan);
  });

  it('(d) a plain member keeps the chain, over a restricted master and over an unrestricted one alike', async () => {
    const restricted = await rig.read(LINE, MEMBER);
    expect(restricted.sql.some((q) => SUBQUERY.test(q))).toBe(true);
    expect(restricted.ids).toEqual(['line_a1']);
    // The public account answers an unrestricted scope for the member: the chain stays, and so does its answer.
    const unrestricted = await rig.read(PUB_LINE, MEMBER);
    expect(unrestricted.sql.some((q) => SUBQUERY.test(q))).toBe(true);
    expect(unrestricted.ids).toEqual(['pub_line_1']);
    // The control: View All on the detail over the same unrestricted master drops it.
    const admin = await rig.read(PUB_LINE, ADMIN);
    expect(admin.sql.some((q) => SUBQUERY.test(q))).toBe(false);
    expect(admin.ids).toEqual(['pub_line_1', 'pub_line_ghost']);
  });

  it('(2) an OPTIONAL master keeps its leaf for an unrestricted reader: a note naming a missing master stays hidden', async () => {
    const r = await rig.read(NOTE, ADMIN);
    expect(r.sql.some((q) => SUBQUERY.test(q))).toBe(true);
    expect(r.ids).toEqual(['note_a1']);
    expect(await rig.stored(NOTE)).toContain('note_a_ghost');
  });
});

describe('[#33696 ruling 6893666857] the tenant wall still bounds the detail rows — walled posture', () => {
  let rig: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => { rig = await boot('isolated'); });
  afterAll(async () => { try { await rig?.engine.destroy(); } catch { /* noop */ } });

  it('(e) a View All reader of one organization never sees a row, orphan or not, of another', async () => {
    const a = await rig.read(LINE, ADMIN);
    const b = await rig.read(LINE, ADMIN_B);
    for (const id of ['line_b1', 'line_b_ghost']) expect(a.ids).not.toContain(id);
    for (const id of ['line_a1', 'line_a2', 'line_a_ghost', 'line_a_ghost_account', 'line_a_null']) expect(b.ids).not.toContain(id);
    expect(a.ids).toEqual(expect.arrayContaining(['line_a1', 'line_a2']));
    expect(b.ids).toEqual(expect.arrayContaining(['line_b1']));
  });
});

/** A write's answer: landed, or the refusal's code and status (the ADR-0112 envelope). */
const outcomeOf = (p: Promise<unknown>) =>
  p.then(
    () => ({ kind: 'landed' as const }),
    (e: { code?: unknown; status?: unknown; statusCode?: unknown } | null) => ({
      kind: 'refused' as const,
      code: e?.code == null ? undefined : String(e.code),
      status: Number(e?.statusCode ?? e?.status),
    }),
  );

describe('[#33696 · review 6895328067 route (a)] the write doors keep the chain: a View All reader over unrestricted hops writes as before', () => {
  // Ruling 6893666857 is a READ ruling. The reads the security plugin asks on a
  // write's behalf under the caller's context — the predicate-write narrowing,
  // the 2.8 gate's predicate leg and the step-2.7 by-id read — keep the chain,
  // so an orphan stays outside every write exactly as before the ruling.
  let rig: Awaited<ReturnType<typeof boot>>;
  // Two rows the admin created: a predicate write here composes the
  // own-records write predicate (`created_by` = the caller), so these are the
  // rows the admin's predicate writes land on. The rig stamps no `created_by`,
  // so the driver stores it.
  const MINE = ['line_mine_1', 'line_mine_2'];
  beforeAll(async () => {
    rig = await boot('single');
    const driver = (rig.engine as any).getDriver(LINE);
    await driver.create(LINE, { id: 'line_mine_1', name: 'mine1', opp: 'opp_a1', organization_id: ORG_A, created_by: ADMIN_USER });
    await driver.create(LINE, { id: 'line_mine_2', name: 'mine2', opp: 'opp_a2', organization_id: ORG_A, created_by: ADMIN_USER });
  });
  afterAll(async () => { try { await rig?.engine.destroy(); } catch { /* noop */ } });

  it('a hook\'s read inside a write, under the caller\'s context, keeps the chain and sees no orphan', async () => {
    let seen: string[] | undefined;
    rig.engine.registerHook(
      'afterUpdate',
      async (hookCtx: any) => {
        seen ??= ids(await hookCtx.api.object(LINE).find({}));
      },
      { object: PUB_LINE, packageId: 'com.objectstack.qa.cbp-unrestricted-chain-write' },
    );
    const outcome = await outcomeOf(rig.engine.update(PUB_LINE, { name: 'edited' }, { where: { id: 'pub_line_1' }, context: { ...ADMIN } } as never));
    expect(outcome).toEqual({ kind: 'landed' });
    expect(seen).toEqual([...CHAINED_LINES, ...MINE].sort());
    // The control: the same reader's plain read, outside any write, drops the chain.
    expect((await rig.read(LINE, ADMIN)).ids).toEqual([...CHAINED_LINES, ...MINE, ...ORPHAN_LINES].sort());
  });

  it('a predicate delete over a set holding an empty-required-master orphan deletes the other rows and leaves the orphan', async () => {
    const outcome = await outcomeOf(rig.engine.delete(LINE, {
      where: { name: { $in: ['mine1', 'null'] } }, multi: true, context: { ...ADMIN },
    } as never));
    expect(outcome).toEqual({ kind: 'landed' });
    const left = await rig.stored(LINE);
    expect(left).not.toContain('line_mine_1');
    expect(left).toContain('line_a_null');
  });

  it('a predicate update over a set holding an empty-master and a dangling-master orphan edits the other rows and leaves both orphans', async () => {
    const outcome = await outcomeOf(rig.engine.update(LINE, { name: 'edited' }, {
      where: { name: { $in: ['mine2', 'null', 'ghost'] } }, multi: true, context: { ...ADMIN },
    } as never));
    expect(outcome).toEqual({ kind: 'landed' });
    const rows = (await rig.engine.find(LINE, { context: { isSystem: true } } as never)) as Array<{ id: string; name: string }>;
    const nameOf = (id: string) => rows.find((r) => r.id === id)?.name;
    expect(nameOf('line_mine_2')).toBe('edited');
    expect(nameOf('line_a_null')).toBe('null');
    expect(nameOf('line_a_ghost')).toBe('ghost');
  });

  it('a by-id update or delete of an orphan is still not found', async () => {
    expect(await outcomeOf(rig.engine.update(LINE, { name: 'edited' }, { where: { id: 'line_a_ghost' }, context: { ...ADMIN } } as never)))
      .toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
    expect(await outcomeOf(rig.engine.delete(LINE, { where: { id: 'line_a_null' }, context: { ...ADMIN } } as never)))
      .toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
    expect(await rig.stored(LINE)).toEqual(expect.arrayContaining(['line_a_ghost', 'line_a_null']));
  });
});

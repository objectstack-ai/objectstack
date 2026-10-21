// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D6, as amended — the nested master chain] A `ReadableIds` leaf
 * that sits INSIDE a composed scope is composed by the engine too, so a
 * two-level `controlled_by_parent` chain — a child whose master is itself
 * `controlled_by_parent` — compiles to ONE statement with the subqueries
 * nested, and serves exactly the rows today's id-list path serves.
 *
 * Measured on the real stack: `ObjectQL` over better-sqlite3, the real
 * `SecurityPlugin` with the real `SharingService` behind it, direct member
 * contexts and the delegated context `resolveAuthzContext` and
 * `assembleExecutionContext` assemble. The chain is
 * child → PARENT (`controlled_by_parent`, its master GRAND) → GRAND (`private`,
 * owner-scoped by plugin-sharing), read two ways over the SAME rows:
 *
 *  - **today's id-list path**: a `controlled_by_parent` child of PARENT, read
 *    as the security middleware chain scopes it — `computeControlledByParentFilter`
 *    pre-scans GRAND and then PARENT under a system context and hands the
 *    driver `parent IN [ids]` (ADR-0055 §2 mechanism (b));
 *  - **the leaf path**: a child of the same shape whose reads carry
 *    `{ parent: { $in: ReadableIds.of(PARENT) } }` (a consumer-shaped
 *    middleware writes it), with the engine's security source wrapped so that
 *    `getReadFilter(PARENT)` answers the real scope with its pre-resolved
 *    master id list replaced by the leaf `ReadableIds.of(GRAND)` — the
 *    spelling the plugin-security switch (ruling 6303721609, card (c)) will
 *    answer. The wrapper stands in for that switch and touches nothing else:
 *    `getReadFilter(GRAND)` and both `canReadObject` halves are the real
 *    service's, asked by the engine with the caller's context at each level.
 *
 * Before the engine composed the nested leaf, the leaf path answered
 * `INTERNAL_ERROR` / 500: driver-sql refused the uncomposed leaf inside the
 * parent's subquery (the #24932 dev report's measurement, reproduced here on
 * the base before the change). The closed doors are measured beside the
 * parity: a caller the grandparent object does not admit, a delegator who
 * does not exist, and a delegator the grandparent object does not admit.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
import { ReadableIds, RLS_DENY_FILTER } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ORG = 'org_rid_nest';

/** The top of the chain: `private`, so plugin-sharing's owner-match scopes it per identity. */
const GRAND = 'qa_rid_nest_grand';
/** The middle: `controlled_by_parent`, its master GRAND — its read scope is derived from GRAND's. */
const PARENT = 'qa_rid_nest_parent';
/** Today's path: a `controlled_by_parent` child of PARENT, scoped by the id-list pre-scan. */
const CHILD_CBP = 'qa_rid_nest_child_cbp';
/** The leaf path: the same rows, read through a leaf over PARENT that a consumer-shaped middleware writes. */
const CHILD_LEAF = 'qa_rid_nest_child_leaf';

/** The delegator: the human an agent acts for, and the owner of two grandparents. */
const HUMAN = 'u_rid_nest_human';
/** Owns the other grandparents. */
const OTHER = 'u_rid_nest_other';
/** A caller whose grants do not admit the grandparent object. */
const NO_GRAND_READ = 'u_rid_nest_no_grand_read';

const SET = {
  /** Object read on the whole chain, silent on rows. */
  human: 'qa_rid_nest_human',
  /** The agent's ceiling: object read on the whole chain, a content rule on GRAND's rows, silent on depth. */
  ceiling: 'qa_rid_nest_ceiling',
  /** Object read on PARENT and the children, not on GRAND. */
  noGrand: 'qa_rid_nest_no_grand',
} as const;

type Outcome = { kind: 'landed' } | { kind: 'refused'; code?: string; status?: number };

const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    () => ({ kind: 'landed' as const }),
    (e: unknown) => {
      const x = e as { code?: unknown; status?: unknown; statusCode?: unknown } | null;
      const status = x?.statusCode ?? x?.status;
      return {
        kind: 'refused' as const,
        code: x?.code == null ? undefined : String(x.code),
        status: status == null ? undefined : Number(status),
      };
    },
  );

const releaseAsyncContexts = (...owners: object[]): void => {
  for (const owner of owners) {
    for (const value of Object.values(owner)) if (value instanceof AsyncLocalStorage) value.disable();
  }
};

const ids = (rows: unknown): string[] =>
  (Array.isArray(rows) ? rows : [rows])
    .filter(Boolean)
    .map((r) => String((r as { id: unknown }).id))
    .sort();

const leafBranch = () => ({ parent: { $in: ReadableIds.of(PARENT) } });

/**
 * The real scope with every pre-resolved master id list on `fk` replaced by
 * the leaf over `master` — `{ fk: { $in: [ids] } }` becomes
 * `{ fk: { $in: ReadableIds.of(master) } }`, copy-on-write — and how many
 * were replaced. The spelling the plugin-security switch will answer.
 */
function withLeafForMaster(scope: unknown, fk: string, master: string): { scope: unknown; replaced: number } {
  let replaced = 0;
  const rewrite = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(rewrite);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === fk && value !== null && typeof value === 'object' && Array.isArray((value as { $in?: unknown }).$in)) {
        replaced++;
        out[key] = { ...(value as Record<string, unknown>), $in: ReadableIds.of(master) };
      } else {
        out[key] = rewrite(value);
      }
    }
    return out;
  };
  return { scope: rewrite(scope), replaced };
}

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.readable-ids-nested-compose',
    name: 'The ReadableIds leaf composes inside a composed scope: the nested master chain',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      {
        name: GRAND,
        label: 'Grandparent',
        sharingModel: 'private',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
        },
      },
      {
        name: PARENT,
        label: 'Parent',
        sharingModel: 'controlled_by_parent',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          grand: { name: 'grand', type: 'master_detail', reference: GRAND, required: true },
        },
      },
      {
        name: CHILD_CBP,
        label: 'Child (controlled by parent)',
        sharingModel: 'controlled_by_parent',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          note: { name: 'note', type: 'text' },
          parent: { name: 'parent', type: 'master_detail', reference: PARENT, required: true },
        },
      },
      {
        name: CHILD_LEAF,
        label: 'Child (read through the leaf)',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          note: { name: 'note', type: 'text' },
          parent: { name: 'parent', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less permission-set catalogue row below exists only on a
  // store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): that table is this store's.
  await relaxTenantColumns(engine as never, ['sys_permission_set']);

  const e = engine as unknown as {
    insert: (o: string, row: Record<string, unknown>, opts: never) => Promise<unknown>;
    getDriver: (o: string) => { create: (o: string, row: Record<string, unknown>) => Promise<unknown>; knex: { on: (ev: string, fn: (q: { sql?: unknown }) => void) => void; removeListener: (ev: string, fn: (q: { sql?: unknown }) => void) => void } };
    logger: { warn: () => void };
  };
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: ORG }, SYS);
  for (const id of [HUMAN, OTHER, NO_GRAND_READ]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
    await e.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: ORG, role: 'member' }, SYS);
  }
  const READ = { allowRead: true } as const;
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({ name: SET.human, objects: { [GRAND]: READ, [PARENT]: READ, [CHILD_CBP]: READ, [CHILD_LEAF]: READ } }),
    PermissionSetSchema.parse({
      name: SET.ceiling,
      objects: { [GRAND]: READ, [PARENT]: READ, [CHILD_CBP]: READ, [CHILD_LEAF]: READ },
      rowLevelSecurity: [
        { name: 'qa_rid_nest_ceiling_open_only', object: GRAND, operation: 'select', using: "record.name == 'open'" },
      ],
    }),
    PermissionSetSchema.parse({ name: SET.noGrand, objects: { [PARENT]: READ, [CHILD_CBP]: READ, [CHILD_LEAF]: READ } }),
  ];
  // The delegators hold their sets through stored grants, as a user does.
  for (const name of [SET.human, SET.noGrand]) {
    await e.getDriver('sys_permission_set').create('sys_permission_set', {
      id: `ps_${name}`, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  for (const [user, set] of [[HUMAN, SET.human], [OTHER, SET.human], [NO_GRAND_READ, SET.noGrand]] as const) {
    await e.insert('sys_user_permission_set', { id: `ups_${user}`, user_id: user, permission_set: set, organization_id: ORG }, SYS);
  }

  // The grandparents, named for the leg(s) of a delegated read that admit them.
  await e.insert(GRAND, { id: 'g_both', name: 'open', owner_id: HUMAN }, SYS);
  await e.insert(GRAND, { id: 'g_del_only', name: 'secret', owner_id: HUMAN }, SYS);
  await e.insert(GRAND, { id: 'g_caller_only', name: 'open', owner_id: OTHER }, SYS);
  await e.insert(GRAND, { id: 'g_neither', name: 'secret', owner_id: OTHER }, SYS);
  await e.insert(GRAND, { id: 'g_shared', name: 'open', owner_id: OTHER }, SYS);
  await e.insert('sys_record_share', {
    id: 'shr_rid_nest_1', object_name: GRAND, record_id: 'g_shared', recipient_type: 'user', recipient_id: HUMAN, access_level: 'read',
  }, SYS);
  // The parents, one per grandparent, plus one with a dangling and one with a
  // null master pointer (written through the driver: the required master is
  // what the authoring door refuses, and these rows exist to be excluded). A
  // driver write is not stamped, so it names the rig's organization itself.
  for (const [id, grand] of [
    ['p_both', 'g_both'], ['p_del_only', 'g_del_only'], ['p_caller_only', 'g_caller_only'],
    ['p_neither', 'g_neither'], ['p_shared', 'g_shared'], ['p_dangling', 'g_missing'], ['p_null', null],
  ] as const) {
    await e.getDriver(PARENT).create(PARENT, { id, name: id, grand, organization_id: ORG });
  }
  // The same children in both tables, so the two paths read the same rows.
  for (const child of [CHILD_CBP, CHILD_LEAF]) {
    for (const [id, parent] of [
      ['c_both', 'p_both'], ['c_del_only', 'p_del_only'], ['c_caller_only', 'p_caller_only'],
      ['c_neither', 'p_neither'], ['c_shared', 'p_shared'], ['c_via_dangling', 'p_dangling'], ['c_via_null', 'p_null'],
      ['c_dangling', 'p_missing'], ['c_null', null],
    ] as const) {
      await e.getDriver(child).create(child, { id, note: '', parent, organization_id: ORG });
    }
  }

  let security: {
    getReadFilter: (o: string, c: unknown) => Promise<Record<string, unknown> | undefined>;
    canReadObject: (o: string, c: unknown) => Promise<boolean>;
  } | undefined;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s: { name?: string }) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    tenancy: { posture: 'single' },
    get sharing() { return sharing; },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => {
      if (name === 'security') security = svc as typeof security;
      else services[name] = svc;
    },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The engine's security source (what `ObjectQLPlugin.init` puts in the
  // slot): the real service, with PARENT's read scope answered in the
  // spelling the plugin-security switch will answer — the pre-resolved master
  // id list replaced by the leaf over GRAND. Every other answer is the real
  // service's, untouched.
  const replacedPerCall: number[] = [];
  const wrapped = {
    canReadObject: (object: string, context: unknown) => security!.canReadObject(object, context),
    async getReadFilter(object: string, context: unknown) {
      const real = await security!.getReadFilter(object, context);
      if (object !== PARENT || real === undefined || real === RLS_DENY_FILTER) return real;
      const { scope, replaced } = withLeafForMaster(real, 'grand', GRAND);
      replacedPerCall.push(replaced);
      return scope;
    },
  };
  (engine as unknown as Record<symbol, unknown>)[Symbol.for('objectstack.objectql.securityServiceSource')] = () => wrapped;
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  // The consumer shape: an object-scoped read middleware on the leaf-path
  // child writes the leaf over PARENT into every read, after the security chain.
  engine.registerMiddleware(async (opCtx, next) => {
    if (opCtx.ast && ['find', 'findOne', 'count', 'aggregate'].includes(opCtx.operation)) {
      opCtx.ast.where = opCtx.ast.where ? { $and: [opCtx.ast.where, leafBranch()] } : leafBranch();
    }
    await next();
  }, { object: CHILD_LEAF });
  vi.spyOn(e.logger, 'warn').mockImplementation(() => undefined);

  /** A delegated context for `userId`, as the OAuth door assembles it, the agent holding `ceiling` as its only grant. */
  const onBehalfOf = async (userId: string, ceiling: string = SET.ceiling) => {
    const authz = await resolveAuthzContext({
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      ql: engine,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `sess_${userId}`, userId, activeOrganizationId: ORG },
      }),
      tenancyPosture: 'single',
    } as never);
    return assembleExecutionContext({
      authz,
      oauth: { userId, scopes: ['data:read'], clientId: 'qa_agent_client', scopePermissions: [ceiling], delegatesActions: false },
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    } as never)!;
  };

  return {
    engine,
    onBehalfOf,
    replacedPerCall,
    read: async (object: string, context: unknown) =>
      ids(await engine.find(object, { context: { ...(context as object) } } as never)),
    count: (object: string, context: unknown) => engine.count(object, { context: { ...(context as object) } } as never),
    readOutcome: (object: string, context: unknown) => outcomeOf(engine.find(object, { context: { ...(context as object) } } as never)),
    canReadObject: (object: string, context: unknown) => security!.canReadObject(object, { ...(context as object) }),
    /** The SQL statements the driver ran during `run`, as their text. */
    statementsDuring: async (run: () => Promise<unknown>): Promise<string[]> => {
      const seen: string[] = [];
      const onQuery = (q: { sql?: unknown }) => { seen.push(String(q?.sql ?? '')); };
      const knex = e.getDriver(CHILD_LEAF).knex;
      knex.on('query', onQuery);
      try { await run(); } finally { knex.removeListener('query', onQuery); }
      return seen;
    },
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;

const member = (userId: string, set: string) => ({ userId, positions: [], permissions: [set], posture: 'MEMBER' });
/** The table a statement's FIRST `from` names — the table it reads, not one inside a subquery of it. */
const fromTable = (sql: string): string | undefined => /^select .*? from `?([a-z0-9_]+)`?/i.exec(sql)?.[1];
/** A statement that reads `table` — not one that reads another table with `table` inside a subquery. */
const readsTable = (table: string) => (sql: string) => fromTable(sql) === table;

describe('[ADR-0139 D6 as amended] a two-level controlled_by_parent chain composes and serves the rows the id-list path serves', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  it('the grandparents, measured apart: the owner-match plus the one share for each identity', async () => {
    expect(await rig.read(GRAND, member(HUMAN, SET.human))).toEqual(['g_both', 'g_del_only', 'g_shared']);
    expect(await rig.read(GRAND, member(OTHER, SET.human))).toEqual(['g_caller_only', 'g_neither', 'g_shared']);
  });

  it("a direct caller: the leaf path serves exactly the rows today's id-list path serves — find and count, both identities", async () => {
    for (const [user, expected] of [
      [HUMAN, ['c_both', 'c_del_only', 'c_shared']],
      [OTHER, ['c_caller_only', 'c_neither', 'c_shared']],
    ] as const) {
      const context = member(user, SET.human);
      const today = await rig.read(CHILD_CBP, context);
      const viaLeaf = await rig.read(CHILD_LEAF, context);
      expect(today, user).toEqual([...expected]);
      expect(viaLeaf, user).toEqual(today);
      expect(await rig.count(CHILD_LEAF, context), user).toBe(expected.length);
      expect(await rig.count(CHILD_CBP, context), user).toBe(expected.length);
    }
    // A dangling or null master pointer at either level is excluded on both
    // paths (ruling 6303721609 item 4: never "no restriction" for them).
    expect(await rig.read(CHILD_LEAF, member(HUMAN, SET.human))).not.toContain('c_via_dangling');
    expect(await rig.read(CHILD_LEAF, member(HUMAN, SET.human))).not.toContain('c_via_null');
  });

  it("a delegated caller: the leaf path serves exactly the rows today's path serves — the delegator intersection at both levels", async () => {
    const context = await rig.onBehalfOf(HUMAN);
    const today = await rig.read(CHILD_CBP, context);
    expect(today).toEqual(['c_both', 'c_shared']);
    expect(await rig.read(CHILD_LEAF, context)).toEqual(today);
    expect(await rig.count(CHILD_LEAF, context)).toBe(2);
    expect(await rig.count(CHILD_CBP, context)).toBe(2);
  });

  it("the wrapper replaced PARENT's pre-resolved master id list with the leaf on every composed read: once per leg", async () => {
    // The direct answer carries one `controlled_by_parent` predicate; the
    // delegated answer carries one per leg (ADR-0090 D10). Either way, every
    // list was replaced — none reached the driver as a bound id list.
    expect(rig.replacedPerCall.length).toBeGreaterThan(0);
    expect(rig.replacedPerCall.every((n) => n >= 1)).toBe(true);
    expect(new Set(rig.replacedPerCall)).toEqual(new Set([1, 2]));
  });

  it('one statement per find and per count on the leaf path: the child\'s select with the parent and the grandparent inside nested subqueries, and no pre-scan of the parent — against the pre-scans of today\'s path', async () => {
    const context = member(HUMAN, SET.human);
    for (const [verb, run] of [
      ['find', () => rig.engine.find(CHILD_LEAF, { context: { ...context } } as never)],
      ['count', () => rig.engine.count(CHILD_LEAF, { context: { ...context } } as never)],
    ] as const) {
      const statements = await rig.statementsDuring(run);
      const all = `${verb}:\n${statements.join('\n')}`;
      // The read is ONE statement: the child's, the parent inside its subquery
      // and the grandparent inside that one.
      const reads = statements.filter(readsTable(CHILD_LEAF));
      expect(reads, all).toHaveLength(1);
      expect(reads[0].match(/in \(select/gi) ?? [], all).toHaveLength(2);
      expect(reads[0], all).toMatch(new RegExp(`in \\(select .id. from .${PARENT}. where .grand. in \\(select .id. from .${GRAND}.`, 'i'));
      // No statement reads the parent on its own: the leaf stands where the
      // pre-resolved id list stood, so the parent is never pre-scanned.
      expect(statements.filter(readsTable(PARENT)), all).toHaveLength(0);
      // What else the driver ran is the security service's own answering, not
      // the read: the real `getReadFilter(PARENT)` still derives PARENT's
      // scope through `computeControlledByParentFilter`, whose grandparent
      // pre-scan this rig's wrapper then REPLACES with the leaf (it retires
      // with the plugin-security switch, card (c)), and plugin-sharing reads
      // the share rows to answer the grandparent's scope. Neither is a read
      // of the child, the parent or — as a read of its own — the grandparent
      // by the composed statement.
      for (const sql of statements.filter(readsTable(GRAND))) expect(sql, all).toMatch(/^select .id. from/i);
    }
    // Today's path: the grandparent and then the parent are pre-scanned under
    // a system context (`select id from …`), and the child's own statement
    // binds the parent ids as a list — no subquery anywhere.
    const today = await rig.statementsDuring(() => rig.engine.find(CHILD_CBP, { context: { ...context } } as never));
    const todayAll = `today:\n${today.join('\n')}`;
    expect(today.filter(readsTable(GRAND)), todayAll).toHaveLength(1);
    expect(today.filter(readsTable(PARENT)), todayAll).toHaveLength(1);
    const todayReads = today.filter(readsTable(CHILD_CBP));
    expect(todayReads, todayAll).toHaveLength(1);
    expect(todayReads[0], todayAll).not.toMatch(/in \(select/i);
    expect(today.some((sql) => /in \(select/i.test(sql)), todayAll).toBe(false);
  });
});

describe('[ADR-0139 D6 as amended] the closed doors stay closed at every level of the chain', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  it('a caller the grandparent object does not admit reads no child on either path: canReadObject(GRAND) is false, the nested leaf is $in: []', async () => {
    const context = member(NO_GRAND_READ, SET.noGrand);
    expect(await rig.readOutcome(GRAND, context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect(await rig.canReadObject(GRAND, context)).toBe(false);
    expect(await rig.read(CHILD_CBP, context)).toEqual([]);
    expect(await rig.read(CHILD_LEAF, context)).toEqual([]);
    expect(await rig.count(CHILD_LEAF, context)).toBe(0);
  });

  it('a delegator who does not exist: every read of the principal is refused at admission, on both paths', async () => {
    const context = { ...(await rig.onBehalfOf(HUMAN)), onBehalfOf: { userId: 'u_rid_nest_missing', principalKind: 'human' } };
    expect(await rig.readOutcome(CHILD_CBP, context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect(await rig.readOutcome(CHILD_LEAF, context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
  });

  it('a delegator the grandparent object does not admit: the leaf path and today\'s path both serve nothing', async () => {
    const context = await rig.onBehalfOf(NO_GRAND_READ);
    expect(await rig.canReadObject(GRAND, context)).toBe(false);
    expect(await rig.read(CHILD_CBP, context)).toEqual([]);
    expect(await rig.read(CHILD_LEAF, context)).toEqual([]);
  });

  it('CONTROL — a system context reads every leaf-path child whose parent row exists, the chain composed with no restriction', async () => {
    expect(await rig.read(CHILD_LEAF, { isSystem: true })).toEqual([
      'c_both', 'c_caller_only', 'c_del_only', 'c_neither', 'c_shared', 'c_via_dangling', 'c_via_null',
    ]);
  });
});

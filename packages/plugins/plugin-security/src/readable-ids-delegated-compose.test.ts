// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D5.1, as amended / ADR-0090 D10] The engine composes its
 * `ReadableIds` leaf for a DELEGATED (on-behalf-of) caller, and the scope it is
 * composed with is the delegator intersection: `getReadFilter` answers the same
 * six layers the engine middleware chain ANDs into a delegated `find` of the
 * parent — the principal's RLS and `controlled_by_parent` derivation, the
 * delegator's two, and plugin-sharing's visibility filter for each identity at
 * its own depth — so a child read through the leaf serves exactly the children
 * whose parent BOTH legs admit.
 *
 * Measured on the real stack: `ObjectQL` over better-sqlite3, the real
 * `SecurityPlugin` with the real `SharingService` behind it, and the delegated
 * context assembled by `resolveAuthzContext` and `assembleExecutionContext` as
 * the OAuth door assembles it — `userId` the human, the link naming them as the
 * delegator, the agent's ceiling set as its only grant.
 *
 * The two legs are made to disagree on purpose:
 *
 *  - the CEILING admits a parent row by its content (`name == 'open'`) and is
 *    silent on depth, so its leg carries no owner narrowing (the agent leg's
 *    depth is `org` for a silent ceiling, `intersectDelegatedScope`);
 *  - the DELEGATOR's own set is silent on rows, so their leg is plugin-sharing's
 *    owner-match on a `private` parent plus the one record shared to them.
 *
 * So `p_caller_only` (open, owned by someone else) is admitted by the caller
 * leg alone, `p_del_only` (secret, the delegator's own) by the delegator leg
 * alone, and only `p_both` and `p_shared` by both. The closed doors are
 * measured beside it: a delegator who does not exist, a delegator the parent
 * object does not admit, and the two D5 classes that still refuse.
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
const ORG = 'org_rid_del';

/** The parent the leaf is over: `private`, so plugin-sharing's owner-match scopes it per identity. */
const PARENT = 'qa_rid_del_parent';
/** A child pointing at the parent; a consumer-shaped middleware writes the leaf into its reads. */
const CHILD = 'qa_rid_del_child';
/** A parent an object-scoped read middleware narrows: D5.2, still refused. */
const GATED = 'qa_rid_del_gated';

/** The delegator: the human an agent acts for, and the delegated context's own `userId`. */
const HUMAN = 'u_rid_del_human';
/** Owns the rows the delegator does not. */
const OTHER = 'u_rid_del_other';
/** A delegator whose grants do not admit the parent object. */
const NO_PARENT_READ = 'u_rid_del_no_parent_read';

const SET = {
  /** The agent's ceiling: object read on both, a content rule on the parent's rows, silent on depth. */
  ceiling: 'qa_rid_del_ceiling',
  /** The delegator's own set: object read on both, silent on rows. */
  human: 'qa_rid_del_human',
  /** A set that admits the child but not the parent object. */
  childOnly: 'qa_rid_del_child_only',
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

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.readable-ids-delegated-compose',
    name: 'The ReadableIds leaf composes for a delegated caller with the delegator intersection',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      {
        name: PARENT,
        label: 'Parent',
        sharingModel: 'private',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
        },
      },
      {
        name: CHILD,
        label: 'Child',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          note: { name: 'note', type: 'text' },
          parent: { name: 'parent', type: 'text' },
        },
      },
      {
        name: GATED,
        label: 'Gated parent',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
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
  for (const id of [HUMAN, OTHER, NO_PARENT_READ]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
    await e.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: ORG, role: 'member' }, SYS);
  }
  const READ = { allowRead: true } as const;
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({
      name: SET.ceiling,
      objects: { [PARENT]: READ, [CHILD]: READ, [GATED]: READ },
      rowLevelSecurity: [
        { name: 'qa_rid_del_ceiling_open_only', object: PARENT, operation: 'select', using: "record.name == 'open'" },
      ],
    }),
    PermissionSetSchema.parse({ name: SET.human, objects: { [PARENT]: READ, [CHILD]: READ, [GATED]: READ } }),
    PermissionSetSchema.parse({ name: SET.childOnly, objects: { [CHILD]: READ } }),
  ];
  // The delegators hold their sets through stored grants, as a user does.
  for (const name of [SET.human, SET.childOnly]) {
    await e.getDriver('sys_permission_set').create('sys_permission_set', {
      id: `ps_${name}`, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  for (const [user, set] of [[HUMAN, SET.human], [OTHER, SET.human], [NO_PARENT_READ, SET.childOnly]] as const) {
    await e.insert('sys_user_permission_set', { id: `ups_${user}`, user_id: user, permission_set: set, organization_id: ORG }, SYS);
  }

  // The parent rows, named for the leg(s) that admit them.
  await e.insert(PARENT, { id: 'p_both', name: 'open', owner_id: HUMAN }, SYS);
  await e.insert(PARENT, { id: 'p_del_only', name: 'secret', owner_id: HUMAN }, SYS);
  await e.insert(PARENT, { id: 'p_caller_only', name: 'open', owner_id: OTHER }, SYS);
  await e.insert(PARENT, { id: 'p_neither', name: 'secret', owner_id: OTHER }, SYS);
  await e.insert(PARENT, { id: 'p_shared', name: 'open', owner_id: OTHER }, SYS);
  await e.insert('sys_record_share', {
    id: 'shr_rid_del_1', object_name: PARENT, record_id: 'p_shared', recipient_type: 'user', recipient_id: HUMAN, access_level: 'read',
  }, SYS);
  for (const [id, parent] of [
    ['c_both', 'p_both'], ['c_del_only', 'p_del_only'], ['c_caller_only', 'p_caller_only'],
    ['c_neither', 'p_neither'], ['c_shared', 'p_shared'], ['c_dangling', 'p_missing'], ['c_null', null],
  ] as const) {
    await e.insert(CHILD, { id, note: '', parent }, SYS);
  }
  await e.insert(GATED, { id: 'g_1', name: 'open' }, SYS);

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
  // What `ObjectQLPlugin.init` does on a kernel: put the SOURCE of the
  // `security` service in the engine's slot, read at every composition. The
  // key is `Symbol.for`, the one slot every bundle of the engine names.
  (engine as unknown as Record<symbol, unknown>)[Symbol.for('objectstack.objectql.securityServiceSource')] = () => security;
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  // The consumer shape: an object-scoped read middleware on the CHILD writes
  // the leaf over the parent into every read, after the security chain.
  engine.registerMiddleware(async (opCtx, next) => {
    if (opCtx.ast && ['find', 'findOne', 'count', 'aggregate'].includes(opCtx.operation)) {
      opCtx.ast.where = opCtx.ast.where ? { $and: [opCtx.ast.where, leafBranch()] } : leafBranch();
    }
    await next();
  }, { object: CHILD });
  // D5.2's shape: an object-scoped read middleware on a parent.
  engine.registerMiddleware(async (_opCtx, next) => next(), { object: GATED });
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
    read: async (object: string, context: unknown, where?: Record<string, unknown>) =>
      ids(await engine.find(object, { ...(where ? { where } : {}), context: { ...(context as object) } } as never)),
    count: (object: string, context: unknown) => engine.count(object, { context: { ...(context as object) } } as never),
    readOutcome: (object: string, context: unknown) => outcomeOf(engine.find(object, { context: { ...(context as object) } } as never)),
    /** The ids `getReadFilter`'s scope admits, read with it as the only predicate under a system context. */
    readThroughReadFilter: async (object: string, context: unknown) => {
      const scope = await security!.getReadFilter(object, { ...(context as object) });
      return ids(await engine.find(object, { where: scope ?? {}, context: { isSystem: true } } as never));
    },
    readFilter: (object: string, context: unknown) => security!.getReadFilter(object, { ...(context as object) }),
    canReadObject: (object: string, context: unknown) => security!.canReadObject(object, { ...(context as object) }),
    /** The SQL statements the driver ran during `run`, as their text. */
    statementsDuring: async (run: () => Promise<unknown>): Promise<string[]> => {
      const seen: string[] = [];
      const onQuery = (q: { sql?: unknown }) => { seen.push(String(q?.sql ?? '')); };
      const knex = e.getDriver(CHILD).knex;
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

describe('[ADR-0139 D5.1 as amended] a delegated read through the leaf serves the delegator intersection', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  it("the legs, measured apart: the delegator's own read, and the ceiling's rule on a principal who owns the other rows", async () => {
    // The delegator's own leg: owner-match plus the one share, every name.
    expect(await rig.read(PARENT, member(HUMAN, SET.human))).toEqual(['p_both', 'p_del_only', 'p_shared']);
    // The ceiling's content rule, held directly by the owner of the other rows:
    // `open` only. Its leg under delegation carries no owner narrowing at all
    // (a silent ceiling's depth is `org`), so it admits `p_caller_only` too.
    expect(await rig.read(PARENT, member(OTHER, SET.ceiling))).toEqual(['p_caller_only', 'p_shared']);
  });

  it("the delegated read of the parent itself is the intersection: the delegator's rows the ceiling admits", async () => {
    const context = await rig.onBehalfOf(HUMAN);
    expect(await rig.read(PARENT, context)).toEqual(['p_both', 'p_shared']);
  });

  it('a delegated read through the leaf serves exactly the children whose parent both legs admit — find, count', async () => {
    const context = await rig.onBehalfOf(HUMAN);
    // `p_caller_only` is admitted by the caller leg alone, `p_del_only` by the
    // delegator leg alone: neither child is served. A dangling or null pointer
    // is excluded as before (the subquery finds no such id).
    expect(await rig.read(CHILD, context)).toEqual(['c_both', 'c_shared']);
    expect(await rig.count(CHILD, context)).toBe(2);
  });

  it("CONTROL — the delegator's own read through the leaf serves their own rows' children, the ceiling not applied", async () => {
    expect(await rig.read(CHILD, member(HUMAN, SET.human))).toEqual(['c_both', 'c_del_only', 'c_shared']);
  });

  it('getReadFilter answers the delegated context the same scope the delegated find runs under (parity, by rows)', async () => {
    const context = await rig.onBehalfOf(HUMAN);
    expect(await rig.readThroughReadFilter(PARENT, context)).toEqual(['p_both', 'p_shared']);
    expect(await rig.readThroughReadFilter(PARENT, context)).toEqual(await rig.read(PARENT, context));
  });

  it('one statement touches the parent table per delegated child find: the subquery, no pre-scan of the parent', async () => {
    const context = await rig.onBehalfOf(HUMAN);
    const statements = await rig.statementsDuring(() => rig.engine.find(CHILD, { context: { ...context } } as never));
    const touchingParent = statements.filter((sql) => sql.includes(PARENT));
    expect(touchingParent, statements.join('\n')).toHaveLength(1);
    // The one statement is the child's own select, the parent inside its subquery.
    expect(touchingParent[0]).toMatch(new RegExp(`from .${CHILD}.`, 'i'));
    expect(touchingParent[0]).toMatch(/in \(select/i);
  });
});

describe('[ADR-0139 D5.1 as amended] the closed doors stay closed on a delegated read', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  it('a delegator who does not exist: every read of the principal is refused at admission, and both halves of the parent deny', async () => {
    const context = { ...(await rig.onBehalfOf(HUMAN)), onBehalfOf: { userId: 'u_rid_del_missing', principalKind: 'human' } };
    // The chain refuses the principal before any leaf is written (the child
    // read included), `canReadObject` answers false, and `getReadFilter` is
    // the deny sentinel BY IDENTITY — the answer the engine turns into `$in: []`.
    expect(await rig.readOutcome(PARENT, context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect(await rig.readOutcome(CHILD, context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect(await rig.canReadObject(PARENT, context)).toBe(false);
    expect(await rig.readFilter(PARENT, context)).toBe(RLS_DENY_FILTER);
  });

  it('a delegator the parent object does not admit: the parent read is refused, canReadObject is false, the leaf serves nothing', async () => {
    const context = await rig.onBehalfOf(NO_PARENT_READ);
    expect(await rig.readOutcome(PARENT, context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    // The object half decides (D2 step 1): the leaf is `$in: []` before
    // `getReadFilter` is asked, which — as for a non-delegated principal —
    // answers rows, not object admission.
    expect(await rig.canReadObject(PARENT, context)).toBe(false);
    expect(await rig.read(CHILD, context)).toEqual([]);
    expect(await rig.count(CHILD, context)).toBe(0);
  });

  it('D5.2 — a leaf over a parent an object-scoped read middleware narrows is still refused, INTERNAL_ERROR / 500, under a delegated context', async () => {
    const context = await rig.onBehalfOf(HUMAN);
    const got = await outcomeOf(rig.engine.find(CHILD, {
      where: { parent: { $in: ReadableIds.of(GATED) } },
      context: { ...context },
    } as never));
    expect(got).toMatchObject({ kind: 'refused', code: 'INTERNAL_ERROR', status: 500 });
  });

  it('CONTROL — a system context reads every child, the leaf composed with no restriction', async () => {
    expect(await rig.read(CHILD, { isSystem: true })).toEqual(['c_both', 'c_caller_only', 'c_del_only', 'c_neither', 'c_shared']);
  });
});

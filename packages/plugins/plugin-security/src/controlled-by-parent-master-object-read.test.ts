// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §3 / §4] Reading a `controlled_by_parent` detail requires READ
 * access to its master, and the master's OBJECT-level read admission is part
 * of that access.
 *
 * §3: "Reading a detail requires read access to its master". §4: a member who
 * cannot read master M "can neither read nor by-id-write a detail D under M".
 *
 * The master-derived read scope (`computeControlledByParentFilter`) scopes the
 * master's ROWS under a system context. What is pinned here is that it asks the
 * master's object-level read admission first — the predicate the master's own
 * read door and `canReadObject` answer — at every door that composes it:
 *
 *  - the engine read door (`find`, `findOne`, `count`): the caller half;
 *  - the same door on an on-behalf-of read: the ADR-0090 D10 delegator half;
 *  - `getReadFilter`, the read scope a door that bypasses the engine ANDs in;
 *  - every hop of a chain, since the derivation recurses through itself;
 *  - the write doors of §4, which ask the read door's question first (a by-id
 *    write) or are scoped by it (a predicate write).
 *
 * The controls hold the change to exactly that rule. A principal who may read
 * the master object keeps its answer, whether its master rows are scoped or
 * not, and so do a system context, a super-user grant and an on-behalf-of read
 * whose delegator may read the master.
 *
 * Real stack: `ObjectQL` over better-sqlite3, the real `SecurityPlugin`, and
 * the on-behalf-of context assembled by `resolveAuthzContext` and
 * `assembleExecutionContext` with the `mcp_agent_data_read` OAuth ceiling.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { isReadableIds } from '@objectstack/spec/data';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ORG = 'org_cbp_mor';

/** The master: it governs its own rows. */
const MASTER = 'qa_cbp_mor_master';
/** A detail of the master. */
const DETAIL = 'qa_cbp_mor_detail';
/** A detail of the detail: the chain's second hop. */
const LINE = 'qa_cbp_mor_line';

const ME = 'u_cbp_mor_me';
const NOBODY = 'u_cbp_mor_nobody';
const OTHER = 'u_cbp_mor_other';
/** A delegator whose grants do not admit the master object. */
const DELEGATOR_UNADMITTED = 'u_cbp_mor_delegator_unadmitted';
/** A delegator whose grants admit it. */
const DELEGATOR_ADMITTED = 'u_cbp_mor_delegator_admitted';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } as const;

/**
 * The permission sets. Every one admits the detail objects it is used on; they
 * differ in whether the master object's read door admits the holder.
 */
const SET = {
  /** The master object's read door does not admit the holder (first set). */
  unadmittedA: 'qa_cbp_mor_unadmitted_a',
  /** The master object's read door does not admit the holder (second set). */
  unadmittedB: 'qa_cbp_mor_unadmitted_b',
  /** Admitted to the master object, with its rows scoped to the holder's own. */
  masterReadRowScoped: 'qa_cbp_mor_master_read_row_scoped',
  /** Admitted to the master object, rows unscoped. */
  masterRead: 'qa_cbp_mor_master_read',
  /** Admitted to the line and to the root master, not to the detail between them. */
  noMiddleGrant: 'qa_cbp_mor_no_middle_grant',
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

/** Release a torn-down rig's async storages (see the explain-enforce-parity suite). */
const releaseAsyncContexts = (...owners: object[]): void => {
  for (const owner of owners) {
    for (const value of Object.values(owner)) if (value instanceof AsyncLocalStorage) value.disable();
  }
};

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.cbp-master-object-read',
    name: 'A controlled_by_parent detail needs object-level read on its master',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
      {
        name: MASTER,
        label: 'Master',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner: { name: 'owner', type: 'text' },
        },
      },
      {
        name: DETAIL,
        label: 'Detail',
        sharingModel: 'controlled_by_parent',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          note: { name: 'note', type: 'text' },
          master: { name: 'master', type: 'master_detail', required: true, reference: MASTER },
        },
      },
      {
        name: LINE,
        label: 'Line',
        sharingModel: 'controlled_by_parent',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          note: { name: 'note', type: 'text' },
          detail: { name: 'detail', type: 'master_detail', required: true, reference: DETAIL },
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
    getDriver: (o: string) => { create: (o: string, row: Record<string, unknown>) => Promise<unknown> };
    logger: { warn: () => void };
  };
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: ORG }, SYS);
  for (const id of [ME, NOBODY, OTHER, DELEGATOR_UNADMITTED, DELEGATOR_ADMITTED]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
    await e.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: ORG, role: 'member' }, SYS);
  }
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({ name: SET.unadmittedA, objects: { [DETAIL]: CRUD, [LINE]: CRUD } }),
    PermissionSetSchema.parse({
      name: SET.unadmittedB,
      objects: { [MASTER]: { allowEdit: true }, [DETAIL]: CRUD, [LINE]: CRUD },
    }),
    PermissionSetSchema.parse({
      name: SET.masterReadRowScoped,
      objects: { [MASTER]: { allowRead: true, allowEdit: true }, [DETAIL]: CRUD, [LINE]: CRUD },
      rowLevelSecurity: [
        { name: 'qa_cbp_mor_master_owner', object: MASTER, operation: 'select', using: 'record.owner == current_user.id' },
      ],
    }),
    PermissionSetSchema.parse({
      name: SET.masterRead,
      objects: { [MASTER]: { allowRead: true, allowEdit: true }, [DETAIL]: CRUD, [LINE]: CRUD },
    }),
    PermissionSetSchema.parse({
      name: SET.noMiddleGrant,
      objects: { [MASTER]: { allowRead: true, allowEdit: true }, [LINE]: CRUD },
    }),
  ];
  // The delegators hold their sets through stored grants, as a user does.
  for (const name of [SET.unadmittedA, SET.masterRead]) {
    await e.getDriver('sys_permission_set').create('sys_permission_set', {
      id: `ps_${name}`, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  for (const [user, set] of [[DELEGATOR_UNADMITTED, SET.unadmittedA], [DELEGATOR_ADMITTED, SET.masterRead]] as const) {
    await e.insert('sys_user_permission_set', { id: `ups_${user}`, user_id: user, permission_set: set, organization_id: ORG }, SYS);
  }

  await e.insert(MASTER, { id: 'm_mine', name: 'mine', owner: ME }, SYS);
  await e.insert(MASTER, { id: 'm_other', name: 'other', owner: OTHER }, SYS);
  await e.insert(DETAIL, { id: 'd_mine', note: '', master: 'm_mine' }, SYS);
  await e.insert(DETAIL, { id: 'd_other', note: '', master: 'm_other' }, SYS);
  await e.insert(LINE, { id: 'l_mine', note: '', detail: 'd_mine' }, SYS);
  await e.insert(LINE, { id: 'l_other', note: '', detail: 'd_other' }, SYS);

  let security: { getReadFilter: (o: string, c: unknown) => Promise<Record<string, unknown> | undefined> } | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s: { name?: string }) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    tenancy: { posture: 'single' },
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
  // The engine's security source, as `ObjectQLPlugin.init` wires it on a kernel (ADR-0139 D2).
  wireEngineSecuritySource(engine, () => plugin);
  // The row gates log the writes they refuse.
  vi.spyOn(e.logger, 'warn').mockImplementation(() => undefined);

  /** An agent's context for `userId`, as a request assembles it: the user's session and the OAuth read ceiling. */
  const onBehalfOf = async (userId: string) => {
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
      oauth: { userId, scopes: ['data:read'], clientId: 'qa_agent_client', scopePermissions: ['mcp_agent_data_read'], delegatesActions: false },
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    } as never)!;
  };

  const ids = (rows: unknown): string[] =>
    (Array.isArray(rows) ? rows : [rows])
      .filter(Boolean)
      .map((r) => String((r as { id: unknown }).id))
      .sort();

  return {
    engine,
    onBehalfOf,
    /** The ids a context reads from `object` through the engine read door. */
    read: async (object: string, context: unknown) => ids(await engine.find(object, { context: { ...(context as object) } } as never)),
    readOne: async (object: string, id: string, context: unknown) =>
      ids(await engine.findOne(object, { where: { id }, context: { ...(context as object) } } as never)),
    count: (object: string, context: unknown) => engine.count(object, { context: { ...(context as object) } } as never),
    readMaster: (context: unknown) => outcomeOf(engine.find(MASTER, { context: { ...(context as object) } } as never)),
    /**
     * The ids `getReadFilter`'s scope admits for `context`. [ADR-0139 D6] The
     * scope carries the engine's leaf over the master, which the engine
     * composes for the context of the READ — so it is run under the caller's
     * own context, as the analytics engine-bound face runs it, never under a
     * system one (where the leaf composes as "no restriction" for the system).
     * The find is also scoped by the middleware; what this measures is that
     * the scope carries the leaf and the composed read admits what it should.
     */
    readThroughReadFilter: async (object: string, context: unknown) => {
      const scope = await security!.getReadFilter(object, { ...(context as object) });
      expect(leavesIn(scope)).toEqual([MASTER]);
      return ids(await engine.find(object, { where: scope ?? {}, context: { ...(context as object) } } as never));
    },
    stored: async (object: string, id: string) =>
      ((await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) ?? null) as Record<string, unknown> | null,
    seedDetail: (id: string) => e.insert(DETAIL, { id, note: 'seeded', master: 'm_mine' }, SYS),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;

const member = (userId: string, set: string) => ({ userId, positions: [], permissions: [set], posture: 'MEMBER' });
/** The leaves a scope carries, as the objects they name. */
function leavesIn(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const item of node) leavesIn(item, out); return out; }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$in' && isReadableIds(value)) out.push(value.object);
    else leavesIn(value, out);
  }
  return out;
}

/** Two principals the master's own read door refuses at the object gate. */
const UNADMITTED = [
  { label: 'unadmitted principal A', context: member(ME, SET.unadmittedA) },
  { label: 'unadmitted principal B', context: member(ME, SET.unadmittedB) },
] as const;

describe('a controlled_by_parent detail is not read without object-level read on its master', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  for (const { label, context } of UNADMITTED) {
    it(`${label}: the master's own read door refuses (the precondition)`, async () => {
      expect(await rig.readMaster(context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    });

    it(`${label}: find, findOne and count read no detail`, async () => {
      expect(await rig.read(DETAIL, context)).toEqual([]);
      expect(await rig.readOne(DETAIL, 'd_mine', context)).toEqual([]);
      expect(await rig.count(DETAIL, context)).toBe(0);
    });

    it(`${label}: the getReadFilter scope admits no detail`, async () => {
      expect(await rig.readThroughReadFilter(DETAIL, context)).toEqual([]);
    });

    it(`${label}: a detail two hops down is not read either`, async () => {
      expect(await rig.read(LINE, context)).toEqual([]);
    });
  }

  it('a detail whose master is itself controlled_by_parent is not read without object-level read on that master', async () => {
    // Read on the line and on the root master, nothing on the detail between them.
    const context = member(ME, SET.noMiddleGrant);
    expect(await rig.read(MASTER, context)).toEqual(['m_mine', 'm_other']);
    expect(await rig.read(LINE, context)).toEqual([]);
  });

  it("on an on-behalf-of read, the delegator's object-level read on the master is required too", async () => {
    const context = await rig.onBehalfOf(DELEGATOR_UNADMITTED);
    expect(await rig.readMaster(context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect(await rig.read(DETAIL, context)).toEqual([]);
    expect(await rig.read(LINE, context)).toEqual([]);
  });
});

describe('a principal the master object admits keeps its answer', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  it('master read, rows scoped: exactly the details under the master rows it reads', async () => {
    const context = member(ME, SET.masterReadRowScoped);
    expect(await rig.read(MASTER, context)).toEqual(['m_mine']);
    expect(await rig.read(DETAIL, context)).toEqual(['d_mine']);
    expect(await rig.read(LINE, context)).toEqual(['l_mine']);
    expect(await rig.readThroughReadFilter(DETAIL, context)).toEqual(['d_mine']);
  });

  it('master read, no master row in scope: no detail, as before', async () => {
    const context = member(NOBODY, SET.masterReadRowScoped);
    expect(await rig.read(MASTER, context)).toEqual([]);
    expect(await rig.read(DETAIL, context)).toEqual([]);
    expect(await rig.read(LINE, context)).toEqual([]);
  });

  it('master read, rows unscoped: every detail', async () => {
    const context = member(ME, SET.masterRead);
    expect(await rig.read(DETAIL, context)).toEqual(['d_mine', 'd_other']);
    expect(await rig.read(LINE, context)).toEqual(['l_mine', 'l_other']);
    expect(await rig.count(DETAIL, context)).toBe(2);
    expect(await rig.readThroughReadFilter(DETAIL, context)).toEqual(['d_mine', 'd_other']);
  });

  it('a super-user grant: every detail', async () => {
    const context = { userId: 'u_cbp_mor_admin', positions: [], permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN' };
    expect(await rig.read(DETAIL, context)).toEqual(['d_mine', 'd_other']);
    expect(await rig.read(LINE, context)).toEqual(['l_mine', 'l_other']);
  });

  it('a system context: every detail', async () => {
    expect(await rig.read(DETAIL, { isSystem: true })).toEqual(['d_mine', 'd_other']);
    expect(await rig.read(LINE, { isSystem: true })).toEqual(['l_mine', 'l_other']);
  });

  it('an on-behalf-of read whose delegator reads the master: every detail', async () => {
    const context = await rig.onBehalfOf(DELEGATOR_ADMITTED);
    expect(await rig.read(DETAIL, context)).toEqual(['d_mine', 'd_other']);
    expect(await rig.read(LINE, context)).toEqual(['l_mine', 'l_other']);
  });
});

describe('the write doors (§4): no detail is written without object-level read on its master', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  UNADMITTED.forEach(({ label, context }, i) => {
    it(`${label}: a by-id update or delete of a detail answers the read door's not-found, and writes nothing`, async () => {
      const updated = `d_update_${i}`;
      const deleted = `d_delete_${i}`;
      await rig.seedDetail(updated);
      await rig.seedDetail(deleted);

      expect(await outcomeOf(rig.engine.update(DETAIL, { note: 'written' }, { where: { id: updated }, context: { ...context } } as never)))
        .toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
      expect(await outcomeOf(rig.engine.delete(DETAIL, { where: { id: deleted }, context: { ...context } } as never)))
        .toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });

      expect((await rig.stored(DETAIL, updated))?.note).toBe('seeded');
      expect(await rig.stored(DETAIL, deleted)).toBeTruthy();
    });

    it(`${label}: an insert of a detail under the master is refused`, async () => {
      // §4's third write. Refused by gates ahead of the read scope (the master
      // gate, the reference check), so it stands with or without it; pinned so
      // the suite covers every by-id write §4 names.
      const got = await outcomeOf(rig.engine.insert(DETAIL, { id: `d_insert_${i}`, note: '', master: 'm_mine' }, { context: { ...context } } as never));
      expect(got.kind).toBe('refused');
      expect(await rig.stored(DETAIL, `d_insert_${i}`)).toBeNull();
    });

    it(`${label}: a predicate update matches no detail`, async () => {
      const mark = `bulk_${i}`;
      expect(await outcomeOf(rig.engine.update(DETAIL, { note: mark }, { where: { note: { $ne: mark } }, multi: true, context: { ...context } } as never)))
        .toEqual({ kind: 'landed' });
      expect(await rig.engine.count(DETAIL, { where: { note: mark }, context: { isSystem: true } } as never)).toBe(0);
    });
  });

  it('the control: a principal that reads the master object writes a detail by id, inserts one and updates by predicate', async () => {
    const context = member(ME, SET.masterRead);
    await rig.seedDetail('d_update_control');
    expect(await outcomeOf(rig.engine.update(DETAIL, { note: 'written' }, { where: { id: 'd_update_control' }, context: { ...context } } as never)))
      .toEqual({ kind: 'landed' });
    expect((await rig.stored(DETAIL, 'd_update_control'))?.note).toBe('written');
    expect(await outcomeOf(rig.engine.insert(DETAIL, { id: 'd_insert_control', note: '', master: 'm_mine' }, { context: { ...context } } as never)))
      .toEqual({ kind: 'landed' });
    expect(await outcomeOf(rig.engine.update(DETAIL, { note: 'bulk_control' }, { where: { note: { $ne: 'bulk_control' } }, multi: true, context: { ...context } } as never)))
      .toEqual({ kind: 'landed' });
    expect(await rig.engine.count(DETAIL, { where: { note: 'bulk_control' }, context: { isSystem: true } } as never))
      .toBe(await rig.engine.count(DETAIL, { context: { isSystem: true } } as never));
  });
});

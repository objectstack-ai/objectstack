// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §3] Editing, deleting or creating a `controlled_by_parent` detail
 * requires edit access to its master — to EVERY master the write involves, not
 * to one of them. §3 reads a create's master from the master id in the
 * incoming body; on every other write shape the body can carry that id too,
 * and the master it names is involved beside the master the detail's rows are
 * stored under.
 *
 * Pinned here, for every write shape the engine routes (a write naming its row
 * by `where`, one naming it in its body, and one selecting its rows):
 *
 *  - a master the caller may not edit, among those the write involves, refuses
 *    the write with the very refusal a write under that master gets, and
 *    nothing is written: for the row-level leg, the record-sharing leg and a
 *    master's own master, for a member and an org admin, and on the row-level
 *    leg for an agent acting for a member;
 *  - the master the rows are stored under is still asked, whichever other
 *    master the write involves;
 *  - a write whose masters the caller may all edit lands as it did;
 *  - a write that selects no row involves no master and writes nothing;
 *  - no master is asked twice, and an insert's master is asked once.
 *
 * Real stack: `ObjectQL` over better-sqlite3, the real `SecurityPlugin`, the
 * real sharing service and middleware, and contexts assembled by
 * `resolveAuthzContext` and `assembleExecutionContext` — the agent's with the
 * `mcp_agent_data_write` OAuth ceiling. `@objectstack/core` and
 * `@objectstack/plugin-sharing` resolve through their built `dist/`, as this
 * package's other suites read them.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ORG = 'org_cbp_eme';
const POSTURE = 'isolated' as const;

/** Holds the org's `member` role, so the platform ownership floor binds it. */
const MEMBER = 'u_cbp_eme_member';
/** Holds the org's `admin` role, outside the floor's domain. */
const ADMIN = 'u_cbp_eme_admin';
/** Owns the masters and creates the rows nobody else here does. */
const OTHER = 'u_cbp_eme_other';

/** One master object per refusal leg (`chain` is a master whose own master decides). */
const M = {
  rls: 'qa_cbp_eme_master_rls',
  sharing: 'qa_cbp_eme_master_sharing',
  chain: 'qa_cbp_eme_master_chain',
} as const;
/** The master of `M.chain`. */
const TOP = 'qa_cbp_eme_top';
const D = {
  rls: 'qa_cbp_eme_detail_rls',
  sharing: 'qa_cbp_eme_detail_sharing',
  chain: 'qa_cbp_eme_detail_chain',
} as const;
type Leg = 'rls' | 'sharing' | 'chain';

/** On every leg: the master row the caller may not edit. */
const held = (leg: Leg) => `${M[leg]}_held`;
/** On every leg: a master row the caller may edit, and a second one. */
const editable = (leg: Leg, user: string, n: 1 | 2 = 1) =>
  leg === 'sharing' ? `${M.sharing}_mine${n}_${user}` : `${M[leg]}_free${n}`;

type Outcome =
  | { kind: 'landed'; value: unknown }
  | { kind: 'refused'; code?: string; status?: number; message: string };

const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    (value) => ({ kind: 'landed' as const, value }),
    (e: unknown) => {
      const x = e as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown } | null;
      const status = x?.statusCode ?? x?.status;
      return {
        kind: 'refused' as const,
        code: x?.code == null ? undefined : String(x.code),
        status: status == null ? undefined : Number(status),
        message: String(x?.message),
      };
    },
  );

/** The refusal as the envelope it is: code, status and the refusal itself. */
const envelope = (o: Outcome) => (o.kind === 'refused' ? { code: o.code, status: o.status, message: o.message } : o);

/** See the explain-enforce-parity suite: a torn-down rig's async storages are released once its last row is judged. */
const releaseAsyncContexts = (...owners: object[]): void => {
  for (const owner of owners) {
    for (const value of Object.values(owner)) if (value instanceof AsyncLocalStorage) value.disable();
  }
};

const masterFields = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
  owner_id: { name: 'owner_id', type: 'text' },
  created_by: { name: 'created_by', type: 'text' },
};
const detailOf = (name: string, master: string, fk = 'master') => ({
  name,
  label: name,
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    note: { name: 'note', type: 'text' },
    name: { name: 'name', type: 'text' },
    owner_id: { name: 'owner_id', type: 'text' },
    created_by: { name: 'created_by', type: 'text' },
    [fk]: { name: fk, type: 'master_detail', required: true, reference: master },
  },
});

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.cbp-every-master-edit',
    name: 'A controlled_by_parent detail is written only when the caller may edit every master the write involves',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      { name: M.rls, label: 'Master', sharingModel: 'public_read_write', fields: masterFields },
      { name: M.sharing, label: 'Master', sharingModel: 'private', fields: masterFields },
      { name: TOP, label: 'Top', sharingModel: 'public_read_write', fields: masterFields },
      { ...detailOf(M.chain, TOP, 'top'), label: 'Master' },
      detailOf(D.rls, M.rls),
      detailOf(D.sharing, M.sharing),
      detailOf(D.chain, M.chain),
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
  for (const [id, role] of [[MEMBER, 'member'], [ADMIN, 'admin'], [OTHER, 'member']] as const) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
    await e.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: ORG, role }, SYS);
  }
  const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } as const;
  const WRITER = 'qa_cbp_eme_writer';
  const heldByName = (name: string, object: string) =>
    ({ name, object, operation: 'update', using: "name != 'held'" }) as const;
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({
      name: WRITER,
      objects: {
        [M.rls]: { allowRead: true, allowEdit: true },
        [M.sharing]: { allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'own' },
        [TOP]: { allowRead: true, allowEdit: true },
        [M.chain]: CRUD,
        [D.rls]: CRUD,
        [D.sharing]: CRUD,
        [D.chain]: CRUD,
      },
      rowLevelSecurity: [heldByName('qa_cbp_eme_master_updates', M.rls), heldByName('qa_cbp_eme_top_updates', TOP)],
    }),
  ];
  await e.getDriver('sys_permission_set').create('sys_permission_set', {
    id: `ps_${WRITER}`, name: WRITER, label: WRITER, organization_id: null, managed_by: 'admin', active: true,
    object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  for (const user of [MEMBER, ADMIN]) {
    await e.insert('sys_user_permission_set', { id: `ups_${user}`, user_id: user, permission_set: WRITER, organization_id: ORG }, SYS);
  }
  const master = (object: string, id: string, name: string, owner = OTHER, extra: Record<string, unknown> = {}) =>
    e.insert(object, { id, name, owner_id: owner, created_by: owner, organization_id: ORG, ...extra }, SYS);
  await master(M.rls, held('rls'), 'held');
  await master(M.rls, editable('rls', '', 1), 'free');
  await master(M.rls, editable('rls', '', 2), 'free');
  await master(M.sharing, held('sharing'), 'held');
  for (const user of [MEMBER, ADMIN]) {
    await master(M.sharing, editable('sharing', user, 1), 'mine', user);
    await master(M.sharing, editable('sharing', user, 2), 'mine', user);
  }
  await master(TOP, `${TOP}_held`, 'held');
  await master(TOP, `${TOP}_free`, 'free');
  // The middle masters carry no rule of their own: the top each sits under decides.
  await master(M.chain, held('chain'), 'held', OTHER, { top: `${TOP}_held` });
  await master(M.chain, editable('chain', '', 1), 'free', OTHER, { top: `${TOP}_free` });
  await master(M.chain, editable('chain', '', 2), 'free', OTHER, { top: `${TOP}_free` });

  let security: unknown;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s: { name?: string }) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    tenancy: { posture: POSTURE },
    get sharing() { return sharing; },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => {
      if (name === 'security') security = svc;
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
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  // The row gates log the writes they refuse.
  vi.spyOn(e.logger, 'warn').mockImplementation(() => undefined);

  /** The caller's context as a request assembles it: the user's session, and for an agent its OAuth ceiling. */
  const contextOf = async (userId: string, onBehalf: boolean): Promise<Record<string, unknown>> => {
    const authz = await resolveAuthzContext({
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      ql: engine,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `sess_${userId}`, userId, activeOrganizationId: ORG },
      }),
      tenancyPosture: POSTURE,
    } as never);
    return {
      ...(assembleExecutionContext({
        authz,
        oauth: onBehalf
          ? { userId, scopes: ['data:write'], clientId: 'qa_agent_client', scopePermissions: ['mcp_agent_data_write'], delegatesActions: false }
          : undefined,
        localization: undefined,
        requestLocale: undefined,
        accessToken: undefined,
      } as never) as Record<string, unknown>),
    };
  };

  const write = (detail: string, data: Record<string, unknown>, options: Record<string, unknown>, context: Record<string, unknown>) =>
    outcomeOf(engine.update(detail, data, { ...options, context: { ...context } } as never));

  let n = 0;
  return {
    /** The master-edit walk the gate runs once per master it asks about, for counting. */
    walk: () =>
      vi.spyOn(plugin as unknown as { assertControlledByParentChainEditable: () => Promise<void> }, 'assertControlledByParentChainEditable'),
    contextOf,
    /** Two rows the caller created under `under` and one somebody else did, written as SYSTEM; all carry one tag. */
    seed: async (detail: string, under: string, creator: string, tag = `t${++n}`) => {
      const rows = { own: [`${tag}_own_1`, `${tag}_own_2`], others: [`${tag}_others_1`] };
      for (const [id, by] of [[rows.own[0], creator], [rows.own[1], creator], [rows.others[0], OTHER]] as const) {
        await e.getDriver(detail).create(detail, { id, note: tag, created_by: by, master: under, organization_id: ORG });
      }
      return { tag, ...rows, all: [...rows.own, ...rows.others] };
    },
    /** Each row as stored — its master and its note — or `null` once it is gone. */
    stored: async (detail: string, ids: readonly string[]) => {
      const out: Record<string, { master: unknown; note: unknown } | null> = {};
      for (const id of ids) {
        const row = (await engine.findOne(detail, { where: { id }, context: { isSystem: true } } as never)) as
          | Record<string, unknown>
          | null;
        out[id] = row ? { master: row.master, note: row.note } : null;
      }
      return out;
    },
    /** A note-only update of one row, addressed by `where` — the write under the row's own master. */
    noteUpdate: (detail: string, id: string, context: Record<string, unknown>) =>
      write(detail, { note: 'written' }, { where: { id } }, context),
    /** The three write shapes, each writing `data` to the rows `rows` names. */
    shapes: {
      'addressed by where': (detail: string, rows: { own: string[]; tag: string }, data: Record<string, unknown>, context: Record<string, unknown>) =>
        write(detail, data, { where: { id: rows.own[0] } }, context),
      'addressed in its body': (detail: string, rows: { own: string[]; tag: string }, data: Record<string, unknown>, context: Record<string, unknown>) =>
        write(detail, { id: rows.own[0], ...data }, {}, context),
      selecting: (detail: string, rows: { own: string[]; tag: string }, data: Record<string, unknown>, context: Record<string, unknown>) =>
        write(detail, data, { where: { note: rows.tag }, multi: true }, context),
    },
    insert: (detail: string, row: Record<string, unknown>, context: Record<string, unknown>) =>
      outcomeOf(engine.insert(detail, row, { context: { ...context } } as never)),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;
type ShapeName = keyof Rig['shapes'];
const SHAPES: readonly ShapeName[] = ['addressed by where', 'addressed in its body', 'selecting'];

const CALLERS = {
  'a member': { user: MEMBER, onBehalf: false },
  'an org admin': { user: ADMIN, onBehalf: false },
  'an agent acting for a member': { user: MEMBER, onBehalf: true },
} as const;
type Caller = keyof typeof CALLERS;

const LEGS: ReadonlyArray<{ leg: Leg; name: string; callers: readonly Caller[] }> = [
  { leg: 'rls', name: "the master's own row-level policy", callers: ['a member', 'an org admin', 'an agent acting for a member'] },
  { leg: 'sharing', name: 'the record-level leg of a private master', callers: ['a member', 'an org admin'] },
  { leg: 'chain', name: "the master's own master", callers: ['a member', 'an org admin'] },
];

/** The rows a write reaches: a selecting write by a floor-bound caller reaches only the rows it created. */
const reached = (caller: Caller, shape: ShapeName, rows: { own: string[]; all: string[] }) =>
  shape !== 'selecting' ? [rows.own[0]] : caller === 'an org admin' ? rows.all : rows.own;

describe('ADR-0055 §3 — a write to a controlled_by_parent detail asks for edit access on every master it involves', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  describe('a master the caller may not edit, among those the write involves, refuses it as a write under that master is refused', () => {
    for (const { leg, name, callers } of LEGS) {
      for (const caller of callers) {
        it(`${name}, ${caller}: on every write shape, with that refusal, and nothing is written`, async () => {
          const { user, onBehalf } = CALLERS[caller];
          const context = await rig.contextOf(user, onBehalf);
          const under = await rig.seed(D[leg], held(leg), user);
          // The precondition: a write under that master is refused on the master-edit question.
          const refusal = await rig.noteUpdate(D[leg], under.own[0], context);
          expect(refusal).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });

          for (const shape of SHAPES) {
            const rows = await rig.seed(D[leg], editable(leg, user), user);
            const outcome = await rig.shapes[shape](D[leg], rows, { master: held(leg) }, context);
            expect({ shape, outcome: envelope(outcome) }).toEqual({ shape, outcome: envelope(refusal) });
            const after = await rig.stored(D[leg], rows.all);
            for (const id of rows.all) expect({ id, row: after[id] }).toEqual({ id, row: { master: editable(leg, user), note: rows.tag } });
          }
        });
      }
    }
  });

  it('the master the rows are stored under is still asked, whichever other master the write involves', async () => {
    for (const caller of Object.keys(CALLERS) as Caller[]) {
      const { user, onBehalf } = CALLERS[caller];
      const context = await rig.contextOf(user, onBehalf);
      const under = await rig.seed(D.rls, held('rls'), user);
      const refusal = await rig.noteUpdate(D.rls, under.own[0], context);
      expect(refusal).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      for (const shape of SHAPES) {
        const rows = await rig.seed(D.rls, held('rls'), user);
        const outcome = await rig.shapes[shape](D.rls, rows, { master: editable('rls', user) }, context);
        expect({ caller, shape, outcome: envelope(outcome) }).toEqual({ caller, shape, outcome: envelope(refusal) });
        const after = await rig.stored(D.rls, rows.all);
        for (const id of rows.all) expect({ id, row: after[id] }).toEqual({ id, row: { master: held('rls'), note: rows.tag } });
      }
    }
  });

  describe('a write whose masters the caller may all edit lands as it did', () => {
    for (const { leg, name, callers } of LEGS) {
      for (const caller of callers) {
        it(`${name}, ${caller}: on every write shape, writing the rows it reaches`, async () => {
          const { user, onBehalf } = CALLERS[caller];
          const context = await rig.contextOf(user, onBehalf);
          for (const shape of SHAPES) {
            // Under another master the caller may edit, and under the one the rows already sit under.
            for (const target of [editable(leg, user, 2), editable(leg, user, 1)]) {
              const rows = await rig.seed(D[leg], editable(leg, user, 1), user);
              const outcome = await rig.shapes[shape](D[leg], rows, { master: target, note: 'written' }, context);
              const hit = reached(caller, shape, rows);
              expect({ shape, target, landed: outcome.kind }).toEqual({ shape, target, landed: 'landed' });
              if (shape === 'selecting') expect(outcome).toEqual({ kind: 'landed', value: hit.length });
              const after = await rig.stored(D[leg], rows.all);
              for (const id of rows.all) {
                expect({ shape, id, row: after[id] }).toEqual({
                  shape,
                  id,
                  row: hit.includes(id) ? { master: target, note: 'written' } : { master: editable(leg, user, 1), note: rows.tag },
                });
              }
            }
          }
        });
      }
    }
  });

  it('a write that selects no row involves no master, and writes nothing', async () => {
    for (const caller of Object.keys(CALLERS) as Caller[]) {
      const { user, onBehalf } = CALLERS[caller];
      const context = await rig.contextOf(user, onBehalf);
      const bystanders = await rig.seed(D.rls, editable('rls', user), user);
      const outcome = await rig.shapes.selecting(D.rls, { own: [], tag: `${bystanders.tag}_none` }, { master: held('rls') }, context);
      expect({ caller, outcome }).toEqual({ caller, outcome: { kind: 'landed', value: 0 } });
      const after = await rig.stored(D.rls, bystanders.all);
      for (const id of bystanders.all) expect(after[id]).toEqual({ master: editable('rls', user), note: bystanders.tag });
    }
  });

  it("no master is asked twice, and an insert's master is asked once", async () => {
    const context = await rig.contextOf(ADMIN, false);
    const walk = rig.walk();
    try {
      const count = async (p: Promise<Outcome>) => {
        walk.mockClear();
        const outcome = await p;
        return { landed: outcome.kind, asked: walk.mock.calls.map((c) => (c as unknown[])[3]) };
      };
      const free1 = editable('rls', ADMIN, 1);
      const free2 = editable('rls', ADMIN, 2);
      // An insert is asked of the master its body names, once — and is refused under one the caller may not edit.
      expect(await count(rig.insert(D.rls, { id: 'eme_insert_1', note: 'x', master: free1 }, context))).toEqual({ landed: 'landed', asked: [free1] });
      expect(await count(rig.insert(D.rls, { id: 'eme_insert_2', note: 'x', master: held('rls') }, context))).toEqual({ landed: 'refused', asked: [held('rls')] });
      for (const shape of SHAPES) {
        const same = await rig.seed(D.rls, free1, ADMIN);
        expect({ shape, ...(await count(rig.shapes[shape](D.rls, same, { master: free1, note: 'written' }, context))) }).toEqual({ shape, landed: 'landed', asked: [free1] });
        const other = await rig.seed(D.rls, free1, ADMIN);
        expect({ shape, ...(await count(rig.shapes[shape](D.rls, other, { master: free2 }, context))) }).toEqual({ shape, landed: 'landed', asked: [free1, free2] });
      }
    } finally {
      walk.mockRestore();
    }
  });
});

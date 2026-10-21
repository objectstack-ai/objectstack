// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §3] Editing or deleting a `controlled_by_parent` detail requires
 * edit access to its master, and the rule names no write shape as exempt.
 *
 * The master-edit gate answers every write the engine routes: one that names
 * its target row, and one that names none and selects its rows instead. For
 * the second, the gate judges the masters of the detail rows the caller's own
 * selection reaches and the caller can read, one chain walk per master, and
 * pinned here is what that judgement answers:
 *
 *  - a master the caller may not edit refuses the whole write, with the very
 *    refusal the by-id door gives the same caller for the same master, and
 *    nothing is written: for each refusal leg, for a member, an org admin and
 *    an agent acting for a member, for an update and a delete;
 *  - one such master among editable ones refuses the whole write too;
 *  - a write whose rows all sit under masters the caller may edit lands as it
 *    did, and writes exactly the rows it wrote — the platform ownership floor
 *    still binds a member;
 *  - a row the caller cannot read is not judged and is not written;
 *  - a caller whose read of the detail is refused is refused the write with
 *    that read's own refusal, and nothing is written.
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
const ORG = 'org_cbp_wsme';
const POSTURE = 'isolated' as const;

/** Holds the org's `member` role, so the platform ownership floor binds it. */
const MEMBER = 'u_cbp_wsme_member';
/** Holds the org's `admin` role, outside the floor's domain. */
const ADMIN = 'u_cbp_wsme_admin';
/** Holds a grant on the detail that withholds its read. */
const UNREAD = 'u_cbp_wsme_unread';
/** Owns the masters and creates the rows nobody else here does. */
const OTHER = 'u_cbp_wsme_other';

/** One master per refusal leg, one the caller may edit, and one the caller cannot read. */
const M = {
  object: 'qa_cbp_wsme_master_object',
  sharing: 'qa_cbp_wsme_master_sharing',
  rls: 'qa_cbp_wsme_master_rls',
  hidden: 'qa_cbp_wsme_master_hidden',
} as const;
const D = {
  object: 'qa_cbp_wsme_detail_object',
  sharing: 'qa_cbp_wsme_detail_sharing',
  rls: 'qa_cbp_wsme_detail_rls',
  hidden: 'qa_cbp_wsme_detail_hidden',
} as const;
type Shape = keyof typeof M;

/** The master row the caller may not edit, and (on the rls shape) the one it may. */
const refusingMaster = (shape: Shape) => `${M[shape]}_held`;
const EDITABLE_MASTER = `${M.rls}_free`;

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
const detailOf = (name: string, master: string) => ({
  name,
  label: name,
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    note: { name: 'note', type: 'text' },
    created_by: { name: 'created_by', type: 'text' },
    master: { name: 'master', type: 'master_detail', required: true, reference: master },
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
    id: 'com.objectstack.qa.cbp-write-shape-master-edit',
    name: 'A controlled_by_parent detail is written only under masters the caller may edit, on every write shape',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      { name: M.object, label: 'Master', sharingModel: 'public_read_write', fields: masterFields },
      { name: M.sharing, label: 'Master', sharingModel: 'private', fields: masterFields },
      { name: M.rls, label: 'Master', sharingModel: 'public_read_write', fields: masterFields },
      { name: M.hidden, label: 'Master', sharingModel: 'public_read_write', fields: masterFields },
      detailOf(D.object, M.object),
      detailOf(D.sharing, M.sharing),
      detailOf(D.rls, M.rls),
      detailOf(D.hidden, M.hidden),
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
  for (const [id, role] of [[MEMBER, 'member'], [ADMIN, 'admin'], [UNREAD, 'admin'], [OTHER, 'member']] as const) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
    await e.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: ORG, role }, SYS);
  }
  const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } as const;
  const WRITER = 'qa_cbp_wsme_writer';
  const UNREAD_WRITER = 'qa_cbp_wsme_unread_writer';
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({
      name: WRITER,
      objects: {
        [M.object]: { allowRead: true },
        [M.sharing]: { allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'own' },
        [M.rls]: { allowRead: true, allowEdit: true },
        [D.object]: CRUD,
        [D.sharing]: CRUD,
        [D.rls]: CRUD,
        [D.hidden]: CRUD,
      },
      rowLevelSecurity: [{ name: 'qa_cbp_wsme_master_updates', object: M.rls, operation: 'update', using: "name != 'held'" }],
    }),
    PermissionSetSchema.parse({
      name: UNREAD_WRITER,
      objects: { [M.rls]: { allowRead: true, allowEdit: true }, [D.rls]: { allowEdit: true, allowDelete: true } },
    }),
  ];
  for (const name of [WRITER, UNREAD_WRITER]) {
    await e.getDriver('sys_permission_set').create('sys_permission_set', {
      id: `ps_${name}`, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  for (const [user, set] of [[MEMBER, WRITER], [ADMIN, WRITER], [UNREAD, UNREAD_WRITER]] as const) {
    await e.insert('sys_user_permission_set', { id: `ups_${user}`, user_id: user, permission_set: set, organization_id: ORG }, SYS);
  }
  for (const master of Object.values(M)) {
    await e.insert(master, { id: `${master}_held`, name: 'held', owner_id: OTHER, created_by: OTHER, organization_id: ORG }, SYS);
  }
  await e.insert(M.rls, { id: EDITABLE_MASTER, name: 'free', owner_id: OTHER, created_by: OTHER, organization_id: ORG }, SYS);

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

  let n = 0;
  return {
    contextOf,
    /** Two rows the caller created under `master` and one somebody else did, written as SYSTEM; all carry one tag. */
    seed: async (detail: string, master: string, creator: string, tag = `t${++n}`) => {
      const rows = { own: [`${tag}_own_1`, `${tag}_own_2`], others: [`${tag}_others_1`] };
      for (const [id, by] of [[rows.own[0], creator], [rows.own[1], creator], [rows.others[0], OTHER]] as const) {
        await e.getDriver(detail).create(detail, { id, note: tag, created_by: by, master, organization_id: ORG });
      }
      return { tag, ...rows, all: [...rows.own, ...rows.others] };
    },
    /** Each row's stored `note`, or `null` once it is gone. */
    notes: async (detail: string, ids: readonly string[]) => {
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        const row = (await engine.findOne(detail, { where: { id }, context: { isSystem: true } } as never)) as
          | Record<string, unknown>
          | null;
        out[id] = row ? row.note : null;
      }
      return out;
    },
    byIdUpdate: (detail: string, id: string, context: Record<string, unknown>) =>
      outcomeOf(engine.update(detail, { note: 'written' }, { where: { id }, context: { ...context } } as never)),
    byIdDelete: (detail: string, id: string, context: Record<string, unknown>) =>
      outcomeOf(engine.delete(detail, { where: { id }, context: { ...context } } as never)),
    selectUpdate: (detail: string, where: Record<string, unknown>, context: Record<string, unknown>) =>
      outcomeOf(engine.update(detail, { note: 'written' }, { where, multi: true, context: { ...context } } as never)),
    selectDelete: (detail: string, where: Record<string, unknown>, context: Record<string, unknown>) =>
      outcomeOf(engine.delete(detail, { where, multi: true, context: { ...context } } as never)),
    read: (detail: string, where: Record<string, unknown>, context: Record<string, unknown>) =>
      outcomeOf(engine.find(detail, { where, context: { ...context } } as never)),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;

const CALLERS = {
  'a member': { user: MEMBER, onBehalf: false },
  'an org admin': { user: ADMIN, onBehalf: false },
  'an agent acting for a member': { user: MEMBER, onBehalf: true },
} as const;
type Caller = keyof typeof CALLERS;

/** The by-id refusal, as the envelope it is: code, status and the refusal itself. */
const envelope = (o: Outcome) => (o.kind === 'refused' ? { code: o.code, status: o.status, message: o.message } : o);

const LEGS: ReadonlyArray<{ leg: string; shape: Shape; callers: readonly Caller[] }> = [
  { leg: 'the object-permission leg', shape: 'object', callers: ['a member', 'an org admin', 'an agent acting for a member'] },
  { leg: 'the record-level leg of a private master', shape: 'sharing', callers: ['a member', 'an org admin'] },
  { leg: "the master's own row-level policy", shape: 'rls', callers: ['a member', 'an org admin', 'an agent acting for a member'] },
];

describe("ADR-0055 §3 — a controlled_by_parent detail is written only under masters the caller may edit, on every write shape", () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  describe("a master the caller may not edit refuses the write, with the by-id door's own refusal", () => {
    for (const { leg, shape, callers } of LEGS) {
      for (const caller of callers) {
        it(`${leg}, ${caller}: the update and the delete are refused as the by-id door refuses them, and nothing is written`, async () => {
          const { user, onBehalf } = CALLERS[caller];
          const context = await rig.contextOf(user, onBehalf);
          const byId = await rig.seed(D[shape], refusingMaster(shape), user);
          const byIdUpdate = await rig.byIdUpdate(D[shape], byId.own[0], context);
          const byIdDelete = await rig.byIdDelete(D[shape], byId.own[1], context);
          // The precondition: the by-id door refuses this caller on the master-edit question.
          expect(byIdUpdate).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
          expect(byIdDelete).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });

          const updated = await rig.seed(D[shape], refusingMaster(shape), user);
          const update = await rig.selectUpdate(D[shape], { note: updated.tag }, context);
          const deleted = await rig.seed(D[shape], refusingMaster(shape), user);
          const del = await rig.selectDelete(D[shape], { note: deleted.tag }, context);

          expect(envelope(update)).toEqual(envelope(byIdUpdate));
          expect(envelope(del)).toEqual(envelope(byIdDelete));
          expect(Object.values(await rig.notes(D[shape], updated.all))).toEqual([updated.tag, updated.tag, updated.tag]);
          expect(Object.values(await rig.notes(D[shape], deleted.all))).toEqual([deleted.tag, deleted.tag, deleted.tag]);
        });
      }
    }

    it('whatever the selection names — the master reference, another field, or a list of ids — the answer is the same refusal', async () => {
      const context = await rig.contextOf(MEMBER, false);
      const byId = await rig.seed(D.rls, refusingMaster('rls'), MEMBER);
      const byIdUpdate = await rig.byIdUpdate(D.rls, byId.own[0], context);
      const byIdDelete = await rig.byIdDelete(D.rls, byId.own[1], context);
      expect(byIdUpdate).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      const selections: ReadonlyArray<(rows: { tag: string; all: string[] }) => Record<string, unknown>> = [
        () => ({ master: refusingMaster('rls') }),
        (rows) => ({ note: rows.tag }),
        (rows) => ({ id: { $in: rows.all } }),
      ];
      for (const where of selections) {
        const updated = await rig.seed(D.rls, refusingMaster('rls'), MEMBER);
        expect(envelope(await rig.selectUpdate(D.rls, where(updated), context))).toEqual(envelope(byIdUpdate));
        const deleted = await rig.seed(D.rls, refusingMaster('rls'), MEMBER);
        expect(envelope(await rig.selectDelete(D.rls, where(deleted), context))).toEqual(envelope(byIdDelete));
        expect(Object.values(await rig.notes(D.rls, [...updated.all, ...deleted.all])).every((v) => v !== null && v !== 'written')).toBe(true);
      }
    });

    it('one such master among masters the caller may edit refuses the whole write, and nothing is written under either', async () => {
      const context = await rig.contextOf(ADMIN, false);
      const tag = 'mixed';
      const editable = await rig.seed(D.rls, EDITABLE_MASTER, ADMIN, `${tag}_a`);
      const refusing = await rig.seed(D.rls, refusingMaster('rls'), ADMIN, `${tag}_b`);
      const ids = [...editable.all, ...refusing.all];
      const byIdUpdate = await rig.byIdUpdate(D.rls, refusing.own[0], context);
      expect(byIdUpdate).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });

      expect(envelope(await rig.selectUpdate(D.rls, { id: { $in: ids } }, context))).toEqual(envelope(byIdUpdate));
      const before = await rig.notes(D.rls, ids);
      expect(Object.values(before).includes('written')).toBe(false);
      const del = await rig.selectDelete(D.rls, { id: { $in: ids } }, context);
      expect(del).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      expect(Object.values(await rig.notes(D.rls, ids)).includes(null)).toBe(false);
    });
  });

  describe('a write whose rows all sit under masters the caller may edit lands as it did', () => {
    const WRITES: Record<Caller, 'own' | 'all'> = {
      // The platform ownership floor binds a member, on its own write and an agent's alike.
      'a member': 'own',
      'an agent acting for a member': 'own',
      'an org admin': 'all',
    };
    for (const caller of Object.keys(CALLERS) as Caller[]) {
      it(`${caller}: the update and the delete land, and write ${WRITES[caller] === 'own' ? 'only the rows it created' : 'every row'}`, async () => {
        const { user, onBehalf } = CALLERS[caller];
        const context = await rig.contextOf(user, onBehalf);
        const updated = await rig.seed(D.rls, EDITABLE_MASTER, user);
        const update = await rig.selectUpdate(D.rls, { note: updated.tag }, context);
        const deleted = await rig.seed(D.rls, EDITABLE_MASTER, user);
        const del = await rig.selectDelete(D.rls, { note: deleted.tag }, context);
        const reached = (rows: { own: string[]; all: string[] }) => (WRITES[caller] === 'own' ? rows.own : rows.all);

        expect(update).toEqual({ kind: 'landed', value: reached(updated).length });
        expect(del).toEqual({ kind: 'landed', value: reached(deleted).length });
        const updatedNotes = await rig.notes(D.rls, updated.all);
        const deletedNotes = await rig.notes(D.rls, deleted.all);
        for (const id of updated.all) expect(updatedNotes[id]).toBe(reached(updated).includes(id) ? 'written' : updated.tag);
        for (const id of deleted.all) expect(deletedNotes[id]).toBe(reached(deleted).includes(id) ? null : deleted.tag);
      });
    }
  });

  it('a row the caller cannot read is not judged and is not written', async () => {
    const context = await rig.contextOf(ADMIN, false);
    const rows = await rig.seed(D.hidden, refusingMaster('hidden'), ADMIN);
    // The precondition: the caller's read door does not return these rows.
    expect(await rig.read(D.hidden, { note: rows.tag }, context)).toEqual({ kind: 'landed', value: [] });
    expect(await rig.selectUpdate(D.hidden, { note: rows.tag }, context)).toEqual({ kind: 'landed', value: 0 });
    expect(await rig.selectDelete(D.hidden, { note: rows.tag }, context)).toEqual({ kind: 'landed', value: 0 });
    expect(Object.values(await rig.notes(D.hidden, rows.all))).toEqual([rows.tag, rows.tag, rows.tag]);
  });

  it("a caller whose read of the detail is refused is refused the write with that read's own refusal, and nothing is written", async () => {
    const context = await rig.contextOf(UNREAD, false);
    const rows = await rig.seed(D.rls, EDITABLE_MASTER, UNREAD);
    const read = await rig.read(D.rls, { note: rows.tag }, context);
    expect(read).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect(envelope(await rig.selectUpdate(D.rls, { note: rows.tag }, context))).toEqual(envelope(read));
    expect(envelope(await rig.selectDelete(D.rls, { note: rows.tag }, context))).toEqual(envelope(read));
    expect(Object.values(await rig.notes(D.rls, rows.all))).toEqual([rows.tag, rows.tag, rows.tag]);
  });
});

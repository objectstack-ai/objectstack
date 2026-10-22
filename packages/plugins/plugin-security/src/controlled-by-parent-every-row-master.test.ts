// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §1 · §3] Every row a write stores in a `controlled_by_parent`
 * detail is held to its master: the caller must be able to edit the master of
 * EACH row a create names, and a write never empties the master reference the
 * detail's access derives from.
 *
 * §3 reads a create's master from "the master id in the incoming body". A
 * batch create carries one body per row, so it involves the master each of its
 * rows names. §1 derives a detail's access from exactly one required master, so
 * a row whose master reference a write empties has no master to derive its
 * access from — no principal's read can match it.
 *
 * Pinned here:
 *
 *  - a batch create, through every door that hands the engine an array of
 *    rows (its array insert and partial-success `insertMany`, and the
 *    protocol's `createManyData` and `insertManyData` that the bulk-create and
 *    import doors call), is refused when ONE row names a master the caller may
 *    not edit, with the refusal a single create of that row gets, and nothing
 *    is written: on the row-level leg for a member, an org admin and an agent
 *    acting for a member, and on a master's own master for a member and an org
 *    admin;
 *  - a batch create whose rows' masters the caller may all edit lands as it
 *    did, each row under the master it names;
 *  - each master a batch names is asked once, in row order;
 *  - a row naming no master, under a reference required-field validation
 *    judges, is answered by validation as before;
 *  - under a reference required-field validation does not judge, a batch
 *    create naming a master the caller may not edit is refused on that master
 *    (for an agent, whose own pass runs first, on the empty-master answer),
 *    and every other batch create is still refused whole, as before;
 *  - an update that empties the master reference, under a reference
 *    required-field validation does not judge, is refused — addressed by
 *    `where`, in its body and by predicate — with the empty-master refusal, and
 *    nothing is written; under a reference validation judges, validation's
 *    answer is unchanged; and an update that leaves the reference out lands as
 *    it did.
 *
 * Real stack: `ObjectQL` over better-sqlite3, the real `SecurityPlugin`, the
 * real sharing service and middleware, the real protocol, and contexts
 * assembled by `resolveAuthzContext` and `assembleExecutionContext` — the
 * agent's with the `mcp_agent_data_write` OAuth ceiling. `@objectstack/core` and
 * `@objectstack/plugin-sharing` resolve through their built `dist/`, as this
 * package's other suites read them.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
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
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ORG = 'org_cbp_erm';
const POSTURE = 'isolated' as const;

/** Holds the org's `member` role, so the platform ownership floor binds it. */
const MEMBER = 'u_cbp_erm_member';
/** Holds the org's `admin` role, outside the floor's domain. */
const ADMIN = 'u_cbp_erm_admin';
/** Owns the masters. */
const OTHER = 'u_cbp_erm_other';

/** A master whose own row-level policy decides, and a master whose own master decides. */
const M = { rls: 'qa_cbp_erm_master_rls', chain: 'qa_cbp_erm_master_chain' } as const;
/** The master of `M.chain`. */
const TOP = 'qa_cbp_erm_top';
type Leg = keyof typeof M;
const D = { rls: 'qa_cbp_erm_detail_rls', chain: 'qa_cbp_erm_detail_chain' } as const;
/**
 * A detail under `M.rls` whose master reference required-field validation does
 * not judge (`validateRecord` skips a provenance-flagged field), so the gate is
 * the one thing that holds the reference populated.
 */
const UNJUDGED = 'qa_cbp_erm_detail_unjudged';

/** On every leg: the master row the caller may not edit, and two it may. */
const held = (leg: Leg) => `${M[leg]}_held`;
const free = (leg: Leg, n: 1 | 2 = 1) => `${M[leg]}_free${n}`;

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
const detailOf = (name: string, master: string, fk = 'master', flags: Record<string, unknown> = {}) => ({
  name,
  label: name,
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    note: { name: 'note', type: 'text' },
    name: { name: 'name', type: 'text' },
    owner_id: { name: 'owner_id', type: 'text' },
    created_by: { name: 'created_by', type: 'text' },
    [fk]: { name: fk, type: 'master_detail', required: true, reference: master, ...flags },
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
    id: 'com.objectstack.qa.cbp-every-row-master',
    name: 'Every row a write stores in a controlled_by_parent detail is held to its master',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      { name: M.rls, label: 'Master', sharingModel: 'public_read_write', fields: masterFields },
      { name: TOP, label: 'Top', sharingModel: 'public_read_write', fields: masterFields },
      { ...detailOf(M.chain, TOP, 'top'), label: 'Master' },
      detailOf(D.rls, M.rls),
      detailOf(D.chain, M.chain),
      detailOf(UNJUDGED, M.rls, 'master', { system: true }),
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
  const WRITER = 'qa_cbp_erm_writer';
  const heldByName = (name: string, object: string) =>
    ({ name, object, operation: 'update', using: "name != 'held'" }) as const;
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({
      name: WRITER,
      objects: {
        [M.rls]: { allowRead: true, allowEdit: true },
        [TOP]: { allowRead: true, allowEdit: true },
        [M.chain]: CRUD,
        [D.rls]: CRUD,
        [D.chain]: CRUD,
        [UNJUDGED]: CRUD,
      },
      rowLevelSecurity: [heldByName('qa_cbp_erm_master_updates', M.rls), heldByName('qa_cbp_erm_top_updates', TOP)],
    }),
  ];
  await e.getDriver('sys_permission_set').create('sys_permission_set', {
    id: `ps_${WRITER}`, name: WRITER, label: WRITER, organization_id: null, managed_by: 'admin', active: true,
    object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  for (const user of [MEMBER, ADMIN]) {
    await e.insert('sys_user_permission_set', { id: `ups_${user}`, user_id: user, permission_set: WRITER, organization_id: ORG }, SYS);
  }
  const master = (object: string, id: string, name: string, extra: Record<string, unknown> = {}) =>
    e.insert(object, { id, name, owner_id: OTHER, created_by: OTHER, organization_id: ORG, ...extra }, SYS);
  await master(M.rls, held('rls'), 'held');
  await master(M.rls, free('rls', 1), 'free');
  await master(M.rls, free('rls', 2), 'free');
  await master(TOP, `${TOP}_held`, 'held');
  await master(TOP, `${TOP}_free`, 'free');
  // The middle masters carry no rule of their own: the top each sits under decides.
  await master(M.chain, held('chain'), 'held', { top: `${TOP}_held` });
  await master(M.chain, free('chain', 1), 'free', { top: `${TOP}_free` });
  await master(M.chain, free('chain', 2), 'free', { top: `${TOP}_free` });

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
  // The engine's security source, as `ObjectQLPlugin.init` wires it on a kernel (ADR-0139 D2).
  wireEngineSecuritySource(engine, () => plugin);
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  // The row gates log the writes they refuse.
  vi.spyOn(e.logger, 'warn').mockImplementation(() => undefined);

  /** The protocol the bulk-create (`createManyData`) and import (`insertManyData`) doors call. */
  const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map(), undefined) as unknown as {
    createManyData(req: { object: string; records: unknown[]; context?: unknown }): Promise<unknown>;
    insertManyData(req: { object: string; records: unknown[]; context?: unknown }): Promise<unknown>;
  };

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
    /** The master-edit walk the gate runs once per master it asks about, for counting. */
    walk: () =>
      vi.spyOn(plugin as unknown as { assertControlledByParentChainEditable: () => Promise<void> }, 'assertControlledByParentChainEditable'),
    contextOf,
    /** Fresh row ids, one per master given, each row naming that master. */
    rows: (masters: readonly (string | undefined)[]) => {
      const tag = `t${++n}`;
      return masters.map((m, i) => ({ id: `${tag}_${i}`, note: tag, ...(m === undefined ? {} : { master: m }) }));
    },
    /**
     * A row written as SYSTEM under `under`, created by `creator`: a selecting
     * write by a floor-bound caller reaches only the rows it created.
     */
    seed: async (detail: string, under: string, creator: string) => {
      const id = `s${++n}`;
      await e.getDriver(detail).create(detail, { id, note: 'seed', created_by: creator, master: under, organization_id: ORG });
      return id;
    },
    /** Each row as stored — its master and its note — or `null` when it is absent. */
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
    insert: (detail: string, row: Record<string, unknown>, context: Record<string, unknown>) =>
      outcomeOf(engine.insert(detail, row, { context: { ...context } } as never)),
    /** The doors that hand the engine an array of rows. */
    batch: {
      'the engine array insert': (detail: string, rows: Record<string, unknown>[], context: Record<string, unknown>) =>
        outcomeOf(engine.insert(detail, rows, { context: { ...context } } as never)),
      'the engine insertMany': (detail: string, rows: Record<string, unknown>[], context: Record<string, unknown>) =>
        outcomeOf((engine as unknown as { insertMany: (o: string, r: unknown[], x: never) => Promise<unknown> }).insertMany(detail, rows, { context: { ...context } } as never)),
      'the protocol createManyData': (detail: string, rows: Record<string, unknown>[], context: Record<string, unknown>) =>
        outcomeOf(protocol.createManyData({ object: detail, records: rows, context: { ...context } })),
      'the protocol insertManyData': (detail: string, rows: Record<string, unknown>[], context: Record<string, unknown>) =>
        outcomeOf(protocol.insertManyData({ object: detail, records: rows, context: { ...context } })),
    },
    /** The three update shapes, each writing `data` to the one row `id` names. */
    update: {
      'addressed by where': (detail: string, id: string, data: Record<string, unknown>, context: Record<string, unknown>) =>
        outcomeOf(engine.update(detail, data, { where: { id }, context: { ...context } } as never)),
      'addressed in its body': (detail: string, id: string, data: Record<string, unknown>, context: Record<string, unknown>) =>
        outcomeOf(engine.update(detail, { id, ...data }, { context: { ...context } } as never)),
      selecting: (detail: string, id: string, data: Record<string, unknown>, context: Record<string, unknown>) =>
        outcomeOf(engine.update(detail, data, { where: { id: { $in: [id] } }, multi: true, context: { ...context } } as never)),
    },
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;
type BatchDoor = keyof Rig['batch'];
const DOORS: readonly BatchDoor[] = ['the engine array insert', 'the engine insertMany', 'the protocol createManyData', 'the protocol insertManyData'];
type UpdateShape = keyof Rig['update'];
const UPDATES: readonly UpdateShape[] = ['addressed by where', 'addressed in its body', 'selecting'];

const CALLERS = {
  'a member': { user: MEMBER, onBehalf: false },
  'an org admin': { user: ADMIN, onBehalf: false },
  'an agent acting for a member': { user: MEMBER, onBehalf: true },
} as const;
type Caller = keyof typeof CALLERS;

const LEGS: ReadonlyArray<{ leg: Leg; name: string; callers: readonly Caller[] }> = [
  { leg: 'rls', name: "the master's own row-level policy", callers: ['a member', 'an org admin', 'an agent acting for a member'] },
  { leg: 'chain', name: "the master's own master", callers: ['a member', 'an org admin'] },
];

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

describe('ADR-0055 §1 · §3 — every row a write stores in a controlled_by_parent detail is held to its master', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  describe('a batch create naming one master the caller may not edit is refused as a single create of that row is, and writes nothing', () => {
    for (const { leg, name, callers } of LEGS) {
      for (const caller of callers) {
        it(`${name}, ${caller}: through every door that hands the engine an array of rows`, async () => {
          const { user, onBehalf } = CALLERS[caller];
          const context = await rig.contextOf(user, onBehalf);
          // The precondition: a single create of that row is refused on the master-edit question.
          const [single] = rig.rows([held(leg)]);
          const refusal = await rig.insert(D[leg], single!, context);
          expect(refusal).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
          expect(await rig.stored(D[leg], [single!.id])).toEqual({ [single!.id]: null });

          for (const door of DOORS) {
            for (const masters of [[held(leg)], [free(leg), held(leg)], [held(leg), free(leg)]]) {
              const rows = rig.rows(masters);
              const outcome = await rig.batch[door](D[leg], rows, context);
              expect({ door, masters, outcome: envelope(outcome) }).toEqual({ door, masters, outcome: envelope(refusal) });
              const after = await rig.stored(D[leg], ids(rows));
              for (const id of ids(rows)) expect({ door, id, row: after[id] }).toEqual({ door, id, row: null });
            }
          }
        });
      }
    }
  });

  describe('a batch create whose rows’ masters the caller may all edit lands as it did', () => {
    for (const { leg, name, callers } of LEGS) {
      for (const caller of callers) {
        it(`${name}, ${caller}: each row under the master it names`, async () => {
          const { user, onBehalf } = CALLERS[caller];
          const context = await rig.contextOf(user, onBehalf);
          for (const door of DOORS) {
            const rows = rig.rows([free(leg, 1), free(leg, 2), free(leg, 1)]);
            const outcome = await rig.batch[door](D[leg], rows, context);
            expect({ door, landed: outcome.kind }).toEqual({ door, landed: 'landed' });
            const after = await rig.stored(D[leg], ids(rows));
            for (const row of rows) {
              expect({ door, id: row.id, row: after[row.id] }).toEqual({ door, id: row.id, row: { master: row.master, note: row.note } });
            }
          }
        });
      }
    }
  });

  it('each master a batch names is asked once, in row order, and a single create is asked once', async () => {
    const context = await rig.contextOf(ADMIN, false);
    const walk = rig.walk();
    try {
      const count = async (p: Promise<Outcome>) => {
        walk.mockClear();
        const outcome = await p;
        return { landed: outcome.kind, asked: walk.mock.calls.map((c) => (c as unknown[])[3]) };
      };
      const [f1, f2, h] = [free('rls', 1), free('rls', 2), held('rls')];
      expect(await count(rig.insert(D.rls, rig.rows([f1])[0]!, context))).toEqual({ landed: 'landed', asked: [f1] });
      for (const door of DOORS) {
        expect({ door, ...(await count(rig.batch[door](D.rls, rig.rows([f2, f1, f2, f1]), context))) })
          .toEqual({ door, landed: 'landed', asked: [f2, f1] });
        // The first master the caller may not edit is the answer; no master after it is asked.
        expect({ door, ...(await count(rig.batch[door](D.rls, rig.rows([f1, h, f2]), context))) })
          .toEqual({ door, landed: 'refused', asked: [f1, h] });
      }
    } finally {
      walk.mockRestore();
    }
  });

  it('a row naming no master, under a reference validation judges, is answered by validation as before', async () => {
    const context = await rig.contextOf(MEMBER, false);
    const single = await rig.insert(D.rls, rig.rows([undefined])[0]!, context);
    expect(single).toMatchObject({ kind: 'refused', code: 'VALIDATION_FAILED' });
    const rows = rig.rows([free('rls'), undefined]);
    const batch = await rig.batch['the engine array insert'](D.rls, rows, context);
    expect(batch).toMatchObject({ kind: 'refused', code: 'VALIDATION_FAILED' });
    expect(await rig.stored(D.rls, ids(rows))).toEqual(Object.fromEntries(ids(rows).map((id) => [id, null])));
    // The partial-success door answers that row alone, and lands the row whose master the caller may edit.
    const partial = rig.rows([free('rls'), undefined]);
    const outcome = await rig.batch['the engine insertMany'](D.rls, partial, context);
    expect(outcome.kind).toBe('landed');
    const perRow = (outcome as { value: Array<{ ok: boolean; error?: { code?: string } }> }).value;
    expect(perRow.map((r) => ({ ok: r.ok, code: r.error?.code }))).toEqual([{ ok: true, code: undefined }, { ok: false, code: 'VALIDATION_FAILED' }]);
    expect(await rig.stored(D.rls, ids(partial))).toEqual({
      [partial[0]!.id]: { master: free('rls'), note: partial[0]!.note },
      [partial[1]!.id]: null,
    });
  });

  it('under a reference validation does not judge: a batch create naming a master the caller may not edit is refused on that master, and every other batch create is still refused whole', async () => {
    for (const caller of Object.keys(CALLERS) as Caller[]) {
      const { user, onBehalf } = CALLERS[caller];
      const context = await rig.contextOf(user, onBehalf);
      const refusal = await rig.insert(UNJUDGED, rig.rows([held('rls')])[0]!, context);
      expect(refusal).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      for (const door of DOORS) {
        const refused = rig.rows([free('rls'), held('rls')]);
        const outcome = await rig.batch[door](UNJUDGED, refused, context);
        if (onBehalf) {
          // The agent's own pass runs first and whole: its sets may edit both
          // masters, so it meets the batch's empty-master answer before the
          // member's pass asks the master the member may not edit. Refused all
          // the same, and nothing is written.
          expect({ caller, door, outcome }).toMatchObject({ caller, door, outcome: { kind: 'refused', code: 'MISSING_REQUIRED_FIELD', status: 422 } });
        } else {
          expect({ caller, door, outcome: envelope(outcome) }).toEqual({ caller, door, outcome: envelope(refusal) });
        }
        const whole = rig.rows([free('rls'), free('rls', 2)]);
        expect({ caller, door, outcome: await rig.batch[door](UNJUDGED, whole, context) })
          .toMatchObject({ caller, door, outcome: { kind: 'refused', code: 'MISSING_REQUIRED_FIELD', status: 422 } });
        const after = await rig.stored(UNJUDGED, [...ids(refused), ...ids(whole)]);
        for (const [id, row] of Object.entries(after)) expect({ caller, door, id, row }).toEqual({ caller, door, id, row: null });
      }
    }
  });

  describe('an update never empties the master reference a detail derives its access from', () => {
    for (const caller of Object.keys(CALLERS) as Caller[]) {
      it(`${caller}: under a reference validation does not judge, it is refused on every update shape, and nothing is written`, async () => {
        const { user, onBehalf } = CALLERS[caller];
        const context = await rig.contextOf(user, onBehalf);
        for (const shape of UPDATES) {
          const id = await rig.seed(UNJUDGED, free('rls'), user);
          const outcome = await rig.update[shape](UNJUDGED, id, { master: null, note: 'written' }, context);
          expect({ shape, outcome }).toMatchObject({ shape, outcome: { kind: 'refused', code: 'MISSING_REQUIRED_FIELD', status: 422 } });
          expect({ shape, row: (await rig.stored(UNJUDGED, [id]))[id] }).toEqual({ shape, row: { master: free('rls'), note: 'seed' } });
          // The control: the same update leaving the reference out lands.
          const control = await rig.update[shape](UNJUDGED, id, { note: 'written' }, context);
          expect({ shape, landed: control.kind }).toEqual({ shape, landed: 'landed' });
          expect({ shape, row: (await rig.stored(UNJUDGED, [id]))[id] }).toEqual({ shape, row: { master: free('rls'), note: 'written' } });
        }
      });
    }

    it('under a reference validation judges, validation answers it as before', async () => {
      const context = await rig.contextOf(MEMBER, false);
      for (const shape of UPDATES) {
        const id = await rig.seed(D.rls, free('rls'), MEMBER);
        const outcome = await rig.update[shape](D.rls, id, { master: null, note: 'written' }, context);
        expect({ shape, outcome }).toMatchObject({ shape, outcome: { kind: 'refused', code: 'VALIDATION_FAILED' } });
        expect({ shape, row: (await rig.stored(D.rls, [id]))[id] }).toEqual({ shape, row: { master: free('rls'), note: 'seed' } });
      }
    });

    it('the master the row is stored under is asked first: one the caller may not edit refuses on it', async () => {
      const context = await rig.contextOf(MEMBER, false);
      for (const shape of UPDATES) {
        const id = await rig.seed(UNJUDGED, held('rls'), MEMBER);
        const outcome = await rig.update[shape](UNJUDGED, id, { master: null }, context);
        expect({ shape, outcome }).toMatchObject({ shape, outcome: { kind: 'refused', code: 'PERMISSION_DENIED', status: 403 } });
        expect({ shape, row: (await rig.stored(UNJUDGED, [id]))[id] }).toEqual({ shape, row: { master: held('rls'), note: 'seed' } });
      }
    });
  });
});

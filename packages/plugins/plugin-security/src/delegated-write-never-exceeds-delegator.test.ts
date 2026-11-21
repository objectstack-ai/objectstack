// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D10] An on-behalf-of by-id write never admits a row its
 * delegator's own by-id write refuses.
 *
 * An OAuth agent acting for a user carries a ceiling of its own and is bounded
 * by that user: every row gate a by-id write meets asks the delegator as well.
 * The bound pinned here is the one the delegator's OWN direct write sets, at
 * each gate that judges a delegated by-id write:
 *
 * - the by-id `update` and `delete` of a row;
 * - the row an `update` would store;
 * - a `controlled_by_parent` detail's write, judged through its master.
 *
 * [#35917, ruled A] On an ordinary object the delegator's own composition now
 * keeps the floor beside an authored policy, so it narrows nothing the
 * floor-standing delegator filter does not. It still narrows on a
 * `controlled_by_parent` object, where the delegator's direct write lets the
 * floor yield to the master gate: the `d_note_held`, `g_under_mid_held` and
 * detail store cells pin that, one per gate (the by-id pre-image, the master
 * gate on a middle master, the stored row).
 *
 * Every refusal stands beside the delegator's own request as its control, and
 * every row-level verdict beside explain's record verdict for the same caller,
 * under a walled (`isolated`) and a wall-less (`single`) posture.
 *
 * The bound only narrows. Two shapes the delegator's own write admits stay
 * refused on its behalf, exactly as they were: making the delegated write
 * match the delegator's own there would WIDEN it, which is not what this rule
 * says, so those rows pin the refusal as unchanged.
 *
 * Real stack: `ObjectQL` over better-sqlite3, the real `SecurityPlugin`, the
 * real sharing service and middleware, and contexts assembled by
 * `resolveAuthzContext` and `assembleExecutionContext` — the agent's with the
 * `mcp_agent_data_write` OAuth ceiling. `@objectstack/core` and
 * `@objectstack/plugin-sharing` resolve through their built `dist/`, as this
 * package's other suites read them.
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision, TenancyPosture } from '@objectstack/spec/security';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ALPHA = 'org_alpha';

/** A delegator whose own writes app-authored row-level policies bound. */
const BOUNDED = 'u_bounded_writer';
/** A delegator with an `org` write grant and no authored policy. */
const PLAIN = 'u_plain_writer';
/** Owns and creates the rows nobody else here does. */
const OTHER = 'u_someone_else';

/** An outcome with its ADR-0112 envelope: what a request answered. */
type Outcome = { kind: 'admitted' } | { kind: 'refused'; code?: string; status?: number };
const ADMITTED: Outcome = { kind: 'admitted' };
const DENIED: Outcome = { kind: 'refused', code: 'PERMISSION_DENIED', status: 403 };

const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    () => ADMITTED,
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

/** See the explain-enforce-parity suite: a torn-down rig's async storages are released once its last row is judged. */
const releaseAsyncContexts = (...owners: object[]): void => {
  for (const owner of owners) {
    for (const value of Object.values(owner)) if (value instanceof AsyncLocalStorage) value.disable();
  }
};

async function boot(posture: TenancyPosture) {
  const OBJ = 'qa_bounded_record';
  const MASTER = 'qa_bounded_master';
  const DETAIL = 'qa_bounded_detail';
  /** A detail of DETAIL: DETAIL is then a `controlled_by_parent` MIDDLE master. */
  const GRAND = 'qa_bounded_grand_detail';
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  const fields = {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    note: { name: 'note', type: 'text' },
    owner_id: { name: 'owner_id', type: 'text' },
    created_by: { name: 'created_by', type: 'text' },
  };
  engine.registerApp({
    id: `com.objectstack.qa.delegated-write-bound-${posture}`,
    name: 'An on-behalf-of write is bounded by its delegator',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      { name: OBJ, label: 'Record', sharingModel: 'private', fields },
      { name: MASTER, label: 'Master', sharingModel: 'private', fields },
      {
        name: DETAIL,
        label: 'Detail',
        sharingModel: 'controlled_by_parent',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          note: { name: 'note', type: 'text' },
          created_by: { name: 'created_by', type: 'text' },
          master: { name: 'master', type: 'master_detail', required: true, reference: MASTER },
        },
      },
      {
        name: GRAND,
        label: 'Grand detail',
        sharingModel: 'controlled_by_parent',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          note: { name: 'note', type: 'text' },
          created_by: { name: 'created_by', type: 'text' },
          master: { name: 'master', type: 'master_detail', required: true, reference: DETAIL },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less rows below exist only on a store built before 18.x
  // (ADR-0131 D1 makes a fresh tenant column NOT NULL): this is that store.
  await relaxTenantColumns(engine, ['sys_permission_set']);

  const e = engine as unknown as {
    insert: (o: string, row: Record<string, unknown>, opts: never) => Promise<unknown>;
    getDriver: (o: string) => { create: (o: string, row: Record<string, unknown>) => Promise<unknown> };
    logger: { warn: () => void };
  };
  await e.insert('sys_organization', { id: ALPHA, name: ALPHA, slug: ALPHA }, SYS);
  for (const id of [BOUNDED, PLAIN, OTHER]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
    await e.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: ALPHA, role: 'member' }, SYS);
  }
  const org = { allowRead: true, allowEdit: true, allowDelete: true, readScope: 'org', writeScope: 'org' } as const;
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({
      name: 'qa_bounded_writer',
      objects: {
        [OBJ]: org, [MASTER]: org,
        [DETAIL]: { allowRead: true, allowEdit: true, allowDelete: true },
        [GRAND]: { allowRead: true, allowEdit: true, allowDelete: true },
      },
      rowLevelSecurity: [
        { name: 'qa_bounded_updates', object: OBJ, operation: 'update', using: "name != 'held'" },
        { name: 'qa_bounded_deletes', object: OBJ, operation: 'delete', using: "name != 'held'" },
        { name: 'qa_bounded_master_updates', object: MASTER, operation: 'update', using: "name != 'held'" },
        // [#24792] The one region where the delegator's own composition still
        // narrows under ruling A: a `controlled_by_parent` object, where the
        // delegator's direct write carries the master-gate vouch and the
        // floor yields to the master, so this policy decides alone, while the
        // delegated path's floor-standing filter keeps the floor beside it.
        { name: 'qa_bounded_detail_updates', object: DETAIL, operation: 'update', using: "note != 'held'" },
      ],
    }),
    PermissionSetSchema.parse({ name: 'qa_plain_writer', objects: { [OBJ]: org } }),
  ];
  for (const name of ['qa_bounded_writer', 'qa_plain_writer']) {
    await e.getDriver('sys_permission_set').create('sys_permission_set', {
      id: `ps_${name}`, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  for (const [user, set] of [[BOUNDED, 'qa_bounded_writer'], [PLAIN, 'qa_plain_writer']] as const) {
    await e.insert('sys_user_permission_set', {
      id: `ups_${user}`, user_id: user, permission_set: set, organization_id: ALPHA,
    }, SYS);
  }
  const row = (id: string, name: string, owner: string, creator: string) =>
    ({ id, name, note: '', owner_id: owner, created_by: creator, organization_id: ALPHA });
  // [#35917, ruled A] Every `held` row is one the delegator did NOT create.
  // The platform's ownership floor (`created_by == current_user.id`) stays an
  // OR term beside an authored write policy, so on a row the delegator
  // created the floor admits it whatever the authored policy says: the rows
  // whose refusal this file pins are created by someone else, and the
  // `held_created*` rows pin the creator's admission, by the delegator and
  // on its behalf alike.
  for (const r of [
    row('held_1', 'held', BOUNDED, OTHER),
    row('held_2', 'held', OTHER, OTHER),
    row('free_1', 'free', BOUNDED, BOUNDED),
    row('held_del_direct', 'held', BOUNDED, OTHER),
    row('held_del_agent', 'held', BOUNDED, OTHER),
    row('free_del_direct', 'free', BOUNDED, BOUNDED),
    row('free_del_agent', 'free', BOUNDED, BOUNDED),
    row('store_direct', 'free', BOUNDED, OTHER),
    row('store_agent', 'free', BOUNDED, OTHER),
    row('held_created', 'held', BOUNDED, BOUNDED),
    row('held_created_del_direct', 'held', BOUNDED, BOUNDED),
    row('held_created_del_agent', 'held', BOUNDED, BOUNDED),
    row('plain_1', 'x', OTHER, OTHER),
    row('plain_2', 'x', PLAIN, OTHER),
  ]) await e.insert(OBJ, r, SYS);
  await e.insert(MASTER, row('m_held', 'held', BOUNDED, OTHER), SYS);
  await e.insert(MASTER, row('m_free', 'free', BOUNDED, BOUNDED), SYS);
  // [#35917, ruled A] A held master the delegator CREATED: the floor stays
  // beside the master's authored policy, so the master gate admits its details.
  await e.insert(MASTER, row('m_held_created', 'held', BOUNDED, BOUNDED), SYS);
  for (const [id, master, note] of [
    ['d_held', 'm_held', ''], ['d_free', 'm_free', ''], ['d_held_del_direct', 'm_held', ''], ['d_held_del_agent', 'm_held', ''],
    ['d_under_held_created', 'm_held_created', ''],
    ['d_under_held_created_del_direct', 'm_held_created', ''], ['d_under_held_created_del_agent', 'm_held_created', ''],
    // [#24792] Details the delegator created that its own detail policy refuses
    // (or, for the store rows, would refuse once written), under a master it may edit.
    ['d_note_held', 'm_free', 'held'], ['d_store_direct', 'm_free', ''], ['d_store_agent', 'm_free', ''],
    ['d_mid_held', 'm_free', 'held'],
  ] as const) {
    await e.insert(DETAIL, { id, note, created_by: BOUNDED, master, organization_id: ALPHA }, SYS);
  }
  await e.insert(GRAND, { id: 'g_under_mid_held', note: '', created_by: BOUNDED, master: 'd_mid_held', organization_id: ALPHA }, SYS);

  let security: { explain: (input: unknown, ctx: unknown) => Promise<ExplainDecision> } | undefined;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s: { name?: string }) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    tenancy: { posture },
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
  // The engine's security source, as `ObjectQLPlugin.init` wires it on a kernel (ADR-0139 D2).
  wireEngineSecuritySource(engine, () => plugin);
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  // The row gates log the writes they refuse.
  vi.spyOn(e.logger, 'warn').mockImplementation(() => undefined);

  /** The caller's context as a request assembles it: the user's session, and for an agent its OAuth ceiling. */
  const contextOf = async (userId: string, onBehalf: boolean) => {
    const authz = await resolveAuthzContext({
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      ql: engine,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `sess_${userId}_${posture}`, userId, activeOrganizationId: ALPHA },
      }),
      tenancyPosture: posture,
    });
    return assembleExecutionContext({
      authz,
      oauth: onBehalf
        ? { userId, scopes: ['data:write'], clientId: 'qa_agent_client', scopePermissions: ['mcp_agent_data_write'], delegatesActions: false }
        : undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    } as never)!;
  };
  const objects = { OBJ, DETAIL, GRAND } as const;
  type Obj = keyof typeof objects;
  let n = 0;

  return {
    /** Explain's record verdict for the caller's own by-id write of `object/id`. */
    explainVisible: async (userId: string, onBehalf: boolean, operation: 'update' | 'delete', object: Obj, id: string) =>
      (await security!.explain({ object: objects[object], operation, recordId: id }, { ...(await contextOf(userId, onBehalf)) }))
        .record?.visible,
    update: async (userId: string, onBehalf: boolean, object: Obj, id: string) =>
      outcomeOf(engine.update(objects[object], { note: `n_${++n}` }, {
        where: { id }, context: { ...(await contextOf(userId, onBehalf)) },
      } as never)),
    /** A by-id update whose stored row carries a value the delegator's own update may not store. */
    storeHeld: async (userId: string, onBehalf: boolean, id: string) =>
      outcomeOf(engine.update(OBJ, { name: 'held' }, {
        where: { id }, context: { ...(await contextOf(userId, onBehalf)) },
      } as never)),
    /** A by-id detail update whose stored row carries a note the delegator's own detail policy may not store. */
    storeHeldDetail: async (userId: string, onBehalf: boolean, id: string) =>
      outcomeOf(engine.update(DETAIL, { note: 'held' }, {
        where: { id }, context: { ...(await contextOf(userId, onBehalf)) },
      } as never)),
    remove: async (userId: string, onBehalf: boolean, object: Obj, id: string) =>
      outcomeOf(engine.delete(objects[object], { where: { id }, context: { ...(await contextOf(userId, onBehalf)) } } as never)),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;
const rigs = new Map<TenancyPosture, Promise<Rig>>();
const rigFor = (posture: TenancyPosture): Promise<Rig> => {
  let rig = rigs.get(posture);
  if (!rig) {
    rig = boot(posture);
    rigs.set(posture, rig);
  }
  return rig;
};
afterAll(async () => {
  for (const rig of rigs.values()) await (await rig.catch(() => undefined))?.teardown();
});

const word = (o: Outcome): string => (o.kind === 'admitted' ? 'admitted' : `refused ${o.code} / ${o.status}`);

/**
 * One by-id write, asked by the delegator itself and by an agent on its
 * behalf. `rows` names the row each asks about (a delete that lands removes
 * its row, so each delete asker has its own).
 */
interface Cell {
  delegator: string;
  verb: 'update' | 'delete';
  object: 'OBJ' | 'DETAIL' | 'GRAND';
  rows: { direct: string; agent: string };
  shape: string;
  direct: Outcome;
  agent: Outcome;
}

const CELLS: Cell[] = [
  {
    delegator: BOUNDED, verb: 'update', object: 'OBJ', rows: { direct: 'held_1', agent: 'held_1' },
    shape: 'a row the delegator\'s own update refuses', direct: DENIED, agent: DENIED,
  },
  {
    delegator: BOUNDED, verb: 'update', object: 'OBJ', rows: { direct: 'held_2', agent: 'held_2' },
    shape: 'a second row the delegator\'s own update refuses', direct: DENIED, agent: DENIED,
  },
  {
    delegator: BOUNDED, verb: 'update', object: 'OBJ', rows: { direct: 'free_1', agent: 'free_1' },
    shape: 'the control: a row the delegator\'s own update admits', direct: ADMITTED, agent: ADMITTED,
  },
  {
    delegator: BOUNDED, verb: 'delete', object: 'OBJ', rows: { direct: 'held_del_direct', agent: 'held_del_agent' },
    shape: 'a row the delegator\'s own delete refuses', direct: DENIED, agent: DENIED,
  },
  {
    delegator: BOUNDED, verb: 'delete', object: 'OBJ', rows: { direct: 'free_del_direct', agent: 'free_del_agent' },
    shape: 'the control: a row the delegator\'s own delete admits', direct: ADMITTED, agent: ADMITTED,
  },
  {
    delegator: BOUNDED, verb: 'update', object: 'DETAIL', rows: { direct: 'd_held', agent: 'd_held' },
    shape: 'a detail whose master refuses the delegator\'s own detail update', direct: DENIED, agent: DENIED,
  },
  {
    delegator: BOUNDED, verb: 'delete', object: 'DETAIL', rows: { direct: 'd_held_del_direct', agent: 'd_held_del_agent' },
    shape: 'a detail whose master refuses the delegator\'s own detail delete', direct: DENIED, agent: DENIED,
  },
  // [#35917, ruled A] A held row the delegator CREATED: the ownership floor
  // stays an OR term beside the authored policy, so both are admitted.
  {
    delegator: BOUNDED, verb: 'update', object: 'OBJ', rows: { direct: 'held_created', agent: 'held_created' },
    shape: 'a held row the delegator created (the floor admits it beside the authored policy)', direct: ADMITTED, agent: ADMITTED,
  },
  {
    delegator: BOUNDED, verb: 'delete', object: 'OBJ', rows: { direct: 'held_created_del_direct', agent: 'held_created_del_agent' },
    shape: 'a held row the delegator created, delete (the floor admits it beside the authored policy)', direct: ADMITTED, agent: ADMITTED,
  },
  {
    delegator: BOUNDED, verb: 'update', object: 'DETAIL', rows: { direct: 'd_free', agent: 'd_free' },
    shape: 'the control: a detail whose master admits the delegator\'s own detail update', direct: ADMITTED, agent: ADMITTED,
  },
  // [#35917, ruled A] The master check: a held master the delegator CREATED
  // admits its details, for the delegator and on its behalf.
  {
    delegator: BOUNDED, verb: 'update', object: 'DETAIL', rows: { direct: 'd_under_held_created', agent: 'd_under_held_created' },
    shape: 'a detail under a held master the delegator created (the floor admits the master beside its authored policy)', direct: ADMITTED, agent: ADMITTED,
  },
  {
    delegator: BOUNDED, verb: 'delete', object: 'DETAIL', rows: { direct: 'd_under_held_created_del_direct', agent: 'd_under_held_created_del_agent' },
    shape: 'a detail under a held master the delegator created, delete', direct: ADMITTED, agent: ADMITTED,
  },
  // [#24792] Where the delegator's own composition still narrows: on a
  // `controlled_by_parent` object the delegator's direct write lets the floor
  // yield to the master gate, so its authored detail policy decides alone,
  // while every floor-standing filter on the delegated path admits a row the
  // delegator created. Only the delegator's own composition, ANDed beside
  // them, refuses on its behalf.
  {
    delegator: BOUNDED, verb: 'update', object: 'DETAIL', rows: { direct: 'd_note_held', agent: 'd_note_held' },
    shape: 'a detail the delegator created that its own detail policy refuses (the step 2.7 bound)', direct: DENIED, agent: DENIED,
  },
  {
    delegator: BOUNDED, verb: 'update', object: 'GRAND', rows: { direct: 'g_under_mid_held', agent: 'g_under_mid_held' },
    shape: 'a detail under a middle master the delegator created that its own middle-master policy refuses (the master-gate bound)', direct: DENIED, agent: DENIED,
  },
  // The bound only narrows: rows the delegator's own write admits and the
  // delegated write has always refused stay refused.
  {
    delegator: PLAIN, verb: 'update', object: 'OBJ', rows: { direct: 'plain_1', agent: 'plain_1' },
    shape: 'unchanged: a row the delegator\'s own update admits and the delegated update refuses', direct: ADMITTED, agent: DENIED,
  },
  {
    delegator: PLAIN, verb: 'update', object: 'OBJ', rows: { direct: 'plain_2', agent: 'plain_2' },
    shape: 'unchanged: a second row the delegator\'s own update admits and the delegated update refuses', direct: ADMITTED, agent: DENIED,
  },
];

describe('an on-behalf-of by-id write never admits a row its delegator\'s own by-id write refuses (ADR-0090 D10)', () => {
  for (const posture of ['isolated', 'single'] as const) {
    for (const c of CELLS) {
      it(`\`${posture}\` · ${c.verb} · ${c.shape} → the delegator's own: ${word(c.direct)}; on its behalf: ${word(c.agent)}`, async () => {
        const rig = await rigFor(posture);
        const ask = (onBehalf: boolean, id: string) =>
          c.verb === 'update' ? rig.update(c.delegator, onBehalf, c.object, id) : rig.remove(c.delegator, onBehalf, c.object, id);
        // Explain first: a delete that lands removes the row it explains.
        const explainedDirect = await rig.explainVisible(c.delegator, false, c.verb, c.object, c.rows.direct);
        const explainedAgent = await rig.explainVisible(c.delegator, true, c.verb, c.object, c.rows.agent);
        const direct = await ask(false, c.rows.direct);
        const agent = await ask(true, c.rows.agent);
        expect(direct, 'the delegator\'s own write').toStrictEqual(c.direct);
        expect(agent, 'the write on its behalf').toStrictEqual(c.agent);
        // Explain's record verdict is the door's, for both callers.
        expect(explainedDirect, 'explain, the delegator\'s own write').toBe(c.direct.kind === 'admitted');
        expect(explainedAgent, 'explain, the write on its behalf').toBe(c.agent.kind === 'admitted');
      }, 60_000);
    }

    it(`\`${posture}\` · update · a row the delegator's own update may not store → refused on its behalf as for the delegator`, async () => {
      const rig = await rigFor(posture);
      expect(await rig.storeHeld(BOUNDED, false, 'store_direct'), 'the delegator\'s own write').toStrictEqual(DENIED);
      expect(await rig.storeHeld(BOUNDED, true, 'store_agent'), 'the write on its behalf').toStrictEqual(DENIED);
    }, 60_000);

    // [#24792] The post-image bound on a `controlled_by_parent` detail the
    // delegator created: its own detail policy refuses the stored note.
    it(`\`${posture}\` · update · a detail the delegator created, whose stored row its own detail policy refuses → refused on its behalf as for the delegator`, async () => {
      const rig = await rigFor(posture);
      expect(await rig.storeHeldDetail(BOUNDED, false, 'd_store_direct'), 'the delegator\'s own write').toStrictEqual(DENIED);
      expect(await rig.storeHeldDetail(BOUNDED, true, 'd_store_agent'), 'the write on its behalf').toStrictEqual(DENIED);
    }, 60_000);
  }
});

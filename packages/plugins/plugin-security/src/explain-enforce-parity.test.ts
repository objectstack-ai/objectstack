// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `security.explain` answers what enforcement does — every verdict position,
 * one table.
 *
 * ## The invariant
 *
 * For one principal, one policy set and one object, explain's answer is the
 * answer the principal's own request gets from enforcement, or it is
 * enforcement's refusal:
 *
 * - enforcement refuses with `INVALID_FILTER` / 400 (a predicate the driver
 *   will not compile) ⇒ explain refuses with the same envelope;
 * - enforcement refuses otherwise (a 403) ⇒ explain refuses with
 *   `INVALID_FILTER` / 400, or its verdict at that position is a denial;
 * - enforcement fails with an error that carries NO envelope (a dependency's
 *   own error, thrown as raised) ⇒ explain fails the same way, with no
 *   envelope, or its verdict at that position is a denial. No envelope is its
 *   own value, compared as absence: `code` and `status` are absent, never a
 *   spelled-out placeholder;
 * - enforcement answers ⇒ explain answers too, and its verdict at that
 *   position is enforcement's: the same row set for the object-level
 *   `allowed` / `readFilter`, the same row for `record.visible`, the same
 *   permission sets for the principal.
 *
 * There is no third, quieter answer: an explanation that reports `allowed:
 * true`, or a record's `visible: false` with no decider, for a request
 * enforcement refuses, fails its row. So does an explanation that refuses what
 * enforcement answers.
 *
 * ## The table
 *
 * Every row drives BOTH faces through the real stack — the real
 * `SecurityPlugin`, a real `ObjectQL` over a real SQL driver (better-sqlite3,
 * one in-memory database per rig) — and asserts enforcement's own outcome as
 * well, so a row cannot go green by both faces drifting together. The rows are
 * the explain-versus-enforce family's shapes so far: the record-grained write
 * verdict's inputs (#19963), the record-grained read verdict's read depth
 * (#19986), a shared dependency that throws (#20002), the record matcher under
 * a cross-class field comparison (#20431), the explained user's organization
 * claim (#20580), and this card's three positions (#20604):
 *
 * 1. the object-level pass under a predicate the find refuses answered
 *    `allowed: true`, the `rls` layer `narrows` and the predicate as
 *    `readFilter`;
 * 2. a record id that does not exist, under the same predicate, answered its
 *    missing-record shape (`visible: false`, no decider);
 * 3. the user explained by another carried no organization of its own, so a
 *    current member was denied a tenant object their own find reads, and a
 *    permission set scoped to their organization did not load.
 *
 * A new explain position, or a new way enforcement can refuse, is a new row
 * here. The next divergence then fails a row instead of becoming another card.
 * It is a test, not a gate.
 *
 * ## Measured divergences
 *
 * Two disagreements this table measured are findings of this card, reported
 * and not fixed here. Their rows carry the finding's name and assert the
 * disagreement itself, so they turn red the day either face moves, and the row
 * then joins the invariant:
 *
 * - `NATIVE_SCOPING_UNDER_SINGLE` (explain's side): under `single` the engine
 *   still scopes a tenant object's read to the context's organization, which
 *   explain's tenant layer does not report.
 * - `CLAIM_KEPT_UNDER_A_WALL` (enforcement's side): with `org-scoping` and no
 *   `tenancy` service, admission reads no posture and never drops a removed
 *   member's organization claim, while this plugin walls Layer 0 at
 *   `isolated`. Explain vets the claim under the posture the plugin walls with.
 *
 * `@objectstack/core` and `@objectstack/plugin-sharing` resolve through their
 * built `dist/` here, as this package's other suites read them.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision, TenancyPosture } from '@objectstack/spec/security';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition } from './objects/sys-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

// ── the two faces ─────────────────────────────────────────────────────────

/**
 * An error's ADR-0112 envelope. Both halves are optional because a failure can
 * carry neither: {@link envelopeOf} then answers `undefined`, and the refusal
 * has no `code` and no `status` at all.
 */
type Envelope = { code?: string; status?: number };
const INVALID: Envelope = { code: 'INVALID_FILTER', status: 400 };
const DENIED: Envelope = { code: 'PERMISSION_DENIED', status: 403 };

/** What enforcement answered the principal's own request with. */
type Enforced =
  | { kind: 'rows'; ids: string[] }
  | { kind: 'admitted' }
  | ({ kind: 'refused' } & Envelope)
  | { kind: 'sets'; names: string[] };

/** What explain answered for the same principal, object and operation. */
type Explained =
  | ({ kind: 'refused' } & Envelope & { message: string })
  | { kind: 'decision'; decision: ExplainDecision };

/** Which verdict of the explanation the row compares. */
type Position =
  | 'object.allowed'
  | 'object.readFilter'
  | 'record.visible'
  | 'principal.permissionSets';

/** The envelope an error carries, or `undefined` when it carries none. */
const envelopeOf = (e: unknown): Envelope | undefined => {
  const x = e as { code?: unknown; status?: unknown; statusCode?: unknown } | null | undefined;
  const code = x?.code == null ? undefined : String(x.code);
  const rawStatus = x?.statusCode ?? x?.status;
  const status = rawStatus == null || Number.isNaN(Number(rawStatus)) ? undefined : Number(rawStatus);
  if (code === undefined && status === undefined) return undefined;
  return { ...(code !== undefined ? { code } : {}), ...(status !== undefined ? { status } : {}) };
};

/** An envelope with both halves spelled, so absence compares as absence. */
const envelopeKeysOf = (x: Envelope) => ({ code: x.code, status: x.status });

const explained = (p: Promise<ExplainDecision>): Promise<Explained> =>
  p.then(
    (decision) => ({ kind: 'decision' as const, decision }),
    (e: unknown) => ({ kind: 'refused' as const, ...envelopeOf(e), message: String((e as Error)?.message) }),
  );

const rowsOf = (p: Promise<unknown>): Promise<Enforced> =>
  p.then(
    (rows) => ({
      kind: 'rows' as const,
      ids: (Array.isArray(rows) ? rows : []).map((r) => String((r as { id?: unknown }).id)).sort(),
    }),
    (e: unknown) => ({ kind: 'refused' as const, ...envelopeOf(e) }),
  );

const landed = (p: Promise<unknown>): Promise<Enforced> =>
  p.then(
    () => ({ kind: 'admitted' as const }),
    (e: unknown) => ({ kind: 'refused' as const, ...envelopeOf(e) }),
  );

/** A short reading of an explanation for a failure message. */
function describeExplained(x: Explained): string {
  if (x.kind === 'refused') return `refused ${x.code} / ${x.status}`;
  const d = x.decision;
  const rls = d.layers.find((l) => l.layer === 'rls')?.verdict;
  return `allowed: ${d.allowed}, rls: ${rls}` +
    (d.record ? `, record: ${JSON.stringify(d.record)}` : '') +
    (d.readFilter !== undefined ? `, readFilter: ${JSON.stringify(d.readFilter)}` : '');
}

/**
 * THE invariant, once. `readAs` applies an explained `readFilter` as a system
 * read, so the object-level filter is compared by the rows it admits.
 */
async function expectParity(
  row: string,
  position: Position,
  explain: Explained,
  enforce: Enforced,
  ctx: { recordId?: string; readAs?: (filter: unknown) => Promise<string[]> } = {},
): Promise<void> {
  const where = `${row} · ${position}: explain answered ${describeExplained(explain)}; enforcement ${JSON.stringify(enforce)}`;
  if (enforce.kind === 'refused') {
    if (enforce.code === INVALID.code) {
      expect(explain.kind === 'refused' ? { code: explain.code, status: explain.status } : 'answered', where)
        .toEqual(INVALID);
      return;
    }
    if (explain.kind === 'refused') {
      // No envelope is its own value: a failure that carries none is matched
      // only by explain failing without one; anything else by the refusal.
      const noEnvelope = enforce.code === undefined && enforce.status === undefined;
      expect(envelopeKeysOf(explain), where).toStrictEqual(envelopeKeysOf(noEnvelope ? {} : INVALID));
      return;
    }
    const d = explain.decision;
    if (position === 'record.visible') expect(d.record?.visible, where).toBe(false);
    else expect(d.allowed, where).toBe(false);
    return;
  }
  expect(explain.kind, `${where} — explain refused what enforcement answered`).toBe('decision');
  if (explain.kind !== 'decision') return;
  const d = explain.decision;
  switch (position) {
    case 'principal.permissionSets':
      expect(enforce.kind, where).toBe('sets');
      if (enforce.kind === 'sets') expect([...(d.principal.permissionSets ?? [])].sort(), where).toEqual([...enforce.names].sort());
      return;
    case 'record.visible': {
      const reached = enforce.kind === 'admitted' || (enforce.kind === 'rows' && enforce.ids.includes(String(ctx.recordId)));
      expect(d.record?.visible, where).toBe(reached);
      return;
    }
    case 'object.allowed': {
      const reached = enforce.kind === 'admitted' || (enforce.kind === 'rows' && enforce.ids.length > 0);
      expect(d.allowed, where).toBe(reached);
      return;
    }
    case 'object.readFilter': {
      expect(enforce.kind, where).toBe('rows');
      if (enforce.kind !== 'rows' || !ctx.readAs) throw new Error(`${row}: a readFilter row needs rows and readAs`);
      expect(d.allowed, where).toBe(true);
      expect(await ctx.readAs(d.readFilter), where).toEqual(enforce.ids);
      return;
    }
  }
}

// ── rig 1: one row-level policy, the caller explaining themselves ────────────

let seq = 0;
const next = () => `${process.pid}_${++seq}`;

/** The caller the RLS rig explains: the set's only holder, asking about themselves. */
const RLS_CALLER = { userId: 'usr_member', positions: ['qa_pos'], permissions: ['qa_deal_guard'], posture: 'MEMBER' };

/**
 * A `public_read_write` object (no OWD narrowing, so the row-level policy is
 * the only thing between the caller and a row), one permission set holding one
 * `operation: 'all'` policy, and rows `r1` / `r2`.
 */
async function bootRls(predicate: string, opts: { grantCrud?: boolean } = {}) {
  const OBJ = `qa_parity_deal_${next()}`;
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.explain-parity-rls-${seq}`,
    name: 'Explain parity: one row-level policy',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Deal',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          status: { name: 'status', type: 'text' },
          title: { name: 'title', type: 'text' },
          amount: { name: 'amount', type: 'number' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await engine.insert(OBJ, [
    { id: 'r1', status: 'open', title: 'x', amount: 5 },
    { id: 'r2', status: 'open', title: 'open', amount: 7 },
  ], SYS);

  const set = PermissionSetSchema.parse({
    name: 'qa_deal_guard',
    objects: opts.grantCrud === false
      ? {}
      : { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [{ name: 'deal_guard', object: OBJ, operation: 'all', using: predicate }],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    // As in rig 2: the lifecycle hooks are collected and never fired, so no
    // bootstrap read is left running into the engine teardown.
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The driver logs the refused comparison it withholds from the caller.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const caller = { ...RLS_CALLER };
  type Op = 'read' | 'create' | 'update' | 'delete';
  return {
    explain: (operation: Op, recordId?: string) =>
      explained(plugin.explainAccessForCaller({ object: OBJ, operation, ...(recordId ? { recordId } : {}) }, caller)),
    find: (where?: Record<string, unknown>) =>
      rowsOf(engine.find(OBJ, { ...(where ? { where } : {}), context: caller } as never)),
    update: (id: string) =>
      landed(engine.update(OBJ, { title: 'y' }, { where: { id }, context: caller } as never)),
    remove: (id: string) => landed(engine.delete(OBJ, { where: { id }, context: caller } as never)),
    insert: () =>
      landed(engine.insert(OBJ, { id: `r_new_${next()}`, status: 'open', title: 'z', amount: 1 }, { context: caller } as never)),
    readAs: async (filter: unknown) =>
      ((await engine.find(OBJ, { ...(filter ? { where: filter } : {}), context: { isSystem: true } } as never)) as Array<{ id: string }>)
        .map((r) => String(r.id)).sort(),
    teardown: async () => { try { await engine.destroy(); } catch { /* noop */ } },
  };
}

/** `record.status != record.amount`: text against number, two comparison classes. */
const CROSS_CLASS = 'record.status != record.amount';
/** The same pair, the other way round. */
const CROSS_CLASS_REVERSED = 'record.amount > record.status';
/** `record.status != record.title`: text against text — the control. */
const SAME_CLASS = 'record.status != record.title';

// ── rig 2: an administrator explaining another user ─────────────────────────

const ALPHA = 'org_alpha';
const BETA = 'org_beta';
/** An `org_alpha` member holding `manage_users` there: the caller who explains. */
const USER_ADMIN = 'usr_alpha_admin';
/** A current `org_alpha` member. */
const USER_MEMBER = 'usr_alpha_member';
/** Removed from `org_alpha`, still a member of `org_beta`; the `org_alpha` grants were left behind. */
const USER_REMOVED = 'usr_alpha_removed';

/** Declared in metadata, granted in `org_alpha`: reads the tenant ledger and the global probe. */
const READER_SET = 'qa_parity_reader';
/**
 * Authored only as a `sys_permission_set` row OF `org_alpha` (no metadata
 * declaration), granted in `org_alpha`: it opens the global note object.
 */
const ALPHA_ONLY_SET = 'qa_parity_alpha_notes';

/** How the deployment names its tenancy posture. */
type PostureSource =
  /** A `tenancy` service, as plugin-auth registers it: admission and the plugin read the same posture. */
  | { tenancy: TenancyPosture }
  /** Only `org-scoping`, no `tenancy` service: admission reads no posture, the plugin probes `isolated`. */
  | { orgScopingOnly: true };

/**
 * Real platform identity objects, three users, an `org_alpha`-scoped grant of
 * each set to the two `org_alpha` users, and three objects:
 *
 * - `LEDGER` — a tenant object (the tenant wall applies), rows in both
 *   organizations;
 * - `PROBE` — platform-global (`tenancy: { enabled: false }`), so only the
 *   grants decide;
 * - `NOTES` — platform-global, opened only by {@link ALPHA_ONLY_SET}.
 *
 * Enforcement's face is `resolveAuthzContext` with a session that claims
 * `org_alpha`, handed the posture admission hands it, assembled by
 * `assembleExecutionContext`, then the request through the engine.
 */
async function bootPrincipal(source: PostureSource) {
  const n = next();
  const LEDGER = `qa_parity_ledger_${n}`;
  const PROBE = `qa_parity_probe_${n}`;
  const NOTES = `qa_parity_notes_${n}`;
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  const textFields = { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' } };
  engine.registerApp({
    id: `com.objectstack.qa.explain-parity-principal-${seq}`,
    name: 'Explain parity: an administrator explaining another user',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
      { name: LEDGER, label: 'Ledger', sharingModel: 'public_read_write', fields: textFields },
      { name: PROBE, label: 'Probe', sharingModel: 'public_read_write', tenancy: { enabled: false }, fields: textFields },
      { name: NOTES, label: 'Notes', sharingModel: 'public_read_write', tenancy: { enabled: false }, fields: textFields },
    ],
  } as never);
  await engine.syncSchemas();

  const e = engine as unknown as { insert: (o: string, row: Record<string, unknown>, opts: never) => Promise<unknown> };
  for (const id of [ALPHA, BETA]) await e.insert('sys_organization', { id, name: id, slug: id }, SYS);
  for (const id of [USER_ADMIN, USER_MEMBER, USER_REMOVED]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
  }
  await e.insert('sys_member', { id: `mem_admin_${n}`, user_id: USER_ADMIN, organization_id: ALPHA, role: 'member' }, SYS);
  await e.insert('sys_member', { id: `mem_member_${n}`, user_id: USER_MEMBER, organization_id: ALPHA, role: 'member' }, SYS);
  await e.insert('sys_member', { id: `mem_removed_${n}`, user_id: USER_REMOVED, organization_id: BETA, role: 'member' }, SYS);
  const catalogue = (id: string, name: string, organization: string | null, objects: Record<string, unknown>) =>
    e.insert('sys_permission_set', {
      id, name, label: name, organization_id: organization, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify(objects), system_permissions: JSON.stringify([]),
    }, SYS);
  await catalogue(`ps_user_admin_${n}`, 'qa_user_admin', null, {});
  await catalogue(`ps_reader_${n}`, READER_SET, null, {});
  await catalogue(`ps_alpha_notes_${n}`, ALPHA_ONLY_SET, ALPHA, { [NOTES]: { allowRead: true } });
  const grant = (user: string, set: string) =>
    e.insert('sys_user_permission_set', {
      id: `ups_${user}_${set}_${n}`, user_id: user, permission_set_id: set, organization_id: ALPHA,
    }, SYS);
  await grant(USER_ADMIN, `ps_user_admin_${n}`);
  for (const u of [USER_MEMBER, USER_REMOVED]) {
    await grant(u, `ps_reader_${n}`);
    await grant(u, `ps_alpha_notes_${n}`);
  }
  await e.insert(LEDGER, { id: 'l_alpha', name: 'alpha row', organization_id: ALPHA }, SYS);
  await e.insert(LEDGER, { id: 'l_beta', name: 'beta row', organization_id: BETA }, SYS);
  await e.insert(PROBE, { id: 'p1', name: 'probe row' }, SYS);
  await e.insert(NOTES, { id: 'n1', name: 'note row' }, SYS);

  const userAdminSet = PermissionSetSchema.parse({ name: 'qa_user_admin', objects: {}, systemPermissions: ['manage_users'] });
  const readerSet = PermissionSetSchema.parse({
    name: READER_SET,
    objects: { [LEDGER]: { allowRead: true, readScope: 'org' }, [PROBE]: { allowRead: true } },
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, userAdminSet, readerSet],
    },
    ...('tenancy' in source ? { tenancy: { posture: source.tenancy } } : { 'org-scoping': {} }),
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    // The lifecycle hooks are collected and never fired: nothing on either
    // face depends on them, and a bootstrap left running would race teardown.
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  const security = services.security as { resolvePermissionSetsForContext: (c: unknown) => Promise<Array<{ name: string }>> };
  /** The posture admission hands the resolver: the `tenancy` service's, or none when it is not registered. */
  const admissionPosture = 'tenancy' in source ? source.tenancy : undefined;

  const enforced = async (userId: string) => {
    const authz = await resolveAuthzContext({
      ql: engine,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `sess_${userId}_${n}`, userId, activeOrganizationId: ALPHA },
      }),
      tenancyPosture: admissionPosture,
    });
    return assembleExecutionContext({
      authz, oauth: undefined, localization: undefined, requestLocale: undefined, accessToken: undefined,
    } as never)!;
  };
  const admin = await enforced(USER_ADMIN);
  const objects = { LEDGER, PROBE, NOTES } as const;
  type Obj = keyof typeof objects;

  return {
    objects,
    /** The service method `POST /api/v1/security/explain` calls: the `org_alpha` admin explaining `userId`. */
    explain: (userId: string, object: Obj, recordId?: string) =>
      explained(plugin.explainAccessForCaller(
        { object: objects[object], operation: 'read', userId, ...(recordId ? { recordId } : {}) },
        admin,
      )),
    /** The explained user's own read, through the real resolver and the real middleware. */
    find: async (userId: string, object: Obj) =>
      rowsOf(engine.find(objects[object], { context: await enforced(userId) } as never)),
    /** The permission sets enforcement resolves for the explained user's own requests. */
    sets: async (userId: string): Promise<Enforced> => ({
      kind: 'sets',
      names: (await security.resolvePermissionSetsForContext(await enforced(userId))).map((s) => s.name),
    }),
    readAs: async (object: Obj, filter: unknown) =>
      ((await engine.find(objects[object], { ...(filter ? { where: filter } : {}), context: { isSystem: true } } as never)) as Array<{ id: string }>)
        .map((r) => String(r.id)).sort(),
    tenantOf: async (userId: string) => (await enforced(userId)).tenantId,
    teardown: async () => { try { await engine.destroy(); } catch { /* noop */ } },
  };
}

// ── rig 3: a private object behind the real sharing service ─────────────────

/** Read depth `org`: every line, whoever owns it. */
const SHARING_READER = { userId: 'u_reader', positions: ['qa_pos'], permissions: ['qa_line_reader'], posture: 'MEMBER' };
/** Write depth `org`: edits every line, whoever owns it. */
const SHARING_WRITER = { userId: 'u_writer', positions: ['qa_pos'], permissions: ['qa_line_writer'], posture: 'MEMBER' };
/** Read and write depth `own`: the control. */
const SHARING_OWN = { userId: 'u_own', positions: ['qa_pos'], permissions: ['qa_line_own'], posture: 'MEMBER' };

/**
 * A `private`-OWD object with an `owner_id`, the real `SharingService` as the
 * kernel's `sharing` service and its middleware on the engine after this
 * plugin's, as the platform boots them. Row `l_other` is owned by nobody the
 * rig explains. `faultReadFilter` makes the sharing service's read filter
 * reject, as a share store that cannot be read does.
 */
async function bootSharing(opts: { faultReadFilter?: boolean } = {}) {
  const LINE = `qa_parity_line_${next()}`;
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.explain-parity-sharing-${seq}`,
    name: 'Explain parity: a private object behind the sharing service',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysRecordShare,
      {
        name: LINE,
        label: 'Line',
        sharingModel: 'private',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await engine.insert(LINE, [
    { id: 'l_other', name: 'owned by someone else', owner_id: 'u_somebody' },
    { id: 'l_own', name: 'owned by the control', owner_id: 'u_own' },
  ], SYS);

  const sets = [
    MEMBER_DEFAULT,
    PermissionSetSchema.parse({ name: 'qa_line_reader', objects: { [LINE]: { allowRead: true, readScope: 'org' } } }),
    PermissionSetSchema.parse({
      name: 'qa_line_writer',
      objects: { [LINE]: { allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'org' } },
    }),
    PermissionSetSchema.parse({
      name: 'qa_line_own',
      objects: { [LINE]: { allowRead: true, allowEdit: true, readScope: 'own', writeScope: 'own' } },
    }),
  ];
  let security: unknown;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    get sharing() { return sharing; },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { if (name === 'security') security = svc; },
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
  if (opts.faultReadFilter) {
    sharing.buildReadFilter = async () => { throw new Error('share store unavailable'); };
  }
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });

  return {
    explain: (caller: object, operation: 'read' | 'update', recordId: string) =>
      explained(plugin.explainAccessForCaller({ object: LINE, operation, recordId }, { ...caller })),
    find: (caller: object, id: string) => rowsOf(engine.find(LINE, { where: { id }, context: { ...caller } } as never)),
    update: (caller: object, id: string) =>
      landed(engine.update(LINE, { name: 'renamed' }, { where: { id }, context: { ...caller } } as never)),
    teardown: async () => { try { await engine.destroy(); } catch { /* noop */ } },
  };
}

// ── the table ───────────────────────────────────────────────────────────────

type RlsRig = Awaited<ReturnType<typeof bootRls>>;
type PrincipalRig = Awaited<ReturnType<typeof bootPrincipal>>;

interface Row {
  /** The family card whose shape this row is. */
  card: string;
  /** What is compared, in words. */
  shape: string;
  position: Position;
  /** Enforcement's own answer, asserted too: a row cannot go green by both faces drifting. */
  enforced: Enforced | 'rows' | 'admitted';
  /** Where the invariant leaves explain two answers, the one it must give. */
  explainKind?: Explained['kind'];
  /**
   * A divergence this table MEASURES and does not fix: the finding it was
   * reported as. The row asserts the disagreement, so it turns red the day
   * either face moves — and the row then joins the invariant.
   */
  divergence?: string;
  run: RowRun;
}

/** A row's run: boots its own rig, and hands back the teardown the table calls once the row is judged. */
type RowRun = () => Promise<RowFaces & { teardown: () => Promise<void> }>;
interface RowFaces {
  explain: Explained;
  enforce: Enforced;
  recordId?: string;
  /** Applies an explained `readFilter` as a system read — live until the row's teardown. */
  readAs?: (filter: unknown) => Promise<string[]>;
}

const withRls = (predicate: string, f: (rig: RlsRig) => Promise<RowFaces>, opts: { grantCrud?: boolean } = {}): RowRun => async () => {
  const rig = await bootRls(predicate, opts);
  try { return { ...(await f(rig)), teardown: rig.teardown }; } catch (e) { await rig.teardown(); throw e; }
};
const withSharing = (
  opts: { faultReadFilter?: boolean },
  f: (rig: Awaited<ReturnType<typeof bootSharing>>) => Promise<RowFaces>,
): RowRun => async () => {
  const rig = await bootSharing(opts);
  try { return { ...(await f(rig)), teardown: rig.teardown }; } catch (e) { await rig.teardown(); throw e; }
};
const withPrincipal = (source: PostureSource, f: (rig: PrincipalRig) => Promise<RowFaces>): RowRun => async () => {
  const rig = await bootPrincipal(source);
  try { return { ...(await f(rig)), teardown: rig.teardown }; } catch (e) { await rig.teardown(); throw e; }
};

const REFUSED_INVALID: Enforced = { kind: 'refused', ...INVALID };
const REFUSED_DENIED: Enforced = { kind: 'refused', ...DENIED };
/** [#21771] The read door's answer for an id it does not return, which a by-id write now gives for a row its caller cannot read. */
const REFUSED_NOT_FOUND: Enforced = { kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 };

/** Rows over one row-level policy: every verdict position, for a predicate the find refuses and for the control. */
function rlsRows(card: string, label: string, predicate: string, refused: boolean): Row[] {
  const rows: Row[] = [
    {
      card, shape: `${label}: object-level read`, position: 'object.allowed',
      enforced: refused ? REFUSED_INVALID : 'rows',
      run: withRls(predicate, async (r) => ({ explain: await r.explain('read'), enforce: await r.find() })),
    },
    {
      card, shape: `${label}: object-level read filter`, position: 'object.readFilter',
      enforced: refused ? REFUSED_INVALID : 'rows',
      run: withRls(predicate, async (r) => ({ explain: await r.explain('read'), enforce: await r.find(), readAs: r.readAs })),
    },
    {
      card, shape: `${label}: object-level update, against a by-id update`, position: 'object.allowed',
      enforced: refused ? REFUSED_DENIED : 'admitted',
      run: withRls(predicate, async (r) => ({ explain: await r.explain('update'), enforce: await r.update('r1') })),
    },
    {
      card, shape: `${label}: object-level delete, against a by-id delete`, position: 'object.allowed',
      enforced: refused ? REFUSED_DENIED : 'admitted',
      run: withRls(predicate, async (r) => ({ explain: await r.explain('delete'), enforce: await r.remove('r1') })),
    },
    {
      card, shape: `${label}: object-level create, against an insert`, position: 'object.allowed',
      enforced: refused ? REFUSED_INVALID : 'admitted',
      run: withRls(predicate, async (r) => ({ explain: await r.explain('create'), enforce: await r.insert() })),
    },
    {
      card, shape: `${label}: record r1, read`, position: 'record.visible',
      enforced: refused ? REFUSED_INVALID : 'rows',
      run: withRls(predicate, async (r) => ({
        explain: await r.explain('read', 'r1'), enforce: await r.find({ id: 'r1' }), recordId: 'r1',
      })),
    },
    {
      card, shape: `${label}: record r2, read`, position: 'record.visible',
      enforced: refused ? REFUSED_INVALID : 'rows',
      run: withRls(predicate, async (r) => ({
        explain: await r.explain('read', 'r2'), enforce: await r.find({ id: 'r2' }), recordId: 'r2',
      })),
    },
    {
      card, shape: `${label}: record r1, update`, position: 'record.visible',
      enforced: refused ? REFUSED_DENIED : 'admitted',
      run: withRls(predicate, async (r) => ({ explain: await r.explain('update', 'r1'), enforce: await r.update('r1') })),
    },
    {
      card, shape: `${label}: record r2, update`, position: 'record.visible',
      // r2 is outside the predicate, so the caller cannot read it (#21771);
      // a predicate the find refuses still refuses before that question.
      enforced: refused ? REFUSED_DENIED : REFUSED_NOT_FOUND,
      run: withRls(predicate, async (r) => ({ explain: await r.explain('update', 'r2'), enforce: await r.update('r2') })),
    },
    {
      card, shape: `${label}: record r1, delete`, position: 'record.visible',
      enforced: refused ? REFUSED_DENIED : 'admitted',
      run: withRls(predicate, async (r) => ({ explain: await r.explain('delete', 'r1'), enforce: await r.remove('r1') })),
    },
  ];
  return rows;
}

/** Position 2: a record id no row carries, under the same predicate. */
function missingRecordRows(card: string, label: string, predicate: string, refused: boolean): Row[] {
  return [
    {
      card, shape: `${label}: a record id that does not exist, read`, position: 'record.visible',
      enforced: refused ? REFUSED_INVALID : 'rows',
      run: withRls(predicate, async (r) => ({
        explain: await r.explain('read', 'r_missing'), enforce: await r.find({ id: 'r_missing' }), recordId: 'r_missing',
      })),
    },
  ];
}

/**
 * Rows over the principal rig: the `org_alpha` administrator explains a user,
 * and the user's own request is the other face. `expect` names enforcement's
 * outcome per (user, object) for this posture source.
 */
function principalRows(
  card: string,
  source: PostureSource,
  label: string,
  expectFor: Record<'removed' | 'member', Partial<Record<'LEDGER' | 'PROBE' | 'NOTES', Enforced | 'rows'>>>,
  /** `who` → the row keys (`sets`, `allowed:<OBJ>`, `readFilter:<OBJ>`, `record:<id>`) that diverge, and why. */
  divergent: Partial<Record<'removed' | 'member', Record<string, string>>> = {},
): Row[] {
  const rows: Row[] = [];
  const users = { removed: USER_REMOVED, member: USER_MEMBER } as const;
  for (const who of ['removed', 'member'] as const) {
    const userId = users[who];
    const divergence = (key: string) => divergent[who]?.[key];
    rows.push({
      card, shape: `${label}: the ${who} user's permission sets`, position: 'principal.permissionSets',
      enforced: { kind: 'sets', names: [] },
      divergence: divergence('sets'),
      run: withPrincipal(source, async (r) => ({ explain: await r.explain(userId, 'PROBE'), enforce: await r.sets(userId) })),
    });
    for (const object of ['LEDGER', 'PROBE', 'NOTES'] as const) {
      const enforced = expectFor[who][object];
      if (!enforced) continue;
      rows.push({
        card, shape: `${label}: the ${who} user, object-level read of ${object}`, position: 'object.allowed',
        enforced,
        divergence: divergence(`allowed:${object}`),
        run: withPrincipal(source, async (r) => ({ explain: await r.explain(userId, object), enforce: await r.find(userId, object) })),
      });
      if (enforced === 'rows') {
        rows.push({
          card, shape: `${label}: the ${who} user, ${object} read filter`, position: 'object.readFilter',
          enforced,
          divergence: divergence(`readFilter:${object}`),
          run: withPrincipal(source, async (r) => ({
            explain: await r.explain(userId, object),
            enforce: await r.find(userId, object),
            readAs: (f: unknown) => r.readAs(object, f),
          })),
        });
      }
    }
    if (expectFor[who].LEDGER) {
      for (const recordId of ['l_alpha', 'l_beta']) {
        rows.push({
          card, shape: `${label}: the ${who} user, LEDGER record ${recordId}`, position: 'record.visible',
          enforced: expectFor[who].LEDGER!,
          divergence: divergence(`record:${recordId}`),
          run: withPrincipal(source, async (r) => ({
            explain: await r.explain(userId, 'LEDGER', recordId), enforce: await r.find(userId, 'LEDGER'), recordId,
          })),
        });
      }
    }
  }
  return rows;
}

/**
 * Under `single` there is no tenant wall, yet the engine still scopes a tenant
 * object's read to the context's organization (driver-native tenant scoping,
 * any posture). Explain's tenant layer contributes nothing under `single`, so
 * it reports the other organization's row readable. Explain's side; a finding
 * of this card, not fixed here.
 */
const NATIVE_SCOPING_UNDER_SINGLE =
  'under `single`, the engine scopes the read to the context organization; explain reports the other organization\'s row';
/**
 * With `org-scoping` and no `tenancy` service, admission hands the resolver no
 * posture, so a removed member's organization claim is never dropped, while
 * this plugin probes `org-scoping` and walls Layer 0 at `isolated`. Explain
 * vets the claim under the posture this plugin walls with. Enforcement's side
 * (a claim never dropped under a walled Layer 0); a finding of this card, not
 * fixed here.
 */
const CLAIM_KEPT_UNDER_A_WALL =
  'with no `tenancy` service, admission keeps a removed member\'s claim while Layer 0 walls at `isolated`';

const TABLE: Row[] = [
  // #20604 position 1, and #20431's record-grained twin, over both orderings of one cross-class pair.
  ...rlsRows('#20604 P1 · #20431', 'cross-class `status != amount`', CROSS_CLASS, true),
  ...rlsRows('#20604 P1 · #20431', 'cross-class `amount > status`', CROSS_CLASS_REVERSED, true),
  ...rlsRows('control', 'same-class `status != title`', SAME_CLASS, false),
  // #20604 position 2.
  ...missingRecordRows('#20604 P2', 'cross-class `status != amount`', CROSS_CLASS, true),
  ...missingRecordRows('control', 'same-class `status != title`', SAME_CLASS, false),
  // #20604 position 1's boundary: a request the CRUD gate denies is denied there, by both faces.
  {
    card: '#20604 P1 boundary', shape: 'cross-class `status != amount`, no CRUD grant: object-level read', position: 'object.allowed',
    enforced: REFUSED_DENIED,
    explainKind: 'decision',
    run: withRls(CROSS_CLASS, async (r) => ({ explain: await r.explain('read'), enforce: await r.find() }), { grantCrud: false }),
  },
  // #19986: the record read verdict asks the sharing read filter with the caller's read depth.
  {
    card: '#19986', shape: 'private OWD, an `org` reader, a row owned by someone else, read', position: 'record.visible',
    enforced: 'rows',
    run: withSharing({}, async (r) => ({
      explain: await r.explain(SHARING_READER, 'read', 'l_other'), enforce: await r.find(SHARING_READER, 'l_other'), recordId: 'l_other',
    })),
  },
  {
    card: '#19986 control', shape: 'private OWD, an `own` reader, a row owned by someone else, read', position: 'record.visible',
    enforced: 'rows',
    run: withSharing({}, async (r) => ({
      explain: await r.explain(SHARING_OWN, 'read', 'l_other'), enforce: await r.find(SHARING_OWN, 'l_other'), recordId: 'l_other',
    })),
  },
  // #19963: the record write verdict hands the per-record gate the caller's write depth.
  {
    card: '#19963', shape: 'private OWD, an `org` writer, a row owned by someone else, update', position: 'record.visible',
    enforced: 'admitted',
    run: withSharing({}, async (r) => ({
      explain: await r.explain(SHARING_WRITER, 'update', 'l_other'), enforce: await r.update(SHARING_WRITER, 'l_other'),
    })),
  },
  {
    card: '#19963 control', shape: 'private OWD, an `own` writer, a row owned by someone else, update', position: 'record.visible',
    // [#21771] The `own` writer cannot READ a row owned by someone else on a
    // private object, so the by-id write answers the read door's not-found
    // before the sharing middleware's write refusal is reached.
    enforced: REFUSED_NOT_FOUND,
    run: withSharing({}, async (r) => ({
      explain: await r.explain(SHARING_OWN, 'update', 'l_other'), enforce: await r.update(SHARING_OWN, 'l_other'),
    })),
  },
  // #20002: a dependency enforcement shares with explain throws.
  {
    card: '#20002', shape: 'the sharing read filter throws, the caller\'s own row, read', position: 'record.visible',
    // The find fails with the sharing service's own error, which carries no
    // envelope: no code, no status.
    enforced: { kind: 'refused', code: undefined },
    run: withSharing({ faultReadFilter: true }, async (r) => ({
      explain: await r.explain(SHARING_OWN, 'read', 'l_own'), enforce: await r.find(SHARING_OWN, 'l_own'), recordId: 'l_own',
    })),
  },
  // #20580 (the removed member) and #20604 position 3 (the current member), under each walled posture.
  ...principalRows('#20580 · #20604 P3', { tenancy: 'isolated' }, '`isolated`', {
    removed: { LEDGER: REFUSED_DENIED, PROBE: REFUSED_DENIED, NOTES: REFUSED_DENIED },
    member: { LEDGER: 'rows', PROBE: 'rows', NOTES: 'rows' },
  }),
  ...principalRows('#20580 · #20604 P3', { tenancy: 'group' }, '`group`', {
    removed: { LEDGER: REFUSED_DENIED, PROBE: REFUSED_DENIED, NOTES: REFUSED_DENIED },
    member: { LEDGER: 'rows', PROBE: 'rows', NOTES: 'rows' },
  }),
  ...principalRows('#20580 control · #20604 P3', { tenancy: 'single' }, '`single`', {
    removed: { LEDGER: 'rows', PROBE: 'rows', NOTES: 'rows' },
    member: { LEDGER: 'rows', PROBE: 'rows', NOTES: 'rows' },
  }, {
    removed: { 'readFilter:LEDGER': NATIVE_SCOPING_UNDER_SINGLE, 'record:l_beta': NATIVE_SCOPING_UNDER_SINGLE },
    member: { 'readFilter:LEDGER': NATIVE_SCOPING_UNDER_SINGLE, 'record:l_beta': NATIVE_SCOPING_UNDER_SINGLE },
  }),
  // The posture-source asymmetry: the member's rows hold; the removed member's are enforcement's finding.
  ...principalRows('#20604 A4', { orgScopingOnly: true }, '`org-scoping` with no `tenancy` service', {
    removed: { LEDGER: 'rows', PROBE: 'rows', NOTES: 'rows' },
    member: { LEDGER: 'rows', PROBE: 'rows', NOTES: 'rows' },
  }, {
    removed: Object.fromEntries(
      ['sets', 'allowed:LEDGER', 'readFilter:LEDGER', 'record:l_alpha', 'allowed:PROBE', 'readFilter:PROBE',
        'allowed:NOTES', 'readFilter:NOTES'].map((k) => [k, CLAIM_KEPT_UNDER_A_WALL]),
    ),
  }),
];

describe('security.explain answers what enforcement does — the enumeration', () => {
  for (const row of TABLE) {
    const title = `${row.card} · ${row.shape} · ${row.position}` +
      (row.divergence ? ` · MEASURED DIVERGENCE, reported and not fixed here: ${row.divergence}` : '');
    it(title, async () => {
      const { explain, enforce, recordId, readAs, teardown } = await row.run();
      try {
        if (row.enforced === 'rows' || row.enforced === 'admitted') expect(enforce.kind, `${row.shape}: enforcement`).toBe(row.enforced);
        else if (row.enforced.kind === 'sets') expect(enforce.kind, `${row.shape}: enforcement`).toBe('sets');
        else if (row.enforced.kind === 'refused') {
          expect(enforce.kind, `${row.shape}: enforcement`).toBe('refused');
          if (enforce.kind === 'refused') {
            expect(envelopeKeysOf(enforce), `${row.shape}: enforcement's envelope`).toStrictEqual(envelopeKeysOf(row.enforced));
          }
        } else expect(enforce, `${row.shape}: enforcement`).toEqual(row.enforced);
        if (row.explainKind) expect(explain.kind, `${row.shape}: explain answered ${describeExplained(explain)}`).toBe(row.explainKind);
        const parity = expectParity(`${row.card} · ${row.shape}`, row.position, explain, enforce, { recordId, readAs });
        if (row.divergence) await expect(parity, `${row.shape}: the measured divergence no longer holds`).rejects.toThrow();
        else await parity;
      } finally {
        await teardown();
      }
    }, 60_000);
  }
});

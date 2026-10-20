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
 * well, so a row cannot go green by both faces drifting together. A row that
 * can write boots its own rig; the principal rows, which only read, share one
 * rig per posture source ({@link withPrincipal}). The rows are
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
 * A disagreement this table measured is a finding of this card, reported and
 * not fixed here. Its rows carry the finding's name and assert the
 * disagreement itself, so they turn red the day either face moves, and the row
 * then joins the invariant:
 *
 * - `CLAIM_KEPT_UNDER_A_WALL` (enforcement's side): with `org-scoping` and no
 *   `tenancy` service, admission reads no posture and never drops a removed
 *   member's organization claim, while this plugin walls Layer 0 at
 *   `isolated`. Explain vets the claim under the posture the plugin walls with.
 *
 * `@objectstack/core` and `@objectstack/plugin-sharing` resolve through their
 * built `dist/` here, as this package's other suites read them.
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
import { installCommentAccessHooks } from '@objectstack/plugin-audit';

import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxEveryRegisteredTenantColumn } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * Releases the `AsyncLocalStorage` instances a torn-down rig's engine and
 * plugin hold. On Node 22 a storage runs on `async_hooks`: once it has served a
 * `run()` it stays on a process-wide list that EVERY later promise creation
 * walks, until `disable()`. `ObjectQL` holds three and `SecurityPlugin` one,
 * and neither `destroy()` disables them, so each rig this table tore down left
 * its storages behind and every later row paid to walk all of them. Called
 * after the rig's last row is judged, on objects nothing uses again, so it
 * changes nothing any row observes.
 */
const releaseAsyncContexts = (...owners: object[]): void => {
  for (const owner of owners) {
    for (const value of Object.values(owner)) if (value instanceof AsyncLocalStorage) value.disable();
  }
};

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

// ── the real parent gate ──────────────────────────────────────────────────

/**
 * [#24646] The REAL `sys_comment` moderation gate (`@objectstack/plugin-audit`,
 * read from source by this package's vitest alias), wired to a rig's own
 * security and sharing services and its engine. Only the comment table is held
 * in memory: one comment by somebody else on the parent record. `moderate`
 * deletes it as `caller` would and answers what the gate does — the question
 * "may the caller edit the parent record?" asked by the gate itself, against
 * the services enforcement runs on.
 */
function realCommentGate(engine: ObjectQL, getSharing: () => unknown, getSecurity: () => unknown) {
  return async (caller: object, object: string, recordId: string): Promise<Enforced> => {
    const comment = { id: `c_${next()}`, thread_id: `${object}:${recordId}`, author_id: 'u_comment_author', body: 'x' };
    const hooks = new Map<string, (ctx: unknown) => Promise<void>>();
    const e = engine as unknown as {
      find: (o: string, opts: unknown) => Promise<Array<Record<string, unknown>>>;
      findOne: (o: string, opts: unknown) => Promise<Record<string, unknown> | null>;
    };
    installCommentAccessHooks(
      {
        // The FIRST handler per event is the authorization gate.
        registerHook: (event, handler) => { if (!hooks.has(event)) hooks.set(event, handler as never); },
        find: async (o, opts) => (o === 'sys_comment' ? [comment] : e.find(o, opts)),
        findOne: async (o, opts) =>
          o === 'sys_comment' ? ((opts as { where?: { id?: unknown } })?.where?.id === comment.id ? comment : null) : e.findOne(o, opts),
      },
      getSharing as never,
      { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      undefined,
      getSecurity as never,
    );
    const userId = (caller as { userId?: string }).userId;
    return landed(hooks.get('beforeDelete')!({
      object: 'sys_comment',
      event: 'beforeDelete',
      input: { id: comment.id, options: { context: { ...caller } } },
      session: { userId },
    }));
  };
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
  // The organization-less rows below (global sets, positions, grants) exist only
  // on a store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): this is that store.
  await relaxEveryRegisteredTenantColumn(engine);
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
      get: async (type: string, name: string) =>
        type === 'permission' ? [MEMBER_DEFAULT, set].find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
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
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
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
/**
 * An `org_alpha` member holding `manage_users` there: the caller who explains.
 * It also reads what the explained users read ({@link READER_SET}): whether an
 * explanation may disclose a record is decided by the ASKER's read, and an
 * administrator explaining another user whose own read of the record is
 * refused is told what an id no row carries (ruling C of #22851). Holding the
 * reader set, this asker is told the explained user's own record story, which
 * is what every record cell below holds against enforcement.
 */
const USER_ADMIN = 'usr_alpha_admin';
/** A current `org_alpha` member. */
const USER_MEMBER = 'usr_alpha_member';
/** Removed from `org_alpha`, still a member of `org_beta`; the `org_alpha` grants were left behind. */
const USER_REMOVED = 'usr_alpha_removed';

/** Declared in metadata, granted in `org_alpha`: reads the tenant ledger and the global probe. */
const READER_SET = 'qa_parity_reader';
/**
 * Authored only as a `sys_permission_set` row OF `org_alpha` (no metadata
 * declaration), granted in `org_alpha`. It would open the global note object,
 * but a set the security catalog does not hold confers nothing (ADR-0131
 * D3/D4, #15196 Q3 A): `NOTES` is refused to every principal, on both faces.
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
 * - `NOTES` — platform-global, granted only by {@link ALPHA_ONLY_SET}, which no
 *   definition backs — so refused to everyone.
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
  // The organization-less rows below (global sets, positions, grants) exist only
  // on a store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): this is that store.
  await relaxEveryRegisteredTenantColumn(engine);

  const e = engine as unknown as { insert: (o: string, row: Record<string, unknown>, opts: never) => Promise<unknown> };
  for (const id of [ALPHA, BETA]) await e.insert('sys_organization', { id, name: id, slug: id }, SYS);
  for (const id of [USER_ADMIN, USER_MEMBER, USER_REMOVED]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
  }
  await e.insert('sys_member', { id: `mem_admin_${n}`, user_id: USER_ADMIN, organization_id: ALPHA, role: 'member' }, SYS);
  await e.insert('sys_member', { id: `mem_member_${n}`, user_id: USER_MEMBER, organization_id: ALPHA, role: 'member' }, SYS);
  await e.insert('sys_member', { id: `mem_removed_${n}`, user_id: USER_REMOVED, organization_id: BETA, role: 'member' }, SYS);
  // [C8 stage 8b] A catalogue row with no organization is landed straight through
  // the driver, as the residue an older release left: under `single` the engine
  // stamps or refuses an organization-less platform insert (ADR-0131 D9), and this
  // rig's engine holds two organizations.
  const catalogue = (id: string, name: string, organization: string | null, objects: Record<string, unknown>) => {
    const row = {
      id, name, label: name, organization_id: organization, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify(objects), system_permissions: JSON.stringify([]),
    };
    return organization === null
      ? (engine as any).getDriver('sys_permission_set').create('sys_permission_set', row)
      : e.insert('sys_permission_set', row, SYS);
  };
  await catalogue(`ps_user_admin_${n}`, 'qa_user_admin', null, {});
  await catalogue(`ps_reader_${n}`, READER_SET, null, {});
  await catalogue(`ps_alpha_notes_${n}`, ALPHA_ONLY_SET, ALPHA, { [NOTES]: { allowRead: true } });
  // Each grant carries the set's name beside its id, as every platform writer stores it.
  const grant = (user: string, set: string, name: string) =>
    e.insert('sys_user_permission_set', {
      id: `ups_${user}_${set}_${n}`, user_id: user, permission_set: name, organization_id: ALPHA,
    }, SYS);
  await grant(USER_ADMIN, `ps_user_admin_${n}`, 'qa_user_admin');
  await grant(USER_ADMIN, `ps_reader_${n}`, READER_SET);
  for (const u of [USER_MEMBER, USER_REMOVED]) {
    await grant(u, `ps_reader_${n}`, READER_SET);
    await grant(u, `ps_alpha_notes_${n}`, ALPHA_ONLY_SET);
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
      get: async (type: string, name: string) =>
        type === 'permission'
          ? [MEMBER_DEFAULT, userAdminSet, readerSet].find((s) => s.name === name) ?? null
          : engine.getSchema(name) ?? null,
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
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
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
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
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
 * Read depth `org`, write depth `own`, and an app-authored row-level `update`
 * and `delete` policy admitting every line not named `unnamed`
 * ({@link bootSharing}'s `authored` rows): record sharing refuses this writer
 * every line owned by someone else, and the by-id write gate defers that
 * refusal to the policy.
 */
const AUTHORED_WRITER = { userId: 'u_authored', positions: ['qa_pos'], permissions: ['qa_line_authored'], posture: 'MEMBER' };

/**
 * A `private`-OWD object with an `owner_id`, the real `SharingService` as the
 * kernel's `sharing` service and its middleware on the engine after this
 * plugin's, as the platform boots them. Row `l_other` is owned by nobody the
 * rig explains. `faultReadFilter` makes the sharing service's read filter
 * reject, as a share store that cannot be read does. `authored` adds
 * {@link AUTHORED_WRITER}'s set and three lines: `l_theirs` (owned by
 * someone else, admitted by the policy), `l_unnamed` (owned by someone else,
 * not admitted) and `l_mine` (owned by the writer).
 */
async function bootSharing(opts: { faultReadFilter?: boolean; authored?: boolean } = {}) {
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
  // The organization-less rows below (global sets, positions, grants) exist only
  // on a store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): this is that store.
  await relaxEveryRegisteredTenantColumn(engine);
  await engine.insert(LINE, [
    { id: 'l_other', name: 'owned by someone else', owner_id: 'u_somebody' },
    { id: 'l_own', name: 'owned by the control', owner_id: 'u_own' },
  ], SYS);
  if (opts.authored) {
    await engine.insert(LINE, [
      { id: 'l_theirs', name: 'theirs', owner_id: 'u_somebody' },
      { id: 'l_unnamed', name: 'unnamed', owner_id: 'u_somebody' },
      { id: 'l_mine', name: 'mine', owner_id: AUTHORED_WRITER.userId },
    ], SYS);
  }

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
    ...(opts.authored
      ? [PermissionSetSchema.parse({
          name: 'qa_line_authored',
          objects: {
            [LINE]: { allowRead: true, allowEdit: true, allowDelete: true, allowTransfer: true, readScope: 'org', writeScope: 'own' },
          },
          rowLevelSecurity: [
            { name: 'qa_line_named_updates', object: LINE, operation: 'update', using: "name != 'unnamed'" },
            { name: 'qa_line_named_deletes', object: LINE, operation: 'delete', using: "name != 'unnamed'" },
          ],
        })]
      : []),
  ];
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
  const moderate = realCommentGate(engine, () => sharing, () => security);

  return {
    explain: (caller: object, operation: 'read' | 'update' | 'delete' | 'transfer', recordId: string) =>
      explained(plugin.explainAccessForCaller({ object: LINE, operation, recordId }, { ...caller })),
    find: (caller: object, id: string) => rowsOf(engine.find(LINE, { where: { id }, context: { ...caller } } as never)),
    update: (caller: object, id: string) =>
      landed(engine.update(LINE, { name: 'renamed' }, { where: { id }, context: { ...caller } } as never)),
    remove: (caller: object, id: string) => landed(engine.delete(LINE, { where: { id }, context: { ...caller } } as never)),
    /** A transfer is a by-id update of `owner_id`, gated by the transfer grant. */
    transfer: (caller: object, id: string) =>
      landed(engine.update(LINE, { owner_id: 'u_recipient' }, { where: { id }, context: { ...caller } } as never)),
    /**
     * Record sharing's tri-state update verdict, asked as the `sys_attachment`
     * and `sys_comment` parent gates ask it before anything else: the caller's
     * envelope with no operation-private key.
     */
    checkEdit: (caller: object, id: string) => sharing!.checkEdit(LINE, id, { ...caller } as never),
    /** [#24646] The real `sys_comment` moderation gate, asked about a comment on `LINE/id` ({@link realCommentGate}). */
    moderate: (caller: object, id: string) => moderate(caller, LINE, id),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

// ── rig 4: on-behalf-of principals, and the delegators they act for ──────────

/** Write depth `org` on the parent, the master and the detail: the delegator ruling B is about. */
const D_ORG = 'u_d_org';
/** Write depth `own`: the control. */
const D_OWN = 'u_d_own';
/** Owns the rows nobody the rig explains owns. */
const D_OTHER = 'u_d_other';

/**
 * #24646 ruling item 3: for an ON-BEHALF-OF caller — an OAuth agent acting for
 * a user, its context assembled by the real `assembleExecutionContext` with the
 * `mcp_agent_data_write` ceiling — explain's record-grained `update` and
 * `delete` verdicts are what the by-id PATCH and DELETE of the same record
 * answer, under a walled (`isolated`) and a wall-less (`single`) posture. The
 * same rig explains the delegators themselves as the controls.
 *
 * A `private`-OWD `PARENT` with an owner and a creator column (`created_by` is
 * what the platform's ownership floor reads, and the delegated path keeps that
 * floor on both legs), a `private` `MASTER` and a `controlled_by_parent`
 * `DETAIL`. The rows separate owner from creator, so the delegated write's two
 * legs — plugin-sharing's gate as the delegator at its write depth, and the
 * delegator's own write filter beside the agent's — each decide a row:
 *
 * - `p_theirs_created_by_org`: owned by someone else, created by `D_ORG`;
 * - `p_org_mine_created_by_other`: owned by `D_ORG`, created by someone else;
 * - `p_theirs`, `p_org_mine`, `p_own_mine`: the controls;
 * - `p_beta`: another organization's row, which only the wall-less posture lets through;
 * - `p_del_*`: the same two shapes again, for the delete rows (a delete that lands removes its row).
 *
 * One rig per posture, shared by its rows: an admitted update writes only
 * `note`, which no policy reads, and every delete row has its own record.
 */
async function bootDelegated(posture: TenancyPosture) {
  const n = next();
  const PARENT = `qa_parity_parent_${n}`;
  const MASTER = `qa_parity_master_${n}`;
  const DETAIL = `qa_parity_detail_${n}`;
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  const ownedFields = {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    note: { name: 'note', type: 'text' },
    owner_id: { name: 'owner_id', type: 'text' },
    created_by: { name: 'created_by', type: 'text' },
  };
  engine.registerApp({
    id: `com.objectstack.qa.explain-parity-delegated-${seq}`,
    name: 'Explain parity: on-behalf-of principals',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      { name: PARENT, label: 'Parent', sharingModel: 'private', fields: ownedFields },
      { name: MASTER, label: 'Master', sharingModel: 'private', fields: ownedFields },
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
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less rows below (global sets, positions, grants) exist only
  // on a store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): this is that store.
  await relaxEveryRegisteredTenantColumn(engine);

  const e = engine as unknown as { insert: (o: string, row: Record<string, unknown>, opts: never) => Promise<unknown> };
  for (const id of [ALPHA, BETA]) await e.insert('sys_organization', { id, name: id, slug: id }, SYS);
  for (const id of [D_ORG, D_OWN, D_OTHER]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
    await e.insert('sys_member', { id: `mem_${id}_${n}`, user_id: id, organization_id: ALPHA, role: 'member' }, SYS);
  }
  const org = { allowRead: true, allowEdit: true, allowDelete: true, readScope: 'org', writeScope: 'org' } as const;
  const own = { allowRead: true, allowEdit: true, allowDelete: true, readScope: 'own', writeScope: 'own' } as const;
  const detail = { allowRead: true, allowEdit: true } as const;
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({ name: 'qa_d_org', objects: { [PARENT]: org, [MASTER]: org, [DETAIL]: detail } }),
    // Reads every master (so every detail), writes only its own: a detail under
    // someone else's master is one it reads and may not write.
    PermissionSetSchema.parse({
      name: 'qa_d_own',
      objects: { [PARENT]: own, [MASTER]: { ...own, readScope: 'org' }, [DETAIL]: detail },
    }),
  ];
  // A catalogue row with no organization, landed through the driver as in rig 2.
  for (const name of ['qa_d_org', 'qa_d_own']) {
    await (engine as any).getDriver('sys_permission_set').create('sys_permission_set', {
      id: `ps_${name}_${n}`, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  for (const [user, set] of [[D_ORG, 'qa_d_org'], [D_OWN, 'qa_d_own']] as const) {
    await e.insert('sys_user_permission_set', {
      id: `ups_${user}_${n}`, user_id: user, permission_set: set, organization_id: ALPHA,
    }, SYS);
  }
  const row = (id: string, owner: string, creator: string, organization = ALPHA) =>
    ({ id, name: id, note: '', owner_id: owner, created_by: creator, organization_id: organization });
  for (const r of [
    row('p_theirs', D_OTHER, D_OTHER),
    row('p_theirs_created_by_org', D_OTHER, D_ORG),
    row('p_org_mine', D_ORG, D_ORG),
    row('p_org_mine_created_by_other', D_ORG, D_OTHER),
    row('p_own_mine', D_OWN, D_OWN),
    row('p_beta', D_ORG, D_ORG, BETA),
    row('p_del_theirs_created_by_org', D_OTHER, D_ORG),
    row('p_del_org_mine_created_by_other', D_ORG, D_OTHER),
  ]) await e.insert(PARENT, r, SYS);
  await e.insert(MASTER, row('m_org', D_ORG, D_ORG), SYS);
  await e.insert(MASTER, row('m_theirs', D_OTHER, D_OTHER), SYS);
  await e.insert(DETAIL, { id: 'd_under_org', note: '', created_by: D_ORG, master: 'm_org', organization_id: ALPHA }, SYS);
  await e.insert(DETAIL, { id: 'd_under_theirs', note: '', created_by: D_ORG, master: 'm_theirs', organization_id: ALPHA }, SYS);

  let security: any;
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
    registerService: (name: string, svc: unknown) => { if (name === 'security') security = svc; else services[name] = svc; },
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
  // The pre-image gate logs the rows it refuses.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  /** The caller's context as a request assembles it: the user's session, and for an agent its OAuth ceiling. */
  const contextOf = async (userId: string, onBehalf: boolean) => {
    const authz = await resolveAuthzContext({
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      ql: engine,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `sess_${userId}_${n}`, userId, activeOrganizationId: ALPHA },
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
  const objects = { PARENT, MASTER, DETAIL } as const;
  type Obj = keyof typeof objects;
  const moderate = realCommentGate(engine, () => sharing, () => security);

  return {
    /** The security service's `explain`, asked as the caller about its own by-id write — what the parent gates ask. */
    explain: async (userId: string, onBehalf: boolean, operation: 'update' | 'delete', object: Obj, recordId: string) =>
      explained(security.explain({ object: objects[object], operation, recordId }, { ...(await contextOf(userId, onBehalf)) })),
    update: async (userId: string, onBehalf: boolean, object: Obj, id: string) =>
      landed(engine.update(objects[object], { note: `n_${next()}` }, { where: { id }, context: { ...(await contextOf(userId, onBehalf)) } } as never)),
    remove: async (userId: string, onBehalf: boolean, object: Obj, id: string) =>
      landed(engine.delete(objects[object], { where: { id }, context: { ...(await contextOf(userId, onBehalf)) } } as never)),
    /** The real `sys_comment` moderation gate, asked about a comment on `object/id` ({@link realCommentGate}). */
    moderate: async (userId: string, onBehalf: boolean, object: Obj, id: string) =>
      moderate({ ...(await contextOf(userId, onBehalf)) }, objects[object], id),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
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

/**
 * A row's run: boots its own rig, or takes its posture source's shared one (a
 * principal row), and hands back the teardown the table calls once the row is
 * judged: the rig's own, or none for the shared rig, torn down after the table.
 */
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
  opts: { faultReadFilter?: boolean; authored?: boolean },
  f: (rig: Awaited<ReturnType<typeof bootSharing>>) => Promise<RowFaces>,
): RowRun => async () => {
  const rig = await bootSharing(opts);
  try { return { ...(await f(rig)), teardown: rig.teardown }; } catch (e) { await rig.teardown(); throw e; }
};
/**
 * One principal rig per posture source, booted by the source's first row and
 * shared by the rest. Every principal row only READS: explain, the explained
 * user's own find, the sets enforcement resolves, and a system read of an
 * explained filter. None of them writes a row, a grant or a policy, so a row
 * reads the state the rig was booted with, as if the rig were its own. A row
 * that can write (the RLS and sharing rigs) still boots its own. Booting all 60
 * principal rows' rigs was most of this file's wall.
 */
const principalRigs = new Map<string, Promise<PrincipalRig>>();
const sharedPrincipalRig = (source: PostureSource): Promise<PrincipalRig> => {
  const key = JSON.stringify(source);
  let rig = principalRigs.get(key);
  if (!rig) {
    rig = bootPrincipal(source);
    principalRigs.set(key, rig);
  }
  return rig;
};
afterAll(async () => {
  for (const rig of principalRigs.values()) await (await rig.catch(() => undefined))?.teardown();
});
const withPrincipal = (source: PostureSource, f: (rig: PrincipalRig) => Promise<RowFaces>): RowRun => async () => {
  const rig = await sharedPrincipalRig(source);
  return { ...(await f(rig)), teardown: async () => undefined };
};

type DelegatedRig = Awaited<ReturnType<typeof bootDelegated>>;
/** One on-behalf-of rig per posture, booted by its first row (see {@link bootDelegated} for why its rows may share it). */
const delegatedRigs = new Map<TenancyPosture, Promise<DelegatedRig>>();
const sharedDelegatedRig = (posture: TenancyPosture): Promise<DelegatedRig> => {
  let rig = delegatedRigs.get(posture);
  if (!rig) {
    rig = bootDelegated(posture);
    delegatedRigs.set(posture, rig);
  }
  return rig;
};
afterAll(async () => {
  for (const rig of delegatedRigs.values()) await (await rig.catch(() => undefined))?.teardown();
});
const withDelegated = (posture: TenancyPosture, f: (rig: DelegatedRig) => Promise<RowFaces>): RowRun => async () => {
  const rig = await sharedDelegatedRig(posture);
  return { ...(await f(rig)), teardown: async () => undefined };
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
 * With `org-scoping` and no `tenancy` service, admission hands the resolver no
 * posture, so a removed member's organization claim is never dropped, while
 * this plugin probes `org-scoping` and walls Layer 0 at `isolated`. Explain
 * vets the claim under the posture this plugin walls with. Enforcement's side
 * (a claim never dropped under a walled Layer 0); a finding of this card, not
 * fixed here.
 */
const CLAIM_KEPT_UNDER_A_WALL =
  'with no `tenancy` service, admission keeps a removed member\'s claim while Layer 0 walls at `isolated`';

/**
 * #24646 ruling item 3, as rows: an on-behalf-of caller's record-grained
 * `update` / `delete` verdict against its by-id PATCH / DELETE, under one
 * posture, with the delegators' own requests as the controls. `walled` names
 * whether the posture walls Layer 0 (another organization's row is then one the
 * caller cannot read).
 */
function delegatedRows(posture: TenancyPosture, label: string, walled: boolean): Row[] {
  type Cell = [who: string, onBehalf: boolean, op: 'update' | 'delete', object: 'PARENT' | 'DETAIL', id: string, shape: string, enforced: Enforced | 'admitted'];
  const cells: Cell[] = [
    // The delegated path's two legs, each deciding a row.
    [D_ORG, true, 'update', 'PARENT', 'p_theirs_created_by_org', 'a row owned by someone else that it created', 'admitted'],
    [D_ORG, true, 'update', 'PARENT', 'p_org_mine_created_by_other', 'its own row someone else created', REFUSED_DENIED],
    [D_ORG, true, 'delete', 'PARENT', 'p_del_theirs_created_by_org', 'a row owned by someone else that it created', 'admitted'],
    [D_ORG, true, 'delete', 'PARENT', 'p_del_org_mine_created_by_other', 'its own row someone else created', REFUSED_DENIED],
    [D_ORG, true, 'update', 'PARENT', 'p_theirs', 'a row owned and created by someone else', REFUSED_DENIED],
    [D_ORG, true, 'update', 'PARENT', 'p_org_mine', 'its own row', 'admitted'],
    [D_ORG, true, 'update', 'PARENT', 'p_beta', "its own row in another organization", walled ? REFUSED_NOT_FOUND : 'admitted'],
    [D_ORG, true, 'update', 'DETAIL', 'd_under_org', 'a detail under its own master', 'admitted'],
    [D_ORG, true, 'update', 'DETAIL', 'd_under_theirs', "a detail under someone else's master", REFUSED_NOT_FOUND],
    [D_OWN, true, 'update', 'PARENT', 'p_own_mine', 'its own row', 'admitted'],
    [D_OWN, true, 'update', 'PARENT', 'p_theirs', 'a row it cannot read', REFUSED_NOT_FOUND],
    // The delegators themselves.
    [D_ORG, false, 'update', 'PARENT', 'p_theirs', 'a row owned and created by someone else', 'admitted'],
    [D_ORG, false, 'update', 'DETAIL', 'd_under_theirs', "a detail under someone else's master", 'admitted'],
    [D_ORG, false, 'update', 'PARENT', 'p_beta', 'its own row in another organization', walled ? REFUSED_NOT_FOUND : 'admitted'],
    [D_OWN, false, 'update', 'DETAIL', 'd_under_org', "a detail it reads under someone else's master", REFUSED_DENIED],
  ];
  return cells.map(([who, onBehalf, op, object, id, shape, enforced]) => ({
    card: '#24646 item 3',
    shape: `${label}: ${onBehalf ? `an agent on behalf of the \`${who === D_ORG ? 'org' : 'own'}\` writer` : `the \`${who === D_ORG ? 'org' : 'own'}\` writer`}, ${shape}, ${op}`,
    position: 'record.visible' as const,
    enforced,
    run: withDelegated(posture, async (r) => ({
      explain: await r.explain(who, onBehalf, op, object, id),
      enforce: op === 'update' ? await r.update(who, onBehalf, object, id) : await r.remove(who, onBehalf, object, id),
    })),
  }));
}

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
  // #24647: the by-id write gate defers record sharing's refusal to an
  // app-authored row-level write policy that admits the row (ADR-0105 D3).
  {
    card: '#24647', shape: 'private OWD, an `own` writer whose authored update policy admits a row owned by someone else, update',
    position: 'record.visible',
    enforced: 'admitted',
    run: withSharing({ authored: true }, async (r) => ({
      explain: await r.explain(AUTHORED_WRITER, 'update', 'l_theirs'), enforce: await r.update(AUTHORED_WRITER, 'l_theirs'),
    })),
  },
  {
    card: '#24647', shape: 'private OWD, an `own` writer whose authored delete policy admits a row owned by someone else, delete',
    position: 'record.visible',
    enforced: 'admitted',
    run: withSharing({ authored: true }, async (r) => ({
      explain: await r.explain(AUTHORED_WRITER, 'delete', 'l_theirs'), enforce: await r.remove(AUTHORED_WRITER, 'l_theirs'),
    })),
  },
  {
    card: '#24647 control', shape: 'private OWD, the same writer, a row owned by someone else that no authored policy admits, update',
    position: 'record.visible',
    enforced: REFUSED_DENIED,
    run: withSharing({ authored: true }, async (r) => ({
      explain: await r.explain(AUTHORED_WRITER, 'update', 'l_unnamed'), enforce: await r.update(AUTHORED_WRITER, 'l_unnamed'),
    })),
  },
  {
    card: '#24647 control', shape: 'private OWD, the same writer, a row owned by someone else that no authored policy admits, delete',
    position: 'record.visible',
    enforced: REFUSED_DENIED,
    run: withSharing({ authored: true }, async (r) => ({
      explain: await r.explain(AUTHORED_WRITER, 'delete', 'l_unnamed'), enforce: await r.remove(AUTHORED_WRITER, 'l_unnamed'),
    })),
  },
  {
    // A transfer's door is the by-id update of `owner_id`, deferred as an update.
    card: '#24647', shape: 'private OWD, an `own` writer holding the transfer grant whose authored update policy admits a row owned by someone else, transfer',
    position: 'record.visible',
    enforced: 'admitted',
    run: withSharing({ authored: true }, async (r) => ({
      explain: await r.explain(AUTHORED_WRITER, 'transfer', 'l_theirs'), enforce: await r.transfer(AUTHORED_WRITER, 'l_theirs'),
    })),
  },
  // #24646 ruling item 3: an on-behalf-of caller's by-id write verdict, under a walled and a wall-less posture.
  ...delegatedRows('isolated', '`isolated`', true),
  ...delegatedRows('single', '`single`', false),
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
    member: { LEDGER: 'rows', PROBE: 'rows', NOTES: REFUSED_DENIED },
  }),
  ...principalRows('#20580 · #20604 P3', { tenancy: 'group' }, '`group`', {
    removed: { LEDGER: REFUSED_DENIED, PROBE: REFUSED_DENIED, NOTES: REFUSED_DENIED },
    member: { LEDGER: 'rows', PROBE: 'rows', NOTES: REFUSED_DENIED },
  }),
  // [ADR-0131 D8] The `single` rows joined the invariant: the driver's read
  // scope is the wall's verdict, and under `single` that verdict is `none`, so
  // the engine no longer narrows the read to the context organization that
  // explain's tenant layer (correctly) never reported.
  ...principalRows('#20580 control · #20604 P3', { tenancy: 'single' }, '`single`', {
    removed: { LEDGER: 'rows', PROBE: 'rows', NOTES: REFUSED_DENIED },
    member: { LEDGER: 'rows', PROBE: 'rows', NOTES: REFUSED_DENIED },
  }),
  // The posture-source asymmetry: the member's rows hold; the removed member's are enforcement's finding.
  ...principalRows('#20604 A4', { orgScopingOnly: true }, '`org-scoping` with no `tenancy` service', {
    removed: { LEDGER: 'rows', PROBE: 'rows', NOTES: REFUSED_DENIED },
    member: { LEDGER: 'rows', PROBE: 'rows', NOTES: REFUSED_DENIED },
  }, {
    removed: Object.fromEntries(
      ['sets', 'allowed:LEDGER', 'readFilter:LEDGER', 'record:l_alpha', 'allowed:PROBE', 'readFilter:PROBE']
        .map((k) => [k, CLAIM_KEPT_UNDER_A_WALL]),
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

/**
 * #24647's row, beyond the verdict the table compares: what the record story
 * names, and what the `sys_attachment` and `sys_comment` parent gates answer.
 *
 * [#24646, ruling B] Both gates ask one question about the parent: explain's
 * record-grained `update` verdict, which composes the by-id write gate's
 * deferral to an app-authored row-level write policy (#24647). They no longer
 * ask record sharing's `checkEdit` first — that step, at owner-only depth, is
 * what used to refuse the row the deferral admits. So on such a row the gate
 * admits exactly what the parent's by-id update admits, and on a row the policy
 * does not admit it refuses exactly what that update refuses. The case below
 * asks the REAL `sys_comment` moderation gate ({@link realCommentGate}) on the
 * services enforcement runs on, so it fails the day either gate composition or
 * explain's deferral moves.
 */
describe('an app-authored row-level write policy the by-id write gate defers to (ADR-0105 D3)', () => {
  it('the update story names the deferral: record sharing excludes the row, row-level security admits it', async () => {
    const rig = await bootSharing({ authored: true });
    try {
      const x = await rig.explain(AUTHORED_WRITER, 'update', 'l_theirs');
      expect(x.kind, describeExplained(x)).toBe('decision');
      if (x.kind !== 'decision') return;
      expect(x.decision.record).toEqual({ recordId: 'l_theirs', visible: true, decidedBy: 'rls' });
      const sharingRecord = x.decision.layers.find((l) => l.layer === 'sharing')?.record;
      expect(sharingRecord?.outcome).toBe('excluded');
      expect(sharingRecord?.detail).toMatch(/app-authored row-level update policy admits this record/);
      expect(x.decision.layers.find((l) => l.layer === 'rls')?.record?.outcome).toBe('admitted');
    } finally {
      await rig.teardown();
    }
  }, 60_000);

  it("the parent gates' one question, the by-id update verdict, admits the row the by-id update admits", async () => {
    const rig = await bootSharing({ authored: true });
    try {
      // [#24646, ruling B] Flipped from "the gates' first question, record
      // sharing, still refuses": record sharing alone still refuses this row at
      // owner-only depth, and the gates no longer ask it. They ask explain's
      // record-grained by-id `update` verdict alone, which admits the row as the
      // by-id update does, and so the gate admits it.
      expect(await rig.checkEdit(AUTHORED_WRITER, 'l_theirs')).toBe('deny');
      const x = await rig.explain(AUTHORED_WRITER, 'update', 'l_theirs');
      expect(x.kind === 'decision' ? x.decision.record?.visible : x.kind, describeExplained(x)).toBe(true);
      expect(await rig.moderate(AUTHORED_WRITER, 'l_theirs')).toEqual({ kind: 'admitted' });
      expect(await rig.update(AUTHORED_WRITER, 'l_theirs')).toEqual({ kind: 'admitted' });

      // The control: a row the policy does not admit is refused by the update,
      // by its judgement and by the gate, the gate with its named refusal.
      const refusedByUpdate = await rig.update(AUTHORED_WRITER, 'l_unnamed');
      expect(refusedByUpdate.kind).toBe('refused');
      const y = await rig.explain(AUTHORED_WRITER, 'update', 'l_unnamed');
      expect(y.kind === 'decision' ? y.decision.record?.visible : y.kind, describeExplained(y)).toBe(false);
      const moderated = await rig.moderate(AUTHORED_WRITER, 'l_unnamed');
      expect(moderated.kind === 'refused' ? envelopeKeysOf(moderated) : moderated)
        .toStrictEqual({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
    } finally {
      await rig.teardown();
    }
  }, 60_000);

  it('the positive control: a row record sharing admits is admitted by the first question, by explain and by the door', async () => {
    const rig = await bootSharing({ authored: true });
    try {
      expect(await rig.checkEdit(AUTHORED_WRITER, 'l_mine')).toBe('allow');
      const x = await rig.explain(AUTHORED_WRITER, 'update', 'l_mine');
      expect(x.kind === 'decision' ? x.decision.record : x.kind, describeExplained(x))
        .toEqual({ recordId: 'l_mine', visible: true, decidedBy: 'rls' });
      expect(await rig.update(AUTHORED_WRITER, 'l_mine')).toEqual({ kind: 'admitted' });
    } finally {
      await rig.teardown();
    }
  }, 60_000);
});

/**
 * [#24646] The REAL `sys_comment` moderation gate on rig 4's services: removing
 * another person's comment on a parent record is admitted exactly where the
 * by-id update of that parent is, under a walled and a wall-less posture —
 * for the `org` writer ruling B admits, for a `controlled_by_parent` parent
 * judged through its master, and for an on-behalf-of caller, whose by-id write
 * the gate now judges by explain's delegated verdict (#24646 item 3). A
 * refusal names the parent (`RECORD_NOT_ACCESSIBLE`) to a caller who reads it
 * and answers the not-visible refusal (`PERMISSION_DENIED`) to one who does not.
 */
describe('the real comment moderation gate admits exactly what the parent by-id update admits', () => {
  /** What the gate answers: it admits, or it refuses with an envelope. */
  type GateAnswer = { kind: 'admitted' } | ({ kind: 'refused' } & Envelope);
  const NAMED: GateAnswer = { kind: 'refused', code: 'RECORD_NOT_ACCESSIBLE', status: 403 };
  const NOT_VISIBLE: GateAnswer = { kind: 'refused', code: 'PERMISSION_DENIED', status: 403 };
  type GateCell = [who: string, onBehalf: boolean, object: 'PARENT' | 'DETAIL', id: string, shape: string, gate: GateAnswer];
  const CELLS: GateCell[] = [
    [D_ORG, false, 'PARENT', 'p_theirs', 'the `org` writer, a row owned by someone else', { kind: 'admitted' }],
    [D_OWN, false, 'PARENT', 'p_own_mine', 'the `own` writer, its own row', { kind: 'admitted' }],
    [D_OWN, false, 'PARENT', 'p_theirs', 'the `own` writer, a row it cannot read', NOT_VISIBLE],
    [D_ORG, false, 'DETAIL', 'd_under_theirs', "the `org` writer, a detail under someone else's master", { kind: 'admitted' }],
    [D_OWN, false, 'DETAIL', 'd_under_org', "the `own` writer, a detail it reads under someone else's master", NAMED],
    [D_ORG, true, 'PARENT', 'p_theirs_created_by_org', 'an agent on behalf of the `org` writer, a row owned by someone else that it created', { kind: 'admitted' }],
    [D_ORG, true, 'PARENT', 'p_org_mine_created_by_other', 'an agent on behalf of the `org` writer, its own row someone else created', NAMED],
  ];
  for (const posture of ['isolated', 'single'] as const) {
    for (const [who, onBehalf, object, id, shape, gate] of CELLS) {
      it(`\`${posture}\` · ${shape} → ${gate.kind === 'admitted' ? 'admitted' : `refused ${gate.code} / ${gate.status}`}`, async () => {
        const rig = await sharedDelegatedRig(posture);
        const moderated = await rig.moderate(who, onBehalf, object, id);
        const updated = await rig.update(who, onBehalf, object, id);
        expect(moderated.kind === 'refused' ? { kind: 'refused', ...envelopeKeysOf(moderated) } : moderated).toStrictEqual(gate);
        expect(updated.kind, `the by-id update answered ${JSON.stringify(updated)}`).toBe(gate.kind);
      }, 60_000);
    }
  }
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20580] `security.explain`, explaining ANOTHER user, resolves that user in
 * the organization enforcement resolves them in.
 *
 * ## The defect
 *
 * An administrator explains a user in the administrator's own organization
 * (#20515). Enforcement, for that same user, first vets the organization their
 * session claims: under a walled posture a claim that no current membership
 * backs is dropped (#15409 ruling B), and the user resolves with NO active
 * organization, so only their global grants apply. The explainer never ran that
 * check. A member removed from `org_alpha` whose session still names it was
 * explained holding `org_alpha`'s grants, which enforcement no longer applies.
 *
 * Measured over this file's rig with the pre-fix resolution put back (this
 * fix's ablation), identically on both drivers and under both walled postures:
 *
 * | principal | explain `permissionSets` | explain `object_crud` | enforcement's sets | enforcement's read |
 * |---|---|---|---|---|
 * | removed from `org_alpha` | member_default, qa_probe_editor | grants | member_default | 403 `PERMISSION_DENIED` |
 * | current `org_alpha` member | member_default, qa_probe_editor | grants | member_default, qa_probe_editor | admitted |
 *
 * ## The rule pinned here
 *
 * The explainer asks `vetOrganizationClaim` (`@objectstack/core`), the one
 * function the session arm of `resolveAuthzContext` asks, whether the caller's
 * organization stands for the explained user, and resolves them where it says.
 * Every assertion below compares the two faces over the same stored rows: the
 * explanation, and the explained user's own request through the real resolver
 * and the real middleware.
 *
 * - Walled (`isolated`, `group`): the removed member's explanation lists no
 *   `org_alpha`-scoped set and its grant-driven verdict is enforcement's
 *   refusal. A current member's explanation is unchanged.
 * - `single`: there is no wall, enforcement keeps the claim, and so does the
 *   explanation. That is the posture condition of the same check, which is how
 *   this file tells "the check enforcement runs" from a rule of the explainer's
 *   own.
 *
 * ## The rig
 *
 * A real `ObjectQL` over a real driver (better-sqlite3 and sqlite-wasm, each a
 * fresh in-memory database per rig), the real platform object definitions, and
 * the real `SecurityPlugin` with a `tenancy` service naming the posture. The
 * question is answered above the SQL dialect, so no server-backed driver runs
 * here: the rig seeds platform tables under fixed ids, which a shared server
 * would carry from one run into the next. Enforcement's face is `resolveAuthzContext` with a
 * session that claims `org_alpha`, assembled by `assembleExecutionContext`,
 * then a `find` through the engine. `@objectstack/core` resolves through its
 * built `dist/` here, as this package's other suites read it.
 *
 * The probe object is platform-global (`tenancy: { enabled: false }`,
 * ADR-0066), so Layer 0 contributes nothing on either face and the verdict
 * compared is the one the grants decide. The explained context carries no organization of its own, which on
 * a tenant object under `isolated` is a separate explain-versus-enforce
 * position this card does not change.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
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

const ALPHA = 'org_alpha';
const BETA = 'org_beta';
/** An `org_alpha` member holding `manage_users` there: the caller who explains. */
const USER_ADMIN = 'usr_alpha_admin';
/** A current `org_alpha` member: the keep-pin. */
const USER_MEMBER = 'usr_alpha_member';
/** Removed from `org_alpha`, still a member of `org_beta`; the grant scoped to `org_alpha` was left behind. */
const USER_REMOVED = 'usr_alpha_removed';

/** The set the removed member held in `org_alpha`: the only grant of the probe object. */
const PROBE_SET = 'qa_probe_editor';

type Driver = { disconnect?: () => Promise<void> };
const DRIVERS: Array<[name: string, make: () => Driver]> = [
  ['driver-sql (better-sqlite3)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })],
  ['driver-sqlite-wasm', () => new SqliteWasmDriver({ filename: ':memory:' })],
];

let seq = 0;

async function boot(makeDriver: () => Driver, posture: TenancyPosture) {
  const n = `${process.pid}_${++seq}`;
  const PROBE = `qa_probe_20580_${n}`;
  const driver = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.explain-removed-member-20580-${seq}`,
    name: 'Explain: a member removed from the caller\'s organization',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
      {
        name: PROBE,
        label: 'Probe',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
        },
      },
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
  // The removal deleted the org_alpha membership row; the org_beta one remains.
  await e.insert('sys_member', { id: `mem_removed_${n}`, user_id: USER_REMOVED, organization_id: BETA, role: 'member' }, SYS);
  // The catalogue rows the grant rows point at (the resolver maps id → name);
  // what each set CONFERS is declared in metadata below.
  const catalogue = async (id: string, name: string) =>
    e.insert('sys_permission_set', {
      id, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    }, SYS);
  await catalogue(`ps_user_admin_${n}`, 'qa_user_admin');
  await catalogue(`ps_probe_${n}`, PROBE_SET);
  // Grant rows, each scoped to org_alpha. Removing a member deletes their
  // `sys_member` row, not their grants.
  await e.insert('sys_user_permission_set', {
    id: `ups_admin_${n}`, user_id: USER_ADMIN, permission_set_id: `ps_user_admin_${n}`, organization_id: ALPHA,
  }, SYS);
  for (const u of [USER_MEMBER, USER_REMOVED]) {
    await e.insert('sys_user_permission_set', {
      id: `ups_${u}_${n}`, user_id: u, permission_set_id: `ps_probe_${n}`, organization_id: ALPHA,
    }, SYS);
  }
  await e.insert(PROBE, { id: 'p1', name: 'probe row' }, SYS);

  const userAdminSet = PermissionSetSchema.parse({ name: 'qa_user_admin', objects: {}, systemPermissions: ['manage_users'] });
  const probeSet = PermissionSetSchema.parse({
    name: PROBE_SET,
    objects: { [PROBE]: { allowRead: true } },
    systemPermissions: ['manage_metadata'],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, userAdminSet, probeSet],
    },
    tenancy: { posture },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    // The plugin's lifecycle hooks are collected and never fired: nothing on
    // either face depends on them, and a bootstrap left running would race the
    // engine teardown.
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

  /** Enforcement's context for `userId`, whose session claims `org_alpha`: the real resolver and assembler. */
  const enforced = async (userId: string) => {
    const authz = await resolveAuthzContext({
      ql: engine,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `sess_${userId}_${n}`, userId, activeOrganizationId: ALPHA },
      }),
      tenancyPosture: posture,
    });
    return assembleExecutionContext({
      authz, oauth: undefined, localization: undefined, requestLocale: undefined, accessToken: undefined,
    } as never)!;
  };
  const admin = await enforced(USER_ADMIN);

  /** Face 1: the service method `POST /api/v1/security/explain` calls, the `org_alpha` admin explaining `userId`. */
  const explain = (userId: string): Promise<ExplainDecision> =>
    plugin.explainAccessForCaller({ object: PROBE, operation: 'read', userId }, admin);

  /** Face 2: what enforcement resolves for `userId`, and what their own read of the probe object answers. */
  const enforce = async (userId: string) => {
    const context = await enforced(userId);
    const sets = (await security.resolvePermissionSetsForContext(context)).map((s) => s.name);
    const read = await (engine.find(PROBE, { context } as never) as Promise<unknown[]>).then(
      (rows) => ({ admitted: rows.length }),
      (err: { code?: string; statusCode?: number; status?: number }) =>
        ({ code: String(err?.code), status: Number(err?.statusCode ?? err?.status) }),
    );
    return { tenantId: context.tenantId, sets, read };
  };

  const teardown = async () => {
    try { await engine.destroy(); } catch { /* noop */ }
  };
  return { admin, explain, enforce, teardown };
}

type Rig = Awaited<ReturnType<typeof boot>>;

/** Resolution order is not what is compared: the two faces build different contexts. */
const sorted = (xs: readonly string[] | undefined) => [...(xs ?? [])].sort();
const crudOf = (d: ExplainDecision) => d.layers.find((l) => l.layer === 'object_crud')?.verdict;
const DENIED = { code: 'PERMISSION_DENIED', status: 403 };

/**
 * One rig per driver × posture, booted once: every case below only READS.
 * `console.warn` is held for the whole block because the resolver's own
 * dropped-claim line (the session arm's decision point) is part of what the
 * precondition asserts.
 */
function withRig(makeDriver: () => Driver, posture: TenancyPosture) {
  const state: { rig?: Rig; warn?: { mock: { calls: unknown[][] }; mockRestore: () => void } } = {};
  beforeAll(async () => {
    state.warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.rig = await boot(makeDriver, posture);
  }, 120_000);
  afterAll(async () => {
    await state.rig?.teardown();
    state.warn?.mockRestore();
  });
  return {
    rig: () => state.rig!,
    droppedClaimLines: () =>
      (state.warn?.mock.calls ?? [])
        .map((args: unknown[]) => String(args[0]))
        .filter((line: string) => line.includes('Session organization claim dropped')),
  };
}

describe.each(DRIVERS)('[#20580] %s', (_driver, makeDriver) => {
  describe.each(['isolated', 'group'] as const)('walled posture `%s`: the explainer resolves the user where enforcement does', (posture) => {
    const r = withRig(makeDriver, posture);

    it('precondition: enforcement drops the removed member\'s org_alpha claim, and keeps the current member\'s', async () => {
      const removed = await r.rig().enforce(USER_REMOVED);
      const member = await r.rig().enforce(USER_MEMBER);
      expect(removed.tenantId).toBeUndefined();
      expect(r.droppedClaimLines().some((line: string) => line.includes(USER_REMOVED))).toBe(true);
      expect(member.tenantId).toBe(ALPHA);
      // The set is resolvable at all: without this, the negative pins below
      // would pass for want of a grant, not because the claim was vetted.
      expect(member.sets).toContain(PROBE_SET);
      expect(r.rig().admin.tenantId).toBe(ALPHA);
    });

    it('the removed member\'s explanation lists no org_alpha-scoped set: exactly the sets enforcement resolves for them', async () => {
      const d = await r.rig().explain(USER_REMOVED);
      const enforcement = await r.rig().enforce(USER_REMOVED);
      expect(d.principal.userId).toBe(USER_REMOVED);
      expect(d.principal.permissionSets).not.toContain(PROBE_SET);
      expect(sorted(d.principal.permissionSets)).toEqual(sorted(enforcement.sets));
    });

    it('the removed member\'s grant-driven verdict is enforcement\'s refusal: object_crud denies, and their own read is 403', async () => {
      const d = await r.rig().explain(USER_REMOVED);
      const enforcement = await r.rig().enforce(USER_REMOVED);
      expect(enforcement.read).toEqual(DENIED);
      expect(crudOf(d)).toBe('denies');
      expect(d.allowed).toBe(false);
    });

    it('KEEP · a current member\'s explanation is unchanged: the org_alpha-scoped set is listed, as enforcement resolves it', async () => {
      const d = await r.rig().explain(USER_MEMBER);
      const enforcement = await r.rig().enforce(USER_MEMBER);
      expect(d.principal.permissionSets).toContain(PROBE_SET);
      expect(sorted(d.principal.permissionSets)).toEqual(sorted(enforcement.sets));
    });

    it('KEEP · a current member\'s verdict is granted on both faces', async () => {
      const d = await r.rig().explain(USER_MEMBER);
      const enforcement = await r.rig().enforce(USER_MEMBER);
      expect(enforcement.read).toEqual({ admitted: 1 });
      expect(crudOf(d)).toBe('grants');
      expect(d.allowed).toBe(true);
    });
  });

  describe('CONTROL · posture `single`: no wall, so enforcement keeps the claim, and so does the explanation', () => {
    const r = withRig(makeDriver, 'single');

    it('the removed member keeps org_alpha on both faces: the set is listed and the read is granted', async () => {
      const d = await r.rig().explain(USER_REMOVED);
      const enforcement = await r.rig().enforce(USER_REMOVED);
      expect(enforcement.tenantId).toBe(ALPHA);
      expect(r.droppedClaimLines()).toEqual([]);
      expect(enforcement.read).toEqual({ admitted: 1 });
      expect(d.principal.permissionSets).toContain(PROBE_SET);
      expect(sorted(d.principal.permissionSets)).toEqual(sorted(enforcement.sets));
      expect(crudOf(d)).toBe('grants');
    });
  });
});

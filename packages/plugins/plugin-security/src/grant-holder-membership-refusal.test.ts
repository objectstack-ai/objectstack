// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `sys_user_position` or `sys_user_permission_set` row scoped to an
 * organization may name only a user who holds a `sys_member` row in THAT
 * organization. A non-system insert or update that would store any other user
 * is refused — `400 VALIDATION_FAILED`, `reference_not_found` at `user_id` —
 * for every caller, a platform administrator included. A system write stands
 * down, and a row with no organization (a global grant) is outside the
 * predicate.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` registered on it the way a kernel composition does: the
 * refusal is a pair of engine hooks, and what it judges is the organization the
 * row is STORED with — which, for a row that names none, is the stamp the
 * driver writes from the caller's active organization after the hooks have run.
 * Every positive control below therefore reads the stored row back.
 *
 * Every refusal is identified by its ADR-0112 envelope — `status`, `code` and
 * `fields[0].code` read through `resolveThrownHttpError`, the resolver both
 * HTTP doors answer with — never by a bare `toThrow()`, which stays green when a
 * different refusal fires first.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { PermissionSet } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import {
  GRANT_HOLDER_MEMBERSHIP_HOOK_PACKAGE,
  registerGrantHolderMembershipRefusal,
} from './grant-holder-membership-refusal.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const MEMBER_DEFAULT = { name: 'member_default', label: 'Member', objects: {} } as unknown as PermissionSet;

/** The superuser wildcard: the delegated-admin gate admits it, CRUD admits it. */
const QA_ADMIN = {
  name: 'qa_admin',
  label: 'QA Admin',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
} as unknown as PermissionSet;

/** The wildcard with an explicit per-table deny on both grant tables: the CRUD check refuses it. */
const QA_READ_ONLY_ON_GRANTS = {
  name: 'qa_read_only_on_grants',
  label: 'QA read-only on grants',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
    sys_user_position: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    sys_user_permission_set: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
} as unknown as PermissionSet;

const SYS = { isSystem: true } as const;
const ORG_A = 'org_a';
const ORG_B = 'org_b';

/** A platform administrator whose active organization is org_a — the card's writer. */
const PLATFORM_ADMIN_A = {
  userId: 'u_platform', positions: [], permissions: ['qa_admin'], posture: 'PLATFORM_ADMIN', tenantId: ORG_A,
};
/** An administrator of org_a that the delegated-admin gate admits (no platform rung). */
const ADMIN_A = { userId: 'u_admin_a', positions: [], permissions: ['qa_admin'], tenantId: ORG_A };
/** A caller the CRUD check refuses on both grant tables. */
const READ_ONLY_A = { userId: 'u_ro_a', positions: [], permissions: ['qa_read_only_on_grants'], tenantId: ORG_A };

/** u_member_a belongs to org_a; u_member_b belongs to org_b only; u_both to both. */
const MEMBERSHIPS = [
  { id: 'm_a', user_id: 'u_member_a', organization_id: ORG_A, role: 'member' },
  { id: 'm_a2', user_id: 'u_member_a2', organization_id: ORG_A, role: 'member' },
  { id: 'm_b', user_id: 'u_member_b', organization_id: ORG_B, role: 'member' },
  { id: 'm_both_a', user_id: 'u_both', organization_id: ORG_A, role: 'member' },
  { id: 'm_both_b', user_id: 'u_both', organization_id: ORG_B, role: 'member' },
];

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface BootOptions {
  /** `isolated` posture (the organization wall armed) instead of `single`. */
  walled?: boolean;
  /**
   * `sys_member`: provisioned (default); `false` registers no membership
   * object at all; `'unprovisioned'` registers it with no table behind it, so
   * every membership read fails.
   */
  members?: boolean | 'unprovisioned';
}

async function boot(opts: BootOptions = {}) {
  const withMembers = opts.members === undefined || opts.members === true;
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.grant-holder-membership-refusal',
    name: 'Grant holder membership refusal',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet,
      ...(withMembers ? [SysMember] : []),
    ],
  } as any);
  await engine.syncSchemas();
  // `sys_user` stays registered and unprovisioned, as in the sibling suites:
  // the engine's own `user_id` existence probe then cannot run and stands
  // down, so what is measured here is the membership predicate alone.
  if (!engine.registry.getObject(SysUser.name)) engine.registry.registerObject(SysUser as never, 'qa.authz-read-set');
  if (opts.members === 'unprovisioned') engine.registry.registerObject(SysMember as never, 'qa.authz-read-set');
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, QA_ADMIN, QA_READ_ONLY_ON_GRANTS],
    },
    ...(opts.walled
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture: 'isolated' } }
      : {}),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    // Lifecycle hooks are collected and never fired: the fixture seeds every
    // row it reads itself.
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  // The catalog the rows name, seeded where every writer reads it: a position
  // and a permission set with no organization.
  await engine.insert('sys_position', [
    { id: 'pos_rep', name: 'qa_rep', label: 'Rep', active: true },
    { id: 'pos_lead', name: 'qa_lead', label: 'Lead', active: true },
  ], { context: SYS } as any);
  await engine.insert('sys_permission_set', {
    id: 'ps_rep', name: 'qa_rep_set', label: 'QA Rep', object_permissions: '{}', field_permissions: '{}',
    system_permissions: '[]', active: true,
  }, { context: SYS } as any);
  if (withMembers) {
    for (const m of MEMBERSHIPS) {
      await engine.insert('sys_member', m, { context: { isSystem: true, tenantId: m.organization_id } } as any);
    }
  }
  return { engine, ctx };
}

type Harness = Awaited<ReturnType<typeof boot>>;

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

/** The ADR-0112 envelope an HTTP door answers this throw with. */
function envelopeOf(e: unknown) {
  const r = resolveThrownHttpError(e);
  return { status: r.status, code: r.code, fields: (r.details?.fields ?? []) as any[] };
}

async function rowsOf(h: Harness, object: string, where: Record<string, unknown>): Promise<any[]> {
  const rows = await h.engine.find(object, { where, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

/** The refusal's identifying triple, asserted on every negative pin. */
function expectMembershipRefusal(err: unknown, label?: string) {
  const env = envelopeOf(err);
  expect(env.status, label).toBe(400);
  expect(env.code, label).toBe('VALIDATION_FAILED');
  expect(env.fields.length, label).toBeGreaterThanOrEqual(1);
  expect(env.fields[0]?.code, label).toBe('reference_not_found');
  expect(env.fields[0]?.field, label).toBe('user_id');
}

// ---------------------------------------------------------------------------
// sys_user_position — the card's measured door
// ---------------------------------------------------------------------------

describe('sys_user_position: the holder must be a member of the row organization', () => {
  it("a platform administrator's insert of a user who belongs only to another organization is refused; the row is absent", async () => {
    const h = await boot({ walled: true });
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_member_b', position: 'qa_rep' }, { context: PLATFORM_ADMIN_A } as any,
    ));
    expectMembershipRefusal(err);
    expect(await rowsOf(h, 'sys_user_position', { user_id: 'u_member_b' })).toHaveLength(0);
  });

  it('positive control: the same insert of a member succeeds, stored in the organization that was judged', async () => {
    const h = await boot({ walled: true });
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_member_a', position: 'qa_rep' }, { context: PLATFORM_ADMIN_A } as any,
    );
    expect(created).toMatchObject({ user_id: 'u_member_a', position: 'qa_rep' });
    const [row] = await rowsOf(h, 'sys_user_position', { user_id: 'u_member_a' });
    expect(row?.organization_id).toBe(ORG_A);
  });

  it('an explicit organization_id naming the writer\'s own organization is judged the same way', async () => {
    const h = await boot({ walled: true });
    expectMembershipRefusal(await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_member_b', position: 'qa_rep', organization_id: ORG_A }, { context: ADMIN_A } as any,
    )));
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_both', position: 'qa_rep', organization_id: ORG_A }, { context: ADMIN_A } as any,
    );
    expect(created).toMatchObject({ user_id: 'u_both', organization_id: ORG_A });
  });

  it('a batch insert with one non-member row is refused whole; nothing is stored', async () => {
    const h = await boot({ walled: true });
    const err = await refusalOf(() => h.engine.insert('sys_user_position', [
      { user_id: 'u_member_a', position: 'qa_rep' },
      { user_id: 'u_member_b', position: 'qa_rep' },
    ], { context: ADMIN_A } as any));
    expectMembershipRefusal(err);
    expect(await rowsOf(h, 'sys_user_position', { user_id: 'u_member_a' })).toHaveLength(0);
    expect(await rowsOf(h, 'sys_user_position', { user_id: 'u_member_b' })).toHaveLength(0);
  });

  it('an update by id that moves user_id to a non-member is refused; the stored row is untouched', async () => {
    const h = await boot({ walled: true });
    await h.engine.insert('sys_user_position', { id: 'up1', user_id: 'u_member_a', position: 'qa_rep' }, { context: ADMIN_A } as any);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_position', { id: 'up1', user_id: 'u_member_b' }, { context: PLATFORM_ADMIN_A } as any,
    ));
    expectMembershipRefusal(err);
    const [row] = await rowsOf(h, 'sys_user_position', { id: 'up1' });
    expect(row?.user_id).toBe('u_member_a');
  });

  it('positive control: an update by id that moves user_id to another member lands', async () => {
    const h = await boot({ walled: true });
    await h.engine.insert('sys_user_position', { id: 'up2', user_id: 'u_member_a', position: 'qa_rep' }, { context: ADMIN_A } as any);
    await h.engine.update('sys_user_position', { id: 'up2', user_id: 'u_member_a2' }, { context: ADMIN_A } as any);
    const [row] = await rowsOf(h, 'sys_user_position', { id: 'up2' });
    expect(row?.user_id).toBe('u_member_a2');
  });

  it('a predicate (multi) update that moves user_id to a non-member is refused; no matched row changes', async () => {
    const h = await boot({ walled: true });
    await h.engine.insert('sys_user_position', [
      { id: 'upm1', user_id: 'u_member_a', position: 'qa_rep', reason: 'batch' },
      { id: 'upm2', user_id: 'u_member_a2', position: 'qa_lead', reason: 'batch' },
    ], { context: ADMIN_A } as any);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_position', { user_id: 'u_member_b' }, { where: { reason: 'batch' }, multi: true, context: ADMIN_A } as any,
    ));
    expectMembershipRefusal(err);
    const rows = await rowsOf(h, 'sys_user_position', { reason: 'batch' });
    expect(rows.map((r) => r.user_id).sort()).toEqual(['u_member_a', 'u_member_a2']);
  });

  it('an update that leaves the holder and the organization alone is not judged — a stored row of a departed holder stays editable', async () => {
    const h = await boot({ walled: true });
    // A row written where it is not judged (a system write) for a non-member.
    await h.engine.insert('sys_user_position',
      { id: 'fossil', user_id: 'u_member_b', position: 'qa_rep', organization_id: ORG_A },
      { context: { isSystem: true, tenantId: ORG_A } } as any);
    await h.engine.update('sys_user_position', { id: 'fossil', reason: 'end-dated' }, { context: ADMIN_A } as any);
    await h.engine.update('sys_user_position', { id: 'fossil', user_id: 'u_member_b', reason: 'echoed' }, { context: ADMIN_A } as any);
    const [row] = await rowsOf(h, 'sys_user_position', { id: 'fossil' });
    expect(row).toMatchObject({ user_id: 'u_member_b', reason: 'echoed' });
  });

  it('a system write is not refused (seed replay, invitation acceptance, platform bootstraps)', async () => {
    const h = await boot({ walled: true });
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_member_b', position: 'qa_rep', organization_id: ORG_A },
      { context: { isSystem: true, tenantId: ORG_A } } as any,
    );
    expect(created).toMatchObject({ user_id: 'u_member_b', organization_id: ORG_A });
  });

  it('authorization first: a caller who may not write the table gets 403 whether or not the user is a member', async () => {
    const h = await boot({ walled: true });
    for (const userId of ['u_member_b', 'u_member_a']) {
      const env = envelopeOf(await refusalOf(() => h.engine.insert(
        'sys_user_position', { user_id: userId, position: 'qa_rep' }, { context: READ_ONLY_A } as any,
      )));
      expect([env.code, env.status], userId).toEqual(['PERMISSION_DENIED', 403]);
    }
  });
});

// ---------------------------------------------------------------------------
// sys_user_permission_set — the sibling junction, the same class
// ---------------------------------------------------------------------------

describe('sys_user_permission_set: an organization-scoped grant takes the same predicate', () => {
  it("a platform administrator's organization-scoped grant to a non-member is refused; the row is absent", async () => {
    const h = await boot({ walled: true });
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_member_b', permission_set_id: 'ps_rep' }, { context: PLATFORM_ADMIN_A } as any,
    ));
    expectMembershipRefusal(err);
    expect(await rowsOf(h, 'sys_user_permission_set', { user_id: 'u_member_b' })).toHaveLength(0);
  });

  it('positive control: the same grant to a member succeeds, stored in the organization that was judged', async () => {
    const h = await boot({ walled: true });
    await h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_member_a', permission_set_id: 'ps_rep' }, { context: PLATFORM_ADMIN_A } as any,
    );
    const [row] = await rowsOf(h, 'sys_user_permission_set', { user_id: 'u_member_a' });
    expect(row?.organization_id).toBe(ORG_A);
  });

  it('an update by id that moves user_id to a non-member is refused; the stored row is untouched', async () => {
    const h = await boot({ walled: true });
    await h.engine.insert('sys_user_permission_set', { id: 'ups1', user_id: 'u_member_a', permission_set_id: 'ps_rep' }, { context: ADMIN_A } as any);
    expectMembershipRefusal(await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { id: 'ups1', user_id: 'u_member_b' }, { context: ADMIN_A } as any,
    )));
    const [row] = await rowsOf(h, 'sys_user_permission_set', { id: 'ups1' });
    expect(row?.user_id).toBe('u_member_a');
  });

  it('a grant with NO organization is global and is never judged by membership', async () => {
    // Under `single`, a writer with no active organization stores no
    // organization at all: the row applies in every organization context and
    // names none to be a member of.
    const h = await boot();
    const NO_ORG_ADMIN = { userId: 'u_admin', positions: [], permissions: ['qa_admin'] };
    await h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_nobody', permission_set_id: 'ps_rep' }, { context: NO_ORG_ADMIN } as any,
    );
    const [row] = await rowsOf(h, 'sys_user_permission_set', { user_id: 'u_nobody' });
    expect(row?.organization_id ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The `single` posture — a stock deployment is unaffected
// ---------------------------------------------------------------------------

describe('single posture', () => {
  it('a writer whose active organization holds the user (what the auto membership policy binds every user to) is accepted', async () => {
    const h = await boot();
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_member_a', position: 'qa_rep' }, { context: ADMIN_A } as any,
    );
    expect(created).toMatchObject({ user_id: 'u_member_a' });
    const [row] = await rowsOf(h, 'sys_user_position', { user_id: 'u_member_a' });
    expect(row?.organization_id).toBe(ORG_A);
  });

  it('a writer with no active organization stores an organization-less row, which is not judged', async () => {
    const h = await boot();
    const NO_ORG_ADMIN = { userId: 'u_admin', positions: [], permissions: ['qa_admin'] };
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_nobody', position: 'qa_rep' }, { context: NO_ORG_ADMIN } as any,
    );
    expect(created).toMatchObject({ user_id: 'u_nobody' });
  });

  it('the predicate is the same on every posture: an organization-scoped row naming a non-member is refused', async () => {
    const h = await boot();
    expectMembershipRefusal(await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_member_b', position: 'qa_rep' }, { context: ADMIN_A } as any,
    )));
  });

  it('a membership read that fails refuses the write rather than admitting it unchecked', async () => {
    const h = await boot({ members: 'unprovisioned' });
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_member_a', position: 'qa_rep' }, { context: ADMIN_A } as any,
    ));
    // Not the membership verdict — the read never answered, so no verdict is claimed.
    expect(envelopeOf(err).code).not.toBe('VALIDATION_FAILED');
    expect(await rowsOf(h, 'sys_user_position', { user_id: 'u_member_a' })).toHaveLength(0);
  });

  it('a composition with no membership object registered has no membership to judge, and stands down', async () => {
    const h = await boot({ members: false });
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_member_b', position: 'qa_rep' }, { context: ADMIN_A } as any,
    );
    expect(created).toMatchObject({ user_id: 'u_member_b' });
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('both hooks bind under one package when the plugin starts, and a re-registration replaces them', async () => {
    const h = await boot();
    expect(registerGrantHolderMembershipRefusal(h.engine as any)).toBe(true);
    expect((h.engine as any).unregisterHooksByPackage(GRANT_HOLDER_MEMBERSHIP_HOOK_PACKAGE)).toBe(2);
  });

  it('an engine with no hook registry is reported, not silently left unguarded', () => {
    const warn = vi.fn();
    expect(registerGrantHolderMembershipRefusal({} as any, { warn })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

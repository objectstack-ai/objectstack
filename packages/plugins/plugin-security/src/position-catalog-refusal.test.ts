// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `sys_user_position` write whose `position` names no `sys_position` row is
 * refused — `400 VALIDATION_FAILED`, `reference_not_found` at `position` —
 * instead of answering 201 over an assignment that resolves to nothing.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` registered on it the way a kernel composition does, because
 * the refusal is an engine middleware whose whole contract is WHERE it runs in
 * that chain: inside the security middleware, after authorization.
 *
 * Every refusal is identified by its ADR-0112 envelope — `code` and `status`,
 * read through `resolveThrownHttpError`, the resolver both HTTP doors answer
 * with — never by a bare `toThrow()`: a throw-shaped assertion stays green when
 * a DIFFERENT refusal fires first, and on this table the delegated-admin gate
 * is always one step earlier.
 *
 * The ruling this executes keeps a CONTROL LEG, and so does this suite: the
 * same account that an id-spelled assignment leaves reading nothing reads rows
 * the moment it holds the same permission set through a direct
 * `sys_user_permission_set` grant. Without that leg "the account reads nothing"
 * and "the permission set is misconfigured" are one observation again.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { resolveThrownHttpError } from '@objectstack/types';
import type { PermissionSet } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { positionNotInCatalogMessage } from './position-catalog-refusal.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** The fallback every authenticated caller resolves: it grants nothing here. */
const MEMBER_DEFAULT = {
  name: 'member_default',
  label: 'Member',
  objects: {},
} as unknown as PermissionSet;

/** A tenant-level administrator (ADR-0066 superuser wildcard): the gate admits it, CRUD admits it. */
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

/**
 * The `organization_admin` shape: the superuser wildcard (so the delegated-admin
 * gate admits it) with an EXPLICIT per-table deny on the assignment table (so
 * the CRUD check refuses it). A caller the platform will not let write this
 * table must never learn anything from the catalog.
 */
const QA_ORG_ADMIN_LIKE = {
  name: 'qa_org_admin_like',
  label: 'QA Org Admin (read-only on RBAC)',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
    sys_user_position: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
} as unknown as PermissionSet;

const QA_INQUIRY = {
  name: 'qa_inquiry',
  label: 'Inquiry',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    subject: { name: 'subject', type: 'text' },
  },
};

const SYS = { isSystem: true } as const;
const ADMIN = { userId: 'u_admin', positions: [], permissions: ['qa_admin'] };
const ORG_ADMIN_LIKE = { userId: 'u_org_admin', positions: [], permissions: ['qa_org_admin_like'] };
const PLAIN_MEMBER = { userId: 'u_member', positions: [], permissions: [] };

/** The auditor position's catalog row — the row whose ID the measured authors wrote. */
const AUDITOR_POSITION_ID = 'position_mtur8hz5jp7ptm3r';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(opts: { walled?: boolean } = {}) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.position-catalog-refusal',
    name: 'Position catalog refusal',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet, QA_INQUIRY],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);

  const warn = vi.fn();
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, QA_ADMIN, QA_ORG_ADMIN_LIKE],
    },
    ...(opts.walled
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture: 'isolated' } }
      : {}),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
    // Lifecycle hooks are collected and never fired: the fixture seeds every
    // row it reads itself, and a boot-time bootstrap racing the suite's own
    // writes (and its teardown) would only add noise to what is measured.
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

  // A walled posture refuses an organization-less system write on a
  // tenant-scoped object, so the fixture is seeded INTO org_a there.
  const seed = opts.walled ? { isSystem: true, tenantId: 'org_a' } : SYS;

  // The catalog, the one DB-authored set it distributes, and three rows it reads.
  await engine.insert('sys_permission_set', {
    id: 'ps_auditor',
    name: 'qa_auditor_set',
    label: 'QA Auditor',
    object_permissions: JSON.stringify({ qa_inquiry: { allowRead: true, viewAllRecords: true } }),
    field_permissions: '{}',
    system_permissions: '[]',
    active: true,
  }, { context: seed } as any);
  await engine.insert('sys_position', [
    { id: AUDITOR_POSITION_ID, name: 'qa_auditor', label: 'Auditor', active: true },
    // ADR-0049 shape E: deactivated, still a catalog row, still bound.
    { id: 'pos_retired', name: 'qa_retired', label: 'Retired', active: false },
  ], { context: seed } as any);
  await engine.insert('sys_position_permission_set', [
    { id: 'pps_auditor', position_id: AUDITOR_POSITION_ID, permission_set_id: 'ps_auditor' },
    { id: 'pps_retired', position_id: 'pos_retired', permission_set_id: 'ps_auditor' },
  ], { context: seed } as any);
  await engine.insert('qa_inquiry', [
    { id: 'inq_1', subject: 'one' },
    { id: 'inq_2', subject: 'two' },
    { id: 'inq_3', subject: 'three' },
  ], { context: seed } as any);

  return { engine, warn };
}

type Harness = Awaited<ReturnType<typeof boot>>;

/** What an account reads of `qa_inquiry`, through the real resolver and the real middleware. */
async function rowsReadBy(h: Harness, userId: string): Promise<number> {
  const g = await resolveUserAuthzGrants(h.engine, userId);
  try {
    const rows = await h.engine.find('qa_inquiry', {
      context: { userId, positions: g.positions, permissions: g.permissions },
    });
    return Array.isArray(rows) ? rows.length : 0;
  } catch (e: any) {
    // An account holding nothing on the object is refused the read outright;
    // for this suite that is "reads nothing", the card's observation.
    if (e?.code === 'PERMISSION_DENIED') return 0;
    throw e;
  }
}

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

async function assignmentsOf(h: Harness, userId: string): Promise<any[]> {
  const rows = await h.engine.find('sys_user_position', { where: { user_id: userId }, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

// ---------------------------------------------------------------------------
// The refusal, and the ruling's control leg
// ---------------------------------------------------------------------------

describe('a position spelled as the catalog row ID is refused, and the account is provably fine', () => {
  it('refuses 400 VALIDATION_FAILED, reference_not_found at position, naming the value and the name to write', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_holder', position: AUDITOR_POSITION_ID }, { context: ADMIN } as any,
    ));
    const env = envelopeOf(err);
    expect(env.code).toBe('VALIDATION_FAILED');
    expect(env.status).toBe(400);
    expect(env.fields).toHaveLength(1);
    expect(env.fields[0]).toMatchObject({
      field: 'position',
      code: 'reference_not_found',
      value: AUDITOR_POSITION_ID,
      constraint: { target: 'sys_position', targetField: 'name' },
    });
    // The fix is the exact name — the value is that position's record id.
    expect(env.fields[0].message).toBe(positionNotInCatalogMessage(AUDITOR_POSITION_ID, 'qa_auditor'));
    expect(env.fields[0].message).toContain(`write 'qa_auditor'`);

    // Nothing was stored, and the account reads nothing …
    expect(await assignmentsOf(h, 'u_holder')).toHaveLength(0);
    expect(await rowsReadBy(h, 'u_holder')).toBe(0);

    // … CONTROL LEG, same account: a direct grant of the set the position
    // distributes reads rows at once, so the account, the set and the object
    // are fine — the refused edge was the whole difference.
    await h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_holder', permission_set_id: 'ps_auditor' }, { context: ADMIN } as any,
    );
    expect(await rowsReadBy(h, 'u_holder')).toBe(3);
  });

  it('refuses a name no catalog row carries, with the generic remedy', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_holder', position: 'totally_not_a_position' }, { context: ADMIN } as any,
    ));
    const env = envelopeOf(err);
    expect(env.code).toBe('VALIDATION_FAILED');
    expect(env.status).toBe(400);
    expect(env.fields.map((f) => [f.field, f.code, f.value])).toEqual([
      ['position', 'reference_not_found', 'totally_not_a_position'],
    ]);
    expect(env.fields[0].message).toBe(positionNotInCatalogMessage('totally_not_a_position'));
    expect(await assignmentsOf(h, 'u_holder')).toHaveLength(0);
  });
});

describe('the accepted half — a catalog NAME, active or deactivated', () => {
  it('a catalog name is accepted and resolves: the holder reads rows', async () => {
    const h = await boot();
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_named', position: 'qa_auditor' }, { context: ADMIN } as any,
    );
    expect(created).toMatchObject({ user_id: 'u_named', position: 'qa_auditor' });
    expect(await rowsReadBy(h, 'u_named')).toBe(3);
  });

  it('ADR-0049 shape E: a DEACTIVATED position is still a catalog row — accepted, stored, and grants nothing', async () => {
    const h = await boot();
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_retired', position: 'qa_retired' }, { context: ADMIN } as any,
    );
    expect(created).toMatchObject({ position: 'qa_retired' });
    expect(await assignmentsOf(h, 'u_retired')).toHaveLength(1);
    // It stops granting (the resolver drops the deactivated name) — it is not refused.
    expect(await rowsReadBy(h, 'u_retired')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Every write shape that stores a new name
// ---------------------------------------------------------------------------

describe('every non-system write that stores a new position name is judged', () => {
  it('a batch insert with one bad row is refused whole, naming only the bad value; nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert('sys_user_position', [
      { user_id: 'u_b1', position: 'qa_auditor' },
      { user_id: 'u_b2', position: 'nope_position' },
    ], { context: ADMIN } as any));
    const env = envelopeOf(err);
    expect(env.code).toBe('VALIDATION_FAILED');
    expect(env.status).toBe(400);
    expect(env.fields.map((f) => [f.field, f.code, f.value])).toEqual([
      ['position', 'reference_not_found', 'nope_position'],
    ]);
    expect(await assignmentsOf(h, 'u_b1')).toHaveLength(0);
    expect(await assignmentsOf(h, 'u_b2')).toHaveLength(0);
  });

  it('an update by id that CHANGES position to an unknown name is refused; the stored row is untouched', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_position', { id: 'upa', user_id: 'u_up', position: 'qa_auditor' }, { context: ADMIN } as any);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_position', { id: 'upa', position: AUDITOR_POSITION_ID }, { context: ADMIN } as any,
    ));
    const env = envelopeOf(err);
    expect(env.code).toBe('VALIDATION_FAILED');
    expect(env.status).toBe(400);
    expect(env.fields[0]).toMatchObject({ field: 'position', code: 'reference_not_found', value: AUDITOR_POSITION_ID });
    expect((await assignmentsOf(h, 'u_up'))[0]?.position).toBe('qa_auditor');
  });

  it('a predicate update (multi) setting an unknown name is refused', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_position', { id: 'upm', user_id: 'u_multi', position: 'qa_auditor' }, { context: ADMIN } as any);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_position', { position: 'nope_position' }, { where: { user_id: 'u_multi' }, multi: true, context: ADMIN } as any,
    ));
    const env = envelopeOf(err);
    expect(env.code).toBe('VALIDATION_FAILED');
    expect(env.status).toBe(400);
    expect(env.fields[0]).toMatchObject({ field: 'position', code: 'reference_not_found', value: 'nope_position' });
    expect((await assignmentsOf(h, 'u_multi'))[0]?.position).toBe('qa_auditor');
  });

  it('an update that does not change position is not judged — a stored fossil stays editable', async () => {
    const h = await boot();
    // A row that predates the refusal, written where it is not judged (a system write).
    await h.engine.insert('sys_user_position', { id: 'fossil', user_id: 'u_fossil', position: 'gone_position' }, { context: SYS } as any);
    // Editing another column, with and without the unchanged value echoed back.
    await h.engine.update('sys_user_position', { id: 'fossil', reason: 'edited' }, { context: ADMIN } as any);
    await h.engine.update('sys_user_position', { id: 'fossil', position: 'gone_position', reason: 'echoed' }, { context: ADMIN } as any);
    const [row] = await assignmentsOf(h, 'u_fossil');
    expect(row).toMatchObject({ position: 'gone_position', reason: 'echoed' });
  });
});

// ---------------------------------------------------------------------------
// Scope: what it does NOT judge, pinned so the stand-down stays deliberate
// ---------------------------------------------------------------------------

describe('scope — the stand-downs are declared, not accidental', () => {
  it('an isSystem write is not judged (seed loader, invitation acceptance, platform bootstraps)', async () => {
    const h = await boot();
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_sys', position: 'not_in_catalog' }, { context: SYS } as any,
    );
    expect(created).toMatchObject({ position: 'not_in_catalog' });
  });

  it('authorization first: a caller who may not write the table gets 403, never the catalog verdict', async () => {
    const h = await boot();
    for (const [caller, missingName] of [
      [PLAIN_MEMBER, 'nope_position'],
      [ORG_ADMIN_LIKE, 'nope_position'],
    ] as const) {
      const err = await refusalOf(() => h.engine.insert(
        'sys_user_position', { user_id: 'u_x', position: missingName }, { context: caller } as any,
      ));
      const env = envelopeOf(err);
      expect(env.code, `caller ${caller.userId}`).toBe('PERMISSION_DENIED');
      expect(env.status, `caller ${caller.userId}`).toBe(403);
      // The identical write naming a REAL position is refused identically —
      // the answer does not depend on the catalog.
      const same = envelopeOf(await refusalOf(() => h.engine.insert(
        'sys_user_position', { user_id: 'u_x', position: 'qa_auditor' }, { context: caller } as any,
      )));
      expect([same.code, same.status]).toEqual([env.code, env.status]);
    }
  });
});

// ---------------------------------------------------------------------------
// A walled, two-organization posture
// ---------------------------------------------------------------------------

describe('walled posture, two organizations — the literal predicate, measured', () => {
  async function bootTwoOrgs() {
    const h = await boot({ walled: true });
    await h.engine.insert('sys_position',
      { id: 'pos_b_only', name: 'qa_b_only', label: 'B only', active: true },
      { context: { isSystem: true, tenantId: 'org_b' } } as any);
    await h.engine.insert('sys_position',
      { id: 'pos_a_own', name: 'qa_a_own', label: 'A own', active: true },
      { context: { isSystem: true, tenantId: 'org_a' } } as any);
    return h;
  }
  const ORG_A_ADMIN = { ...ADMIN, tenantId: 'org_a' };

  it('a name that NO organization carries is refused from inside an organization', async () => {
    const h = await bootTwoOrgs();
    const env = envelopeOf(await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_wa', position: 'nope_position' }, { context: ORG_A_ADMIN } as any,
    )));
    expect([env.code, env.status]).toEqual(['VALIDATION_FAILED', 400]);
    expect(env.fields[0]).toMatchObject({ field: 'position', code: 'reference_not_found', value: 'nope_position' });
  });

  it("a name only ANOTHER organization's catalog carries is ACCEPTED — the ruled predicate is 'no row at all'", async () => {
    // The two readings differ exactly here. An organization-scoped predicate
    // would refuse this write (it resolves nothing in org_a); the ruled
    // literal one accepts it. Pinned so a change of reading is a visible,
    // deliberate edit — the question is recorded on the card.
    const h = await bootTwoOrgs();
    const created = await h.engine.insert(
      'sys_user_position', { user_id: 'u_wb', position: 'qa_b_only' }, { context: ORG_A_ADMIN } as any,
    );
    expect(created).toMatchObject({ position: 'qa_b_only' });
  });

  it('the org boundary holds for a VALID foreign organization — 403 at the wall, whatever the name', async () => {
    // The leg the card carried as NOT MEASURED on a single-org posture: an
    // organization_a writer stamping organization_b on the row. The tenant wall
    // refuses it before the catalog is consulted, identically for a name the
    // catalog carries, a name only organization_b carries, and a name nobody
    // carries — so the catalog verdict leaks nothing across the wall.
    const h = await bootTwoOrgs();
    for (const position of ['qa_auditor', 'qa_b_only', 'nope_position']) {
      const env = envelopeOf(await refusalOf(() => h.engine.insert(
        'sys_user_position', { user_id: 'u_wf', position, organization_id: 'org_b' }, { context: ORG_A_ADMIN } as any,
      )));
      expect([env.code, env.status], position).toEqual(['PERMISSION_DENIED', 403]);
    }
    expect(await assignmentsOf(h, 'u_wf')).toHaveLength(0);
  });

  it("the id hint never names another organization's position", async () => {
    const h = await bootTwoOrgs();
    const env = envelopeOf(await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_wc', position: 'pos_b_only' }, { context: ORG_A_ADMIN } as any,
    )));
    expect(env.fields[0].message).toBe(positionNotInCatalogMessage('pos_b_only'));
    expect(env.fields[0].message).not.toContain('qa_b_only');
    // … while its own organization's row is named.
    const own = envelopeOf(await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_wc', position: 'pos_a_own' }, { context: ORG_A_ADMIN } as any,
    )));
    expect(own.fields[0].message).toBe(positionNotInCatalogMessage('pos_a_own', 'qa_a_own'));
  });
});


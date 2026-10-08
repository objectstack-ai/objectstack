// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `granted_by` on the two grant tables (`sys_user_permission_set`,
 * `sys_user_position`) is PROVENANCE — the user who wrote the grant — and is
 * pinned here as what is STORED, over a real `ObjectQL` engine and a real SQL
 * driver with the real `SecurityPlugin` middleware (and so the real
 * `DelegatedAdminGate`) in front of it.
 *
 * ## The contract, per writer case
 *
 *  - A NON-SYSTEM insert stores its writer, whatever the payload carried: a
 *    tenant-level admin and a scoped delegate alike, with a `granted_by` naming
 *    another existing user or with none. Before this, a supplied value was
 *    stored as sent on both paths, and a tenant-level admin's grant with none
 *    stored `null`.
 *  - A SYSTEM writer keeps the value it wrote: a plain system insert (the path
 *    the platform-admin promotion takes), invitation placement (the issuer),
 *    and the organization-admin reconcile (the attributed human).
 *  - A NON-SYSTEM update cannot rewrite it: the column is `readonly`, so the
 *    engine's update strip drops the caller's value and the row keeps its
 *    writer. Before this, the update landed.
 *  - The integrity audit files a granter that resolves to nothing under
 *    `provenance`, where it raises no warning. A business lookup that resolves
 *    to nothing on the same row is the positive control: it still lands in
 *    `dangling` and still warns.
 *
 * ## Why the stamp lives in the gate and survives
 *
 * The gate is engine middleware and assigns `granted_by` in place on the
 * payload rows. The engine's create-side static `readonly` strip does not
 * judge `sys_` objects, so on insert the stamp is what lands; the update strip
 * does judge them, which is what closes the update door. Both are measured
 * below rather than assumed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { INVITATION_PLACEMENT_SERVICE, type InvitationPlacementService } from './invitation-placement.js';
import {
  SysPermissionSet,
  SysPosition,
  SysPositionPermissionSet,
  SysUserPermissionSet,
  SysUserPosition,
} from './objects/index.js';

const SYS = { context: { isSystem: true } } as never;

const pk = { name: 'id', type: 'text' as const, primaryKey: true };
const text = (name: string) => ({ name, type: 'text' as const });
/** A minimal stand-in for an object this package does not ship. */
const inline = (name: string, fields: string[]) => ({
  name,
  label: name,
  fields: { id: pk, ...Object.fromEntries(fields.map((f) => [f, text(f)])) },
});

/** The baseline every caller holds: nothing. */
const MEMBER = PermissionSetSchema.parse({ name: 'qa_member', objects: {} });

/** ADR-0066 tenant-level admin: the superuser wildcard. */
const TENANT_ADMIN = PermissionSetSchema.parse({
  name: 'qa_tenant_admin',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
});

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true };
const READ = { allowRead: true, viewAllRecords: true };
/** ADR-0090 D12 delegate: may assign `qa_plain` inside the `east` subtree. */
const DELEGATE = PermissionSetSchema.parse({
  name: 'qa_delegate',
  objects: {
    sys_user_permission_set: CRUD,
    sys_user_position: CRUD,
    sys_permission_set: READ,
    sys_position: READ,
    sys_user: READ,
    sys_business_unit: READ,
  },
  adminScope: {
    businessUnit: 'east',
    includeSubtree: true,
    manageAssignments: true,
    manageBindings: false,
    authorEnvironmentSets: false,
    assignablePermissionSets: ['qa_plain'],
  },
});

const ADMIN = 'usr_admin';
const DELEGATE_USER = 'usr_delegate';
const TARGET = 'usr_target';
/** An existing user a caller names as the granter — not the writer. */
const OTHER = 'usr_other';
const ISSUER = 'usr_issuer';
/** A granter id with no `sys_user` row: a deleted user, as the audit sees one. */
const GONE = 'usr_gone';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Rig {
  engine: ObjectQL;
  warn: ReturnType<typeof vi.fn>;
  placement: InvitationPlacementService | undefined;
}

async function boot(opts: { security: boolean } = { security: true }): Promise<Rig> {
  const warn = vi.fn();
  const engine = new ObjectQL({ logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } } as never);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.granted-by-writer-provenance',
    name: 'granted_by writer provenance',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      inline('sys_user', ['name', 'primary_business_unit_id']),
      inline('sys_organization', ['name']),
      inline('sys_business_unit', ['name', 'parent_business_unit_id', 'organization_id']),
      inline('sys_business_unit_member', ['user_id', 'business_unit_id', 'organization_id']),
      inline('sys_member', ['user_id', 'organization_id', 'role', 'created_at']),
      SysPermissionSet,
      SysPosition,
      SysPositionPermissionSet,
      SysUserPermissionSet,
      SysUserPosition,
    ],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  // Fixture rows go in past the middleware: setup is not the subject.
  await engine.insert('sys_user', [ADMIN, DELEGATE_USER, TARGET, OTHER, ISSUER].map((id) => ({ id, name: id })), SYS);
  await engine.insert('sys_business_unit', [
    { id: 'bu_hq', name: 'hq', parent_business_unit_id: null },
    { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq' },
  ], SYS);
  await engine.insert('sys_business_unit_member', [{ id: 'bum_target', user_id: TARGET, business_unit_id: 'bu_east' }], SYS);
  await engine.insert('sys_permission_set', [
    { id: 'ps_plain', name: 'qa_plain', label: 'Plain', active: true },
    { id: 'ps_oa', name: 'organization_admin', label: 'Organization admin', active: true },
    { id: 'ps_oa_nb', name: 'organization_admin_no_bypass', label: 'Organization admin (no bypass)', active: true },
  ], SYS);
  await engine.insert('sys_position', [{ id: 'pos_rep', name: 'qa_rep', label: 'Rep', active: true }], SYS);
  await engine.insert('sys_position_permission_set', [{ id: 'pps_rep', position_id: 'pos_rep', permission_set_id: 'ps_plain' }], SYS);

  let placement: InvitationPlacementService | undefined;
  if (opts.security) {
    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
        list: async () => [MEMBER, TENANT_ADMIN, DELEGATE],
      },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn((name: string, svc: unknown) => {
        if (name === INVITATION_PLACEMENT_SERVICE) placement = svc as InvitationPlacementService;
      }),
      hook: () => undefined,
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'qa_member' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
  }
  return { engine, warn, placement };
}

const CALLERS = {
  'a tenant-level admin': { userId: ADMIN, positions: [], permissions: ['qa_tenant_admin'] },
  'a scoped delegate': { userId: DELEGATE_USER, positions: [], permissions: ['qa_delegate'] },
} as const;

/** Each grant table, and a row on it every caller above may write. */
const TABLES = {
  sys_user_permission_set: (extra: Record<string, unknown> = {}) => ({
    user_id: TARGET, permission_set_id: 'ps_plain', ...extra,
  }),
  sys_user_position: (extra: Record<string, unknown> = {}) => ({
    user_id: TARGET, position: 'qa_rep', business_unit_id: 'bu_east', ...extra,
  }),
} as const;

async function storedGrantedBy(engine: ObjectQL, object: string, id: unknown): Promise<unknown> {
  const row = (await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) as any;
  expect(row, `${object}#${String(id)} was not stored`).toBeTruthy();
  return row.granted_by ?? null;
}

describe('granted_by — a non-system insert stores its writer', () => {
  for (const [object, row] of Object.entries(TABLES)) {
    for (const [who, caller] of Object.entries(CALLERS)) {
      it(`${object}: ${who} naming ANOTHER user as granter stores the writer`, async () => {
        const { engine } = await boot();
        const created: any = await engine.insert(object, row({ granted_by: OTHER }), { context: { ...caller } } as never);
        expect(await storedGrantedBy(engine, object, created.id)).toBe(caller.userId);
      });

      it(`${object}: ${who} naming no granter stores the writer`, async () => {
        const { engine } = await boot();
        const created: any = await engine.insert(object, row(), { context: { ...caller } } as never);
        expect(await storedGrantedBy(engine, object, created.id)).toBe(caller.userId);
      });
    }
  }
});

describe('granted_by — a system writer keeps the value it wrote', () => {
  for (const [object, row] of Object.entries(TABLES)) {
    it(`${object}: a system-context insert stores its own value (the platform-admin promotion's path)`, async () => {
      const { engine } = await boot();
      const created: any = await engine.insert(object, row({ granted_by: OTHER }), SYS);
      expect(await storedGrantedBy(engine, object, created.id)).toBe(OTHER);
    });
  }

  it('invitation placement stores the issuer on the assignment it applies', async () => {
    const { engine, placement } = await boot();
    expect(placement, 'the SecurityPlugin registers the invitation placement service').toBeTruthy();
    const res = await placement!.apply({
      intent: { businessUnitId: 'bu_east', positions: ['qa_rep'] },
      userId: TARGET,
      grantedBy: ISSUER,
    });
    expect(res).toEqual({ created: 1, skipped: 0 });
    const rows = (await engine.find('sys_user_position', { where: { user_id: TARGET }, context: { isSystem: true } } as never)) as any[];
    expect(rows.map((r) => r.granted_by)).toEqual([ISSUER]);
  });

  it('the organization-admin reconcile stores the human its membership write was attributed to', async () => {
    const { engine } = await boot();
    // better-auth's membership write: system context, attributed to the admin who clicked.
    await engine.insert(
      'sys_member',
      { id: 'mem_owner', user_id: TARGET, organization_id: 'org_1', role: 'owner', created_at: new Date().toISOString() },
      { context: { isSystem: true, attributedUserId: ISSUER } } as never,
    );
    const rows = (await engine.find('sys_user_permission_set', { where: { user_id: TARGET }, context: { isSystem: true } } as never)) as any[];
    expect(rows.map((r) => r.granted_by)).toEqual([ISSUER]);
  });
});

describe('granted_by — a non-system update cannot rewrite it', () => {
  for (const [object, row] of Object.entries(TABLES)) {
    for (const [who, caller] of Object.entries(CALLERS)) {
      it(`${object}: ${who} renaming the granter leaves the stored writer`, async () => {
        const { engine } = await boot();
        const created: any = await engine.insert(object, row({ granted_by: ISSUER }), SYS);
        await engine.update(object, { granted_by: OTHER }, { where: { id: created.id }, context: { ...caller } } as never);
        expect(await storedGrantedBy(engine, object, created.id)).toBe(ISSUER);
      });
    }
  }
});

describe('granted_by — the integrity audit files a granter that resolves to nothing under provenance', () => {
  const integrityWarnings = (warn: ReturnType<typeof vi.fn>) =>
    warn.mock.calls.filter(([msg]) => typeof msg === 'string' && msg.startsWith('[integrity]'));

  for (const [object, row] of Object.entries(TABLES)) {
    it(`${object}: a deleted granter lands in provenance, and no warning fires`, async () => {
      const { engine, warn } = await boot({ security: false });
      // A system write is exempt from the write-time reference check — the
      // shape a granter deleted after the grant leaves behind.
      const created: any = await engine.insert(object, row({ granted_by: GONE }), SYS);

      const report = await engine.inspectDanglingReferences({ objects: [object] });

      expect(report.dangling).toEqual([]);
      expect(report.provenance).toEqual([
        { objectName: object, recordId: String(created.id), field: 'granted_by', target: 'sys_user', value: GONE },
      ]);
      expect(integrityWarnings(warn)).toEqual([]);
    });

    it(`${object} (control): a business lookup that resolves to nothing still lands in dangling, and warns`, async () => {
      const { engine, warn } = await boot({ security: false });
      const created: any = await engine.insert(object, row({ user_id: GONE, granted_by: ADMIN }), SYS);

      const report = await engine.inspectDanglingReferences({ objects: [object] });

      expect(report.dangling).toEqual([
        { objectName: object, recordId: String(created.id), field: 'user_id', target: 'sys_user', value: GONE },
      ]);
      expect(report.provenance).toEqual([]);
      expect(integrityWarnings(warn)).toHaveLength(1);
    });
  }
});

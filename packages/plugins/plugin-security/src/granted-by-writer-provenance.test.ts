// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MEASUREMENT RIG (temporary shape) — what `granted_by` stores per writer case,
 * over a real `ObjectQL` engine and a real SQL driver with the real
 * `SecurityPlugin` middleware (and so the real `DelegatedAdminGate`) in front.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { createInvitationPlacementService } from './invitation-placement.js';
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
const inline = (name: string, fields: string[]) => ({
  name,
  label: name,
  fields: { id: pk, ...Object.fromEntries(fields.map((f) => [f, text(f)])) },
});

const TENANT_ADMIN = PermissionSetSchema.parse({
  name: 'qa_tenant_admin',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
});

const MEMBER = PermissionSetSchema.parse({ name: 'qa_member', objects: {} });

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true };
const DELEGATE = PermissionSetSchema.parse({
  name: 'qa_delegate',
  objects: {
    sys_user_permission_set: CRUD,
    sys_user_position: CRUD,
    sys_permission_set: { allowRead: true, viewAllRecords: true },
    sys_position: { allowRead: true, viewAllRecords: true },
    sys_user: { allowRead: true, viewAllRecords: true },
    sys_business_unit: { allowRead: true, viewAllRecords: true },
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
const FORGED = 'usr_forged';
const ISSUER = 'usr_issuer';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
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

  await engine.insert('sys_user', [ADMIN, DELEGATE_USER, TARGET, FORGED, ISSUER].map((id) => ({ id, name: id })), SYS);
  await engine.insert('sys_business_unit', [
    { id: 'bu_hq', name: 'hq', parent_business_unit_id: null },
    { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq' },
  ], SYS);
  await engine.insert('sys_business_unit_member', [
    { id: 'bum_target', user_id: TARGET, business_unit_id: 'bu_east' },
  ], SYS);
  await engine.insert('sys_permission_set', [
    { id: 'ps_plain', name: 'qa_plain', label: 'Plain', active: true },
  ], SYS);
  await engine.insert('sys_position', [{ id: 'pos_rep', name: 'qa_rep', label: 'Rep', active: true }], SYS);
  await engine.insert('sys_position_permission_set', [
    { id: 'pps_rep', position_id: 'pos_rep', permission_set_id: 'ps_plain' },
  ], SYS);

  const registered: Record<string, unknown> = {};
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
    registerService: vi.fn((name: string, svc: unknown) => { registered[name] = svc; }),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'qa_member' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  return { engine, registered, plugin };
}

const asAdmin = { userId: ADMIN, positions: [], permissions: ['qa_tenant_admin'] };
const asDelegate = { userId: DELEGATE_USER, positions: [], permissions: ['qa_delegate'] };

const grantRow = (extra: Record<string, unknown> = {}) => ({
  user_id: TARGET, permission_set_id: 'ps_plain', ...extra,
});
const assignmentRow = (extra: Record<string, unknown> = {}) => ({
  user_id: TARGET, position: 'qa_rep', business_unit_id: 'bu_east', ...extra,
});

async function stored(engine: ObjectQL, object: string, id: unknown) {
  return (await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) as any;
}

async function attempt(p: Promise<any>) {
  return p.then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, code: e?.code, msg: String(e?.message) }));
}

describe('MEASURE granted_by per writer case', () => {
  for (const [object, row] of [
    ['sys_user_permission_set', grantRow],
    ['sys_user_position', assignmentRow],
  ] as const) {
    for (const [who, ctx] of [['tenant-admin', asAdmin], ['delegate', asDelegate]] as const) {
      for (const explicit of [true, false]) {
        it(`${object} · ${who} · ${explicit ? 'explicit granted_by' : 'no granted_by'}`, async () => {
          const { engine } = await boot();
          const out = await attempt(engine.insert(object, row(explicit ? { granted_by: FORGED } : {}), { context: { ...ctx } } as never));
          const s = out.ok ? await stored(engine, object, out.r?.id) : null;
          console.log(`MEASURE ${object} ${who} explicit=${explicit} ->`, JSON.stringify(out.ok ? { granted_by: s?.granted_by ?? null } : out));
        });
      }
    }

    it(`${object} · system insert with a value`, async () => {
      const { engine } = await boot();
      const out = await attempt(engine.insert(object, row({ granted_by: FORGED }), SYS));
      const s = out.ok ? await stored(engine, object, out.r?.id) : null;
      console.log(`MEASURE ${object} system explicit=true ->`, JSON.stringify(out.ok ? { granted_by: s?.granted_by ?? null } : out));
    });

    for (const [who, ctx] of [['tenant-admin', asAdmin], ['delegate', asDelegate]] as const) {
      it(`${object} · ${who} · UPDATE granted_by`, async () => {
        const { engine } = await boot();
        const created = await engine.insert(object, row({ granted_by: ISSUER }), SYS);
        const out = await attempt(engine.update(object, { granted_by: FORGED }, { where: { id: (created as any).id }, context: { ...ctx } } as never));
        const s = await stored(engine, object, (created as any).id);
        console.log(`MEASURE ${object} ${who} UPDATE ->`, JSON.stringify({ outcome: out.ok ? 'landed' : out, granted_by: s?.granted_by ?? null }));
      });
    }
  }

  it('invitation placement (system) apply', async () => {
    const { engine, registered } = await boot();
    const svc: any = Object.values(registered).find((s: any) => s && typeof s.apply === 'function');
    const res = await svc.apply({ intent: { businessUnitId: 'bu_east', positions: ['qa_rep'] }, userId: TARGET, grantedBy: ISSUER });
    const rows = await engine.find('sys_user_position', { where: { user_id: TARGET }, context: { isSystem: true } } as never) as any[];
    console.log('MEASURE invitation-placement ->', JSON.stringify({ res, granted_by: rows.map((r) => r.granted_by) }));
  });

  it('auto-org-admin reconcile (system) with attributed human', async () => {
    const { engine } = await boot();
    await engine.insert('sys_permission_set', [
      { id: 'ps_oa', name: 'organization_admin', label: 'OA', active: true },
      { id: 'ps_oa_nb', name: 'organization_admin_no_bypass', label: 'OA nb', active: true },
    ], SYS);
    await engine.insert('sys_member', { id: 'm1', user_id: TARGET, organization_id: 'o1', role: 'owner', created_at: new Date().toISOString() }, { context: { isSystem: true, attributedUserId: ISSUER } } as never);
    const res = 'via-middleware';
    const rows = await engine.find('sys_user_permission_set', { where: { user_id: TARGET }, context: { isSystem: true } } as never) as any[];
    console.log('MEASURE auto-org-admin ->', JSON.stringify({ res, granted_by: rows.map((r) => r.granted_by) }));
  });
});

void createInvitationPlacementService;
void expect;

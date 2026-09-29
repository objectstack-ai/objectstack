// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20555] MEASUREMENT PROBE — what an organization-less principal's
 * position-name fold resolves, over a real engine.
 *
 * Probe stage: records readings only (to the file named by
 * `OS_TEST_PROBE_20555_OUT` when set). Converted into the pin once measured.
 */

import { writeFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { SysPosition } from './objects/sys-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import {
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
  assertEngineDeleteDispatch,
} from '@objectstack/metadata-core';

import { SecurityPlugin } from './security-plugin.js';
import { buildContextForUser } from './explain-engine.js';

const SYS = { context: { isSystem: true } } as any;
const ORG_A = 'org_a_author';
const ORG_B = 'org_b_home';
const USER_B = 'usr_b_member';
/** Org-less principal holding GLOBAL grants only (A4: what must keep resolving). */
const USER_G = 'usr_g_global';

const PROBE_OBJECT: any = {
  name: 'probe_ledger',
  label: 'Probe Ledger',
  fields: {
    id: { type: 'text', label: 'Id', primary: true },
    name: { type: 'text', label: 'Name' },
    owner_id: { type: 'text', label: 'Owner' },
  },
};

const FULL = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true };

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function insertSet(e: any, id: string, name: string, organizationId: string | null, caps: string[]) {
  await e.insert('sys_permission_set', {
    id,
    name,
    label: `${organizationId ?? 'GLOBAL'} ${name}`,
    organization_id: organizationId,
    managed_by: 'admin',
    active: true,
    object_permissions: JSON.stringify({ probe_ledger: FULL }),
    system_permissions: JSON.stringify(caps),
  }, SYS);
}

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.orgless-position-fold-20555',
    name: 'Org-less position fold',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet,
      SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, PROBE_OBJECT,
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  const e = engine as any;
  await e.insert('sys_organization', { id: ORG_A, name: ORG_A, slug: 'a' }, SYS);
  await e.insert('sys_organization', { id: ORG_B, name: ORG_B, slug: 'b' }, SYS);
  await e.insert('sys_user', { id: USER_B, name: 'b', email: 'b@example.test' }, SYS);
  await e.insert('sys_user', { id: USER_G, name: 'g', email: 'g@example.test' }, SYS);
  // Both principals: members of ORG_B only — never of ORG_A.
  await e.insert('sys_member', { id: 'mem_b', user_id: USER_B, organization_id: ORG_B, role: 'member' }, SYS);
  await e.insert('sys_member', { id: 'mem_g', user_id: USER_G, organization_id: ORG_B, role: 'member' }, SYS);
  // ORG_A authors permission sets whose NAMES spell names the principals hold as positions.
  await insertSet(e, 'ps_a_org_member', 'org_member', ORG_A, ['manage_metadata', 'probe.cap.a_org_member']);
  await insertSet(e, 'ps_a_everyone', 'everyone', ORG_A, ['manage_metadata', 'probe.cap.a_everyone']);

  // A4 — the GLOBAL grants USER_G really holds:
  //  (1) a global position assignment folded onto a global same-named set;
  await e.insert('sys_user_position', { id: 'up_g_ops', user_id: USER_G, position: 'ops_lead', organization_id: null }, SYS);
  await insertSet(e, 'ps_global_ops_lead', 'ops_lead', null, ['probe.cap.global_ops_lead']);
  //  (2) a global user grant to a global DB-authored set — but ORG_A holds a
  //      same-named copy, inserted FIRST, so an unordered read meets it first.
  await insertSet(e, 'ps_a_platform_ops', 'platform_ops', ORG_A, ['probe.cap.a_platform_ops']);
  await insertSet(e, 'ps_global_platform_ops', 'platform_ops', null, ['probe.cap.global_platform_ops']);
  await e.insert('sys_user_permission_set', {
    id: 'ups_g_ops', user_id: USER_G, permission_set_id: 'ps_global_platform_ops', organization_id: null,
  }, SYS);
  return engine;
}

function observed(engine: any, reads: any[]): any {
  return {
    registry: engine.registry,
    registerMiddleware: (...a: any[]) => engine.registerMiddleware?.(...a),
    getSchema: (n: string) => engine.getSchema?.(n),
    find: async (o: string, q?: any, opt?: any) => {
      const r = await engine.find(o, q, opt);
      if (o === 'sys_permission_set' && q?.where?.name?.$in) {
        reads.push({
          where: q.where,
          context: opt?.context ?? q?.context,
          rows: (r as any[]).map((x) => ({ id: x.id, name: x.name, organization_id: x.organization_id ?? null })),
        });
      }
      return r;
    },
    findOne: (o: string, q?: any, opt?: any) => {
      assertEngineFindOnePredicate(o, q);
      return engine.findOne(o, q, opt);
    },
    insert: (o: string, d: any, opt?: any) => engine.insert(o, d, opt),
    update: (o: string, d: any, opt?: any) => {
      assertEngineUpdateDispatch(d, opt);
      return engine.update(o, d, opt);
    },
    delete: (o: string, id: any, opt?: any) => {
      assertEngineDeleteDispatch(opt);
      return engine.delete(o, id, opt);
    },
  };
}

async function securityServiceOver(engine: any, reads: any[]) {
  const plugin = new SecurityPlugin();
  const svc = observed(engine, reads);
  const services: Record<string, any> = {};
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    registerService: (n: string, s: any) => { services[n] = s; },
    registerMiddleware: () => {},
    getService: (n: string) => {
      if (n === 'objectql') return svc;
      if (n === 'metadata') return { list: async () => [] };
      if (n === 'manifest') return { register: () => {} };
      return services[n];
    },
  };
  await plugin.init(ctx);
  await plugin.start(ctx);
  expect(services.security, 'security service never registered').toBeTruthy();
  return services.security;
}

async function reading(security: any, reads: any[], base: any, organizationId: string | undefined) {
  const ctx = organizationId ? { ...base, tenantId: organizationId, organizationId } : { ...base, tenantId: undefined };
  reads.length = 0;
  const sets = await security.resolvePermissionSetsForContext(ctx);
  const loaderReads = [...reads];
  const eff = await security.getEffectiveObjectPermissions({ ...ctx });
  return {
    positions: base.positions,
    permissions: base.permissions,
    coreSystemPermissions: base.systemPermissions,
    posture: base.posture,
    loaderReads,
    sets: sets.map((s: any) => ({ name: s.name, label: s.label, systemPermissions: s.systemPermissions })),
    effectiveProbeLedger: eff?.probe_ledger ?? null,
  };
}

describe('[#20555] PROBE', () => {
  it('records the org-less resolution', async () => {
    const engine = await boot();
    const reads: any[] = [];
    const security = await securityServiceOver(engine, reads);

    const now = Date.now();
    const out = {
      userB_orgless: await reading(security, reads, await buildContextForUser(engine, USER_B, now, undefined), undefined),
      userB_home: await reading(security, reads, await buildContextForUser(engine, USER_B, now, ORG_B), ORG_B),
      userG_orgless: await reading(security, reads, await buildContextForUser(engine, USER_G, now, undefined), undefined),
      userG_home: await reading(security, reads, await buildContextForUser(engine, USER_G, now, ORG_B), ORG_B),
    };
    const file = process.env.OS_TEST_PROBE_20555_OUT;
    if (file) writeFileSync(file, JSON.stringify(out, null, 2));
  }, 120_000);
});

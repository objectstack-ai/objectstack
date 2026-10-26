// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25251, ruling 6354966423, letter B] A system context a flow run opened
 * writes no identity assignment.
 *
 * The context a `runAs: 'system'` run hands its data nodes carries `isSystem`
 * and the run's `flowRunId` (`resolveRunDataContext`, service-automation). The
 * data middleware refuses that context's governed writes to the four
 * identity-assignment objects ahead of its `isSystem` bypass, so the D12 gate
 * and the organization doors are not skipped by elevation.
 *
 * ## The contract, per context
 *
 *  - `isSystem` + `flowRunId`, user-triggered or user-less: every governed verb
 *    on each of the four objects is refused with `PERMISSION_DENIED` (403) and
 *    a prescription, and the store does not move.
 *  - `isSystem` without `flowRunId` (a seeder, better-auth, a system service):
 *    the same writes land, as before.
 *  - `flowRunId` without `isSystem` (a `runAs: 'user'` run): not judged by the
 *    refusal. It reaches the D12 gate as the user it acts for: a tenant-level
 *    administrator's grant is admitted and stamped with that user as
 *    `granted_by`; a plain member's is refused by the gate, not by the refusal.
 *  - Reads of the four objects, and writes to every other object, under the
 *    flow's system context are unchanged.
 *  - [#25653] `isSystem` + the app-automation elevation mark (a hook's
 *    `runAs: 'system'`, an action body): refused like the flow, each with its
 *    own subject and prescription; a context carrying a run and a mark is
 *    answered as the flow. The mark without `isSystem` is not judged. The
 *    paths that set the mark are driven end to end in runtime
 *    (`app-automation-identity-write-refusal.integration.test.ts`).
 *
 * The first block judges the predicate directly, over every verb the D12 gate
 * governs (`transfer`, `restore` and `purge` have no engine verb to drive). The
 * rest drive the real `SecurityPlugin` middleware over a real `ObjectQL`
 * engine and a real SQL driver, and read the stored rows back.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { markAppAutomationElevation } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { GOVERNED_OPERATIONS } from './delegated-admin-gate.js';
import {
  FLOW_SYSTEM_IDENTITY_WRITE_OBJECTS,
  assertFlowSystemIdentityWriteAllowed,
} from './flow-system-identity-write-refusal.js';
import { SysUserPermissionSet, SysUserPosition } from './objects/index.js';
import { SysPermissionSet, SysPosition, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';

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

const ADMIN = 'usr_admin';
const PLAIN = 'usr_plain';
const TARGET = 'usr_target';

/** A `runAs: 'system'` run's data context, as `resolveRunDataContext` builds it for a user-triggered run. */
const FLOW_SYSTEM = { isSystem: true, actor: 'svc:flow:qa_flow', userId: ADMIN, flowRunId: 'run_1' };
/** The same for a user-less (scheduled) run. */
const FLOW_SYSTEM_USERLESS = { isSystem: true, actor: 'svc:flow:qa_flow', positions: [], permissions: [], flowRunId: 'run_2' };
/** A platform writer's own system context: no run. */
const SEEDER = { isSystem: true };
/** A `runAs: 'user'` run's data context for a tenant-level administrator. */
const FLOW_USER_ADMIN = { isSystem: false, userId: ADMIN, positions: [], permissions: ['qa_tenant_admin'], flowRunId: 'run_3' };
/** A `runAs: 'user'` run's data context for a plain member. */
const FLOW_USER_PLAIN = { isSystem: false, userId: PLAIN, positions: [], permissions: ['qa_member'], flowRunId: 'run_4' };

const opts = (context: Record<string, unknown>) => ({ context: { ...context } }) as never;

/** A row of each of the four objects, insertable by the seeder. */
const ROWS: Record<string, (id: string) => Record<string, unknown>> = {
  sys_user_position: (id) => ({ id, user_id: TARGET, position: 'qa_rep', business_unit_id: 'bu_east' }),
  sys_user_permission_set: (id) => ({ id, user_id: TARGET, permission_set: 'qa_plain' }),
  sys_invitation: (id) => ({ id, email: `${id}@example.test`, role: 'member', status: 'pending', inviter_id: ADMIN }),
  sys_member: (id) => ({ id, user_id: TARGET, organization_id: 'org_default', role: 'member' }),
};

/** The column an update changes on each object. */
const EDITS: Record<string, Record<string, unknown>> = {
  sys_user_position: { business_unit_id: 'bu_hq' },
  sys_user_permission_set: { permission_set: 'qa_other' },
  sys_invitation: { role: 'admin' },
  sys_member: { role: 'admin' },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.flow-system-identity-write-refusal',
    name: 'flow system identity write refusal',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      { ...inline('sys_user', ['name', 'primary_business_unit_id']), managedBy: 'better-auth' },
      { ...inline('sys_organization', ['name']), managedBy: 'better-auth' },
      inline('sys_business_unit', ['name', 'parent_business_unit_id', 'organization_id']),
      inline('sys_business_unit_member', ['user_id', 'business_unit_id', 'organization_id']),
      { ...inline('sys_member', ['user_id', 'organization_id', 'role']), managedBy: 'better-auth' },
      {
        ...inline('sys_invitation', ['email', 'role', 'status', 'inviter_id', 'organization_id', 'expires_at']),
        managedBy: 'better-auth',
      },
      inline('qa_note', ['title', 'organization_id', 'owner_id']),
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
  const SYS = opts(SEEDER);
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization' }, SYS);
  await engine.insert('sys_user', [ADMIN, PLAIN, TARGET].map((id) => ({ id, name: id })), SYS);
  await engine.insert('sys_business_unit', [
    { id: 'bu_hq', name: 'hq', parent_business_unit_id: null },
    { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq' },
  ], SYS);
  await engine.insert('sys_business_unit_member', [{ id: 'bum_target', user_id: TARGET, business_unit_id: 'bu_east' }], SYS);
  await engine.insert('sys_permission_set', [
    { id: 'ps_plain', name: 'qa_plain', label: 'Plain', active: true },
    { id: 'ps_other', name: 'qa_other', label: 'Other', active: true },
  ], SYS);
  await engine.insert('sys_position', [{ id: 'pos_rep', name: 'qa_rep', label: 'Rep', active: true }], SYS);
  await engine.insert('sys_position_permission_set', [{ id: 'pps_rep', position_id: 'pos_rep', permission_set_id: 'ps_plain' }], SYS);
  // [ADR-0131 D3/D4] The security catalog the gate reads.
  const QA_PKG = 'com.objectstack.qa.flow-system-identity';
  for (const name of ['qa_plain', 'qa_other']) {
    engine.registry.registerItem('permission', { name, label: name } as any, 'name' as any, QA_PKG);
  }
  engine.registry.registerItem('position', { name: 'qa_rep', label: 'Rep', permissionSets: ['qa_plain'] } as any, 'name' as any, QA_PKG);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER, TENANT_ADMIN],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'qa_member' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  return engine;
}

/** The stored row, read past the middleware; `null` when there is none. */
async function stored(engine: ObjectQL, object: string, id: string): Promise<Record<string, unknown> | null> {
  return ((await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) as any) ?? null;
}

/** The refusal a write met, or `null` when it landed. */
async function refusal(write: () => Promise<unknown>): Promise<any> {
  try {
    await write();
    return null;
  } catch (e) {
    return e;
  }
}

function expectFlowSystemRefusal(err: any, object: string, operation: string): void {
  expect(err, `${operation} on ${object} was not refused`).not.toBe(null);
  expect(err.code).toBe('PERMISSION_DENIED');
  expect(err.statusCode ?? err.status).toBe(403);
  expect(err.details).toMatchObject({ object, operation });
  expect(err.message).toMatch(/flow that runs as system/);
  if (object === 'sys_user_position' || object === 'sys_user_permission_set') {
    expect(err.message).toMatch(/runAs to 'user'/);
  } else {
    expect(err.message).toMatch(/organization endpoints/);
  }
}

const OBJECTS = [...FLOW_SYSTEM_IDENTITY_WRITE_OBJECTS];

/** A `runAs: 'system'` hook's api context, fired by a user's write. */
const HOOK_SYSTEM = markAppAutomationElevation({ isSystem: true, userId: ADMIN }, 'hook');
/** An action body's context, invoked by a user. */
const ACTION_SYSTEM = markAppAutomationElevation({ isSystem: true, userId: ADMIN }, 'action');

describe('the predicate: isSystem AND flowRunId, the D12 gate\'s verbs, the four objects', () => {
  it('names exactly the four identity-assignment objects', () => {
    expect(OBJECTS.sort()).toEqual(['sys_invitation', 'sys_member', 'sys_user_permission_set', 'sys_user_position']);
  });

  for (const object of OBJECTS) {
    for (const operation of GOVERNED_OPERATIONS) {
      it(`refuses '${operation}' on ${object} from a flow's system context`, () => {
        let err: any = null;
        try {
          assertFlowSystemIdentityWriteAllowed({ object, operation, context: FLOW_SYSTEM });
        } catch (e) {
          err = e;
        }
        expectFlowSystemRefusal(err, object, operation);
      });
    }
  }

  it('passes a system context without a run, a run without isSystem, reads, and other objects', () => {
    for (const object of OBJECTS) {
      for (const operation of GOVERNED_OPERATIONS) {
        expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation, context: SEEDER })).not.toThrow();
        expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation, context: { ...SEEDER, flowRunId: '' } })).not.toThrow();
        expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation, context: FLOW_USER_ADMIN })).not.toThrow();
        expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation })).not.toThrow();
      }
      for (const operation of ['find', 'findOne', 'count', 'aggregate']) {
        expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation, context: FLOW_SYSTEM })).not.toThrow();
      }
    }
    for (const object of ['sys_user', 'sys_business_unit', 'sys_organization', 'qa_note']) {
      expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation: 'insert', context: FLOW_SYSTEM })).not.toThrow();
    }
  });
});

describe("a flow's system context: governed writes to the four objects are refused through the middleware", () => {
  for (const object of OBJECTS) {
    for (const [label, context] of [['user-triggered', FLOW_SYSTEM], ['user-less', FLOW_SYSTEM_USERLESS]] as const) {
      it(`${object}: insert, update and delete from a ${label} run are refused and the store does not move`, async () => {
        const engine = await boot();
        await engine.insert(object, ROWS[object]('seeded'), opts(SEEDER));
        const before = await stored(engine, object, 'seeded');

        expectFlowSystemRefusal(await refusal(() => engine.insert(object, ROWS[object]('born'), opts(context))), object, 'insert');
        expect(await stored(engine, object, 'born')).toBe(null);

        expectFlowSystemRefusal(
          await refusal(() => engine.update(object, EDITS[object], { where: { id: 'seeded' }, context: { ...context } } as never)),
          object,
          'update',
        );
        expectFlowSystemRefusal(
          await refusal(() => engine.delete(object, { where: { id: 'seeded' }, context: { ...context } } as never)),
          object,
          'delete',
        );
        expect(await stored(engine, object, 'seeded')).toEqual(before);
      });
    }
  }
});

describe('CONTROL: a system context without a run writes the four objects as before', () => {
  for (const object of OBJECTS) {
    it(`${object}: the seeder's insert, update and delete land`, async () => {
      const engine = await boot();
      await engine.insert(object, ROWS[object]('seeded'), opts(SEEDER));
      expect(await stored(engine, object, 'seeded')).toMatchObject({ id: 'seeded' });

      await engine.update(object, EDITS[object], { where: { id: 'seeded' }, context: { ...SEEDER } } as never);
      expect(await stored(engine, object, 'seeded')).toMatchObject(EDITS[object]);

      await engine.delete(object, { where: { id: 'seeded' }, context: { ...SEEDER } } as never);
      expect(await stored(engine, object, 'seeded')).toBe(null);
    });
  }
});

describe("CONTROL: a flow's system context still reads the four objects and writes every other object", () => {
  it('reads each of the four objects', async () => {
    const engine = await boot();
    for (const object of OBJECTS) {
      await engine.insert(object, ROWS[object]('seeded'), opts(SEEDER));
      const rows = (await engine.find(object, { where: { id: 'seeded' }, context: { ...FLOW_SYSTEM } } as never)) as any[];
      expect(rows.map((r) => r.id), object).toEqual(['seeded']);
    }
  });

  it('writes an ordinary object and an identity object outside the four', async () => {
    const engine = await boot();
    await engine.insert('qa_note', { id: 'note_1', title: 'Note' }, opts(FLOW_SYSTEM));
    await engine.update('qa_note', { title: 'Edited' }, { where: { id: 'note_1' }, context: { ...FLOW_SYSTEM } } as never);
    expect(await stored(engine, 'qa_note', 'note_1')).toMatchObject({ title: 'Edited' });

    await engine.insert('sys_business_unit', { id: 'bu_west', name: 'west', parent_business_unit_id: 'bu_hq' }, opts(FLOW_SYSTEM));
    expect(await stored(engine, 'sys_business_unit', 'bu_west')).toMatchObject({ name: 'west' });
  });
});

describe("a runAs:'user' run's context is judged by the D12 gate as the user it acts for", () => {
  for (const object of ['sys_user_position', 'sys_user_permission_set']) {
    it(`${object}: a tenant-level administrator's grant is admitted and records that user as granted_by`, async () => {
      const engine = await boot();
      await engine.insert(object, ROWS[object]('granted'), opts(FLOW_USER_ADMIN));
      expect(await stored(engine, object, 'granted')).toMatchObject({ id: 'granted', granted_by: ADMIN });
    });

    it(`${object}: a plain member's grant is refused by the gate, not by the flow-system refusal`, async () => {
      const engine = await boot();
      const err = await refusal(() => engine.insert(object, ROWS[object]('granted'), opts(FLOW_USER_PLAIN)));
      expect(err, 'the plain member\'s grant landed').not.toBe(null);
      expect(err.code).toBe('PERMISSION_DENIED');
      expect(err.message).not.toMatch(/flow that runs as system/);
      // The gate's own refusal, judging the user the run acts for.
      expect(err.message).toMatch(/delegated adminScope \(ADR-0090 D12\)/);
      expect(err.details).toMatchObject({ object, operation: 'insert', userId: PLAIN });
      expect(await stored(engine, object, 'granted')).toBe(null);
    });
  }
});

describe('[#25653] the predicate also reads the app-automation elevation mark', () => {
  const ASSIGNMENT = new Set(['sys_user_position', 'sys_user_permission_set']);

  for (const [source, context, subject, prescription] of [
    ['hook', HOOK_SYSTEM, /a hook that runs as system \(runAs: 'system', a system context it inherits, or ctx\.api\.sudo\(\)\)/, /Set the hook's runAs to 'user' and leave ctx\.api\.sudo\(\) out/],
    ['action', ACTION_SYSTEM, /an action body \(an action body runs as system\)/, /a flow whose runAs is 'user'/],
  ] as const) {
    for (const object of OBJECTS) {
      for (const operation of GOVERNED_OPERATIONS) {
        it(`refuses '${operation}' on ${object} from an ${source} elevation`, () => {
          let err: any = null;
          try {
            assertFlowSystemIdentityWriteAllowed({ object, operation, context });
          } catch (e) {
            err = e;
          }
          expect(err, `${operation} on ${object} was not refused`).not.toBe(null);
          expect(err.code).toBe('PERMISSION_DENIED');
          expect(err.statusCode ?? err.status).toBe(403);
          expect(err.details).toMatchObject({ object, operation });
          expect(err.message).toMatch(subject);
          expect(err.message).toMatch(ASSIGNMENT.has(object) ? prescription : /organization endpoints/);
        });
      }
    }
  }

  it('answers a context carrying both a run and a mark as the flow', () => {
    const both = markAppAutomationElevation({ ...FLOW_SYSTEM }, 'hook');
    for (const object of OBJECTS) {
      let err: any = null;
      try {
        assertFlowSystemIdentityWriteAllowed({ object, operation: 'insert', context: both });
      } catch (e) {
        err = e;
      }
      expectFlowSystemRefusal(err, object, 'insert');
    }
  });

  it('passes the mark without isSystem, reads under the mark, and other objects', () => {
    for (const source of ['hook', 'action'] as const) {
      const deElevated = markAppAutomationElevation({ isSystem: false, userId: ADMIN, permissions: ['qa_tenant_admin'] }, source);
      const elevated = source === 'hook' ? HOOK_SYSTEM : ACTION_SYSTEM;
      for (const object of OBJECTS) {
        for (const operation of GOVERNED_OPERATIONS) {
          expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation, context: deElevated })).not.toThrow();
        }
        for (const operation of ['find', 'findOne', 'count', 'aggregate']) {
          expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation, context: elevated })).not.toThrow();
        }
      }
      for (const object of ['sys_user', 'sys_business_unit', 'sys_organization', 'qa_note']) {
        expect(() => assertFlowSystemIdentityWriteAllowed({ object, operation: 'insert', context: elevated })).not.toThrow();
      }
    }
  });

  it('reads a mark value other than the two sources as no mark', () => {
    const forged = { isSystem: true, [Symbol.for('objectstack.core.appAutomationElevation')]: 'platform' };
    expect(() => assertFlowSystemIdentityWriteAllowed({ object: 'sys_member', operation: 'insert', context: forged as never })).not.toThrow();
  });
});

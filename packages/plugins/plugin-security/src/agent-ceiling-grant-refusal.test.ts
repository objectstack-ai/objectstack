// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `sys_user_permission_set` row is a person's grant, and an agent ceiling set
 * (`MCP_AGENT_PERMISSION_SETS`, ADR-0090 D10) is not a person's set: a
 * non-system insert or update that would store an assignment naming one is
 * refused — `400 VALIDATION_FAILED`, `invalid_value` at `permission_set` — for
 * every caller, a platform administrator included. A system write that is not
 * a seed stands down, a person set stays assignable, removal stays open, and an
 * agent principal still holds its ceiling, from its own context. The same rule
 * holds on every other way a set reaches a person: a seed, an assignment of a
 * position whose definition names one, a position definition at the metadata
 * door, and the deployment's baseline options.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` registered on it the way a kernel composition does, so the
 * refusal under test is the one the plugin's own `start()` binds, on the
 * engine's own insert and update paths (one row, a batch, by id, by
 * predicate). Every refusal is identified by its ADR-0112 envelope — `status`,
 * `code` and `fields[0]` read through `resolveThrownHttpError`, the resolver
 * both HTTP doors answer with — never by a bare `toThrow()`, which stays green
 * when a different refusal fires first; and every one reads the stored rows
 * back to show nothing landed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { PermissionSet } from '@objectstack/spec/security';
import { MCP_AGENT_PERMISSION_SETS, MCP_AGENT_PERMISSION_SET_READ, MCP_AGENT_PERMISSION_SET_WRITE } from '@objectstack/spec/ai';
import { SEED_WRITE_EXECUTION_CONTEXT } from '@objectstack/spec/kernel';
import { SysUser } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { securityDefaultPermissionSets } from './manifest.js';
import { provisionRigUsers } from './__tests__/rig-users.testkit.js';
import {
  AGENT_CEILING_GRANT_HOOK_PACKAGE,
  isAgentCeilingPermissionSet,
  registerAgentCeilingGrantRefusal,
  registerPositionAgentCeilingGate,
} from './agent-ceiling-grant-refusal.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const MEMBER_DEFAULT = { name: 'member_default', label: 'Member', objects: {} } as unknown as PermissionSet;

/** The superuser wildcard: the delegated-admin gate reads it as tenant-level, CRUD admits it. */
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

const ORG = 'org_a';
const SYS = { isSystem: true } as const;
/** A system writer stamps the organization it writes in (ADR-0131 D1: the tenant column is NOT NULL). */
const SYS_ORG = { isSystem: true, tenantId: ORG } as const;

/** A platform administrator: every gate before the engine's hooks admits its grant writes. */
const PLATFORM_ADMIN = {
  userId: 'u_platform', positions: [], permissions: ['qa_admin'], posture: 'PLATFORM_ADMIN', tenantId: ORG,
};

/** A permission set meant for people, served by the catalog beside the three agent ceilings. */
const PERSON_SET = 'qa_person_set';
/** A position whose definition names only {@link PERSON_SET}. */
const PERSON_POSITION = 'qa_person_position';
/** A position whose definition names an agent ceiling set beside a person set. */
const CEILING_POSITION = 'qa_ceiling_position';
/** The seed-write context every seeder writes with, stamping the organization it seeds. */
const SEED_ORG = { ...SEED_WRITE_EXECUTION_CONTEXT, tenantId: ORG } as const;

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.agent-ceiling-grant-refusal',
    name: 'Agent ceiling grant refusal',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPermissionSet, SysUserPosition],
  } as any);
  await engine.syncSchemas();
  // `sys_user` registered, and no `sys_member` object, so the holder-membership
  // refusal stands down. [#29029] Each grant's holder is a user the writer
  // reads, as in the sibling grant suites. What is measured here is the set
  // the row names, alone.
  if (!engine.registry.getObject(SysUser.name)) engine.registry.registerObject(SysUser as never, 'qa.agent-ceiling');
  await provisionRigUsers(engine, ['u_person', 'u_person_2', 'u_platform']);
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      // The catalog reads a set by name (ADR-0150 D3): served from the same list.
      get: async (type: string, name: string) =>
        (type === 'position' ? null : type === 'permission' ? [MEMBER_DEFAULT, QA_ADMIN].find((s: any) => s.name === name) : engine.getSchema(name)) ?? null,
      list: async (type: string) => (type === 'position' ? [] : [MEMBER_DEFAULT, QA_ADMIN]),
    },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    // Lifecycle hooks are collected and never fired: the fixture seeds every row it reads itself.
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

  // [ADR-0131 D3/D4] The sets a grant names live in the security catalog (the
  // registry): the three agent ceilings a deployment ships, and a person set.
  // So the catalog refusal (`reference_not_found`) never answers here, and a
  // refusal below is this rule's own.
  for (const name of [...MCP_AGENT_PERMISSION_SETS, PERSON_SET]) {
    engine.registry.registerItem('permission', { name, label: name } as any, 'name' as any, 'qa.agent-ceiling');
  }
  // Two positions a package declares in code — definitions that never meet the
  // metadata door: one binding a person set, one binding an agent ceiling.
  for (const [name, sets] of [[PERSON_POSITION, [PERSON_SET]], [CEILING_POSITION, [PERSON_SET, MCP_AGENT_PERMISSION_SET_WRITE]]] as const) {
    engine.registry.registerItem('position', { name, label: name, permissionSets: [...sets] } as any, 'name' as any, 'qa.agent-ceiling');
  }
  return { engine, plugin, ctx };
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

async function grantsWhere(h: Harness, where: Record<string, unknown>): Promise<any[]> {
  const rows = await h.engine.find('sys_user_permission_set', { where, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

/** The refusal's identifying envelope, asserted on every negative pin. */
function expectAgentCeilingRefusal(err: unknown, setName: string, label?: string) {
  const env = envelopeOf(err);
  expect(env.status, label).toBe(400);
  expect(env.code, label).toBe('VALIDATION_FAILED');
  expect(env.fields, label).toHaveLength(1);
  expect(env.fields[0]?.field, label).toBe('permission_set');
  expect(env.fields[0]?.code, label).toBe('invalid_value');
  expect(env.fields[0]?.value, label).toBe(setName);
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

describe('sys_user_permission_set: an agent ceiling set is not a person\'s permission set', () => {
  it('the rule reads the spec\'s own list of agent ceiling sets, and no other name', () => {
    for (const name of MCP_AGENT_PERMISSION_SETS) expect(isAgentCeilingPermissionSet(name), name).toBe(true);
    for (const name of [PERSON_SET, 'member_default', 'admin_full_access', 'MCP_AGENT_DATA_READ', '', undefined]) {
      expect(isAgentCeilingPermissionSet(name), String(name)).toBe(false);
    }
  });

  it.each([...MCP_AGENT_PERMISSION_SETS])(
    "a platform administrator's grant of %s to a user is refused, and nothing is stored",
    async (setName) => {
      const h = await boot();
      const err = await refusalOf(() => h.engine.insert(
        'sys_user_permission_set', { user_id: 'u_person', permission_set: setName }, { context: PLATFORM_ADMIN } as any,
      ));
      expectAgentCeilingRefusal(err, setName);
      expect(await grantsWhere(h, { user_id: 'u_person' })).toHaveLength(0);
    },
  );

  it('positive control: the same administrator grants a person permission set, and the row is stored', async () => {
    const h = await boot();
    const created = await h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_person', permission_set: PERSON_SET }, { context: PLATFORM_ADMIN } as any,
    );
    expect(created).toMatchObject({ user_id: 'u_person', permission_set: PERSON_SET });
    const [row] = await grantsWhere(h, { user_id: 'u_person' });
    expect(row?.permission_set).toBe(PERSON_SET);
  });

  it('a batch insert with one agent ceiling row among person grants is refused whole, and nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert('sys_user_permission_set', [
      { user_id: 'u_person', permission_set: PERSON_SET },
      { user_id: 'u_person_2', permission_set: MCP_AGENT_PERMISSION_SET_READ },
    ], { context: PLATFORM_ADMIN } as any));
    expectAgentCeilingRefusal(err, MCP_AGENT_PERMISSION_SET_READ);
    expect(await grantsWhere(h, { user_id: 'u_person' })).toHaveLength(0);
    expect(await grantsWhere(h, { user_id: 'u_person_2' })).toHaveLength(0);
  });

  it('an update by id that renames a grant to an agent ceiling set is refused, and the stored row is untouched', async () => {
    const h = await boot();
    await h.engine.insert(
      'sys_user_permission_set', { id: 'g1', user_id: 'u_person', permission_set: PERSON_SET }, { context: PLATFORM_ADMIN } as any,
    );
    const err = await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { id: 'g1', permission_set: MCP_AGENT_PERMISSION_SET_READ }, { context: PLATFORM_ADMIN } as any,
    ));
    expectAgentCeilingRefusal(err, MCP_AGENT_PERMISSION_SET_READ);
    const [row] = await grantsWhere(h, { id: 'g1' });
    expect(row?.permission_set).toBe(PERSON_SET);
  });

  it('a predicate (multi) update that renames grants to an agent ceiling set is refused, and no matched row changes', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', [
      { id: 'gm1', user_id: 'u_person', permission_set: PERSON_SET, reason: 'batch' },
      { id: 'gm2', user_id: 'u_person_2', permission_set: PERSON_SET, reason: 'batch' },
    ], { context: PLATFORM_ADMIN } as any);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { permission_set: MCP_AGENT_PERMISSION_SET_READ },
      { where: { reason: 'batch' }, multi: true, context: PLATFORM_ADMIN } as any,
    ));
    expectAgentCeilingRefusal(err, MCP_AGENT_PERMISSION_SET_READ);
    const rows = await grantsWhere(h, { reason: 'batch' });
    expect(rows.map((r) => r.permission_set)).toEqual([PERSON_SET, PERSON_SET]);
  });

  it('an update that keeps a stored agent ceiling assignment in force is refused — a new holder, a new window, an echo', async () => {
    const h = await boot();
    // A row written where the rule does not judge (a system write).
    await h.engine.insert(
      'sys_user_permission_set',
      { id: 'stored', user_id: 'u_person', permission_set: MCP_AGENT_PERMISSION_SET_READ, organization_id: ORG },
      { context: SYS_ORG } as any,
    );
    const patches = [
      { label: 'a new holder', data: { user_id: 'u_person_2' } },
      { label: 'a new validity window', data: { valid_until: '2099-01-01T00:00:00.000Z' } },
      { label: 'an echo of the set', data: { permission_set: MCP_AGENT_PERMISSION_SET_READ, reason: 'echo' } },
    ];
    for (const { label, data } of patches) {
      const err = await refusalOf(() => h.engine.update(
        'sys_user_permission_set', { id: 'stored', ...data }, { context: PLATFORM_ADMIN } as any,
      ));
      expectAgentCeilingRefusal(err, MCP_AGENT_PERMISSION_SET_READ, label);
    }
    // The same edit by predicate is judged per matched row, on its stored set.
    expectAgentCeilingRefusal(await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { user_id: 'u_person_2' },
      { where: { user_id: 'u_person' }, multi: true, context: PLATFORM_ADMIN } as any,
    )), MCP_AGENT_PERMISSION_SET_READ, 'by predicate');
    const [row] = await grantsWhere(h, { id: 'stored' });
    expect(row).toMatchObject({ user_id: 'u_person', permission_set: MCP_AGENT_PERMISSION_SET_READ });
    expect(row?.valid_until ?? null).toBeNull();
  });

  it('positive control: a stored agent ceiling assignment can be renamed to a person set, and can be deleted', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', [
      { id: 'renamed', user_id: 'u_person', permission_set: MCP_AGENT_PERMISSION_SET_READ, organization_id: ORG },
      { id: 'removed', user_id: 'u_person_2', permission_set: MCP_AGENT_PERMISSION_SET_READ, organization_id: ORG },
    ], { context: SYS_ORG } as any);
    await h.engine.update(
      'sys_user_permission_set', { id: 'renamed', permission_set: PERSON_SET }, { context: PLATFORM_ADMIN } as any,
    );
    expect((await grantsWhere(h, { id: 'renamed' }))[0]?.permission_set).toBe(PERSON_SET);
    await h.engine.delete('sys_user_permission_set', { where: { id: 'removed' }, context: PLATFORM_ADMIN } as any);
    expect(await grantsWhere(h, { id: 'removed' })).toHaveLength(0);
  });

  it('a system write that is not a seed stands down: the platform\'s own grant writers are unaffected', async () => {
    const h = await boot();
    for (const setName of MCP_AGENT_PERMISSION_SETS) {
      await h.engine.insert(
        'sys_user_permission_set', { user_id: `u_seeded_${setName}`, permission_set: setName, organization_id: ORG },
        { context: SYS_ORG } as any,
      );
    }
    expect(await grantsWhere(h, { organization_id: ORG })).toHaveLength(MCP_AGENT_PERMISSION_SETS.length);
    // And a system update of one is not judged either.
    const [first] = await grantsWhere(h, { permission_set: MCP_AGENT_PERMISSION_SET_READ });
    await h.engine.update(
      'sys_user_permission_set', { id: first.id, reason: 'system edit' }, { context: SYS_ORG } as any,
    );
    expect((await grantsWhere(h, { id: first.id }))[0]?.reason).toBe('system edit');
  });

  it('an agent principal holds its ceiling from its own context, with no assignment row naming it', async () => {
    const h = await boot();
    expect(await grantsWhere(h, {})).toHaveLength(0);
    const namesOf = async (context: Record<string, unknown>) =>
      ((await (h.plugin as any).resolvePermissionSetsForContext(context)) as PermissionSet[]).map((ps) => ps.name);
    // The ceiling the admitting door derives from the consented scopes, on the
    // agent principal acting for u_person.
    const agentSets = await namesOf({
      userId: 'u_person', positions: [], permissions: [MCP_AGENT_PERMISSION_SET_READ], principalKind: 'agent',
      onBehalfOf: { userId: 'u_person', principalKind: 'human' }, tenantId: ORG,
    });
    expect(agentSets).toEqual([MCP_AGENT_PERMISSION_SET_READ]);
    // The person themselves resolves no agent ceiling.
    const personSets = await namesOf({ userId: 'u_person', positions: [], permissions: [], tenantId: ORG });
    expect(personSets.some((name) => isAgentCeilingPermissionSet(name))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Every other way a set reaches a person
// ---------------------------------------------------------------------------

describe('a seed never gives a person an agent ceiling set', () => {
  it.each([...MCP_AGENT_PERMISSION_SETS])('a seed grant of %s is refused, and nothing is stored', async (setName) => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_person', permission_set: setName, organization_id: ORG },
      { context: SEED_ORG } as any,
    ));
    expectAgentCeilingRefusal(err, setName);
    expect(await grantsWhere(h, { user_id: 'u_person' })).toHaveLength(0);
  });

  it('positive control: a seed grant of a person set is stored', async () => {
    const h = await boot();
    await h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_person', permission_set: PERSON_SET, organization_id: ORG },
      { context: SEED_ORG } as any,
    );
    expect((await grantsWhere(h, { user_id: 'u_person' }))[0]?.permission_set).toBe(PERSON_SET);
  });
});

describe('sys_user_position: a position whose definition names an agent ceiling set is assigned to no one', () => {
  async function positionsWhere(h: Harness, where: Record<string, unknown>): Promise<any[]> {
    const rows = await h.engine.find('sys_user_position', { where, context: SYS });
    return Array.isArray(rows) ? rows : [];
  }

  function expectPositionRefusal(err: unknown, label: string) {
    const env = envelopeOf(err);
    expect([env.status, env.code], label).toEqual([400, 'VALIDATION_FAILED']);
    expect(env.fields, label).toHaveLength(1);
    expect(env.fields[0], label).toMatchObject({
      field: 'position',
      code: 'invalid_value',
      value: CEILING_POSITION,
      constraint: { principalKind: 'agent', permissionSet: MCP_AGENT_PERMISSION_SET_WRITE },
    });
  }

  const writers = [
    { label: 'a platform administrator', context: PLATFORM_ADMIN },
    { label: 'a system writer (invitation acceptance, demo accounts)', context: SYS_ORG },
    { label: 'a seed', context: SEED_ORG },
  ];

  it.each(writers)('an assignment by $label is refused, and nothing is stored', async ({ label, context }) => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_position', { user_id: 'u_person', position: CEILING_POSITION, organization_id: ORG }, { context } as any,
    ));
    expectPositionRefusal(err, label);
    expect(await positionsWhere(h, { user_id: 'u_person' })).toHaveLength(0);
  });

  it('an update that moves an assignment onto such a position is refused, and the stored row is untouched', async () => {
    const h = await boot();
    await h.engine.insert(
      'sys_user_position', { id: 'p1', user_id: 'u_person', position: PERSON_POSITION, organization_id: ORG },
      { context: PLATFORM_ADMIN } as any,
    );
    expectPositionRefusal(await refusalOf(() => h.engine.update(
      'sys_user_position', { id: 'p1', position: CEILING_POSITION }, { context: PLATFORM_ADMIN } as any,
    )), 'by id');
    expect((await positionsWhere(h, { id: 'p1' }))[0]?.position).toBe(PERSON_POSITION);
  });

  it('positive control: a position naming person sets is assigned, and its holder resolves them and no agent ceiling', async () => {
    const h = await boot();
    await h.engine.insert(
      'sys_user_position', { user_id: 'u_person', position: PERSON_POSITION, organization_id: ORG },
      { context: PLATFORM_ADMIN } as any,
    );
    expect((await positionsWhere(h, { user_id: 'u_person' }))[0]?.position).toBe(PERSON_POSITION);
    const names = ((await (h.plugin as any).resolvePermissionSetsForContext({
      userId: 'u_person', positions: [PERSON_POSITION], permissions: [PERSON_SET], tenantId: ORG,
    })) as PermissionSet[]).map((ps) => ps.name);
    expect(names).toContain(PERSON_SET);
    expect(names.some((name) => isAgentCeilingPermissionSet(name))).toBe(false);
  });
});

describe('the metadata door refuses a position definition naming an agent ceiling set', () => {
  function gate() {
    let registered: ((ctx: unknown) => unknown) | undefined;
    const protocol = {
      registerAuthoringGate: (type: string, fn: (ctx: unknown) => unknown) => {
        expect(type).toBe('position');
        registered = fn;
      },
    };
    expect(registerPositionAgentCeilingGate(protocol)).toBe(true);
    return registered!;
  }

  it.each([...MCP_AGENT_PERMISSION_SETS])('a position naming %s is refused, on a draft and an active save', async (setName) => {
    const judge = gate();
    for (const state of ['draft', 'active']) {
      const err = await refusalOf(async () => judge({
        type: 'position', name: 'qa_pos', state, body: { name: 'qa_pos', label: 'Q', permissionSets: [PERSON_SET, setName] },
      }));
      const env = envelopeOf(err);
      expect([env.status, env.code], state).toEqual([400, 'VALIDATION_FAILED']);
      expect(env.fields[0], state).toMatchObject({ field: 'permissionSets', code: 'invalid_value', value: setName });
    }
  });

  it('positive control: a position naming person sets, or none, passes', () => {
    const judge = gate();
    expect(judge({ type: 'position', name: 'qa_pos', state: 'active', body: { name: 'qa_pos', label: 'Q', permissionSets: [PERSON_SET] } })).toBeUndefined();
    expect(judge({ type: 'position', name: 'qa_pos', state: 'active', body: { name: 'qa_pos', label: 'Q' } })).toBeUndefined();
  });

  it('a protocol without the authoring-gate seam answers false', () => {
    expect(registerPositionAgentCeilingGate({})).toBe(false);
  });
});

describe("the deployment's baseline never names an agent ceiling set", () => {
  function constructionRefusal(options: ConstructorParameters<typeof SecurityPlugin>[0]): unknown {
    try {
      new SecurityPlugin(options);
    } catch (e) {
      return e;
    }
    throw new Error('expected the composition to be refused, but it constructed');
  }

  it.each([...MCP_AGENT_PERMISSION_SETS])('fallbackPermissionSet %s is refused at construction', (setName) => {
    const env = envelopeOf(constructionRefusal({ fallbackPermissionSet: setName }));
    expect([env.status, env.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(env.fields[0]).toMatchObject({ field: 'fallbackPermissionSet', code: 'invalid_value', value: setName });
  });

  it("an agent ceiling marked isDefault among the plugin's permission sets is refused as the baseline it would become", () => {
    const sets = [...securityDefaultPermissionSets.map((ps) => (
      ps.name === MCP_AGENT_PERMISSION_SET_READ ? { ...ps, isDefault: true } : ps
    ))] as PermissionSet[];
    const env = envelopeOf(constructionRefusal({ defaultPermissionSets: sets }));
    expect(env.fields[0]).toMatchObject({ field: 'fallbackPermissionSet', value: MCP_AGENT_PERMISSION_SET_READ });
  });

  it('acceptedDefaultPermissionSets naming one is refused at construction', () => {
    const env = envelopeOf(constructionRefusal({ acceptedDefaultPermissionSets: [PERSON_SET, MCP_AGENT_PERMISSION_SET_WRITE] }));
    expect(env.fields[0]).toMatchObject({ field: 'acceptedDefaultPermissionSets', value: MCP_AGENT_PERMISSION_SET_WRITE });
  });

  it('positive control: the platform baseline and a person set construct', () => {
    expect(() => new SecurityPlugin()).not.toThrow();
    expect(() => new SecurityPlugin({ fallbackPermissionSet: PERSON_SET, acceptedDefaultPermissionSets: [PERSON_SET] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('binds idempotently: a second start() on the same engine replaces the four hooks instead of doubling them', async () => {
    const h = await boot();
    expect(registerAgentCeilingGrantRefusal(h.engine as any)).toBe(true);
    expect((h.engine as any).unregisterHooksByPackage(AGENT_CEILING_GRANT_HOOK_PACKAGE)).toBe(4);
  });

  it('an engine with no hook registry is reported at warn, and the call answers false', () => {
    const warn = vi.fn();
    expect(registerAgentCeilingGrantRefusal({} as any, { warn })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling of record 6250748677 on #24164, letter E′ item 3 — the follow-up it
 * names] The shipped permission sets no longer repeat the row scope thirteen
 * identity objects declare as their own `defaultRowScope`: the seven SCIM
 * projection tables, the two credential tables, and the `select` self scope of
 * `sys_account`, `sys_team_member`, `sys_oauth_access_token` and
 * `sys_oauth_refresh_token`. Each dropped copy was byte-identical to its
 * object's declaration, and no shipped set carries a `'*'` read policy, so a
 * holder's `select` collection on those objects is now empty and collects the
 * object's default (`SecurityPlugin.collectRLSPolicies`) — the same literal.
 *
 * Five pins, booted on the real `SecurityPlugin` + `ObjectQL` over a real
 * `SqlDriver`, with the real declarations and the SHIPPED sets:
 *   1. Rows do not move. Every persona — the set holders, a user in no
 *      organization, the delegated agents (ruling of record 6278784335 on
 *      #24341, letter B) — is served exactly the ids listed below on every
 *      touched object, and exactly what the same deployment served with the
 *      dropped copies spread back into the sets. Three deployment shapes: the
 *      stock walled one, a walled one composing NO platform baseline (each
 *      principal resolves only the set it names — the shape the copies were
 *      repeated for), and `single`.
 *   2. Explain moves, as ruled: where a dropped copy used to be the row
 *      predicate, explain names the object's default (`via: 'object_default'`);
 *      the collection census says the same for every dropped object.
 *   3. What stays in the sets stays: `sys_user_self` (`all`) and every `all`
 *      self scope whose write arm differs from the `'*'` ownership floor, and
 *      the compliance ledger's `sys_audit_log_org`, whose copy is what makes
 *      the object's identical default a PLATFORM tenant policy
 *      (`platform-tenant-policies.ts` keys provenance off the shipped sets),
 *      so `single` strips it as it strips the copy.
 *   4. A set that authors its own policy for one of these objects has it used
 *      as authored: the object's default is not added beside it.
 *   5. No shipped set carries a policy for a dropped object.
 */

import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import * as PlatformObjects from '@objectstack/platform-objects';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { defaultPermissionSets } from './default-permission-sets.js';
import { SecurityPlugin } from '../security-plugin.js';
import { isObjectDefaultRowScopePolicy } from '../object-default-row-scope.js';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from '../__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './sys-user-position.object.js';
import { SysUserPermissionSet } from './sys-user-permission-set.object.js';
import { bindTestSecurityCatalog } from '../__tests__/security-catalog.testkit.js';
import { relaxTenantColumns } from '../pre-18-tenant-column.testkit.js';

type Policy = { name: string; object?: string; operation: string; using?: string; enabled?: boolean };
type ObjectDef = { name: string; fields?: Record<string, unknown>; defaultRowScope?: Policy };
type Persona = Record<string, unknown>;

/** The dropped copies, by the family that carried each. Every one names its object's declared default. */
const DROPPED = {
  scim: [
    'sys_scim_user',
    'sys_scim_subject',
    'sys_scim_projection_grant',
    'sys_scim_identity_tombstone',
    'sys_scim_group',
    'sys_scim_group_member',
    'sys_scim_connection_binding',
  ],
  credential: ['sys_verification', 'sys_jwks'],
  self: ['sys_account', 'sys_team_member', 'sys_oauth_access_token', 'sys_oauth_refresh_token'],
} as const;
const DROPPED_OBJECTS: readonly string[] = [...DROPPED.scim, ...DROPPED.credential, ...DROPPED.self];

/** Objects whose rows name the user they are about: a principal reads its own row. */
const USER_KEYED = new Set<string>([...DROPPED.scim.slice(0, 4), ...DROPPED.self]);
/** Objects no principal below platform admin reads a row of. */
const NO_ROW = new Set<string>([...DROPPED.scim.slice(4), ...DROPPED.credential]);
/** The touched objects that declare `access: { default: 'private' }`. */
const PRIVATE = new Set<string>(['sys_verification', 'sys_jwks', 'sys_oauth_access_token', 'sys_oauth_refresh_token']);
const LEDGER = 'sys_audit_log';
/** Every object this pin reads: the dropped thirteen and the ledger, whose copy stays. */
const TOUCHED: readonly string[] = [...DROPPED_OBJECTS, LEDGER];

/** The `all` self scopes the sets keep (their write arm differs from the `'*'` ownership floor). */
const KEPT_ALL = [
  'sys_session',
  'sys_two_factor',
  'sys_user_preference',
  'sys_api_key',
  'sys_device_code',
  'sys_oauth_consent',
  'sys_oauth_application',
  'sys_organization',
] as const;

function isObjectDef(v: unknown): v is ObjectDef {
  return typeof v === 'object' && v !== null && typeof (v as ObjectDef).name === 'string'
    && typeof (v as ObjectDef).fields === 'object';
}

/** The objects `AuditPlugin` registers — `sys_audit_log` is plugin-audit's (ADR-0029 K2). */
async function auditPluginObjects(): Promise<ObjectDef[]> {
  const registered: Array<{ objects?: ObjectDef[] }> = [];
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    getService: (name: string) =>
      name === 'manifest' ? { register: (m: { objects?: ObjectDef[] }) => registered.push(m) } : undefined,
    registerService() {},
    hook() {},
  };
  await new AuditPlugin().init(ctx);
  return registered.flatMap((m) => m.objects ?? []);
}

async function registeredObjects(): Promise<Map<string, ObjectDef>> {
  const byName = new Map<string, ObjectDef>();
  for (const v of Object.values(PlatformObjects)) if (isObjectDef(v)) byName.set(v.name, v);
  for (const o of await auditPluginObjects()) byName.set(o.name, o);
  return byName;
}

/** The sets that spread the dropped copies (`organization_admin_no_bypass` is derived from the first). */
const SPREADING_SETS = ['organization_admin', 'organization_admin_no_bypass', 'member_default', 'viewer_readonly'];

/**
 * The shipped sets with the dropped copies spread back in, each as the object's
 * declaration spells it plus `object` — the literal the sets carried. A set that
 * already carries one (the tree before this change) is left as it is.
 */
function withCopiesRestored(objects: Map<string, ObjectDef>): PermissionSet[] {
  return defaultPermissionSets.map((set) => {
    if (!SPREADING_SETS.includes(set.name)) return set;
    const held = new Set((set.rowLevelSecurity ?? []).map((p) => p.object));
    const copies = DROPPED_OBJECTS.filter((o) => !held.has(o)).map((o) => ({
      ...objects.get(o)!.defaultRowScope!,
      object: o,
      enabled: true,
    }));
    return { ...set, rowLevelSecurity: [...(set.rowLevelSecurity ?? []), ...copies] } as PermissionSet;
  });
}

/** An application set that authors its own `select` policy for `sys_account`: no row. */
const AUTHORED_ACCOUNT_SET = {
  name: 'qa_account_authored',
  label: 'QA — authored sys_account scope',
  objects: {},
  rowLevelSecurity: [{ name: 'qa_sys_account_none', object: 'sys_account', operation: 'select', using: 'id == null', enabled: true }],
} as unknown as PermissionSet;

/** Organization X: `u_x`, `u_x2`, `a_x`. Organization Y: `u_y`. `u_loner` belongs to none. */
const ORG_X_USERS = ['u_x', 'u_x2', 'a_x'];
const USERS = ['u_x', 'u_x2', 'a_x', 'u_y', 'u_loner', 'p_admin'];
const ORG_OF: Record<string, string | null> = { u_x: 'org_x', u_x2: 'org_x', a_x: 'org_x', u_y: 'org_y', u_loner: null, p_admin: null };

const human = (userId: string, positions: string[], permissions: string[], posture: string): Persona => ({
  userId, tenantId: 'org_x', positions, permissions, posture, org_user_ids: ORG_X_USERS, email: `${userId}@example.test`,
});
/** An MCP OAuth agent as core's `assembleExecutionContext` shapes it: `userId` is the delegator (ADR-0090 D10). */
const agent = (userId: string, posture: string): Persona => ({
  userId, tenantId: 'org_x', positions: [], permissions: ['mcp_agent_data_read'], principalKind: 'agent',
  onBehalfOf: { userId, principalKind: 'human' }, posture, org_user_ids: ORG_X_USERS, email: `${userId}@example.test`,
});

const PERSONAS: Record<string, Persona> = {
  member_default: human('u_x', ['org_member'], ['member_default'], 'MEMBER'),
  viewer_readonly: human('u_x2', ['org_member'], ['viewer_readonly'], 'MEMBER'),
  organization_admin: human('a_x', ['org_admin'], ['organization_admin'], 'TENANT_ADMIN'),
  organization_admin_no_bypass: human('a_x', ['org_admin'], ['organization_admin_no_bypass'], 'TENANT_ADMIN'),
  // The resolver's answer for a user in no organization: no positions, no sets
  // of their own, the peer list seeded with themself alone.
  'user with no organization': {
    userId: 'u_loner', positions: [], permissions: [], posture: 'MEMBER', org_user_ids: ['u_loner'], email: 'u_loner@example.test',
  },
  'mcp agent for the member': agent('u_x', 'MEMBER'),
  'mcp agent for the viewer': agent('u_x2', 'MEMBER'),
  'mcp agent for the organization admin': agent('a_x', 'TENANT_ADMIN'),
  platform_admin: { userId: 'p_admin', tenantId: 'org_x', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' },
};

interface Shape {
  label: string;
  posture: 'isolated' | 'single';
  baseline: boolean;
  personas: string[];
}

const HUMANS = ['member_default', 'viewer_readonly', 'organization_admin', 'organization_admin_no_bypass'];
const AGENTS = ['mcp agent for the member', 'mcp agent for the viewer', 'mcp agent for the organization admin'];
const SHAPES: Shape[] = [
  {
    label: 'isolated posture, platform baseline composed (the stock shape)',
    posture: 'isolated', baseline: true,
    personas: [...HUMANS, 'user with no organization', ...AGENTS, 'platform_admin'],
  },
  {
    // The shape the copies were repeated for: each principal resolves only the
    // set it names, so the object's default is the only scope a set no longer
    // carrying the copy can lean on.
    label: 'isolated posture, NO platform baseline (each set on its own)',
    posture: 'isolated', baseline: false,
    personas: [...HUMANS, 'mcp agent for the viewer', 'mcp agent for the organization admin', 'platform_admin'],
  },
  {
    label: 'single posture, platform baseline composed',
    posture: 'single', baseline: true,
    personas: [...HUMANS, 'user with no organization', ...AGENTS, 'platform_admin'],
  },
];

/** A plausible value for a required column the fixture does not care about. */
function filler(type: string, key: string): unknown {
  if (type === 'boolean') return true;
  if (type === 'number' || type === 'currency' || type === 'percent') return 0;
  if (type === 'datetime' || type === 'date') return '2026-01-01T00:00:00.000Z';
  return key;
}

/** One row of `schema`: every required column filled, then those of `values` it declares. */
function rowOf(schema: ObjectDef, values: Record<string, unknown>): Record<string, unknown> {
  const fields = (schema.fields ?? {}) as Record<string, { type: string; required?: boolean }>;
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(fields)) if (def.required) out[name] = filler(def.type, `${name}-${String(values.id)}`);
  for (const [name, value] of Object.entries(values)) if (name === 'id' || name in fields) out[name] = value;
  return out;
}

/** The ledger's rows: one about each organization, one about a deployment-level action. */
const LEDGER_ROWS = { org_x: 'sys_audit_log:org_x', org_y: 'sys_audit_log:org_y', deployment: 'sys_audit_log:deployment' };

/** The rows written for `object`: one per user, each user's own where it names one, in that user's organization. */
function fixtureRowsFor(schema: ObjectDef): Array<Record<string, unknown>> {
  if (schema.name === 'sys_user') return USERS.map((id) => rowOf(schema, { id, name: id, email: `${id}@example.test` }));
  if (schema.name === 'sys_organization') return ['org_x', 'org_y'].map((id) => rowOf(schema, { id, name: id, slug: id }));
  if (schema.name === LEDGER) {
    return [
      rowOf(schema, { id: LEDGER_ROWS.org_x, tenant_id: 'org_x', user_id: 'u_x' }),
      rowOf(schema, { id: LEDGER_ROWS.org_y, tenant_id: 'org_y', user_id: 'u_y' }),
      rowOf(schema, { id: LEDGER_ROWS.deployment, tenant_id: null, user_id: 'p_admin' }),
    ];
  }
  return USERS.map((user) => rowOf(schema, { id: `${schema.name}:${user}`, user_id: user, organization_id: ORG_OF[user] }));
}

const engines: ObjectQL[] = [];
afterAll(async () => {
  for (const engine of engines.splice(0)) {
    try { await engine.destroy(); } catch { /* noop */ }
  }
});

async function boot(shape: Shape, sets: PermissionSet[]) {
  const objects = await registeredObjects();
  const schemas = [...new Set([...TOUCHED, ...KEPT_ALL, 'sys_user', 'sys_member'])].map((n) => objects.get(n)!);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.shipped-sets-identity-default-row-scope',
    name: 'Shipped sets identity default row scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [...schemas, SysUserPermissionSet, SysUserPosition],
  } as never);
  await engine.syncSchemas();
  // The organization-less rows below exist only on a store built before 18.x
  // (ADR-0131 D1 makes a fresh tenant column NOT NULL): this is that store.
  await relaxTenantColumns(engine, ['sys_user_permission_set', 'sys_user_preference']);
  for (const o of [SysPosition, SysPermissionSet, SysPositionPermissionSet]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as never, 'qa.authz-read-set');
  }

  const services: Record<string, unknown> = {
    ...(shape.posture === 'isolated' ? { 'org-scoping': { name: 'com.objectstack.org-scoping' } } : {}),
    tenancy: { posture: shape.posture },
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: { get: async (_t: string, name: string) => engine.getSchema(name) ?? null, list: async () => sets },
  };
  let security: any;
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, impl: unknown) => { if (name === 'security') security = impl; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ defaultPermissionSets: sets, ...(shape.baseline ? {} : { fallbackPermissionSet: null }) });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The catalog the grants name their sets in (ADR-0131 D3/D4).
  bindTestSecurityCatalog(engine, { permissions: sets as never });
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const knex = (driver as unknown as { knex: (t: string) => { insert(rows: object[]): Promise<unknown> } }).knex;
  for (const schema of schemas) if (schema.name !== 'sys_member') await knex(schema.name).insert(fixtureRowsFor(schema));
  // What an agent's delegator resolves from (ADR-0090 D10: the delegator leg is
  // rebuilt from the store): the memberships, and the grants the viewer and the
  // administrator hold.
  const member = objects.get('sys_member')!;
  await knex('sys_member').insert([
    ['u_x', 'org_x', 'member'], ['u_x2', 'org_x', 'member'], ['a_x', 'org_x', 'admin'], ['u_y', 'org_y', 'member'],
  ].map(([user, org, role]) => rowOf(member, { id: `mem:${user}`, user_id: user, organization_id: org, role })));
  await knex('sys_user_permission_set').insert([
    { id: 'ups:u_x2', user_id: 'u_x2', permission_set: 'viewer_readonly', organization_id: 'org_x' },
    {
      id: 'ups:a_x', user_id: 'a_x', organization_id: 'org_x',
      permission_set: shape.posture === 'single' ? 'organization_admin_no_bypass' : 'organization_admin',
    },
    { id: 'ups:p_admin', user_id: 'p_admin', permission_set: 'admin_full_access', organization_id: null },
  ]);

  const read = async (object: string, persona: Persona): Promise<string[] | string> => {
    try {
      const rows = (await engine.find(object, { context: { ...persona } } as never)) as Array<{ id: string }>;
      return rows.map((r) => r.id).sort();
    } catch (e) {
      const err = e as { code?: string; status?: number };
      return `refused ${err.code} ${err.status}`;
    }
  };
  // [#23181] Each (object, persona) read once per stack. No case writes after
  // the seeding above, so a second read of the same pair answers what the first
  // did; the pins that read a pair twice (the per-object sweep and the
  // restored-copies comparison) read the same verdict, read once.
  const reads = new Map<string, Promise<string[] | string>>();
  const served = async (object: string, persona: Persona): Promise<string[] | string> => {
    const key = `${object} :: ${JSON.stringify(persona)}`;
    let answer = reads.get(key);
    if (!answer) {
      answer = read(object, persona);
      reads.set(key, answer);
    }
    const value = await answer;
    return Array.isArray(value) ? [...value] : value;
  };
  /** The (object, operation) pairs at which `persona`'s collection is an object default. */
  const census = async (persona: Persona, objectNames: readonly string[], operations: readonly string[]): Promise<string[]> => {
    const held = await (plugin as any).resolvePermissionSetsForContext({ ...persona });
    const applied: string[] = [];
    for (const object of objectNames) {
      for (const operation of operations) {
        const collected = (plugin as any).collectRLSPolicies(held, object, operation, (persona.positions ?? []) as string[], { ...persona });
        if (collected.some((p: object) => isObjectDefaultRowScopePolicy(p))) applied.push(`${object} ${operation}`);
      }
    }
    return applied;
  };
  /** The policy names `persona`'s collection carries for `object` and `operation`. */
  const collectedNames = async (persona: Persona, object: string, operation: string): Promise<string[]> => {
    const held = await (plugin as any).resolvePermissionSetsForContext({ ...persona });
    const collected = (plugin as any).collectRLSPolicies(held, object, operation, (persona.positions ?? []) as string[], { ...persona });
    return collected.map((p: Policy) => `${p.name}${isObjectDefaultRowScopePolicy(p) ? ' (object default)' : ''}`).sort();
  };
  return { engine, security, served, census, collectedNames };
}

// [#23181] The first boot's first loads (the driver's and the plugin's cold
// paths, the first secured read) are paid here, at module scope, outside every
// case's clock: clocked windows measure behaviour, never loading. Nothing this
// stack answers is read; the file's `afterAll` destroys it with the rest.
await (await boot(SHAPES[0], defaultPermissionSets)).served(TOUCHED[0], PERSONAS.member_default);

/**
 * [#23181] One stack per (shape, set list), booted by the first describe that
 * asks for it and shared by the rest. Every case here only reads (`served`,
 * `explain`, the collections), so a describe reads the stack it would have
 * booted; the explain and must-keep describes ask the first shape's two stacks
 * the per-shape sweep already booted.
 */
const stacks = new Map<string, Promise<Awaited<ReturnType<typeof boot>>>>();
function stackFor(shape: Shape, sets: 'shipped' | 'restored') {
  const key = `${shape.label} :: ${sets}`;
  let stack = stacks.get(key);
  if (!stack) {
    stack = sets === 'shipped'
      ? boot(shape, defaultPermissionSets)
      : registeredObjects().then((objects) => boot(shape, withCopiesRestored(objects)));
    stacks.set(key, stack);
  }
  return stack;
}

/** The user whose rows a persona reads as its own: the delegator, for an agent. */
const selfOf = (persona: Persona): string =>
  String((persona.onBehalfOf as { userId?: string } | undefined)?.userId ?? persona.userId);

/**
 * The ids each persona is served on each touched object, written out per
 * family. The same answer before the copies were dropped and after: the pin
 * runs unchanged on both trees.
 */
function expectedServed(shape: Shape, personaName: string, object: string): string[] | string {
  const persona = PERSONAS[personaName];
  const everyRow = (o: string) => (o === LEDGER ? Object.values(LEDGER_ROWS) : USERS.map((u) => `${o}:${u}`)).sort();
  if (personaName === 'platform_admin') return everyRow(object);
  // A read ceiling's `'*'` does not reach a `private` object (ADR-0090 D10's
  // listed subtraction): the agent is refused there, before any row scope.
  if (persona.principalKind === 'agent' && PRIVATE.has(object)) return 'refused PERMISSION_DENIED 403';
  if (USER_KEYED.has(object)) return [`${object}:${selfOf(persona)}`];
  if (NO_ROW.has(object)) return [];
  // The ledger: `member_default` grants no read on it, so a member — and an
  // agent bounded by a member — is refused at the object layer; a viewer's
  // wildcard read and an org admin's explicit entry reach it, scoped to the
  // active organization under a wall and unscoped under `single`, where the
  // platform's tenant policy is stripped (ADR-0105 D3).
  const reader = ['viewer_readonly', 'organization_admin', 'organization_admin_no_bypass',
    'mcp agent for the viewer', 'mcp agent for the organization admin'].includes(personaName);
  if (!reader) return 'refused PERMISSION_DENIED 403';
  return shape.posture === 'single' ? everyRow(LEDGER) : [LEDGER_ROWS.org_x];
}

describe.each(SHAPES)('the shipped sets serve the identity objects as before — $label', (shape) => {
  let shipped: Awaited<ReturnType<typeof boot>>;
  let restored: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    shipped = await stackFor(shape, 'shipped');
    restored = await stackFor(shape, 'restored');
  });

  // One case per object, not one sweep over all of them: the restored-copies
  // sweep was about 400 real-stack reads in a single case, which a loaded
  // runner pushed past the 5000ms default on `main` as on any branch (#26065).
  // Per object it is one persona column: the same reads and the same verdicts,
  // each case a few dozen of them, and a failure names its object.
  it.each(TOUCHED)('every persona is served exactly the listed ids on %s', async (object) => {
    const wrong: string[] = [];
    for (const persona of shape.personas) {
      const now = await shipped.served(object, PERSONAS[persona]);
      const want = expectedServed(shape, persona, object);
      if (JSON.stringify(now) !== JSON.stringify(want)) wrong.push(`${persona} on ${object}: ${JSON.stringify(now)} (expected ${JSON.stringify(want)})`);
    }
    expect(wrong).toEqual([]);
  });

  it.each([...TOUCHED, ...KEPT_ALL, 'sys_user'])('…and exactly what the same deployment serves on %s with the dropped copies spread back into the sets', async (object) => {
    const moved: string[] = [];
    for (const persona of shape.personas) {
      const was = await restored.served(object, PERSONAS[persona]);
      const now = await shipped.served(object, PERSONAS[persona]);
      if (JSON.stringify(now) !== JSON.stringify(was)) moved.push(`${persona} on ${object}: ${JSON.stringify(was)} -> ${JSON.stringify(now)}`);
    }
    expect(moved).toEqual([]);
  });

  it('CONTROL: the fixture holds rows a scoped persona must not read — the platform administrator reads them all', async () => {
    for (const object of DROPPED_OBJECTS) {
      expect(await shipped.served(object, PERSONAS.platform_admin), object).toHaveLength(USERS.length);
    }
    expect(await shipped.served(LEDGER, PERSONAS.platform_admin)).toHaveLength(3);
  });
});

describe('explain names the object default where a dropped copy used to be the row predicate (ruling E′ item 3)', () => {
  const shape = SHAPES[0];
  let shipped: Awaited<ReturnType<typeof boot>>;
  let restored: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    shipped = await stackFor(shape, 'shipped');
    restored = await stackFor(shape, 'restored');
  });
  type RlsLayer = { layer: string; verdict: string; detail: string; record?: { rules: Array<Record<string, unknown>> } };
  const rlsLayer = (decision: { layers: RlsLayer[] }): RlsLayer => {
    const layer = decision.layers.find((l) => l.layer === 'rls');
    if (!layer) throw new Error('explain returned no rls layer');
    return layer;
  };

  it.each([
    ['SCIM', 'sys_scim_user', 'sys_scim_user_self'],
    ['self', 'sys_account', 'sys_account_self'],
  ])('%s family: a member\'s read of its own %s row is explained by the object default %s', async (_family, object, policy) => {
    const member = PERSONAS.member_default;
    const request = { object, operation: 'read', recordId: `${object}:u_x` };
    const now = rlsLayer(await shipped.security.explain(request, { ...member }));
    expect(now.record?.rules).toEqual([expect.objectContaining({ kind: 'rls_policy', name: policy, via: 'object_default', effect: 'admits' })]);
    // The tree with the copy: the same verdict, attributed to the held set.
    const was = rlsLayer(await restored.security.explain(request, { ...member }));
    expect(was.record?.rules).toEqual([expect.objectContaining({ kind: 'rls_policy', name: 'business_rls', effect: 'admits' })]);
    expect(was.record?.rules?.[0]?.via).toBeUndefined();
  });

  it.each([
    ['SCIM', 'sys_scim_group', 'sys_scim_group_none'],
    ['credential', 'sys_verification', 'sys_verification_none'],
    ['credential', 'sys_jwks', 'sys_jwks_none'],
  ])('%s family: the object-level read of %s names the object default %s as its source', async (_family, object, policy) => {
    for (const persona of HUMANS) {
      const now = rlsLayer(await shipped.security.explain({ object, operation: 'read' }, { ...PERSONAS[persona] }));
      expect(now.detail, persona).toContain(`object default row scope '${policy}'`);
      const was = rlsLayer(await restored.security.explain({ object, operation: 'read' }, { ...PERSONAS[persona] }));
      expect(was.detail, persona).not.toContain('object default');
      expect(now.verdict, persona).toBe(was.verdict);
    }
  });

  it('census: every human persona collects the object default on exactly the dropped objects\' `select`; a delegated leg collects none', async () => {
    const COLLECTED = ['select', 'insert', 'update', 'delete'] as const;
    const every = [...DROPPED_OBJECTS, LEDGER, ...KEPT_ALL, 'sys_user'];
    for (const persona of [...HUMANS, 'user with no organization']) {
      expect(await shipped.census(PERSONAS[persona], every, COLLECTED), persona).toEqual(DROPPED_OBJECTS.map((o) => `${o} select`));
      // CONTROL: with the copies spread back no persona collects a default.
      expect(await restored.census(PERSONAS[persona], every, COLLECTED), `${persona}, copies restored`).toEqual([]);
    }
    // [ruling B] The agent's own leg — the ceiling — collects no default.
    for (const persona of AGENTS) expect(await shipped.census(PERSONAS[persona], every, COLLECTED), persona).toEqual([]);
  });
});

describe('what the sets keep (pointer 6280763190, must-keep; the ledger, measured)', () => {
  let walled: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    walled = await stackFor(SHAPES[0], 'shipped');
  });

  it('a member\'s write collection on each kept `all` object carries the set\'s self scope beside the ownership floor, never the default', async () => {
    const member = PERSONAS.member_default;
    for (const object of [...KEPT_ALL, 'sys_user']) {
      const self = object === 'sys_user' ? 'sys_user_self' : `${object}_self`;
      for (const operation of ['update', 'delete']) {
        const floor = operation === 'update' ? 'owner_only_writes' : 'owner_only_deletes';
        expect(await walled.collectedNames(member, object, operation), `${object} ${operation}`).toEqual([floor, self].sort());
      }
    }
  });

  it('`sys_user_self` stays `all` in member_default, and the ledger copy stays in every set that spread it', () => {
    const member = defaultPermissionSets.find((s) => s.name === 'member_default')!;
    expect((member.rowLevelSecurity ?? []).find((p) => p.name === 'sys_user_self')?.operation).toBe('all');
    for (const setName of SPREADING_SETS) {
      const set = defaultPermissionSets.find((s) => s.name === setName)!;
      expect((set.rowLevelSecurity ?? []).filter((p) => p.object === LEDGER).map((p) => p.name), setName).toEqual(['sys_audit_log_org']);
    }
  });
});

describe('an authored policy for one of these objects is used as authored (ruling E′ item 2)', () => {
  let shipped: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    shipped = await boot(SHAPES[0], [...defaultPermissionSets, AUTHORED_ACCOUNT_SET]);
  });

  // While `member_default` carried its `sys_account_self` copy, that copy was
  // OR-ed in beside the authored policy and this holder read its own row: an
  // authored scope leaving out the holder's own rows was widened back to them.
  it('a member holding a set that authors a `sys_account` scope is served what that scope admits — the object default is not added beside it', async () => {
    const holder = { ...PERSONAS.member_default, permissions: ['member_default', AUTHORED_ACCOUNT_SET.name] };
    expect(await shipped.served('sys_account', holder)).toEqual([]);
    expect(await shipped.collectedNames(holder, 'sys_account', 'select')).toEqual(['qa_sys_account_none']);
    // CONTROL: the same member without the authored set reads its own row under the default.
    expect(await shipped.served('sys_account', PERSONAS.member_default)).toEqual(['sys_account:u_x']);
  });
});

describe('no shipped set carries a policy for a dropped object', () => {
  it('CONTROL: the fixture\'s families read off the declarations — every dropped object declares a default, the private ones `private`', async () => {
    const objects = await registeredObjects();
    for (const object of TOUCHED) expect(objects.get(object)?.defaultRowScope?.operation, object).toBe('select');
    const declaredPrivate = TOUCHED.filter(
      (o) => (objects.get(o) as { access?: { default?: string } } | undefined)?.access?.default === 'private',
    );
    expect(declaredPrivate.sort()).toEqual([...PRIVATE].sort());
  });

  it.each(DROPPED_OBJECTS)('%s', (object) => {
    for (const set of defaultPermissionSets) {
      expect((set.rowLevelSecurity ?? []).filter((p) => p.object === object).map((p) => p.name), set.name).toEqual([]);
    }
  });
});

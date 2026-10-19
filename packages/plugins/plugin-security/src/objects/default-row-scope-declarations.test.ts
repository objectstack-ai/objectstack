// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0095 D1, 2026-10-18 note; ruling of record 6250748677 on #24164, letter
 * E′ items 3 and 5] The platform identity objects declare their default row
 * scope (`ObjectSchema.defaultRowScope`), and what each declares is the policy
 * this package's shipped permission sets carry for that object today — read
 * here off `defaultPermissionSets`, never retyped.
 *
 * Four pins:
 *   1. The declarers are exactly the 23 objects the ruling names: every object
 *      `@objectstack/platform-objects` and `@objectstack/plugin-audit` register
 *      that declares a default is on the list, every listed object declares
 *      one, and the platform-global objects declare none (item 5).
 *   2. Each declaration is the shipped literal with `object` dropped: same
 *      name, operation and predicate as the baseline set's policy for the
 *      object, and every shipped set that carries a policy for it carries the
 *      same predicate.
 *   3. `sys_user` is the one merge: the key holds one policy, so its two
 *      shipped literals (`sys_user_self`, `sys_user_org_members`) are joined
 *      with `||`, and the merged predicate admits exactly the union of the two
 *      literals' rows whenever `org_user_ids` is resolved. The same holds on
 *      each user-context producer's real context:
 *      `service-automation/src/sys-user-default-row-scope.integration.test.ts`.
 *   4. The security plugin's collection applies a declared default where the
 *      caller's held sets carry no row policy for the object and operation, and
 *      the shipped sets keep their spreads: a deployment with the shipped
 *      baseline serves every persona the rows it served before the
 *      declarations, and the census names where a default is now collected.
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import * as PlatformObjects from '@objectstack/platform-objects';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { defaultPermissionSets } from './default-permission-sets.js';
import { RLSCompiler } from '../rls-compiler.js';
import { SecurityPlugin } from '../security-plugin.js';
import { isObjectDefaultRowScopePolicy } from '../object-default-row-scope.js';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from '../__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './sys-user-position.object.js';
import { SysUserPermissionSet } from './sys-user-permission-set.object.js';

type Policy = {
  name: string;
  object?: string;
  operation: string;
  using?: string;
  check?: string;
  positions?: string[];
  enabled?: boolean;
};
type ObjectDef = { name: string; fields?: Record<string, unknown>; defaultRowScope?: Policy };

/** The 23 declarers ruling E′ item 3 names, by the literal family that carries each today. */
const DECLARERS = [
  // `scimProjectionRowScope`
  'sys_scim_user',
  'sys_scim_subject',
  'sys_scim_projection_grant',
  'sys_scim_identity_tombstone',
  'sys_scim_group',
  'sys_scim_group_member',
  'sys_scim_connection_binding',
  // `privateCredentialRowScope`
  'sys_verification',
  'sys_jwks',
  // the identity `_self` / `_org_members` carve-outs
  'sys_organization',
  'sys_user',
  'sys_session',
  'sys_account',
  'sys_team_member',
  'sys_two_factor',
  'sys_user_preference',
  'sys_api_key',
  'sys_device_code',
  'sys_oauth_access_token',
  'sys_oauth_refresh_token',
  'sys_oauth_consent',
  'sys_oauth_application',
  // `auditLedgerRowScope`
  'sys_audit_log',
] as const;

/** Ruling E′ item 5: the platform-global objects declare no default. */
const PLATFORM_GLOBAL = /^(sys_metadata|sys_job|sys_migration)|^(sys_platform_setting|sys_presence|sys_flow_dispatch)$/;

function isObjectDef(v: unknown): v is ObjectDef {
  return (
    typeof v === 'object' && v !== null && typeof (v as ObjectDef).name === 'string'
    && typeof (v as ObjectDef).fields === 'object'
  );
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

const setNamed = (name: string) => {
  const set = defaultPermissionSets.find((s) => s.name === name);
  if (!set) throw new Error(`shipped set ${name} not found`);
  return set;
};
const policiesFor = (setName: string, object: string): Policy[] =>
  ((setNamed(setName).rowLevelSecurity ?? []) as Policy[]).filter((p) => p.object === object);

/** The declaration as the shipped literal spells it: `object` implied, `enabled` defaulted. */
const asLiteral = (object: string, scope: Policy): Policy => ({ ...scope, object, enabled: scope.enabled ?? true });

describe('the platform identity objects declare their default row scope (ruling E′ items 3 and 5)', () => {
  it('the declarers are exactly the 23 the ruling names, and the platform-global objects declare none', async () => {
    const objects = await registeredObjects();
    const declaring = [...objects.values()].filter((o) => o.defaultRowScope !== undefined).map((o) => o.name);

    expect([...declaring].sort()).toEqual([...DECLARERS].sort());
    expect(DECLARERS).toHaveLength(23);

    const platformGlobal = [...objects.keys()].filter((n) => PLATFORM_GLOBAL.test(n));
    // The census reached them: the item-5 list is not vacuous here.
    expect(platformGlobal).toEqual(expect.arrayContaining(['sys_metadata', 'sys_job', 'sys_migration', 'sys_platform_setting']));
    for (const name of platformGlobal) expect(objects.get(name)!.defaultRowScope, name).toBeUndefined();
  });

  it.each(DECLARERS.filter((n) => n !== 'sys_user'))(
    '%s declares the baseline set\'s literal for it, with `object` dropped',
    async (object) => {
      const declared = (await registeredObjects()).get(object)!.defaultRowScope!;
      const [baseline, ...more] = policiesFor('member_default', object);
      expect(more).toEqual([]);
      expect(asLiteral(object, declared)).toEqual(baseline);
      expect('object' in declared).toBe(false);

      // The organization-admin set carries the same literal, and every shipped
      // set that carries a policy for the object carries the same predicate.
      expect(policiesFor('organization_admin', object)).toEqual([baseline]);
      for (const set of defaultPermissionSets) {
        for (const p of policiesFor(set.name, object)) {
          expect({ set: set.name, name: p.name, using: p.using }).toEqual({
            set: set.name,
            name: declared.name,
            using: declared.using,
          });
        }
      }
    },
  );

  it('sys_user declares its two shipped literals as one `select` policy, the predicates joined with `||`', async () => {
    const declared = (await registeredObjects()).get('sys_user')!.defaultRowScope!;
    for (const setName of ['organization_admin', 'member_default', 'viewer_readonly']) {
      const self = policiesFor(setName, 'sys_user').find((p) => p.name === 'sys_user_self')!;
      const peers = policiesFor(setName, 'sys_user').find((p) => p.name === 'sys_user_org_members')!;
      expect(declared.using).toBe(`${self.using} || ${peers.using}`);
      // The peer arm is `select` in every set; the merged policy keeps it there.
      expect(peers.operation).toBe('select');
    }
    expect(declared).toMatchObject({ name: 'sys_user_self_or_org_members', operation: 'select' });
    expect(policiesFor('organization_admin', 'sys_user').map((p) => p.operation)).toEqual(['select', 'select']);
  });
});

/**
 * The rows a compiled filter admits, over a fixture — the three shapes the two
 * literals compile to (`{ id }`, `{ id: { $in } }`, `{ $or }`) and the deny
 * filter, which is itself an `{ id }` no row carries.
 */
function admits(filter: Record<string, unknown> | null, rows: Array<{ id: string }>): string[] {
  const match = (f: Record<string, unknown>, row: { id: string }): boolean =>
    Object.entries(f).every(([k, v]) => {
      if (k === '$or') return (v as Record<string, unknown>[]).some((g) => match(g, row));
      if (k === '$and') return (v as Record<string, unknown>[]).every((g) => match(g, row));
      const cell = (row as Record<string, unknown>)[k];
      if (v !== null && typeof v === 'object') {
        const ops = v as Record<string, unknown>;
        if (Object.keys(ops).some((op) => op !== '$in' && op !== '$eq')) {
          throw new Error(`fixture matcher: unhandled operator in ${JSON.stringify(ops)}`);
        }
        if ('$in' in ops && !(ops.$in as unknown[]).includes(cell)) return false;
        if ('$eq' in ops && ops.$eq !== cell) return false;
        return true;
      }
      return cell === v;
    });
  if (filter === null) return rows.map((r) => r.id);
  return rows.filter((r) => match(filter, r)).map((r) => r.id);
}

describe('sys_user\'s merged predicate admits the union of its two literals\' rows (rider: the key is one policy)', () => {
  const rows = ['u_me', 'u_peer_a', 'u_peer_b', 'u_stranger'].map((id) => ({ id }));
  const contexts = {
    'peers resolved': { userId: 'u_me', tenantId: 'org_1', org_user_ids: ['u_me', 'u_peer_a', 'u_peer_b'] },
    'peers resolved, self not among them': { userId: 'u_me', tenantId: 'org_1', org_user_ids: ['u_peer_a'] },
    'no organization (the resolver seeds [])': { userId: 'u_me', org_user_ids: [] },
  };

  it.each(Object.entries(contexts))('%s', async (_label, ctx) => {
    const declared = (await registeredObjects()).get('sys_user')!.defaultRowScope!;
    const merged = asLiteral('sys_user', declared) as any;
    const literals = policiesFor('organization_admin', 'sys_user') as any[];
    const compiler = new RLSCompiler();

    const mergedRows = admits(compiler.compileFilter([merged], ctx as any), rows);
    const unionRows = [
      ...new Set(literals.flatMap((p) => admits(compiler.compileFilter([p], ctx as any), rows))),
    ].sort();
    // Both literals, as the shipped sets OR-combine them, admit the same set.
    expect(admits(compiler.compileFilter(literals, ctx as any), rows).sort()).toEqual(unionRows);
    expect(mergedRows.sort()).toEqual(unionRows);
    expect(mergedRows).toContain('u_me');
    expect(mergedRows).not.toContain('u_stranger');
  });

  it('measured divergence: with `org_user_ids` unresolved the merged policy fails closed whole, own row included', async () => {
    const declared = (await registeredObjects()).get('sys_user')!.defaultRowScope!;
    const compiler = new RLSCompiler();
    const ctx = { userId: 'u_me', tenantId: 'org_1' } as any;
    expect(admits(compiler.compileFilter([asLiteral('sys_user', declared) as any], ctx), rows)).toEqual([]);
    // The two literals apart keep the self arm.
    expect(admits(compiler.compileFilter(policiesFor('organization_admin', 'sys_user') as any, ctx), rows)).toEqual(['u_me']);
  });
});

/**
 * [#24164 ruling E′ item 6; #24340's review of record, ③.11] A deployment
 * with the shipped baseline serves byte-for-byte what it served before the
 * identity objects declared their defaults, now that the security plugin's
 * collection applies a declared default wherever the caller's held sets carry
 * no row policy for the object and operation.
 *
 * Booted on the real `SecurityPlugin` + `ObjectQL` over a real `SqlDriver`,
 * with every declarer as this tree declares it ("after") and the same objects
 * with `defaultRowScope` dropped ("before"), the shipped sets, and the
 * platform baseline composed. Each persona reads every declarer, and is
 * explained for every operation, identically in both; the census then names
 * every persona, object and operation where the declared default is what the
 * collection now applies.
 */

type Persona = Record<string, unknown>;

/** Organisation X: `u_x` and `u_x2`. Organisation Y: `u_y`. `u_loner` belongs to none. */
const ORG_X_USERS = ['u_x', 'u_x2'];
const BASELINE_USERS = ['u_x', 'u_x2', 'u_y', 'u_loner', 'a_x', 'p_admin'];

const BASELINE_PERSONAS: Record<string, Persona> = {
  member: {
    userId: 'u_x', tenantId: 'org_x', positions: ['org_member'], permissions: ['member_default'],
    posture: 'MEMBER', org_user_ids: ORG_X_USERS, email: 'u_x@example.test',
  },
  viewer: {
    userId: 'u_x2', tenantId: 'org_x', positions: ['org_member'], permissions: ['viewer_readonly'],
    posture: 'MEMBER', org_user_ids: ORG_X_USERS, email: 'u_x2@example.test',
  },
  organization_admin: {
    userId: 'a_x', tenantId: 'org_x', positions: ['org_admin'], permissions: ['organization_admin'],
    posture: 'TENANT_ADMIN', org_user_ids: [...ORG_X_USERS, 'a_x'], email: 'a_x@example.test',
  },
  // The resolver's answer for a user in no organisation: no positions, no
  // sets of their own, the peer list seeded with themself alone.
  'user with no organisation': {
    userId: 'u_loner', positions: [], permissions: [], posture: 'MEMBER', org_user_ids: ['u_loner'],
    email: 'u_loner@example.test',
  },
  platform_admin: {
    userId: 'p_admin', tenantId: 'org_x', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN',
  },
  // An MCP OAuth agent as core's `assembleExecutionContext` shapes it: the
  // ceiling on `permissions`, `userId` the delegating member (ADR-0090 D10).
  'mcp agent for the member': {
    userId: 'u_x', tenantId: 'org_x', positions: [], permissions: ['mcp_agent_data_read'], principalKind: 'agent',
    onBehalfOf: { userId: 'u_x', principalKind: 'human' }, posture: 'MEMBER', org_user_ids: ORG_X_USERS,
    email: 'u_x@example.test',
  },
  'mcp agent for the organization admin': {
    userId: 'a_x', tenantId: 'org_x', positions: [], permissions: ['mcp_agent_data_read'], principalKind: 'agent',
    onBehalfOf: { userId: 'a_x', principalKind: 'human' }, posture: 'TENANT_ADMIN', org_user_ids: [...ORG_X_USERS, 'a_x'],
    email: 'a_x@example.test',
  },
  'mcp agent for the platform admin': {
    userId: 'p_admin', tenantId: 'org_x', positions: [], permissions: ['mcp_agent_data_read'], principalKind: 'agent',
    onBehalfOf: { userId: 'p_admin', principalKind: 'human' }, posture: 'PLATFORM_ADMIN', org_user_ids: ['p_admin'],
    email: 'p_admin@example.test',
  },
};

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

/** The rows written for `object`: one per user, each user's own where it names one, in that user's organisation. */
function fixtureRowsFor(schema: ObjectDef): Array<Record<string, unknown>> {
  if (schema.name === 'sys_user') {
    return BASELINE_USERS.map((id) => rowOf(schema, { id, name: id, email: `${id}@example.test` }));
  }
  if (schema.name === 'sys_organization') {
    return ['org_x', 'org_y'].map((id) => rowOf(schema, { id, name: id, slug: id }));
  }
  const orgOf = (user: string) => (user === 'u_y' ? 'org_y' : user === 'u_loner' || user === 'p_admin' ? null : 'org_x');
  return BASELINE_USERS.map((user) =>
    rowOf(schema, { id: `${schema.name}:${user}`, user_id: user, organization_id: orgOf(user), actor_id: user }),
  );
}

const baselineEngines: ObjectQL[] = [];
afterAll(async () => {
  for (const engine of baselineEngines.splice(0)) {
    try { await engine.destroy(); } catch { /* noop */ }
  }
});

async function bootBaseline(declared: boolean) {
  const objects = await registeredObjects();
  const declarers = DECLARERS.map((name) => {
    const { defaultRowScope: _declared, ...schema } = objects.get(name)!;
    return (declared ? objects.get(name)! : schema) as ObjectDef;
  });
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  baselineEngines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.identity-default-row-scope-baseline',
    name: 'Identity default row scope baseline',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [...declarers, objects.get('sys_member')!, SysUserPermissionSet, SysUserPosition],
  } as never);
  await engine.syncSchemas();
  for (const o of [SysPosition, SysPermissionSet, SysPositionPermissionSet]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as never, 'qa.authz-read-set');
  }

  const services: Record<string, unknown> = {
    'org-scoping': { name: 'com.objectstack.org-scoping' },
    tenancy: { posture: 'isolated' },
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: { get: async (_t: string, name: string) => engine.getSchema(name) ?? null, list: async () => defaultPermissionSets },
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
  // The shipped sets, the platform baseline composed: the stock deployment.
  const plugin = new SecurityPlugin({ defaultPermissionSets });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const knex = (driver as unknown as { knex: (t: string) => { insert(rows: object[]): Promise<unknown> } }).knex;
  for (const schema of declarers) await knex(schema.name).insert(fixtureRowsFor(schema));
  // What an agent's delegator resolves from (ADR-0090 D10: the delegator leg is
  // rebuilt from the store): the memberships, and the two administrators' grants.
  const member = objects.get('sys_member')!;
  await knex('sys_member').insert([
    ['u_x', 'org_x', 'member'], ['u_x2', 'org_x', 'member'], ['a_x', 'org_x', 'admin'], ['u_y', 'org_y', 'member'],
  ].map(([user, org, role]) => rowOf(member, { id: `mem:${user}`, user_id: user, organization_id: org, role })));
  await knex('sys_user_permission_set').insert([
    { id: 'ups:a_x', user_id: 'a_x', permission_set: 'organization_admin', organization_id: 'org_x' },
    { id: 'ups:p_admin', user_id: 'p_admin', permission_set: 'admin_full_access', organization_id: null },
  ]);

  const served = async (object: string, persona: Persona): Promise<string[] | string> => {
    try {
      const rows = (await engine.find(object, { context: { ...persona } } as never)) as Array<{ id: string }>;
      return rows.map((r) => r.id).sort();
    } catch (e) {
      const err = e as { code?: string; status?: number };
      return `refused ${err.code} ${err.status}`;
    }
  };
  return { engine, plugin: plugin as any, security, served };
}

describe('a deployment with the shipped baseline is byte-for-byte unchanged on the real declarations (ruling E′ item 6, ③.11)', () => {
  // Explain is read for `read`; the census below reads the collection itself,
  // the one source every door and every explain composes from, for all four.
  const EXPLAINED = ['read'] as const;
  const COLLECTED = ['select', 'insert', 'update', 'delete'] as const;
  const isAgent = (persona: string) => BASELINE_PERSONAS[persona].principalKind === 'agent';
  /** What explain decided, without its prose and composed filter: `allowed` and each layer's verdict. */
  const decided = (e: { allowed: boolean; layers: Array<{ layer: string; verdict: string }> }) =>
    JSON.stringify({ allowed: e.allowed, layers: e.layers.map((l) => `${l.layer}:${l.verdict}`) });

  it('every persona reads every declarer exactly as without the declarations, and is explained the same', { timeout: 30_000 }, async () => {
    const after = await bootBaseline(true);
    const before = await bootBaseline(false);
    const rowsMoved: string[] = [];
    const explainMoved: string[] = [];
    for (const [persona, context] of Object.entries(BASELINE_PERSONAS)) {
      for (const object of DECLARERS) {
        const label = `${persona} on ${object}`;
        const was = await before.served(object, context);
        const now = await after.served(object, context);
        if (JSON.stringify(now) !== JSON.stringify(was)) rowsMoved.push(`${label}: ${JSON.stringify(was)} -> ${JSON.stringify(now)}`);
        for (const operation of EXPLAINED) {
          const e0 = await before.security.explain({ object, operation }, { ...context });
          const e1 = await after.security.explain({ object, operation }, { ...context });
          // A baseline holder's explain is byte-for-byte. A delegated agent's
          // decision is the same, but its ceiling's leg now collects the object
          // default, so the rls layer names it and the composed filter carries
          // that leg's conjunct (the delegator's own scope, `userId` being the
          // delegator's) beside the delegator's.
          const same = isAgent(persona) ? decided(e1) === decided(e0) : JSON.stringify(e1) === JSON.stringify(e0);
          if (!same) explainMoved.push(`${label} (${operation})`);
        }
      }
    }
    expect(rowsMoved).toEqual([]);
    expect(explainMoved).toEqual([]);
    // CONTROL: the comparison has teeth — the baseline narrows each persona,
    // the fixture holds rows they must not read, and the platform administrator
    // reads them all.
    expect(await after.served('sys_user', BASELINE_PERSONAS.member)).toEqual(['u_x', 'u_x2']);
    expect(await after.served('sys_session', BASELINE_PERSONAS['user with no organisation'])).toEqual(['sys_session:u_loner']);
    expect(await after.served('sys_session', BASELINE_PERSONAS['mcp agent for the member'])).toEqual(['sys_session:u_x']);
    expect(await after.served('sys_session', BASELINE_PERSONAS.platform_admin)).toHaveLength(BASELINE_USERS.length);
  });

  it('census: the declared default is collected for no baseline holder, and on a delegated agent ceiling\'s leg', async () => {
    const { plugin } = await bootBaseline(true);
    const objects = await registeredObjects();
    const applied: string[] = [];
    for (const [persona, context] of Object.entries(BASELINE_PERSONAS)) {
      // The platform administrator's superuser bypass is decided before the collection.
      if (persona === 'platform_admin') continue;
      const sets = await plugin.resolvePermissionSetsForContext({ ...context });
      for (const object of DECLARERS) {
        for (const operation of COLLECTED) {
          const collected = plugin.collectRLSPolicies(sets, object, operation, (context.positions ?? []) as string[]);
          if (collected.some((p: object) => isObjectDefaultRowScopePolicy(p))) applied.push(`${persona} ${object} ${operation}`);
        }
      }
    }
    // Every human holds `member_default` beside their own sets, and it carries
    // a policy for every declarer on every operation (its literals, and its
    // `'*'` write floor), so no baseline holder collects a default.
    expect(applied.filter((line) => !line.startsWith('mcp agent'))).toEqual([]);
    // The agent ceilings carry no row policy (ADR-0090 D10): an agent's own
    // leg collects each declarer's default, on exactly the operations the
    // declaration names.
    const agents = Object.keys(BASELINE_PERSONAS).filter(isAgent);
    const expected = agents.flatMap((persona) =>
      DECLARERS.flatMap((object) => {
        const scope = objects.get(object)!.defaultRowScope!;
        return COLLECTED.filter((op) => scope.operation === 'all' || scope.operation === op).map((op) => `${persona} ${object} ${op}`);
      }),
    );
    expect(applied.sort()).toEqual(expected.sort());
  });
});

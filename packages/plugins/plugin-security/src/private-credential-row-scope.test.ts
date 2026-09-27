// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_verification` and `sys_jwks` hold credentials: one-time verification and
 * password-reset tokens, and the environment's JWT signing keys. Both objects
 * declare `access: { default: 'private' }`, and `default-permission-sets.ts`
 * says they "stay DENY for non-admins by design". This file holds that
 * contract: no shipped permission set below platform admin reads a row of
 * either object.
 *
 * The class is the one the header of `objects/default-permission-sets.ts`
 * describes. Every object on `BETTER_AUTH_MANAGED_OBJECTS` gets an EXPLICIT
 * per-object read entry from `denyWritesOnManagedObjects()`. An explicit entry
 * is not the `'*'` wildcard, so the `private` posture (which only keeps a plain
 * wildcard off an object) never applies to it. What narrows the read is the row
 * policy the holder's set declares, and neither object had one.
 *
 * The fix is the header's own instrument, the per-object row scope: a `_none`
 * policy (`id == null`, no row) on each object, in every shipped set that holds
 * the blanket and carries row-level security. The two readers that must keep
 * every row are controls here:
 *   - the platform admin (`admin_full_access`), through its superuser bypass;
 *   - better-auth itself, which reads these tables through its adapter under
 *     system context (`withSystemContext` in plugin-auth injects exactly the
 *     `{ isSystem: true }` context used below).
 *
 * Driven on the real `SecurityPlugin` + `ObjectQL` over a real `SqlDriver`,
 * with the SHIPPED permission sets (no copy). Rows are written straight into
 * the tables, past every scope. Three deployment shapes, as in
 * `scim-projection-row-scope.test.ts`:
 *   - `isolated` with the platform baseline composed (the stock walled shape);
 *   - `isolated` with NO baseline, where each persona resolves only the set it
 *     names, so a set that carried no scope of its own reads every row even
 *     while the stock shape stays green through `member_default`;
 *   - `single`, where the policies carry no tenant token and so must survive
 *     the posture's strip of the platform's tenant policies (ADR-0105 D3).
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysJwks, SysMember, SysUser, SysVerification } from '@objectstack/platform-objects/identity';
import { SecurityPlugin } from './security-plugin.js';

const CREDENTIAL_OBJECTS = ['sys_verification', 'sys_jwks'] as const;
type CredentialObject = (typeof CREDENTIAL_OBJECTS)[number];

const SCHEMAS = [SysUser, SysMember, SysVerification, SysJwks];

/**
 * The people in the fixture. `u_x`, `v_x` and `a_x` belong to organization X;
 * `u_y` belongs to organization Y. Each person has one verification row keyed
 * on their own address, so "a principal's own row" exists for every persona.
 */
const PEOPLE = { member: 'u_x', viewer: 'v_x', admin: 'a_x', otherOrg: 'u_y' } as const;
const ORG_OF: Record<string, string> = { u_x: 'org_x', v_x: 'org_x', a_x: 'org_x', u_y: 'org_y' };
const emailOf = (user: string) => `${user}@example.test`;

const verificationId = (user: string) => `sys_verification:${user}`;
const JWKS_IDS = ['sys_jwks:k1', 'sys_jwks:k2'] as const;

function fixtureRows(): Record<CredentialObject, Array<Record<string, unknown>>> {
  return {
    sys_verification: Object.values(PEOPLE).map((user) => ({
      id: verificationId(user),
      identifier: emailOf(user),
      value: `token-${user}`,
      expires_at: '2099-01-01T00:00:00.000Z',
    })),
    sys_jwks: JWKS_IDS.map((id) => ({
      id,
      public_key: `{"kid":"${id}"}`,
      private_key: `{"kid":"${id}","d":"material-${id}"}`,
      created_at: '2026-01-01T00:00:00.000Z',
    })),
  };
}

/** The driver's own query builder, reached past its `protected` modifier. */
type Table = (name: string) => { insert(rows: Array<Record<string, unknown>>): Promise<unknown> };

interface Shape {
  label: string;
  posture: 'isolated' | 'single';
  composedBaseline: boolean;
}

const SHAPES: Shape[] = [
  { label: 'isolated posture, platform baseline composed (the stock shape)', posture: 'isolated', composedBaseline: true },
  { label: 'isolated posture, no platform baseline (each set on its own)', posture: 'isolated', composedBaseline: false },
  { label: 'single posture, platform baseline composed', posture: 'single', composedBaseline: true },
];

async function boot(shape: Shape): Promise<ObjectQL> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.private-credential-row-scope',
    name: 'Private credential row scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: SCHEMAS,
  } as never);
  await engine.syncSchemas();

  const services: Record<string, unknown> = {
    ...(shape.posture === 'isolated' ? { 'org-scoping': { name: 'com.objectstack.org-scoping' } } : {}),
    tenancy: { posture: shape.posture },
    manifest: { register: vi.fn() },
    objectql: engine,
    // `list` answers nothing, so every set name resolves from the plugin's
    // bootstrap list: the SHIPPED `defaultPermissionSets`, not a copy.
    metadata: { get: async (_t: string, name: string) => engine.getSchema(name) ?? null, list: async () => [] },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin(shape.composedBaseline ? {} : { fallbackPermissionSet: null });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  // Straight into the tables, past every scope: the fixture is not the subject.
  const table = (driver as unknown as { knex: Table }).knex;
  for (const [object, rows] of Object.entries(fixtureRows())) await table(object).insert(rows);
  await table('sys_user').insert(Object.values(PEOPLE).map((id) => ({ id, name: id, email: emailOf(id) })));
  await table('sys_member').insert(
    Object.values(PEOPLE).map((id) => ({
      id: `sys_member:${id}`,
      user_id: id,
      organization_id: ORG_OF[id],
      role: id === PEOPLE.admin ? 'admin' : 'member',
    })),
  );
  return engine;
}

/** Organization X's co-members, as the authz resolver pre-resolves them. */
const ORG_X_USERS = Object.values(PEOPLE).filter((id) => ORG_OF[id] === 'org_x');

/**
 * Each shipped set that holds the managed-object read grant, carried by a
 * principal of organization X exactly as the authz resolver shapes it — each
 * naming its set explicitly, so it resolves even where no baseline is composed.
 */
const PERSONAS = {
  member_default: {
    userId: PEOPLE.member, tenantId: 'org_x', positions: ['org_member'], permissions: ['member_default'],
    posture: 'MEMBER', org_user_ids: ORG_X_USERS, email: emailOf(PEOPLE.member),
  },
  viewer_readonly: {
    userId: PEOPLE.viewer, tenantId: 'org_x', positions: ['org_member'], permissions: ['viewer_readonly'],
    posture: 'MEMBER', org_user_ids: ORG_X_USERS, email: emailOf(PEOPLE.viewer),
  },
  organization_admin: {
    userId: PEOPLE.admin, tenantId: 'org_x', positions: ['org_admin'], permissions: ['organization_admin'],
    posture: 'TENANT_ADMIN', org_user_ids: ORG_X_USERS, email: emailOf(PEOPLE.admin),
  },
  organization_admin_no_bypass: {
    userId: PEOPLE.admin, tenantId: 'org_x', positions: ['org_admin'], permissions: ['organization_admin_no_bypass'],
    posture: 'TENANT_ADMIN', org_user_ids: ORG_X_USERS, email: emailOf(PEOPLE.admin),
  },
  // The MCP write ceiling holds the grant too; it carries no row policy of its
  // own by design (ADR-0090 D10), so its bound is the delegating member's sets.
  // Those resolve from the baseline, so this persona runs where one is composed.
  mcp_agent_data_write: {
    userId: 'agent_x', tenantId: 'org_x', positions: [], permissions: ['mcp_agent_data_write'],
    principalKind: 'agent', onBehalfOf: { userId: PEOPLE.member }, org_user_ids: ORG_X_USERS,
  },
} as const;
type Persona = keyof typeof PERSONAS;

/** Whose own verification row each persona has (the delegator's, for the agent). */
const SELF_OF: Record<Persona, string> = {
  member_default: PEOPLE.member,
  viewer_readonly: PEOPLE.viewer,
  organization_admin: PEOPLE.admin,
  organization_admin_no_bypass: PEOPLE.admin,
  mcp_agent_data_write: PEOPLE.member,
};

const PLATFORM_ADMIN = {
  userId: 'p_admin', tenantId: 'org_x', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN',
};

/** The context better-auth's adapter reads with (`withSystemContext`, plugin-auth). */
const BETTER_AUTH_ADAPTER = { isSystem: true };

async function idsRead(engine: ObjectQL, object: string, context: object): Promise<string[]> {
  const rows = (await engine.find(object, { context } as never)) as Array<{ id: string }>;
  return rows.map((r) => r.id).sort();
}

/** Everything `context` reads of the two credential tables, one sorted id list per table. */
async function credentialTables(engine: ObjectQL, context: object): Promise<Record<CredentialObject, string[]>> {
  const out = {} as Record<CredentialObject, string[]>;
  for (const object of CREDENTIAL_OBJECTS) out[object] = await idsRead(engine, object, context);
  return out;
}

const EVERY_ROW = (): Record<CredentialObject, string[]> => {
  const rows = fixtureRows();
  return {
    sys_verification: rows.sys_verification.map((r) => String(r.id)).sort(),
    sys_jwks: rows.sys_jwks.map((r) => String(r.id)).sort(),
  };
};

describe.each(SHAPES)('private credential tables — $label', (shape) => {
  let engine: ObjectQL;
  beforeAll(async () => {
    engine = await boot(shape);
  });
  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const personas = (Object.keys(PERSONAS) as Persona[]).filter(
    (p) => shape.composedBaseline || p !== 'mcp_agent_data_write',
  );

  for (const persona of personas) {
    it(`${persona}: reads no row of either credential table`, async () => {
      const context = PERSONAS[persona];
      expect(await credentialTables(engine, context)).toEqual({ sys_verification: [], sys_jwks: [] });
      for (const object of CREDENTIAL_OBJECTS) {
        expect(await engine.count(object, { context } as never), object).toBe(0);
      }
    });

    it(`${persona}: a by-id read of a credential row finds nothing — its own verification row, another user's, or a signing key`, async () => {
      const context = PERSONAS[persona];
      const ids: Array<[CredentialObject, string]> = [
        ['sys_verification', verificationId(SELF_OF[persona])],
        ['sys_verification', verificationId(PEOPLE.otherOrg)],
        ['sys_verification', verificationId(persona === 'member_default' ? PEOPLE.viewer : PEOPLE.member)],
        ['sys_jwks', JWKS_IDS[0]],
      ];
      for (const [object, id] of ids) {
        const row = await engine.findOne(object, { where: { id }, context } as never);
        expect(row, `${object} ${id}`).toBeNull();
      }
    });
  }

  it('CONTROL: the persona contexts are live — each still reads its own `sys_user` row through the same engine', async () => {
    for (const persona of personas) {
      if (persona === 'mcp_agent_data_write') continue;
      expect(await idsRead(engine, 'sys_user', PERSONAS[persona]), persona).toContain(SELF_OF[persona]);
    }
  });

  it('CONTROL: the platform admin reads every row of both tables, list and by-id', async () => {
    expect(await credentialTables(engine, PLATFORM_ADMIN)).toEqual(EVERY_ROW());
    const row = await engine.findOne('sys_verification', {
      where: { id: verificationId(PEOPLE.otherOrg) },
      context: PLATFORM_ADMIN,
    } as never);
    expect((row as { value?: string } | null)?.value).toBe(`token-${PEOPLE.otherOrg}`);
  });

  it('CONTROL: better-auth’s adapter context (system) reads every row, by identifier and by id', async () => {
    expect(await credentialTables(engine, BETTER_AUTH_ADAPTER)).toEqual(EVERY_ROW());
    // The adapter keys verification lookups on `identifier` (better-auth's
    // `findByIdentifier`); a signing-key read is by `id`.
    const byIdentifier = (await engine.find('sys_verification', {
      where: { identifier: emailOf(PEOPLE.member) },
      context: BETTER_AUTH_ADAPTER,
    } as never)) as Array<{ value: string }>;
    expect(byIdentifier.map((r) => r.value)).toEqual([`token-${PEOPLE.member}`]);
    const key = await engine.findOne('sys_jwks', { where: { id: JWKS_IDS[1] }, context: BETTER_AUTH_ADAPTER } as never);
    expect((key as { id?: string } | null)?.id).toBe(JWKS_IDS[1]);
  });
});

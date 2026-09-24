// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The seven `@better-auth/scim` projection tables are row-scoped in every
 * shipped permission set that holds the managed-object read grant — so no
 * principal below platform admin reads a row another organization's identity
 * provider provisioned.
 *
 * The class (see the header of `objects/default-permission-sets.ts`): every
 * object on `BETTER_AUTH_MANAGED_OBJECTS` gets an object-level `allowRead` from
 * `denyWritesOnManagedObjects()`, and what narrows that read is whatever row
 * policy the holder's set declares for it. None of the `sys_scim_*` tables
 * carries a tenant column, so the organization wall (Layer 0) is inert on them
 * and the engine scopes nothing by organization; with no row policy either, an
 * object-level read there is a read of every organization's rows.
 *
 * The fix is the header's own instrument, the per-object row scope:
 *   - a `_self` policy (`user_id == current_user.id`) on the four tables that
 *     name the platform user the row is about — a principal reads the rows
 *     about themselves and nothing else;
 *   - a `_none` policy (`id == null`) on the three that name no user — no row
 *     is readable through a shipped set at all.
 * The platform admin (`admin_full_access`) keeps every row through its
 * superuser bypass, which is the only principal the SCIM administration
 * surface (`sys_scim_connection_credential`, `manage_platform_settings`) is
 * gated to.
 *
 * Driven on the real `SecurityPlugin` + `ObjectQL` over a real `SqlDriver`, under
 * the `isolated` posture, with the SHIPPED permission sets (no copy): rows for
 * two organizations' SCIM connections are written straight into the tables,
 * past every scope, and each shipped persona of organization X reads every
 * table through the generic data path.
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  SysMember,
  SysScimConnectionBinding,
  SysScimGroup,
  SysScimGroupMember,
  SysScimIdentityTombstone,
  SysScimProjectionGrant,
  SysScimSubject,
  SysScimUser,
  SysUser,
} from '@objectstack/platform-objects/identity';
import { SecurityPlugin } from './security-plugin.js';

/** The SCIM tables that name the platform user each row is about. */
const USER_KEYED = [
  'sys_scim_user',
  'sys_scim_subject',
  'sys_scim_projection_grant',
  'sys_scim_identity_tombstone',
] as const;

/** The SCIM tables that name no user. */
const CONNECTION_KEYED = ['sys_scim_group', 'sys_scim_group_member', 'sys_scim_connection_binding'] as const;

const SCIM_OBJECTS = [...USER_KEYED, ...CONNECTION_KEYED] as const;
type ScimObject = (typeof SCIM_OBJECTS)[number];

const SCHEMAS = [
  SysUser,
  SysMember,
  SysScimUser,
  SysScimSubject,
  SysScimProjectionGrant,
  SysScimIdentityTombstone,
  SysScimGroup,
  SysScimGroupMember,
  SysScimConnectionBinding,
];

/**
 * The people in the fixture. `u_x`, `u_x2`, `v_x` and `a_x` belong to
 * organization X; `u_y` belongs to organization Y. Every user-keyed SCIM table
 * holds one row per person, each written by that person's organization's
 * connection (`conn_x` / `conn_y`).
 */
const PEOPLE = { member: 'u_x', peer: 'u_x2', viewer: 'v_x', admin: 'a_x', otherOrg: 'u_y' } as const;
const ORG_OF: Record<string, string> = { u_x: 'org_x', u_x2: 'org_x', v_x: 'org_x', a_x: 'org_x', u_y: 'org_y' };
const CONN_OF: Record<string, string> = { org_x: 'conn_x', org_y: 'conn_y' };

/** Row id of the `object` row about `user`, e.g. `sys_scim_user:u_y`. */
const rowAbout = (object: string, user: string) => `${object}:${user}`;
/** Row id of the connection-keyed `object` row written by `org`'s connection. */
const rowOf = (object: string, org: string) => `${object}:${org}`;

/** A plausible value for a required column the fixture does not care about. */
function filler(type: string, key: string): unknown {
  switch (type) {
    case 'boolean':
      return true;
    case 'number':
      return 0;
    case 'datetime':
      return '2026-01-01T00:00:00.000Z';
    default:
      return key;
  }
}

/**
 * One row of `object`: every required column filled, then those of `values`
 * the table declares (`sys_scim_subject` names no connection, and
 * `sys_scim_group_member` no provisioning domain).
 */
function row(object: ScimObject, values: Record<string, unknown>): Record<string, unknown> {
  const schema = SCHEMAS.find((s) => s.name === object)!;
  const fields = schema.fields as Record<string, { type: string; required?: boolean }>;
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(fields)) {
    if (def.required) out[name] = filler(def.type, `${name}-${String(values.id)}`);
  }
  for (const [name, value] of Object.entries(values)) if (name in fields) out[name] = value;
  return out;
}

function fixtureRows(): Record<string, Array<Record<string, unknown>>> {
  const rows: Record<string, Array<Record<string, unknown>>> = {};
  for (const object of USER_KEYED) {
    rows[object] = Object.values(PEOPLE).map((user) => {
      const org = ORG_OF[user];
      return row(object, {
        id: rowAbout(object, user),
        user_id: user,
        connection_id: CONN_OF[org],
        provisioning_domain_id: CONN_OF[org],
      });
    });
  }
  for (const object of CONNECTION_KEYED) {
    rows[object] = ['org_x', 'org_y'].map((org) =>
      row(object, { id: rowOf(object, org), connection_id: CONN_OF[org], provisioning_domain_id: CONN_OF[org] }),
    );
  }
  return rows;
}

/** The driver's own query builder, reached past its `protected` modifier. */
type Table = (name: string) => { insert(rows: Array<Record<string, unknown>>): Promise<unknown> };

let engine: ObjectQL;

beforeAll(async () => {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.scim-projection-row-scope',
    name: 'SCIM projection row scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: SCHEMAS,
  } as never);
  await engine.syncSchemas();

  const services: Record<string, unknown> = {
    'org-scoping': { name: 'com.objectstack.org-scoping' },
    tenancy: { posture: 'isolated' },
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
  const plugin = new SecurityPlugin();
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  // Straight into the tables, past every scope: the fixture is not the subject.
  const table = (driver as unknown as { knex: Table }).knex;
  for (const [object, rows] of Object.entries(fixtureRows())) await table(object).insert(rows);
  await table('sys_user').insert(
    Object.values(PEOPLE).map((id) => ({ id, name: id, email: `${id}@example.test` })),
  );
  await table('sys_member').insert(
    Object.values(PEOPLE).map((id) => ({
      id: `sys_member:${id}`,
      user_id: id,
      organization_id: ORG_OF[id],
      role: id === PEOPLE.admin ? 'admin' : 'member',
    })),
  );
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** Organization X's co-members, as the authz resolver pre-resolves them. */
const ORG_X_USERS = Object.values(PEOPLE).filter((id) => ORG_OF[id] === 'org_x');

/**
 * Each shipped set that holds the managed-object read grant, carried by a
 * principal of organization X exactly as the authz resolver shapes it.
 * `member_default` is the additive baseline and resolves for every one of them.
 */
const PERSONAS = {
  member_default: {
    userId: PEOPLE.member, tenantId: 'org_x', positions: ['org_member'], permissions: [],
    posture: 'MEMBER', org_user_ids: ORG_X_USERS, email: `${PEOPLE.member}@example.test`,
  },
  viewer_readonly: {
    userId: PEOPLE.viewer, tenantId: 'org_x', positions: ['org_member'], permissions: ['viewer_readonly'],
    posture: 'MEMBER', org_user_ids: ORG_X_USERS, email: `${PEOPLE.viewer}@example.test`,
  },
  organization_admin: {
    userId: PEOPLE.admin, tenantId: 'org_x', positions: ['org_admin'], permissions: ['organization_admin'],
    posture: 'TENANT_ADMIN', org_user_ids: ORG_X_USERS, email: `${PEOPLE.admin}@example.test`,
  },
  organization_admin_no_bypass: {
    userId: PEOPLE.admin, tenantId: 'org_x', positions: ['org_admin'], permissions: ['organization_admin_no_bypass'],
    posture: 'TENANT_ADMIN', org_user_ids: ORG_X_USERS, email: `${PEOPLE.admin}@example.test`,
  },
  // The MCP write ceiling holds the grant too; it carries no row policy of its
  // own by design (ADR-0090 D10), so its bound is the delegating member's sets.
  mcp_agent_data_write: {
    userId: 'agent_x', tenantId: 'org_x', positions: [], permissions: ['mcp_agent_data_write'],
    principalKind: 'agent', onBehalfOf: { userId: PEOPLE.member }, org_user_ids: ORG_X_USERS,
  },
} as const;
type Persona = keyof typeof PERSONAS;

/** Whose rows each persona reads through its self scope. */
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

async function idsRead(object: string, context: object): Promise<string[]> {
  const rows = (await engine.find(object, { context } as never)) as Array<{ id: string }>;
  return rows.map((r) => r.id).sort();
}

/** Everything `context` reads of the seven SCIM tables, one sorted id list per table. */
async function scimTable(context: object): Promise<Record<ScimObject, string[]>> {
  const out = {} as Record<ScimObject, string[]>;
  for (const object of SCIM_OBJECTS) out[object] = await idsRead(object, context);
  return out;
}

describe('SCIM projection tables — no shipped set below platform admin reads another organization’s rows', () => {
  for (const persona of Object.keys(PERSONAS) as Persona[]) {
    it(`${persona}: reads the SCIM rows about itself, and nothing another organization provisioned`, async () => {
      const seen = await scimTable(PERSONAS[persona]);

      const self = SELF_OF[persona];
      const expected = {} as Record<ScimObject, string[]>;
      for (const object of USER_KEYED) expected[object] = [rowAbout(object, self)];
      for (const object of CONNECTION_KEYED) expected[object] = [];
      expect(seen).toEqual(expected);
    });

    it(`${persona}: a by-id read of another organization’s SCIM row finds nothing`, async () => {
      const context = PERSONAS[persona];
      for (const object of USER_KEYED) {
        const other = await engine.findOne(object, { where: { id: rowAbout(object, PEOPLE.otherOrg) }, context } as never);
        expect(other, object).toBeNull();
      }
      for (const object of CONNECTION_KEYED) {
        const other = await engine.findOne(object, { where: { id: rowOf(object, 'org_y') }, context } as never);
        expect(other, object).toBeNull();
      }
    });
  }
});

describe('SCIM projection tables — controls', () => {
  it('CONTROL: the fixture really holds both organizations’ rows — the platform admin reads every one', async () => {
    const seen = await scimTable(PLATFORM_ADMIN);
    const rows = fixtureRows();
    const expected = {} as Record<ScimObject, string[]>;
    for (const object of SCIM_OBJECTS) expected[object] = rows[object].map((r) => String(r.id)).sort();
    expect(seen).toEqual(expected);
    // Both organizations are present in what that read returned.
    expect(seen.sys_scim_user).toContain(rowAbout('sys_scim_user', PEOPLE.otherOrg));
    expect(seen.sys_scim_group).toContain(rowOf('sys_scim_group', 'org_y'));
  });

  it('CONTROL: a co-member’s own SCIM rows are readable to that co-member — the scope is per person, not a blanket deny', async () => {
    const peer = { ...PERSONAS.member_default, userId: PEOPLE.peer, email: `${PEOPLE.peer}@example.test` };
    const seen = await scimTable(peer);
    for (const object of USER_KEYED) expect(seen[object], object).toEqual([rowAbout(object, PEOPLE.peer)]);
  });

  it('CONTROL: an unrelated managed object keeps its own scope — `sys_member` reads organization X’s memberships', async () => {
    const orgX = ORG_X_USERS.map((id) => `sys_member:${id}`).sort();
    expect(await idsRead('sys_member', PERSONAS.member_default)).toEqual(orgX);
    expect(await idsRead('sys_member', PERSONAS.organization_admin)).toEqual(orgX);
  });
});

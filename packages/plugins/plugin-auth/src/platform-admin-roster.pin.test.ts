// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0095 D3] The platform-admin roster agrees, user by user, with the one
 * predicate, and is served only to a caller who holds that standing.
 *
 * Every case runs a REAL {@link ObjectQL} engine over better-sqlite3
 * `:memory:` and asks the REAL `hasPlatformAdminStanding`. Four things are
 * pinned:
 *
 *  1. **Agreement.** Over a fixture holding each shape that does and does not
 *     confer standing (a Default Organization grant, a verified owner address,
 *     an unverified one, an expired grant, another organization's grant held by
 *     that organization's owner, a plain member), the roster is exactly the
 *     users the predicate grades a platform administrator.
 *  2. **The enumerator reads every declared candidate source.** For each entry
 *     of `ADMIN_STANDING_PLATFORM_ENUMERATION.candidateSources`, a fixture where
 *     that source ALONE makes a user an administrator, and the enumerator
 *     names them. A candidate source with no fixture here is red by name: a
 *     third source of standing is not served until the enumerator reads it.
 *  3. **Organization standing is not platform standing.** Under
 *     `standing: 'platform-admins'` the enumerator does not name an
 *     organization owner; the guard's default population still does.
 *  4. **Who may read it.** An organization owner, a plain member and a caller
 *     with no standing are refused with the platform-admin gate's 403 body and
 *     no data; a platform administrator gets the roster.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  ADMIN_STANDING_PLATFORM_ENUMERATION,
  hasPlatformAdminStanding,
  resetPlatformAdminEmailMemo,
} from '@objectstack/core';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';

import { resolveAdminUserIds } from './last-admin-guard.js';
import { resolvePlatformAdminRoster, runPlatformAdminRoster } from './platform-admin-roster.js';
import { PLATFORM_ADMIN_REFUSAL_MESSAGES } from './platform-admin-gate.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const SYSTEM = { context: { isSystem: true } } as const;
const OWNER = 'owner@corp.example';
const DEFAULT_ORG = 'org_default';
const OTHER_ORG = 'org_other';
const ENV = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_PLATFORM_OWNER_EMAIL'] as const;
const PAST = new Date(Date.now() - 86_400_000).toISOString();

const text = (name: string) => ({ name, type: 'text' as const });
const OBJECTS = [
  {
    name: 'sys_user',
    label: 'User',
    managedBy: 'better-auth',
    fields: {
      id: { ...text('id'), primaryKey: true },
      name: text('name'),
      email: text('email'),
      email_verified: { name: 'email_verified', type: 'boolean' as const },
      banned: { name: 'banned', type: 'boolean' as const, readonly: true },
    },
  },
  {
    name: 'sys_member',
    label: 'Member',
    managedBy: 'better-auth',
    fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), organization_id: text('organization_id'), role: text('role') },
  },
  {
    name: 'sys_organization',
    label: 'Organization',
    managedBy: 'better-auth',
    fields: { id: { ...text('id'), primaryKey: true }, name: text('name'), slug: text('slug') },
  },
  {
    name: 'sys_user_permission_set',
    label: 'User Permission Set',
    fields: {
      id: { ...text('id'), primaryKey: true },
      user_id: text('user_id'),
      permission_set: text('permission_set'),
      organization_id: text('organization_id'),
      valid_from: { name: 'valid_from', type: 'datetime' as const },
      valid_until: { name: 'valid_until', type: 'datetime' as const },
    },
  },
  {
    name: 'sys_user_position',
    label: 'User Position',
    fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), position: text('position'), organization_id: text('organization_id') },
  },
];

let engines: ObjectQL[] = [];
let ambient: Record<string, string | undefined> = {};

beforeEach(() => {
  ambient = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.OS_TENANCY_POSTURE = 'single';
  resetPlatformAdminEmailMemo();
});

afterEach(async () => {
  for (const [k, v] of Object.entries(ambient)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPlatformAdminEmailMemo();
  const open = engines;
  engines = [];
  for (const e of open) {
    try { await e.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of OBJECTS) engine.registry.registerObject(o as never);
  await engine.syncSchemas();
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default Organization', slug: 'default' }, SYSTEM);
  await engine.insert('sys_organization', { id: OTHER_ORG, name: 'Other', slug: 'other' }, SYSTEM);
  return engine;
}

const seedUser = (engine: ObjectQL, id: string, email: string, verified = true) =>
  engine.insert('sys_user', { id, name: `Name ${id}`, email, email_verified: verified, banned: false }, SYSTEM);

const grant = (engine: ObjectQL, userId: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  engine.insert(
    'sys_user_permission_set',
    { id: `ups_${userId}`, user_id: userId, permission_set: ADMIN_FULL_ACCESS, organization_id: organizationId, ...extra },
    SYSTEM,
  );

const setOwnerList = (value: string) => {
  process.env.OS_PLATFORM_OWNER_EMAIL = value;
  resetPlatformAdminEmailMemo();
};

/** Every shape the fixture holds, one user each. */
async function seedEveryShape(engine: ObjectQL): Promise<string[]> {
  setOwnerList(`${OWNER},unverified@corp.example`);
  await seedUser(engine, 'usr_grant', 'grant@corp.example');
  await grant(engine, 'usr_grant', DEFAULT_ORG);
  await seedUser(engine, 'usr_owner', OWNER);
  await seedUser(engine, 'usr_unverified', 'unverified@corp.example', false);
  await seedUser(engine, 'usr_expired', 'expired@corp.example');
  await grant(engine, 'usr_expired', DEFAULT_ORG, { valid_until: PAST });
  await seedUser(engine, 'usr_org_admin', 'org.admin@corp.example');
  await grant(engine, 'usr_org_admin', OTHER_ORG);
  await engine.insert('sys_member', { id: 'mem_org_admin', user_id: 'usr_org_admin', organization_id: OTHER_ORG, role: 'owner' }, SYSTEM);
  await seedUser(engine, 'usr_plain', 'plain@corp.example');
  await engine.insert('sys_member', { id: 'mem_plain', user_id: 'usr_plain', organization_id: DEFAULT_ORG, role: 'member' }, SYSTEM);
  return ['usr_expired', 'usr_grant', 'usr_org_admin', 'usr_owner', 'usr_plain', 'usr_unverified'];
}

describe('[ADR-0095 D3] the roster agrees with hasPlatformAdminStanding, user by user', () => {
  it('names exactly the users the predicate grades a platform administrator', async () => {
    const engine = await boot();
    const users = await seedEveryShape(engine);

    const byPredicate: string[] = [];
    for (const id of users) if (await hasPlatformAdminStanding(engine, id)) byPredicate.push(id);
    const roster = await resolvePlatformAdminRoster(engine);

    expect(roster.map((e) => e.id)).toEqual(byPredicate);
    // Positive control: both anchors are represented, so agreement over an
    // empty answer cannot pass.
    expect(byPredicate).toEqual(['usr_grant', 'usr_owner']);
    expect(roster).toEqual([
      { id: 'usr_grant', name: 'Name usr_grant', email: 'grant@corp.example' },
      { id: 'usr_owner', name: 'Name usr_owner', email: OWNER },
    ]);
  });
});

describe('[ADR-0095 D3] the enumerator reads every candidate source the ledger declares', () => {
  /** A fixture where the named source ALONE makes `usr_sole` a platform administrator. */
  const SOLE_SOURCE: Record<string, (engine: ObjectQL) => Promise<void>> = {
    sys_user_permission_set: async (engine) => {
      await seedUser(engine, 'usr_sole', 'sole@corp.example');
      await grant(engine, 'usr_sole', DEFAULT_ORG);
    },
    OS_PLATFORM_OWNER_EMAIL: async (engine) => {
      setOwnerList('sole@corp.example');
      await seedUser(engine, 'usr_sole', 'sole@corp.example');
    },
  };

  it.each(Object.keys(ADMIN_STANDING_PLATFORM_ENUMERATION.candidateSources))(
    'names the administrator %s alone makes',
    async (source) => {
      const arrange = SOLE_SOURCE[source];
      expect(
        arrange,
        `'${source}' is a declared platform-admin candidate source with no fixture here: teach the enumerator ` +
          '(resolveAdminUserIds in last-admin-guard.ts) to read it, then add its fixture',
      ).toBeDefined();
      const engine = await boot();
      await arrange!(engine);

      expect(await hasPlatformAdminStanding(engine, 'usr_sole')).toBe(true);
      expect([...(await resolveAdminUserIds(engine, { standing: 'platform-admins' }))]).toEqual(['usr_sole']);
    },
  );
});

describe('[ADR-0095 D3] organization standing is not platform standing', () => {
  it('the platform-admin population leaves an organization owner out; the guard population keeps them', async () => {
    const engine = await boot();
    await seedEveryShape(engine);

    const platform = [...(await resolveAdminUserIds(engine, { standing: 'platform-admins' }))].sort();
    const administrators = [...(await resolveAdminUserIds(engine))].sort();

    expect(platform).toEqual(['usr_grant', 'usr_owner']);
    // The guard's own population is unchanged: the organization owner still
    // counts as an administrator the break-glass invariant protects.
    expect(administrators).toEqual(['usr_grant', 'usr_org_admin', 'usr_owner']);
  });
});

describe('[ADR-0095 D3] the roster is served only to a caller who holds platform-admin standing', () => {
  const deps = (engine: ObjectQL) => ({ getDataEngine: () => engine });

  it.each(['usr_org_admin', 'usr_plain', 'usr_unverified', 'usr_nobody'])(
    '%s is refused with the gate\'s 403 body and learns nothing',
    async (caller) => {
      const engine = await boot();
      await seedEveryShape(engine);

      const { status, body } = await runPlatformAdminRoster(deps(engine), { id: caller });

      expect(status).toBe(403);
      expect(body).toEqual({
        success: false,
        error: { code: 'PERMISSION_DENIED', message: PLATFORM_ADMIN_REFUSAL_MESSAGES[403] },
      });
    },
  );

  it.each(['usr_grant', 'usr_owner'])('%s gets the roster', async (caller) => {
    const engine = await boot();
    await seedEveryShape(engine);

    const { status, body } = await runPlatformAdminRoster(deps(engine), { id: caller });

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        count: 2,
        admins: [
          { id: 'usr_grant', name: 'Name usr_grant', email: 'grant@corp.example' },
          { id: 'usr_owner', name: 'Name usr_owner', email: OWNER },
        ],
        entries: ['Name usr_grant <grant@corp.example>', `Name usr_owner <${OWNER}>`],
      },
    });
  });

  it('no data engine answers 503, not an empty roster', async () => {
    const { status, body } = await runPlatformAdminRoster({ getDataEngine: () => undefined }, { id: 'usr_grant' });
    expect(status).toBe(503);
    expect(body).toMatchObject({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});

describe('[ADR-0095 D3] an overflowing read is a read fault, not a short roster', () => {
  it('throws 503 SERVICE_UNAVAILABLE when a candidate read passes the ceiling', async () => {
    const engine = await boot();
    for (const id of ['usr_a', 'usr_b']) {
      await seedUser(engine, id, `${id}@corp.example`);
      await grant(engine, id, DEFAULT_ORG);
    }
    await expect(resolveAdminUserIds(engine, { standing: 'platform-admins', maxScan: 1 })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
  });
});

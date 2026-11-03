// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29281] An ordinary member of an organization with MORE than 1,000 members
 * sees every fellow member in `sys_user`, by search and by id — and still no
 * one outside the organization.
 *
 * ## The defect
 *
 * `sys_user`'s org-members row scope is `id in current_user.org_user_ids`
 * (the object's `defaultRowScope`, and `member_default`'s
 * `sys_user_org_members`). `org_user_ids` is pre-resolved per request by
 * `resolveUserAuthzGrants` from ONE `sys_member` read bounded at 1,000 rows,
 * so every member past the 1,000th `sys_member.id` fell out of the list with
 * no signal: a people picker searching for them answered no rows, a read by
 * id answered 404, and which members vanished was arbitrary (the ids are
 * random). Measured on `main` `a19759ac` over this file's rig (driver-sql on
 * better-sqlite3): 1,001 members, `org_user_ids` held 1,000 ids, the member
 * whose `sys_member.id` sorts 1,001st was found by neither read, and a full
 * list read returned 1,000 rows.
 *
 * ## The rule pinned here
 *
 * The visible set is EXACTLY the organization's members plus the caller —
 * no fewer (the defect) and no more (the over-fix). The interim reads the
 * membership to completion only when the first read comes back at its bound,
 * so an organization under the bound issues exactly the one read it always did.
 * The relational-membership predicate that replaces the pre-resolved list is
 * an ADR's to decide; this file pins the visible set either way.
 *
 * ## The rig
 *
 * A real `ObjectQL` over a real `SqlDriver` (better-sqlite3 `:memory:`), the
 * real identity objects, the real `SecurityPlugin` falling back to the SHIPPED
 * `member_default` set, and a principal built from `resolveUserAuthzGrants` —
 * the resolver the request path runs. The members are seeded through the
 * driver: they are data at rest, not writes under test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { context: { isSystem: true } } as const;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
/** The organization under test, and one the caller is not a member of. */
const ORG = 'org_large';
const ELSEWHERE = 'org_elsewhere';
/** The caller: an ordinary member of `ORG`. */
const ME = 'usr_000000';
/** A member of `ELSEWHERE` only — never visible to the caller. */
const OUTSIDER = 'usr_outsider';
/** The bound the membership's first read carries. */
const FIRST_READ_BOUND = 1000;

const pad = (n: number) => String(n).padStart(6, '0');
const nameOf = (userId: string) => `Person ${userId.slice(4)}`;

interface Rig {
  engine: ObjectQL;
  /** Every `ORG` membership row, sorted by `sys_member.id` as the read orders them. */
  members: Array<{ id: string; user_id: string }>;
  memberReads: () => number;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * `n` members of `ORG`, each `sys_member.id` drawn from a permutation that does
 * NOT follow the user ids, so "the members past the 1,000th" is a different set
 * from "the users past the 1,000th" — as random ids make it in production.
 */
async function boot(n: number): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.sys-user-org-members-past-first-read',
    name: 'sys_user org members past the first read',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysOrganization, SysUser, SysMember, SysUserPosition, SysUserPermissionSet],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const e = engine as any;
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: 'large' }, SYS);
  await e.insert('sys_organization', { id: ELSEWHERE, name: ELSEWHERE, slug: 'elsewhere' }, SYS);
  const users = Array.from({ length: n }, (_, i) => ({ id: `usr_${pad(i)}`, name: nameOf(`usr_${pad(i)}`), email: `p${pad(i)}@example.test` }));
  users.push({ id: OUTSIDER, name: nameOf(OUTSIDER), email: 'outsider@example.test' });
  const members = Array.from({ length: n }, (_, i) => ({
    id: `mem_${pad((i * 7919) % 1000003)}`,
    user_id: `usr_${pad(i)}`,
    organization_id: ORG,
    role: 'member',
  }));
  const userDriver = e.getDriverForObject('sys_user');
  const memberDriver = e.getDriverForObject('sys_member');
  for (let i = 0; i < users.length; i += 250) await userDriver.bulkCreate('sys_user', users.slice(i, i + 250));
  for (let i = 0; i < members.length; i += 250) await memberDriver.bulkCreate('sys_member', members.slice(i, i + 250));
  await memberDriver.create('sys_member', { id: 'mem_outsider', user_id: OUTSIDER, organization_id: ELSEWHERE, role: 'member' });

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);

  // The organization's membership read — `where organization_id = ?` first —
  // not the caller's own `user_id` read, nor another plugin's sys_member read.
  let reads = 0;
  (driver as any).knex.on('query', (q: { sql: string }) => {
    if (/from [`"]sys_member[`"] where [`"]organization_id[`"] = \?/.test(q.sql)) reads += 1;
  });
  return {
    engine,
    members: members.map(({ id, user_id }) => ({ id, user_id })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    memberReads: () => reads,
  };
}

/** The request context an ordinary member of `ORG` reads with — the resolver's grants, as the request path copies them. */
async function memberContext(engine: ObjectQL) {
  const grants = await resolveUserAuthzGrants(engine, ME, { tenantId: ORG, bypassGrantsCache: true });
  return {
    userId: ME,
    tenantId: ORG,
    positions: grants.positions,
    permissions: grants.permissions,
    org_user_ids: grants.org_user_ids,
    accessible_org_ids: grants.accessible_org_ids,
    ...(grants.email ? { email: grants.email } : {}),
    ...(grants.posture ? { posture: grants.posture } : {}),
  };
}

const search = (engine: ObjectQL, ctx: unknown, userId: string) =>
  (engine as any).find('sys_user', { search: nameOf(userId), searchFields: ['name'], context: ctx, limit: 50 }) as Promise<Array<{ id: string }>>;
const byId = (engine: ObjectQL, ctx: unknown, userId: string) =>
  (engine as any).findOne('sys_user', { where: { id: userId }, context: ctx }) as Promise<{ id: string } | null>;
const everyVisible = async (engine: ObjectQL, ctx: unknown) =>
  ((await (engine as any).find('sys_user', { context: ctx, limit: 5000 })) as Array<{ id: string }>).map((r) => r.id).sort();

describe('[#29281] sys_user org members past the first membership read (driver-sql, shipped member_default)', () => {
  it('⭐ 1,001 members: the member whose sys_member.id sorts 1,001st is found by search and by id', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rig = await boot(FIRST_READ_BOUND + 1);
    const ctx = await memberContext(rig.engine);
    const past = rig.members[FIRST_READ_BOUND]!.user_id;

    expect((await search(rig.engine, ctx, past)).map((r) => r.id)).toEqual([past]);
    expect((await byId(rig.engine, ctx, past))?.id).toBe(past);
    // Exactly the organization: every member, the caller among them, and no one else.
    expect(await everyVisible(rig.engine, ctx)).toEqual(rig.members.map((m) => m.user_id).sort());
  });

  it('⛔ a member of another organization stays invisible, by search and by id', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rig = await boot(FIRST_READ_BOUND + 1);
    const ctx = await memberContext(rig.engine);

    expect(ctx.org_user_ids).not.toContain(OUTSIDER);
    expect(await search(rig.engine, ctx, OUTSIDER)).toEqual([]);
    expect(await byId(rig.engine, ctx, OUTSIDER)).toBeNull();
  });

  it('an organization under the bound reads its members once, as before, and sees exactly them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rig = await boot(FIRST_READ_BOUND - 1);
    const before = rig.memberReads();
    const ctx = await memberContext(rig.engine);

    expect(rig.memberReads() - before).toBe(1);
    expect(await everyVisible(rig.engine, ctx)).toEqual(rig.members.map((m) => m.user_id).sort());
    expect(await byId(rig.engine, ctx, OUTSIDER)).toBeNull();
    expect(warn.mock.calls.some((c) => String(c[0]).includes(ORG))).toBe(false);
  });

  it('a first read that comes back at its bound is said once, naming the organization and its member count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rig = await boot(FIRST_READ_BOUND + 1);
    await memberContext(rig.engine);
    await memberContext(rig.engine);

    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(ORG));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(String(FIRST_READ_BOUND + 1));
  });
});

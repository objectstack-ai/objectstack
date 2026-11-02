// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29362] `TeamGraphService.expandRoleUsers` answers EVERY holder of a role,
 * or refuses — never a shortened or an invented empty set.
 *
 * The role expansion is the `sys_member.role` limb of every position recipient
 * (`PositionGraphService.expandPositionUsers`, ADR-0057 D4 transition source)
 * and of `expandPrincipal('role')`. It used to read `sys_member` once with a
 * 10,000-row bound and take that read as the holder list, and it turned a read
 * that threw into `[]`:
 *
 *   - past 10,000 holders the members past the 10,000th row were missing from
 *     the set with no signal, so a sharing rule granted them nothing;
 *   - a read that failed answered "nobody holds this role", and the
 *     retired-recipient revoke (`revokeRuleGrantsForRetiredRecipients`) diffs
 *     the grants a rule already materialised against that answer — an empty
 *     answer revokes every one of them.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the shipped `SysMember`, because the completion is a keyset read
 * (`id > cursor`, ordered by `id`): a hand-written double that ignores the
 * cursor or the order cannot tell a completed read from a repeated page.
 *
 * A membership object that does not exist is still no holders: a stack that
 * never materialises `sys_member` has no role holders to lose. The driver's
 * missing-table refusal and the engine's `OBJECT_NOT_FOUND` for `sys_member`
 * are the two failures that say so; every other failure is loud.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { TeamGraphService } from './team-graph.js';
import { PositionGraphService } from './position-graph.js';

const ORG = 'org_large';
const ELSEWHERE = 'org_elsewhere';
const ROLE = 'sales_rep';
/** The bound the role read is paged at. */
const PAGE = 10000;

const pad = (n: number) => String(n).padStart(6, '0');

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  /** Every holder of {@link ROLE} in {@link ORG}, sorted. */
  holders: string[];
  /** The role reads the driver ran (`… from sys_member where role = ? …`). */
  roleReads: () => number;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * `n` holders of {@link ROLE} in {@link ORG}, plus a holder of the same role in
 * another organization and a member of {@link ORG} holding another role — the
 * two rows the predicate must keep out. Membership ids are scrambled against
 * the user ids, so the 10,001st row by `sys_member.id` is not the 10,001st
 * user, and an unordered first read is not the lowest ids.
 */
async function boot(n: number, opts: { registerMember?: boolean } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.team-graph-role-holders-complete',
    name: 'team graph role holders complete',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: opts.registerMember === false ? [SysOrganization] : [SysOrganization, SysMember],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const e = engine as any;
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: 'large' }, { context: { isSystem: true } });
  await e.insert('sys_organization', { id: ELSEWHERE, name: ELSEWHERE, slug: 'elsewhere' }, { context: { isSystem: true } });
  const holders = Array.from({ length: n }, (_, i) => `usr_${pad(i)}`);
  if (opts.registerMember !== false) {
    const rows = holders.map((user_id, i) => ({
      id: `mem_${pad((i * 7919) % 1000003)}`, user_id, organization_id: ORG, role: ROLE,
    }));
    rows.push({ id: 'mem_elsewhere', user_id: 'usr_elsewhere', organization_id: ELSEWHERE, role: ROLE });
    rows.push({ id: 'mem_other_role', user_id: 'usr_other_role', organization_id: ORG, role: 'support' });
    const memberDriver = e.getDriverForObject('sys_member');
    for (let i = 0; i < rows.length; i += 250) await memberDriver.bulkCreate('sys_member', rows.slice(i, i + 250));
  }

  let reads = 0;
  (driver as any).knex.on('query', (q: { sql: string }) => {
    if (/from [`"]sys_member[`"] where .*[`"]role[`"] = \?/.test(q.sql)) reads += 1;
  });
  return { engine, driver, holders: [...holders].sort(), roleReads: () => reads };
}

const graph = (engine: ObjectQL) => new TeamGraphService({ engine: engine as never, organizationId: ORG });

describe('[#29362] TeamGraphService.expandRoleUsers reads every holder (driver-sql, shipped SysMember)', () => {
  it('⭐ past the 10,000-row bound: every holder is in the set, and no one else', async () => {
    const rig = await boot(PAGE + 1);
    const users = await graph(rig.engine).expandRoleUsers(ROLE, ORG);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_elsewhere');
    expect(users).not.toContain('usr_other_role');
    expect(rig.roleReads()).toBe(2);
  }, 30_000);

  it('⭐ a position recipient carries the completed role limb', async () => {
    const rig = await boot(PAGE + 1);
    const team = graph(rig.engine);
    const positions = new PositionGraphService({ engine: rig.engine as never, organizationId: ORG, teamGraph: team });
    const users = await positions.expandPositionUsers(ROLE, ORG);

    expect([...users].sort()).toEqual(rig.holders);
  }, 30_000);

  it('control — under the bound: one read, the same set as before', async () => {
    const rig = await boot(PAGE - 1);
    const users = await graph(rig.engine).expandRoleUsers(ROLE, ORG);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.roleReads()).toBe(1);
  }, 30_000);

  it('⛔ a read that fails refuses — it never answers an invented empty set', async () => {
    const rig = await boot(3);
    const fault = Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' });
    const memberDriver = (rig.engine as any).getDriverForObject('sys_member');
    vi.spyOn(memberDriver, 'find').mockRejectedValue(fault);

    await expect(graph(rig.engine).expandRoleUsers(ROLE, ORG)).rejects.toThrow(
      /holders of role 'sales_rep'.*could not be read/,
    );
  });

  it('⛔ a failed role read is not cached: the next read answers the real holders', async () => {
    const rig = await boot(3);
    const memberDriver = (rig.engine as any).getDriverForObject('sys_member');
    vi.spyOn(memberDriver, 'find').mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'));
    const team = graph(rig.engine);

    await expect(team.expandRoleUsers(ROLE, ORG)).rejects.toThrow(/could not be read/);
    expect([...(await team.expandRoleUsers(ROLE, ORG))].sort()).toEqual(rig.holders);
  });

  it('⛔ a position recipient whose role limb fails refuses rather than answer the assignment limb alone', async () => {
    const rig = await boot(3);
    const memberDriver = (rig.engine as any).getDriverForObject('sys_member');
    vi.spyOn(memberDriver, 'find').mockRejectedValue(new Error('SQLITE_IOERR: disk I/O error'));
    const team = graph(rig.engine);
    const positions = new PositionGraphService({ engine: rig.engine as never, organizationId: ORG, teamGraph: team });

    await expect(positions.expandPositionUsers(ROLE, ORG)).rejects.toThrow(/could not be read/);
  });

  it('a composition that never registers sys_member holds no role: [] as before', async () => {
    const rig = await boot(0, { registerMember: false });

    expect(await graph(rig.engine).expandRoleUsers(ROLE, ORG)).toEqual([]);
  });

  it('a stack whose sys_member table was never created holds no role: [] as before', async () => {
    const rig = await boot(0);
    await (rig.driver as any).knex.schema.dropTable('sys_member');

    expect(await graph(rig.engine).expandRoleUsers(ROLE, ORG)).toEqual([]);
  });
});

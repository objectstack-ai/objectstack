// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29503] The team and position recipient reads answer EVERY holder, or
 * refuse — never a shortened or an invented empty set. The close-out of the
 * family #29362 opened with the `sys_member` role read.
 *
 *   1. `TeamGraphService.expandUsers` read `sys_team_member` once at a
 *      10,000-row bound and answered `[]` on any failure.
 *   2. `PositionGraphService.expandPositionUsers` read `sys_user_position` the
 *      same way and swallowed any failure, answering the `sys_member.role`
 *      limb alone — a shrunk holder set that looks complete.
 *   3. The user-scoped twins the per-user recompute asks
 *      (`teamHasMember`, `holdsRole`, `PositionGraphService.holdsPosition`)
 *      answered `false` on a failed read, so the recompute revoked that
 *      user's grants on an outage.
 *
 * A grant set is diffed against these answers: a missing holder is a revoked
 * grant. So a failed read throws, and a walk that cannot vouch for
 * completion throws. The one failure that IS an answer is absence — the
 * object is not registered, or its table was never created — checked by
 * `isObjectAbsentError` against the object read.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the shipped `SysTeamMember` and `SysMember`, because completion is a
 * keyset read (`id > cursor`, ordered by `id`) that a double ignoring the
 * cursor cannot vouch for. `sys_user_position` is plugin-security's object,
 * which this package does not depend on; its columns are declared here as the
 * shipped object declares them.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SysMember, SysOrganization, SysTeamMember } from '@objectstack/platform-objects/identity';
import { TeamGraphService, holdsRole, teamHasMember } from './team-graph.js';
import { PositionGraphService } from './position-graph.js';

const ORG = 'org_large';
const ELSEWHERE = 'org_elsewhere';
const TEAM = 'team_large';
const POSITION = 'field_rep';
/** The bound each membership read is paged at. */
const PAGE = 10000;

const pad = (n: number) => String(n).padStart(6, '0');

/** `sys_user_position` as plugin-security ships it: the columns the reads touch. */
const SysUserPosition = ObjectSchema.create({
  name: 'sys_user_position',
  label: 'User Position',
  isSystem: true,
  fields: {
    id: Field.text({ label: 'Assignment ID', required: true }),
    user_id: Field.text({ label: 'User', required: true }),
    position: Field.text({ label: 'Position', required: true }),
    organization_id: Field.text({ label: 'Organization' }),
    valid_from: Field.datetime({ label: 'Valid From' }),
    valid_until: Field.datetime({ label: 'Valid Until' }),
  },
});

type Seeded = 'team' | 'position';

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  /** Every seeded holder, sorted. */
  holders: string[];
  /** The membership reads the driver ran, by table. */
  reads: (table: 'sys_team_member' | 'sys_user_position') => number;
  /** Make every driver read of `object` throw `fault`; other objects read as before. */
  failReadsOf: (object: string, fault?: Error) => void;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const IOERR = () => Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' });

/**
 * `n` holders of {@link TEAM} (seeded `team`) or of {@link POSITION} in
 * {@link ORG} (seeded `position`), plus the rows the predicate must keep out:
 * a member of another team, a holder of the position in another organization,
 * and an assignment whose window closed. Row ids are scrambled against user
 * ids, so the 10,001st row by id is not the 10,001st user.
 */
async function boot(seeded: Seeded, n: number, opts: { omit?: string[] } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  const omit = new Set(opts.omit ?? []);
  engine.registerApp({
    id: 'com.objectstack.qa.recipient-reads-complete',
    name: 'recipient reads complete',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysOrganization, SysMember, SysTeamMember, SysUserPosition].filter((o) => !omit.has(o.name)),
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const e = engine as any;
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: 'large' }, { context: { isSystem: true } });
  await e.insert('sys_organization', { id: ELSEWHERE, name: ELSEWHERE, slug: 'elsewhere' }, { context: { isSystem: true } });
  const holders = Array.from({ length: n }, (_, i) => `usr_${pad(i)}`);
  const id = (prefix: string, i: number) => `${prefix}_${pad((i * 7919) % 1000003)}`;
  const seed = async (object: string, rows: Record<string, unknown>[]) => {
    const d = e.getDriverForObject(object);
    for (let i = 0; i < rows.length; i += 250) await d.bulkCreate(object, rows.slice(i, i + 250));
  };
  if (seeded === 'team' && !omit.has('sys_team_member')) {
    const rows: Record<string, unknown>[] = holders.map((user_id, i) => ({ id: id('tm', i), team_id: TEAM, user_id }));
    rows.push({ id: 'tm_other_team', team_id: 'team_other', user_id: 'usr_other_team' });
    await seed('sys_team_member', rows);
  }
  if (seeded === 'position' && !omit.has('sys_user_position')) {
    const rows: Record<string, unknown>[] = holders.map((user_id, i) => ({
      id: id('up', i), user_id, position: POSITION, organization_id: ORG,
    }));
    rows.push({ id: 'up_elsewhere', user_id: 'usr_elsewhere', position: POSITION, organization_id: ELSEWHERE });
    rows.push({
      id: 'up_lapsed', user_id: 'usr_lapsed', position: POSITION, organization_id: ORG,
      valid_until: '2020-01-01T00:00:00.000Z',
    });
    await seed('sys_user_position', rows);
  }

  const counts = { sys_team_member: 0, sys_user_position: 0 };
  (driver as any).knex.on('query', (q: { sql: string }) => {
    const m = /^select .* from [`"](sys_team_member|sys_user_position)[`"]/i.exec(q.sql);
    if (m) counts[m[1] as keyof typeof counts] += 1;
  });
  const failReadsOf = (object: string, fault: Error = IOERR()) => {
    const d = e.getDriverForObject(object);
    const real = d.find.bind(d);
    vi.spyOn(d, 'find').mockImplementation(((obj: string, ...rest: unknown[]) =>
      obj === object ? Promise.reject(fault) : real(obj, ...rest)) as never);
  };
  return { engine, driver, holders: [...holders].sort(), reads: (t) => counts[t], failReadsOf };
}

const teams = (rig: Rig) => new TeamGraphService({ engine: rig.engine as never, organizationId: ORG });
const positions = (rig: Rig) => new PositionGraphService({ engine: rig.engine as never, organizationId: ORG });

describe('[#29503] site 1 — TeamGraphService.expandUsers reads every team member', () => {
  it('⭐ past the 10,000-row bound: every member is in the set, and no one else', async () => {
    const rig = await boot('team', PAGE + 1);
    const users = await teams(rig).expandUsers(TEAM);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_other_team');
    expect(rig.reads('sys_team_member')).toBe(2);
  }, 30_000);

  it('control — under the bound: one read, the same set as before', async () => {
    const rig = await boot('team', PAGE - 1);
    const users = await teams(rig).expandUsers(TEAM);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.reads('sys_team_member')).toBe(1);
  }, 30_000);

  it('⛔ a read that fails refuses — it never answers an invented empty set', async () => {
    const rig = await boot('team', 3);
    rig.failReadsOf('sys_team_member');

    await expect(teams(rig).expandUsers(TEAM)).rejects.toThrow(/members of team 'team_large'.*could not be read/);
  });

  it('⛔ a failed read is not cached: the next read answers the real members', async () => {
    const rig = await boot('team', 3);
    const d = (rig.engine as any).getDriverForObject('sys_team_member');
    vi.spyOn(d, 'find').mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'));
    const graph = teams(rig);

    await expect(graph.expandUsers(TEAM)).rejects.toThrow(/could not be read/);
    expect([...(await graph.expandUsers(TEAM))].sort()).toEqual(rig.holders);
  });

  it('a composition that never registers sys_team_member has no members: [] as before', async () => {
    const rig = await boot('team', 0, { omit: ['sys_team_member'] });

    expect(await teams(rig).expandUsers(TEAM)).toEqual([]);
  });

  it('a stack whose sys_team_member table was never created has no members: [] as before', async () => {
    const rig = await boot('team', 0);
    await (rig.driver as any).knex.schema.dropTable('sys_team_member');

    expect(await teams(rig).expandUsers(TEAM)).toEqual([]);
  });
});

describe('[#29503] site 2 — PositionGraphService.expandPositionUsers reads every assignment', () => {
  it('⭐ past the 10,000-row bound: every active holder is in the set, and no one else', async () => {
    const rig = await boot('position', PAGE + 1);
    const users = await positions(rig).expandPositionUsers(POSITION, ORG);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_elsewhere');
    expect(users).not.toContain('usr_lapsed');
    expect(rig.reads('sys_user_position')).toBe(2);
  }, 30_000);

  it('control — under the bound: one read, the same set as before', async () => {
    // 9,998 holders + the lapsed row = 9,999 rows the predicate matches.
    const rig = await boot('position', PAGE - 2);
    const users = await positions(rig).expandPositionUsers(POSITION, ORG);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.reads('sys_user_position')).toBe(1);
  }, 30_000);

  it('⛔ an assignment read that fails refuses rather than answer the membership-role limb alone', async () => {
    const rig = await boot('position', 3);
    await (rig.engine as any).getDriverForObject('sys_member').bulkCreate('sys_member', [
      { id: 'mem_role', user_id: 'usr_role', organization_id: ORG, role: POSITION },
    ]);
    rig.failReadsOf('sys_user_position');

    await expect(positions(rig).expandPositionUsers(POSITION, ORG)).rejects.toThrow(
      /assignments of position 'field_rep'.*could not be read/,
    );
  });

  it('a composition that never registers sys_user_position answers the membership-role limb, with no refusal', async () => {
    const rig = await boot('position', 0, { omit: ['sys_user_position'] });
    await (rig.engine as any).getDriverForObject('sys_member').bulkCreate('sys_member', [
      { id: 'mem_role', user_id: 'usr_role', organization_id: ORG, role: POSITION },
    ]);

    expect(await positions(rig).expandPositionUsers(POSITION, ORG)).toEqual(['usr_role']);
  });

  it('a stack whose sys_user_position table was never created answers the membership-role limb', async () => {
    const rig = await boot('position', 0);
    await (rig.driver as any).knex.schema.dropTable('sys_user_position');

    expect(await positions(rig).expandPositionUsers(POSITION, ORG)).toEqual([]);
  });
});

describe('[#29503] site 3 — the user-scoped holder checks refuse on a failed read', () => {
  it('control — teamHasMember, holdsRole and holdsPosition answer from the rows', async () => {
    const rig = await boot('team', 2);
    await (rig.engine as any).getDriverForObject('sys_member').bulkCreate('sys_member', [
      { id: 'mem_role', user_id: 'usr_role', organization_id: ORG, role: POSITION },
    ]);

    expect(await teamHasMember(rig.engine as never, TEAM, 'usr_000001')).toBe(true);
    expect(await teamHasMember(rig.engine as never, TEAM, 'usr_other_team')).toBe(false);
    expect(await holdsRole(rig.engine as never, POSITION, 'usr_role', ORG)).toBe(true);
    expect(await holdsRole(rig.engine as never, POSITION, 'usr_000001', ORG)).toBe(false);
    expect(await positions(rig).holdsPosition('usr_role', POSITION, ORG)).toBe(true);
  });

  it('⛔ teamHasMember refuses on a failed read — never "not a member"', async () => {
    const rig = await boot('team', 2);
    rig.failReadsOf('sys_team_member');

    await expect(teamHasMember(rig.engine as never, TEAM, 'usr_000001')).rejects.toThrow(
      /whether user 'usr_000001' is a member of team 'team_large' could not be read/,
    );
  });

  it('⛔ holdsRole refuses on a failed read — never "does not hold it"', async () => {
    const rig = await boot('team', 0);
    rig.failReadsOf('sys_member');

    await expect(holdsRole(rig.engine as never, POSITION, 'usr_role', ORG)).rejects.toThrow(
      /whether user 'usr_role' holds role 'field_rep'.*could not be read/,
    );
  });

  it('⛔ holdsPosition refuses on a failed assignment read — never falls through to the role limb alone', async () => {
    const rig = await boot('position', 2);
    rig.failReadsOf('sys_user_position');

    await expect(positions(rig).holdsPosition('usr_000001', POSITION, ORG)).rejects.toThrow(
      /whether user 'usr_000001' holds position 'field_rep'.*could not be read/,
    );
  });

  it('absence still answers: no sys_team_member / sys_member / sys_user_position means not a holder', async () => {
    const rig = await boot('team', 0, { omit: ['sys_team_member', 'sys_member', 'sys_user_position'] });

    expect(await teamHasMember(rig.engine as never, TEAM, 'usr_000001')).toBe(false);
    expect(await holdsRole(rig.engine as never, POSITION, 'usr_role', ORG)).toBe(false);
    expect(await positions(rig).holdsPosition('usr_role', POSITION, ORG)).toBe(false);
  });
});

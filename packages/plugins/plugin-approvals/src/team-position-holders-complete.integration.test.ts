// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29503] The approver `team` expansion (`sys_team_member`) and the
 * assignment limb of the `position` expansion (`sys_user_position`) answer
 * EVERY holder, or refuse — never a shortened or an invented empty slate. The
 * close-out of the family #29362 opened with the `sys_member` tier read.
 *
 * Both read once at a 10,000-row bound and took that read as the holder list,
 * and both turned a read that threw into nothing:
 *
 *   - past 10,000 holders the slate was missing the holders past the 10,000th
 *     row, with no signal;
 *   - a failed `sys_team_member` read logged "expanded to nobody",
 *     indistinguishable from an empty team;
 *   - a failed `sys_user_position` read routed a `position` approver to its
 *     `sys_member.role` holders ALONE — a shrunk slate that looks complete.
 *
 * What a caller sees now: the expansion throws, the approver-spec resolver's
 * directory catch takes it, and the slot falls back to its literal with the
 * warning that names the failed read and carries its `error`. A membership
 * object that does not exist is still no holders.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the shipped `SysTeamMember` and `SysMember`; `sys_user_position` is
 * plugin-security's object and is declared here with the columns it ships.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SysMember, SysOrganization, SysTeamMember } from '@objectstack/platform-objects/identity';
import { ApprovalService } from './approval-service.js';

const ORG = 'org_large';
const ELSEWHERE = 'org_elsewhere';
const TEAM = 'team_large';
const POSITION = 'cfo_office';
/** The bound each read is paged at. */
const PAGE = 10000;

const pad = (n: number) => String(n).padStart(6, '0');

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

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  svc: ApprovalService;
  warn: ReturnType<typeof vi.fn>;
  holders: string[];
  reads: (table: 'sys_team_member' | 'sys_user_position') => number;
  failReadsOf: (object: string) => void;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(seeded: 'team' | 'position', n: number, opts: { omit?: string[] } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  const omit = new Set(opts.omit ?? []);
  engine.registerApp({
    id: 'com.objectstack.qa.team-position-holders-complete',
    name: 'team position holders complete',
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
    await seed('sys_user_position', rows);
  }

  const counts = { sys_team_member: 0, sys_user_position: 0 };
  (driver as any).knex.on('query', (q: { sql: string }) => {
    const m = /^select .* from [`"](sys_team_member|sys_user_position)[`"]/i.exec(q.sql);
    if (m) counts[m[1] as keyof typeof counts] += 1;
  });
  const failReadsOf = (object: string) => {
    const d = e.getDriverForObject(object);
    const real = d.find.bind(d);
    vi.spyOn(d, 'find').mockImplementation(((obj: string, ...rest: unknown[]) =>
      obj === object
        ? Promise.reject(Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' }))
        : real(obj, ...rest)) as never);
  };
  const warn = vi.fn();
  const svc = new ApprovalService({
    engine: engine as any,
    logger: { warn, info: () => {}, error: () => {}, debug: () => {} } as any,
  });
  return { engine, driver, svc, warn, holders: [...holders].sort(), reads: (t) => counts[t], failReadsOf };
}

/** The private expansions and the resolver, as the request opener calls them. */
const team = (rig: Rig, value = TEAM) => (rig.svc as any).expandTeamUsers(value, ORG) as Promise<string[]>;
const position = (rig: Rig, value = POSITION) => (rig.svc as any).expandPositionUsers(value, ORG) as Promise<string[]>;
const resolveSpec = (rig: Rig, a: { type: string; value: string }) =>
  (rig.svc as any).resolveApproverSpec(a, undefined, ORG, Date.now()) as Promise<string[]>;
const failureWarnings = (rig: Rig) => rig.warn.mock.calls.filter(([, meta]) => typeof meta?.error === 'string');

describe('[#29503] approvals team expansion reads every member (driver-sql, shipped SysTeamMember)', () => {
  it('⭐ past the 10,000-row bound: every member is on the slate, and no one else', async () => {
    const rig = await boot('team', PAGE + 1);
    const users = await team(rig);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_other_team');
    expect(rig.reads('sys_team_member')).toBe(2);
  }, 30_000);

  it('⭐ a team approver routes to every member past the bound', async () => {
    const rig = await boot('team', PAGE + 1);
    const slate = await resolveSpec(rig, { type: 'team', value: TEAM });

    expect([...slate].sort()).toEqual(rig.holders);
  }, 30_000);

  it('control — under the bound: one read, the same slate as before', async () => {
    const rig = await boot('team', PAGE - 1);
    const users = await team(rig);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.reads('sys_team_member')).toBe(1);
  }, 30_000);

  it('⛔ a team read that fails refuses — it never answers an invented empty set', async () => {
    const rig = await boot('team', 3);
    rig.failReadsOf('sys_team_member');

    await expect(team(rig)).rejects.toThrow(/members of team 'team_large'.*could not be read/);
  });

  it('⛔ what the caller sees: the team slot falls back to its literal, and the warning names the failed read', async () => {
    const rig = await boot('team', 3);
    rig.failReadsOf('sys_team_member');

    expect(await resolveSpec(rig, { type: 'team', value: TEAM })).toEqual([`team:${TEAM}`]);
    const failed = failureWarnings(rig);
    expect(failed.map(([, meta]) => meta.type)).toEqual(['team']);
    expect(failed[0][0]).toMatch(/could not be expanded — a directory or read-filter lookup failed/);
    expect(failed[0][1].error).toMatch(/SQLITE_IOERR/);
  });

  it('a composition that never registers sys_team_member has no members: the literal, with no failure warning', async () => {
    const rig = await boot('team', 0, { omit: ['sys_team_member'] });

    expect(await team(rig)).toEqual([]);
    expect(await resolveSpec(rig, { type: 'team', value: TEAM })).toEqual([`team:${TEAM}`]);
    expect(failureWarnings(rig)).toEqual([]);
  });
});

describe('[#29503] approvals position expansion reads every assignment (driver-sql)', () => {
  it('⭐ past the 10,000-row bound: every assignment holder is on the slate, and no one else', async () => {
    const rig = await boot('position', PAGE + 1);
    const users = await position(rig);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_elsewhere');
    expect(rig.reads('sys_user_position')).toBe(2);
  }, 30_000);

  it('control — under the bound: one read, the same slate as before', async () => {
    const rig = await boot('position', PAGE - 1);
    const users = await position(rig);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.reads('sys_user_position')).toBe(1);
  }, 30_000);

  it('⛔ an assignment read that fails refuses rather than route to the membership-tier limb alone', async () => {
    const rig = await boot('position', 3);
    await (rig.engine as any).getDriverForObject('sys_member').bulkCreate('sys_member', [
      { id: 'mem_tier', user_id: 'usr_tier', organization_id: ORG, role: POSITION },
    ]);
    rig.failReadsOf('sys_user_position');

    await expect(position(rig)).rejects.toThrow(/assignments of position 'cfo_office'.*could not be read/);
  });

  it('⛔ what the caller sees: the position slot falls back to its literal, never the tier holders alone', async () => {
    const rig = await boot('position', 3);
    await (rig.engine as any).getDriverForObject('sys_member').bulkCreate('sys_member', [
      { id: 'mem_tier', user_id: 'usr_tier', organization_id: ORG, role: POSITION },
    ]);
    rig.failReadsOf('sys_user_position');

    expect(await resolveSpec(rig, { type: 'position', value: POSITION })).toEqual([`position:${POSITION}`]);
    const failed = failureWarnings(rig);
    expect(failed.map(([, meta]) => meta.type)).toEqual(['position']);
    expect(failed[0][1].error).toMatch(/SQLITE_IOERR/);
  });

  it('a composition that never registers sys_user_position routes to the membership-tier limb, with no failure warning', async () => {
    const rig = await boot('position', 0, { omit: ['sys_user_position'] });
    await (rig.engine as any).getDriverForObject('sys_member').bulkCreate('sys_member', [
      { id: 'mem_tier', user_id: 'usr_tier', organization_id: ORG, role: POSITION },
    ]);

    expect(await resolveSpec(rig, { type: 'position', value: POSITION })).toEqual(['usr_tier']);
    expect(failureWarnings(rig)).toEqual([]);
  });

  it('a stack whose sys_user_position table was never created routes to the membership-tier limb', async () => {
    const rig = await boot('position', 0);
    await (rig.driver as any).knex.schema.dropTable('sys_user_position');
    await (rig.engine as any).getDriverForObject('sys_member').bulkCreate('sys_member', [
      { id: 'mem_tier', user_id: 'usr_tier', organization_id: ORG, role: POSITION },
    ]);

    expect(await position(rig)).toEqual(['usr_tier']);
  });
});

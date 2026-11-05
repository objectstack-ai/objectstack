// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29606] The approver business-unit expansion (`sys_business_unit_member`)
 * answers EVERY member of the subtree, or refuses — never a shortened or an
 * invented empty slate. The family #29362 and #29503 closed for the tier,
 * position and team reads.
 *
 * It read once at a 10,000-row bound and took that read as the slate, and it
 * turned a read that threw into nothing: past the bound the slate was missing
 * every member after the 10,000th row, with no signal, and a failed read
 * logged "expanded to nobody", indistinguishable from an unstaffed unit.
 *
 * What a caller sees now: the expansion throws, the approver-spec resolver's
 * directory catch takes it, and the slot falls back to its literal with the
 * warning that names the failed read and carries its `error`. A membership
 * object that does not exist is still no members.
 *
 * Item 3 of the card rides here too: an `expression` approver whose
 * `resolveAs` expansion fails kept its `<kind>:<value>` literal slot with no
 * warning at all. It now logs the same line, with the error.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the shipped `SysBusinessUnit` and `SysBusinessUnitMember`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  SysBusinessUnit, SysBusinessUnitMember, SysMember, SysOrganization, SysTeamMember,
} from '@objectstack/platform-objects/identity';
import { ApprovalService, ApproverDirectoryUnreadableError } from './approval-service.js';

const ORG = 'org_large';
const ELSEWHERE = 'org_elsewhere';
const ROOT = 'bu_root';
const CHILD = 'bu_child';
const OTHER = 'bu_other';
/** The bound each read is paged at. */
const PAGE = 10000;

const pad = (n: number) => String(n).padStart(6, '0');

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  svc: ApprovalService;
  warn: ReturnType<typeof vi.fn>;
  holders: string[];
  reads: () => number;
  failReadsOf: (object: string) => void;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * `n` members in {@link ORG}: the even ones on {@link ROOT}, the odd ones on
 * its child {@link CHILD}. Plus a member of another unit and a member of ROOT
 * stamped with another organization, which the slate must keep out. Row ids
 * are scrambled against user ids.
 */
async function boot(n: number, opts: { omit?: string[] } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  const omit = new Set(opts.omit ?? []);
  engine.registerApp({
    id: 'com.objectstack.qa.business-unit-holders-complete',
    name: 'business unit holders complete',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysOrganization, SysMember, SysTeamMember, SysBusinessUnit, SysBusinessUnitMember]
      .filter((o) => !omit.has(o.name)),
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const e = engine as any;
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: 'large' }, { context: { isSystem: true } });
  await e.insert('sys_organization', { id: ELSEWHERE, name: ELSEWHERE, slug: 'elsewhere' }, { context: { isSystem: true } });
  await e.getDriverForObject('sys_business_unit').bulkCreate('sys_business_unit', [
    { id: ROOT, name: 'Root', kind: 'division', active: true, organization_id: ORG },
    { id: CHILD, name: 'Child', kind: 'department', active: true, parent_business_unit_id: ROOT, organization_id: ORG },
    { id: OTHER, name: 'Other', kind: 'department', active: true, organization_id: ORG },
  ]);
  const holders = Array.from({ length: n }, (_, i) => `usr_${pad(i)}`);
  if (!omit.has('sys_business_unit_member')) {
    const id = (i: number) => `bum_${pad((i * 7919) % 1000003)}`;
    const rows: Record<string, unknown>[] = holders.map((user_id, i) => ({
      id: id(i), user_id, business_unit_id: i % 2 ? CHILD : ROOT, organization_id: ORG,
    }));
    rows.push({ id: 'bum_other_unit', user_id: 'usr_other_unit', business_unit_id: OTHER, organization_id: ORG });
    rows.push({ id: 'bum_elsewhere', user_id: 'usr_elsewhere', business_unit_id: ROOT, organization_id: ELSEWHERE });
    const d = e.getDriverForObject('sys_business_unit_member');
    for (let i = 0; i < rows.length; i += 250) await d.bulkCreate('sys_business_unit_member', rows.slice(i, i + 250));
  }

  let count = 0;
  (driver as any).knex.on('query', (q: { sql: string }) => {
    if (/^select .* from [`"]sys_business_unit_member[`"]/i.test(q.sql)) count += 1;
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
  return { engine, driver, svc, warn, holders: [...holders].sort(), reads: () => count, failReadsOf };
}

/** The private expansion and the resolvers, as the request opener calls them. */
const department = (rig: Rig, value = ROOT) =>
  (rig.svc as any).expandBusinessUnitUsers(value, ORG) as Promise<string[]>;
const resolveSpec = (rig: Rig, a: { type: string; value: string }) =>
  (rig.svc as any).resolveApproverSpec(a, undefined, ORG, Date.now()) as Promise<string[]>;
const resolveExpression = (rig: Rig, a: { type: string; value: string; resolveAs: string }, onDirectoryFailure?: 'refuse' | 'literal') =>
  (rig.svc as any).resolveExpressionApprovers(a, {}, ORG, Date.now(), undefined, undefined, onDirectoryFailure) as Promise<{
    slots: Array<{ id: string; subGroup?: string }>;
    raw: string[];
  }>;
const failureWarnings = (rig: Rig) => rig.warn.mock.calls.filter(([, meta]) => typeof meta?.error === 'string');

describe('[#29606] approvals business-unit expansion reads every member (driver-sql, shipped SysBusinessUnitMember)', () => {
  it('⭐ past the 10,000-row bound: every member of the unit and its child is on the slate, and no one else', async () => {
    const rig = await boot(PAGE + 1);
    const users = await department(rig);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_other_unit');
    expect(users).not.toContain('usr_elsewhere');
    expect(rig.reads()).toBe(2);
  }, 30_000);

  it('⭐ a department approver routes to every member past the bound', async () => {
    const rig = await boot(PAGE + 1);
    const slate = await resolveSpec(rig, { type: 'department', value: ROOT });

    expect([...slate].sort()).toEqual(rig.holders);
  }, 30_000);

  it('control — under the bound: one read, the same slate as before', async () => {
    const rig = await boot(PAGE - 1);
    const users = await department(rig);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.reads()).toBe(1);
  }, 30_000);

  it('⛔ a member read that fails refuses — it never answers an invented empty set', async () => {
    const rig = await boot(3);
    rig.failReadsOf('sys_business_unit_member');

    await expect(department(rig)).rejects.toThrow(
      /members of business unit 'bu_root' and its descendant units in organization 'org_large' could not be read/,
    );
  });

  it('⛔ what the caller sees: the department slot falls back to its literal, and the warning names the failed read', async () => {
    const rig = await boot(3);
    rig.failReadsOf('sys_business_unit_member');

    expect(await resolveSpec(rig, { type: 'department', value: ROOT })).toEqual([`department:${ROOT}`]);
    const failed = failureWarnings(rig);
    expect(failed.map(([, meta]) => meta.type)).toEqual(['department']);
    expect(failed[0][0]).toMatch(/could not be expanded — a directory or read-filter lookup failed/);
    expect(failed[0][1].error).toMatch(/SQLITE_IOERR/);
  });

  it('a composition that never registers sys_business_unit_member has no members: the literal, with no failure warning', async () => {
    const rig = await boot(0, { omit: ['sys_business_unit_member'] });

    expect(await department(rig)).toEqual([]);
    expect(await resolveSpec(rig, { type: 'department', value: ROOT })).toEqual([`department:${ROOT}`]);
    expect(failureWarnings(rig)).toEqual([]);
  });

  it('a stack whose sys_business_unit_member table was never created has no members', async () => {
    const rig = await boot(0);
    await (rig.driver as any).knex.schema.dropTable('sys_business_unit_member');

    expect(await department(rig)).toEqual([]);
  });
});

describe('[#29606] item 3 — an expression approver whose resolveAs expansion fails says so', () => {
  it('control — a resolveAs department value expands to its members, with no failure warning', async () => {
    const rig = await boot(3);
    const { slots } = await resolveExpression(rig, { type: 'expression', value: `'${ROOT}'`, resolveAs: 'department' });

    expect(slots.map((s) => s.id).sort()).toEqual(rig.holders);
    expect(failureWarnings(rig)).toEqual([]);
  });

  it('⛔ a failed department read keeps the literal slot and logs the "could not be expanded" warning, with the error', async () => {
    const rig = await boot(3);
    rig.failReadsOf('sys_business_unit_member');
    const { slots } = await resolveExpression(rig, { type: 'expression', value: `'${ROOT}'`, resolveAs: 'department' });

    expect(slots).toEqual([{ id: `department:${ROOT}`, subGroup: ROOT }]);
    const failed = failureWarnings(rig);
    expect(failed).toHaveLength(1);
    expect(failed[0][0]).toMatch(/approver 'department:bu_root' could not be expanded — a directory or read-filter lookup failed/);
    expect(failed[0][1]).toMatchObject({ type: 'department', value: ROOT, organizationId: ORG, expression: `'${ROOT}'` });
    expect(failed[0][1].error).toMatch(/SQLITE_IOERR/);
  });

  it('⛔ a failed team read through resolveAs refuses the node as a team approver does; the literal reader warns the same way', async () => {
    const rig = await boot(0);
    rig.failReadsOf('sys_team_member');
    // [ADR-0142 D6 as amended, #29604] The value is read through the team
    // expander, so its failure refuses the node like a static `team` approver's.
    const refusal = await resolveExpression(rig, { type: 'expression', value: `'team_x'`, resolveAs: 'team' })
      .then(() => null, (e: unknown) => e);
    expect(refusal).toBeInstanceOf(ApproverDirectoryUnreadableError);
    expect(refusal).toMatchObject({ approverType: 'team', approverValue: 'team_x', retryable: true });
    expect((refusal as Error).message).toMatch(/^APPROVER_DIRECTORY_UNREADABLE: approver 'expression' \(resolveAs 'team', value 'team_x'\)/);

    const { slots } = await resolveExpression(rig, { type: 'expression', value: `'team_x'`, resolveAs: 'team' }, 'literal');

    expect(slots).toEqual([{ id: 'team:team_x', subGroup: 'team_x' }]);
    const failed = failureWarnings(rig);
    expect(failed.map(([, meta]) => meta.type)).toEqual(['team']);
    expect(failed[0][1].error).toMatch(/SQLITE_IOERR/);
  });

  it('a resolveAs value whose unit has no members keeps the literal with no failure warning', async () => {
    const rig = await boot(0, { omit: ['sys_business_unit_member'] });
    const { slots } = await resolveExpression(rig, { type: 'expression', value: `'${ROOT}'`, resolveAs: 'department' });

    expect(slots).toEqual([{ id: `department:${ROOT}`, subGroup: ROOT }]);
    expect(failureWarnings(rig)).toEqual([]);
  });
});

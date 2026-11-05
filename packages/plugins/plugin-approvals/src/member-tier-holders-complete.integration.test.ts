// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29362] The membership-tier expansion (`sys_member.role`) answers EVERY
 * holder of a tier, or refuses — never a shortened or an invented empty set.
 *
 * `expandMembershipTierUsers` is the whole of an `org_membership_level`
 * approver and the second limb of every `position` approver (ADR-0057 D4
 * transition source). It used to read `sys_member` once with a 10,000-row
 * bound and take that read as the holder list, and it turned a read that threw
 * into `[]`:
 *
 *   - past 10,000 holders the request routed to a slate missing the holders
 *     past the 10,000th row, with no signal;
 *   - a read that failed routed a `position` approver to its assignment-table
 *     holders ALONE — a shrunk slate that looks exactly like a complete one —
 *     and an `org_membership_level` approver logged "expanded to nobody",
 *     indistinguishable from a tier nobody holds.
 *
 * What a caller sees now: a failed read throws out of the expansion and the
 * approver-spec resolver's directory catch takes it. An `org_membership_level`
 * slot falls back to its literal (`org_membership_level:<t>`, decided by the
 * override) with a warning that names the failed read and carries its `error`.
 * [ADR-0142 D6 as amended, #29604] A `position` approver, whose transition limb
 * this read is, refuses the approval node instead
 * (`ApproverDirectoryUnreadableError`); only the `'literal'` reader keeps its
 * `position:<p>` literal. Never a slate cut down to the part that happened to
 * read.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the shipped `SysMember`, because the completion is a keyset read
 * (`id > cursor`, ordered by `id`) that a hand-written double cannot vouch for.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { ApprovalService, ApproverDirectoryUnreadableError } from './approval-service.js';

const ORG = 'org_large';
const ELSEWHERE = 'org_elsewhere';
const TIER = 'admin';
/** The bound the tier read is paged at. */
const PAGE = 10000;

const pad = (n: number) => String(n).padStart(6, '0');

interface Rig {
  engine: ObjectQL;
  svc: ApprovalService;
  warn: ReturnType<typeof vi.fn>;
  /** Every holder of {@link TIER} in {@link ORG}, sorted. */
  holders: string[];
  /** The tier reads the driver ran (`… from sys_member where … role = ? …`). */
  tierReads: () => number;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * `n` holders of {@link TIER} in {@link ORG}, plus a holder of the same tier in
 * another organization and a member of {@link ORG} in another tier — the two
 * rows the predicate must keep out. Membership ids are scrambled against the
 * user ids, so an unordered first read is not the lowest ids.
 */
async function boot(n: number, opts: { registerMember?: boolean } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.member-tier-holders-complete',
    name: 'member tier holders complete',
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
  const rows = holders.map((user_id, i) => ({
    id: `mem_${pad((i * 7919) % 1000003)}`, user_id, organization_id: ORG, role: TIER,
  }));
  rows.push({ id: 'mem_elsewhere', user_id: 'usr_elsewhere', organization_id: ELSEWHERE, role: TIER });
  rows.push({ id: 'mem_other_tier', user_id: 'usr_other_tier', organization_id: ORG, role: 'member' });
  if (opts.registerMember !== false) {
    const memberDriver = e.getDriverForObject('sys_member');
    for (let i = 0; i < rows.length; i += 250) await memberDriver.bulkCreate('sys_member', rows.slice(i, i + 250));
  }

  let reads = 0;
  (driver as any).knex.on('query', (q: { sql: string }) => {
    if (/from [`"]sys_member[`"] where .*[`"]role[`"] = \?/.test(q.sql)) reads += 1;
  });
  const warn = vi.fn();
  const svc = new ApprovalService({
    engine: engine as any,
    logger: { warn, info: () => {}, error: () => {}, debug: () => {} } as any,
  });
  return { engine, svc, warn, holders: [...holders].sort(), tierReads: () => reads };
}

/** The private expansions, as the approver-spec resolver calls them. */
const tier = (rig: Rig, value: string) => (rig.svc as any).expandMembershipTierUsers(value, ORG) as Promise<string[]>;
const position = (rig: Rig, value: string) => (rig.svc as any).expandPositionUsers(value, ORG) as Promise<string[]>;
const resolveSpec = (rig: Rig, a: { type: string; value: string }, onDirectoryFailure?: 'refuse' | 'literal') =>
  (rig.svc as any).resolveApproverSpec(a, undefined, ORG, Date.now(), undefined, onDirectoryFailure) as Promise<string[]>;

const failMemberReads = (rig: Rig, fault: Error) => {
  const memberDriver = (rig.engine as any).getDriverForObject('sys_member');
  return vi.spyOn(memberDriver, 'find').mockRejectedValue(fault);
};

describe('[#29362] approvals membership-tier expansion reads every holder (driver-sql, shipped SysMember)', () => {
  it('⭐ past the 10,000-row bound: every holder is on the slate, and no one else', async () => {
    const rig = await boot(PAGE + 1);
    const users = await tier(rig, TIER);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_elsewhere');
    expect(users).not.toContain('usr_other_tier');
    expect(rig.tierReads()).toBe(2);
  }, 30_000);

  it('⭐ an org_membership_level approver routes to every holder past the bound', async () => {
    const rig = await boot(PAGE + 1);
    const slate = await resolveSpec(rig, { type: 'org_membership_level', value: TIER });

    expect([...slate].sort()).toEqual(rig.holders);
  }, 30_000);

  it('control — under the bound: one read, the same slate as before', async () => {
    const rig = await boot(PAGE - 1);
    const users = await tier(rig, TIER);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.tierReads()).toBe(1);
  }, 30_000);

  it('⛔ a tier read that fails refuses — it never answers an invented empty set', async () => {
    const rig = await boot(3);
    failMemberReads(rig, Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' }));

    await expect(tier(rig, TIER)).rejects.toThrow(/holders of membership tier 'admin'.*could not be read/);
  });

  it('⛔ a position whose tier limb fails refuses rather than route to the assignment limb alone', async () => {
    const rig = await boot(3);
    failMemberReads(rig, new Error('SQLITE_IOERR: disk I/O error'));

    await expect(position(rig, TIER)).rejects.toThrow(/could not be read/);
  });

  it('a composition that never registers sys_member holds no tier: [] as before, and the position keeps its literal', async () => {
    const rig = await boot(0, { registerMember: false });

    expect(await tier(rig, TIER)).toEqual([]);
    expect(await resolveSpec(rig, { type: 'position', value: TIER })).toEqual([`position:${TIER}`]);
    expect(rig.warn.mock.calls.some(([, meta]) => typeof meta?.error === 'string')).toBe(false);
  });

  it('⛔ what the caller sees: a position refuses the node on its sys_member limb; the tier slot keeps its literal', async () => {
    const rig = await boot(3);
    failMemberReads(rig, new Error('SQLITE_IOERR: disk I/O error'));

    // [#29604] The ADR-0057 D4 transition limb is a read behind the position:
    // its failure is a failed read, and the node refuses on it.
    const refusal = await resolveSpec(rig, { type: 'position', value: TIER }).then(() => null, (e: unknown) => e);
    expect(refusal).toBeInstanceOf(ApproverDirectoryUnreadableError);
    expect(refusal).toMatchObject({ approverType: 'position', approverValue: TIER, retryable: true });
    expect((refusal as ApproverDirectoryUnreadableError).failedRead).toMatch(/SQLITE_IOERR/);

    expect(await resolveSpec(rig, { type: 'position', value: TIER }, 'literal')).toEqual([`position:${TIER}`]);
    expect(await resolveSpec(rig, { type: 'org_membership_level', value: TIER })).toEqual([`org_membership_level:${TIER}`]);
    const failed = rig.warn.mock.calls.filter(([, meta]) => typeof meta?.error === 'string');
    expect(failed.map(([, meta]) => meta.type)).toEqual(['position', 'org_membership_level']);
    for (const [line, meta] of failed) {
      expect(line).toMatch(/could not be expanded — a directory or read-filter lookup failed/);
      expect(meta.error).toMatch(/SQLITE_IOERR/);
    }
  });
});

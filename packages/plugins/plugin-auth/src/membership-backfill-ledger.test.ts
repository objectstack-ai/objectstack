// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0093 D6 backfill is ONE-TIME per deployment (ADR-0093 D7:
 * membership is decided at creation). These cases pin the ledger gate around
 * it: which verdicts are remembered, that a remembered verdict binds nobody —
 * the removed-member case — and the two failure directions.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';
import {
  MEMBERSHIP_BACKFILL_MIGRATION_ID,
  runOneTimeMembershipBackfill,
} from './membership-backfill-ledger.js';

const ORG = 'org_default';

interface Tables {
  sys_organization: Array<{ id: string }>;
  sys_user: Array<{ id: string }>;
  sys_member: Array<{ id?: string; organization_id: string; user_id: string; role?: string }>;
  sys_migration: Array<Record<string, unknown>>;
}

function makeEngine(seed: Partial<Tables> = {}, opts: { ledger?: boolean } = {}) {
  const tables: Tables = {
    sys_organization: [...(seed.sys_organization ?? [])],
    sys_user: [...(seed.sys_user ?? [])],
    sys_member: [...(seed.sys_member ?? [])],
    sys_migration: [...(seed.sys_migration ?? [])],
  };
  const engine = {
    tables,
    getObject: vi.fn((name: string) =>
      name === 'sys_migration' && opts.ledger === false ? undefined : { name },
    ),
    // Honours the keyset walk's seek (`id > cursor`), order and page size.
    find: vi.fn(async (object: string, q: any) => {
      const gt = q?.where?.id?.$gt;
      const rows = [...((tables as any)[object] ?? [])]
        .filter((r: any) => gt === undefined || String(r.id) > String(gt))
        .sort((a: any, b: any) => (String(a.id) < String(b.id) ? -1 : 1));
      return rows.slice(0, q?.limit ?? rows.length);
    }),
    findOne: vi.fn(async (object: string, q: any) => {
      assertEngineFindOnePredicate(object, q);
      return ((tables as any)[object] ?? []).find((r: any) => r.id === q?.where?.id) ?? null;
    }),
    insert: vi.fn(async (object: string, data: any) => {
      ((tables as any)[object] ??= []).push({ ...data });
      return data;
    }),
  };
  return engine;
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const auto = { policy: 'auto' as const, resolveTargetOrg: async () => ORG };

describe('one-time membership backfill (ADR-0093 D6 + D7)', () => {
  it('first pass: binds pre-existing member-less users and records the verdict', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_legacy' }] });
    const res = await runOneTimeMembershipBackfill(engine, auto, logger());
    expect(res.status).toBe('ran');
    expect(engine.tables.sys_member).toEqual([
      expect.objectContaining({ organization_id: ORG, user_id: 'u_legacy', role: 'member' }),
    ]);
    expect(engine.tables.sys_migration).toHaveLength(1);
    expect(engine.tables.sys_migration[0]).toMatchObject({
      id: MEMBERSHIP_BACKFILL_MIGRATION_ID,
      verified_at: null,
      blocking: 0,
    });
    expect(JSON.parse(String(engine.tables.sys_migration[0].details))).toMatchObject({ policy: 'auto', bound: 1 });
  });

  it('a recorded verdict binds nobody', async () => {
    const engine = makeEngine({
      sys_user: [{ id: 'u_removed' }],
      sys_migration: [{ id: MEMBERSHIP_BACKFILL_MIGRATION_ID, blocking: 0 }],
    });
    const res = await runOneTimeMembershipBackfill(engine, auto, logger());
    expect(res.status).toBe('already-run');
    expect(engine.tables.sys_member).toHaveLength(0);
    expect(engine.insert).not.toHaveBeenCalled();
    // Not even scanned: the user table is never read.
    expect(engine.find).not.toHaveBeenCalled();
  });

  it('two consecutive passes: the second is a no-op whatever the membership state', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_a' }] });
    expect((await runOneTimeMembershipBackfill(engine, auto, logger())).status).toBe('ran');
    engine.tables.sys_member.length = 0; // an administrator removes the membership
    expect((await runOneTimeMembershipBackfill(engine, auto, logger())).status).toBe('already-run');
    expect(engine.tables.sys_member).toHaveLength(0);
  });

  it('`invite-only` is a decided verdict: nothing bound, the verdict recorded', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_a' }] });
    const res = await runOneTimeMembershipBackfill(
      engine,
      { policy: 'invite-only', resolveTargetOrg: async () => ORG },
      logger(),
    );
    expect(res.status).toBe('ran');
    expect(res.backfill?.reason).toBe('policy');
    expect(engine.tables.sys_member).toHaveLength(0);
    expect(engine.tables.sys_migration).toHaveLength(1);
    // A later switch to `auto` does not sweep in the users created under it.
    expect((await runOneTimeMembershipBackfill(engine, auto, logger())).status).toBe('already-run');
    expect(engine.tables.sys_member).toHaveLength(0);
  });

  it('no target organization while organizations exist (multi-org): the refusal is recorded', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_a' }], sys_organization: [{ id: 'org_a' }, { id: 'org_b' }] });
    const res = await runOneTimeMembershipBackfill(
      engine,
      { policy: 'auto', resolveTargetOrg: async () => null },
      logger(),
    );
    expect(res.status).toBe('ran');
    expect(res.backfill?.reason).toBe('no-target-org');
    expect(engine.tables.sys_member).toHaveLength(0);
    expect(engine.tables.sys_migration).toHaveLength(1);
    // A later pass that now has a target binds nobody.
    expect((await runOneTimeMembershipBackfill(engine, auto, logger())).status).toBe('already-run');
    expect(engine.tables.sys_member).toHaveLength(0);
  });

  it('scans past one page: every member-less user is bound, members are not', async () => {
    const users = Array.from({ length: 7 }, (_, i) => ({ id: `u_${i}` }));
    const engine = makeEngine({
      sys_user: users,
      sys_member: [{ id: 'm_1', organization_id: ORG, user_id: 'u_5', role: 'member' }],
    });
    const res = await runOneTimeMembershipBackfill(engine, { ...auto, limit: 2 }, logger());
    expect(res.status).toBe('ran');
    expect(res.backfill).toMatchObject({ scanned: 7, bound: 6, skipped: 1 });
    expect(engine.tables.sys_member.map((m) => m.user_id).sort()).toEqual(users.map((u) => u.id).sort());
  });

  it('a scan that cannot read a table in full binds nobody and records nothing', async () => {
    const engine = makeEngine({ sys_user: Array.from({ length: 5 }, (_, i) => ({ id: `u_${i}` })) });
    const realFind = engine.find.getMockImplementation()!;
    engine.find.mockImplementation(async (object: string, q: any) => {
      if (object === 'sys_user' && q?.where?.id?.$gt !== undefined) throw new Error('page 2 failed');
      return realFind(object, q);
    });
    const res = await runOneTimeMembershipBackfill(engine, { ...auto, limit: 2 }, logger());
    expect(res.status).toBe('undecided');
    expect(res.backfill?.reason).toBe('scan-incomplete');
    expect(engine.tables.sys_member).toHaveLength(0);
    expect(engine.tables.sys_migration).toHaveLength(0);
  });

  it('no target organization and no organization at all (fresh install): undecided, nothing recorded', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_a' }] });
    const res = await runOneTimeMembershipBackfill(
      engine,
      { policy: 'auto', resolveTargetOrg: async () => null },
      logger(),
    );
    expect(res.status).toBe('undecided');
    expect(engine.tables.sys_member).toHaveLength(0);
    expect(engine.tables.sys_migration).toHaveLength(0);
  });

  it('no ledger on the kernel: the pass does not run, and says so', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_a' }] }, { ledger: false });
    const log = logger();
    const res = await runOneTimeMembershipBackfill(engine, auto, log);
    expect(res.status).toBe('ledger-unavailable');
    expect(engine.tables.sys_member).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('an unreadable ledger: the pass does not run', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_a' }] });
    engine.findOne.mockRejectedValueOnce(new Error('db down'));
    const log = logger();
    const res = await runOneTimeMembershipBackfill(engine, auto, log);
    expect(res.status).toBe('ledger-unreadable');
    expect(engine.tables.sys_member).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('a record that fails to land is reported at error', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_a' }] });
    const realInsert = engine.insert.getMockImplementation()!;
    engine.insert.mockImplementation(async (object: string, data: any) => {
      if (object === 'sys_migration') throw new Error('read-only');
      return realInsert(object, data);
    });
    const log = logger();
    const res = await runOneTimeMembershipBackfill(engine, auto, log);
    expect(res.status).toBe('ran-unrecorded');
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0]![0])).toContain('will decide it AGAIN');
  });

  it('a record written first by a concurrent pass counts as recorded', async () => {
    const engine = makeEngine({ sys_user: [{ id: 'u_a' }] });
    const realInsert = engine.insert.getMockImplementation()!;
    engine.insert.mockImplementation(async (object: string, data: any) => {
      if (object === 'sys_migration') {
        engine.tables.sys_migration.push({ id: MEMBERSHIP_BACKFILL_MIGRATION_ID });
        throw new Error('duplicate key');
      }
      return realInsert(object, data);
    });
    const log = logger();
    const res = await runOneTimeMembershipBackfill(engine, auto, log);
    expect(res.status).toBe('ran');
    expect(log.error).not.toHaveBeenCalled();
  });
});

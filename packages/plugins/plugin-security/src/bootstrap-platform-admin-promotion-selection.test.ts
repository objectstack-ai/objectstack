// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16682 — WHICH user the `single`-posture bootstrap promotes, and why.
 *
 * ## The defect, re-measured on this branch's base before anything changed
 *
 * `bootstrapPlatformAdmin` read `tryFind(ql, 'sys_user', {}, 50)` — no
 * `orderBy`, cap 50 — and then sorted THAT ARRAY by `created_at`. So "the
 * oldest authenticable user" actually meant *the oldest authenticable user
 * among whatever 50 rows this driver produced first*, and a client-side sort
 * cannot notice the difference: it sorts a sample and reports a global answer.
 *
 * Measured here on 113 seeded `sys_user` rows (7 holding credentials), the
 * intended owner inserted FIRST with a `created_at` a year older than everyone
 * and an id that collates LAST, `OS_PLATFORM_OWNER_EMAIL=admin@objectos.ai`:
 *
 *   driver   the 50-row window                       promoted
 *   memory   window[0] = usr_zzz_owner               admin@objectos.ai
 *   sqlite   window[0] = usr_ats_c001, owner ABSENT  candidate001@mail.example
 *
 * Same code, same config, same data; the answer changed with the storage
 * driver. A job-seeker persona took the unscoped `admin_full_access` grant and
 * — through `claimSeedOwnership` — ownership of every seeded business row.
 *
 * And `PLATFORM_OWNER_EMAIL_ENV`, imported into that very file, was read only
 * on the WALLED branch. A deployment that had SAID who its owner is could
 * still have somebody else promoted. That is what makes this a security defect
 * rather than a nondeterminism one, and it is why both halves land together:
 * ordering alone still promotes someone the operator never chose, and honouring
 * the declaration alone leaves the no-declaration path sorting a truncated
 * unordered sample.
 *
 * ## Why the second arm is a row ORDER and not a second driver package
 *
 * The card's regression shape asks for the same assertion on the memory driver
 * and on sqlite. `@objectstack/driver-memory` cannot be imported here:
 * declaring it needs `plugin-security/package.json`, and every declaration of
 * that package in this repo must additionally be disposed of in
 * `scripts/driver-memory-census.ledger.json`, whose `ruled-permanent` axis is
 * a maintainer ruling ("nothing else may claim it"). Both are outside a
 * repair's authority, so the real memory-driver readings above were taken
 * out-of-tree and reported on the PR rather than pinned here.
 *
 * What IS pinned is the property those two drivers were standing in for, and
 * it is pinned over MORE orders than they could produce between them. Each
 * case runs the REAL engine over the REAL better-sqlite3 driver, wrapped in a
 * facade that permutes a result ONLY when the query carried no `orderBy` —
 * which is precisely the freedom a driver has there, and precisely what the
 * two families were doing differently. When the query DOES carry `orderBy` the
 * facade passes it straight through and the real SQL `ORDER BY` decides; the
 * facade never sorts anything itself. So a fix that sent `orderBy` and a driver
 * that ignored it would still be caught, and `AS_RETURNED` is an unwrapped,
 * ordinary real-driver run.
 *
 * ⛔ There is deliberately no client-side re-sort left in the selection. A
 * defensive `.sort()` after the read would re-rank the returned page and hide
 * a lost `orderBy` — the guard would keep passing while the selection went
 * back to being a function of the driver.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysUser, SysAccount } from '@objectstack/platform-objects/identity';
import {
  bootstrapPlatformAdmin,
  PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE,
  PLATFORM_ADMIN_CANDIDATE_SCAN_CEILING,
} from './bootstrap-platform-admin.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYSTEM_CTX = { isSystem: true };
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';

const engines: ObjectQL[] = [];

afterEach(async () => {
  while (engines.length) {
    try {
      await engines.pop()?.destroy();
    } catch {
      /* noop */
    }
  }
});

beforeEach(() => {
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
});

afterEach(() => {
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
});

function declareOwner(value: string): void {
  process.env[OWNER_ENV] = value;
  // The parser memoizes on the RAW string per process; several values travel
  // through one worker here.
  resetPlatformAdminEmailMemo();
}

/** A fresh engine on its own `:memory:` sqlite database with the REAL declarations. */
async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.security-objects',
    name: 'Security Objects',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPermissionSet, SysUserPermissionSet, SysUser, SysAccount],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

// ───────────────────────────────────────────────────────────────────────────
// The driver-order facade
// ───────────────────────────────────────────────────────────────────────────

/**
 * The row orders a driver is free to return for an UNORDERED read. `AS_RETURNED`
 * is the real better-sqlite3 answer with nothing done to it (measured: id
 * order). `INSERTION` is the order `@objectstack/driver-memory` returns, which
 * is what put the owner in row 1 there and made the two families disagree.
 * `REVERSED` is neither — it is here because "some other order" is the actual
 * contract, not "one of the two orders we happened to measure".
 */
const NATURAL_ORDERS = ['AS_RETURNED', 'INSERTION', 'REVERSED'] as const;
type NaturalOrder = (typeof NATURAL_ORDERS)[number];

/**
 * Wrap a real engine so an UNORDERED read comes back in `order`.
 *
 * ⚠️ The one rule that keeps this honest: when the query carries `orderBy`,
 * the query is forwarded verbatim and the RESULT is returned untouched. The
 * facade never sorts. Everything the fix relies on is therefore done by the
 * real SQL engine.
 */
function withNaturalOrder(engine: ObjectQL, order: NaturalOrder): any {
  const insertionRank = new Map<string, number>();
  let nextRank = 0;
  const rankKey = (object: string, id: unknown) => `${object}:${String(id)}`;
  return {
    async find(object: string, query: any, options: any) {
      const rows = await (engine as any).find(object, query, options);
      if (!Array.isArray(rows)) return rows;
      if (order === 'AS_RETURNED') return rows;
      // An ordered read is honoured by the driver; nothing here may touch it.
      if (query?.orderBy) return rows;
      if (order === 'REVERSED') return [...rows].reverse();
      return [...rows].sort(
        (a, b) =>
          (insertionRank.get(rankKey(object, a?.id)) ?? 0) -
          (insertionRank.get(rankKey(object, b?.id)) ?? 0),
      );
    },
    async insert(object: string, data: any, options: any) {
      const result = await (engine as any).insert(object, data, options);
      const id = data?.id ?? result?.id;
      if (id !== undefined) insertionRank.set(rankKey(object, id), nextRank++);
      return result;
    },
    // The shared engine-double contract (`check:engine-double-contract`): a
    // facade whose update() is looser than ObjectQL.update is how a dead code
    // path ships with its suite green. Asserted BEFORE delegating, so this
    // wrapper can never be the loose link.
    async update(object: string, data: any, options: any) {
      assertEngineUpdateDispatch(data, options);
      return (engine as any).update(object, data, options);
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

async function seedUser(
  ql: any,
  id: string,
  email: string,
  createdAt: string,
  withAccount: boolean,
  // [#16682, maintainer ruling batch #100] Absent means UNVERIFIED, which is
  // what `isEmailVerifiedUserRow` reads an absent column as — so every fixture
  // that does not say otherwise is a row the declared-owner leg must REFUSE.
  emailVerified = false,
): Promise<void> {
  await ql.insert(
    'sys_user',
    { id, email, name: email.split('@')[0], created_at: createdAt, email_verified: emailVerified },
    { context: SYSTEM_CTX },
  );
  if (withAccount) {
    await ql.insert(
      'sys_account',
      { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' },
      { context: SYSTEM_CTX },
    );
  }
}

/**
 * The card's population, verbatim: 113 humans, 7 of them able to sign in, and
 * the intended owner holding an id that collates AFTER every other row while
 * carrying the oldest `created_at`. Inserted first, so the insertion-order
 * family puts it in row 1 and the id-order family does not see it at all.
 */
async function seedCardPopulation(ql: any): Promise<void> {
  await seedUser(ql, 'usr_zzz_owner', 'admin@objectos.ai', '2025-01-01T00:00:00.000Z', true);
  for (let i = 1; i <= 112; i++) {
    const n = String(i).padStart(3, '0');
    await seedUser(
      ql,
      `usr_ats_c${n}`,
      `candidate${n}@mail.example`,
      `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      i <= 6,
    );
  }
}

async function findRows(engine: ObjectQL, object: string, where: any = {}): Promise<any[]> {
  const rows = await (engine as any).find(object, { where, limit: 1000 }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : [];
}

/** The emails holding an unscoped `admin_full_access` grant after a pass. */
async function adminGrantEmails(engine: ObjectQL): Promise<string[]> {
  const sets = await findRows(engine, 'sys_permission_set', { name: 'admin_full_access' });
  const adminPsId = sets[0]?.id;
  expect(adminPsId, 'ANTI-VACUITY: admin_full_access must have been seeded').toBeTruthy();
  const links = await findRows(engine, 'sys_user_permission_set', { permission_set_id: adminPsId });
  const emails: string[] = [];
  for (const link of links) {
    const rows = await findRows(engine, 'sys_user', { id: link.user_id });
    emails.push(rows[0]?.email ?? String(link.user_id));
  }
  return emails;
}

function collectingLogger() {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  const meta: any[] = [];
  return {
    info,
    warn,
    error,
    meta,
    logger: {
      info: (m: string, x?: any) => {
        info.push(m);
        if (x) meta.push(x);
      },
      warn: (m: string) => warn.push(m),
      error: (m: string) => error.push(m),
    },
  };
}

describe('#16682 — the promotion target is chosen, not sampled', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // ANTI-VACUITY: the truncated window really is driver-shaped
  // ─────────────────────────────────────────────────────────────────────────

  it('ANTI-VACUITY: an unordered 50-row read really does hide the intended owner', async () => {
    // Without this the whole file could be green because the fixture happens to
    // put the owner in reach, rather than because the selection was repaired.
    const engine = await boot();
    await seedCardPopulation(engine as any);

    const all = await findRows(engine, 'sys_user');
    expect(all).toHaveLength(113);

    const window50 = await (engine as any).find(
      'sys_user',
      { where: {}, limit: 50 },
      { context: SYSTEM_CTX },
    );
    expect(window50).toHaveLength(50);
    // The real driver's own unordered answer: the owner is not in it, and the
    // oldest row by `created_at` is therefore unreachable to a client-side sort.
    expect(window50.some((r: any) => r.id === 'usr_zzz_owner')).toBe(false);
    const oldestOfAll = [...all].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )[0];
    expect(oldestOfAll.id).toBe('usr_zzz_owner');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. The card's regression shape — same answer under every row order
  // ─────────────────────────────────────────────────────────────────────────

  describe('the card\'s shape: >50 users, owner last by id and first by created_at', () => {
    for (const order of NATURAL_ORDERS) {
      it(`promotes the oldest authenticable human under natural order ${order}`, async () => {
        const engine = await boot();
        const ql = withNaturalOrder(engine, order);
        await seedCardPopulation(ql);

        const { info, logger } = collectingLogger();
        const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, { logger });

        expect(report.adminPromoted).toBe(true);
        expect(report.basis).toBe('oldest-authenticable');
        expect(await adminGrantEmails(engine)).toEqual(['admin@objectos.ai']);
        expect(info.join('\n')).toContain(
          'first user promoted to platform admin: admin@objectos.ai',
        );
      });
    }

    it('gives the SAME answer under all three orders (the driver may not decide this)', async () => {
      const answers: string[] = [];
      for (const order of NATURAL_ORDERS) {
        const engine = await boot();
        const ql = withNaturalOrder(engine, order);
        await seedCardPopulation(ql);
        await bootstrapPlatformAdmin(ql, defaultPermissionSets, {});
        answers.push((await adminGrantEmails(engine)).join(','));
      }
      expect(answers).toEqual(['admin@objectos.ai', 'admin@objectos.ai', 'admin@objectos.ai']);
    });

    /**
     * [F5] The card's 113-row fixture fits inside ONE
     * `PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE` page, so it catches a lost
     * `orderBy` only because there is no client-side re-sort left in the
     * selection. Add a defensive `.sort(byCreatedAtAsc)` over the returned page
     * — the exact thing the source comment warns the next author away from —
     * and every case above this one would go GREEN with the ordering gone,
     * because the whole population is in the page it re-sorts.
     *
     * This case is the one that does not: at `PAGE_SIZE + 1` rows with the
     * owner's id collating LAST, an unordered read puts the owner on page TWO,
     * outside anything a page-local re-sort can reach, while page one already
     * holds an authenticable row for the loop to stop on. So it fails on a lost
     * `orderBy` whether or not a re-sort is reintroduced.
     *
     * Run on the plain real driver (`AS_RETURNED`, id order — measured), which
     * is the family that produced the card's defect.
     */
    it(`survives a future page-local re-sort: ${PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE + 1} rows, owner id-last`, async () => {
      const engine = await boot();
      // Page one under id order is `usr_ats_c001..c200`, and `c001` can sign
      // in — so a page-one answer is available and WRONG.
      for (let i = 1; i <= PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE; i++) {
        const n = String(i).padStart(3, '0');
        await seedUser(
          engine as any,
          `usr_ats_c${n}`,
          `candidate${n}@mail.example`,
          `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
          i <= 3,
        );
      }
      // The intended target: oldest by `created_at`, last by id, authenticable.
      await seedUser(engine as any, 'usr_zzz_owner', 'owner@objectos.ai', '2025-01-01T00:00:00.000Z', true);

      const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});

      expect(report.adminPromoted).toBe(true);
      expect(report.basis).toBe('oldest-authenticable');
      expect(await adminGrantEmails(engine)).toEqual(['owner@objectos.ai']);
      // ANTI-VACUITY: the population really does exceed one page, so the row
      // above really is unreachable from a page-one re-sort.
      expect((await findRows(engine, 'sys_user')).length).toBe(PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE + 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. The declared owner wins, wherever they sort
  // ─────────────────────────────────────────────────────────────────────────

  describe(`${OWNER_ENV} names the owner: neither oldest nor in the first 50 rows`, () => {
    /**
     * The declared owner is `usr_zzz_declared`: id collates last (so an
     * id-ordered 50-row window misses it), and its `created_at` is the NEWEST
     * of all 113 rows (so the age rule would not pick it either). Only reading
     * the declaration can produce it. It is the one VERIFIED row in the
     * population, which under the batch-#100 ruling is a REQUIREMENT of this
     * leg and not a tie-break.
     */
    async function seedDeclaredOwnerPopulation(ql: any): Promise<void> {
      await seedUser(ql, 'usr_ats_a000', 'oldest@mail.example', '2025-01-01T00:00:00.000Z', true);
      for (let i = 1; i <= 111; i++) {
        const n = String(i).padStart(3, '0');
        await seedUser(
          ql,
          `usr_ats_c${n}`,
          `candidate${n}@mail.example`,
          `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
          i <= 6,
        );
      }
      await seedUser(ql, 'usr_zzz_declared', 'owner@objectos.ai', '2027-12-31T00:00:00.000Z', true, true);
    }

    for (const order of NATURAL_ORDERS) {
      it(`promotes the declared owner under natural order ${order}`, async () => {
        declareOwner('owner@objectos.ai');
        const engine = await boot();
        const ql = withNaturalOrder(engine, order);
        await seedDeclaredOwnerPopulation(ql);

        const { info, meta, logger } = collectingLogger();
        const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, { logger });

        expect(report.adminPromoted).toBe(true);
        expect(report.basis).toBe('declared-owner');
        expect(await adminGrantEmails(engine)).toEqual(['owner@objectos.ai']);
        // ...and specifically NOT the oldest authenticable human, which is what
        // the age rule alone would have answered.
        expect(await adminGrantEmails(engine)).not.toContain('oldest@mail.example');
        expect(info.join('\n')).toContain('basis: declared-owner');
        expect(meta.some((m) => m?.basis === 'declared-owner')).toBe(true);
      });
    }

    it('matches the declared address case-insensitively, as the config parser normalizes it', async () => {
      declareOwner('  Owner@ObjectOS.ai  ');
      const engine = await boot();
      await seedUser(engine as any, 'usr_a', 'first@mail.example', '2025-01-01T00:00:00.000Z', true);
      await seedUser(engine as any, 'usr_b', 'owner@objectos.ai', '2026-01-01T00:00:00.000Z', true, true);

      const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});
      expect(report.basis).toBe('declared-owner');
      expect(await adminGrantEmails(engine)).toEqual(['owner@objectos.ai']);
    });

    /**
     * ⚠️ These two cases run on a DOUBLE, and the reason is a real reading:
     * `sys_user.email` carries a UNIQUE index, so the better-sqlite3 driver
     * REFUSES a second row holding one address —
     * `SQLITE_CONSTRAINT_UNIQUE: sys_user.email`, measured while writing this
     * file. The population below is therefore unrepresentable on the SQL
     * family and expressible only where that index is not enforced, which is
     * the schemaless family this tie-break exists for. Every other case in
     * this file drives the real driver.
     */
    function makeDuplicateAddressQl(users: any[], accounts: any[]) {
      const tables = new Map<string, any[]>([
        ['sys_permission_set', []],
        ['sys_user', users.map((r) => ({ ...r }))],
        ['sys_user_permission_set', []],
        ['sys_account', accounts.map((r) => ({ ...r }))],
      ]);
      return {
        grants: () => tables.get('sys_user_permission_set')!,
        async find(object: string, q: any) {
          const where = q?.where ?? {};
          const matched = (tables.get(object) ?? []).filter((r) =>
            Object.entries(where).every(([k, v]) => {
              // Refuse loudly rather than reading a combinator as a field name:
              // a matcher that silently answers `false` for `$or` is how a
              // double reports a filtered-out row as absent.
              if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
              return r[k] === v;
            }),
          );
          // The caller's bound, applied AFTER the filter and by PRESENCE.
          return typeof q?.limit === 'number' ? matched.slice(0, q.limit) : matched;
        },
        async insert(object: string, data: any) {
          (tables.get(object) ?? []).push({ ...data });
          return { id: data.id };
        },
        async update(object: string, data: any, options?: any) {
          const dispatch = assertEngineUpdateDispatch(data, options);
          if (dispatch.kind !== 'by-id') return 0;
          const row = (tables.get(object) ?? []).find((r) => r.id === dispatch.id);
          if (row) Object.assign(row, data);
          return row ?? null;
        },
      };
    }

    it('among rows holding the declared address, only the VERIFIED one is eligible', async () => {
      // ⚠️ RE-AUTHORED by the maintainer ruling of 2026-09-08 (batch #100).
      // This case used to pin an ORDERING — "a verified match outranks an older
      // unverified squat" — and the ruling struck that ordering as moot: a
      // preference only helps where a verified holder EXISTS. What is pinned
      // now is the requirement: the older unverified squat is not a candidate
      // at all, so the answer does not depend on the operator having managed to
      // register alongside it.
      declareOwner('owner@objectos.ai');
      const ql = makeDuplicateAddressQl(
        [
          {
            id: 'usr_squat',
            email: 'owner@objectos.ai',
            created_at: '2025-01-01T00:00:00.000Z',
            email_verified: false,
          },
          {
            id: 'usr_owner',
            email: 'owner@objectos.ai',
            created_at: '2026-06-01T00:00:00.000Z',
            email_verified: true,
          },
        ],
        [
          { id: 'acc_squat', user_id: 'usr_squat', provider_id: 'credential' },
          { id: 'acc_owner', user_id: 'usr_owner', provider_id: 'credential' },
        ],
      );

      const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, {});
      expect(report.basis).toBe('declared-owner');
      // The OLDER row loses, and not on age: it never entered the candidate set.
      expect(ql.grants().map((g) => String(g.user_id))).toEqual(['usr_owner']);
    });

    it('with NOBODY verified, the declared-owner leg REFUSES — zero grant rows, no fall-back', async () => {
      // ⚠️ RE-AUTHORED by the maintainer ruling of 2026-09-08 (batch #100).
      // The predecessor of this case asserted the opposite ("the oldest holder
      // of the declared address wins"), which was the preference reading. The
      // ruling's accepted cost is exactly this outcome, loudly:
      //
      //   > a `single` deployment whose declared owner has not verified their
      //   > email gets no platform admin at first boot until they do, with a
      //   > loud warning saying exactly that.
      //
      // Note what is NOT promoted: `usr_early` can sign in and holds the
      // declared address, and under the previous reading it took the unscoped
      // `admin_full_access` grant.
      declareOwner('owner@objectos.ai');
      const ql = makeDuplicateAddressQl(
        [
          { id: 'usr_early', email: 'owner@objectos.ai', created_at: '2025-01-01T00:00:00.000Z' },
          { id: 'usr_late', email: 'owner@objectos.ai', created_at: '2026-06-01T00:00:00.000Z' },
        ],
        [
          { id: 'acc_early', user_id: 'usr_early', provider_id: 'credential' },
          { id: 'acc_late', user_id: 'usr_late', provider_id: 'credential' },
        ],
      );

      const { warn, logger } = collectingLogger();
      const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, { logger });
      expect(report.adminPromoted).toBe(false);
      expect(report.reason).toBe('declared_owner_not_verified');
      expect(ql.grants()).toHaveLength(0);
      const said = warn.join('\n');
      expect(said).toContain(OWNER_ENV);
      expect(said).toContain('owner@objectos.ai');
      expect(said).toContain('VERIFIED');
      expect(said).toContain('NOT falling back to the oldest');
    });

    it('the refusal LIFTS the moment verification lands — the replay promotes the owner', async () => {
      // The ruling's own sentence: "the replay predicate promotes as soon as
      // verification lands." This case drives the two halves of that in order —
      // the first pass refuses with zero grant rows, the verifying update
      // lands, and the replayed pass promotes the same row. `single`'s replay
      // trigger is pinned next to its producer
      // (`bootstrap-platform-admin-walled-owner.test.ts`); what is pinned here
      // is that the SELECTION really does change its answer.
      declareOwner('owner@objectos.ai');
      const engine = await boot();
      await seedUser(engine as any, 'usr_a', 'first@mail.example', '2025-01-01T00:00:00.000Z', true);
      await seedUser(engine as any, 'usr_owner', 'owner@objectos.ai', '2026-01-01T00:00:00.000Z', true, false);

      const before = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});
      expect(before.adminPromoted).toBe(false);
      expect(before.reason).toBe('declared_owner_not_verified');
      expect(await adminGrantEmails(engine)).toEqual([]);

      await (engine as any).update(
        'sys_user',
        { id: 'usr_owner', email_verified: true },
        { context: SYSTEM_CTX },
      );

      const after = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});
      expect(after.adminPromoted).toBe(true);
      expect(after.basis).toBe('declared-owner');
      expect(await adminGrantEmails(engine)).toEqual(['owner@objectos.ai']);
    });

    it('a declared address on a NON-human row is not a route to the grant', async () => {
      // `isHumanUser` still applies on this leg: declaring the system account's
      // address must not hand it the unscoped grant the guard exists to keep
      // away from it.
      declareOwner('system@objectos.ai');
      const engine = await boot();
      await (engine as any).insert(
        'sys_user',
        {
          id: 'usr_system',
          email: 'system@objectos.ai',
          name: 'system',
          role: 'system',
          created_at: '2024-01-01T00:00:00.000Z',
        },
        { context: SYSTEM_CTX },
      );
      await (engine as any).insert(
        'sys_account',
        { id: 'acc_sys', user_id: 'usr_system', account_id: 'system@objectos.ai', provider_id: 'credential' },
        { context: SYSTEM_CTX },
      );
      await seedUser(engine as any, 'usr_real', 'real@mail.example', '2026-01-01T00:00:00.000Z', true);

      const { warn, logger } = collectingLogger();
      const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

      expect(report.adminPromoted).toBe(false);
      expect(report.reason).toBe('declared_owner_not_authenticable');
      expect(await adminGrantEmails(engine)).toEqual([]);
      expect(warn.join('\n')).toContain(OWNER_ENV);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Negative controls
  // ─────────────────────────────────────────────────────────────────────────

  describe('negative controls', () => {
    it(`with ${OWNER_ENV} unset the fallback holds, identically under every order`, async () => {
      // Deliberately a different fixture from case 1: here the oldest
      // authenticable row is NOT the id-last row, so "oldest wins" and "the
      // owner happens to sort last" are separated.
      const answers: string[] = [];
      for (const order of NATURAL_ORDERS) {
        const engine = await boot();
        const ql = withNaturalOrder(engine, order);
        await seedUser(ql, 'usr_mid_oldest', 'oldest@mail.example', '2025-01-01T00:00:00.000Z', true);
        for (let i = 1; i <= 80; i++) {
          const n = String(i).padStart(3, '0');
          await seedUser(ql, `usr_p${n}`, `p${n}@mail.example`, `2026-02-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, i <= 4);
        }
        await seedUser(ql, 'usr_zzz_last', 'last@mail.example', '2026-06-01T00:00:00.000Z', true);

        const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, {});
        expect(report.basis).toBe('oldest-authenticable');
        answers.push((await adminGrantEmails(engine)).join(','));
      }
      expect(answers).toEqual([
        'oldest@mail.example',
        'oldest@mail.example',
        'oldest@mail.example',
      ]);
    });

    it('#14348 SURVIVES: the lowest created_at is skipped when nobody can sign in as it', async () => {
      // The failure this guards: an implementation that simply takes
      // `min(created_at)` makes case 1 green while deleting #14348's repair.
      // Here the two oldest rows are credential-less directory rows — exactly
      // what `defineStack({ data })` leaves behind — and the ONLY login is
      // newer than both.
      for (const order of NATURAL_ORDERS) {
        const engine = await boot();
        const ql = withNaturalOrder(engine, order);
        await seedUser(ql, 'usr_person0', 'person0@demo.example', '2025-01-01T00:00:00.000Z', false);
        await seedUser(ql, 'usr_person1', 'person1@demo.example', '2025-01-02T00:00:00.000Z', false);
        await seedUser(ql, 'usr_login', 'admin@demo.example', '2026-02-01T00:00:00.000Z', true);

        const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, {});
        expect(report.adminPromoted).toBe(true);
        expect(report.basis).toBe('oldest-authenticable');
        expect(await adminGrantEmails(engine)).toEqual(['admin@demo.example']);
      }
    });

    it('#14348 SURVIVES: a population nobody can authenticate as promotes NOBODY', async () => {
      const engine = await boot();
      const ql = withNaturalOrder(engine, 'REVERSED');
      for (let i = 0; i < 60; i++) {
        await seedUser(ql, `usr_person${i}`, `person${i}@demo.example`, `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, false);
      }

      const { info, warn, error, logger } = collectingLogger();
      const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, { logger });

      expect(report.adminPromoted).toBe(false);
      expect(report.reason).toBe('no_authenticable_user');
      expect(await adminGrantEmails(engine)).toEqual([]);
      expect(info.join('\n')).toContain('none can authenticate');
      // The population is far under the ceiling, so nothing was truncated and
      // there is nothing to warn about.
      expect(warn).toEqual([]);
      expect(error).toEqual([]);
    });

    it(`${OWNER_ENV} pointing at an address with NO sys_user row refuses, loudly`, async () => {
      declareOwner('ghost@objectos.ai');
      const engine = await boot();
      await seedUser(engine as any, 'usr_a', 'first@mail.example', '2025-01-01T00:00:00.000Z', true);
      await seedUser(engine as any, 'usr_b', 'second@mail.example', '2026-01-01T00:00:00.000Z', true);

      const { warn, logger } = collectingLogger();
      const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

      expect(report.adminPromoted).toBe(false);
      expect(report.reason).toBe('declared_owner_not_authenticable');
      // ⛔ The whole point: NO silent fall-back to whoever happens to be oldest.
      expect(await adminGrantEmails(engine)).toEqual([]);
      const said = warn.join('\n');
      expect(said).toContain(OWNER_ENV);
      expect(said).toContain('ghost@objectos.ai');
      expect(said).toContain('NOT falling back to the oldest');
    });

    it(`${OWNER_ENV} pointing at a row with no sys_account refuses, loudly`, async () => {
      declareOwner('directory@objectos.ai');
      const engine = await boot();
      await seedUser(engine as any, 'usr_a', 'first@mail.example', '2025-01-01T00:00:00.000Z', true);
      // VERIFIED, so this case measures the authenticability axis alone: the
      // only thing missing is a `sys_account`, and #14348's reason code is what
      // must come back.
      await seedUser(engine as any, 'usr_dir', 'directory@objectos.ai', '2026-01-01T00:00:00.000Z', false, true);

      const { warn, logger } = collectingLogger();
      const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

      expect(report.adminPromoted).toBe(false);
      expect(report.reason).toBe('declared_owner_not_authenticable');
      expect(await adminGrantEmails(engine)).toEqual([]);
      expect(warn.join('\n')).toContain('can authenticate (no sys_account)');
    });

    it('the reserved fork is untouched: an existing grant still short-circuits first', async () => {
      // #14348 case D, re-asserted against the NEW selector: re-pointing an
      // already-granted platform admin is a permission-boundary act and is not
      // this change's to make. A declared owner must not move an existing grant.
      const engine = await boot();
      await seedUser(engine as any, 'usr_person0', 'person0@demo.example', '2025-01-01T00:00:00.000Z', false);
      const first = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});
      expect(first.reason).toBe('no_authenticable_user');
      const sets = await findRows(engine, 'sys_permission_set', { name: 'admin_full_access' });
      await (engine as any).insert(
        'sys_user_permission_set',
        {
          id: 'ups_legacy',
          user_id: 'usr_person0',
          permission_set_id: sets[0].id,
          organization_id: null,
        },
        { context: SYSTEM_CTX },
      );

      declareOwner('owner@objectos.ai');
      await seedUser(engine as any, 'usr_owner', 'owner@objectos.ai', '2026-01-01T00:00:00.000Z', true);

      const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});
      expect(report.adminPromoted).toBe(false);
      expect(report.reason).toBe('already_have_admin');
      expect(await adminGrantEmails(engine)).toEqual(['person0@demo.example']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. The cap's disposition: a scan that stops short must SAY so
  // ─────────────────────────────────────────────────────────────────────────

  describe('the scan ceiling is bounded but never silent', () => {
    /**
     * A synthetic `sys_user` population — the one case whose subject is a row
     * COUNT larger than any fixture worth storing. Rows are generated already
     * in `created_at` order, so `orderBy` is a no-op over them and the case
     * isolates exactly what it is about: what the pass does when it runs out of
     * scan budget. The other cases in this file all drive the real driver.
     */
    function makeSyntheticQl(userCount: number) {
      const permissionSets: any[] = [];
      const warns: string[] = [];
      return {
        warns,
        async find(object: string, q: any) {
          // The caller's bound, applied AFTER the filter and by PRESENCE.
          const bound = (rows: any[]) =>
            typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
          if (object === 'sys_permission_set') {
            const where = q?.where ?? {};
            return bound(
              permissionSets.filter((r) =>
                Object.entries(where).every(([k, v]) => {
                  // Refuse loudly rather than reading a combinator as a field
                  // name — a matcher that answers `false` for `$or` reports a
                  // row it never understood as absent.
                  if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
                  return r[k] === v;
                }),
              ),
            );
          }
          if (object === 'sys_user') {
            const where = q?.where ?? {};
            for (const k of Object.keys(where)) {
              if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            }
            if (Object.keys(where).length > 0) return [];
            const offset = q?.offset ?? 0;
            const limit = q?.limit ?? 100;
            const out: any[] = [];
            for (let i = offset; i < Math.min(offset + limit, userCount); i++) {
              out.push({
                id: `usr_${String(i).padStart(6, '0')}`,
                email: `person${i}@demo.example`,
                created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
              });
            }
            return out;
          }
          // No logins anywhere, and no existing grants.
          return [];
        },
        async insert(object: string, data: any) {
          if (object === 'sys_permission_set') permissionSets.push({ ...data });
          return { id: data.id };
        },
        async update(_object: string, data: any, options?: any) {
          assertEngineUpdateDispatch(data, options);
          return 0;
        },
      };
    }

    it('warns, naming the ceiling, when the scan stops short of the population', async () => {
      const ql = makeSyntheticQl(PLATFORM_ADMIN_CANDIDATE_SCAN_CEILING + PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE);
      const { info, warn, logger } = collectingLogger();

      const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, { logger });

      expect(report.adminPromoted).toBe(false);
      expect(report.reason).toBe('no_authenticable_user');
      expect(info.join('\n')).toContain('none can authenticate');
      // ⛔ "I only looked at N rows" is never silent again.
      const said = warn.join('\n');
      expect(said).toContain('stopped at its ceiling');
      expect(said).toContain(String(PLATFORM_ADMIN_CANDIDATE_SCAN_CEILING));
      expect(said).toContain('were NOT examined');
    });

    it('CONTROL: a population inside the ceiling produces no truncation warning', async () => {
      const ql = makeSyntheticQl(PLATFORM_ADMIN_CANDIDATE_SCAN_CEILING - PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE);
      const { warn, logger } = collectingLogger();

      const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, { logger });

      expect(report.reason).toBe('no_authenticable_user');
      expect(warn.join('\n')).not.toContain('stopped at its ceiling');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. The grant's only record has to say WHY and FROM HOW MANY
  // ─────────────────────────────────────────────────────────────────────────

  describe('the promotion log line records the basis and the candidate pool', () => {
    it('oldest-authenticable: names the basis and the number of rows examined', async () => {
      const engine = await boot();
      await seedCardPopulation(engine as any);

      const { info, meta, logger } = collectingLogger();
      await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

      const line = info.find((l) => l.includes('first user promoted to platform admin'));
      expect(line).toBeDefined();
      expect(line).toContain('basis: oldest-authenticable');
      expect(line).toContain('113 human user row(s) examined oldest-first by created_at');
      expect(meta.some((m) => m?.basis === 'oldest-authenticable' && m?.candidatePoolSize === 113)).toBe(true);
    });

    it('declared-owner: names the basis, the variable and the matching rows', async () => {
      declareOwner('owner@objectos.ai');
      const engine = await boot();
      await seedUser(engine as any, 'usr_a', 'first@mail.example', '2025-01-01T00:00:00.000Z', true);
      await seedUser(engine as any, 'usr_owner', 'owner@objectos.ai', '2026-01-01T00:00:00.000Z', true, true);

      const { info, logger } = collectingLogger();
      await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

      const line = info.find((l) => l.includes('first user promoted to platform admin'));
      expect(line).toContain('owner@objectos.ai');
      expect(line).toContain('basis: declared-owner');
      expect(line).toContain(`1 address(es) declared in ${OWNER_ENV}`);
      expect(line).toContain('1 matching human user row(s)');
    });

    it('the published prefix is unchanged, so existing readers still match', async () => {
      const engine = await boot();
      await seedUser(engine as any, 'usr_a', 'first@mail.example', '2025-01-01T00:00:00.000Z', true);

      const { info, logger } = collectingLogger();
      await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

      expect(info.join('\n')).toContain(
        '[security] first user promoted to platform admin: first@mail.example',
      );
    });
  });
});

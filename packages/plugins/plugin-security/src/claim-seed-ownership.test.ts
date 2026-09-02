// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { claimSeedOwnership } from './claim-seed-ownership.js';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { MAX_BULK_PER_ROW_HOOK_ROWS } from '@objectstack/spec/data';

const SYSTEM = 'usr_system';
const ADMIN = 'usr_admin_human';

/** One recorded call to `ql.update` — the shape, not just the payload. */
interface RecordedWrite {
  object: string;
  data: any;
  where: any;
  multi: boolean;
  /** Ids this write actually re-owned, in fixture order. */
  matched: string[];
}

/** One recorded call to `ql.find` — the page request the writer issued. */
interface RecordedRead {
  object: string;
  where: any;
  limit: number;
  returned: number;
}

/**
 * `where` as `claimSeedOwnership` spells it: field equality for the unowned
 * predicates, and `{ id: { $in: [...] } }` for a page write.
 *
 * Anything else is REFUSED rather than answered (`check:where-matcher`): a
 * combinator (`$and`/`$or`/`$not`) read as a field name, or an unimplemented
 * value operator read as a literal, is silently wrong on exactly the shape a pin
 * exists to judge. This double implements two forms and says so out loud.
 */
function rowMatches(row: any, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) {
      throw new Error(`this double implements field predicates only; it cannot answer '${k}'`);
    }
    const actual = row?.[k] ?? null;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const ops = Object.keys(v as Record<string, unknown>);
      if (ops.length === 1 && ops[0] === '$in') {
        // A Set, not `.some`: the over-ceiling fixture pairs a 21 000-row table
        // with 5 000-member pages, and a linear scan per row makes the pin cost
        // seconds for no extra coverage.
        let members: Set<unknown> | undefined = (v as any).__set;
        if (!members) {
          members = new Set(((v as any).$in as unknown[]).map((m) => m ?? null));
          Object.defineProperty(v, '__set', { value: members, enumerable: false });
        }
        return members.has(actual);
      }
      throw new Error(
        `this double implements equality and $in only; it cannot answer ${JSON.stringify(ops)}`,
      );
    }
    return actual === (v ?? null);
  });
}

/**
 * A fake ObjectQL that honours the engine's own update dispatch, the
 * predicate-write return contract, and `limit` on a read.
 *
 * `assertEngineUpdateDispatch` is the producer's rule, imported rather than
 * re-derived (`check:engine-double-contract`), and the fake refuses anything it
 * does not verdict `multi` — a double looser than the producer would let a
 * regression back to single-id writes pass as green.
 *
 * `updateMany` is contracted to resolve the AFFECTED ROW COUNT (#4639), so this
 * returns a number, never a record.
 *
 * `ceiling` models ADR-0058 D6: a predicate write matching more rows than the
 * engine's per-row hook budget is refused WHOLE, nothing written.
 */
function makeQL(
  schemas: any[],
  rowsByObject: Record<string, any[]>,
  opts: { ceiling?: number; onUpdate?: (object: string, where: any) => void } = {},
) {
  const writes: RecordedWrite[] = [];
  const reads: RecordedRead[] = [];
  const ceiling = opts.ceiling ?? MAX_BULK_PER_ROW_HOOK_ROWS;
  const ql: any = {
    registry: { getAllObjects: () => schemas },
    find: vi.fn(async (object: string, query: any) => {
      const all = rowsByObject[object] ?? [];
      const hits = all.filter((r) => rowMatches(r, query?.where ?? {}));
      const page = typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
      reads.push({ object, where: query?.where, limit: query?.limit, returned: page.length });
      return page.map((r) => ({ id: r.id }));
    }),
    update: vi.fn(async (object: string, data: any, options: any) => {
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (dispatch.kind !== 'multi') {
        throw new Error(`expected a predicate write, engine dispatch said '${dispatch.kind}'`);
      }
      opts.onUpdate?.(object, options?.where);
      const where = options?.where ?? {};
      const matched = (rowsByObject[object] ?? []).filter((r) => rowMatches(r, where));
      if (matched.length > ceiling) {
        // ADR-0058 D6, verbatim in shape: total refusal, nothing written.
        throw Object.assign(
          new Error(
            `Refusing the bulk write on '${object}': it matches ${matched.length} rows, and ` +
              `'beforeUpdate' hooks are contracted to fire PER ROW on a predicate write ` +
              `(ADR-0058, bulk-write addendum), which is over the ${ceiling}-row ceiling for one ` +
              'write. Nothing was written.',
          ),
          { code: 'ERR_BULK_PER_ROW_HOOK_LIMIT' },
        );
      }
      for (const row of matched) Object.assign(row, data);
      writes.push({
        object,
        data,
        where,
        multi: options?.multi === true,
        matched: matched.map((r) => r.id),
      });
      return matched.length;
    }),
  };
  return { ql, writes, reads };
}

/**
 * The id set the PRE-#14530 implementation would have claimed, spelled out as
 * the loop spelled it: two narrow scans capped at `limit: 10_000`, deduped, one
 * single-id write each.
 *
 * Deliberately a re-statement of the OLD rule rather than a call into the new
 * one — an equivalence pin that shares the implementation under test proves
 * nothing. The `slice` is the old scan cap, and it is why the over-ceiling test
 * below compares against `unownedIds` instead: past 10 000 the old rule itself
 * was lossy, and the new one must beat it, not match it.
 */
function legacyClaimedIds(rows: any[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const where of [{ owner_id: null }, { owner_id: SYSTEM }] as Record<string, unknown>[]) {
    const scanned = rows.filter((r) => rowMatches(r, where)).slice(0, 10_000);
    for (const r of scanned) {
      if (r?.id && !seen.has(r.id)) {
        seen.add(r.id);
        ids.push(r.id);
      }
    }
  }
  return ids;
}

/** Every row the two unowned predicates match, with NO cap of any kind. */
function unownedIds(rows: any[]): string[] {
  return rows
    .filter((r) => (r.owner_id ?? null) === null || r.owner_id === SYSTEM)
    .map((r) => r.id);
}

describe('claimSeedOwnership', () => {
  it('returns [] when registry is unavailable', async () => {
    const ql: any = { find: vi.fn(), update: vi.fn() };
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([]);
  });

  it('no-ops when the target is empty or the system user', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const { ql, writes } = makeQL(schemas, { crm_lead: [{ id: 'l1', owner_id: null }] });
    expect(await claimSeedOwnership(ql, '')).toEqual([]);
    expect(await claimSeedOwnership(ql, SYSTEM)).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  it('skips managedBy and sys_* tables', async () => {
    const schemas = [
      { name: 'sys_user', managedBy: 'better-auth', fields: [{ name: 'owner_id' }] },
      { name: 'sys_widget', fields: [{ name: 'owner_id' }] },
    ];
    const { ql, writes } = makeQL(schemas, {
      sys_user: [{ id: 'u1', owner_id: null }],
      sys_widget: [{ id: 'w1', owner_id: null }],
    });
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  it('skips external (federated) objects even when they expose owner_id', async () => {
    // Federated read-only objects (ADR-0015) bind to a remote table; the
    // platform must not scan or re-own them — and the remote table may not even
    // exist at boot, so a scan would error with "no such table".
    const schemas = [
      {
        name: 'showcase_ext_customer',
        external: { remoteName: 'customers' },
        fields: [{ name: 'owner_id' }],
      },
    ];
    const { ql, writes } = makeQL(schemas, {
      showcase_ext_customer: [{ id: 'c1', owner_id: null }],
    });
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([]);
    expect(ql.find).not.toHaveBeenCalled();
    expect(ql.update).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('skips objects without an owner_id field', async () => {
    const schemas = [{ name: 'crm_pricebook', fields: [{ name: 'name' }] }];
    const { ql, writes } = makeQL(schemas, { crm_pricebook: [{ id: 'p1' }] });
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  it('re-owns NULL and usr_system rows to the admin, leaving human-owned rows untouched', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = [
      { id: 'l1', owner_id: null },        // claimed (author left unset)
      { id: 'l2', owner_id: SYSTEM },       // claimed (seed identity)
      { id: 'l3', owner_id: 'usr_someone' },// untouched (already human-owned)
    ];
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });
    const result = await claimSeedOwnership(ql, ADMIN);

    expect(result).toEqual([{ object: 'crm_lead', count: 2 }]);
    expect(writes.flatMap((w) => w.matched).sort()).toEqual(['l1', 'l2']);
    expect(rows.find((r) => r.id === 'l1')!.owner_id).toBe(ADMIN);
    expect(rows.find((r) => r.id === 'l2')!.owner_id).toBe(ADMIN);
    expect(rows.find((r) => r.id === 'l3')!.owner_id).toBe('usr_someone');
  });

  it('is idempotent — a second run claims nothing', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const { ql } = makeQL(schemas, { crm_lead: [{ id: 'l1', owner_id: null }] });
    await claimSeedOwnership(ql, ADMIN);
    const second = await claimSeedOwnership(ql, ADMIN);
    expect(second).toEqual([]);
  });

  // ── [#14530] the predicate-write shape ────────────────────────────────────

  it('issues ONE predicate write per unowned shape — never one write per row', async () => {
    // The whole point of the card: N rows used to cost N single-id writes, so
    // the batch existed only in this caller's loop and nothing downstream could
    // see it. The write COUNT is the pin, and it must not scale with N.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: `l${i}`,
      owner_id: i % 2 === 0 ? null : SYSTEM,
    }));
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });

    const result = await claimSeedOwnership(ql, ADMIN);

    expect(result).toEqual([{ object: 'crm_lead', count: 500 }]);
    expect(writes).toHaveLength(2);
    expect(writes.every((w) => w.multi)).toBe(true);
    // Every write carries the payload only — no `id` in `data`, which is what
    // routes the engine down `updateMany` instead of the single-id door.
    expect(writes.every((w) => Object.keys(w.data).join() === 'owner_id')).toBe(true);
    expect(rows.every((r) => r.owner_id === ADMIN)).toBe(true);
  });

  it('claims exactly the id set the pre-#14530 single-id loop would have claimed', async () => {
    // The equivalence pin. The predicate write must not widen or narrow the
    // matched set by one row: same fixture, same answer, computed two ways.
    const fixture = [
      { id: 'a', owner_id: null },              // author left it unset
      { id: 'b', owner_id: SYSTEM },            // seed identity
      { id: 'c', owner_id: 'usr_someone' },     // a human already owns it
      { id: 'd' },                              // column absent entirely
      { id: 'e', owner_id: '' },                // empty string is NOT null
      { id: 'f', owner_id: undefined },         // present-but-undefined
      { id: 'g', owner_id: 'usr_system_admin' },// prefix collision, not the seed id
    ];
    const expected = legacyClaimedIds(fixture.map((r) => ({ ...r })));
    expect(expected).toEqual(['a', 'd', 'f', 'b']);

    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = fixture.map((r) => ({ ...r }));
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });

    const result = await claimSeedOwnership(ql, ADMIN);

    expect(writes.flatMap((w) => w.matched).sort()).toEqual([...expected].sort());
    expect(result).toEqual([{ object: 'crm_lead', count: expected.length }]);
    // …and nothing outside that set moved.
    for (const row of rows) {
      const wasClaimed = expected.includes(row.id);
      expect(row.owner_id).toBe(wasClaimed ? ADMIN : fixture.find((f) => f.id === row.id)!.owner_id);
    }
  });

  it('the two predicates stay disjoint — no row is counted twice', async () => {
    // The NULL write lands `adminUserId`, which can never be `usr_system` (the
    // function refuses that target outright), so the second predicate cannot
    // re-match a row the first one just claimed. If it ever could, the reported
    // count would exceed the number of rows that exist.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = [
      { id: 'l1', owner_id: null },
      { id: 'l2', owner_id: null },
      { id: 'l3', owner_id: SYSTEM },
    ];
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });

    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([{ object: 'crm_lead', count: 3 }]);
    expect(writes[0].matched).toEqual(['l1', 'l2']);
    expect(writes[1].matched).toEqual(['l3']);
  });

  it('reports the affected-row count the write resolved, not a length it counted itself', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    let call = 0;
    const ql: any = {
      registry: { getAllObjects: () => schemas },
      find: vi.fn(async () => (call < 2 ? [{ id: `l${call}` }] : [])),
      update: vi.fn(async (_o: string, data: any, options: any) => {
        assertEngineUpdateDispatch(data, options);
        call += 1;
        return call === 1 ? 7 : 11;
      }),
    };
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([{ object: 'crm_lead', count: 18 }]);
  });

  it('says "unknown" rather than 0 when a driver resolves something that is not a count', async () => {
    // `eventMatchedCount`'s discipline, one caller over: a non-count result
    // means the rows very likely WERE written, so reporting none of them would
    // be a false statement rather than a conservative one — and paging stops,
    // because the predicate's state is now unknown.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const warn = vi.fn();
    const ql: any = {
      registry: { getAllObjects: () => schemas },
      find: vi.fn(async () => [{ id: 'l1' }]),
      update: vi.fn(async (_o: string, data: any, options: any) => {
        assertEngineUpdateDispatch(data, options);
        return { id: 'l1' }; // a record — this driver did not meet the contract
      }),
    };
    expect(await claimSeedOwnership(ql, ADMIN, { logger: { info: vi.fn(), warn } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2); // once per predicate
    expect(warn.mock.calls[0][0]).toContain('could not read an affected-row count');
    expect(ql.update).toHaveBeenCalledTimes(2); // stopped paging, did not spin
  });

  it('a refused predicate write costs that predicate only — never the object or the run', async () => {
    const schemas = [
      { name: 'crm_lead', fields: [{ name: 'owner_id' }] },
      { name: 'crm_case', fields: [{ name: 'owner_id' }] },
    ];
    const warn = vi.fn();
    const { ql, writes } = makeQL(
      schemas,
      {
        crm_lead: [{ id: 'l1', owner_id: null }, { id: 'l2', owner_id: SYSTEM }],
        crm_case: [{ id: 'c1', owner_id: null }],
      },
      {
        onUpdate: (object, where) => {
          if (object === 'crm_lead' && where?.id) {
            const rows = (where.id as any).$in as string[];
            if (rows.includes('l1')) throw new Error('driver refused this page');
          }
        },
      },
    );

    const result = await claimSeedOwnership(ql, ADMIN, { logger: { info: vi.fn(), warn } });

    expect(result).toEqual([
      { object: 'crm_lead', count: 1 }, // the usr_system predicate still landed
      { object: 'crm_case', count: 1 },
    ]);
    // crm_lead's NULL page was refused; its usr_system page landed. crm_case's
    // NULL page landed and its usr_system predicate matched nothing, so it
    // issued no write at all — an empty page is not a write.
    expect(writes.map((w) => w.object)).toEqual(['crm_lead', 'crm_case']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('those rows stay unowned');
    expect(warn.mock.calls[0][1].error).toContain('driver refused this page');
  });

  // ── [#14530 patch 1] paging: coverage past the engine's per-row ceiling ───

  it('claims EVERY unowned row past MAX_BULK_PER_ROW_HOOK_ROWS, where one unpaged write is refused whole', async () => {
    // ADR-0058 D6: a predicate write over the per-row hook ceiling is refused
    // WHOLE, nothing written — and every object carries such hooks in practice
    // (objectql's audit stamp is registered on '*'). Unpaged, this object was
    // measured claiming ZERO of 21 000 rows while the pre-#14530 loop claimed
    // 10 000 of them: a permission-outcome regression, since `owner_id` is a
    // record-access field. Paged, the answer is all 21 000.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    // 21 000 rows: 3 000 already human-owned, 3 000 on the seed identity, and
    // 15 000 with no owner at all — so the NULL predicate ALONE is over the
    // ceiling, which is the shape one unpaged write cannot survive.
    const seed = () => Array.from({ length: 21_000 }, (_, i) => ({
      id: `l${i}`,
      owner_id: i % 7 === 0 ? 'usr_someone' : i % 7 === 1 ? SYSTEM : null,
    }));
    const rows = seed();
    const everyUnowned = unownedIds(seed());
    expect(everyUnowned).toHaveLength(18_000);
    expect(rows.filter((r) => r.owner_id === null)).toHaveLength(15_000);
    expect(15_000).toBeGreaterThan(MAX_BULK_PER_ROW_HOOK_ROWS);

    const { ql, writes, reads } = makeQL(schemas, { crm_lead: rows });
    const result = await claimSeedOwnership(ql, ADMIN);

    // Not one row short.
    expect(writes.flatMap((w) => w.matched).sort()).toEqual([...everyUnowned].sort());
    expect(result).toEqual([{ object: 'crm_lead', count: everyUnowned.length }]);
    expect(rows.filter((r) => r.owner_id === ADMIN)).toHaveLength(everyUnowned.length);
    // …and it strictly beats the pre-#14530 rule, which capped its own scans.
    // The pre-#14530 rule capped each of its own scans at 10 000, so it could
    // only ever have reached 13 000 of these 18 000 rows.
    expect(legacyClaimedIds(seed())).toHaveLength(13_000);
    expect(everyUnowned.length).toBeGreaterThan(legacyClaimedIds(seed()).length);

    // Still batched, not per row: writes are O(pages), and every page is sized
    // so the engine's ceiling can never refuse it.
    expect(writes.length).toBeLessThan(20);
    expect(writes.every((w) => w.matched.length <= MAX_BULK_PER_ROW_HOOK_ROWS)).toBe(true);
    // A page is big enough that plugin-sharing's 1000-row recompute cap still
    // sees these writes as batches rather than recomputing them row by row.
    expect(reads.every((r) => r.limit > 1_000 && r.limit <= MAX_BULK_PER_ROW_HOOK_ROWS)).toBe(true);
  });

  it('count is the SUM over pages, not the last page', async () => {
    // With paging the reported count is an accumulation, and the easy bug is to
    // let the final page's return value overwrite it. 12 000 unowned rows do not
    // fit in one page, so a count equal to any single page's size is the bug.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = Array.from({ length: 12_000 }, (_, i) => ({ id: `l${i}`, owner_id: null }));
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });

    const result = await claimSeedOwnership(ql, ADMIN);

    expect(writes.length).toBeGreaterThan(1);
    const perPage = writes.map((w) => w.matched.length);
    expect(result).toEqual([
      { object: 'crm_lead', count: perPage.reduce((s, n) => s + n, 0) },
    ]);
    expect(result[0].count).toBe(12_000);
    expect(result[0].count).not.toBe(perPage[perPage.length - 1]);
  });

  it('stops rather than spinning when a page matches rows but re-owns none', async () => {
    // A write-scoping middleware can narrow a page to nothing. Re-reading the
    // same predicate would then return the same page forever, so paging stops
    // and says so — "we could not claim these" is not "there was nothing here".
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const warn = vi.fn();
    const ql: any = {
      registry: { getAllObjects: () => schemas },
      find: vi.fn(async () => [{ id: 'l1' }, { id: 'l2' }]),
      update: vi.fn(async (_o: string, data: any, options: any) => {
        assertEngineUpdateDispatch(data, options);
        return 0; // matched by the read, moved by nothing
      }),
    };
    expect(await claimSeedOwnership(ql, ADMIN, { logger: { info: vi.fn(), warn } })).toEqual([]);
    expect(ql.update).toHaveBeenCalledTimes(2); // one attempt per predicate, no spin
    expect(warn.mock.calls[0][0]).toContain('but re-owned none of them');
  });
});

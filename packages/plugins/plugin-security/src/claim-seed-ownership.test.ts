// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { claimSeedOwnership } from './claim-seed-ownership.js';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE,
  MAX_BULK_PER_ROW_HOOK_ROWS,
} from '@objectstack/spec/data';

const SYSTEM = 'usr_system';
const ADMIN = 'usr_admin_human';
/** [#26825] Seeded ids one NULL-arm write carries: the claim's hand-over batch. */
const HANDOVER_ROWS = 50;

/** One recorded call to `ql.update` — the shape, not just the payload. */
interface RecordedWrite {
  object: string;
  data: any;
  where: any;
  multi: boolean;
  /** Ids this write actually re-owned, in fixture order. */
  matched: string[];
  /** The execution context the write carried — what the engine's hook dispatch reads. */
  context: any;
}

/** One recorded call to `ql.find` — the page request the writer issued. */
interface RecordedRead {
  object: string;
  where: any;
  limit: number;
  returned: number;
  /** The execution context the read carried. */
  context: any;
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
    find: vi.fn(async (object: string, query: any, options?: any) => {
      const all = rowsByObject[object] ?? [];
      const hits = all.filter((r) => rowMatches(r, query?.where ?? {}));
      const page = typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
      reads.push({
        object,
        where: query?.where,
        limit: query?.limit,
        returned: page.length,
        context: options?.context,
      });
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
          // The code comes from the contract that defines it, never a literal:
          // the fallback is keyed on this exact value, so a double that spelled
          // its own would stop proving the fallback fires (#5480's rule).
          { code: BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE },
        );
      }
      for (const row of matched) Object.assign(row, data);
      writes.push({
        object,
        data,
        where,
        multi: options?.multi === true,
        matched: matched.map((r) => r.id),
        context: options?.context,
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

/**
 * [#23354] The seed's own report of the rows it landed on, as the
 * `seed-settlement` contract's `seededRecordIds` hands it to the claim.
 */
function seededIds(byObject: Record<string, string[]>): (object: string) => readonly string[] {
  return (object) => byObject[object] ?? [];
}

/** The NULL-owner rows of a fixture: the rows a seed that wrote all of them reports. */
function nullOwnerIds(rows: any[]): string[] {
  return rows.filter((r) => (r.owner_id ?? null) === null).map((r) => r.id);
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
    const result = await claimSeedOwnership(ql, ADMIN, { seededRecordIds: seededIds({ crm_lead: ['l1'] }) });

    expect(result).toEqual([{ object: 'crm_lead', count: 2 }]);
    expect(writes.flatMap((w) => w.matched).sort()).toEqual(['l1', 'l2']);
    expect(rows.find((r) => r.id === 'l1')!.owner_id).toBe(ADMIN);
    expect(rows.find((r) => r.id === 'l2')!.owner_id).toBe(ADMIN);
    expect(rows.find((r) => r.id === 'l3')!.owner_id).toBe('usr_someone');
  });

  it('is idempotent — a second run claims nothing', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const { ql } = makeQL(schemas, { crm_lead: [{ id: 'l1', owner_id: null }] });
    const seededRecordIds = seededIds({ crm_lead: ['l1'] });
    // Positive control: the first pass does claim, so the empty second pass
    // reads as idempotence rather than as a claim that never ran.
    expect(await claimSeedOwnership(ql, ADMIN, { seededRecordIds })).toEqual([{ object: 'crm_lead', count: 1 }]);
    const second = await claimSeedOwnership(ql, ADMIN, { seededRecordIds });
    expect(second).toEqual([]);
  });

  // ── [#14530] the predicate-write shape ────────────────────────────────────

  it('issues ONE predicate write per unowned shape and hand-over batch — never one write per row', async () => {
    // The whole point of the card: N rows used to cost N single-id writes, so
    // the batch existed only in this caller's loop and nothing downstream could
    // see it. The write COUNT is the pin: [#26825] the NULL arm writes one batch
    // of HANDOVER_ROWS seeded ids per write, so it scales with N / HANDOVER_ROWS,
    // and the seed-identity arm is still one write.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: `l${i}`,
      owner_id: i % 2 === 0 ? null : SYSTEM,
    }));
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });
    const seeded = nullOwnerIds(rows);

    const result = await claimSeedOwnership(ql, ADMIN, { seededRecordIds: seededIds({ crm_lead: seeded }) });

    expect(result).toEqual([{ object: 'crm_lead', count: 500 }]);
    expect(writes).toHaveLength(250 / HANDOVER_ROWS + 1);
    expect(writes.every((w) => w.multi)).toBe(true);
    // The set fits in one write per predicate, so the paged fallback never
    // engages and this pass issues NO read at all — the predicate write IS the
    // scan.
    expect(ql.find).not.toHaveBeenCalled();
    // [#23354] The NULL arm carries the seed's ids; the seed identity arm does not.
    const batches = Array.from({ length: 250 / HANDOVER_ROWS }, (_, b) =>
      ({ owner_id: null, id: { $in: seeded.slice(b * HANDOVER_ROWS, (b + 1) * HANDOVER_ROWS) } }));
    expect(writes.map((w) => w.where)).toEqual([...batches, { owner_id: SYSTEM }]);
    // Every write carries the payload only — no `id` in `data`, which is what
    // routes the engine down `updateMany` instead of the single-id door.
    expect(writes.every((w) => Object.keys(w.data).join() === 'owner_id')).toBe(true);
    expect(rows.every((r) => r.owner_id === ADMIN)).toBe(true);
  });

  it('claims exactly the id set the pre-#14530 single-id loop would have claimed, among the seeded rows', async () => {
    // The equivalence pin. The predicate write must not widen or narrow the
    // matched set by one row: same fixture, same answer, computed two ways.
    // [#23354] Every NULL-ish row here is one the seed reported, so the old
    // rule's answer is still the whole expected set; the rows the seed did NOT
    // report are pinned apart, below.
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

    // The seed reported every row it wrote, owned or not — the claim's own
    // predicate is what narrows that to the unowned ones.
    const result = await claimSeedOwnership(ql, ADMIN, {
      seededRecordIds: seededIds({ crm_lead: fixture.map((r) => r.id) }),
    });

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

    expect(
      await claimSeedOwnership(ql, ADMIN, { seededRecordIds: seededIds({ crm_lead: ['l1', 'l2', 'l3'] }) }),
    ).toEqual([{ object: 'crm_lead', count: 3 }]);
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
    expect(
      await claimSeedOwnership(ql, ADMIN, { seededRecordIds: seededIds({ crm_lead: ['l0'] }) }),
    ).toEqual([{ object: 'crm_lead', count: 18 }]);
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
    expect(
      await claimSeedOwnership(ql, ADMIN, {
        logger: { info: vi.fn(), warn },
        seededRecordIds: seededIds({ crm_lead: ['l1'] }),
      }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2); // once per predicate
    expect(warn.mock.calls[0][0]).toContain('could not read an affected-row count');
    expect(ql.update).toHaveBeenCalledTimes(2); // one attempt each, no spin
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
          if (object === 'crm_lead' && (where as any)?.owner_id === null) {
            throw new Error('driver refused this write');
          }
        },
      },
    );

    const result = await claimSeedOwnership(ql, ADMIN, {
      logger: { info: vi.fn(), warn },
      seededRecordIds: seededIds({ crm_lead: ['l1', 'l2'], crm_case: ['c1'] }),
    });

    expect(result).toEqual([
      { object: 'crm_lead', count: 1 }, // the usr_system predicate still landed
      { object: 'crm_case', count: 1 },
    ]);
    expect(writes.map((w) => w.object)).toEqual(['crm_lead', 'crm_case', 'crm_case']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('those rows stay unowned');
    expect(warn.mock.calls[0][1].error).toContain('driver refused this write');
    // A failure that is NOT the per-row hook budget is never paged around: no
    // read was issued for it, it simply propagated.
    expect(ql.find).not.toHaveBeenCalled();
  });

  // ── [#14530 patch 1] paging: coverage past the engine's per-row ceiling ───

  it('claims EVERY unowned row past MAX_BULK_PER_ROW_HOOK_ROWS, where one unpaged write is refused whole', async () => {
    // ADR-0058 D6: a predicate write over the per-row hook ceiling is refused
    // WHOLE, nothing written — and every object carries such hooks in practice
    // (objectql's audit stamp is registered on '*'). Unpaged, this object was
    // measured claiming ZERO of 21 000 rows while the pre-#14530 loop claimed
    // 10 000 of them: a permission-outcome regression, since `owner_id` is a
    // record-access field. Paged, the answer is all of them.
    //
    // [#23354] The NULL arm now writes in chunks of seeded ids, each under the
    // ceiling by construction, so the whole-set write the engine refuses is the
    // seed-identity arm's: it is still one predicate over every such row.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    // 21 000 rows: 3 000 already human-owned, 12 000 on the seed identity —
    // over the ceiling ALONE, the shape one unpaged write cannot survive — and
    // 6 000 with no owner, every one of them reported by the seed.
    const seed = () => Array.from({ length: 21_000 }, (_, i) => ({
      id: `l${i}`,
      owner_id: i % 7 === 0 ? 'usr_someone' : i % 7 <= 4 ? SYSTEM : null,
    }));
    const rows = seed();
    const everyUnowned = unownedIds(seed());
    expect(everyUnowned).toHaveLength(18_000);
    expect(rows.filter((r) => r.owner_id === SYSTEM)).toHaveLength(12_000);
    expect(12_000).toBeGreaterThan(MAX_BULK_PER_ROW_HOOK_ROWS);

    const { ql, writes, reads } = makeQL(schemas, { crm_lead: rows });
    const result = await claimSeedOwnership(ql, ADMIN, {
      seededRecordIds: seededIds({ crm_lead: nullOwnerIds(seed()) }),
    });

    // Not one row short.
    expect(writes.flatMap((w) => w.matched).sort()).toEqual([...everyUnowned].sort());
    expect(result).toEqual([{ object: 'crm_lead', count: everyUnowned.length }]);
    expect(rows.filter((r) => r.owner_id === ADMIN)).toHaveLength(everyUnowned.length);
    // …and it strictly beats the pre-#14530 rule, which capped each of its own
    // scans at 10 000, so it could only ever have reached 16 000 of these rows.
    expect(legacyClaimedIds(seed())).toHaveLength(16_000);
    expect(everyUnowned.length).toBeGreaterThan(legacyClaimedIds(seed()).length);

    // The paged fallback DID engage — a read was issued, which the under-ceiling
    // path never does — and it converged back onto whole-set writes rather than
    // paging to the end.
    expect(reads.length).toBeGreaterThan(0);
    // Still batched, not per row: the seed-identity arm took a handful of
    // writes, none of them over the ceiling that refused the unpaged attempt.
    // [#26825] The NULL arm's 6 000 seeded ids are hand-over batches.
    const nullArm = writes.filter((w) => (w.where as any).owner_id === null);
    expect(nullArm).toHaveLength(6_000 / HANDOVER_ROWS);
    expect(writes.length - nullArm.length).toBeLessThan(10);
    expect(writes.every((w) => w.matched.length <= MAX_BULK_PER_ROW_HOOK_ROWS)).toBe(true);
    // A page is big enough that plugin-sharing's 1000-row recompute cap still
    // sees these writes as batches rather than recomputing them row by row.
    expect(reads.every((r) => r.limit > 1_000 && r.limit <= MAX_BULK_PER_ROW_HOOK_ROWS)).toBe(true);
  });

  it('count is the SUM over every write of the pass, not just the last one', async () => {
    // Once a predicate needs the fallback the reported count is an accumulation,
    // and the easy bug is to let the final whole-set write's return value
    // overwrite it. 12 000 unowned rows cannot land in one write, so a count
    // equal to any single write's size is the bug.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = Array.from({ length: 12_000 }, (_, i) => ({ id: `l${i}`, owner_id: null }));
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });

    const result = await claimSeedOwnership(ql, ADMIN, {
      seededRecordIds: seededIds({ crm_lead: nullOwnerIds(rows) }),
    });

    expect(writes.length).toBeGreaterThan(1);
    const perWrite = writes.map((w) => w.matched.length);
    expect(result).toEqual([
      { object: 'crm_lead', count: perWrite.reduce((s, n) => s + n, 0) },
    ]);
    expect(result[0].count).toBe(12_000);
    for (const n of perWrite) expect(result[0].count).not.toBe(n);
  });

  it('stops rather than spinning when a fallback page matches rows but re-owns none', async () => {
    // A write-scoping middleware can narrow a page to nothing. Re-reading the
    // same predicate would then hand back the same page forever, so the fallback
    // stops and says so — "we could not claim these" is not "there was nothing
    // here". Without that break this is an unbounded loop at boot.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const warn = vi.fn();
    const ql: any = {
      registry: { getAllObjects: () => schemas },
      find: vi.fn(async () => [{ id: 'l1' }, { id: 'l2' }]),
      update: vi.fn(async (_o: string, data: any, options: any) => {
        assertEngineUpdateDispatch(data, options);
        // A page write names ids and nothing else; every whole-set attempt
        // (the NULL arm's carries its seeded ids too) names an owner.
        if (!('owner_id' in (options.where as any))) return 0; // the page moved nothing
        throw Object.assign(new Error('over the ceiling'), {
          code: BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE,
        });
      }),
    };
    expect(
      await claimSeedOwnership(ql, ADMIN, {
        logger: { info: vi.fn(), warn },
        seededRecordIds: seededIds({ crm_lead: ['l1', 'l2'] }),
      }),
    ).toEqual([]);
    // 2 predicates x (1 refused whole-set attempt + 1 page that moved nothing).
    expect(ql.update).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0][0]).toContain('but re-owned none of them');
  });

  it('pages ONLY on the declared per-row-hook refusal — any other failure propagates', async () => {
    // The fallback is keyed on `BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE`. A refusal
    // that merely LOOKS like it (same words, no code, or another code) must not
    // send this pass reading and re-writing: that would page around a fault
    // nobody diagnosed. It is warned per predicate and left alone.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const warn = vi.fn();
    const ql: any = {
      registry: { getAllObjects: () => schemas },
      find: vi.fn(async () => [{ id: 'l1' }]),
      update: vi.fn(async (_o: string, data: any, options: any) => {
        assertEngineUpdateDispatch(data, options);
        throw Object.assign(
          new Error("Refusing the bulk write on 'crm_lead': it matches 10500 rows"),
          { code: 'ERR_SOMETHING_ELSE' },
        );
      }),
    };
    expect(
      await claimSeedOwnership(ql, ADMIN, {
        logger: { info: vi.fn(), warn },
        seededRecordIds: seededIds({ crm_lead: ['l1'] }),
      }),
    ).toEqual([]);
    expect(ql.find).not.toHaveBeenCalled();
    expect(ql.update).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('those rows stay unowned');
  });

  // ── [#22067] the claim's write dispatches no metadata-bound automation ────

  it('every reown write — whole-set attempt and fallback page alike — runs as isSystem with skipAutomations', async () => {
    // Re-owning a seed row is attribution, not a user event, so the write runs
    // with metadata-bound automation off: no app hook, no record-change flow,
    // hence no approval and no notification. Code-registered hooks (audit,
    // sharing) still run — the real-engine half of this pin is
    // `claim-seed-ownership-dispatch.pin.test.ts`; this half pins that EVERY
    // write this function issues carries the flag, including the page writes
    // a large object takes and the whole-set attempts the engine refuses.
    //
    // 12 000 rows on the seed identity: over the per-row hook ceiling, so one
    // fixture drives a refused whole-set attempt, the page writes, and the
    // closing whole-set write that lands; 100 seeded NULL-owner rows drive the
    // NULL arm's chunk write beside them.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = [
      ...Array.from({ length: 12_000 }, (_, i) => ({ id: `s${i}`, owner_id: SYSTEM as string | null })),
      ...Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, owner_id: null as string | null })),
    ];
    const { ql, writes, reads } = makeQL(schemas, { crm_lead: rows });

    expect(
      await claimSeedOwnership(ql, ADMIN, { seededRecordIds: seededIds({ crm_lead: nullOwnerIds(rows) }) }),
    ).toEqual([{ object: 'crm_lead', count: 12_100 }]);

    // Both write shapes were exercised, so the assertion below covers both.
    expect(writes.some((w) => (w.where as any)?.id)).toBe(true);
    expect(writes.some((w) => !(w.where as any)?.id)).toBe(true);
    expect(reads.length).toBeGreaterThan(0);

    // Every CALL, not only the writes that landed: a refused attempt is
    // refused for its row count, and the context it asked with is the same.
    const contexts = ql.update.mock.calls.map((call: any[]) => call[2]?.context);
    expect(contexts.length).toBeGreaterThan(writes.length);
    for (const context of contexts) {
      expect(context).toEqual({ isSystem: true, skipAutomations: true });
    }
    // The page read stays a plain system read — the flag is about dispatch,
    // and a read dispatches no write automation.
    for (const r of reads) expect(r.context?.isSystem).toBe(true);
  });
});

// ── [#23354] only the rows the seed wrote (ADR-0138 D1) ────────────────────

describe('claimSeedOwnership — the NULL arm re-owns only the rows the seed reported (#23354)', () => {
  it('a NULL-owner row the seed did not report keeps no owner — a guest\'s, a form\'s', async () => {
    // ADR-0138 D1 item 5: "the owner stays unset" when nothing in the scenario
    // sets it. No stored column tells these rows from a seed row; the seed's
    // own report is the only thing that does.
    const schemas = [{ name: 'crm_case', fields: [{ name: 'owner_id' }] }];
    const rows = [
      { id: 'seed_1', owner_id: null },
      { id: 'guest_1', owner_id: null },   // written through the guest door
      { id: 'form_1', owner_id: null },    // a public form's intake
      { id: 'legacy_1', owner_id: SYSTEM },
    ];
    const { ql, writes } = makeQL(schemas, { crm_case: rows });

    const result = await claimSeedOwnership(ql, ADMIN, { seededRecordIds: seededIds({ crm_case: ['seed_1'] }) });

    expect(result).toEqual([{ object: 'crm_case', count: 2 }]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.owner_id]))).toEqual({
      seed_1: ADMIN,
      guest_1: null,
      form_1: null,
      legacy_1: ADMIN,
    });
    expect(writes.map((w) => w.where)).toEqual([
      { owner_id: null, id: { $in: ['seed_1'] } },
      { owner_id: SYSTEM },
    ]);
  });

  it('a row a hook, flow or assignment rule owned keeps its owner even when the seed reported it', async () => {
    // A preservation pin: no predicate of the claim — old or new — matches an
    // owner other than NULL or the seed identity, so this holds by the
    // predicate's shape and stays held.
    const schemas = [{ name: 'crm_case', fields: [{ name: 'owner_id' }] }];
    const rows = [{ id: 'seed_hooked', owner_id: 'usr_set_by_hook' }];
    const { ql } = makeQL(schemas, { crm_case: rows });

    expect(
      await claimSeedOwnership(ql, ADMIN, { seededRecordIds: seededIds({ crm_case: ['seed_hooked'] }) }),
    ).toEqual([]);
    expect(rows[0].owner_id).toBe('usr_set_by_hook');
  });

  it('without a seeded reading the NULL arm re-owns NOTHING — never every unowned row — and the pass says so', async () => {
    const schemas = [{ name: 'crm_case', fields: [{ name: 'owner_id' }] }];
    const rows = [
      { id: 'unowned_1', owner_id: null },
      { id: 'legacy_1', owner_id: SYSTEM },
    ];
    const { ql, writes } = makeQL(schemas, { crm_case: rows });
    const info = vi.fn();

    const result = await claimSeedOwnership(ql, ADMIN, {
      logger: { info, warn: vi.fn() },
      seedSettlement: { pending: 0, inFlight: 0, suppressed: [] },
    });

    // The seed identity arm still runs: it is its own selector.
    expect(result).toEqual([{ object: 'crm_case', count: 1 }]);
    expect(rows[0].owner_id).toBeNull();
    expect(writes.map((w) => w.where)).toEqual([{ owner_id: SYSTEM }]);
    const [message, meta] = info.mock.calls[0]!;
    expect(message).toContain('handed 1 seeded record(s)');
    expect(message).toContain('No seed host on this kernel publishes the rows its seed landed on');
    expect(meta.seededRows).toBeUndefined();
  });

  it('an object the seed did not touch gets no NULL-arm write at all', async () => {
    const schemas = [
      { name: 'crm_case', fields: [{ name: 'owner_id' }] },
      { name: 'crm_note', fields: [{ name: 'owner_id' }] },
    ];
    const { ql, writes } = makeQL(schemas, {
      crm_case: [{ id: 'c1', owner_id: null }],
      crm_note: [{ id: 'n1', owner_id: null }],
    });
    const info = vi.fn();

    await claimSeedOwnership(ql, ADMIN, {
      logger: { info, warn: vi.fn() },
      seededRecordIds: seededIds({ crm_case: ['c1'] }),
    });

    expect(writes.filter((w) => w.object === 'crm_note').map((w) => w.where)).toEqual([{ owner_id: SYSTEM }]);
    expect(info.mock.calls[0]![1].seededRows).toBe(1);
  });

  it('writes the seeded ids in hand-over batches, far under half the per-row hook ceiling, and none is refused', async () => {
    // The chunk keeps the list inside a driver's bound-parameter limit and
    // under the ceiling, so the engine never refuses a NULL-arm write whole
    // and the arm issues no read. [#26825] Each chunk is written in batches of
    // HANDOVER_ROWS ids, the bound on how long a request waits behind it.
    const schemas = [{ name: 'crm_case', fields: [{ name: 'owner_id' }] }];
    const rows = Array.from({ length: 12_000 }, (_, i) => ({ id: `c${i}`, owner_id: null as string | null }));
    const { ql, writes, reads } = makeQL(schemas, { crm_case: rows });

    const result = await claimSeedOwnership(ql, ADMIN, { seededRecordIds: seededIds({ crm_case: nullOwnerIds(rows) }) });

    expect(result).toEqual([{ object: 'crm_case', count: 12_000 }]);
    const nullArm = writes.filter((w) => (w.where as any).owner_id === null);
    expect(nullArm.map((w) => (w.where as any).id.$in.length)).toEqual(
      Array.from({ length: 12_000 / HANDOVER_ROWS }, () => HANDOVER_ROWS),
    );
    expect(HANDOVER_ROWS).toBeLessThan(MAX_BULK_PER_ROW_HOOK_ROWS / 2);
    expect(reads).toEqual([]);
  });
});


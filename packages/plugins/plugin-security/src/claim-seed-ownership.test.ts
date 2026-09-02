// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { claimSeedOwnership } from './claim-seed-ownership.js';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

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

/**
 * `where` as the two `UNOWNED_PREDICATES` spell it: one equality per key.
 *
 * A combinator (`$and`/`$or`/`$not`) is REFUSED rather than read as a field
 * name (`check:where-matcher`): this double implements plain equality only, and
 * a double that answers a query it does not implement is silently wrong on the
 * exact shape the pin exists to judge. `claimSeedOwnership` issues no
 * combinator, so the throw is unreachable today and turns the suite red the
 * moment one arrives.
 */
function rowMatches(row: any, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) {
      throw new Error(`this double implements plain equality only; it cannot answer '${k}'`);
    }
    return (row?.[k] ?? null) === (v ?? null);
  });
}

/**
 * A fake ObjectQL that honours the engine's own update dispatch and the
 * predicate-write return contract.
 *
 * `assertEngineUpdateDispatch` is the producer's rule, imported rather than
 * re-derived (`check:engine-double-contract`), and the fake refuses anything
 * it does not verdict `multi` — a double looser than the producer would let a
 * regression back to single-id writes pass as green.
 *
 * `updateMany` is contracted to resolve the AFFECTED ROW COUNT (#4639), so this
 * returns a number, never a record.
 */
function makeQL(
  schemas: any[],
  rowsByObject: Record<string, any[]>,
  hooks: { onUpdate?: (object: string, where: any) => void } = {},
) {
  const writes: RecordedWrite[] = [];
  const ql: any = {
    registry: { getAllObjects: () => schemas },
    find: vi.fn(async () => {
      throw new Error('claimSeedOwnership must not scan: the predicate write IS the scan');
    }),
    update: vi.fn(async (object: string, data: any, options: any) => {
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (dispatch.kind !== 'multi') {
        throw new Error(`expected a predicate write, engine dispatch said '${dispatch.kind}'`);
      }
      hooks.onUpdate?.(object, options?.where);
      const where = options?.where ?? {};
      const matched = (rowsByObject[object] ?? []).filter((r) => rowMatches(r, where));
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
  return { ql, writes };
}

/**
 * The id set the PRE-#14530 implementation would have claimed, spelled out as
 * the loop spelled it: two narrow scans capped at `limit: 10_000`, deduped,
 * one single-id write each.
 *
 * Deliberately a re-statement of the OLD rule rather than a call into the new
 * one — an equivalence pin that shares the implementation under test proves
 * nothing.
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
    expect(writes.map((w) => w.where)).toEqual([{ owner_id: null }, { owner_id: SYSTEM }]);
    // Every write carries the payload only — no `id`, which is what routes the
    // engine down `updateMany` instead of the single-id door.
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
    const rows = [{ id: 'l1', owner_id: null }, { id: 'l2', owner_id: SYSTEM }];
    const ql: any = {
      registry: { getAllObjects: () => schemas },
      update: vi.fn(async (_o: string, data: any, options: any) => {
        assertEngineUpdateDispatch(data, options);
        return options.where.owner_id === null ? 7 : 11;
      }),
    };
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([{ object: 'crm_lead', count: 18 }]);
    expect(rows).toHaveLength(2); // fixture untouched — the count came from the write
  });

  it('says "unknown" rather than 0 when a driver resolves something that is not a count', async () => {
    // `eventMatchedCount`'s discipline, one caller over: a non-count result
    // means the rows very likely WERE written, so reporting none of them would
    // be a false statement rather than a conservative one.
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const warn = vi.fn();
    const ql: any = {
      registry: { getAllObjects: () => schemas },
      update: vi.fn(async (_o: string, data: any, options: any) => {
        assertEngineUpdateDispatch(data, options);
        return { id: 'l1' }; // a record — this driver did not meet the contract
      }),
    };
    expect(await claimSeedOwnership(ql, ADMIN, { logger: { info: vi.fn(), warn } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('could not read an affected-row count');
  });

  it('a refused predicate write costs that predicate only — never the object or the run', async () => {
    // The engine refuses a predicate write whole above MAX_BULK_PER_ROW_HOOK_ROWS
    // (per-row hook budget, D6). That is one predicate on one object; the other
    // predicate, and every later object, must still land.
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
          if (object === 'crm_lead' && where?.owner_id === null) {
            throw Object.assign(
              new Error("Refusing the bulk write on 'crm_lead': it matches 10001 rows"),
              { code: 'ERR_BULK_PER_ROW_HOOK_LIMIT' },
            );
          }
        },
      },
    );

    const result = await claimSeedOwnership(ql, ADMIN, { logger: { info: vi.fn(), warn } });

    expect(result).toEqual([
      { object: 'crm_lead', count: 1 }, // the usr_system predicate still landed
      { object: 'crm_case', count: 1 },
    ]);
    expect(writes.map((w) => w.object)).toEqual(['crm_lead', 'crm_case', 'crm_case']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('those rows stay unowned');
    expect(warn.mock.calls[0][1].error).toContain('Refusing the bulk write');
  });
});

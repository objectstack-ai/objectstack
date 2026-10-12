// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { claimOrgSeedOwnership } from './claim-org-seed-ownership.js';
// The fake engines below open `update()` with `assertEngineUpdateDispatch`
// (`pnpm check:engine-double-contract`). A double looser than the real
// `ObjectQLEngine.update` is how a dead write path ships with its suite green;
// one call pins these fakes to the producer's rejection surface and, unlike a
// mirrored `if`, cannot drift when that rule changes.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE, MAX_BULK_PER_ROW_HOOK_ROWS } from '@objectstack/spec/data';

const ORG = 'org_1';
const OTHER_ORG = 'org_2';
const OWNER = 'usr_admin';
const SOMEONE = 'usr_someone';
const BOTH_COLUMNS = [{ name: 'owner_id' }, { name: 'organization_id' }];

/** One write the engine LANDED: a refused one never reaches this list. */
interface RecordedWrite {
  object: string;
  data: any;
  where: any;
  /** Ids this write re-owned. */
  matched: string[];
  context: any;
}

/**
 * `where` as `claimOrgSeedOwnership` spells it: field equality, plus
 * `{ id: { $in: [...] } }` on a page write.
 *
 * Anything else is REFUSED rather than answered (`check:where-matcher`): a
 * combinator read as a field name, or an unimplemented value operator read as a
 * literal, is silently wrong on exactly the shape a pin exists to judge.
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
        // A Set, not `.some`: the over-ceiling fixture pairs a 10 500-row table
        // with 5 000-member pages.
        let members: Set<unknown> | undefined = (v as any).__set;
        if (!members) {
          members = new Set(((v as any).$in as unknown[]).map((m) => m ?? null));
          Object.defineProperty(v, '__set', { value: members, enumerable: false });
        }
        return members.has(actual);
      }
      throw new Error(`this double implements equality and $in only; it cannot answer ${JSON.stringify(ops)}`);
    }
    return actual === (v ?? null);
  });
}

/**
 * A fake ObjectQL that honours the engine's own update dispatch, the
 * predicate-write return contract (an affected-row COUNT), `limit` on a read,
 * and ADR-0058 D6: a predicate write matching more rows than `ceiling` is
 * refused WHOLE, nothing written, with the contract's own code.
 *
 * It refuses any write the engine would not verdict `multi`: a regression back
 * to single-id writes is red here, not green.
 */
function makeQL(
  schemas: any[],
  rowsByObject: Record<string, any[]>,
  opts: {
    ceiling?: number;
    /** Runs after a page read, before the page write: a concurrent writer. */
    afterRead?: (object: string, ids: string[]) => void;
    /** Replaces the write's answer (the rows it would have moved stay put). */
    writeAnswer?: (object: string, where: any) => unknown;
    /** Throws instead of writing. */
    failWrite?: (object: string, where: any) => Error | undefined;
  } = {},
) {
  const writes: RecordedWrite[] = [];
  const ceiling = opts.ceiling ?? MAX_BULK_PER_ROW_HOOK_ROWS;
  const ql: any = {
    registry: { getAllObjects: () => schemas },
    find: vi.fn(async (object: string, query: any) => {
      const hits = (rowsByObject[object] ?? []).filter((r) => rowMatches(r, query?.where ?? {}));
      const page = typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
      const out = page.map((r) => ({ id: r.id }));
      opts.afterRead?.(object, out.map((r) => r.id));
      return out;
    }),
    update: vi.fn(async (object: string, data: any, options?: any) => {
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (dispatch.kind !== 'multi') {
        throw new Error(`expected a predicate write, engine dispatch said '${dispatch.kind}'`);
      }
      const where = options?.where ?? {};
      const failure = opts.failWrite?.(object, where);
      if (failure) throw failure;
      const matched = (rowsByObject[object] ?? []).filter((r) => rowMatches(r, where));
      if (matched.length > ceiling) {
        throw Object.assign(new Error(`Refusing the bulk write on '${object}': over the ${ceiling}-row ceiling`), {
          code: BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE,
        });
      }
      if (opts.writeAnswer) return opts.writeAnswer(object, where);
      for (const row of matched) Object.assign(row, data);
      writes.push({ object, data, where, matched: matched.map((r) => r.id), context: options?.context });
      return matched.length;
    }),
  };
  return { ql, writes };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe('claimOrgSeedOwnership', () => {
  it('returns [] when registry is unavailable', async () => {
    const ql: any = { find: vi.fn(), update: vi.fn() };
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([]);
  });

  it('no-ops without an org or owner', async () => {
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const { ql, writes } = makeQL(schemas, { crm_lead: [{ id: 'l1', organization_id: ORG, owner_id: null }] });
    expect(await claimOrgSeedOwnership(ql, '', OWNER)).toEqual([]);
    expect(await claimOrgSeedOwnership(ql, ORG, '')).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  it('skips managedBy / sys_* and objects missing owner_id or organization_id', async () => {
    const schemas = [
      { name: 'sys_user', managedBy: 'better-auth', fields: BOTH_COLUMNS },
      { name: 'sys_widget', fields: BOTH_COLUMNS },
      { name: 'crm_pricebook', fields: [{ name: 'organization_id' }] }, // no owner_id
      { name: 'crm_global', fields: [{ name: 'owner_id' }] }, // no organization_id
    ];
    const { ql, writes } = makeQL(schemas, {
      sys_user: [{ id: 'u1', organization_id: ORG, owner_id: null }],
      sys_widget: [{ id: 'w1', organization_id: ORG, owner_id: null }],
      crm_pricebook: [{ id: 'p1', organization_id: ORG }],
      crm_global: [{ id: 'g1', owner_id: null }],
    });
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([]);
    expect(writes).toHaveLength(0);
    expect(ql.update).not.toHaveBeenCalled();
  });

  it('claims this org\'s NULL-owner rows in ONE predicate write, leaving other orgs and human-owned rows untouched', async () => {
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const rows = [
      { id: 'l1', organization_id: ORG, owner_id: null },          // claimed
      { id: 'l2', organization_id: ORG, owner_id: SOMEONE },       // already owned — untouched
      { id: 'l3', organization_id: OTHER_ORG, owner_id: null },    // other org — untouched
      { id: 'l4', organization_id: ORG, owner_id: null },          // claimed
    ];
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });
    const result = await claimOrgSeedOwnership(ql, ORG, OWNER);

    expect(result).toEqual([{ object: 'crm_lead', count: 2 }]);
    expect(writes).toEqual([
      {
        object: 'crm_lead',
        data: { owner_id: OWNER },
        where: { organization_id: ORG, owner_id: null },
        matched: ['l1', 'l4'],
        context: { isSystem: true, skipAutomations: true },
      },
    ]);
    // Under the ceiling the claim reads nothing: the predicate is the selection.
    expect(ql.find).not.toHaveBeenCalled();
    expect(rows.find((r) => r.id === 'l2')!.owner_id).toBe(SOMEONE);
    expect(rows.find((r) => r.id === 'l3')!.owner_id).toBeNull();
  });

  it('is idempotent — a second run claims nothing', async () => {
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const { ql } = makeQL(schemas, { crm_lead: [{ id: 'l1', organization_id: ORG, owner_id: null }] });
    await claimOrgSeedOwnership(ql, ORG, OWNER);
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([]);
  });

  // ── [#23008] the claim's write dispatches no metadata-bound automation ────

  it('every claim write runs as isSystem with skipAutomations, across objects', async () => {
    // Re-owning a seed row is attribution, not a user event, so the write runs
    // with metadata-bound automation off: no app hook, no record-change flow,
    // hence no approval and no notification. Code-registered hooks (audit,
    // sharing) still run — the real-engine half of this pin is
    // `claim-org-seed-ownership-dispatch.pin.test.ts`; this half pins that
    // EVERY write this function issues carries the flag, across objects.
    const schemas = [
      { name: 'crm_lead', fields: BOTH_COLUMNS },
      { name: 'crm_deal', fields: BOTH_COLUMNS },
    ];
    const { ql } = makeQL(schemas, {
      crm_lead: [
        { id: 'l1', organization_id: ORG, owner_id: null },
        { id: 'l2', organization_id: ORG, owner_id: null },
      ],
      crm_deal: [{ id: 'd1', organization_id: ORG, owner_id: null }],
    });

    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([
      { object: 'crm_lead', count: 2 },
      { object: 'crm_deal', count: 1 },
    ]);
    const writeContexts = ql.update.mock.calls.map((call: any[]) => call[2]?.context);
    expect(writeContexts).toHaveLength(2);
    for (const context of writeContexts) {
      expect(context).toEqual({ isSystem: true, skipAutomations: true });
    }
  });

  // ── [#23054] past the per-row hook ceiling: paged, until none is left ─────

  it('10 500 owner-less rows are all owned after one pass, and count says 10 500', async () => {
    // The card's pin. The whole-set write is refused (ADR-0058 D6: over the
    // per-row hook ceiling, nothing written), so the claim takes a page off
    // the top and tries the whole set again. A single read at the old
    // 10 000-row cap owned 10 000 and left 500 owner-less for good.
    const N = 10_500;
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const rows = [
      ...Array.from({ length: N }, (_, i) => ({ id: `l${String(i).padStart(5, '0')}`, organization_id: ORG, owner_id: null })),
      { id: 'owned', organization_id: ORG, owner_id: SOMEONE },
      { id: 'foreign', organization_id: OTHER_ORG, owner_id: null },
    ];
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });

    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([{ object: 'crm_lead', count: N }]);
    expect(rows.filter((r) => r.organization_id === ORG && r.owner_id === null)).toEqual([]);
    expect(rows.filter((r) => r.owner_id === OWNER)).toHaveLength(N);
    expect(rows.find((r) => r.id === 'owned')!.owner_id).toBe(SOMEONE);
    expect(rows.find((r) => r.id === 'foreign')!.owner_id).toBeNull();

    // One page, then the whole remainder: the page keeps the claim's predicate
    // and ANDs the page's ids onto it; no landed write is over the ceiling.
    const pageRows = Math.floor(MAX_BULK_PER_ROW_HOOK_ROWS / 2);
    expect(writes.map((w) => w.matched.length)).toEqual([pageRows, N - pageRows]);
    expect(Object.keys(writes[0].where).sort()).toEqual(['id', 'organization_id', 'owner_id']);
    expect(writes[0].where).toMatchObject({ organization_id: ORG, owner_id: null });
    expect(writes[1].where).toEqual({ organization_id: ORG, owner_id: null });
    for (const w of writes) expect(w.context).toEqual({ isSystem: true, skipAutomations: true });
    // The page read is a plain system read of the same predicate, bounded.
    expect(ql.find).toHaveBeenCalledTimes(1);
    expect(ql.find.mock.calls[0]).toEqual([
      'crm_lead',
      { where: { organization_id: ORG, owner_id: null }, limit: pageRows, fields: ['id'] },
      { context: { isSystem: true } },
    ]);
  });

  // The three below run one row past the ceiling, so the whole-set write is
  // refused and the claim pages: the page size is derived from the engine's
  // ceiling, so a smaller fake ceiling would refuse the page write too.
  const pastCeiling = (prefix: string) =>
    Array.from({ length: MAX_BULK_PER_ROW_HOOK_ROWS + 1 }, (_, i) => ({
      id: `${prefix}${String(i).padStart(5, '0')}`,
      organization_id: ORG,
      owner_id: null as string | null,
    }));
  const PAGE_ROWS = Math.floor(MAX_BULK_PER_ROW_HOOK_ROWS / 2);

  it('a page write never re-owns a row claimed between its read and its write', async () => {
    // The page write carries the predicate, not just the ids: a row someone
    // else owned in between keeps that owner and is not counted.
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const rows = pastCeiling('l');
    let raced = false;
    const { ql } = makeQL(schemas, { crm_lead: rows }, {
      afterRead: (_object, ids) => {
        if (raced) return;
        raced = true;
        rows.find((r) => r.id === ids[0])!.owner_id = SOMEONE;
      },
    });

    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([{ object: 'crm_lead', count: rows.length - 1 }]);
    expect(rows[0].owner_id).toBe(SOMEONE);
    expect(rows.filter((r) => r.owner_id === OWNER)).toHaveLength(rows.length - 1);
  });

  it('stops, and says so, when a page write re-owns nothing (it would read the same page forever)', async () => {
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const logger = makeLogger();
    // A write-scoping middleware that narrows every page write to nothing.
    const { ql } = makeQL(schemas, { crm_lead: pastCeiling('l') }, {
      writeAnswer: () => 0,
    });

    expect(await claimOrgSeedOwnership(ql, ORG, OWNER, { logger })).toEqual([]);
    expect(ql.update).toHaveBeenCalledTimes(2); // the refused whole set, then the one page
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('re-owned none of them'),
      expect.objectContaining({ object: 'crm_lead', organizationId: ORG, matched: PAGE_ROWS }),
    );
  });

  it('keeps counting what landed when a later write fails, and a failed object costs no later object its claim', async () => {
    const schemas = [
      { name: 'crm_lead', fields: BOTH_COLUMNS },
      { name: 'crm_deal', fields: BOTH_COLUMNS },
    ];
    const leads = pastCeiling('l');
    const deals = [{ id: 'd1', organization_id: ORG, owner_id: null }];
    const logger = makeLogger();
    let leadWholeSetWrites = 0;
    const { ql } = makeQL(schemas, { crm_lead: leads, crm_deal: deals }, {
      // The first whole-set write on crm_lead is refused for its size; the page
      // lands; the retried whole set then fails outright.
      failWrite: (object, where) => {
        if (object !== 'crm_lead' || 'id' in where) return undefined;
        leadWholeSetWrites += 1;
        return leadWholeSetWrites === 2 ? new Error('a code hook refused the write') : undefined;
      },
    });

    expect(await claimOrgSeedOwnership(ql, ORG, OWNER, { logger })).toEqual([
      { object: 'crm_lead', count: PAGE_ROWS },
      { object: 'crm_deal', count: 1 },
    ]);
    expect(leads.filter((r) => r.owner_id === OWNER)).toHaveLength(PAGE_ROWS);
    expect(deals[0].owner_id).toBe(OWNER);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed for crm_lead'),
      expect.objectContaining({ object: 'crm_lead', claimed: PAGE_ROWS, error: 'a code hook refused the write' }),
    );
  });
});

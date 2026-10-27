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
 * `{ id: { $in: [...] } }` for the chunk of seeded ids every write carries.
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
        // A Set, not `.some`: the large fixture pairs a 10 500-row table with
        // 5 000-member chunks.
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
      return page.map((r) => ({ id: r.id }));
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

/** [#23354] The organization's seed replay reported landing on these rows. */
function seededIds(byObject: Record<string, string[]>): (object: string) => readonly string[] {
  return (object) => byObject[object] ?? [];
}

const CHUNK = Math.floor(MAX_BULK_PER_ROW_HOOK_ROWS / 2);
/** [#26825] Seeded ids one claim write carries: the claim's hand-over batch. */
const HANDOVER_ROWS = 50;

describe('claimOrgSeedOwnership', () => {
  it('returns [] when registry is unavailable', async () => {
    const ql: any = { find: vi.fn(), update: vi.fn() };
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER, { seededRecordIds: seededIds({}) })).toEqual([]);
  });

  it('no-ops without an org or owner', async () => {
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const { ql, writes } = makeQL(schemas, { crm_lead: [{ id: 'l1', organization_id: ORG, owner_id: null }] });
    const seededRecordIds = seededIds({ crm_lead: ['l1'] });
    expect(await claimOrgSeedOwnership(ql, '', OWNER, { seededRecordIds })).toEqual([]);
    expect(await claimOrgSeedOwnership(ql, ORG, '', { seededRecordIds })).toEqual([]);
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
    // The seed reported every one of these rows, so each skip is the filter's.
    const seededRecordIds = seededIds({ sys_user: ['u1'], sys_widget: ['w1'], crm_pricebook: ['p1'], crm_global: ['g1'] });
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER, { seededRecordIds })).toEqual([]);
    expect(writes).toHaveLength(0);
    expect(ql.update).not.toHaveBeenCalled();
  });

  it('claims this org\'s seeded NULL-owner rows in ONE predicate write, leaving other orgs and human-owned rows untouched', async () => {
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const rows = [
      { id: 'l1', organization_id: ORG, owner_id: null },          // claimed
      { id: 'l2', organization_id: ORG, owner_id: SOMEONE },       // already owned — untouched
      { id: 'l3', organization_id: OTHER_ORG, owner_id: null },    // other org — untouched
      { id: 'l4', organization_id: ORG, owner_id: null },          // claimed
    ];
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });
    const seeded = ['l1', 'l2', 'l3', 'l4'];
    const result = await claimOrgSeedOwnership(ql, ORG, OWNER, { seededRecordIds: seededIds({ crm_lead: seeded }) });

    expect(result).toEqual([{ object: 'crm_lead', count: 2 }]);
    expect(writes).toEqual([
      {
        object: 'crm_lead',
        data: { owner_id: OWNER },
        where: { organization_id: ORG, owner_id: null, id: { $in: seeded } },
        matched: ['l1', 'l4'],
        context: { isSystem: true, skipAutomations: true },
      },
    ]);
    // The claim reads nothing: the predicate is the selection.
    expect(ql.find).not.toHaveBeenCalled();
    expect(rows.find((r) => r.id === 'l2')!.owner_id).toBe(SOMEONE);
    expect(rows.find((r) => r.id === 'l3')!.owner_id).toBeNull();
  });

  it('is idempotent — a second run claims nothing', async () => {
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const { ql } = makeQL(schemas, { crm_lead: [{ id: 'l1', organization_id: ORG, owner_id: null }] });
    const seededRecordIds = seededIds({ crm_lead: ['l1'] });
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER, { seededRecordIds })).toEqual([{ object: 'crm_lead', count: 1 }]);
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER, { seededRecordIds })).toEqual([]);
  });

  // ── [#23354] only the rows the organization's seed replay wrote ──────────

  it('a NULL-owner row the replay did not report keeps no owner — a guest\'s, a form\'s (ADR-0138 D1)', async () => {
    const schemas = [{ name: 'crm_case', fields: BOTH_COLUMNS }];
    const rows = [
      { id: 'seed_1', organization_id: ORG, owner_id: null },
      { id: 'guest_1', organization_id: ORG, owner_id: null },
      { id: 'form_1', organization_id: ORG, owner_id: null },
      { id: 'hook_1', organization_id: ORG, owner_id: 'usr_set_by_hook' },
    ];
    const { ql } = makeQL(schemas, { crm_case: rows });

    const result = await claimOrgSeedOwnership(ql, ORG, OWNER, {
      seededRecordIds: seededIds({ crm_case: ['seed_1', 'hook_1'] }),
    });

    expect(result).toEqual([{ object: 'crm_case', count: 1 }]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.owner_id]))).toEqual({
      seed_1: OWNER,
      guest_1: null,
      form_1: null,
      hook_1: 'usr_set_by_hook',
    });
  });

  it('without a seeded reading it re-owns nothing — never every unowned row — and says so', async () => {
    const schemas = [{ name: 'crm_case', fields: BOTH_COLUMNS }];
    const rows = [{ id: 'c1', organization_id: ORG, owner_id: null }];
    const { ql } = makeQL(schemas, { crm_case: rows });
    const logger = makeLogger();

    expect(await claimOrgSeedOwnership(ql, ORG, OWNER, { logger })).toEqual([]);
    expect(ql.update).not.toHaveBeenCalled();
    expect(rows[0].owner_id).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no seed host on this kernel publishes the rows its replay landed on'),
      { organizationId: ORG },
    );
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

    expect(
      await claimOrgSeedOwnership(ql, ORG, OWNER, { seededRecordIds: seededIds({ crm_lead: ['l1', 'l2'], crm_deal: ['d1'] }) }),
    ).toEqual([
      { object: 'crm_lead', count: 2 },
      { object: 'crm_deal', count: 1 },
    ]);
    const writeContexts = ql.update.mock.calls.map((call: any[]) => call[2]?.context);
    expect(writeContexts).toHaveLength(2);
    for (const context of writeContexts) {
      expect(context).toEqual({ isSystem: true, skipAutomations: true });
    }
  });

  // ── [#23054] past the per-row hook ceiling: every seeded row, no write refused ──

  it('10 500 seeded owner-less rows are all owned after one pass, and count says 10 500', async () => {
    // The card's pin. A single read at the old 10 000-row cap owned 10 000 and
    // left 500 owner-less for good; an unbounded predicate write is refused
    // whole over the per-row hook ceiling (ADR-0058 D6). A chunk of seeded ids
    // is half the ceiling, so every write lands and none is refused.
    const N = 10_500;
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const seeded = Array.from({ length: N }, (_, i) => `l${String(i).padStart(5, '0')}`);
    const rows = [
      ...seeded.map((id) => ({ id, organization_id: ORG, owner_id: null as string | null })),
      { id: 'owned', organization_id: ORG, owner_id: SOMEONE },
      { id: 'foreign', organization_id: OTHER_ORG, owner_id: null },
    ];
    const { ql, writes } = makeQL(schemas, { crm_lead: rows });

    expect(
      await claimOrgSeedOwnership(ql, ORG, OWNER, { seededRecordIds: seededIds({ crm_lead: seeded }) }),
    ).toEqual([{ object: 'crm_lead', count: N }]);
    expect(rows.filter((r) => r.organization_id === ORG && r.owner_id === null)).toEqual([]);
    expect(rows.filter((r) => r.owner_id === OWNER)).toHaveLength(N);
    expect(rows.find((r) => r.id === 'owned')!.owner_id).toBe(SOMEONE);
    expect(rows.find((r) => r.id === 'foreign')!.owner_id).toBeNull();

    // Three chunks, each under the ceiling, [#26825] each written in hand-over
    // batches; every write keeps the claim's predicate and names its batch;
    // nothing was read.
    expect(writes.map((w) => w.matched.length)).toEqual(Array.from({ length: N / HANDOVER_ROWS }, () => HANDOVER_ROWS));
    for (const w of writes) {
      expect(Object.keys(w.where).sort()).toEqual(['id', 'organization_id', 'owner_id']);
      expect(w.where).toMatchObject({ organization_id: ORG, owner_id: null });
      expect(w.where.id.$in.length).toBeLessThanOrEqual(HANDOVER_ROWS);
      expect(w.context).toEqual({ isSystem: true, skipAutomations: true });
    }
    expect(ql.find).not.toHaveBeenCalled();
  });

  it('an unreadable count is warned as unknown, counts nothing, and the next write still lands', async () => {
    const schemas = [{ name: 'crm_lead', fields: BOTH_COLUMNS }];
    const seeded = Array.from({ length: CHUNK + 1 }, (_, i) => `l${String(i).padStart(5, '0')}`);
    const rows = seeded.map((id) => ({ id, organization_id: ORG, owner_id: null as string | null }));
    const logger = makeLogger();
    let call = 0;
    const { ql } = makeQL(schemas, { crm_lead: rows }, {
      // The first write's driver answers a record rather than a count.
      writeAnswer: (_object, where) => {
        call += 1;
        if (call === 1) return { id: 'not-a-count' };
        const ids = new Set(where.id.$in as string[]);
        let moved = 0;
        for (const r of rows) if (ids.has(r.id) && r.owner_id === null) { r.owner_id = OWNER; moved += 1; }
        return moved;
      },
    });

    expect(
      await claimOrgSeedOwnership(ql, ORG, OWNER, { logger, seededRecordIds: seededIds({ crm_lead: seeded }) }),
    ).toEqual([{ object: 'crm_lead', count: CHUNK + 1 - HANDOVER_ROWS }]);
    // [#26825] One write per hand-over batch: the first chunk's, then the
    // second chunk's one id.
    expect(ql.update).toHaveBeenCalledTimes(CHUNK / HANDOVER_ROWS + 1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not read an affected-row count'),
      expect.objectContaining({ object: 'crm_lead', organizationId: ORG, ids: CHUNK }),
    );
  });

  it('a failed chunk costs that chunk only — the next chunk and the next object are still claimed', async () => {
    const schemas = [
      { name: 'crm_lead', fields: BOTH_COLUMNS },
      { name: 'crm_deal', fields: BOTH_COLUMNS },
    ];
    const seeded = Array.from({ length: 2 * CHUNK + 1 }, (_, i) => `l${String(i).padStart(5, '0')}`);
    const leads = seeded.map((id) => ({ id, organization_id: ORG, owner_id: null as string | null }));
    const deals = [{ id: 'd1', organization_id: ORG, owner_id: null }];
    const logger = makeLogger();
    const secondChunk = new Set(seeded.slice(CHUNK, 2 * CHUNK));
    const { ql } = makeQL(schemas, { crm_lead: leads, crm_deal: deals }, {
      // Every write of the second crm_lead chunk is refused outright by a code hook.
      failWrite: (object, where) => {
        if (object !== 'crm_lead') return undefined;
        return secondChunk.has(where.id.$in[0]) ? new Error('a code hook refused the write') : undefined;
      },
    });

    expect(
      await claimOrgSeedOwnership(ql, ORG, OWNER, {
        logger,
        seededRecordIds: seededIds({ crm_lead: seeded, crm_deal: ['d1'] }),
      }),
    ).toEqual([
      { object: 'crm_lead', count: CHUNK + 1 },
      { object: 'crm_deal', count: 1 },
    ]);
    expect(leads.filter((r) => r.owner_id === OWNER)).toHaveLength(CHUNK + 1);
    expect(deals[0].owner_id).toBe(OWNER);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`failed for crm_lead in org ${ORG}: the ${CHUNK} seeded row(s) of this write stay owner-less`),
      { object: 'crm_lead', organizationId: ORG, ids: CHUNK, error: 'a code hook refused the write' },
    );
  });
});

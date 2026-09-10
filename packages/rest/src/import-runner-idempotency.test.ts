// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#3149: bulkWrite is at-least-once — a retry (or a mismatch-driven
 * degradation) may re-run a create whose prior attempt already committed. When
 * the import has natural keys (matchFields), runImport rechecks before
 * re-creating so a retry can't duplicate the row. A pure-insert import has no
 * natural key and stays at-least-once by contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './export-format.js';

/**
 * [#16952] The doubles below are annotated FROM the exported declaration
 * (`ImportProtocolLike`), never from a hand-written restatement of the shape
 * the runner happens to send. A local parameter annotation was one of the
 * three non-authoritative places this card converged: it froze a dialect no
 * compiler held anyone to, so it kept compiling — and kept passing — after the
 * runner moved to another one. ⛔ Never widen these back to an inline object
 * type; that re-opens the seam.
 */
type FindArgs = Parameters<ImportProtocolLike['findData']>[0];
type CreateArgs = Parameters<ImportProtocolLike['createData']>[0];

const metaMap = new Map<string, ExportFieldMeta>([['name', { name: 'name', type: 'text' }]]);

const baseOpts = {
  objectName: 'task',
  metaMap,
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

/**
 * Mock protocol backed by an in-memory store. `createManyData` optionally
 * commits-then-throws (or short-returns) on its first call to model a lost
 * response / mismatch; findData filters the store for the recheck.
 */
function makeProtocol(opts: { firstCall?: 'throw' | 'shortReturn' } = {}) {
  const store: Array<Record<string, any>> = [];
  let idc = 0;
  let calls = 0;
  const createManyData = vi.fn(async (args: { records: any[] }) => {
    calls++;
    const recs = args.records.map((r) => {
      const rec = { id: `id-${++idc}`, ...r };
      store.push(rec);
      return rec;
    });
    if (calls === 1 && opts.firstCall === 'throw') throw new Error('fetch failed'); // committed, response lost
    if (calls === 1 && opts.firstCall === 'shortReturn') return { records: [] };     // committed, bad count
    return { records: recs };
  });
  const createData = vi.fn(async (args: CreateArgs) => {
    const rec = { id: `id-${++idc}`, ...args.data };
    store.push(rec);
    return rec;
  });
  // [#16638] Reads the CANONICAL `where` the runner sends. ⛔ The `?? {}` this
  // replaces is what made this whole file pass VACUOUSLY once the runner moved
  // to `where`: with `$filter` undefined every recheck degraded to `{}`, which
  // constrains nothing, so the recheck matched the entire store and the
  // no-duplicate assertions below held without the probe discriminating at all.
  // Reading `where` straight means an absent filter throws instead.
  /**
   * [#16638] Every filter this double actually APPLIED. Pinning the payload
   * alone would still pass over a double that read the wrong key and defaulted
   * to `{}` — which is the vacuity being closed here, so both are recorded.
   */
  const appliedFilters: Array<Record<string, any>> = [];
  const findData = vi.fn(async (args: FindArgs) => {
    // Both slots are OPTIONAL on the declared contract, and the `!`s say so
    // while keeping the refusal: an absent one throws here exactly as it did
    // before, rather than degrading into a match-everything probe.
    const filter = args.query!.where!;
    appliedFilters.push(filter);
    // Supports equality and { $in: [...] } — the id recheck (framework#3173)
    // queries by pre-assigned id $in, like the real SQL driver does.
    return store.filter((row) => Object.entries(filter).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); 
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    }));
  });
  const p: ImportProtocolLike = { findData, createData, updateData: vi.fn(), createManyData };
  return { p, store, createManyData, createData, findData, appliedFilters };
}

/**
 * One recorded `findData` probe — the DECLARED parameter type, not a
 * restatement of it. [#16952]
 */
type FindProbe = FindArgs;

/**
 * ⭐ [#16638] Every probe the runner sends must NARROW — the assertion this
 * file was missing, and the reason it stayed GREEN through a payload rewrite
 * that broke it. While the double read `args.query.$filter`, a runner sending
 * `where` left that read `undefined`, the `?? {}` default turned it into an
 * empty filter, and an empty filter constrains NOTHING: every recheck matched
 * the entire store, so each `store` / `created` expectation below held without
 * the probe discriminating between one row and any other. Passing was not
 * evidence. `{}` is the shape that has to be refused, so it is asserted
 * against directly.
 *
 * `Object.keys` on an ABSENT `where` throws rather than reporting zero keys,
 * and that is deliberate: a spelling drift must be loud here, not degrade into
 * a probe that matches everything.
 */
function expectEveryProbeNarrowed(
  calls: ReadonlyArray<readonly [FindProbe]>,
  appliedFilters: ReadonlyArray<Record<string, any>>,
): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const [args] of calls) {
    expect(Object.keys(args.query!.where!)).not.toHaveLength(0);
  }
  // The payload half is the drift alarm; this is the vacuity half. The filter
  // the double APPLIED must be the one it was handed — an equality a `?? {}`
  // default breaks even while the runner's payload stays perfectly canonical.
  expect(appliedFilters).toEqual(calls.map(([args]) => args.query!.where!));
  for (const filter of appliedFilters) expect(Object.keys(filter)).not.toHaveLength(0);
}

describe('runImport — idempotent retry with natural keys (framework#3149)', () => {
  it('upsert+matchFields: a transient retry after commit does not duplicate rows', async () => {
    const { p, store, createManyData, findData, appliedFilters } = makeProtocol({ firstCall: 'throw' });

    const summary = await runImport({
      ...baseOpts, p, writeMode: 'upsert', matchFields: ['name'],
      rows: [{ name: 'x' }, { name: 'y' }],
    });

    // createManyData ran once (attempt 1, which committed); the retry's recheck
    // found both rows already present and did NOT re-create them.
    expect(createManyData).toHaveBeenCalledTimes(1);
    expect(store.filter((r) => r.name === 'x')).toHaveLength(1);
    expect(store.filter((r) => r.name === 'y')).toHaveLength(1);
    expect(store).toHaveLength(2); // no duplicates
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(0);
    // ⭐ [#16638] …and every probe that produced those numbers actually
    // constrained something. The natural-key probes carry the match field.
    expectEveryProbeNarrowed(findData.mock.calls, appliedFilters);
    expect(findData.mock.calls.map(([a]) => Object.keys(a.query.where))).toContainEqual(['name']);
  });

  it('upsert+matchFields: a short createManyData return degrades and still does not duplicate', async () => {
    const { p, store } = makeProtocol({ firstCall: 'shortReturn' });

    const summary = await runImport({
      ...baseOpts, p, writeMode: 'upsert', matchFields: ['name'],
      rows: [{ name: 'x' }, { name: 'y' }],
    });

    // The empty return voids the batch → per-row degradation, which rechecks
    // and finds both rows already committed rather than re-creating them.
    expect(store).toHaveLength(2);
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(0);
  });

  it('pure insert (no matchFields): pre-assigned ids make the retry exactly-once too (#3173)', async () => {
    const { p, store, createManyData, findData, appliedFilters } = makeProtocol({ firstCall: 'throw' });

    const summary = await runImport({
      ...baseOpts, p, writeMode: 'insert', matchFields: [],
      rows: [{ name: 'x' }, { name: 'y' }],
    });

    // Previously pinned as at-least-once (4 rows). With pre-assigned row ids
    // the retry rechecks by id and re-inserts nothing — no natural key needed.
    expect(createManyData).toHaveBeenCalledTimes(1); // committed once; retry only rechecked
    expect(store).toHaveLength(2);
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(0);

    // ⭐ [#16638] The recheck is the whole mechanism of #3173, so pin the
    // payload it was handed rather than only the outcome: `id: { $in: [...] }`
    // over exactly the ids the runner pre-assigned, bounded to that many rows.
    // Read `where` / `limit`, the keys `FindDataRequest` declares — a drift
    // back to `$filter` / `$top` reddens here before it reaches an implementor.
    expectEveryProbeNarrowed(findData.mock.calls, appliedFilters);
    const probes = findData.mock.calls.map(([a]) => a.query!);
    expect(probes).toHaveLength(1);
    expect(Object.keys(probes[0].where!)).toEqual(['id']);
    expect([...(probes[0].where!.id as { $in: string[] }).$in].sort()).toEqual(store.map((r) => r.id).sort());
    expect(probes[0].limit).toBe(store.length);
  });

  it('pure insert: legitimate duplicate rows survive the retry intact (each copy has its own id) (#3173)', async () => {
    const { p, store } = makeProtocol({ firstCall: 'throw' });

    const summary = await runImport({
      ...baseOpts, p, writeMode: 'insert', matchFields: [],
      rows: [{ name: 'same' }, { name: 'same' }], // two intentional copies
    });

    // A natural-key recheck could not tell the copies apart; the per-row id
    // recheck keeps exactly the two intended rows — no loss, no duplication.
    expect(store).toHaveLength(2);
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(0);
  });

  it('insertManyData (partial success): a bad row is a per-row verdict — good rows never re-run (framework#3172)', async () => {
    const store: Array<Record<string, any>> = [];
    const insertManyData = vi.fn(async (args: { records: any[] }) => ({
      outcomes: args.records.map((r) => {
        if (r.name === 'bad') return { ok: false, error: new Error('validation failed: bad name') };
        const rec = { ...r };
        store.push(rec);
        return { ok: true, record: rec };
      }),
    }));
    const createManyData = vi.fn();
    const createData = vi.fn();
    const p: ImportProtocolLike = {
      findData: vi.fn(async () => []), createData, updateData: vi.fn(), createManyData, insertManyData,
    };

    const summary = await runImport({
      ...baseOpts, p, writeMode: 'insert', matchFields: [],
      rows: [{ name: 'good1' }, { name: 'bad' }, { name: 'good2' }],
    });

    expect(insertManyData).toHaveBeenCalledTimes(1); // one call, per-row verdicts
    expect(createManyData).not.toHaveBeenCalled();   // partial path preferred
    expect(createData).not.toHaveBeenCalled();       // NO degradation re-run for good rows
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.results[0]).toMatchObject({ ok: true, action: 'created' });
    expect(summary.results[1]).toMatchObject({ ok: false, action: 'failed' });
    expect(summary.results[2]).toMatchObject({ ok: true, action: 'created' });
    expect(store).toHaveLength(2);
  });

  it('marks rows created-with-warning on a summary recompute failure, without failing or duplicating (framework#3147)', async () => {
    const store: Array<Record<string, any>> = [];
    let idc = 0;
    const createManyData = vi.fn(async (args: { records: any[] }) => {
      const recs = args.records.map((r) => { const rec = { id: `id-${++idc}`, ...r }; store.push(rec); return rec; });
      // Records written, but the post-write summary recompute failed.
      throw Object.assign(new Error('summary recompute failed'), { code: 'ERR_SUMMARY_RECOMPUTE', written: recs });
    });
    const createData = vi.fn();
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData, updateData: vi.fn(), createManyData };

    const summary = await runImport({
      ...baseOpts, p, writeMode: 'insert', matchFields: [],
      rows: [{ name: 'x' }, { name: 'y' }],
    });

    expect(createData).not.toHaveBeenCalled(); // not degraded / re-created
    expect(store).toHaveLength(2);             // no duplicate
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.results.every((r) => r.ok && r.code === 'SUMMARY_RECOMPUTE_FAILED')).toBe(true);
  });
});

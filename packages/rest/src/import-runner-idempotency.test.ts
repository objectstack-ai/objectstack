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
  const createData = vi.fn(async (args: { data: { name: string } }) => {
    const rec = { id: `id-${++idc}`, ...args.data };
    store.push(rec);
    return rec;
  });
  const findData = vi.fn(async (args: { query?: { $filter?: Record<string, any> } }) => {
    const filter = args.query?.$filter ?? {};
    // Supports equality and { $in: [...] } — the id recheck (framework#3173)
    // queries by pre-assigned id $in, like the real SQL driver does.
    return store.filter((row) => Object.entries(filter).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); 
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    }));
  });
  const p: ImportProtocolLike = { findData, createData, updateData: vi.fn(), createManyData };
  return { p, store, createManyData, createData };
}

describe('runImport — idempotent retry with natural keys (framework#3149)', () => {
  it('upsert+matchFields: a transient retry after commit does not duplicate rows', async () => {
    const { p, store, createManyData } = makeProtocol({ firstCall: 'throw' });

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
    const { p, store, createManyData } = makeProtocol({ firstCall: 'throw' });

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

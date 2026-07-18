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
    return store.filter((row) => Object.entries(filter).every(([k, v]) => row[k] === v));
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

  it('pure insert (no matchFields): retry is at-least-once — duplicates are the documented contract', async () => {
    const { p, store } = makeProtocol({ firstCall: 'throw' });

    await runImport({
      ...baseOpts, p, writeMode: 'insert', matchFields: [],
      rows: [{ name: 'x' }, { name: 'y' }],
    });

    // No natural key to recheck against: the committed-then-retried batch is
    // written twice. This pins the contract (exactly-once needs matchFields).
    expect(store).toHaveLength(4);
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

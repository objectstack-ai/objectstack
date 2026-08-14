// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#3148: within a single import file, a later row must be able to
 * reference a record an earlier row created — even though CREATE rows are
 * buffered into a batched flush rather than written immediately. resolveRef
 * flushes the pending-create buffer on a same-object miss and retries, and a
 * bare miss is never negatively cached (which would pin it forever once a
 * later flush actually creates the row).
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './export-format.js';

// `parent` is a lookup back to this same object (a category tree).
const metaMap = new Map<string, ExportFieldMeta>([
  ['name', { name: 'name', type: 'text' }],
  ['parent', { name: 'parent', type: 'lookup', reference: 'showcase_category' }],
]);

const baseOpts = {
  objectName: 'showcase_category',
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

/** Mock protocol backed by an in-memory store: createManyData writes, findData filters. */
function makeProtocol(seed: Array<Record<string, any>> = []) {
  const store: Array<Record<string, any>> = [...seed];
  let idc = 0;
  const createManyData = vi.fn(async (args: { records: any[] }) => ({
    records: args.records.map((r) => {
      const rec = { id: `new-${++idc}`, ...r };
      store.push(rec);
      return rec;
    }),
  }));
  const findData = vi.fn(async (args: { query?: { $filter?: Record<string, any> } }) => {
    const filter = args.query?.$filter ?? {};
    return store.filter((row) => Object.entries(filter).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return row[k] === v; }));
  });
  const p: ImportProtocolLike = { findData, createData: vi.fn(), updateData: vi.fn(), createManyData };
  return { p, store, createManyData };
}

describe('runImport — same-file forward references (framework#3148)', () => {
  it('resolves a row that references a record an earlier buffered row created', async () => {
    // Existing-Parent is already in the DB; New-Parent is created by row 2 and
    // referenced by row 3 — while still sitting in the create buffer.
    const { p, store, createManyData } = makeProtocol([{ id: 'existing-1', name: 'Existing-Parent' }]);

    const summary = await runImport({
      ...baseOpts, p,
      rows: [
        { name: 'Control-Child', parent: 'Existing-Parent' }, // references a pre-existing row
        { name: 'New-Parent' },
        { name: 'New-Child', parent: 'New-Parent' },           // references row 2 (still buffered)
      ],
    });

    expect(summary.errors).toBe(0);
    expect(summary.created).toBe(3);

    const newParent = store.find((r) => r.name === 'New-Parent')!;
    const newChild = store.find((r) => r.name === 'New-Child')!;
    const controlChild = store.find((r) => r.name === 'Control-Child')!;
    expect(newChild.parent).toBe(newParent.id);   // resolved to the real created id
    expect(controlChild.parent).toBe('existing-1'); // existing-reference behaviour unchanged

    // The miss on 'New-Parent' forced an early flush mid-loop, so there are two
    // createManyData calls (the forced flush + the end-of-loop flush).
    expect(createManyData).toHaveBeenCalledTimes(2);
  });

  it('does not negatively cache a miss: a name that misses early resolves once created (progressEvery=1)', async () => {
    const { p, store } = makeProtocol();

    const summary = await runImport({
      ...baseOpts, p, progressEvery: 1,
      rows: [
        { name: 'Decoy', parent: 'New-Parent' }, // miss — New-Parent doesn't exist yet → fails
        { name: 'New-Parent' },                   // created; flushed after this row (progressEvery=1)
        { name: 'Child', parent: 'New-Parent' },  // must resolve — the earlier miss must not be cached
      ],
    });

    // Row 1 legitimately fails (the target truly did not exist at that point).
    expect(summary.results[0]).toMatchObject({ ok: false, code: 'reference_not_found' });
    // Rows 2 and 3 succeed; the child links to the real parent.
    const newParent = store.find((r) => r.name === 'New-Parent')!;
    const child = store.find((r) => r.name === 'Child')!;
    expect(child.parent).toBe(newParent.id);
    expect(summary.created).toBe(2);
  });

  it('a genuine miss (no such record, no pending create) still reports reference_not_found', async () => {
    const { p, createManyData } = makeProtocol();

    const summary = await runImport({
      ...baseOpts, p,
      rows: [{ name: 'Orphan', parent: 'Nobody' }],
    });

    expect(summary.results[0]).toMatchObject({ ok: false, code: 'reference_not_found' });
    expect(summary.created).toBe(0);
    // Nothing to create → no batch flush ever ran.
    expect(createManyData).not.toHaveBeenCalled();
  });
});

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * runImport() batches CREATE-resolved rows through `p.createManyData` instead
 * of one `createData` call per row (framework#2678). These tests exercise
 * that integration directly against a mock `ImportProtocolLike`, independent
 * of the generic `bulkWrite` unit tests in `@objectstack/core`.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './export-format.js';

const metaMap = new Map<string, ExportFieldMeta>([
  ['name', { name: 'name', type: 'text' }],
]);

const baseOpts = {
  objectName: 'task',
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

function rowsOf(n: number): Array<Record<string, any>> {
  return Array.from({ length: n }, (_, i) => ({ name: `r${i}` }));
}

describe('runImport — bulk create batching (framework#2678)', () => {
  it('routes N insert-mode rows through ceil(N/batch) createManyData calls, not N createData calls', async () => {
    const createManyData = vi.fn(async (args: { records: any[] }) => ({
      records: args.records.map((r) => ({ id: `id_${r.name}`, ...r })),
    }));
    const createData = vi.fn();
    const p: ImportProtocolLike = {
      findData: vi.fn(async () => []),
      createData,
      updateData: vi.fn(),
      createManyData,
    };

    const summary = await runImport({
      ...baseOpts, p, rows: rowsOf(250), progressEvery: 100,
    });

    expect(createData).not.toHaveBeenCalled();
    expect(createManyData).toHaveBeenCalledTimes(3); // ceil(250/100)
    expect(summary.created).toBe(250);
    expect(summary.results).toHaveLength(250);
    expect(summary.results.map((r) => r.row)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(summary.results[0]).toMatchObject({ ok: true, action: 'created', id: 'id_r0' });
    expect(summary.results[249]).toMatchObject({ ok: true, action: 'created', id: 'id_r249' });
  });

  it('retries a transient createManyData failure instead of dropping the batch', async () => {
    let attempts = 0;
    const createManyData = vi.fn(async (args: { records: any[] }) => {
      attempts++;
      if (attempts === 1) throw new Error('fetch failed');
      return { records: args.records.map((r) => ({ id: `id_${r.name}`, ...r })) };
    });
    const p: ImportProtocolLike = {
      findData: vi.fn(async () => []),
      createData: vi.fn(),
      updateData: vi.fn(),
      createManyData,
    };

    const summary = await runImport({ ...baseOpts, p, rows: rowsOf(3) });

    expect(createManyData).toHaveBeenCalledTimes(2);
    expect(summary.errors).toBe(0);
    expect(summary.created).toBe(3);
  });

  it('degrades to per-row createData on a logical batch failure, without failing the whole batch', async () => {
    const createManyData = vi.fn(async () => {
      throw new Error('CHECK constraint failed');
    });
    const createData = vi.fn(async (args: { data: { name: string } }) => {
      if (args.data.name === 'r1') throw new Error('CHECK constraint failed: name');
      return { id: `id_${args.data.name}`, record: { id: `id_${args.data.name}` } };
    });
    const p: ImportProtocolLike = {
      findData: vi.fn(async () => []),
      createData,
      updateData: vi.fn(),
      createManyData,
    };

    const summary = await runImport({ ...baseOpts, p, rows: rowsOf(3) });

    expect(createData).toHaveBeenCalledTimes(3);
    expect(summary.errors).toBe(1);
    expect(summary.created).toBe(2);
    expect(summary.results[0]).toMatchObject({ ok: true, action: 'created' });
    expect(summary.results[1]).toMatchObject({ ok: false, action: 'failed' });
    expect(summary.results[2]).toMatchObject({ ok: true, action: 'created' });
  });

  it('falls back to one createData call per row when the protocol has no createManyData', async () => {
    const createData = vi.fn(async (args: { data: { name: string } }) => ({ id: `id_${args.data.name}` }));
    const p: ImportProtocolLike = {
      findData: vi.fn(async () => []),
      createData,
      updateData: vi.fn(),
      // no createManyData
    };

    const summary = await runImport({ ...baseOpts, p, rows: rowsOf(5) });

    expect(createData).toHaveBeenCalledTimes(5);
    expect(summary.created).toBe(5);
  });

  it('retries a transient createData failure on the no-createManyData fallback path (#3150)', async () => {
    let attempts = 0;
    const createData = vi.fn(async (args: { data: { name: string } }) => {
      attempts++;
      if (attempts === 1) throw new Error('fetch failed'); // one transient blip, then succeeds
      return { id: `id_${args.data.name}` };
    });
    const p: ImportProtocolLike = {
      findData: vi.fn(async () => []),
      createData,
      updateData: vi.fn(),
      // no createManyData → inline per-row fallback path (previously un-retried)
    };

    const summary = await runImport({ ...baseOpts, p, rows: rowsOf(1) });

    expect(createData).toHaveBeenCalledTimes(2); // first throws, retried, succeeds
    expect(summary.created).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it('preserves row order in results even with update/skip rows interleaved between buffered creates', async () => {
    const createManyData = vi.fn(async (args: { records: any[] }) => ({
      records: args.records.map((r) => ({ id: `id_${r.name}`, ...r })),
    }));
    const updateData = vi.fn(async (args: { id: string }) => ({ id: args.id }));
    // Row 1 ('existing') matches an existing record → update; the rest are creates.
    const findData = vi.fn(async (args: { query?: { $filter?: { name?: string } } }) =>
      (args.query?.$filter?.name === 'existing' ? [{ id: 'existing_id', name: 'existing' }] : []));
    const p: ImportProtocolLike = { findData, createData: vi.fn(), updateData, createManyData };

    const summary = await runImport({
      ...baseOpts, p, writeMode: 'upsert', matchFields: ['name'],
      rows: [{ name: 'a' }, { name: 'existing' }, { name: 'b' }],
    });

    expect(summary.results.map((r) => r.action)).toEqual(['created', 'updated', 'created']);
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(1);
  });
});

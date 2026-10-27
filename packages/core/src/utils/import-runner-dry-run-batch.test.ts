// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26684] How the import dry run asks the engine for its verdicts: a create
 * row is previewed with the rows of the batch the commit would write it in,
 * in ONE `validateData` call, and an update row alone, as before.
 *
 * Driven against an `ImportProtocolLike` double that answers one verdict per
 * submitted row (the `ValidateDataResponse` contract) and records each call.
 * What the batch buys — a child rule reading a parent roll-up counting the
 * earlier rows — is pinned end to end over a real engine in
 * `packages/rest/src/import-dry-run-batch-parent-summary.test.ts`.
 *
 * Pinned here:
 *  - the batches are the commit's: file order, the commit's checkpoints
 *    (every `progressEvery` rows) and run length
 *    (`Math.min(progressEvery, MAX_CREATE_BATCH_SIZE)`, 200);
 *  - each row keeps its own report, at its own position, between update rows;
 *  - an update row is asked alone, in `update` mode, as before;
 *  - a batch the engine refuses outright is degraded as the commit degrades
 *    one: each row alone, then the survivors together again.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type ValidateArgs = Parameters<NonNullable<ImportProtocolLike['validateData']>>[0];

const OBJECT = 'contact';

const baseOpts = {
  objectName: OBJECT,
  metaMap: new Map<string, ExportFieldMeta>([['name', { name: 'name', type: 'text' }]]),
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: true,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

const POSTURE = { valueShapeStrict: false, mediaValueShapeStrict: false };

/**
 * One verdict per submitted row; a row named `bad*` is refused. A batch that
 * holds a row named `boom` is refused outright, as the engine throws on an
 * undeclared field.
 */
function validatingProtocol(findData: ImportProtocolLike['findData'] = vi.fn(async () => [])) {
  const validateData = vi.fn(async (args: ValidateArgs) => {
    const rows = (Array.isArray(args.data) ? args.data : [args.data]) as Array<Record<string, unknown>>;
    if (rows.some((r) => r.name === 'boom')) throw Object.assign(new Error('boom is not a field'), { code: 'INVALID_FIELD' });
    const results = rows.map((r) => String(r.name).startsWith('bad')
      ? { valid: false, errors: [{ field: 'name', code: 'rule_violation', message: `refused ${String(r.name)}` }], warnings: [] }
      : { valid: true, errors: [], warnings: [] });
    return { object: OBJECT, mode: args.mode ?? 'insert', valid: results.every((r) => r.valid), results, posture: POSTURE };
  });
  const p: ImportProtocolLike = { findData, createData: vi.fn(), updateData: vi.fn(), validateData };
  return { p, validateData };
}

const names = (call: [ValidateArgs]) => {
  const data = call[0].data;
  return Array.isArray(data) ? data.map((r) => (r as Record<string, unknown>).name) : (data as Record<string, unknown>).name;
};

describe('[#26684] the dry run previews create rows in the commit\'s batches', () => {
  it('the create rows of a small file are ONE insert-mode call, in file order, each row keeping its own verdict', async () => {
    const { p, validateData } = validatingProtocol();
    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'a' }, { name: 'bad-b' }, { name: 'c' }] });

    expect(validateData).toHaveBeenCalledTimes(1);
    expect(validateData.mock.calls[0]![0]).toMatchObject({ object: OBJECT, mode: 'insert' });
    expect(names(validateData.mock.calls[0] as [ValidateArgs])).toEqual(['a', 'bad-b', 'c']);
    expect(s).toMatchObject({ ok: 2, errors: 1, created: 2 });
    expect(s.results).toEqual([
      { row: 1, ok: true, action: 'created' },
      { row: 2, ok: false, action: 'failed', field: 'name', code: 'rule_violation', error: 'refused bad-b' },
      { row: 3, ok: true, action: 'created' },
    ]);
  });

  it('a file of 450 rows is previewed in the commit\'s runs: 200, 200, 50', async () => {
    const { p, validateData } = validatingProtocol();
    const rows = Array.from({ length: 450 }, (_, n) => ({ name: `r${n + 1}` }));
    const s = await runImport({ ...baseOpts, p, rows });

    expect(validateData.mock.calls.map((c) => (c[0].data as unknown[]).length)).toEqual([200, 200, 50]);
    expect(names(validateData.mock.calls[1] as [ValidateArgs])).toEqual(rows.slice(200, 400).map((r) => r.name));
    expect(s).toMatchObject({ ok: 450, created: 450 });
    expect(s.results.map((r) => r.row)).toEqual(rows.map((_, n) => n + 1));
  });

  it('a caller progressEvery sets the checkpoints, and the run length follows it, as on the commit', async () => {
    const { p, validateData } = validatingProtocol();
    const rows = Array.from({ length: 7 }, (_, n) => ({ name: `r${n + 1}` }));
    const progress: number[] = [];
    await runImport({ ...baseOpts, p, rows, progressEvery: 3, onProgress: (pr) => { progress.push(pr.created); } });

    expect(validateData.mock.calls.map((c) => names(c as [ValidateArgs]))).toEqual([
      ['r1', 'r2', 'r3'], ['r4', 'r5', 'r6'], ['r7'],
    ]);
    // Each checkpoint reports the rows previewed so far, as the commit reports the rows written.
    expect(progress).toEqual([3, 6, 7]);
  });

  it('an update row is asked alone, in update mode, and the create rows around it keep their batch', async () => {
    const findData = vi.fn(async (args: any) => {
      const where = JSON.stringify(args ?? {});
      return where.includes('"u1"') ? [{ id: 'e1', name: 'u1' }] : [];
    });
    const { p, validateData } = validatingProtocol(findData as any);
    const s = await runImport({
      ...baseOpts, p, writeMode: 'upsert', matchFields: ['name'],
      rows: [{ name: 'a' }, { name: 'u1' }, { name: 'bad-c' }],
    });

    const update = validateData.mock.calls.find((c) => c[0].mode === 'update')!;
    expect(update[0].data).toEqual({ name: 'u1', id: 'e1' });
    const insert = validateData.mock.calls.filter((c) => c[0].mode !== 'update');
    expect(insert.map((c) => names(c as [ValidateArgs]))).toEqual([['a', 'bad-c']]);
    expect(s.results).toEqual([
      { row: 1, ok: true, action: 'created' },
      { row: 2, ok: true, action: 'updated', id: 'e1' },
      { row: 3, ok: false, action: 'failed', field: 'name', code: 'rule_violation', error: 'refused bad-c' },
    ]);
  });

  it('a batch the engine refuses outright is asked row by row, then the survivors together again', async () => {
    const { p, validateData } = validatingProtocol();
    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'a' }, { name: 'boom' }, { name: 'c' }] });

    expect(validateData.mock.calls.map((c) => names(c as [ValidateArgs]))).toEqual([
      ['a', 'boom', 'c'], ['a'], ['boom'], ['c'], ['a', 'c'],
    ]);
    expect(s.results[0]).toEqual({ row: 1, ok: true, action: 'created' });
    expect(s.results[1]).toMatchObject({ row: 2, ok: false, action: 'failed', code: 'INVALID_FIELD' });
    expect(s.results[2]).toEqual({ row: 3, ok: true, action: 'created' });
  });

  it('no validate-only operation: every create row is reported on its coercion verdict, as before', async () => {
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData: vi.fn(), updateData: vi.fn() };
    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'a' }, { name: 'b' }] });
    expect(s).toMatchObject({ ok: 2, created: 2, errors: 0 });
    expect(p.createData).not.toHaveBeenCalled();
  });
});

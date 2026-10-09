// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22445] The dry run of an update asks `validateData` about the row the
 * update would write: the matched record's id rides in the payload exactly as
 * the write's `updateData` folds it (`{ ...data, id }`), so the engine's
 * `update`-mode preview can read that stored row and judge the merge.
 *
 * Driven against `ImportProtocolLike` doubles, recording what each call was
 * asked. End to end over a real engine and the real protocol, where the
 * preview reads the stored row: `packages/objectql/src/validate-update-stored-row.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type ValidateArgs = Parameters<NonNullable<ImportProtocolLike['validateData']>>[0];
type UpdateArgs = Parameters<ImportProtocolLike['updateData']>[0];

const OBJECT = 'task';
const metaMap = new Map<string, ExportFieldMeta>([
  ['code', { name: 'code', type: 'text' }],
  ['title', { name: 'title', type: 'text' }],
]);

const baseOpts = {
  objectName: OBJECT,
  metaMap,
  matchFields: ['code'],
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

function protocol(matched: Record<string, unknown>[]) {
  const validateData = vi.fn(async (args: ValidateArgs) => ({
    object: OBJECT, mode: args.mode ?? 'insert', valid: true,
    results: [{ valid: true, errors: [], warnings: [] }],
    posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
  }));
  const updateData = vi.fn(async (args: UpdateArgs) => ({ object: OBJECT, id: args.id, record: { ...args.data, id: args.id } }));
  const p: ImportProtocolLike = {
    findData: vi.fn(async () => matched.map((r) => ({ ...r }))),
    createData: vi.fn(),
    updateData,
    validateData,
  };
  return { p, validateData, updateData };
}

describe('[#22445] the dry run of a matched row names the stored row it would update', () => {
  it('an update row is previewed with the matched record\'s id in its payload', async () => {
    const { p, validateData } = protocol([{ id: 'rec_7', code: 'c7', title: 'stored' }]);
    const s = await runImport({ ...baseOpts, p, writeMode: 'update', dryRun: true, rows: [{ code: 'c7', title: 'new' }] });

    expect(s.results[0]).toMatchObject({ ok: true, action: 'updated', id: 'rec_7' });
    expect(validateData).toHaveBeenCalledTimes(1);
    expect(validateData.mock.calls[0]![0]).toMatchObject({ mode: 'update', data: { code: 'c7', title: 'new', id: 'rec_7' } });
  });

  it('the matched id wins over an id cell, as the write\'s fold makes it win', async () => {
    const { p, validateData, updateData } = protocol([{ id: 'rec_7', code: 'c7' }]);
    const metaWithId = new Map(metaMap).set('id', { name: 'id', type: 'text' });
    const row = { code: 'c7', id: 'other', title: 'new' };

    await runImport({ ...baseOpts, metaMap: metaWithId, p, writeMode: 'update', dryRun: true, rows: [row] });
    expect((validateData.mock.calls[0]![0].data as Record<string, unknown>).id).toBe('rec_7');

    // The write binds the matched id too (the protocol folds `{ ...data, id }`).
    await runImport({ ...baseOpts, metaMap: metaWithId, p, writeMode: 'update', dryRun: false, rows: [row] });
    expect(updateData.mock.calls[0]![0]).toMatchObject({ id: 'rec_7' });
  });

  it('control: a create row is previewed in insert mode, with no id added', async () => {
    const { p, validateData } = protocol([]);
    await runImport({ ...baseOpts, p, writeMode: 'upsert', dryRun: true, rows: [{ code: 'c8', title: 'fresh' }] });

    expect(validateData.mock.calls[0]![0]).toMatchObject({ mode: 'insert' });
    expect(validateData.mock.calls[0]![0].data).toEqual({ code: 'c8', title: 'fresh' });
  });
});

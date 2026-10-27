// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25582, maintainer ruling 6377844879 letter A, proposal 4] A row with
 * several bad cells reports every one of them in `errors`, one element per
 * failed cell in column order, beside the first-error keys `field` / `code` /
 * `error`, which keep naming element 0 (`ImportRowResultSchema.errors`).
 *
 * The list is filled from `coerceRow`'s cell errors only. A row the validate
 * verdict refuses (the dry run) and a row whose write is refused (the commit,
 * through `toFailedResult`) carry no `errors`: on those paths `error` is not
 * element 0's message, and the spec's describe names cell-coercion errors as
 * the list's only source.
 *
 * Driven against an `ImportProtocolLike` double; the route, the async job and
 * a real engine are pinned in `packages/rest/src/import-row-cell-errors.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type ValidateArgs = Parameters<NonNullable<ImportProtocolLike['validateData']>>[0];

const OBJECT = 'supplier';

const metaMap = new Map<string, ExportFieldMeta>([
  ['name', { name: 'name', type: 'text', label: 'Name' }],
  ['opened', { name: 'opened', type: 'date', label: 'Opened' }],
  ['qty', { name: 'qty', type: 'number', label: 'Qty' }],
  ['country', { name: 'country', type: 'select', label: 'Country', options: [{ label: 'China', value: 'cn' }] }],
]);

const baseOpts = {
  objectName: OBJECT,
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

/** Three bad cells, in this column order, around a good one. */
const BAD_ROW = { opened: 'not a day', name: 'Acme', qty: 'many', country: 'DE' };

function protocol(over: Partial<ImportProtocolLike> = {}): ImportProtocolLike {
  return {
    findData: vi.fn(async () => []),
    createData: vi.fn(async (args: any) => ({ record: { id: 'r1', ...args.data } })),
    updateData: vi.fn(),
    validateData: vi.fn(async (args: ValidateArgs) => ({
      object: OBJECT, mode: args.mode ?? 'insert', valid: true,
      results: [{ valid: true, errors: [], warnings: [] }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    })),
    ...over,
  };
}

function expectEveryCellError(row: any) {
  expect(row, JSON.stringify(row)).toMatchObject({ row: 1, ok: false, action: 'failed' });
  expect(row.errors.map((e: any) => [e.field, e.code])).toEqual([
    ['opened', 'invalid_date'],
    ['qty', 'invalid_number'],
    ['country', 'invalid_option'],
  ]);
  // Element 0 is the first-error keys, and every element is `{ field, code, message }`.
  expect({ field: row.field, code: row.code, error: row.error })
    .toEqual({ field: row.errors[0].field, code: row.errors[0].code, error: row.errors[0].message });
  for (const e of row.errors) expect(Object.keys(e).sort()).toEqual(['code', 'field', 'message']);
}

describe('[#25582] a row with several bad cells reports every cell error', () => {
  it('the dry run: every cell error, in column order, element 0 = the first-error keys', async () => {
    const p = protocol();
    const s = await runImport({ ...baseOpts, p, dryRun: true, rows: [BAD_ROW, { name: 'Good' }] });
    expect(s).toMatchObject({ ok: 1, errors: 1 });
    expectEveryCellError(s.results[0]);
    // The good row has no list.
    expect(s.results[1]).not.toHaveProperty('errors');
  });

  it('the commit: the same report, and the row is never written', async () => {
    const p = protocol();
    const s = await runImport({ ...baseOpts, p, dryRun: false, rows: [BAD_ROW] });
    expect(s).toMatchObject({ ok: 0, errors: 1, created: 0 });
    expectEveryCellError(s.results[0]);
    expect(p.createData).not.toHaveBeenCalled();
  });

  it('one bad cell: a one-element list naming it', async () => {
    const s = await runImport({ ...baseOpts, p: protocol(), dryRun: true, rows: [{ name: 'Acme', qty: 'many' }] });
    expect(s.results[0]).toMatchObject({ field: 'qty', code: 'invalid_number' });
    expect(s.results[0].errors).toEqual([{ field: 'qty', code: 'invalid_number', message: s.results[0].error }]);
  });
});

describe('[#25582] a row that failed for another reason carries no `errors`', () => {
  it('a validate-verdict refusal (dry run)', async () => {
    const p = protocol({
      validateData: vi.fn(async (args: ValidateArgs) => ({
        object: OBJECT, mode: args.mode ?? 'insert', valid: false,
        results: [{
          valid: false,
          errors: [
            { field: 'name', code: 'required', message: 'Name is required' },
            { field: 'qty', code: 'min', message: 'Qty must be at least 1' },
          ],
          warnings: [],
        }],
        posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
      })),
    });
    const s = await runImport({ ...baseOpts, p, dryRun: true, rows: [{ qty: '0' }] });
    expect(s.results[0]).toMatchObject({ row: 1, ok: false, action: 'failed', field: 'name', code: 'required' });
    expect(s.results[0]).not.toHaveProperty('errors');
  });

  it('a refused write (commit, through the create door\'s verdict)', async () => {
    const refusal = Object.assign(new Error('Name is required'), {
      statusCode: 400, code: 'VALIDATION_FAILED',
      fields: [{ field: 'name', code: 'required', message: 'Name is required' }],
    });
    const p = protocol({ createData: vi.fn(async () => { throw refusal; }) });
    const s = await runImport({ ...baseOpts, p, dryRun: false, rows: [{ qty: '3' }] });
    expect(s.results[0]).toMatchObject({ row: 1, ok: false, action: 'failed' });
    expect(s.results[0]).not.toHaveProperty('errors');
  });
});

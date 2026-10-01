// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20701] `runImport` copies the engine's per-row drop report onto each `ok`
 * row, on the dry run and on the commit, from whichever single-row channel the
 * row's write answered on. Driven against `ImportProtocolLike` doubles, one
 * channel per case:
 *
 * | half | channel the runner reads | the row |
 * |:--|:--|:--|
 * | dry run, create | `validateData(...).results[0].droppedFields` | carries it |
 * | dry run, update (an upsert match) | the same, `mode: 'update'` | carries it |
 * | commit, create | `insertManyData(...).outcomes[i].droppedFields` | carries ITS OWN outcome's |
 * | commit, create (no bulk primitive) | `createData(...).droppedFields` | carries it |
 * | commit, create (a failed batch degraded to `createData`) | the same, per row | carries it |
 * | commit, create (summary recompute failed after the write) | the outcomes on the error | carries it, beside `SUMMARY_RECOMPUTE_FAILED` |
 * | commit, update | `updateData(...).droppedFields` | carries it |
 * | commit, create through `createManyData` | only a batch-level union | carries NONE (the union names no row) |
 *
 * The events are copied VERBATIM: the runner reads no `reason`, so an arm the
 * engine adds later reaches the row unchanged (one case below uses a reason
 * outside today's enum to prove it). A clean row, a failed row and a skipped
 * row carry no key.
 *
 * End to end over a real engine, through the HTTP route and the async job:
 * `packages/rest/src/import-row-dropped-fields-20701.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { runImport, type ImportProtocolLike, type ImportRowResult } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

/**
 * [#16952] The doubles are annotated FROM the exported declaration, never from a
 * hand-written restatement of what the runner sends.
 */
type CreateArgs = Parameters<ImportProtocolLike['createData']>[0];
type UpdateArgs = Parameters<ImportProtocolLike['updateData']>[0];
type InsertManyArgs = Parameters<NonNullable<ImportProtocolLike['insertManyData']>>[0];
type ValidateArgs = Parameters<NonNullable<ImportProtocolLike['validateData']>>[0];

const OBJECT = 'task';
const COMPUTED: DroppedFieldsEvent = { object: OBJECT, fields: ['doubled'], reason: 'computed' };
const READONLY: DroppedFieldsEvent = { object: OBJECT, fields: ['ro'], reason: 'readonly' };
const READONLY_WHEN: DroppedFieldsEvent = { object: OBJECT, fields: ['locked'], reason: 'readonly_when' };

const metaMap = new Map<string, ExportFieldMeta>([['name', { name: 'name', type: 'text' }]]);

const baseOpts = {
  objectName: OBJECT,
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

/** What the double's engine would strip from a row: one event per reason, `computed` before `readonly`. */
function dropsFor(row: Record<string, unknown>): DroppedFieldsEvent[] {
  const out: DroppedFieldsEvent[] = [];
  if ('doubled' in row) out.push(COMPUTED);
  if ('ro' in row) out.push(READONLY);
  return out;
}
const withDrops = (row: Record<string, unknown>) => {
  const d = dropsFor(row);
  return d.length > 0 ? { droppedFields: d } : {};
};

/** The row's key set — a clean row must not grow an empty `droppedFields`. */
const keysOf = (r: ImportRowResult | undefined) => Object.keys(r ?? {}).sort();

const ROWS = [
  { name: 'formula', doubled: 5 },
  { name: 'clean' },
  { name: 'readonly', ro: 'forged' },
  { name: 'both', doubled: 1, ro: 'x' },
];

describe('[#20701] the dry run copies validateData\'s per-row drops onto the row', () => {
  it('a create-resolved row carries the verdict\'s droppedFields verbatim; a clean row carries no key', async () => {
    const validateData = vi.fn(async (args: ValidateArgs) => ({
      object: OBJECT, mode: args.mode ?? 'insert', valid: true,
      results: [{ valid: true, errors: [], warnings: [], ...withDrops(args.data as Record<string, unknown>) }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData: vi.fn(), updateData: vi.fn(), validateData };
    const s = await runImport({ ...baseOpts, p, rows: ROWS, dryRun: true });

    expect(s).toMatchObject({ ok: 4, errors: 0, created: 4 });
    expect(s.results[0]).toEqual({ row: 1, ok: true, action: 'created', droppedFields: [COMPUTED] });
    expect(s.results[1]).toEqual({ row: 2, ok: true, action: 'created' });
    expect(s.results[2]).toEqual({ row: 3, ok: true, action: 'created', droppedFields: [READONLY] });
    expect(s.results[3]).toEqual({ row: 4, ok: true, action: 'created', droppedFields: [COMPUTED, READONLY] });
  });

  it('an update-resolved row (an upsert match) carries the update-mode verdict\'s droppedFields', async () => {
    const validateData = vi.fn(async (args: ValidateArgs) => ({
      object: OBJECT, mode: args.mode ?? 'insert', valid: true,
      results: [{ valid: true, errors: [], warnings: [], droppedFields: [COMPUTED] }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    }));
    const p: ImportProtocolLike = {
      findData: vi.fn(async () => [{ id: 'e1', name: 'formula' }]), createData: vi.fn(), updateData: vi.fn(), validateData,
    };
    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'formula', doubled: 5 }], dryRun: true, writeMode: 'upsert', matchFields: ['name'] });

    expect(validateData.mock.calls[0][0]).toMatchObject({ mode: 'update' });
    expect(s.results[0]).toEqual({ row: 1, ok: true, action: 'updated', id: 'e1', droppedFields: [COMPUTED] });
  });

  it('a row the verdict refuses carries no droppedFields, and an admitted warning rides beside the drops', async () => {
    const warning = { field: 'name', code: 'invalid_format', message: 'admitted' };
    const validateData = vi.fn(async (args: ValidateArgs) => {
      const refused = (args.data as Record<string, unknown>).name === 'bad';
      return {
        object: OBJECT, mode: 'insert' as const, valid: !refused,
        results: [refused
          ? { valid: false, errors: [{ field: 'name', code: 'required', message: 'name is required' }], warnings: [], droppedFields: [COMPUTED] }
          : { valid: true, errors: [], warnings: [warning], droppedFields: [COMPUTED] }],
        posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
      };
    });
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData: vi.fn(), updateData: vi.fn(), validateData };
    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'bad', doubled: 1 }, { name: 'ok', doubled: 1 }], dryRun: true });

    expect(s.results[0]).toMatchObject({ row: 1, ok: false, action: 'failed', field: 'name', code: 'required' });
    expect(s.results[0]).not.toHaveProperty('droppedFields');
    expect(s.results[1]).toEqual({ row: 2, ok: true, action: 'created', warnings: [warning], droppedFields: [COMPUTED] });
  });
});

describe('[#20701] the commit copies each row\'s own write report onto the row', () => {
  it('insertManyData: each ok row carries ITS outcome\'s droppedFields, a clean and a failed row carry none', async () => {
    const insertManyData = vi.fn(async (args: InsertManyArgs) => ({
      outcomes: args.records.map((r: Record<string, any>) => (r.name === 'fails'
        ? { ok: false, error: Object.assign(new Error('name is required'), { code: 'VALIDATION_FAILED' }) }
        : { ok: true, record: { id: r.id, ...r }, ...withDrops(r) })),
    }));
    const createData = vi.fn();
    // `createManyData` is the runner's gate for buffering creates at all; with
    // `insertManyData` beside it the partial-success primitive is the one used.
    const createManyData = vi.fn();
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData, updateData: vi.fn(), createManyData, insertManyData };
    const s = await runImport({ ...baseOpts, p, rows: [...ROWS, { name: 'fails', doubled: 2 }] });

    expect(insertManyData).toHaveBeenCalledTimes(1);
    expect(createManyData).not.toHaveBeenCalled();
    expect(createData).not.toHaveBeenCalled();
    expect(s).toMatchObject({ ok: 4, errors: 1, created: 4 });
    expect(s.results[0]).toMatchObject({ row: 1, ok: true, action: 'created', droppedFields: [COMPUTED] });
    expect(keysOf(s.results[1])).toEqual(['action', 'id', 'ok', 'row']);
    expect(s.results[2]).toMatchObject({ row: 3, ok: true, action: 'created', droppedFields: [READONLY] });
    expect(s.results[3]).toMatchObject({ row: 4, ok: true, action: 'created', droppedFields: [COMPUTED, READONLY] });
    expect(s.results[4]).toMatchObject({ row: 5, ok: false, action: 'failed' });
    expect(s.results[4]).not.toHaveProperty('droppedFields');
  });

  it('the events are copied verbatim: a reason outside today\'s enum reaches the row unchanged', async () => {
    const future = { object: OBJECT, fields: ['x'], reason: 'some_future_arm' } as unknown as DroppedFieldsEvent;
    const insertManyData = vi.fn(async (args: InsertManyArgs) => ({
      outcomes: args.records.map((r: Record<string, any>) => ({ ok: true, record: { id: r.id }, droppedFields: [future] })),
    }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData: vi.fn(), updateData: vi.fn(), createManyData: vi.fn(), insertManyData };
    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'a', x: 1 }] });

    expect(s.results[0].droppedFields).toEqual([future]);
  });

  it('createData (a protocol with no bulk primitive): the response\'s droppedFields is the row\'s', async () => {
    let n = 0;
    const createData = vi.fn(async (args: CreateArgs) => ({ object: OBJECT, id: `c${++n}`, record: { id: `c${n}` }, ...withDrops(args.data) }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData, updateData: vi.fn() };
    const s = await runImport({ ...baseOpts, p, rows: ROWS });

    expect(createData).toHaveBeenCalledTimes(4);
    expect(s.results.map((r) => r.droppedFields)).toEqual([[COMPUTED], undefined, [READONLY], [COMPUTED, READONLY]]);
    expect(keysOf(s.results[1])).toEqual(['action', 'id', 'ok', 'row']);
  });

  it('a batch that fails and degrades to createData per row: each row carries its own response\'s drops', async () => {
    const insertManyData = vi.fn(async () => { throw Object.assign(new Error('batch refused'), { code: 'SOME_LOGICAL' }); });
    const createData = vi.fn(async (args: CreateArgs) => ({ object: OBJECT, id: String(args.data.id), record: { id: args.data.id }, ...withDrops(args.data) }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData, updateData: vi.fn(), createManyData: vi.fn(), insertManyData };
    const s = await runImport({ ...baseOpts, p, rows: ROWS });

    expect(insertManyData).toHaveBeenCalled();
    expect(createData).toHaveBeenCalledTimes(4);
    expect(s.results.map((r) => r.droppedFields)).toEqual([[COMPUTED], undefined, [READONLY], [COMPUTED, READONLY]]);
  });

  it('rows written before a summary recompute failed: the outcomes on the error still carry each row\'s drops', async () => {
    const insertManyData = vi.fn(async (args: InsertManyArgs) => {
      const written = args.records.map((r: Record<string, any>) => ({ ok: true, record: { id: r.id }, ...withDrops(r) }));
      throw Object.assign(new Error('summary recompute failed'), { code: 'ERR_SUMMARY_RECOMPUTE', written });
    });
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData: vi.fn(), updateData: vi.fn(), createManyData: vi.fn(), insertManyData };
    const s = await runImport({ ...baseOpts, p, rows: ROWS.slice(0, 2) });

    expect(s.results[0]).toMatchObject({ ok: true, action: 'created', code: 'SUMMARY_RECOMPUTE_FAILED', droppedFields: [COMPUTED] });
    expect(s.results[1]).toMatchObject({ ok: true, action: 'created', code: 'SUMMARY_RECOMPUTE_FAILED' });
    expect(s.results[1]).not.toHaveProperty('droppedFields');
  });

  it('updateData (an upsert match): the response\'s droppedFields is the row\'s, readonly_when included', async () => {
    const updateData = vi.fn(async (args: UpdateArgs) => ({
      object: OBJECT, id: args.id, record: { id: args.id }, droppedFields: [COMPUTED, READONLY_WHEN],
    }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => [{ id: 'e1', name: 'formula' }]), createData: vi.fn(), updateData };
    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'formula', doubled: 5, locked: 'x' }], writeMode: 'upsert', matchFields: ['name'] });

    expect(updateData).toHaveBeenCalledTimes(1);
    expect(s.results[0]).toEqual({ row: 1, ok: true, action: 'updated', id: 'e1', droppedFields: [COMPUTED, READONLY_WHEN] });
  });

  it('an update whose response names no drop carries no key (the control)', async () => {
    const updateData = vi.fn(async (args: UpdateArgs) => ({ object: OBJECT, id: args.id, record: { id: args.id } }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => [{ id: 'e1', name: 'clean' }]), createData: vi.fn(), updateData };
    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'clean' }], writeMode: 'upsert', matchFields: ['name'] });

    expect(s.results[0]).toEqual({ row: 1, ok: true, action: 'updated', id: 'e1' });
  });

  it('createManyData answers only a batch-level union: the rows carry no key rather than a guessed share', async () => {
    const createManyData = vi.fn(async (args: { records: any[] }) => ({
      records: args.records.map((r) => ({ id: r.id, ...r })),
      droppedFields: [COMPUTED, READONLY],
    }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData: vi.fn(), updateData: vi.fn(), createManyData };
    const s = await runImport({ ...baseOpts, p, rows: ROWS });

    expect(createManyData).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ ok: 4, created: 4 });
    for (const r of s.results) expect(r).not.toHaveProperty('droppedFields');
  });
});

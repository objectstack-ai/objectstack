// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22183 — `createMissingOptions` reaches the engine write.
 *
 * The coercion keeps a select / multiselect cell that matches no option, and
 * the engine's option check refuses a value outside the options unless the
 * write names it in `ExecutionContext.keptOptionValues`. runImport owns the
 * hand-over: every write call (and the dry run's `validateData`) carries
 * exactly the values the rows it writes kept, and a call whose rows kept
 * nothing carries the import's write context unchanged.
 *
 * The engine's half (the option arms admit a listed value, and only it) is
 * pinned in @objectstack/objectql (`import-kept-option-values.test.ts`, which
 * also drives this runner through the real engine); this file pins the wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type CreateArgs = Parameters<ImportProtocolLike['createData']>[0];
type UpdateArgs = Parameters<ImportProtocolLike['updateData']>[0];
type CreateManyArgs = Parameters<NonNullable<ImportProtocolLike['createManyData']>>[0];
type InsertManyArgs = Parameters<NonNullable<ImportProtocolLike['insertManyData']>>[0];
type ValidateArgs = Parameters<NonNullable<ImportProtocolLike['validateData']>>[0];

const metaMap = new Map<string, ExportFieldMeta>([
  ['code', { name: 'code', type: 'text' }],
  ['priority', { name: 'priority', type: 'select', options: [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }] }],
  ['tags', { name: 'tags', type: 'multiselect', options: [{ label: 'Important', value: 'important' }] }],
]);

const baseOpts = {
  objectName: 'ticket',
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: true,
  skipBlankMatchKey: false,
};

/** Records `{ kind, rows, context }` for every call that writes or previews. */
function makeProvider(shape: 'inline' | 'createMany' | 'insertMany' | 'update' | 'validate') {
  const calls: Array<{ kind: string; rows: Array<Record<string, unknown>>; context: any }> = [];
  let idc = 0;
  const p: ImportProtocolLike = {
    findData: vi.fn(async () => (shape === 'update' ? [{ id: 'existing', code: 'k' }] : [])),
    createData: vi.fn(async (args: CreateArgs) => {
      calls.push({ kind: 'createData', rows: [args.data as Record<string, unknown>], context: args.context });
      return { id: `d${++idc}`, ...(args.data as object) };
    }),
    updateData: vi.fn(async (args: UpdateArgs) => {
      calls.push({ kind: 'updateData', rows: [args.data as Record<string, unknown>], context: args.context });
      return { id: args.id, ...(args.data as object) };
    }),
  };
  if (shape === 'createMany') {
    p.createManyData = vi.fn(async (args: CreateManyArgs) => {
      calls.push({ kind: 'createManyData', rows: args.records as Array<Record<string, unknown>>, context: args.context });
      return { records: args.records.map((r: any) => ({ id: `d${++idc}`, ...r })) };
    });
  }
  if (shape === 'insertMany') {
    p.insertManyData = vi.fn(async (args: InsertManyArgs) => {
      calls.push({ kind: 'insertManyData', rows: args.records as Array<Record<string, unknown>>, context: args.context });
      return { outcomes: args.records.map((r: any) => ({ ok: true, record: { id: `d${++idc}`, ...r } })) } as any;
    });
    // `bulkWrite` needs the all-or-nothing primitive beside the partial one.
    p.createManyData = vi.fn(async (args: CreateManyArgs) => {
      calls.push({ kind: 'createManyData', rows: args.records as Array<Record<string, unknown>>, context: args.context });
      return { records: args.records.map((r: any) => ({ id: `d${++idc}`, ...r })) };
    });
  }
  if (shape === 'validate') {
    p.validateData = vi.fn(async (args: ValidateArgs) => {
      calls.push({ kind: 'validateData', rows: [args.data as Record<string, unknown>], context: args.context });
      return { results: [{ valid: true, errors: [] }] } as any;
    });
  }
  return { p, calls };
}

const ROWS = [
  { code: 'a', priority: 'Bogus' },          // kept: priority
  { code: 'b', priority: 'High' },           // matched: nothing kept
  { code: 'c', tags: 'Important, Other' },   // kept: tags
];

describe('runImport — createMissingOptions hands the kept values to the write (#22183)', () => {
  it('a per-row create carries exactly that row\'s kept values, and a row that kept nothing carries none', async () => {
    const { p, calls } = makeProvider('inline');
    const summary = await runImport({ ...baseOpts, p, rows: ROWS, context: { userId: 'u1' } });
    expect(summary.created).toBe(3);
    expect(calls.map((c) => c.kind)).toEqual(['createData', 'createData', 'createData']);
    expect(calls[0].context.keptOptionValues).toEqual({ priority: ['Bogus'] });
    expect(calls[1].context).not.toHaveProperty('keptOptionValues');
    expect(calls[2].context.keptOptionValues).toEqual({ tags: ['Other'] });
    // The rest of the write context is the import's own, untouched.
    for (const c of calls) {
      expect(c.context.userId).toBe('u1');
      expect(c.context.skipAutomations).toBe(true);
    }
    expect(calls[0].rows[0]).toMatchObject({ priority: 'Bogus' });
    expect(calls[2].rows[0]).toMatchObject({ tags: ['important', 'Other'] });
  });

  it('a batched create (createManyData) carries the union of its rows\' kept values', async () => {
    const { p, calls } = makeProvider('createMany');
    const summary = await runImport({ ...baseOpts, p, rows: [...ROWS, { code: 'd', priority: 'Bogus' }] });
    expect(summary.created).toBe(4);
    expect(calls.map((c) => c.kind)).toEqual(['createManyData']);
    expect(calls[0].rows).toHaveLength(4);
    expect(calls[0].context.keptOptionValues).toEqual({ priority: ['Bogus'], tags: ['Other'] });
  });

  it('a partial-success batch (insertManyData) carries the union of its rows\' kept values', async () => {
    const { p, calls } = makeProvider('insertMany');
    const summary = await runImport({ ...baseOpts, p, rows: ROWS });
    expect(summary.created).toBe(3);
    expect(calls.map((c) => c.kind)).toEqual(['insertManyData']);
    expect(calls[0].context.keptOptionValues).toEqual({ priority: ['Bogus'], tags: ['Other'] });
  });

  it('an update carries the row\'s kept values', async () => {
    const { p, calls } = makeProvider('update');
    const summary = await runImport({
      ...baseOpts, p, writeMode: 'update', matchFields: ['code'], rows: [{ code: 'k', priority: 'Bogus' }],
    });
    expect(summary.updated).toBe(1);
    expect(calls.map((c) => c.kind)).toEqual(['updateData']);
    expect(calls[0].context.keptOptionValues).toEqual({ priority: ['Bogus'] });
  });

  it('the dry run asks validateData with the same per-row context the write would carry', async () => {
    const { p, calls } = makeProvider('validate');
    const summary = await runImport({ ...baseOpts, p, dryRun: true, rows: ROWS });
    expect(summary.created).toBe(3);
    expect(calls.map((c) => c.kind)).toEqual(['validateData', 'validateData', 'validateData']);
    expect(calls[0].context.keptOptionValues).toEqual({ priority: ['Bogus'] });
    expect(calls[1].context).not.toHaveProperty('keptOptionValues');
    expect(calls[2].context.keptOptionValues).toEqual({ tags: ['Other'] });
  });

  it('with the option off, an unmatched cell fails at coercion and no write carries the key', async () => {
    const { p, calls } = makeProvider('inline');
    const summary = await runImport({ ...baseOpts, p, createMissingOptions: false, rows: ROWS });
    expect(summary.created).toBe(1);
    expect(summary.results.filter((r) => !r.ok).map((r) => r.code)).toEqual(['invalid_option', 'invalid_option']);
    expect(calls).toHaveLength(1);
    expect(calls[0].context).not.toHaveProperty('keptOptionValues');
  });
});

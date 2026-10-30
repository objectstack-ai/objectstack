// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27465] The runner's half of the rule the import door enforces: a match key
 * naming a field that holds a list or a structured value cannot identify a
 * record. A caller that reaches {@link runImport} without the door (the
 * connector pull writes a mapping's `upsertKey` straight through) gets every
 * row failed with that refusal, naming the field, before any row is coerced,
 * read or written. At the base the matcher put the coerced id array straight
 * into an implicit `$eq`, and every row failed on the driver's raw refusal.
 *
 * The rule itself, {@link multiValueMatchKeyRefusal}, is pinned on the whole
 * JSON-column population and on its boundary (a single-value lookup, a
 * single-value file field, and a name the map does not carry stay legal keys).
 */

import { describe, it, expect, vi } from 'vitest';
import { multiValueMatchKeyRefusal, runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type FindArgs = Parameters<ImportProtocolLike['findData']>[0];

const meta = (name: string, type: string, extra: Partial<ExportFieldMeta> = {}): [string, ExportFieldMeta] =>
  [name, { name, type, ...extra }];

const metaMap = new Map<string, ExportFieldMeta>([
  meta('code', 'text'),
  meta('title', 'text'),
  meta('work_object', 'lookup', { reference: 'pm_project', displayField: 'name', multiple: true }),
  meta('owner', 'lookup', { reference: 'pm_project', displayField: 'name' }),
  meta('watchers', 'user', { reference: 'sys_user', multiple: true }),
  meta('flags', 'select', { multiple: true, options: [{ label: 'A', value: 'a' }] }),
  meta('topics', 'multiselect', { options: [{ label: 'Red', value: 'red' }] }),
  meta('picks', 'checkboxes', { options: [{ label: 'X', value: 'x' }] }),
  meta('labels', 'tags'),
  meta('photos', 'image', { multiple: true }),
  meta('contract', 'file'),
  meta('meta', 'json'),
  meta('hq', 'address'),
  meta('spot', 'location'),
  meta('embedding', 'vector'),
]);

function makeProtocol() {
  return {
    findData: vi.fn(async (_args: FindArgs) => ({ records: [] })),
    createData: vi.fn(async () => ({ id: 'new' })),
    createManyData: vi.fn(async (args: { records: any[] }) => ({ records: args.records.map((r, i) => ({ id: `n${i}`, ...r })) })),
    updateData: vi.fn(async () => ({ id: 'upd' })),
  };
}

const baseOpts = {
  objectName: 'pm_task',
  metaMap,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

const ROWS = [
  { code: 'T-1', title: 'one', work_object: 'Apollo;Borealis' },
  { code: 'T-2', title: 'two', work_object: 'Borealis' },
];

describe('[#27465] multiValueMatchKeyRefusal: which fields cannot be a match key', () => {
  it.each([
    ['a `multiple: true` lookup', 'work_object', '"work_object" (lookup, multiple: true)'],
    ['a `multiple: true` user', 'watchers', '"watchers" (user, multiple: true)'],
    ['a `multiple: true` select', 'flags', '"flags" (select, multiple: true)'],
    ['a multiselect', 'topics', '"topics" (multiselect)'],
    ['a checkboxes field', 'picks', '"picks" (checkboxes)'],
    ['a tags field', 'labels', '"labels" (tags)'],
    ['a `multiple: true` image', 'photos', '"photos" (image, multiple: true)'],
    ['a json field', 'meta', '"meta" (json)'],
    ['an address', 'hq', '"hq" (address)'],
    ['a location', 'spot', '"spot" (location)'],
    ['a vector', 'embedding', '"embedding" (vector)'],
  ])('%s is refused, named with its kind', (_label, field, named) => {
    const refused = multiValueMatchKeyRefusal(['code', field], metaMap);
    expect(refused?.fields).toEqual([field]);
    expect(refused?.message).toContain(named);
  });

  it('every refused field of every ordered key set is named once, in key order', () => {
    const refused = multiValueMatchKeyRefusal([['code', 'labels'], ['meta'], ['labels', 'title']], metaMap, 'Mapping "feed" upsertKey');
    expect(refused?.fields).toEqual(['labels', 'meta']);
    expect(refused?.message.startsWith('Mapping "feed" upsertKey names "labels" (tags), "meta" (json)')).toBe(true);
  });

  it.each([
    ['scalar text fields', ['code', 'title']],
    ['a single-value lookup', ['owner']],
    ['a single-value file field (a scalar id)', ['contract']],
    ['a name the map does not carry', ['nowhere']],
    ['ordered key sets of legal keys', [['code'], ['owner', 'title']]],
  ])('%s are legal keys', (_label, matchFields) => {
    expect(multiValueMatchKeyRefusal(matchFields as string[] | string[][], metaMap)).toBeUndefined();
  });
});

describe('[#27465] runImport fails every row of a key naming a multi-value field, before any read or write', () => {
  it.each([
    ['upsert, commit', 'upsert', false],
    ['upsert, dry run', 'upsert', true],
    ['update, commit', 'update', false],
  ] as const)('%s', async (_label, writeMode, dryRun) => {
    const p = makeProtocol();
    const onProgress = vi.fn();
    const summary = await runImport({
      ...baseOpts, p, rows: ROWS, writeMode, dryRun, matchFields: ['code', 'work_object'], onProgress,
    });

    const refusal = multiValueMatchKeyRefusal(['work_object'], metaMap)!.message;
    expect(summary.results).toEqual([
      { row: 1, ok: false, action: 'failed', field: 'work_object', code: 'VALIDATION_ERROR', error: refusal },
      { row: 2, ok: false, action: 'failed', field: 'work_object', code: 'VALIDATION_ERROR', error: refusal },
    ]);
    expect(summary).toMatchObject({ total: 2, processed: 2, ok: 0, errors: 2, created: 0, updated: 0, skipped: 0, cancelled: false });
    expect(onProgress).toHaveBeenCalledTimes(1);
    // Nothing was read: not the matcher's query, not the lookup cells' own resolution.
    for (const fn of Object.values(p)) expect(fn).not.toHaveBeenCalled();
  });

  it('ordered key sets naming one in a later set are refused all the same', async () => {
    const p = makeProtocol();
    const summary = await runImport({ ...baseOpts, p, rows: ROWS, writeMode: 'upsert', dryRun: false, matchFields: [['code'], ['labels']] });
    expect(summary.results.map((r) => [r.ok, r.code, r.field])).toEqual([[false, 'VALIDATION_ERROR', 'labels'], [false, 'VALIDATION_ERROR', 'labels']]);
    for (const fn of Object.values(p)) expect(fn).not.toHaveBeenCalled();
  });

  it('preserved: an insert carrying such a key matches nothing and writes its rows', async () => {
    const p = makeProtocol();
    const summary = await runImport({
      ...baseOpts, p, rows: [{ code: 'T-9', title: 'nine' }], writeMode: 'insert', dryRun: false, matchFields: ['work_object'],
    });
    expect(summary).toMatchObject({ total: 1, ok: 1, created: 1, errors: 0 });
    expect(p.findData).not.toHaveBeenCalled();
  });

  it('preserved: a scalar key still queries one value per field', async () => {
    const p = makeProtocol();
    const summary = await runImport({
      ...baseOpts, p, rows: [{ code: 'T-1', title: 'one' }], writeMode: 'upsert', dryRun: false, matchFields: ['code'],
    });
    expect(summary).toMatchObject({ total: 1, ok: 1, errors: 0 });
    expect(p.findData).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ where: { code: 'T-1' } }) }));
  });
});

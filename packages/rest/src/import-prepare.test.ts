// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Round-trip i18n for import coercion: the localized export and the import
 * template surface *translated* option labels (e.g. 待规划 for `backlog`), so
 * `prepareImportRequest` folds those labels into the field metaMap as matching
 * synonyms — while the authored label and the option code keep working.
 */

import { describe, it, expect } from 'vitest';
import { prepareImportRequest, mergeLocalizedOptionSynonyms } from './import-prepare';
import { matchOption } from '@objectstack/core';
import { buildFieldMetaMap } from './export-format';

const SCHEMA = {
  name: 'task',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    status: {
      name: 'status', type: 'select', label: 'Status',
      options: [
        { label: 'Backlog', value: 'backlog' },
        { label: 'Done', value: 'done' },
      ],
    },
  },
};

/** What `translateMetaItem` returns for SCHEMA under a zh-CN request. */
const localizeSchema = (schema: any) => ({
  ...schema,
  fields: {
    ...schema.fields,
    status: {
      ...schema.fields.status,
      label: '状态',
      options: [
        { label: '待规划', value: 'backlog' },
        { label: '已完成', value: 'done' },
      ],
    },
  },
});

const p = { getMetaItem: async () => ({ type: 'object', name: 'task', item: SCHEMA }) };

describe('mergeLocalizedOptionSynonyms', () => {
  it('appends translated labels as extra options without touching authored ones', () => {
    const metaMap = buildFieldMetaMap(SCHEMA);
    mergeLocalizedOptionSynonyms(metaMap, buildFieldMetaMap(localizeSchema(SCHEMA)));
    const options = metaMap.get('status')!.options!;
    expect(matchOption('待规划', options)).toBe('backlog');
    expect(matchOption('Backlog', options)).toBe('backlog');
    expect(matchOption('backlog', options)).toBe('backlog');
    expect(matchOption('已完成', options)).toBe('done');
  });

  it('is a no-op when the locale leaves labels unchanged (en request)', () => {
    const metaMap = buildFieldMetaMap(SCHEMA);
    const before = metaMap.get('status')!.options!.length;
    mergeLocalizedOptionSynonyms(metaMap, buildFieldMetaMap(SCHEMA));
    expect(metaMap.get('status')!.options!.length).toBe(before);
  });
});

describe('prepareImportRequest — locale-translated option synonyms', () => {
  it('folds the localizeSchema labels into the prepared metaMap', async () => {
    const prep = await prepareImportRequest(
      { format: 'json', rows: [{ title: 'a', status: '待规划' }] },
      { p, objectName: 'task', maxRows: 10, localizeSchema },
    );
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    const options = prep.prepared.metaMap.get('status')!.options!;
    expect(matchOption('待规划', options)).toBe('backlog');
    expect(matchOption('Backlog', options)).toBe('backlog');
  });

  it('without localizeSchema the authored-only matching is unchanged', async () => {
    const prep = await prepareImportRequest(
      { format: 'json', rows: [{ title: 'a', status: 'Backlog' }] },
      { p, objectName: 'task', maxRows: 10 },
    );
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    const options = prep.prepared.metaMap.get('status')!.options!;
    expect(options).toHaveLength(2);
    // The translated label is unknown to the authored options → no match.
    expect(matchOption('待规划', options)).toBeUndefined();
  });

  it('a throwing localizeSchema degrades to authored-only matching', async () => {
    const prep = await prepareImportRequest(
      { format: 'json', rows: [{ title: 'a', status: 'Backlog' }] },
      { p, objectName: 'task', maxRows: 10, localizeSchema: () => { throw new Error('no i18n'); } },
    );
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(matchOption('Backlog', prep.prepared.metaMap.get('status')!.options!)).toBe('backlog');
  });
});

describe('prepareImportRequest — runAutomations default (#2922)', () => {
  const prepWith = async (body: Record<string, unknown>) => {
    const prep = await prepareImportRequest(
      { format: 'json', rows: [{ title: 'a' }], ...body },
      { p, objectName: 'task', maxRows: 10 },
    );
    expect(prep.ok).toBe(true);
    return prep.ok ? prep.prepared.runAutomations : undefined;
  };

  it('defaults to true when the flag is omitted (automations always ran historically)', async () => {
    expect(await prepWith({})).toBe(true);
  });

  it('honours an explicit opt-out', async () => {
    expect(await prepWith({ runAutomations: false })).toBe(false);
  });

  it('treats any non-false value as true', async () => {
    expect(await prepWith({ runAutomations: true })).toBe(true);
    expect(await prepWith({ runAutomations: 'no' })).toBe(true);
  });
});

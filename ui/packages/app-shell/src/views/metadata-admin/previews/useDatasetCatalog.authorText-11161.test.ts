// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11161 — `toCatalogEntry` keeps the author's text a dataset document
 * declares: each member's `label` and the dataset's `description`, beside the
 * dataset `label` it already kept.
 *
 * All four are `I18nLabel` in `@objectstack/spec` — a string, or an inline
 * per-locale map — so each is resolved through the spec's `resolveI18nLabel`
 * in the locale the entry is built for. The dataset label used to go through a
 * hand-rolled reader that took a string or a `{ default }` object only, so a
 * map-valued label (`{ en, 'zh-CN' }`) fell back to the machine name. The one
 * rule now serves all four, and the `{ default }` spelling still resolves
 * (the spec resolver reads the untagged entry itself).
 *
 * What a picker does with the text is pinned beside the two inspectors
 * (`inspectors/datasetPickers.authorText-11161.test.tsx`).
 */

import { describe, it, expect } from 'vitest';
import { toCatalogEntry } from './useDatasetCatalog';

const PIPELINE = {
  name: 'sales_pipeline',
  label: { en: 'Sales pipeline', 'zh-CN': '销售管道' },
  description: { en: 'Open deals by stage', 'zh-CN': '按阶段统计的在途商机' },
  dimensions: [
    { name: 'stage', label: { en: 'Stage', 'zh-CN': '阶段' }, type: 'text' },
    { name: 'owner', label: 'Owner', type: 'lookup' },
    { name: 'region' },
  ],
  measures: [
    { name: 'revenue', label: { en: 'Revenue', 'zh-CN': '收入' }, aggregate: 'sum' },
    { name: 'win_rate', label: 'Win rate', aggregate: 'avg' },
    { name: 'deal_count', aggregate: 'count' },
  ],
};

describe('toCatalogEntry keeps the author-facing text (objectui#11161)', () => {
  it('resolves every map-valued text in en-US', () => {
    const entry = toCatalogEntry(PIPELINE, 'en-US');
    expect(entry?.label).toBe('Sales pipeline');
    expect(entry?.description).toBe('Open deals by stage');
    expect(entry?.dimensions.map((d) => [d.name, d.label])).toEqual([
      ['stage', 'Stage'],
      ['owner', 'Owner'],
      ['region', undefined],
    ]);
    expect(entry?.measures.map((m) => [m.name, m.label, m.aggregate])).toEqual([
      ['revenue', 'Revenue', 'sum'],
      ['win_rate', 'Win rate', 'avg'],
      ['deal_count', undefined, 'count'],
    ]);
  });

  it('resolves the same document in zh-CN; a plain-string label reads as written', () => {
    const entry = toCatalogEntry(PIPELINE, 'zh-CN');
    expect(entry?.label).toBe('销售管道');
    expect(entry?.description).toBe('按阶段统计的在途商机');
    expect(entry?.dimensions.map((d) => d.label)).toEqual(['阶段', 'Owner', undefined]);
    expect(entry?.measures.map((m) => m.label)).toEqual(['收入', 'Win rate', undefined]);
  });

  it('keeps the machine names and the non-text keys unchanged', () => {
    const entry = toCatalogEntry(PIPELINE, 'zh-CN');
    expect(entry?.name).toBe('sales_pipeline');
    expect(entry?.dimensions.map((d) => [d.name, d.type])).toEqual([
      ['stage', 'text'],
      ['owner', 'lookup'],
      ['region', undefined],
    ]);
  });

  it('the dataset label falls back to the name; an undeclared description stays absent', () => {
    const entry = toCatalogEntry({ name: 'bare_metrics', dimensions: [], measures: [] }, 'en-US');
    expect(entry?.label).toBe('bare_metrics');
    expect(entry?.description).toBeUndefined();
  });

  it('blank or non-text values read as undeclared, never as `String()` of the value', () => {
    const entry = toCatalogEntry(
      {
        name: 'odd',
        label: '   ',
        description: 42,
        dimensions: [
          { name: 'a', label: '' },
          { name: 'b', label: ['Nope'] },
          { name: 'c', label: null },
        ],
        measures: [{ name: 'm', label: { en: '  ' } }],
      },
      'en-US',
    );
    expect(entry?.label).toBe('odd');
    expect(entry?.description).toBeUndefined();
    expect(entry?.dimensions.map((d) => d.label)).toEqual([undefined, undefined, undefined]);
    expect(entry?.measures.map((m) => m.label)).toEqual([undefined]);
  });

  it('the untagged `{ default }` spelling the old reader took still resolves', () => {
    const entry = toCatalogEntry(
      { name: 'legacy', label: { default: 'Legacy metrics' }, dimensions: [], measures: [] },
      'zh-CN',
    );
    expect(entry?.label).toBe('Legacy metrics');
  });

  it('a document without a name is still no entry', () => {
    expect(toCatalogEntry({ label: 'Nameless' }, 'en-US')).toBeNull();
  });
});

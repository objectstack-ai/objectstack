// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under zh-CN, the Chart Gallery's KPI subtitles read in Chinese. Those
 * subtitles are dataset measure labels — `task_count` on
 * `showcase_task_metrics`, `project_count` and `budget_sum` on
 * `showcase_project_metrics` — and they arrive in the console on the dataset
 * the analytics route resolves, which it passes through the request locale's
 * translator (`translateMetaItem(req, 'dataset', …)`). So the pin is that
 * translator applied to the app's own datasets with the app's own bundle.
 */
import { describe, expect, it } from 'vitest';
import { translateMetadataDocument, type TranslationBundle } from '@objectstack/spec/system';
import { ShowcaseProjectDataset, ShowcaseTaskDataset } from '../src/ui/datasets/chart-gallery.dataset.js';
import { ShowcaseAccountDataset, ShowcaseInvoiceDataset } from '../src/ui/datasets/revenue-pulse.dataset.js';
import { ShowcaseTranslationBundle } from '../src/system/translations/index.js';

const bundle = ShowcaseTranslationBundle as unknown as TranslationBundle;

type Measure = { name: string; label?: unknown };
const labels = (doc: unknown, names: string[]): Record<string, unknown> => {
  const measures = (doc as { measures: Measure[] }).measures;
  return Object.fromEntries(names.map((n) => [n, measures.find((m) => m.name === n)?.label]));
};

describe('showcase Chart Gallery — KPI measure labels per locale', () => {
  it('serves the three measure labels in Chinese under zh-CN', () => {
    const zh = { locale: 'zh-CN' };
    expect(labels(translateMetadataDocument('dataset', ShowcaseTaskDataset, bundle, zh), ['task_count']))
      .toEqual({ task_count: '任务数' });
    expect(labels(translateMetadataDocument('dataset', ShowcaseProjectDataset, bundle, zh), ['project_count', 'budget_sum']))
      .toEqual({ project_count: '项目数', budget_sum: '总预算' });
  });

  it('leaves the authored English labels in place under en', () => {
    const en = { locale: 'en' };
    expect(labels(translateMetadataDocument('dataset', ShowcaseTaskDataset, bundle, en), ['task_count']))
      .toEqual({ task_count: 'Tasks' });
    expect(labels(translateMetadataDocument('dataset', ShowcaseProjectDataset, bundle, en), ['project_count', 'budget_sum']))
      .toEqual({ project_count: 'Projects', budget_sum: 'Total Budget' });
  });
});

// Every member of the app's four datasets carries a business `description`
// (ADR-0149 D1), and the same translator serves it in Chinese under zh-CN.
// `check:i18n-coverage` holds the translated half as a count; this names the
// member that lost either half.
describe('showcase datasets — every member description, authored and served per locale', () => {
  const datasets = [ShowcaseTaskDataset, ShowcaseProjectDataset, ShowcaseInvoiceDataset, ShowcaseAccountDataset];
  type Member = { name: string; description?: unknown };
  const members = (doc: unknown): Member[] => {
    const d = doc as { dimensions?: Member[]; measures?: Member[] };
    return [...(d.dimensions ?? []), ...(d.measures ?? [])];
  };

  it.each(datasets.map((ds) => [ds.name, ds] as const))('%s', (_name, ds) => {
    const zh = members(translateMetadataDocument('dataset', ds, bundle, { locale: 'zh-CN' }));
    for (const member of members(ds)) {
      expect(typeof member.description, `${ds.name}.${member.name} has no description`).toBe('string');
      const served = zh.find((m) => m.name === member.name)?.description;
      expect(served, `${ds.name}.${member.name} serves no zh-CN description`).toMatch(/[一-鿿]/);
    }
  });
});

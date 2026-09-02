// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#14376, family 3 of 3 — `datasets.<name>.…`.
//
// #14253 registered `translateDataset` in `METADATA_DOCUMENT_TRANSLATORS` (which
// is what `TRANSLATABLE_METADATA_TYPES` is derived from, so the REST boundary
// followed with nothing to remember) and declared the `datasets` group. The
// EXTRACTOR did not walk it, so `os i18n extract` scaffolded nothing and
// `check:i18n-coverage` — which measures against this walk — was blind to the
// family.
//
// A dataset reads like a back-office definition, but a measure label is drawn ON
// THE DASHBOARD, under every metric tile and on every chart axis: the #14253
// report is a dashboard rendering Chinese tile titles with `Untouched > 14 days`
// directly beneath them.
//
// Top level, not under `dashboards`: a dataset is the ONE definition every
// presentation binds to by reference (ADR-0021 D1), so the same measure is drawn
// by N widgets across M dashboards and a dataset no dashboard references would
// otherwise be unaddressable.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

/** Every `datasets.*` path the walker emits, as dot-paths. */
const datasetKeys = (config: any): string[] =>
  collectExpectedEntries(config)
    .filter((e) => e.path[0] === 'datasets')
    .map((e) => e.path.join('.'));

const datasetEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'datasets');

/** The `examples/app-todo` dataset shape, trimmed to two members per group. */
const config = (overrides: Record<string, unknown> = {}) => ({
  datasets: [
    {
      name: 'task_metrics',
      label: 'Task Metrics',
      description: 'Semantic layer for task counts and time-tracking measures',
      object: 'todo_task',
      dimensions: [
        { name: 'status', label: 'Status', field: 'status', type: 'string' },
        { name: 'due_date', label: 'Due Date', field: 'due_date', type: 'date' },
      ],
      measures: [
        { name: 'task_count', label: 'Tasks', aggregate: 'count' },
        { name: 'est_hours', label: 'Estimated Hours', aggregate: 'sum', field: 'estimated_hours' },
      ],
      ...overrides,
    },
  ],
});

describe('the extractor scaffolds a key for every string a dataset draws', () => {
  it('emits label, description and one `label` per dimension and measure', () => {
    expect(datasetKeys(config()).sort()).toEqual([
      'datasets.task_metrics.description',
      'datasets.task_metrics.dimensions.due_date.label',
      'datasets.task_metrics.dimensions.status.label',
      'datasets.task_metrics.label',
      'datasets.task_metrics.measures.est_hours.label',
      'datasets.task_metrics.measures.task_count.label',
    ]);
  });

  it('seeds each entry with the authored literal', () => {
    const entries = datasetEntries(config());
    const measure = entries.find((e) => e.path.join('.') === 'datasets.task_metrics.measures.task_count.label');
    expect(measure?.sourceValue).toBe('Tasks');
    expect(measure?.inline).toBe('Tasks');
    expect(measure?.source).toBe('dataset');
  });

  it('records the key but seeds nothing for a member with no label', () => {
    // No renderer fallback is measured for an unlabelled member, so there is no
    // reader-visible string to seed one from. Recording the key still lets the
    // coverage gate notice a bundle that authors it.
    const entries = datasetEntries(
      config({ measures: [{ name: 'task_count', aggregate: 'count' }] }),
    );
    const measure = entries.find((e) => e.path.includes('task_count'));
    expect(measure).toBeDefined();
    expect(measure?.sourceValue).toBeUndefined();
    expect(measure?.inline).toBeUndefined();
  });

  it('treats an inline locale map as already multilingual (#5728)', () => {
    // `Dataset.label` and each member's `label` are `I18nLabelSchema`, so an
    // author may have written the map form. It is not plain source text: there
    // is nothing to scaffold and nothing to demand, and `translateDataset`
    // leaves such a value intact rather than flattening it to one language.
    const entries = datasetEntries(config({ label: { en: 'Task Metrics', 'zh-CN': '任务指标' } }));
    const label = entries.find((e) => e.path.join('.') === 'datasets.task_metrics.label');
    expect(label).toBeDefined();
    expect(label?.inline).toBeUndefined();
  });

  it('emits no `description` below the dataset', () => {
    // `DatasetDimensionSchema` / `DatasetMeasureSchema` declare none and say so
    // in their own authoring guidance — a `dimensions.<d>.description` key
    // would parse clean and translate nothing.
    const keys = datasetKeys(
      config({ dimensions: [{ name: 'status', label: 'Status', description: 'ignored' }] }),
    );
    expect(keys.some((k) => k.startsWith('datasets.task_metrics.dimensions.') && k.endsWith('.description')))
      .toBe(false);
    expect(keys).toContain('datasets.task_metrics.description');
  });

  it('skips a dataset or member with no `name` — the key it would be addressed by', () => {
    expect(datasetKeys({ datasets: [{ label: 'Nameless' }] })).toEqual([]);
    expect(datasetKeys(config({ measures: [{ label: 'Nameless' }] })).some((k) => k.includes('.measures.')))
      .toBe(false);
  });

  it('emits nothing for a stack with no datasets', () => {
    expect(datasetKeys({ objects: [{ name: 'todo_task' }] })).toEqual([]);
  });
});

describe('the emitted key is the key the schema declares', () => {
  it('`TranslationDataSchema` accepts a bundle written at the extracted paths', () => {
    expect(() =>
      TranslationDataSchema.parse({
        datasets: {
          task_metrics: {
            label: '任务指标',
            description: '任务计数与工时的语义层',
            dimensions: { status: { label: '状态' } },
            measures: { task_count: { label: '任务数' } },
          },
        },
      }),
    ).not.toThrow();
  });

  it('a member `description` is still rejected — the slot did not go open', () => {
    expect(() =>
      TranslationDataSchema.parse({
        datasets: { task_metrics: { measures: { task_count: { label: '任务数', description: 'x' } } } },
      }),
    ).toThrow();
  });
});

describe('coverage', () => {
  const withLocales = () => ({
    ...config(),
    i18n: { supportedLocales: ['en', 'zh-CN'] },
    translations: [
      { 'zh-CN': { datasets: { task_metrics: { measures: { task_count: { label: '任务数' } } } } } },
    ],
  });

  const datasetIssues = (report: { issues: Array<{ key: string; source: string; message: string }> }) =>
    report.issues.filter((i) => i.key.startsWith('datasets.'));

  it('reports the untranslated measure and stays quiet about the translated one', () => {
    const keys = datasetIssues(computeI18nCoverage(withLocales())).map((i) => i.key);
    expect(keys).not.toContain('datasets.task_metrics.measures.task_count.label');
    expect(keys).toContain('datasets.task_metrics.measures.est_hours.label');
    expect(keys).toContain('datasets.task_metrics.dimensions.status.label');
  });

  it('files the finding under its own bucket, so it reports as `i18n/missing-dataset`', () => {
    const issues = datasetIssues(computeI18nCoverage(withLocales()));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.source === 'dataset')).toBe(true);
    expect(issues[0].message.startsWith('Dataset datasets.task_metrics.')).toBe(true);
  });

  it('demands nothing for a member label nobody wrote', () => {
    const report = computeI18nCoverage({
      ...config({ measures: [{ name: 'task_count', aggregate: 'count' }] }),
      i18n: { supportedLocales: ['en', 'zh-CN'] },
    });
    expect(datasetIssues(report).some((i) => i.key.includes('task_count'))).toBe(false);
  });

  it('a project that declares no locales still reports nothing', () => {
    expect(datasetIssues(computeI18nCoverage(config()))).toEqual([]);
  });

  it('`extractTranslations` writes the dataset keys into the skeleton', () => {
    const out = extractTranslations(config(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(zh?.datasets?.task_metrics?.label).toBeDefined();
    expect(zh?.datasets?.task_metrics?.measures?.task_count?.label).toBeDefined();
  });
});

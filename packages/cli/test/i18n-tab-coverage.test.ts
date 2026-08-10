// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#5377 — a list page's filter-preset TAB labels were the surface
// with no key at all. `ViewTabSchema.label` is an `I18nLabelSchema`,
// `ObjectTranslationDataSchema` had no `_tabs` member and (being strict)
// rejected the key a translator invented, and no resolver read one. So the tab
// bar rendered in the source language above a fully localized grid, with no
// authoring workaround anywhere.
//
// ## What the fix is NOT
//
// The issue's headline — an entire tab bar in English — was retracted by the
// reporter on rc.2 (comment 2026-08-05): a tab that carries `view` already
// renders its referenced view's translated label, because the console follows
// the reference into `_views.<view>.label`. That path is preserved here, as the
// SECOND step of `resolveTabLabel`'s chain, and the tests below pin it.
//
// What genuinely had nothing was the **filter-only tab** — `{ name, label,
// filter }` with no `view`. It references nothing to inherit from. That shape
// is legal under `ViewTabSchema` and it is what the showcase authors
// (`task-triage.page.ts`: In Progress / Urgent / In Review / Done).
//
// ## Why `objects.<o>._tabs` and not `pages.<p>.tabs`
//
// A tab is a named filter preset over ONE object's records — "Urgent" names a
// slice of tasks. That is object vocabulary, the same way a saved view's label
// is, and it is what makes the view-reference fallback expressible: both halves
// of the chain live in one object's namespace. `_sections` is the shape
// precedent — those are authored on page components too and are addressed under
// their object.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

/** Every `objects.<o>._tabs.*` path the walker emits, as dot-paths. */
const tabKeys = (config: any) =>
  collectExpectedEntries(config)
    .filter((e) => e.path[2] === '_tabs')
    .map((e) => e.path.join('.'));

const tabEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[2] === '_tabs');

/** A list page whose preset bar is filter-only — the #5377 shape. */
const triagePage = (overrides: Record<string, unknown> = {}) => ({
  name: 'showcase_task_triage',
  label: 'Task Triage',
  type: 'list',
  object: 'showcase_task',
  interfaceConfig: {
    source: 'showcase_task',
    userFilters: {
      element: 'tabs',
      showAllRecords: true,
      tabs: [
        { name: 'in_progress', label: 'In Progress', filter: [{ field: 'status', operator: 'equals', value: 'in_progress' }] },
        { name: 'urgent', label: 'Urgent', icon: 'flame', filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
      ],
    },
  },
  ...overrides,
});

describe('the extractor scaffolds a key for every rendered preset tab', () => {
  it('emits `objects.<o>._tabs.<tab>.label`', () => {
    expect(tabKeys({ pages: [triagePage()] }).sort()).toEqual([
      'objects.showcase_task._tabs.in_progress.label',
      'objects.showcase_task._tabs.urgent.label',
    ]);
  });

  it('seeds the entry with the authored literal, so the skeleton is usable', () => {
    const entries = tabEntries({ pages: [triagePage()] });
    const urgent = entries.find((e) => e.path[3] === 'urgent');
    expect(urgent?.sourceValue).toBe('Urgent');
    expect(urgent?.inline).toBe('Urgent');
    expect(urgent?.objectName).toBe('showcase_task');
  });

  it('falls back to the tab name as the seed, and leaves `inline` unset', () => {
    // A tab with no authored label renders its name. Scaffolding the name keeps
    // the skeleton usable, but coverage must not demand a translation of a
    // string nobody wrote — the same `pushDerived` contract sections use.
    const page = triagePage();
    delete (page.interfaceConfig.userFilters.tabs[1] as Record<string, unknown>).label;
    const urgent = tabEntries({ pages: [page] }).find((e) => e.path[3] === 'urgent');
    expect(urgent?.sourceValue).toBe('urgent');
    expect(urgent?.inline).toBeUndefined();
  });

  it('treats an inline locale map as already multilingual (#5728)', () => {
    // The other authorized label form. It is not plain source text, so there is
    // nothing to scaffold and nothing to demand.
    const page = triagePage();
    (page.interfaceConfig.userFilters.tabs[1] as Record<string, unknown>).label =
      { en: 'Urgent', 'zh-CN': '紧急' };
    const urgent = tabEntries({ pages: [page] }).find((e) => e.path[3] === 'urgent');
    expect(urgent?.inline).toBeUndefined();
  });

  it('keys on `interfaceConfig.source` before the page-level `object`', () => {
    // A list page retargeted at another object filters THAT object's records.
    const keys = tabKeys({ pages: [triagePage({ object: 'crm_lead' })] });
    expect(keys.every((k) => k.startsWith('objects.showcase_task.'))).toBe(true);
  });

  it('falls back to the page `object` when the config declares no source', () => {
    const page = triagePage();
    delete (page.interfaceConfig as Record<string, unknown>).source;
    expect(tabKeys({ pages: [page] })).toContain('objects.showcase_task._tabs.urgent.label');
  });

  it('emits one key per (object, tab) however many pages declare it', () => {
    // Two pages over the same object sharing an "urgent" preset is one string,
    // not two — counting it twice would inflate every coverage report.
    const second = triagePage({ name: 'showcase_task_board' });
    expect(tabKeys({ pages: [triagePage(), second] }).sort()).toEqual([
      'objects.showcase_task._tabs.in_progress.label',
      'objects.showcase_task._tabs.urgent.label',
    ]);
  });

  it('emits nothing for a page with no preset bar', () => {
    expect(tabKeys({ pages: [{ name: 'p', object: 'showcase_task', regions: [] }] })).toEqual([]);
  });

  it('does not scaffold the carrier nothing renders (`ListView.tabs`)', () => {
    // `ViewTabSchema` has two carriers. Only `userFilters.tabs` on a page has a
    // renderer (objectui's `TabFilters`); nothing in either repo reads a list
    // view's own `tabs`. Scaffolding it would fill every bundle with keys no
    // screen can show — and then the coverage gate would demand translations
    // for them.
    const viewWithTabs = {
      name: 'showcase_task',
      object: 'showcase_task',
      listViews: {
        all: { type: 'grid', columns: ['title'], tabs: [{ name: 'urgent', label: 'Urgent' }] },
      },
    };
    expect(tabKeys({ views: [viewWithTabs] })).toEqual([]);
  });
});

describe('the emitted key is the key the schema declares', () => {
  it('`ObjectTranslationDataSchema` accepts a bundle written at the extracted path', () => {
    // Extractor and schema agreeing is the whole contract: a key `os i18n
    // extract` writes that `.strict()` then rejects is worse than no key.
    const keys = tabKeys({ pages: [triagePage()] });
    expect(keys.length).toBeGreaterThan(0);

    const data: Record<string, { label: string }> = {};
    for (const key of keys) data[key.split('.')[3]] = { label: '译' };

    expect(() => ObjectTranslationDataSchema.parse({ _tabs: data })).not.toThrow();
  });

  it('a hand-invented spelling is still rejected — the slot did not go open', () => {
    expect(() => ObjectTranslationDataSchema.parse({
      _tabs: { urgent: { label: '紧急', tooltip: 'x' } },
    })).toThrow();
  });
});

describe('coverage', () => {
  const config = () => ({
    pages: [triagePage()],
    i18n: { supportedLocales: ['en', 'zh-CN'] },
    translations: [
      { 'zh-CN': { objects: { showcase_task: { _tabs: { in_progress: { label: '进行中' } } } } } },
    ],
  });

  const tabIssuePaths = (report: { issues: Array<{ key: string }> }) =>
    report.issues.filter((i) => i.key.includes('._tabs.')).map((i) => i.key);

  it('reports the untranslated tab and stays quiet about the translated one', () => {
    expect(tabIssuePaths(computeI18nCoverage(config())))
      .toEqual(['objects.showcase_task._tabs.urgent.label']);
  });

  it('a project that declares no locales still reports nothing', () => {
    // The opt-in contract every surface in this walker has to keep: a
    // monolingual project must not start failing lint for a feature it never
    // asked for.
    expect(tabIssuePaths(computeI18nCoverage({ pages: [triagePage()] }))).toEqual([]);
  });

  it('`extractTranslations` writes the tab keys into the skeleton', () => {
    const out = extractTranslations({ pages: [triagePage()] }, { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(zh?.objects?.showcase_task?._tabs?.urgent).toBeDefined();
  });
});

describe('the showcase app, walked for real', () => {
  it('picks up `showcase_task_triage`’s four filter-only presets', async () => {
    const { TaskTriagePage } = await import('../../../examples/app-showcase/src/ui/pages/task-triage.page');

    expect(tabKeys({ pages: [TaskTriagePage] }).sort()).toEqual([
      'objects.showcase_task._tabs.done.label',
      'objects.showcase_task._tabs.in_progress.label',
      'objects.showcase_task._tabs.in_review.label',
      'objects.showcase_task._tabs.urgent.label',
    ]);
  }, 60_000);
});

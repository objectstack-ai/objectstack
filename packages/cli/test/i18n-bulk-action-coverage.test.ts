// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#14376, family 1 of 3 — a list view's `bulkActionDefs[]`.
//
// #14253 gave the selection bar its first bundle address: `translateView`
// overlays `objects.<o>._views.<v>.bulkActions.<def>.*` onto the authored defs,
// and `ObjectTranslationDataSchema._views` declares the slot. The EXTRACTOR did
// not walk it, which costs twice over — `os i18n extract` scaffolds nothing, and
// `check:i18n-coverage` measures against what this walk produces, so the family
// contributed nothing to the ratchet at all. This file pins the walk.
//
// A def is authored INSIDE the view and is not an action document, so no other
// pass in the extractor would ever reach it — the same reason the resolver
// overlays it in `translateView` rather than `translateAction`.
//
// ⚠️ `help`, not `helpText`: a bulk param spells its hint `help`
// (`BulkActionParamSchema`), an action param spells the same idea `helpText`.
// The translation face follows the authored key, so a walk that emitted
// `helpText` here would scaffold keys `.strict()` rejects.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

/** Every `…_views.<v>.bulkActions.*` path the walker emits, as dot-paths. */
const bulkKeys = (config: any): string[] =>
  collectExpectedEntries(config)
    .filter((e) => e.path.includes('bulkActions'))
    .map((e) => e.path.join('.'));

const bulkEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path.includes('bulkActions'));

/** The `examples/app-showcase` project view shape: defs with params. */
const defs = (): any[] => [
  {
    name: 'set_labels',
    label: 'Set Labels',
    operation: 'update',
    confirmText: 'Set these labels on every selected project?',
    confirmLabel: 'Apply labels',
    params: [
      {
        name: 'labels',
        label: 'Labels',
        help: 'Applied to every selected project',
        placeholder: 'Pick one or more',
        type: 'select',
        multiple: true,
        options: [
          { label: 'Frontend', value: 'frontend' },
          { label: 'Backend', value: 'backend' },
        ],
      },
    ],
  },
  // A def with no authored copy at all — the bar renders its humanized name.
  { name: 'archive_selected', operation: 'update' },
];

/** An object-nested list view (the `project.object.ts` shape). */
const objectConfig = (overrides: Record<string, unknown> = {}) => ({
  objects: [
    {
      name: 'showcase_project',
      label: 'Project',
      listViews: {
        all: { label: 'All Projects', type: 'grid', bulkActionDefs: defs(), ...overrides },
      },
    },
  ],
});

describe('the extractor scaffolds a key for every string the selection bar draws', () => {
  it('emits `objects.<o>._views.<v>.bulkActions.<def>.*`', () => {
    // `confirmText` / `confirmLabel` are recorded for BOTH defs even though
    // only one authors them: `pushOptional` records an optional key with no
    // seed and no `inline`, exactly as `_views.<v>.description` does one level
    // up, so the coverage gate can still notice a bundle that authors it.
    expect(bulkKeys(objectConfig()).sort()).toEqual([
      'objects.showcase_project._views.all.bulkActions.archive_selected.confirmLabel',
      'objects.showcase_project._views.all.bulkActions.archive_selected.confirmText',
      'objects.showcase_project._views.all.bulkActions.archive_selected.label',
      'objects.showcase_project._views.all.bulkActions.set_labels.confirmLabel',
      'objects.showcase_project._views.all.bulkActions.set_labels.confirmText',
      'objects.showcase_project._views.all.bulkActions.set_labels.label',
      'objects.showcase_project._views.all.bulkActions.set_labels.params.labels.help',
      'objects.showcase_project._views.all.bulkActions.set_labels.params.labels.label',
      'objects.showcase_project._views.all.bulkActions.set_labels.params.labels.placeholder',
    ]);
  });

  it('seeds each entry with the authored literal', () => {
    const entries = bulkEntries(objectConfig());
    const label = entries.find((e) => e.path.at(-1) === 'label' && e.path.includes('set_labels'));
    expect(label?.sourceValue).toBe('Set Labels');
    expect(label?.inline).toBe('Set Labels');
    expect(label?.objectName).toBe('showcase_project');

    const confirm = entries.find((e) => e.path.at(-1) === 'confirmText');
    expect(confirm?.inline).toBe('Set these labels on every selected project?');
  });

  it('records an unauthored optional key without seeding it', () => {
    // The other half of the contract above: the key exists so a bundle that
    // authors it is recognised, but nothing is scaffolded and coverage demands
    // nothing — there is no source string to translate.
    const confirm = bulkEntries(objectConfig())
      .find((e) => e.path.join('.').endsWith('archive_selected.confirmText'));
    expect(confirm).toBeDefined();
    expect(confirm?.sourceValue).toBeUndefined();
    expect(confirm?.inline).toBeUndefined();
  });

  it('falls back to the humanized def name, and leaves `inline` unset', () => {
    // `BulkActionBar` renders `def.label ?? formatActionLabel(def.name)`, so the
    // humanized name is what a reader sees — a usable seed. Coverage must not
    // demand a translation of a string nobody authored.
    const archive = bulkEntries(objectConfig()).find((e) => e.path.includes('archive_selected'));
    expect(archive?.sourceValue).toBe('Archive Selected');
    expect(archive?.inline).toBeUndefined();
  });

  it('falls back to the bare param name for a param with no label', () => {
    // The dialog renders `param.label ?? param.name` — the bare name, exactly
    // the fallback an inline ACTION param is seeded from.
    const config = objectConfig();
    delete config.objects[0].listViews.all.bulkActionDefs[0].params[0].label;
    const param = bulkEntries(config).find((e) => e.path.at(-1) === 'label' && e.path.includes('params'));
    expect(param?.sourceValue).toBe('labels');
    expect(param?.inline).toBeUndefined();
  });

  it('spells a param hint `help`, never `helpText`', () => {
    const keys = bulkKeys(objectConfig());
    expect(keys).toContain('objects.showcase_project._views.all.bulkActions.set_labels.params.labels.help');
    expect(keys.some((k) => k.endsWith('.helpText'))).toBe(false);
  });

  it('does not scaffold the three keys the def surface deliberately excludes', () => {
    // Measured against `BulkActionDefSchema`, not mirrored from the report:
    // a def declares no `successMessage` and no `description`, and the
    // translation face carries `guidance` against per-param `options` instead
    // of a key. Emitting any of them would write keys `.strict()` rejects.
    const config = objectConfig();
    config.objects[0].listViews.all.bulkActionDefs[0].successMessage = 'Done';
    config.objects[0].listViews.all.bulkActionDefs[0].description = 'Sets labels';
    const keys = bulkKeys(config);
    expect(keys.some((k) => k.includes('.successMessage'))).toBe(false);
    expect(keys.some((k) => k.endsWith('.bulkActions.set_labels.description'))).toBe(false);
    expect(keys.some((k) => k.includes('.params.labels.options'))).toBe(false);
  });

  it('emits nothing for a view that declares no defs', () => {
    expect(bulkKeys({ objects: [{ name: 'showcase_project', listViews: { all: { label: 'All' } } }] })).toEqual([]);
  });

  it('skips a def with no `name` — the key it would be addressed by', () => {
    const config = objectConfig();
    config.objects[0].listViews.all.bulkActionDefs = [{ label: 'Nameless', operation: 'update' }];
    expect(bulkKeys(config)).toEqual([]);
  });
});

describe('the def keys share the view key `label` is emitted under', () => {
  it('a container-authored list view keys both under the runtime view identity', () => {
    // `translateBulkActionDefs` is called by `translateView` with
    // `viewTranslationKey(view, objectName)` — the same bare `_views` key the
    // view's own label resolves under. Deriving it twice is the #5164 defect
    // one surface over, so the walk emits both under one root.
    const container = {
      views: [
        {
          list: { data: { object: 'showcase_project' }, type: 'grid', bulkActionDefs: defs() },
          listViews: {},
        },
      ],
    };
    const paths = collectExpectedEntries(container)
      .filter((e) => e.path[1] === 'showcase_project' && e.path[2] === '_views')
      .map((e) => e.path.join('.'));

    const viewKeys = new Set(paths.map((p) => p.split('.')[3]));
    expect(viewKeys.size).toBe(1);
    expect(paths).toContain(`objects.showcase_project._views.${[...viewKeys][0]}.label`);
    expect(paths).toContain(
      `objects.showcase_project._views.${[...viewKeys][0]}.bulkActions.set_labels.label`,
    );
  });
});

describe('the emitted key is the key the schema declares', () => {
  it('`ObjectTranslationDataSchema` accepts a bundle written at the extracted paths', () => {
    // Extractor and schema agreeing is the whole contract: a key `os i18n
    // extract` writes that `.strict()` then rejects is worse than no key.
    expect(() =>
      ObjectTranslationDataSchema.parse({
        _views: {
          all: {
            bulkActions: {
              set_labels: {
                label: '设置标签',
                confirmText: '确认?',
                confirmLabel: '应用',
                params: { labels: { label: '标签', help: '帮助', placeholder: '选择' } },
              },
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it('rejects the neighbouring `helpText` spelling — the slot did not go open', () => {
    expect(() =>
      ObjectTranslationDataSchema.parse({
        _views: { all: { bulkActions: { set_labels: { params: { labels: { helpText: 'x' } } } } } },
      }),
    ).toThrow();
  });
});

describe('coverage', () => {
  const config = () => ({
    ...objectConfig(),
    i18n: { supportedLocales: ['en', 'zh-CN'] },
    translations: [
      {
        'zh-CN': {
          objects: {
            showcase_project: {
              _views: { all: { bulkActions: { set_labels: { label: '设置标签' } } } },
            },
          },
        },
      },
    ],
  });

  const bulkIssues = (report: { issues: Array<{ key: string; source: string }> }) =>
    report.issues.filter((i) => i.key.includes('.bulkActions.'));

  it('reports the untranslated def copy and stays quiet about the translated label', () => {
    const keys = bulkIssues(computeI18nCoverage(config())).map((i) => i.key);
    expect(keys).not.toContain('objects.showcase_project._views.all.bulkActions.set_labels.label');
    expect(keys).toContain('objects.showcase_project._views.all.bulkActions.set_labels.confirmText');
  });

  it('files the finding under the view bucket', () => {
    // A bulk def is view copy: it lives under `_views.<v>` in the schema and is
    // overlaid by `translateView`, so it reports as `i18n/missing-view`.
    expect(bulkIssues(computeI18nCoverage(config())).every((i) => i.source === 'view')).toBe(true);
  });

  it('demands nothing for the def nobody wrote copy for', () => {
    // `archive_selected` has a derived seed and no `inline` — there is no
    // source string to translate, so it is `required/label`'s business if any.
    expect(bulkIssues(computeI18nCoverage(config())).some((i) => i.key.includes('archive_selected')))
      .toBe(false);
  });

  it('a project that declares no locales still reports nothing', () => {
    expect(bulkIssues(computeI18nCoverage(objectConfig()))).toEqual([]);
  });

  it('`extractTranslations` writes the def keys into the skeleton', () => {
    const out = extractTranslations(objectConfig(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(zh?.objects?.showcase_project?._views?.all?.bulkActions?.set_labels).toBeDefined();
    expect(zh?.objects?.showcase_project?._views?.all?.bulkActions?.set_labels?.params?.labels)
      .toBeDefined();
  });
});

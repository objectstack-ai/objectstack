// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Locale overlay for the SPEC-DRIVEN property panels (objectui#7254).
 *
 * ## The gap
 *
 * A curated default inspector renders its config fields by feeding
 * `@objectstack/spec`'s canonical authoring form (`dashboardForm`, …) straight
 * into {@link SchemaForm} — deliberately, so a new prop added to the spec shows
 * up with zero code changes here. Those forms are authored in English
 * (`label: 'Layout'`, `helpText: 'Grid gap (Tailwind units)'`), and nothing on
 * this side translated them. Result: a Chinese author editing a dashboard read
 * a fully Chinese Studio with one all-English panel inside it — section
 * headings, every field label, every hint, including developer vocabulary
 * ("Tailwind units") that means nothing to the person the panel is for.
 *
 * ## Why the platform's own resolver, not a second convention
 *
 * The strings belong to the spec, and the platform already declares how they
 * are translated: `metadataForms.<type>.{label,description}`,
 * `.sections.<section>.{label,description}`,
 * `.fields.<dot.path>.{label,helpText,placeholder}` — resolved by
 * `resolveMetadataFormLabels` from `@objectstack/spec/system`, which the
 * framework's own `/meta/types` handler calls to localize the very same forms
 * before serving them. This module supplies a bundle to THAT function rather
 * than inventing a parallel key scheme, so:
 *
 *  - the section-name derivation, the dot-path field addressing and the
 *    composite sub-field synthesis all come from the producer's implementation
 *    (a hand-rolled walker would have had to re-derive `header.showTitle` and
 *    would have got the section names wrong — they are slugged labels, not the
 *    `label` text);
 *  - when the environment's own translation bundle reaches this surface, it
 *    drops in as a higher-precedence source with no call-site change.
 *
 * ## Scope: `en` + `zh`, matching this console's carve-out
 *
 * These entries live beside `./i18n.ts`'s `engine.*` table and share its
 * documented posture (see that file's header and `packages/i18n/README.md`,
 * "Scope — the `engine.*` carve-out"): the metadata designer ships `en` and
 * `zh`, and the other eight shipped locales render the producer's English.
 * `en` is deliberately ABSENT rather than a copy of the spec's sentences — an
 * English console falls through to the producer's own text instead of reading
 * a duplicate this repo would then have to keep in step by hand (the same rule
 * `tOptional` exists for). So this bundle carries `zh-CN` only.
 *
 * ⚠️ It is an OVERLAY, not a fork: a type the bundle does not name, or a field
 * it does not name, is returned untouched.
 *
 * ⛔ One sharp edge, load-bearing for anyone adding a type here: for a
 * `composite` / `repeater` / `record` field the spec resolver SYNTHESIZES the
 * sub-field list from the bundle's direct children of that path, and
 * `SchemaForm` prefers a declared `fields` array over the schema-derived one.
 * Enumerate ALL of a composite's children or none — naming two of three makes
 * the third disappear from the form.
 *
 * ## The source label travels with the translation (objectui#8231)
 *
 * `SchemaForm`'s machine-name chip answers "the label does not already spell
 * the machine name". That is a question about the field's SOURCE label — the
 * English the spec authored, or its absence — and never about the translated
 * text in front of the reader: `prettify('columns')` can never equal 「列数」, so
 * judging the visible label showed the chip beside every field of a localized
 * panel and hid it beside the same fields in English.
 *
 * Replacing `label` in place is what destroyed that source, so before the spec
 * resolver runs, every field object this overlay hands on is stamped with the
 * label it arrived with, under a module-private symbol. The resolver copies
 * fields with object spread, which carries own symbol keys, so the stamp rides
 * through to `SchemaForm`, which reads it back with `untranslatedFieldLabel`.
 * The symbol, its writer and its reader live in the runtime-import-free leaf
 * `./field-source-label.ts`, whose header says what the stamp is and is not.
 */

import { resolveMetadataFormLabels } from '@objectstack/spec/system';
import type { TranslationBundle } from '@objectstack/spec/system';
import { isZhLocale, type SupportedLocale } from './i18n.js';
import { hasSourceLabel, stampSourceLabel } from './field-source-label.js';

/**
 * zh-CN strings for the spec authoring forms this console renders.
 *
 * Keys follow the platform convention exactly — a section is addressed by its
 * SLUGGED label (`'Grid sizing…'` section labelled `Layout` → `layout`), a
 * field by its dot path from the form root.
 */
const METADATA_FORM_BUNDLE: TranslationBundle = {
  'zh-CN': {
    metadataForms: {
      dashboard: {
        label: '仪表板',
        sections: {
          basics: { label: '基本信息', description: '仪表板的名称与描述。' },
          layout: { label: '布局', description: '栅格尺寸与刷新频率。' },
          widgets: { label: '组件', description: '放在栅格上的卡片与图表。' },
          filters: { label: '筛选', description: '应用到全部组件的默认筛选与全局筛选。' },
          advanced: { label: '高级', description: '无障碍与性能调优。' },
        },
        fields: {
          name: { label: '名称', helpText: 'snake_case 唯一标识' },
          label: { label: '显示名称', helpText: '展示给使用者的名称' },
          description: { label: '描述' },
          columns: { label: '列数', helpText: '栅格列数（默认 12）' },
          // The spec's own hint reaches for developer vocabulary to say this —
          // `Grid gap (Tailwind units)` before 17.4.0, and "Space between
          // widgets, in steps of 0.25rem (4 = 1rem)" since. Either way it names
          // a unit only a developer can act on, so this row says what the author
          // can decide rather than transliterating it (objectui#8785).
          gap: { label: '间距', helpText: '组件之间的间距，数值越大越松' },
          refreshIntervalSeconds: { label: '自动刷新', helpText: '自动刷新间隔（秒），0 表示不自动刷新' },
          header: { label: '页眉', helpText: '页眉设置：标题、描述与操作按钮' },
          // All three children of the `header` composite — see the ⛔ note above.
          'header.showTitle': { label: '显示标题', helpText: '在页眉中显示仪表板名称' },
          'header.showDescription': { label: '显示描述', helpText: '在页眉中显示仪表板描述' },
          'header.actions': { label: '操作按钮', helpText: '显示在页眉里的操作按钮' },
          widgets: { label: '组件', helpText: '仪表板组件，含位置与尺寸' },
          dateRange: { label: '日期范围', helpText: '默认的日期范围选择器' },
          globalFilters: { label: '全局筛选', helpText: '应用到全部组件的筛选条件' },
        },
      },
    },
  },
};

/**
 * The bundle locale an active console locale resolves to, or `undefined` when
 * this overlay has nothing to say (every locale but `zh`), in which case the
 * caller must hand the form through unchanged.
 */
function bundleLocale(locale?: SupportedLocale | string): string | undefined {
  return isZhLocale(locale) ? 'zh-CN' : undefined;
}

/**
 * Overlay `metadataForms.<type>` strings onto a spec authoring form.
 *
 * Returns the SAME object when there is nothing to apply, so a caller can
 * keep memoising on identity.
 */
export function localizeMetadataForm<T extends Record<string, unknown>>(
  form: T | undefined,
  type: string,
  locale?: SupportedLocale | string,
): T | undefined {
  if (!form) return form;
  const target = bundleLocale(locale);
  if (!target) return form;
  if (!METADATA_FORM_BUNDLE[target]?.metadataForms?.[type]) return form;
  const resolved = resolveMetadataFormLabels(withSourceLabels(form), type, METADATA_FORM_BUNDLE, {
    locale: target,
  });
  return stampSynthesized(resolved);
}

type Stamped = Record<PropertyKey, unknown>;

/** Copy `field` (and its declared sub-fields) with its incoming label stamped. */
function stampField(field: unknown): unknown {
  if (!field || typeof field !== 'object') return field;
  const src = field as Stamped;
  const next: Stamped = { ...src };
  stampSourceLabel(next, typeof src.label === 'string' ? src.label : undefined);
  if (Array.isArray(src.fields)) next.fields = src.fields.map(stampField);
  return next;
}

/** Copy `form` with every field of every section/group stamped. Never mutates. */
function withSourceLabels<T extends Record<string, unknown>>(form: T): T {
  const stampSection = (section: unknown): unknown => {
    if (!section || typeof section !== 'object') return section;
    const s = section as Stamped;
    return Array.isArray(s.fields) ? { ...s, fields: s.fields.map(stampField) } : s;
  };
  const next: Stamped = { ...form };
  if (Array.isArray(form.sections)) next.sections = form.sections.map(stampSection);
  if (Array.isArray(form.groups)) next.groups = form.groups.map(stampSection);
  return next as T;
}

/**
 * Stamp the fields the resolver SYNTHESIZED (the bundle-enumerated children of
 * a `composite` / `repeater` / `record`, built fresh from `{ field }`). Every
 * field that arrived was stamped by {@link withSourceLabels} and the resolver's
 * spread kept it, so an unstamped field here was never authored: its source
 * label is `undefined` and its `label` is a translation. Mutates only objects
 * the resolver just created.
 */
function stampSynthesized<T>(form: T): T {
  const visit = (field: unknown): void => {
    if (!field || typeof field !== 'object') return;
    const f = field as Stamped;
    if (!hasSourceLabel(f)) stampSourceLabel(f, undefined);
    if (Array.isArray(f.fields)) f.fields.forEach(visit);
  };
  const root = form as Stamped | undefined;
  for (const key of ['sections', 'groups'] as const) {
    const list = root?.[key];
    if (!Array.isArray(list)) continue;
    for (const section of list) {
      const fields = (section as Stamped | undefined)?.fields;
      if (Array.isArray(fields)) fields.forEach(visit);
    }
  }
  return form;
}

/** Whether this overlay carries anything for `type` at `locale`. Exported for tests. */
export function hasMetadataFormOverlay(type: string, locale?: SupportedLocale | string): boolean {
  const target = bundleLocale(locale);
  if (!target) return false;
  return Boolean(METADATA_FORM_BUNDLE[target]?.metadataForms?.[type]);
}

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
 * `.fields.<dot.path>.{label,helpText,placeholder,options}` — resolved by
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
 *  - when the environment's own `metadataForms` translations reach this
 *    surface, they drop in as a higher-precedence source with no call-site
 *    change. Their channel is `/api/v1/meta/types`, which serves each form
 *    already localized from the environment's bundle: the console's own
 *    translation bundle (`/api/v1/i18n/translations/:locale`) does not carry
 *    the group at all (objectstack#25785 — it was 75 KB of 221 KB on app-crm
 *    zh-CN, read by nothing in the browser). So the higher-precedence source
 *    for a form the SERVER renders is already in place; this overlay is for
 *    the forms this console renders from its own copy of the spec, which no
 *    server answer passes through.
 *
 * ## Scope: `en` + `zh`, matching this console's carve-out
 *
 * These entries live beside `./i18n.ts`'s `engine.*` table and share its
 * documented posture (see that file's header and `packages/i18n/README.md`,
 * "Scope — the Studio designer strings"): the metadata designer ships `en` and
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
// The zh test from the import-free leaf, not `./i18n.ts`: the Pending changes
// sheet reads this overlay from the console's eager graph (`preview/changeKeyLabels.ts`).
import { isZhLocale } from './schema-field-label.js';
import type { SupportedLocale } from './i18n.js';
import { hasSourceLabel, stampSourceLabel } from './field-source-label.js';
import { ZH_CN_SPEC_FORMS } from './metadata-form-zh-cn.js';

/**
 * zh-CN strings for the spec authoring forms this console renders: the
 * platform-worded rows of `./metadata-form-zh-cn.ts` (every
 * `METADATA_FORM_REGISTRY` type; that file says which depth each carries), and
 * the hand-worded `dashboard` rows below.
 *
 * Keys follow the platform convention exactly — a section is addressed by its
 * SLUGGED label (`'Grid sizing…'` section labelled `Layout` → `layout`), a
 * field by its dot path from the form root.
 */
const METADATA_FORM_BUNDLE: TranslationBundle = {
  'zh-CN': {
    metadataForms: {
      ...ZH_CN_SPEC_FORMS,
      dashboard: {
        label: '仪表盘',
        sections: {
          basics: { label: '基本信息', description: '仪表盘的名称与描述。' },
          layout: { label: '布局', description: '栅格尺寸与刷新频率。' },
          widgets: { label: '组件', description: '放在栅格上的卡片与图表。' },
          filters: { label: '筛选', description: '应用到全部组件的默认筛选与全局筛选。' },
          access: { label: '访问权限', description: '谁可以查看此仪表盘。' },
          advanced: { label: '高级', description: '无障碍与性能调优。' },
        },
        fields: {
          name: { label: '名称', helpText: '仪表盘的唯一内部名称：使用小写字母、数字和下划线，以字母开头（例如 sales_overview）。' },
          label: { label: '显示名称', helpText: '使用者看到的仪表盘标题。' },
          description: { label: '描述' },
          columns: { label: '列数', helpText: '组件排布所用的列数，1 到 24。留空时仪表盘会按组件的宽度自动选择。' },
          // The hints of these nine rows are the platform's zh-CN wording
          // (`zh-CN.metadata-forms.generated.ts`), copied when the spec's own
          // hints were rewritten in author language (objectstack#36816). Before
          // that the English gap hint named a unit only a developer can act on
          // (`Grid gap (Tailwind units)`, then "in steps of 0.25rem"), and this
          // row was hand-worded instead of transliterated (objectui#8785).
          gap: { label: '间距', helpText: '组件之间留出的空间。数值越大越松散；留空则使用标准间距。' },
          refreshIntervalSeconds: { label: '自动刷新', helpText: '仪表盘重新加载数据的频率（秒）。留空或填 0 表示不自动刷新。' },
          header: { label: '页眉', helpText: '仪表盘顶部显示的内容：标题、描述和操作按钮。' },
          // All three children of the `header` composite — see the ⛔ note above.
          'header.showTitle': { label: '显示标题', helpText: '在页眉中显示仪表盘名称' },
          'header.showDescription': { label: '显示描述', helpText: '在页眉中显示仪表盘描述' },
          'header.actions': { label: '操作按钮', helpText: '显示在页眉里的操作按钮' },
          widgets: { label: '组件', helpText: '仪表盘上的图表、数字和表格，以及每一项所在的位置。' },
          dateRange: { label: '日期范围', helpText: '打开仪表盘时默认的时间段，以及查看者能否自选日期。' },
          // All three children of the `dateRange` composite — see the ⛔ note above.
          'dateRange.field': { label: '日期字段', helpText: '时间段筛选所依据的日期字段。留空则按创建日期筛选。' },
          'dateRange.defaultRange': {
            label: '默认时间段',
            helpText: '打开仪表盘时显示的时间段。',
            // Option names: the platform pack's map, pinned byte-equal by
            // `metadata-form-option-names.test.ts`.
            options: { today: '今天', yesterday: '昨天', this_week: '本周', last_week: '上周', this_month: '本月', last_month: '上月', next_month: '下月', this_quarter: '本季度', last_quarter: '上季度', next_quarter: '下季度', this_year: '今年', last_year: '去年', last_7_days: '近 7 天', last_30_days: '近 30 天', last_90_days: '近 90 天', next_30_days: '未来 30 天', custom: '自定义…' },
          },
          'dateRange.allowCustomRange': { label: '允许自定义范围', helpText: '允许查看者自己选择开始和结束日期。' },
          globalFilters: { label: '全局筛选', helpText: '查看者可用来一次筛选全部组件，或只筛选你指定组件的筛选条件。' },
          requiredPermissions: { label: '所需权限', helpText: '谁能看此仪表盘：查看者必须持有的能力，列出的每一项都要具备。能力由权限集授予，岗位通过其权限集获得这些能力。留空则所有人都能看到此仪表盘。要给多类人看，请选一个能力并授予每类人的权限集。由服务器强制执行：其他人在列表中看不到此仪表盘，直接打开也会被拒绝。这也适用于你自己：列出你未持有或拼错的能力后，你也将无法再打开此仪表盘。' },
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

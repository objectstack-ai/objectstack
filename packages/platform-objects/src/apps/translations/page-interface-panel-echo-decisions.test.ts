// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 2 — the DECISION LEDGER for the PAGE INTERFACE panel en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record for ONE panel family, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts` and round 1 of this card
// extended in `object-field-editor-panel-echo-decisions.test.ts`: one row per
// string leaf, each carrying its verdict per locale, the reason it was
// reached, and the `en` source it was judged against.
//
// ## The family
//
// The `page` type's Interface panel — `page.fields['interfaceConfig*']` plus
// the `page.sections.interface` heading it sits under. This is the surface an
// author configures a list page on: which object it reads, which columns it
// shows, how end users filter it, what the toolbar offers.
//
//   ⇒ decided here: 15 keys · 30 string leaves · 3 locales = 90 decisions.
//
// Both string leaves of every key are decided, `helpText` included: a panel
// whose field name is Chinese and whose tooltip is English is the same defect
// half fixed.
//
// ## The instrument, with its controls
//
// Census: flatten every `*.metadata-forms.generated.ts` bundle, compare each
// `.label` leaf against `en`. On base 576d5df66, before this change:
//
//   en `.label` leaves                             538
//   POSITIVE CONTROL — labels genuinely translated  473 (zh-CN) · 457 · 457
//   labels echoing `en`                              65 (zh-CN) ·  81 ·  81
//   label keys echoing in ALL THREE locales           65 ⇒ 195 leaves
//
// After: 50 keys / 150 leaves, control 488 · 472 · 472 — echoes down 15 and
// the control up 15, same population, same run. A parser matching too broadly
// cannot produce that agreement.
//
// ## Two controls this panel supplies that the earlier rounds could not
//
// 1. THE AUTHORED TWIN. `interfaceConfig` inlines the view's own surface onto
//    the page — the form's own helpText says "The page IS the view" — and
//    `view.fields.<same key>` is authored in all three locales for nine of the
//    fifteen keys (columns, sort, appearance, userFilters, userActions,
//    addRecord, showRecordCount, and the filter and record vocabulary). So for
//    most of this family the question "is the English right here?" has a
//    recorded answer one panel away, taken by a translator who was looking at
//    the same words.
//
// 2. AN AUTHORED CONTROL INSIDE THE FAMILY. `interfaceConfig.sort` is
//    `type: 'repeater'`, so its two row properties — `interfaceConfig.sort.field`
//    and `.order` — are the one slice of this panel that
//    `repeater-row-properties.test.ts` already derives, and they are the ONLY
//    two leaves under `interfaceConfig` that were already translated
//    (字段 / 排序方向, フィールド / 並び方向, Campo / Dirección). Everything the
//    existing pin could see was fine; everything it could not see was an echo.
//    That is this card's 「no pin sees any of them」 measured on this panel,
//    with the covered slice as its own control.
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf
// is still a byte copy of the source revision. All 30 leaves decided here
// carried one in all three locales; all 43 authored neighbours on the same
// `page` panel (name, label, icon, type, template, variables.*, regions.*,
// isDefault, kind, aria, and the four other section headings) carried none in
// any of them, and neither did the two authored `sort` row properties above.
// `pnpm i18n:extract` dropped the 30 rows per locale for the leaves this round
// translated, so the table now records them as authored — asserted below.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';
import { zhCNGeneratedSourceHashes } from './zh-CN.source-hashes.generated.js';
import { jaJPGeneratedSourceHashes } from './ja-JP.source-hashes.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';

const TRANSLATED_LOCALES: ReadonlyArray<readonly [string, Record<string, any>]> = [
  ['zh-CN', zhCNMetadataForms as Record<string, any>],
  ['ja-JP', jaJPMetadataForms as Record<string, any>],
  ['es-ES', esESMetadataForms as Record<string, any>],
];

const PROVENANCE: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['zh-CN', zhCNGeneratedSourceHashes],
  ['ja-JP', jaJPGeneratedSourceHashes],
  ['es-ES', esESGeneratedSourceHashes],
];

/** `translate` — the echo was an unauthored fill. `echo` — the English IS the rendering. */
type Verdict = 'translate' | 'echo';

interface Decision {
  /** `fields` for a form field, `sections` for a section heading. */
  scope: 'fields' | 'sections';
  /** The bundle key under `page.<scope>`. */
  key: string;
  /** Which string leaf of that entry this row decides. */
  prop: 'label' | 'helpText' | 'description';
  /**
   * The `en` source the verdict was taken against. Held equal to the live
   * bundle, so a reworded source reds this file instead of leaving a decision
   * standing over text nobody judged.
   */
  en: string;
  /** The verdict per translated locale. */
  verdict: Readonly<Record<string, Verdict>>;
  /** Why — recorded for `translate` as much as for `echo`. */
  reason: string;
  /** Required for every `echo` verdict: why the English is right in THAT locale. */
  departures?: Readonly<Record<string, string>>;
}

const ALL_TRANSLATE: Readonly<Record<string, Verdict>> = {
  'zh-CN': 'translate',
  'ja-JP': 'translate',
  'es-ES': 'translate',
};

/**
 * The panel-internal control, cited by the rows whose evidence IS the panel:
 * the leaf held a provenance entry in all three locales while every authored
 * neighbour on the same `page` panel — and the two authored `sort` row
 * properties inside this very family — held none.
 */
const PANEL_CONTROL =
  'Prose, not a term of art. Its neighbours on this same `page` panel (name, label, icon, type, template, variables.*, regions.*, isDefault, kind, aria) are authored in all three locales, and this leaf carried a provenance-table entry in all three while none of them did — which is what an unauthored fill looks like here.';

const DECISIONS: readonly Decision[] = [
  {
    scope: 'sections',
    key: 'interface',
    prop: 'label',
    en: 'Interface (list pages)',
    verdict: ALL_TRANSLATE,
    reason:
      "`Interface` is a product term this panel's OWN authored text keeps in English: page.fields.type.helpText reads \"List / Interface\" untranslated in all three locales, and names Interface again as the place a visualization is set. So the word stays and the parenthetical does not — a partial keep, which is exactly what a wholesale translation and a wholesale echo both get wrong.",
  },
  {
    scope: 'sections',
    key: 'interface',
    prop: 'description',
    en: 'Interface mode (Airtable parity): the page defines its own data surface directly — columns, filters, visualizations and toolbar — no inheriting from a separate view.',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose around two kept tokens. view.sections.end_user_controls.description is the authored precedent for exactly this shape: it keeps `ADR-0047` and `Airtable Interface` in English in all three locales (对标 Airtable / Airtable Interface 互換 / paridad con Airtable Interface) while translating every other word. Same treatment here.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig',
    prop: 'label',
    en: 'Interface Config',
    verdict: ALL_TRANSLATE,
    reason:
      '`Interface` kept for the reason above; `Config` translated, because this corpus renders configuration in every locale — view.sections.kanban.description is 看板专属配置 / カンバン専用のボード設定。/ Configuración de tablero específica de Kanban. Half of this label had an authored answer and half had a kept token; neither half is the whole leaf.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig',
    prop: 'helpText',
    en: 'The page IS the view: source picks the object, columns/filterBy are defined directly here; appearance.allowedVisualizations whitelists renderers (one entry = locked); userActions toggles the toolbar.',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose carrying five literal key names (source, columns, filterBy, appearance.allowedVisualizations, userActions). They stay English on the authored precedent of view.fields.appearance.helpText, which keeps `allowedVisualizations` verbatim in all three locales inside otherwise translated prose — a key an author types is not a word.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.source',
    prop: 'label',
    en: 'Source',
    verdict: ALL_TRANSLATE,
    reason:
      "DECIDED AGAINST both same-string precedents. This catalog answers the bare word `Source` twice, in opposite directions: hook.fields.body.source is 源码 / ソース / Código fuente (source CODE) and sys_metadata.fields.source is 来源 / ソース / Origen (provenance). This leaf is neither — its own helpText says \"Object this page reads from\", the page's data binding. So zh-CN and es-ES depart from BOTH (数据来源 / Origen de datos): 源码 is plainly wrong and a bare 来源 / Origen reads as provenance on a panel that has no provenance. ja-JP keeps ソース, the word both precedents already use and the one that carries the data-source sense unambiguously in Japanese. Per locale, not per string.",
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.source',
    prop: 'helpText',
    en: 'Object this page reads from',
    verdict: ALL_TRANSLATE,
    reason: PANEL_CONTROL,
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.columns',
    prop: 'label',
    en: 'Columns',
    verdict: ALL_TRANSLATE,
    reason:
      'Four authored answers for this exact word, all agreeing: view.fields.columns, dashboard.fields.columns, report.fields.columns and report.fields.blocks.columns all read 列 / 列 / Columnas. A translator who judged the English right here would have had to judge it wrong four times.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.columns',
    prop: 'helpText',
    en: 'Columns to show — defined directly on the page (blank = all object fields)',
    verdict: ALL_TRANSLATE,
    reason:
      'The authored twin is one panel away and says the same thing: view.fields.columns.helpText reads 要展示的列（来自所选对象的字段名）/ 表示する列（選択オブジェクトのフィールド名）/ Columnas que mostrar (nombres de campo del objeto seleccionado). The opening clause is reused verbatim from it.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.filterBy',
    prop: 'label',
    en: 'Filter By',
    verdict: ALL_TRANSLATE,
    reason:
      "No same-string precedent, so the concept's: view.fields.filter is 筛选 / フィルター / Filtro and view.fields.filter.helpText renders \"Filter conditions\" as 筛选条件 / フィルター条件 / Condiciones de filtro. This leaf is the always-on base filter, a condition set rather than the act, so zh-CN and ja-JP take the 条件 form; es-ES takes `Filtrar por`, which keeps the by-clause the English draws and does not collide with `Filtros de usuario` two rows below.",
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.filterBy',
    prop: 'helpText',
    en: 'Always-on base filter for the page — same visual builder as the list toolbar.',
    verdict: ALL_TRANSLATE,
    reason:
      'Its second clause is word-for-word an authored clause: view.fields.filter.helpText already reads 与列表工具栏相同的可视化构建器 / リストツールバーと同じビジュアルビルダー / el mismo constructor visual que la barra de herramientas de la lista. Reused exactly, so the two panels do not describe the same builder in two voices.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.sort',
    prop: 'label',
    en: 'Sort',
    verdict: ALL_TRANSLATE,
    reason:
      'view.fields.sort is authored for this exact word in all three locales — 排序 / 並び替え / Orden. And the two row properties of THIS repeater are already translated (字段 / 排序方向 …), so the column heads under it read as translated text while the repeater itself read English.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.sort',
    prop: 'helpText',
    en: 'Default sort order for the page, defined directly on the page.',
    verdict: ALL_TRANSLATE,
    reason:
      'view.fields.sort.helpText renders "Default sort order" as 默认排序方式 / 既定の並び順 / Orden predeterminado; the remaining clause is ordinary prose and carried the provenance entry the authored neighbours did not.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.levels',
    prop: 'label',
    en: 'Levels',
    verdict: ALL_TRANSLATE,
    reason:
      'No same-string precedent; the vocabulary has one. object.fields.fields.reference.helpText names a tree\'s hierarchy as 层级 / 階層 / jerarquía in all three locales, and permission.fields.rowLevelSecurity renders Level as 级 / レベル / nivel. Hierarchy levels of a tree source ⇒ 层级 / 階層レベル / Niveles.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.levels',
    prop: 'helpText',
    en: 'Hierarchy levels to display (tree-like sources)',
    verdict: ALL_TRANSLATE,
    reason:
      '`tree` here is the SHAPE of the source, not the `tree` field type. object.fields.fields.reference.helpText draws exactly that line and is authored on both sides of it — it keeps the machine token (tree 字段 / tree フィールド / un campo tree) and translates the shape in the same sentence (树 / ツリー / árbol). So this one is translated: 树形数据源 / ツリー状のソース / orígenes de tipo árbol.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.appearance',
    prop: 'label',
    en: 'Appearance',
    verdict: ALL_TRANSLATE,
    reason:
      'view.fields.appearance is authored for this exact word in all three locales — 外观 / 外観 / Apariencia — and it is the same popover of the same settings, inlined onto the page.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.appearance',
    prop: 'helpText',
    en: 'Allowed visualizations (Grid / Kanban / Calendar / …) and description visibility',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose translated, renderer tokens kept. This same `page` panel\'s authored page.fields.type.helpText keeps `grid / kanban / calendar / …` in English in all three locales. The counter-precedent was weighed and rejected: view.sections.kanban.label does render Kanban as 看板配置 / カンバン / Tablero Kanban, but that is a section heading naming one feature, not the list of tokens an author picks `allowedVisualizations` from.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.userFilters',
    prop: 'label',
    en: 'User Filters',
    verdict: ALL_TRANSLATE,
    reason:
      'view.fields.userFilters is authored for this exact string in all three locales — 用户筛选器 / ユーザーフィルター / Filtros de usuario — and 终端用户 is this corpus\'s own word for the end user (view.sections.end_user_controls).',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.userFilters',
    prop: 'helpText',
    en: 'End-user filter bar: None (no bar) / Tabs (named presets) / Dropdown (per-field). None removes the config.',
    verdict: ALL_TRANSLATE,
    reason:
      "DECIDED AGAINST a same-string precedent. view.fields.userFilters.helpText translates its `dropdown / tabs / toggle` (下拉 / 标签页 / 开关), but those are the stored `element` VALUES; `None / Tabs / Dropdown` here are the visible option labels of the `filter-mode` widget, which objectui renders and this catalog holds no key for. Translating them would assert a rendering this package cannot deliver — so they are kept, the way this same panel's authored page.fields.type.helpText keeps the quoted option labels \"List / Interface\". The prose around them is translated.",
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.userActions',
    prop: 'label',
    en: 'User Actions',
    verdict: ALL_TRANSLATE,
    reason:
      'view.fields.userActions is authored for this exact string in all three locales — 用户操作 / ユーザーアクション / Acciones de usuario.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.userActions',
    prop: 'helpText',
    en: 'Toolbar toggles (search, sort, filter, row height)',
    verdict: ALL_TRANSLATE,
    reason:
      'The authored twin names the same four toggles: view.fields.userActions.helpText is 工具栏开关：排序 / 搜索 / 筛选 / 行高 and its ja-JP and es-ES counterparts. Reused with this leaf\'s own order and comma list.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.addRecord',
    prop: 'label',
    en: 'Add Record',
    verdict: ALL_TRANSLATE,
    reason:
      'view.fields.addRecord is authored for this exact string in all three locales — 添加记录 / レコードを追加 / Agregar registro.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.addRecord',
    prop: 'helpText',
    en: 'Add-record entry point',
    verdict: ALL_TRANSLATE,
    reason: PANEL_CONTROL,
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.buttons',
    prop: 'label',
    en: 'Buttons',
    verdict: ALL_TRANSLATE,
    reason:
      'No same-string precedent; the compound has one. dashboard.fields.header.actions renders "Actions" as 操作按钮 / 操作ボタン / Botones de acción, so this corpus already owns 按钮 / ボタン / Botones for a toolbar button and does not leave it in English anywhere.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.buttons',
    prop: 'helpText',
    en: "Toolbar buttons — pick from this object's actions",
    verdict: ALL_TRANSLATE,
    reason:
      '"actions" here is the `action` metadata type, whose own display name is authored in all three locales — action.label is 操作 / アクション / Acción. The leaf is rendered with that word so the sentence points at the type the picker actually offers.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.recordAction',
    prop: 'label',
    en: 'Record Action',
    verdict: ALL_TRANSLATE,
    reason:
      'A compound of two words this corpus answers separately and consistently: action.label is 操作 / アクション / Acción, and Record reads 记录 / レコード / registro wherever it appears (view.fields.addRecord, view.fields.showRecordCount). Neither half has an English rendering anywhere in the catalog.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.recordAction',
    prop: 'helpText',
    en: 'How clicking a record opens its detail',
    verdict: ALL_TRANSLATE,
    reason: PANEL_CONTROL,
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.showRecordCount',
    prop: 'label',
    en: 'Show Record Count',
    verdict: ALL_TRANSLATE,
    reason:
      'view.fields.showRecordCount is authored for this byte-identical English string in all three locales — 显示记录数 / レコード数を表示 / Mostrar recuento de registros. The same toggle, inlined onto the page, read English on one panel and Chinese on the other.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.showRecordCount',
    prop: 'helpText',
    en: 'Show the record count bar',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose built on the term the label above just fixed — 记录数 / レコード数 / recuento de registros — so the tooltip and the field name name the same thing.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.allowPrinting',
    prop: 'label',
    en: 'Allow Printing',
    verdict: ALL_TRANSLATE,
    reason:
      'This corpus has one authored shape for "Allow X" and uses it everywhere: 允许X / Xを許可 / Permitir X (object.fields.fields.sortable.helpText, field.fields.multiple.helpText, sys_oauth_application.fields.scopes). Nothing about printing makes this leaf the exception.',
  },
  {
    scope: 'fields',
    key: 'interfaceConfig.allowPrinting',
    prop: 'helpText',
    en: 'Allow users to print this page',
    verdict: ALL_TRANSLATE,
    reason:
      'The same "Allow users to …" sentence is authored elsewhere in this package: sys_oauth_application.fields.enable_end_session.help reads 允许客户端调用… / …できるようにします / Permitir que el cliente…. Rendered the same way here.',
  },
];

/** The live leaf a decision points at. */
function leafOf(bundle: Record<string, any>, d: Decision): unknown {
  return bundle.page?.[d.scope]?.[d.key]?.[d.prop];
}

/** The provenance-table key for a decided leaf. */
function provenanceKey(d: Decision): string {
  return `metadataForms.page.${d.scope}.${d.key}.${d.prop}`;
}

/**
 * Every `echo` verdict that carries no per-locale departure reason. Exported
 * as a predicate rather than inlined so the suite can prove it FIRES — with
 * every verdict in this round `translate`, asserting it over DECISIONS alone
 * would evaluate nothing.
 */
function undeclaredEchoes(rows: readonly Decision[]): string[] {
  const bad: string[] = [];
  for (const d of rows) {
    for (const [locale, verdict] of Object.entries(d.verdict)) {
      if (verdict !== 'echo') continue;
      if ((d.departures?.[locale] ?? '').length <= 40) bad.push(`${locale} page.${d.scope}.${d.key}.${d.prop}`);
    }
  }
  return bad;
}

/** Every string leaf of the page Interface panel, derived from the `en` catalog. */
function panelLeaves(): Array<{ scope: 'fields' | 'sections'; key: string; prop: string; en: string }> {
  const out: Array<{ scope: 'fields' | 'sections'; key: string; prop: string; en: string }> = [];
  const page = (enMetadataForms as Record<string, any>).page ?? {};
  for (const [key, entry] of Object.entries(page.fields ?? {})) {
    if (key !== 'interfaceConfig' && !key.startsWith('interfaceConfig.')) continue;
    if (!entry || typeof entry !== 'object') continue;
    for (const [prop, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value === 'string') out.push({ scope: 'fields', key, prop, en: value });
    }
  }
  const section = page.sections?.interface;
  if (section && typeof section === 'object') {
    for (const [prop, value] of Object.entries(section as Record<string, unknown>)) {
      if (typeof value === 'string') out.push({ scope: 'sections', key: 'interface', prop, en: value });
    }
  }
  return out;
}

const PANEL_LEAVES = panelLeaves();

describe('#19403 round 2 — the ledger itself (controls before verdicts)', () => {
  it('decides every echoing string leaf of the 15 keys this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 15 keys, 30 leaves, three
    // locales, 90 decisions.
    expect(DECISIONS.length).toBe(30);
    expect(new Set(DECISIONS.map((d) => `${d.scope}.${d.key}`)).size).toBe(15);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(90);
    for (const d of DECISIONS) {
      if (d.scope === 'sections') {
        expect(d.key, 'the only section this round takes is `interface`').toBe('interface');
      } else {
        expect(
          d.key === 'interfaceConfig' || d.key.startsWith('interfaceConfig.'),
          `${d.key} is outside this panel`,
        ).toBe(true);
      }
      expect(Object.keys(d.verdict).sort(), `${d.key}.${d.prop} names every translated locale`).toEqual([
        'es-ES',
        'ja-JP',
        'zh-CN',
      ]);
    }
    // Every decided key is decided on BOTH of its string leaves — a panel
    // whose field name is translated and whose tooltip is not is the same
    // defect half fixed.
    for (const id of new Set(DECISIONS.map((d) => `${d.scope}.${d.key}`))) {
      expect(
        DECISIONS.filter((d) => `${d.scope}.${d.key}` === id)
          .map((d) => d.prop)
          .sort()
          .join('+'),
        `${id} is decided on one leaf only`,
      ).toMatch(/^(description\+label|helpText\+label)$/);
    }
  });

  it('every row is pinned to the live `en` source it was decided against', () => {
    for (const d of DECISIONS) {
      expect(
        leafOf(enMetadataForms as Record<string, any>, d),
        `en page.${d.scope}.${d.key}.${d.prop} moved — re-judge the decision, do not refresh this row`,
      ).toBe(d.en);
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must fail for all 30 rows, or a green
    // verdict run means nothing.
    const flagged = DECISIONS.filter((d) => leafOf(enMetadataForms as Record<string, any>, d) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `page.${d.scope}.${d.key}.${d.prop} records no reason`).toBeGreaterThan(40);
    }
  });

  it('refuses an `echo` verdict that carries no per-locale reason — proved on a synthetic row', () => {
    // Every verdict in this round is `translate`, so the rule has nothing to
    // evaluate over DECISIONS. Assert it there AND prove the predicate fires,
    // or the requirement is a phantom check that deleting would leave green.
    expect(undeclaredEchoes(DECISIONS), 'a declared echo here carries no reason').toEqual([]);

    const synthetic: Decision = {
      scope: 'fields',
      key: 'interfaceConfig.source',
      prop: 'label',
      en: 'Source',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'A synthetic row that exists only to prove this file can refuse an undeclared echo.',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN page.fields.interfaceConfig.source.label']);
    expect(
      undeclaredEchoes([
        {
          ...synthetic,
          departures: {
            'zh-CN': 'A departure reason long enough to satisfy the rule, standing in for a real judgement.',
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe('#19403 round 2 — the catalogs hold what the ledger decided', () => {
  for (const [locale, forms] of TRANSLATED_LOCALES) {
    it(`${locale}: every decided leaf matches its verdict`, () => {
      for (const d of DECISIONS) {
        const id = `${locale} page.${d.scope}.${d.key}.${d.prop}`;
        const value = leafOf(forms, d);
        expect(typeof value, `${id} is missing from the catalog`).toBe('string');
        expect((value as string).length, `${id} is empty`).toBeGreaterThan(0);
        if (d.verdict[locale] === 'translate') {
          expect(value, `${id} reads its en source again — the decision was that this echo is a fill`).not.toBe(d.en);
        } else {
          expect(value, `${id} is a declared echo and must stay the en source`).toBe(d.en);
        }
      }
    });
  }
});

describe('#19403 round 2 — the provenance table agrees these leaves are now authored', () => {
  // A second, independent witness to the same fact, from a table nobody edits
  // by hand. An entry exists exactly while a leaf is still a byte copy of the
  // source revision, so re-filling a decided leaf and re-running the extract
  // brings its row back and reds this block — even in the locale where no
  // second locale exists to disagree with it.
  for (const [locale, table] of PROVENANCE) {
    it(`${locale}: no decided leaf is still recorded as an extractor fill`, () => {
      // Lit — the table really loaded, so "no entry" cannot pass by the import
      // having come back empty.
      expect(Object.keys(table).length, `${locale} provenance table is empty`).toBeGreaterThan(100);
      const stillFilled = DECISIONS.filter((d) => table[provenanceKey(d)] !== undefined).map(
        (d) => `page.${d.scope}.${d.key}.${d.prop}`,
      );
      expect(stillFilled, 'these leaves are still byte copies of their source revision').toEqual([]);
    });

    it(`${locale}: the provenance lookup can say "still a fill"`, () => {
      // Dark. The verdict above is a run of `undefined`s, which is also what a
      // misspelt key shape returns. So take a key the table DOES hold, prove it
      // has the very shape `provenanceKey` composes, and prove the same lookup
      // finds it. Deliberately matched by pattern rather than pinned to a
      // family, so a later round of this card cannot red this control by
      // fixing one.
      // ⚠️ ROUND 9 RE-SEEDED THIS DRAW, for the reason round 7's provenance
      // floor had: a control whose positive half is drawn from the population
      // this card SHRINKS expires by design. It read `metadataForms.` keys only,
      // and round 9 decided the last metadata-form leaf `zh-CN` still read in
      // English, so that slice is now EMPTY there and the draw returned
      // `undefined`. Widened to the WHOLE table — the sibling `objects.` slice is
      // a population this card does not touch, so it cannot empty — and every
      // claim below is unchanged.
      const sample = Object.keys(table).find((k) => /^(metadataForms|objects)\.[^.]+\..+\.[^.]+$/.test(k));
      expect(sample, `${locale} provenance table records no leaf at all`).toBeTruthy();
      const parts = /^(metadataForms|objects)\.([^.]+)\.(.+)\.([^.]+)$/.exec(sample!);
      expect(parts, 'the table key does not decompose').toBeTruthy();
      const [, prefix, type, key, prop] = parts!;
      const rebuilt = `${prefix}.${type}.${key}.${prop}`;
      expect(rebuilt, 'composing the key back from its parts must reproduce it').toBe(sample);
      expect(table[rebuilt], 'the lookup this file performs finds a key the table holds').toBeTruthy();
      // And the composer under test builds exactly that template.
      expect(provenanceKey({ ...DECISIONS[0], scope: 'fields', key: 'k', prop: 'label' })).toBe(
        'metadataForms.page.fields.k.label',
      );
    });
  }
});

describe('#19403 round 2 — the panel population, DERIVED (the pin no census had)', () => {
  it('the derivation reaches this panel, and only this panel', () => {
    // Lit — floors, not exact counts, so a key added to the Interface panel is
    // caught by the echo rule below rather than by a number nobody can
    // interpret. Measured on base 576d5df66: 17 entries, 32 string leaves
    // (the 30 decided here plus the two authored `sort` row properties).
    expect(PANEL_LEAVES.length).toBeGreaterThan(30);
    expect(new Set(PANEL_LEAVES.map((l) => `${l.scope}.${l.key}`)).size).toBeGreaterThan(15);
    for (const key of ['interfaceConfig', 'interfaceConfig.userFilters', 'interfaceConfig.sort.field']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} is on the page Interface panel`,
      ).toBe(true);
    }
    expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === 'interface')).toBe(true);
    // Dark — the derivation is not "every key on the page form". The page's own
    // top-level keys and its other four section headings are outside it.
    for (const key of ['name', 'label', 'regions', 'variables.type', 'aria']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} is not an Interface-panel leaf`,
      ).toBe(false);
    }
    for (const key of ['basics', 'layout', 'advanced', 'data_context']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === key)).toBe(false);
    }
    expect(PANEL_LEAVES.every((l) => ['label', 'helpText', 'description'].includes(l.prop))).toBe(true);
  });

  it('the two `sort` row properties are inside the population and were ALREADY translated', () => {
    // The in-family control. `interfaceConfig.sort` is a `type: 'repeater'`,
    // so `repeater-row-properties.test.ts` already derives these two leaves and
    // already refuses an en-echo on them — and they are the only two leaves
    // under `interfaceConfig` this round did not have to decide. Everything the
    // existing pin could see was fine; everything it could not see was an echo.
    // Asserting it here keeps the claim measured rather than remembered.
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const key of ['interfaceConfig.sort.field', 'interfaceConfig.sort.order']) {
        const en = (enMetadataForms as Record<string, any>).page?.fields?.[key]?.label;
        expect(typeof en, `en page.fields.${key}.label`).toBe('string');
        expect(
          forms.page?.fields?.[key]?.label,
          `${locale} page.fields.${key}.label was translated before this round and must stay so`,
        ).not.toBe(en);
        expect(
          DECISIONS.some((d) => d.key === key),
          `${key} needs no ledger row — it was never an echo`,
        ).toBe(false);
      }
    }
  });

  it('no leaf on this panel reads its `en` source unless the ledger decided it is an echo', () => {
    const undecided: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const { scope, key, prop, en } of PANEL_LEAVES) {
        if (forms.page?.[scope]?.[key]?.[prop] !== en) continue;
        const decided = DECISIONS.find((d) => d.scope === scope && d.key === key && d.prop === prop);
        if (decided?.verdict[locale] === 'echo') continue;
        undecided.push(`${locale} page.${scope}.${key}.${prop} (${JSON.stringify(en)})`);
      }
    }
    expect(
      undecided,
      'these leaves read their en source and no row in this ledger says that is right — decide them, do not refresh anything',
    ).toEqual([]);
  });

  it('the derived predicate can fire — fed the `en` catalog it flags every leaf on the panel', () => {
    // Dark. Same walk, with `en` standing in for a translated catalog: every
    // leaf must come back flagged, or the green above means only that the walk
    // found nothing.
    const flagged = PANEL_LEAVES.filter(
      ({ scope, key, prop, en }) => (enMetadataForms as Record<string, any>).page?.[scope]?.[key]?.[prop] === en,
    );
    expect(flagged.length).toBe(PANEL_LEAVES.length);
  });
});

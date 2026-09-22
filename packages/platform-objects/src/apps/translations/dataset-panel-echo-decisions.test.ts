// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 3 — the DECISION LEDGER for the DATASET panel en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record for ONE panel family, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts`, round 1 of this card extended
// in `object-field-editor-panel-echo-decisions.test.ts` and round 2 extended
// again in `page-interface-panel-echo-decisions.test.ts`: one row per string
// leaf, each carrying its verdict per locale, the reason it was reached, and
// the `en` source it was judged against.
//
// ## The family
//
// The whole `dataset` metadata form — the ADR-0021 analytics semantic-layer
// editor. Its type display pair, its four section headings, and both string
// leaves of its seven non-repeater fields.
//
//   ⇒ decided here: 12 label keys · 24 string leaves · 3 locales = 72 decisions.
//
// Both string leaves of every key are decided, `helpText` included: a panel
// whose field name is Chinese and whose tooltip is English is the same defect
// half fixed.
//
// ## The instrument, with its controls
//
// Census: flatten every `*.metadata-forms.generated.ts` bundle, compare each
// `.label` leaf against `en`. On base 2951c0f8f, before this change:
//
//   en `.label` leaves                             538
//   POSITIVE CONTROL — labels genuinely translated  488 (zh-CN) · 472 · 472
//   labels echoing `en`                              50 (zh-CN) ·  66 ·  66
//   label keys echoing in ALL THREE locales           50 ⇒ 150 leaves
//
// After: 38 keys / 114 leaves, control 500 · 484 · 484 — echoes down 12 and
// the control up 12, same population, same run. A parser matching too broadly
// cannot produce that agreement.
//
// ## Three controls this panel supplies that the earlier rounds could not
//
// 1. THE AUTHORED TWIN INSIDE THE SAME KEY. `dataset.fields.measures` was
//    already authored in all three locales (度量 / メジャー / Medidas, with its
//    helpText) while `dataset.sections.measures` — the heading directly over it
//    — read English, and `dataset.fields.dimensions` read English while its own
//    five row properties were authored. The identical string, on the same
//    panel, rendered one way and echoed the other: an echo cannot be the
//    deliberate rendering when the same word is rendered beside it.
//
// 2. THE SIBLING EDITOR. `datasetForm`'s own docblock says it "Mirrors
//    reportForm — the sibling analytics editor", and `report` is authored in
//    all three locales for the same identity fields, the same section shape and
//    the same semantic-layer vocabulary. So most of this family has a recorded
//    answer one panel away, taken by a translator looking at the same words.
//
// 3. THE REPEATER BLIND SPOT, MEASURED FROM BOTH SIDES. `dataset` is one of the
//    types `repeater-row-properties.test.ts` already derives — 13 row
//    properties, from the two enumerated repeaters on this panel — and every
//    one of those 13 was ALREADY translated, while NONE of the 24 leaves
//    decided here is inside that derivation. Round 1 measured the `record`
//    blind spot and round 2 the `composite` one; this is a third shape: the
//    repeater is covered and its own two string leaves are not, because the
//    pin walks a repeater's CHILDREN and never the repeater itself. Both
//    halves are asserted below.
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf
// is still a byte copy of the source revision. All 24 leaves decided here
// carried one in all three locales — 24 rows under `metadataForms.dataset` per
// locale, and exactly 24 — while all 15 authored neighbours in the same
// `dataset` block (measures.label, measures.helpText and the thirteen repeater
// row properties) carried none in any of them. `pnpm i18n:extract` dropped the
// 24 rows per locale for the leaves this round translated, so the table now
// records them as authored — asserted below.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { datasetForm } from '@objectstack/spec/ui';

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
  /**
   * `type` for the metadata type's own display pair, `fields` for a form
   * field, `sections` for a section heading.
   */
  scope: 'type' | 'fields' | 'sections';
  /** The bundle key under `dataset.<scope>` (`dataset` itself for `type`). */
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

const DECISIONS: readonly Decision[] = [
  {
    scope: 'type',
    key: 'dataset',
    prop: 'label',
    en: 'Dataset',
    verdict: ALL_TRANSLATE,
    reason:
      'Three authored precedents answer this exact word identically — report.fields.dataset.label, report.fields.blocks.dataset.label and dashboard.fields.widgets.dataset.label all read 数据集 / データセット / Conjunto de datos. The metadata type own display name was the one leaf left in English while every panel that REFERS to a dataset already names it in the author language; being the type name is not a reason to be the exception.',
  },
  {
    scope: 'type',
    key: 'dataset',
    prop: 'description',
    en: 'Analytics semantic layer — dimensions & measures',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose over three terms this catalog has already answered, in a sentence about this very object: report.fields.dataset.helpText renders `semantic layer` as 语义层 / セマンティックレイヤー / capa semántica and `measures/dimensions` as 度量/维度, メジャー/ディメンション, medidas/dimensiones. The vocabulary was not invented here, it was taken from the sibling editor that consumes this type.',
  },
  {
    scope: 'sections',
    key: 'basics',
    prop: 'label',
    en: 'Basics',
    verdict: ALL_TRANSLATE,
    reason:
      'Eleven authored answers for this exact word in this catalog (object, field, view, page, dashboard, app, action, report, flow, tool, skill), every one of them 基础信息 / 基本 / Aspectos básicos — and `dataset` was the twelfth and the only echo. A translator who judged the English right here would have had to judge it wrong eleven times.',
  },
  {
    scope: 'sections',
    key: 'basics',
    prop: 'description',
    en: 'Dataset identity.',
    verdict: ALL_TRANSLATE,
    reason:
      'report.sections.basics.description — the sibling analytics editor this form docblock says it mirrors — answers the same sentence shape: "Identity and report type." is 标识与报表类型 / ID とレポートタイプ。/ Identidad y tipo de informe. Rendered the same way, and the trailing stop follows this catalog measured style: of the 67 genuinely-translated section descriptions, zh-CN drops it in 56 while ja-JP and es-ES keep it in all 67.',
  },
  {
    scope: 'sections',
    key: 'source',
    prop: 'label',
    en: 'Source',
    verdict: ALL_TRANSLATE,
    reason:
      'DECIDED AGAINST its precedents, per locale. This catalog answers the bare word `Source` in three directions: hook.fields.body.source is 源码 / ソース / Código fuente (source CODE), sys_metadata.fields.source is 来源 / ソース / Origen (provenance), and page.fields.interfaceConfig.source is 数据来源 / ソース / Origen de datos (a data binding, decided one round earlier on this same card). This section holds the base object, the joins and the intrinsic scope, so it is the third sense and neither of the first two: 源码 is plainly wrong, and a bare 来源 / Origen reads as provenance on a panel that records none. zh-CN and es-ES therefore depart from two of the three precedents; ja-JP keeps ソース, which all three precedents already use and which carries the data-source sense unambiguously in Japanese. Per locale, not per string.',
  },
  {
    scope: 'sections',
    key: 'source',
    prop: 'description',
    en: 'The base object, the relationships to join, and the dataset’s intrinsic scope. Joins are derived from the object graph — pick relationship (lookup / master_detail) names, never write an ON clause.',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose around machine tokens. `lookup` and `master_detail` are FieldType enum values an author types, and this catalog keeps exactly those tokens English inside translated prose: object.fields.fields.reference.helpText keeps `tree` and `lookup` verbatim in all three locales, field.fields.multiple.helpText keeps `select/lookup`. `ON` is the SQL keyword the sentence tells the author NOT to write, so rendering it as a word would destroy the instruction. Everything else is translated.',
  },
  {
    scope: 'sections',
    key: 'dimensions',
    prop: 'label',
    en: 'Dimensions',
    verdict: ALL_TRANSLATE,
    reason:
      'dashboard.fields.widgets.dimensions.label is the authored answer for this exact word — 维度 / ディメンション / Dimensiones — and it names the same semantic-layer concept, because a dashboard widget dimensions ARE a dataset dimensions. The in-family evidence agrees: every row property under dataset.fields.dimensions was already authored while this heading over them was not.',
  },
  {
    scope: 'sections',
    key: 'dimensions',
    prop: 'description',
    en: 'Groupable axes. Use a base field, or `relationship.field` (e.g. account.region) for a relationship included above.',
    verdict: ALL_TRANSLATE,
    reason:
      '`relationship.field` is the literal shape an author types into a dimension field, and `account.region` is its worked example; both stay English on the authored precedent of view.fields.appearance.helpText, which keeps `allowedVisualizations` verbatim in all three locales inside otherwise translated prose. A key an author types is not a word.',
  },
  {
    scope: 'sections',
    key: 'measures',
    prop: 'label',
    en: 'Measures',
    verdict: ALL_TRANSLATE,
    reason:
      'The strongest control this family supplies. dataset.fields.measures.label — the field this very section wraps, one entry down the same panel — was ALREADY authored 度量 / メジャー / Medidas while the section heading over it read English. Same word, same panel, one authored and one filled: an echo cannot be the deliberate rendering when the identical string is rendered otherwise beside it.',
  },
  {
    scope: 'sections',
    key: 'measures',
    prop: 'description',
    en: 'Aggregatable values defined once and referenced by name. A measure is sum/avg/count/… of a field; a derived measure combines other measures (ratio/sum/difference/product). Measure-scoped filters and derived ops are edited per-row in the dataset designer.',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose naming two STRICT ENUMS legal values, checked against the schema BEFORE a word was translated. `sum/avg/count/…` are AggregationFunction (packages/spec/src/data/query.zod.ts) and `ratio/sum/difference/product` are DerivedMeasureOp (packages/spec/src/ui/dataset.zod.ts), both z.enum inside a strictObject: rendering them as words would tell an author in their own language to write a token the schema refuses — the inverse defect round 2 of this card found and filed. They stay English, on this catalog own authored precedent for the shape: report.fields.type.helpText keeps `tabular/summary/matrix/joined` verbatim in all three locales. The surrounding prose is translated.',
  },
  {
    scope: 'fields',
    key: 'name',
    prop: 'label',
    en: 'Name',
    verdict: ALL_TRANSLATE,
    reason:
      'Twenty authored answers for this exact word in this catalog, all 名称 / 名前 / Nombre — two of them INSIDE this family (dataset.fields.dimensions.name.label and dataset.fields.measures.name.label, the repeater row properties the #17508 pin already covers). The panel own row headers were translated while the field above them was not.',
  },
  {
    scope: 'fields',
    key: 'name',
    prop: 'helpText',
    en: 'snake_case unique identifier',
    verdict: ALL_TRANSLATE,
    reason:
      'An exact-string authored precedent, byte for byte: dashboard.fields.name.helpText and report.fields.name.helpText carry the same English source and read snake_case 唯一标识符 / snake_case の一意識別子 / Identificador único snake_case. `snake_case` itself stays, as it does in both precedents — it names a spelling convention, not a word.',
  },
  {
    scope: 'fields',
    key: 'label',
    prop: 'label',
    en: 'Label',
    verdict: ALL_TRANSLATE,
    reason:
      'Seventeen authored answers, whose dominant reading for a `label` field meaning the display name is 显示名称 / 表示名 / Etiqueta — including the two in-family row properties dataset.fields.dimensions.label.label and dataset.fields.measures.label.label. The one divergent precedent, dashboard.fields.header.actions.label.label (标签 / ラベル), is a button caption rather than a display name; this leaf is the display name, and its own helpText says so.',
  },
  {
    scope: 'fields',
    key: 'label',
    prop: 'helpText',
    en: 'Display name',
    verdict: ALL_TRANSLATE,
    reason:
      'Exact-string authored precedent dashboard.fields.label.helpText: 显示名 / 表示名 / Nombre mostrado. Checked rather than assumed that ja-JP renders this leaf and its `label` sibling with the same 表示名 — the authored precedent pair does exactly that, so the repetition IS the answer a translator gave and not a copy-paste here.',
  },
  {
    scope: 'fields',
    key: 'description',
    prop: 'label',
    en: 'Description',
    verdict: ALL_TRANSLATE,
    reason:
      'Twenty authored answers for this exact word, all 描述 / 説明 / Descripción, across object, field, hook, view, page, dashboard, app, report, flow, email_template, position, tool and skill. Nothing distinguishes a dataset description from any of them.',
  },
  {
    scope: 'fields',
    key: 'description',
    prop: 'helpText',
    en: 'What this dataset measures',
    verdict: ALL_TRANSLATE,
    reason:
      'The sentence shape is authored twice here — flow.fields.description.helpText "What this flow does" is 此流程做什么 / このフローの処理内容 / Qué hace este flujo, and skill has 此技能的作用 / このスキルの処理内容 / Qué hace esta skill. Only the verb changes, and "measures" is the dataset vocabulary already fixed by the type description row above.',
  },
  {
    scope: 'fields',
    key: 'object',
    prop: 'label',
    en: 'Object',
    verdict: ALL_TRANSLATE,
    reason:
      'Five authored answers for this exact word — object.label, hook.fields.object.label, page.fields.object.label, dashboard.fields.globalFilters.object.label and object.fields.fields.summaryOperations.object.label — all 对象 / オブジェクト / Objeto. field.fields.summaryOperations.object.label is a sixth occurrence and is itself an undecided echo belonging to the `field` family a later round takes: recorded here, deliberately NOT counted as evidence.',
  },
  {
    scope: 'fields',
    key: 'object',
    prop: 'helpText',
    en: 'Base object — the FROM',
    verdict: ALL_TRANSLATE,
    reason:
      '`FROM` is the SQL clause this sentence equates the field to — a keyword, not a word, in the same vocabulary as the `ON` clause the section description tells the author not to write. Kept English on that reasoning; the rest rendered.',
  },
  {
    scope: 'fields',
    key: 'include',
    prop: 'label',
    en: 'Include',
    verdict: ALL_TRANSLATE,
    reason:
      'THE ONE LEAF IN THIS FAMILY WITH NO SAME-STRING PRECEDENT anywhere in either catalog, so it is decided from its own helpText rather than from the corpus. `Include` alone answers "include what?" with nothing, on a panel whose neighbouring labels (Object, Filter, Dimensions, Measures) all name their content — so the rendering names it, in this catalog own authored words for the concept: 关联 (report.sections.joined_blocks.label is 关联对象), 関係 (field.fields.summaryOperations.helpText renders parent-child relationships as 親子関係) and relación (the same leaf es-ES reads relaciones padre-hijo). Recorded as an EXPANSION rather than a literal rendering, because it is one.',
  },
  {
    scope: 'fields',
    key: 'include',
    prop: 'helpText',
    en: 'Relationship (lookup / master_detail) field names to join — enables `relationship.field` dimensions/measures (e.g. include "account" → group by account.region)',
    verdict: ALL_TRANSLATE,
    reason:
      'The same token discipline as the two section descriptions: `lookup / master_detail`, `relationship.field`, the literal example value "account" and the path `account.region` all stay English because an author types them. `include` inside the example is the spec key and not the English verb, so it stays too — a distinction this leaf would lose if the label verb and the key were rendered together.',
  },
  {
    scope: 'fields',
    key: 'filter',
    prop: 'label',
    en: 'Filter',
    verdict: ALL_TRANSLATE,
    reason:
      'Three authored answers — view.fields.filter.label, dashboard.fields.widgets.filter.label, and dataset.fields.measures.filter.label INSIDE this family — all 筛选 / フィルター / Filtro. The measure-scoped filter one entry down was authored while the dataset-scoped filter above it was not.',
  },
  {
    scope: 'fields',
    key: 'filter',
    prop: 'helpText',
    en: 'Intrinsic scope filter (e.g. exclude soft-deleted records), ANDed into every query',
    verdict: ALL_TRANSLATE,
    reason:
      '`AND` is the boolean operator this sentence describes the filter being composed with, and this catalog spells it as an operator in English elsewhere (report.fields.runtimeFilter.helpText "ANDed at query time", field.fields.relatedListFilter.helpText "AND-composed"). Kept; the rest rendered, with "soft-deleted records" taking each locale own term for a logical delete.',
  },
  {
    scope: 'fields',
    key: 'dimensions',
    prop: 'label',
    en: 'Dimensions',
    verdict: ALL_TRANSLATE,
    reason:
      'The same authored answer as the section heading above it (dashboard.fields.widgets.dimensions.label), with the in-family evidence read from the other side: this field own five row properties were authored in all three locales while the field label was not — and the pin that covers those row properties cannot see this leaf, which the coverage assertions below measure rather than assert.',
  },
  {
    scope: 'fields',
    key: 'dimensions',
    prop: 'helpText',
    en: 'Each: name (referenced by presentations), field, type, and — for dates — a default bucketing granularity',
    verdict: ALL_TRANSLATE,
    reason:
      'The in-family sentence template, authored: dataset.fields.measures.helpText — the sibling repeater on the same panel — reads "Each: name, aggregate, field (optional for count), and display format/currency" and is rendered 每个度量：… / 各メジャー：… / Cada medida: …, keeping `count` as the enum token. This leaf is the same "Each: …" construction for dimensions and is rendered in the same shape, down to the full-width colon and enumeration comma in zh-CN and ja-JP.',
  },
];

/** The live leaf a decision points at. */
function leafOf(bundle: Record<string, any>, d: Decision): unknown {
  const dataset = bundle.dataset;
  return d.scope === 'type' ? dataset?.[d.prop] : dataset?.[d.scope]?.[d.key]?.[d.prop];
}

/** The provenance-table key for a decided leaf. */
function provenanceKey(d: Decision): string {
  return d.scope === 'type'
    ? `metadataForms.dataset.${d.prop}`
    : `metadataForms.dataset.${d.scope}.${d.key}.${d.prop}`;
}

/** The dotted id a decision is reported under. */
function idOf(d: Decision): string {
  return d.scope === 'type' ? `dataset.${d.prop}` : `dataset.${d.scope}.${d.key}.${d.prop}`;
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
      if ((d.departures?.[locale] ?? '').length <= 40) bad.push(`${locale} ${idOf(d)}`);
    }
  }
  return bad;
}

interface PanelLeaf {
  scope: 'type' | 'fields' | 'sections';
  key: string;
  prop: string;
  en: string;
}

/** Every string leaf of the `dataset` panel, DERIVED from the `en` catalog. */
function panelLeaves(): PanelLeaf[] {
  const out: PanelLeaf[] = [];
  const dataset = (enMetadataForms as Record<string, any>).dataset ?? {};
  for (const [prop, value] of Object.entries(dataset)) {
    if (typeof value === 'string') out.push({ scope: 'type', key: 'dataset', prop, en: value });
  }
  for (const scope of ['fields', 'sections'] as const) {
    for (const [key, entry] of Object.entries(dataset[scope] ?? {})) {
      if (!entry || typeof entry !== 'object') continue;
      for (const [prop, value] of Object.entries(entry as Record<string, unknown>)) {
        if (typeof value === 'string') out.push({ scope, key, prop, en: value });
      }
    }
  }
  return out;
}

const PANEL_LEAVES = panelLeaves();

function liveLeaf(bundle: Record<string, any>, l: PanelLeaf): unknown {
  const dataset = bundle.dataset;
  return l.scope === 'type' ? dataset?.[l.prop] : dataset?.[l.scope]?.[l.key]?.[l.prop];
}

/**
 * The row properties `repeater-row-properties.test.ts` derives for `dataset`,
 * re-derived here by the same rule (a `type: 'repeater'` field that enumerates
 * `fields`), so the two halves of its blind spot can be measured rather than
 * remembered.
 */
function datasetRowProperties(): string[] {
  const out: string[] = [];
  const walk = (fields: any[] | undefined, prefix = ''): void => {
    for (const f of fields ?? []) {
      if (!f || typeof f !== 'object' || !f.field) continue;
      const path = prefix ? `${prefix}.${f.field}` : String(f.field);
      if (f.type === 'repeater' && Array.isArray(f.fields)) {
        for (const child of f.fields) if (child?.field) out.push(`${path}.${child.field}`);
      }
      if (Array.isArray(f.fields)) walk(f.fields, path);
    }
  };
  walk(((datasetForm as any).sections ?? []).flatMap((s: any) => s.fields ?? []));
  return out;
}

const ROW_PROPERTIES = datasetRowProperties();

describe('#19403 round 3 — the ledger itself (controls before verdicts)', () => {
  it('decides every echoing string leaf of the 12 keys this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 12 label keys, 24 leaves, three
    // locales, 72 decisions.
    expect(DECISIONS.length).toBe(24);
    expect(new Set(DECISIONS.map((d) => `${d.scope}.${d.key}`)).size).toBe(12);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(72);
    for (const d of DECISIONS) {
      if (d.scope === 'type') {
        expect(d.key, 'a type-scoped row is the dataset display pair').toBe('dataset');
      }
      expect(Object.keys(d.verdict).sort(), `${idOf(d)} names every translated locale`).toEqual([
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
        `en ${idOf(d)} moved — re-judge the decision, do not refresh this row`,
      ).toBe(d.en);
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must fail for all 24 rows, or a green
    // verdict run means nothing.
    const flagged = DECISIONS.filter((d) => leafOf(enMetadataForms as Record<string, any>, d) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `${idOf(d)} records no reason`).toBeGreaterThan(40);
    }
  });

  it('refuses an `echo` verdict that carries no per-locale reason — proved on a synthetic row', () => {
    // Every verdict in this round is `translate`, so the rule has nothing to
    // evaluate over DECISIONS. Assert it there AND prove the predicate fires,
    // or the requirement is a phantom check that deleting would leave green.
    expect(undeclaredEchoes(DECISIONS), 'a declared echo here carries no reason').toEqual([]);

    const synthetic: Decision = {
      scope: 'sections',
      key: 'source',
      prop: 'label',
      en: 'Source',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'A synthetic row that exists only to prove this file can refuse an undeclared echo.',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN dataset.sections.source.label']);
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

describe('#19403 round 3 — the catalogs hold what the ledger decided', () => {
  for (const [locale, forms] of TRANSLATED_LOCALES) {
    it(`${locale}: every decided leaf matches its verdict`, () => {
      for (const d of DECISIONS) {
        const id = `${locale} ${idOf(d)}`;
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

describe('#19403 round 3 — the provenance table agrees these leaves are now authored', () => {
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
      const stillFilled = DECISIONS.filter((d) => table[provenanceKey(d)] !== undefined).map(idOf);
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
      expect(`${prefix}.${type}.${key}.${prop}`, 'composing the key back must reproduce it').toBe(sample);
      expect(table[sample!], 'the lookup this file performs finds a key the table holds').toBeTruthy();
      // And the composer under test builds exactly those two templates.
      expect(provenanceKey({ ...DECISIONS[0], scope: 'fields', key: 'k', prop: 'label' })).toBe(
        'metadataForms.dataset.fields.k.label',
      );
      expect(provenanceKey({ ...DECISIONS[0], scope: 'type', key: 'dataset', prop: 'label' })).toBe(
        'metadataForms.dataset.label',
      );
    });
  }
});

describe('#19403 round 3 — the panel population, DERIVED (the pin no census had)', () => {
  it('the derivation reaches this panel, and only this panel', () => {
    // Lit — floors, not exact counts, so a key added to the dataset form is
    // caught by the echo rule below rather than by a number nobody can
    // interpret. Measured on base 2951c0f8f: 24 entries, 39 string leaves (the
    // 24 decided here plus the 15 already-authored neighbours).
    expect(PANEL_LEAVES.length).toBeGreaterThan(35);
    expect(new Set(PANEL_LEAVES.map((l) => `${l.scope}.${l.key}`)).size).toBeGreaterThan(20);
    for (const key of ['name', 'include', 'dimensions', 'measures', 'dimensions.dateGranularity']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} is on the dataset panel`,
      ).toBe(true);
    }
    for (const key of ['basics', 'source', 'dimensions', 'measures']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === key)).toBe(true);
    }
    expect(PANEL_LEAVES.some((l) => l.scope === 'type' && l.prop === 'label')).toBe(true);
    expect(PANEL_LEAVES.some((l) => l.scope === 'type' && l.prop === 'description')).toBe(true);
    // Dark — the derivation is the `dataset` entry and nothing else. These keys
    // exist in the catalog on OTHER types, so a walk that read the whole bundle
    // would pick them up.
    for (const key of ['interfaceConfig', 'drilldown', 'runtimeFilter', 'retryPolicy', 'validations']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} belongs to another type and is not a dataset leaf`,
      ).toBe(false);
    }
    for (const key of ['dataset_binding', 'joined_blocks', 'interface']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === key)).toBe(false);
    }
    expect(PANEL_LEAVES.every((l) => ['label', 'helpText', 'description'].includes(l.prop))).toBe(true);
  });

  it('no leaf on this panel reads its `en` source unless the ledger decided it is an echo', () => {
    const undecided: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const leaf of PANEL_LEAVES) {
        if (liveLeaf(forms, leaf) !== leaf.en) continue;
        const decided = DECISIONS.find(
          (d) => d.scope === leaf.scope && d.key === leaf.key && d.prop === leaf.prop,
        );
        if (decided?.verdict[locale] === 'echo') continue;
        const id = leaf.scope === 'type' ? `dataset.${leaf.prop}` : `dataset.${leaf.scope}.${leaf.key}.${leaf.prop}`;
        undecided.push(`${locale} ${id} (${JSON.stringify(leaf.en)})`);
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
      (l) => liveLeaf(enMetadataForms as Record<string, any>, l) === l.en,
    );
    expect(flagged.length).toBe(PANEL_LEAVES.length);
  });
});

describe('#19403 round 3 — the repeater blind spot, measured from BOTH sides', () => {
  it('what the existing pin CAN see on this panel was already translated — the covered slice is its own control', () => {
    // `repeater-row-properties.test.ts` derives a row property for every child
    // of a `type: 'repeater'` field. On this form that is dimensions.* (5) and
    // measures.* (8) — 13 leaves, and every one of them carried its own text in
    // all three locales before this round. Everything the existing pin could
    // see was fine.
    expect(ROW_PROPERTIES.length).toBeGreaterThanOrEqual(13);
    expect(ROW_PROPERTIES).toContain('dimensions.dateGranularity');
    expect(ROW_PROPERTIES).toContain('measures.derived');
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const key of ROW_PROPERTIES) {
        const en = (enMetadataForms as Record<string, any>).dataset?.fields?.[key]?.label;
        expect(typeof en, `en dataset.fields.${key}.label`).toBe('string');
        expect(
          forms.dataset?.fields?.[key]?.label,
          `${locale} dataset.fields.${key}.label was translated before this round and must stay so`,
        ).not.toBe(en);
      }
    }
  });

  it('what it CANNOT see is every leaf this round decided — including the repeaters own two', () => {
    // The blind spot, a third shape after round 1 (`record`) and round 2
    // (`composite`): here the repeater IS covered and its own string leaves are
    // not, because the derivation walks a repeater CHILDREN and never the
    // repeater itself. `dataset.fields.dimensions.label` and `.helpText` sit
    // directly above thirteen covered row properties and no pin saw them.
    const covered = new Set(ROW_PROPERTIES);
    const decidedInside = DECISIONS.filter((d) => d.scope === 'fields' && covered.has(d.key)).map(idOf);
    expect(decidedInside, 'no leaf decided here is one the existing pin already derives').toEqual([]);
    for (const key of ['dimensions', 'measures']) {
      expect(covered.has(key), `the repeater ${key} is not itself a row property`).toBe(false);
    }
    expect(
      DECISIONS.some((d) => d.scope === 'fields' && d.key === 'dimensions' && d.prop === 'label'),
      'the dimensions repeater own label is decided here',
    ).toBe(true);
    // And the section headings and the type display pair are outside it
    // entirely — the derivation only ever yields `fields` keys.
    expect(
      DECISIONS.filter((d) => d.scope !== 'fields').length,
      'ten of this round twelve keys are not even the shape that pin walks',
    ).toBeGreaterThan(9);
  });
});

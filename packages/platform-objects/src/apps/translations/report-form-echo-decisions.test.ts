// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 9 — the DECISION LEDGER for the report form's DATASET-BINDING
// section and its render-time filter: the six leaves that still read their
// English source in all three locales.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts` and the eight rounds of this
// card extended: one row per string leaf, each carrying its verdict per locale,
// the reason it was reached, and the `en` source it was judged against — pinned
// equal to the live bundle AND to the declaration that manufactures it.
//
// ## ⭐⭐ THE ZERO THIS ROUND PRODUCES IS A PROPERTY OF THE PREDICATE
//
// `report.*` was the LAST family echoing in all three locales. With these six
// decided, this card's headline reading — "`.label` keys echoing in ALL THREE
// locales" — reads **0** across the whole metadata-form catalog.
//
// ⛔ THE SURFACE IS NOT CLEAN. `object.fields.lifecycle.*` contributes **32**
// `en` leaves (16 `label` + 16 `helpText`) that echo in `ja-JP` AND `es-ES`
// while `zh-CN` authored every one of them — **64 locale-leaves** a Japanese or
// Spanish author still reads in English, and the all-three predicate cannot see
// a single one of them. `email_template.fields.variables.helpText` is a 33rd,
// same shape. Re-measured on this round's base: 39 leaves echoed in at least
// one locale before, 33 after.
//
// ⇒ that claim is not left as prose. `the headline predicate is BLIND to a
// one-locale panel` below proves it on a synthetic catalog, so it holds
// independently of what this tree happens to contain on any given day: a
// population every locale but one has authored returns **0** from the all-three
// predicate and **non-zero** from the per-locale one, in the same run.
//
// ## The population — DERIVED from `reportForm`, ⛔ not from the catalog's keys
//
// The source that MANUFACTURES these leaves is `reportForm`
// (`packages/spec/src/ui/report.form.ts`), walked exactly as the CLI extractor
// walks it (`walkMetadataForms` / `walkFormField` in
// `packages/cli/src/utils/i18n-extract.ts`): every section's `label` and
// `description`, then every field it declares, recursively, with the same
// dot-path accumulation and the same section-name normalisation. 45 `en` string
// leaves — 8 from the four sections, 37 from the 26 field rows — and the
// catalog and the form are asserted equal in BOTH directions, so a field added
// to the form tomorrow joins this population without anybody editing a list.
//
// ⭐ THIS IS THE FIRST LEDGER OF THIS CARD WHOSE POPULATION REACHES SECTION
// LEAVES. Round 8's walked `object.fields` only. The card's own body records
// `report.sections.*` as a population NOTHING covers — "⚠️ A population NOTHING
// covers … 承接者:无". This walk covers it: 8 of the 45 leaves are section
// leaves, asserted by count and by name.
//
// ## The controls — one outward, two inward, one dark
//
//   (1) OUTWARD, and it is a LIVE echo rather than an already-authored one.
//       `object.fields.lifecycle.*` is round 10's declared scope and still
//       echoes in two locales TODAY. It is OUT of this population, asserted by
//       name — a walk that over-reached into the object form would sweep in 32
//       undecided leaves, and the assertion is what notices. `datasetForm` —
//       the sibling semantic-layer panel, 37 leaves, 0 echoing — is excluded
//       too, and that exclusion is asserted rather than trusted precisely
//       because a wrong sweep of it would NOT go red.
//   (2) INWARD, AUTHORED. 39 of this population's own 45 leaves come back
//       NON-echoing in all three locales, in the same walk. A hand-list of six
//       echoes can only ever produce positives; this derivation produces 39
//       negatives from the same predicate in the same run.
//   (3) ⭐⭐ INWARD, THE TWIN. `report.fields['blocks.runtimeFilter']` is IN the
//       population, carries the IDENTICAL English string as
//       `report.fields.runtimeFilter`, and is already authored in all three
//       locales. One schema key, one rendering — the word is COPIED and the
//       copy is asserted, so the two positions can only move together.
//   (4) DARK. Fed the `en` catalog in place of a translated one, the same walk
//       must flag all 45; and the echo predicate must flag all 6 rows.
//
// ## ⚠️⚠️ The phantom-translation trap — and why this family is the SHARP case
//
// `reportForm` declares NO label on `drilldown` and NO label on `runtimeFilter`
// (asserted). Both English strings are manufactured by the extractor's
// `humanizeFieldPath`, exactly as round 8's `Api Enabled` was — and this file
// asserts the humanize reproduces each `en` leaf byte for byte.
//
// ⭐ But here the humanize lands on CORRECT English. `drilldown` humanizes to
// "Drilldown" and `runtimeFilter` to "Runtime Filter", which is what a human
// would have written. Round 8's escape hatch — touch up the English, satisfy
// the echo predicate in every locale, translate nothing — is therefore NOT
// AVAILABLE here at all: there is no better English to move to. That is
// asserted, and it is the cleanest statement of the trap this card has had:
// when the fill is already good English, the ONLY byte change that clears the
// predicate is a real translation.
//
// ⭐ And `runtimeFilter` carries the card's strongest single piece of evidence
// that these were fills: `blocks.runtimeFilter` is the SAME schema key, one
// repeater level down, where the form DOES declare `label: 'Runtime Filter'` —
// and a translator authored 运行时筛选 / 実行時フィルター / Filtro en tiempo de
// ejecución for it while leaving the top-level position a byte copy. The same
// English, the same schema key, one position authored and the other a fill.
//
// ## The semantic layer, READ AT THE SCHEMA BEFORE A WORD WAS RENDERED
//
// `sections.dataset_binding.description` is the longest leaf this round decides
// and it makes a claim about a contract: "Values are the dataset's measures;
// rows are its dimensions." Every claim is asserted at the LIVE schema below,
// so a change that falsifies one reds this file:
//
//   • the semantic layer really is where those two words live —
//     `DatasetSchema` declares `dimensions` and `measures` and REFUSES `values`
//     and `rows` (`unrecognized_keys`, both directions asserted).
//   • the report really does spell the same two concepts `values` and `rows` —
//     `ReportSchema` declares them and REFUSES `measures`/`dimensions`.
//   • ⭐ the mapping the prose states is the SCHEMA'S OWN: the joined-block
//     shape's alias table answers `measures` with `values` and `dimensions`
//     with `rows`, in the rejection message, and the `order` refinement names
//     both halves in one live sentence ("name a `rows`/`columns` dimension or a
//     `values` measure").
//   • ⭐ AND THE TWO VOCABULARIES ARE ASYMMETRIC, which is why the sentence has
//     to exist: the alias table that converts them lives on the BLOCK and not
//     on the top-level report. That asymmetry is asserted as a reading, ⛔ not
//     repaired here — it is a spec-side edit outside this round's file surface.
//
// ## ⚠️ The renderings depart from a literal mapping, and the row says why
//
// #19355 rendered this panel's `values` box with the DATASET's word in every
// locale — 度量 / メジャー / Medidas all mean "measures". So a literal
// "Values are the dataset's measures" reads as an identity in all three
// translated locales while carrying information only in English. The clause is
// therefore rendered as the ATTRIBUTION it actually makes ("…come from this
// dataset's measures and dimensions"), with the verb copied from this panel's
// own authored twin rather than chosen: 来自 / から取得 / provienen de, all
// three from `report.fields.dataset.helpText`. Asserted.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { objectForm } from '@objectstack/spec/data';
import { DatasetSchema, ReportSchema, datasetForm, reportForm } from '@objectstack/spec/ui';

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
  /** `section` leaves live under `report.sections`, `field` leaves under `report.fields`. */
  kind: 'section' | 'field';
  /**
   * The `reportForm` section this row's leaf belongs to — the section itself for
   * a `section` row, the declaring section for a `field` row. Asserted equal to
   * the live form, so it is a reading rather than a label this ledger applies.
   */
  section: string;
  /** The bundle key: the section name, or the dotted field path. */
  path: string;
  /** Which string leaf of that entry this row decides. */
  prop: 'label' | 'description' | 'helpText';
  /**
   * The `en` source the verdict was taken against. Held equal to the live
   * bundle AND to the live `reportForm` declaration that manufactures it (a
   * declared string for a section leaf or a `helpText`, the extractor's
   * humanize of the field path for an undeclared `label`).
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
    kind: 'section',
    section: 'dataset_binding',
    path: 'dataset_binding',
    prop: 'label',
    en: 'Dataset binding',
    verdict: ALL_TRANSLATE,
    reason:
      'BOTH HALVES HAVE AUTHORED TWINS ON THIS VERY PANEL, and the row names each. "Dataset": report.fields.dataset.label, which #19355 decided and authored as 数据集 / データセット / Conjunto de datos — the same three words this catalog spends on the dataset metadata type itself. "binding": report.fields.dataset.helpText, one line below this heading, already renders the verb — 要绑定的数据集 / バインドするデータセット / Conjunto de datos a vincular. ⇒ 数据集绑定 / データセットのバインド / Vinculación del conjunto de datos. ⚠️ Each locale takes the NOMINAL form its three sibling headings on this panel take (基础信息 · 关联对象 · 筛选与图表 / 基本 · 結合ブロック · フィルターとチャート / Aspectos básicos · Bloques unidos · Filtro y gráfico), which is why es nominalises its twin verb to Vinculación rather than keeping the infinitive. ⛔ WHAT WAS REFUSED: leaving it as the loanword in es — byte-identical to the source, so it would clear the echo predicate while telling a Spanish author nothing, the phantom shape round 8 refused on apiEnabled.',
  },
  {
    kind: 'section',
    section: 'dataset_binding',
    path: 'dataset_binding',
    prop: 'description',
    en: 'The semantic-layer dataset this report renders. Values are the dataset’s measures; rows are its dimensions.',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ THE SCHEMA WAS READ BEFORE A WORD WAS RENDERED and every claim is asserted below: the semantic layer really does declare `dimensions` (groupable axes) and `measures` (aggregatable values) and refuses `values`/`rows`; the report really does spell the same two concepts `values` and `rows` and refuses `measures`/`dimensions`; and the MAPPING this sentence states is the schema\'s own — the joined-block alias table answers `measures` → `values` and `dimensions` → `rows` in its rejection message, and the order refinement names both halves in one live sentence. ⭐ EVERY WORD IS COPIED, NOT COMPOSED: "semantic layer" from dataset.description (分析语义层 / 分析セマンティックレイヤー / Capa semántica de analítica) and from report.fields.dataset.helpText on this same panel; "measures" and "dimensions" from dataset.sections.measures.label and dataset.sections.dimensions.label (度量 · 维度 / メジャー · ディメンション / Medidas · Dimensiones); the VERB from report.fields.dataset.helpText — 来自 / から取得 / provienen de. ⚠️⚠️ THE ONE DELIBERATE DEPARTURE, and it is forced by an earlier decision of this card: #19355 rendered this panel\'s `values` box with the DATASET\'s word in all three locales (度量 / メジャー / Medidas literally mean "measures"), so a literal "Values are the dataset\'s measures" reads as an identity — 度量就是度量 — and carries information only in English. The clause is rendered as the attribution it actually makes: the two boxes COME FROM this dataset\'s measures and dimensions. ⛔ What was refused: re-wording report.fields.values.label to restore the English contrast. That is a landed decision of this card and reversing it to make one tooltip read better would take a rendering three other leaves already depend on. ⚠️ Punctuation copied from this panel\'s own three sibling descriptions rather than chosen: zh carries no trailing full stop, ja and es do.',
  },
  {
    kind: 'field',
    section: 'dataset_binding',
    path: 'drilldown',
    prop: 'label',
    en: 'Drilldown',
    verdict: ALL_TRANSLATE,
    reason:
      '⚠️⚠️ THE PHANTOM TRAP IN ITS SHARPEST FORM — AND THE SHORTCUT DOES NOT EVEN EXIST HERE. `reportForm` declares no label on this field (asserted), so "Drilldown" is the extractor\'s humanize of the field path and not English anybody wrote. Round 8 met the same shape on `Api Enabled`, where a case fix to "API Enabled" would have cleared the echo predicate in all three locales while translating nothing. ⭐ Here the humanize lands on CORRECT English — `drilldown` humanizes to exactly "Drilldown" (asserted) — so there is no better English to move to, and the ONLY byte change that clears the predicate is a real translation. ⛔ NO AUTHORED TWIN FOR "drill" IN EITHER CATALOG, and this row says so rather than leaning on one — the discipline round 5 wrote down on memoryMb and round 8 repeated on `feeds` and `clone`. Composed from the schema\'s own contract (ReportSchema.drilldown is a BOOLEAN, default on, "click-through to underlying records"; ADR-0021 D2): zh 下钻, the established Chinese BI term for opening the rows behind an aggregate; ja ドリルダウン, transliterated by this catalog\'s habit for a technical noun with no Japanese term of art (データソース, タイムライン, マスキングルール, フィード are all authored that way); es Desglose, a nominal matching its own siblings on this panel (Medidas, Filas, Columnas, Orden, Bloques, Gráfico). ⛔ es was NOT left as the loanword: byte-identical to the source is a phantom, not a rendering.',
  },
  {
    kind: 'field',
    section: 'dataset_binding',
    path: 'drilldown',
    prop: 'helpText',
    en: 'Click an aggregated row/cell to open the underlying records',
    verdict: ALL_TRANSLATE,
    reason:
      'PROSE, AND EVERY TERM IN IT HAS AN AUTHORED TWIN EXCEPT ONE, WHICH IS NAMED. "aggregated" from dataset.sections.measures.description (可聚合值 / 集計可能な値 / Valores agregables); "row" from report.fields.rows.label on this same panel (行 / 行 / Filas); "records" from dataset.fields.filter.helpText (排除软删除记录 / 論理削除済みレコードを除外 / excluir registros eliminados de forma lógica). ⛔ "cell" has NO authored twin in either catalog — stated, not borrowed — and takes each locale\'s standard grid term: 单元格 / セル / celda. ⚠️ The ja term is also this file\'s worked example of why a substring guard lies: キャンセル contains セル, which is asserted below. ⇒ 点击聚合后的行/单元格，打开其底层记录 / 集計された行/セルをクリックして、元になったレコードを開きます / Haz clic en una fila/celda agregada para abrir los registros subyacentes. ⚠️ es takes the tú imperative its siblings take (Usa un campo del objeto base, elige nombres de relación, Activa/desactiva este agente), ja the 〜します form its sibling helpTexts take, zh no trailing full stop.',
  },
  {
    kind: 'field',
    section: 'filter_and_chart',
    path: 'runtimeFilter',
    prop: 'label',
    en: 'Runtime Filter',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐⭐ COPIED VERBATIM FROM AN EXACT TWIN IN THIS VERY SUBTREE, and the twin is what proves the echo was a fill. `report.fields["blocks.runtimeFilter"]` is the SAME schema key one repeater level down; `reportForm` DOES declare `label: "Runtime Filter"` there (asserted) and declares none here (asserted), and a translator authored 运行时筛选 / 実行時フィルター / Filtro en tiempo de ejecución for that position while leaving this one a byte copy. The same English string, the same schema key, one position authored by a hand and the other manufactured by `humanizeFieldPath`. ⇒ exactly the twin\'s three words, and the copy is asserted below so the two positions can only ever move together. ⛔ NOT re-worded to distinguish the report-level filter from the block-level one: the schema gives them the same name on purpose (#4990 records that both levels spell `runtimeFilter` so the alias table can catch `filter`/`where`/`criteria` at both), and the form\'s nesting already shows which is which — round 8\'s trackHistory reasoning, applied to a twin inside one metadata type.',
  },
  {
    kind: 'field',
    section: 'filter_and_chart',
    path: 'runtimeFilter',
    prop: 'helpText',
    en: 'Render-time scope filter, ANDed at query time',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ A NEAR-EXACT TWIN EXISTS AND CARRIES THE WHOLE SENTENCE PATTERN: dataset.fields.filter.helpText is "Intrinsic scope filter (e.g. exclude soft-deleted records), ANDed into every query" — the same "<when> scope filter, ANDed <when>" shape, already authored as 固有范围筛选（…），以 AND 方式并入每个查询 / 固有スコープのフィルター（…）。すべてのクエリに AND で結合されます / Filtro de ámbito intrínseco (…), combinado con AND en cada consulta. "scope filter" (范围筛选 / スコープのフィルター / Filtro de ámbito), the ANDing clause and its grammar are all taken from it. ⭐ `AND` IS KEPT VERBATIM in all three, the machine-token treatment this catalog already applies at that twin and at object.fields["fields.relatedListFilter"].helpText, and asserted by the token guard below. ⚠️ THE SOURCE\'S OWN TWO-TIME DISTINCTION IS PRESERVED rather than flattened: the label names the key (runtime ⇒ 运行时 / 実行時 / tiempo de ejecución, copied from the twin above) while this sentence contrasts RENDER time with QUERY time, so it takes 渲染 / レンダリング / renderizado — all three already authored in this catalog (page.fields.appearance.helpText, action.fields.display.helpText, sys_report.fields.format.help). ⇒ 渲染时的范围筛选，在查询时以 AND 方式并入 / レンダリング時のスコープフィルター。クエリ時に AND で結合されます / Filtro de ámbito en tiempo de renderizado, combinado con AND en el momento de la consulta.',
  },
];

// ---------------------------------------------------------------------------
// The population, DERIVED from `reportForm` by the extractor's own walk.
// ---------------------------------------------------------------------------

type FormSection = { name?: string; label?: unknown; description?: unknown; fields?: unknown[] };
type FormField = { field?: string; label?: unknown; helpText?: unknown; fields?: unknown[] };

const FORM_SECTIONS = ((reportForm as { sections?: unknown[] }).sections ?? []) as FormSection[];

/**
 * Section-name normalisation, mirroring `normalizeSectionName` in the CLI
 * extractor — which is itself a mirror of `resolveMetadataFormLabels`. The
 * catalog key is produced by this function, so the ledger has to reproduce it
 * rather than hard-code the four names.
 */
function sectionName(section: FormSection): string | undefined {
  if (typeof section.name === 'string' && section.name.length > 0) return section.name;
  if (typeof section.label !== 'string') return undefined;
  return section.label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The extractor's fallback label for a field that declares none. */
function humanizeFieldPath(path: string): string {
  const leaf = path.split('.').pop() ?? path;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface FormRow {
  section: string;
  /** Dotted field path, accumulated exactly as the extractor's `walkFormField` does. */
  path: string;
  /** Whether the form declares an explicit label — false means the `en` leaf is a humanize. */
  declaresLabel: boolean;
  label?: string;
  helpText?: string;
}

function walkFormFields(field: FormField, section: string, parent: string, out: FormRow[]): void {
  if (!field || typeof field !== 'object') return;
  const name = typeof field.field === 'string' ? field.field : undefined;
  const path = name ? (parent ? `${parent}.${name}` : name) : parent;
  if (path) {
    out.push({
      section,
      path,
      declaresLabel: typeof field.label === 'string',
      label: typeof field.label === 'string' ? field.label : undefined,
      helpText: typeof field.helpText === 'string' ? field.helpText : undefined,
    });
  }
  if (Array.isArray(field.fields)) for (const child of field.fields) walkFormFields(child as FormField, section, path, out);
}

function formRows(form: { sections?: unknown[] }): FormRow[] {
  const out: FormRow[] = [];
  for (const section of (form.sections ?? []) as FormSection[]) {
    const name = sectionName(section);
    if (!name) continue;
    for (const child of section.fields ?? []) walkFormFields(child as FormField, name, '', out);
  }
  return out;
}

interface PanelLeaf {
  kind: 'section' | 'field';
  section: string;
  path: string;
  prop: string;
  en: string;
}

/** Every `en` string leaf a form manufactures, read off the catalog it generated. */
function leavesOf(form: { sections?: unknown[] }, type: string): PanelLeaf[] {
  const subtree = ((enMetadataForms as Record<string, any>)[type] ?? {}) as Record<string, any>;
  const out: PanelLeaf[] = [];
  for (const section of (form.sections ?? []) as FormSection[]) {
    const name = sectionName(section);
    if (!name) continue;
    const entry = (subtree.sections ?? {})[name];
    for (const [prop, value] of Object.entries((entry ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'string') out.push({ kind: 'section', section: name, path: name, prop, en: value });
    }
  }
  for (const row of formRows(form)) {
    const entry = (subtree.fields ?? {})[row.path];
    if (!entry || typeof entry !== 'object') continue;
    for (const [prop, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value === 'string') out.push({ kind: 'field', section: row.section, path: row.path, prop, en: value });
    }
  }
  return out;
}

const PANEL_LEAVES = leavesOf(reportForm as { sections?: unknown[] }, 'report');
const DATASET_LEAVES = leavesOf(datasetForm as { sections?: unknown[] }, 'dataset');
const OBJECT_LEAVES = leavesOf(objectForm as { sections?: unknown[] }, 'object');
const REPORT_ROWS = formRows(reportForm as { sections?: unknown[] });

/** The authored twin: the same schema key, one repeater level down. */
const TWIN_PATH = 'blocks.runtimeFilter';

/** Round 10's declared scope, and the OUTWARD control — a LIVE echo this walk must not reach. */
const ROUND_TEN_SUBTREE = 'lifecycle';

const catalogLeaf = (forms: Record<string, any>, leaf: { kind: string; path: string; prop: string }): unknown =>
  leaf.kind === 'section'
    ? forms.report?.sections?.[leaf.path]?.[leaf.prop]
    : forms.report?.fields?.[leaf.path]?.[leaf.prop];

const idOf = (d: { kind: string; path: string; prop: string }): string =>
  `report.${d.kind === 'section' ? 'sections' : 'fields'}.${d.path}.${d.prop}`;

/** The provenance-table key — the `metadataForms.` prefix the bundles do not carry. */
const provenanceKey = (d: { kind: string; path: string; prop: string }): string => `metadataForms.${idOf(d)}`;

function flattenLeaves(o: Record<string, any>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(p, v);
    else if (v && typeof v === 'object') for (const [a, b] of flattenLeaves(v as Record<string, any>, p)) out.set(a, b);
  }
  return out;
}

/**
 * Every `echo` verdict that carries no per-locale departure reason. A predicate
 * rather than an inlined loop so the suite can prove it FIRES — with every
 * verdict in this round `translate`, asserting it over DECISIONS alone would
 * evaluate nothing.
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

/**
 * Token presence judged on UNICODE word boundaries, ⛔ NOT substring containment
 * — and used ONLY on the Latin machine token this round keeps.
 *
 * ⚠️ Its limit is asserted below rather than left implicit: Japanese writes no
 * word boundaries, so this predicate says NO to a kana token that IS present.
 * That is why the `cell` vocabulary is checked by containment in its own row's
 * prose and only `AND` is guarded here.
 */
function carriesToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

/** A minimal dataset and a minimal report that both parse, so each probe varies ONE key. */
const MINIMAL_DATASET = {
  name: 'sales',
  label: 'Sales',
  object: 'orders',
  dimensions: [{ name: 'region', field: 'account.region' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
} as const;
const MINIMAL_REPORT = {
  name: 'revenue_by_region',
  label: 'Revenue by region',
  dataset: 'sales',
  values: ['revenue'],
  rows: ['region'],
} as const;

const issueCodes = (r: { success: boolean; error?: { issues: { code: string; message: string }[] } }): string[] =>
  r.success ? [] : r.error!.issues.map((i) => i.code);
const issueMessages = (r: { success: boolean; error?: { issues: { code: string; message: string }[] } }): string =>
  r.success ? '' : r.error!.issues.map((i) => i.message).join(' | ');

describe('#19403 round 9 — the ledger itself (controls before verdicts)', () => {
  it('decides every leaf of this family and nothing else', () => {
    expect(DECISIONS.length).toBe(6);
    expect(new Set(DECISIONS.map(idOf))).toEqual(
      new Set([
        'report.sections.dataset_binding.label',
        'report.sections.dataset_binding.description',
        'report.fields.drilldown.label',
        'report.fields.drilldown.helpText',
        'report.fields.runtimeFilter.label',
        'report.fields.runtimeFilter.helpText',
      ]),
    );
    expect(DECISIONS.filter((d) => d.kind === 'section').length).toBe(2);
    expect(DECISIONS.filter((d) => d.prop === 'label').length).toBe(3);
    expect(DECISIONS.filter((d) => d.prop === 'description').length).toBe(1);
    expect(DECISIONS.filter((d) => d.prop === 'helpText').length).toBe(2);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(18);
    for (const d of DECISIONS) {
      expect(Object.keys(d.verdict).sort(), `${idOf(d)} names every translated locale`).toEqual([
        'es-ES',
        'ja-JP',
        'zh-CN',
      ]);
    }
  });

  it('every row is pinned to the live `en` source it was decided against', () => {
    for (const d of DECISIONS) {
      expect(
        catalogLeaf(enMetadataForms as Record<string, any>, d),
        `en ${idOf(d)} moved — re-judge the decision, do not refresh this row`,
      ).toBe(d.en);
    }
  });

  it('⭐ …and to the FORM that manufactures it — the third leg, in all three of its shapes', () => {
    // The `en` leaf is not authored in this package: `reportForm` in
    // `packages/spec` declares the section text and the helpTexts, and the
    // extractor DERIVES the field labels from the path. Pinning only the
    // catalog would leave a decision standing over text the form had reworded.
    for (const d of DECISIONS) {
      if (d.kind === 'section') {
        const section = FORM_SECTIONS.find((s) => sectionName(s) === d.path);
        expect(section, `${d.path} is no longer a section of reportForm`).toBeDefined();
        expect(
          (section as Record<string, unknown>)[d.prop],
          `reportForm no longer declares this section ${d.prop}`,
        ).toBe(d.en);
        continue;
      }
      const row = REPORT_ROWS.find((r) => r.path === d.path);
      expect(row, `${d.path} is no longer declared by reportForm`).toBeDefined();
      expect(row!.section, `${d.path} moved section`).toBe(d.section);
      if (d.prop === 'helpText') {
        expect(row!.helpText, 'reportForm no longer declares this helpText').toBe(d.en);
      } else {
        // No declared label ⇒ the English is the extractor's humanize of the
        // field path, which is the whole premise of both label rows.
        expect(row!.declaresLabel, `${d.path} now declares its own label — re-judge the row`).toBe(false);
        expect(humanizeFieldPath(d.path), `the humanize no longer reproduces the en leaf`).toBe(d.en);
      }
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must flag all 6 rows.
    const flagged = DECISIONS.filter((d) => catalogLeaf(enMetadataForms as Record<string, any>, d) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `${idOf(d)} records no reason`).toBeGreaterThan(40);
    }
  });

  it('refuses an `echo` verdict that carries no per-locale reason — proved on a synthetic row', () => {
    // Dark. Every verdict this round is `translate`, so running the predicate
    // over DECISIONS alone evaluates nothing at all.
    expect(undeclaredEchoes(DECISIONS)).toEqual([]);
    const synthetic: Decision = {
      kind: 'field',
      section: 'dataset_binding',
      path: 'drilldown',
      prop: 'label',
      en: 'Drilldown',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'a synthetic row that exists only to prove the predicate below can fire',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN report.fields.drilldown.label']);
    expect(
      undeclaredEchoes([
        {
          ...synthetic,
          departures: {
            'zh-CN': 'a departure long enough to satisfy the bar this ledger sets for a declared echo verdict',
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe('#19403 round 9 — the catalogs hold what the ledger decided', () => {
  for (const [locale, forms] of TRANSLATED_LOCALES) {
    it(`${locale}: every decided leaf matches its verdict`, () => {
      for (const d of DECISIONS) {
        const id = `${locale} ${idOf(d)}`;
        const value = catalogLeaf(forms, d);
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

describe('#19403 round 9 — the semantic layer, asserted AT THE SCHEMA', () => {
  it('the probe harness is lit — the minimal dataset and the minimal report both parse', () => {
    expect(DatasetSchema.safeParse({ ...MINIMAL_DATASET }).success).toBe(true);
    expect(ReportSchema.safeParse({ ...MINIMAL_REPORT }).success).toBe(true);
  });

  it('"the dataset\'s measures … its dimensions" — the SEMANTIC LAYER is where those two words live', () => {
    // Both declared, and the report's own two words REFUSED there, so the
    // sentence is naming a real boundary between two shapes.
    expect(DatasetSchema.safeParse({ ...MINIMAL_DATASET, dimensions: [] }).success).toBe(true);
    expect(DatasetSchema.safeParse({ ...MINIMAL_DATASET, measures: [] }).success).toBe(true);
    for (const key of ['values', 'rows', 'columns']) {
      const r = DatasetSchema.safeParse({ ...MINIMAL_DATASET, [key]: ['revenue'] });
      expect(r.success, `DatasetSchema accepts \`${key}\` — the two vocabularies are no longer distinct`).toBe(false);
      expect(issueCodes(r)).toContain('unrecognized_keys');
    }
  });

  it('…and the REPORT spells the same two concepts `values` and `rows`, refusing the dataset\'s words', () => {
    expect(ReportSchema.safeParse({ ...MINIMAL_REPORT, values: ['revenue'], rows: ['region'] }).success).toBe(true);
    for (const key of ['measures', 'dimensions']) {
      const r = ReportSchema.safeParse({ ...MINIMAL_REPORT, [key]: ['revenue'] });
      expect(r.success, `ReportSchema accepts \`${key}\` — the prose's contrast is gone`).toBe(false);
      expect(issueCodes(r)).toContain('unrecognized_keys');
    }
    // …and a report with no dataset+values is refused in the sentence the prose
    // paraphrases: "a report needs `dataset` + `values` (measure names)".
    const bare = ReportSchema.safeParse({ name: 'bare_report', label: 'Bare' });
    expect(bare.success).toBe(false);
    expect(issueMessages(bare)).toContain('(measure names)');
  });

  it('⭐ the MAPPING the prose states is the schema\'s OWN — the alias table says it out loud', () => {
    // The joined-block shape carries the conversion table for exactly these two
    // words, so "Values are the dataset's measures; rows are its dimensions" is
    // a reading of the spec rather than a gloss this panel invented.
    const block = (extra: Record<string, unknown>) =>
      ReportSchema.safeParse({
        name: 'joined_report',
        label: 'Joined',
        type: 'joined',
        blocks: [{ name: 'block_one', dataset: 'sales', ...extra }],
      });
    expect(issueMessages(block({ measures: ['revenue'] }))).toContain('`measures` → `values`');
    expect(issueMessages(block({ dimensions: ['region'], values: ['revenue'] }))).toContain('`dimensions` → `rows`');
    // …and the order refinement names both halves in one LIVE sentence.
    const order = ReportSchema.safeParse({ ...MINIMAL_REPORT, order: [{ by: 'not_selected_here' }] });
    expect(order.success).toBe(false);
    expect(issueMessages(order)).toContain('name a `rows`/`columns` dimension or a `values` measure');
  });

  it('⚠️ A READING, ⛔ NOT A REPAIR — the alias table is on the BLOCK and not on the top-level report', () => {
    // The same two keys, the same two target keys, one level apart: the block
    // answers with the rename, the report answers with a bare unrecognised-key
    // error. Recorded as a finding in this round's PR, ⛔ not fixed here — it is
    // an edit to `packages/spec/src/ui/report.zod.ts`, outside this round's file
    // surface, and it does not discharge any row above.
    const onReport = ReportSchema.safeParse({ ...MINIMAL_REPORT, measures: ['revenue'] });
    expect(onReport.success).toBe(false);
    expect(issueMessages(onReport)).not.toContain('Did you mean');
    const onBlock = ReportSchema.safeParse({
      name: 'joined_report',
      label: 'Joined',
      type: 'joined',
      blocks: [{ name: 'block_one', dataset: 'sales', measures: ['revenue'] }],
    });
    expect(issueMessages(onBlock)).toContain('Did you mean');
  });

  it('⭐ `drilldown` is a BOOLEAN switch — the helpText describes a toggle, not a config block', () => {
    const parsed = ReportSchema.safeParse({ ...MINIMAL_REPORT });
    expect(parsed.success).toBe(true);
    expect((parsed as { data: { drilldown: unknown } }).data.drilldown, 'ADR-0021 D2 — default on').toBe(true);
    expect(ReportSchema.safeParse({ ...MINIMAL_REPORT, drilldown: false }).success).toBe(true);
    expect(
      ReportSchema.safeParse({ ...MINIMAL_REPORT, drilldown: { target: 'dialog' } }).success,
      'drilldown takes a config object — the helpText no longer describes what it is',
    ).toBe(false);
  });

  it('⭐ no rendered word can land in either key — neither as the VALUE nor as the KEY', () => {
    // The class-(c) question, answered at the schema rather than assumed.
    for (const rendered of ['下钻', 'Desglose', '実行時フィルター']) {
      expect(
        ReportSchema.safeParse({ ...MINIMAL_REPORT, drilldown: rendered }).success,
        `drilldown accepts the string ${rendered}`,
      ).toBe(false);
      expect(
        ReportSchema.safeParse({ ...MINIMAL_REPORT, runtimeFilter: rendered }).success,
        `runtimeFilter accepts the string ${rendered}`,
      ).toBe(false);
    }
    const renderedKey = ReportSchema.safeParse({ ...MINIMAL_REPORT, 下钻: true });
    expect(renderedKey.success).toBe(false);
    expect(
      issueCodes(renderedKey),
      'the report shape is no longer strict — a translated key would be silently stripped',
    ).toContain('unrecognized_keys');
  });
});

describe('#19403 round 9 — machine tokens, and a guard that can say NO', () => {
  it('`AND` is still verbatim in every locale, and in the twin it was copied from', () => {
    const help = DECISIONS.find((d) => d.path === 'runtimeFilter' && d.prop === 'helpText')!;
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      expect(carriesToken(String(catalogLeaf(forms, help)), 'AND'), `${locale} dropped the AND token`).toBe(true);
      const twin = String(forms.dataset?.fields?.filter?.helpText);
      expect(twin.length, `${locale} dataset.fields.filter.helpText is missing`).toBeGreaterThan(0);
      expect(carriesToken(twin, 'AND'), `${locale} the twin this clause was copied from dropped AND`).toBe(true);
    }
  });

  it('⭐ the token predicate can say NO — and a bare `includes` could not', () => {
    // The English source spells it `ANDed`, so the bare token is NOT in it — a
    // substring guard would report the source as carrying the token it does not.
    const en = DECISIONS.find((d) => d.path === 'runtimeFilter' && d.prop === 'helpText')!.en;
    expect(en.includes('AND')).toBe(true);
    expect(carriesToken(en, 'AND')).toBe(false);
    expect(carriesToken('以 AND 方式并入', 'AND')).toBe(true);
    // ⚠️ AND ITS LIMIT, ASSERTED RATHER THAN LEFT IMPLICIT. Japanese writes no
    // word boundaries: キャンセル contains セル, which a substring guard would
    // call a hit — and this predicate calls a MISS even where セル really does
    // stand as a word. That is why only the Latin token is guarded here.
    expect('キャンセル済み'.includes('セル')).toBe(true);
    expect(carriesToken('キャンセル済み', 'セル')).toBe(false);
    expect(carriesToken('集計された行/セルをクリック', 'セル'), 'the predicate under-reaches on kana').toBe(false);
  });

  it('⚠️⚠️ the phantom-translation shortcut is UNAVAILABLE here, and that is asserted', () => {
    // Round 8's escape hatch was a case fix: `Api Enabled` → `API Enabled`,
    // which differs in bytes, clears the echo predicate in all three locales and
    // translates nothing. This family has no such move, because the humanize
    // already lands on the English a human would write.
    for (const path of ['drilldown', 'runtimeFilter']) {
      const row = REPORT_ROWS.find((r) => r.path === path)!;
      expect(row.declaresLabel, `${path} now declares a label — the fill premise is gone`).toBe(false);
      const en = String(catalogLeaf(enMetadataForms as Record<string, any>, { kind: 'field', path, prop: 'label' }));
      expect(humanizeFieldPath(path), `${path}'s en leaf is no longer the humanize`).toBe(en);
      // …and none of the three renderings reads the English, in either case.
      for (const [locale, forms] of TRANSLATED_LOCALES) {
        const value = String(catalogLeaf(forms, { kind: 'field', path, prop: 'label' }));
        expect(value, `${locale} ${path} reads the en source`).not.toBe(en);
        expect(
          value.toLowerCase(),
          `${locale} ${path} reads a case variant of the English — that is a phantom, not a translation`,
        ).not.toBe(en.toLowerCase());
      }
    }
  });
});

describe('#19403 round 9 — one schema key, one rendering', () => {
  it('⭐⭐ `runtimeFilter` is COPIED from its authored twin one repeater level down', () => {
    const en = enMetadataForms as Record<string, any>;
    // The two positions carry the IDENTICAL English string…
    expect(en.report?.fields?.runtimeFilter?.label).toBe('Runtime Filter');
    expect(en.report?.fields?.[TWIN_PATH]?.label).toBe('Runtime Filter');
    // …and the twin is the one the FORM declares, which is what made it authored
    // while this round's position was a fill.
    const twinRow = REPORT_ROWS.find((r) => r.path === TWIN_PATH)!;
    expect(twinRow.declaresLabel, 'the twin no longer declares its own label').toBe(true);
    expect(twinRow.label).toBe('Runtime Filter');
    expect(REPORT_ROWS.find((r) => r.path === 'runtimeFilter')!.declaresLabel).toBe(false);
    // ⇒ so they must carry the identical rendering. Rewording either reds this.
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      const twin = String(forms.report?.fields?.[TWIN_PATH]?.label);
      expect(twin.length, `${locale} the twin is missing`).toBeGreaterThan(0);
      expect(twin, `${locale} the twin reads the en source — it is not the authored evidence any more`).not.toBe(
        'Runtime Filter',
      );
      expect(
        String(forms.report?.fields?.runtimeFilter?.label),
        `${locale} runtimeFilter diverged from its authored twin`,
      ).toBe(twin);
    }
  });

  it('the authored vocabulary the other five rows were derived from is still there', () => {
    // Round 5's discipline, from the other side: a row that names a twin has to
    // be able to point at it.
    const en = enMetadataForms as Record<string, any>;
    expect(en.report?.fields?.dataset?.label).toBe('Dataset');
    expect(en.dataset?.sections?.measures?.label).toBe('Measures');
    expect(en.dataset?.sections?.dimensions?.label).toBe('Dimensions');
    expect(String(en.dataset?.fields?.filter?.helpText)).toContain('ANDed into every query');
    const expected: Record<
      string,
      { dataset: string; measures: string; dimensions: string; verb: string; inProse: readonly [string, string] }
    > = {
      'zh-CN': { dataset: '数据集', measures: '度量', dimensions: '维度', verb: '来自', inProse: ['度量', '维度'] },
      'ja-JP': {
        dataset: 'データセット',
        measures: 'メジャー',
        dimensions: 'ディメンション',
        verb: '取得',
        inProse: ['メジャー', 'ディメンション'],
      },
      'es-ES': {
        dataset: 'Conjunto de datos',
        measures: 'Medidas',
        dimensions: 'Dimensiones',
        verb: 'provienen',
        // The heading is capitalised; running prose lower-cases it.
        inProse: ['medidas', 'dimensiones'],
      },
    };
    const description = DECISIONS.find((d) => d.kind === 'section' && d.prop === 'description')!;
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      const want = expected[locale];
      expect(String(forms.report?.fields?.dataset?.label), `${locale} the Dataset twin moved`).toBe(want.dataset);
      expect(String(forms.dataset?.sections?.measures?.label), `${locale} the Measures twin moved`).toBe(want.measures);
      expect(String(forms.dataset?.sections?.dimensions?.label), `${locale} the Dimensions twin moved`).toBe(
        want.dimensions,
      );
      // The VERB is copied from this panel's own dataset helpText, not chosen.
      const verbTwin = String(forms.report?.fields?.dataset?.helpText);
      expect(verbTwin, `${locale} the verb twin no longer carries ${want.verb}`).toContain(want.verb);
      const rendered = String(catalogLeaf(forms, description));
      expect(rendered, `${locale} the description dropped the verb it copied`).toContain(want.verb);
      expect(rendered, `${locale} the description dropped the measures word`).toContain(want.inProse[0]);
      expect(rendered, `${locale} the description dropped the dimensions word`).toContain(want.inProse[1]);
    }
  });
});

describe('#19403 round 9 — the population, DERIVED from `reportForm`', () => {
  it('⭐ the form and the catalog agree in BOTH directions', () => {
    // The ratchet's anchor. The catalog is GENERATED from this form, so a field
    // added to a section arrives in both at once — which is what makes this
    // population pick up a future unauthored row without anybody listing it.
    const subtree = ((enMetadataForms as Record<string, any>).report ?? {}) as Record<string, any>;
    const declaredFields = REPORT_ROWS.map((r) => r.path);
    expect(declaredFields.length).toBeGreaterThan(20);
    expect(
      declaredFields.filter((p) => !(p in (subtree.fields ?? {}))),
      'reportForm declares a field the catalog has no entry for',
    ).toEqual([]);
    expect(
      Object.keys(subtree.fields ?? {}).filter((k) => !declaredFields.includes(k)),
      'the catalog holds a report field reportForm does not declare',
    ).toEqual([]);
    const declaredSections = FORM_SECTIONS.map((s) => sectionName(s));
    expect(declaredSections).toEqual(['basics', 'dataset_binding', 'joined_blocks', 'filter_and_chart']);
    expect(
      Object.keys(subtree.sections ?? {}).filter((k) => !declaredSections.includes(k)),
      'the catalog holds a report section reportForm does not declare',
    ).toEqual([]);
  });

  it('⭐ the walk REACHES SECTION LEAVES — the population the card says nothing covers', () => {
    // `report.sections.*` is written into #19403's body as a population NOTHING
    // covers — 「承接者:无」. This walk covers it, and the count is asserted so
    // a walk that quietly stopped at `fields` would go red.
    expect(PANEL_LEAVES.length).toBe(45);
    expect(PANEL_LEAVES.filter((l) => l.kind === 'section').length).toBe(8);
    expect(PANEL_LEAVES.filter((l) => l.kind === 'field').length).toBe(37);
    expect(
      PANEL_LEAVES.some((l) => l.kind === 'section' && l.path === 'dataset_binding' && l.prop === 'description'),
      'the section description this round decides is not in the population',
    ).toBe(true);
    expect(PANEL_LEAVES.every((l) => ['label', 'description', 'helpText'].includes(l.prop))).toBe(true);
  });

  it('⭐ DARK, OUTWARD — round 10\'s LIVE echo is excluded, and `datasetForm` with it', () => {
    // The sharpest exclusion is a population that is STILL ECHOING today, so a
    // walk that over-reached into the object form would sweep in 32 undecided
    // leaves. It is OUT, asserted by name.
    // ⭐ The SAME walker, handed `objectForm`, reaches all 32 of them — so the
    // exclusion below is this population's choice and ⛔ not the walker being
    // unable to see them, which is the only way an exclusion control means
    // anything.
    const lifecycleLeaves = OBJECT_LEAVES.filter(
      (l) => l.path === ROUND_TEN_SUBTREE || l.path.startsWith(`${ROUND_TEN_SUBTREE}.`),
    );
    expect(lifecycleLeaves.length, 'the walker no longer reaches the lifecycle panel').toBe(32);
    expect(lifecycleLeaves.filter((l) => l.prop === 'label').length).toBe(16);
    expect(lifecycleLeaves.filter((l) => l.prop === 'helpText').length).toBe(16);
    // …and they are OUT of this round's population, asserted on the leaf ids.
    const panelIds = new Set(PANEL_LEAVES.map(idOf));
    expect(
      lifecycleLeaves.map((l) => `object.fields.${l.path}.${l.prop}`).filter((k) => panelIds.has(k)),
      'the walk reached round 10\'s population — 32 undecided leaves would ride this ledger',
    ).toEqual([]);
    expect(PANEL_LEAVES.every((l) => idOf(l).startsWith('report.'))).toBe(true);
    // ⚠️ Shrink-only, ⛔ not a claim that expires: at this round's base every one
    // of the 32 still echoed in `ja-JP` and in `es-ES` — 64 locale-leaves the
    // card's headline predicate cannot see, because `zh-CN` authored all of
    // them. Round 10 driving this to 0 leaves the bound green.
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      const echoing = lifecycleLeaves.filter(
        (l) => (forms.object?.fields?.[l.path] ?? {})[l.prop] === l.en,
      );
      expect(echoing.length, `${locale} echoes more lifecycle leaves than the panel has`).toBeLessThanOrEqual(32);
      if (locale === 'zh-CN') {
        expect(echoing, 'zh-CN started echoing the lifecycle panel — the sibling-locale evidence is gone').toEqual([]);
      }
    }
    // …and `datasetForm`, the sibling semantic-layer panel, is excluded too.
    // It is fully authored, so a wrong sweep of it would NOT go red — which is
    // exactly why the exclusion is asserted instead of trusted.
    expect(DATASET_LEAVES.length).toBe(37);
    const datasetEchoes = DATASET_LEAVES.filter((l) =>
      TRANSLATED_LOCALES.some(([, forms]) => forms.dataset?.[l.kind === 'section' ? 'sections' : 'fields']?.[l.path]?.[l.prop] === l.en),
    );
    expect(datasetEchoes.map((l) => `${l.path}.${l.prop}`), 'the dataset panel echoes — it needs its own ledger').toEqual(
      [],
    );
    expect(PANEL_LEAVES.some((l) => l.path === 'include' || l.path === 'measures' || l.path === 'dimensions')).toBe(
      false,
    );
  });

  it('⭐ DARK, INWARD — 39 of this population\'s own 45 leaves come back NON-ECHOING', () => {
    // A hand-list of six echoes can only ever produce positives. This derivation
    // produces 39 negatives from the same predicate in the same run, including
    // the twin `blocks.runtimeFilter` the runtimeFilter row is copied from.
    const decided = new Set(DECISIONS.map(idOf));
    const negatives = PANEL_LEAVES.filter((l) => !decided.has(idOf(l)));
    expect(negatives.length).toBe(39);
    for (const leaf of negatives) {
      for (const [locale, forms] of TRANSLATED_LOCALES) {
        expect(catalogLeaf(forms, leaf), `${locale} ${idOf(leaf)} is an echo, not a control`).not.toBe(leaf.en);
      }
    }
    expect(negatives.some((l) => l.path === TWIN_PATH), 'the authored twin is not a member of this population').toBe(
      true,
    );
  });

  it('no leaf of this population reads its `en` source unless a row decides it is an echo', () => {
    // The ratchet. A field added to `reportForm` tomorrow, or a re-fill of a
    // decided one, is red on the day it lands.
    const undecided: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const leaf of PANEL_LEAVES) {
        if (catalogLeaf(forms, leaf) !== leaf.en) continue;
        const decided = DECISIONS.find((d) => idOf(d) === idOf(leaf));
        if (decided?.verdict[locale] === 'echo') continue;
        undecided.push(`${locale} ${idOf(leaf)} (${JSON.stringify(leaf.en)})`);
      }
    }
    expect(
      undecided,
      'these leaves read their en source and no row in this ledger says that is right — decide them, do not refresh anything',
    ).toEqual([]);
  });

  it('the derived predicate can fire — fed the `en` catalog it flags every leaf in the population', () => {
    // Dark. Same walk, with `en` standing in for a translated catalog.
    const flagged = PANEL_LEAVES.filter((l) => catalogLeaf(enMetadataForms as Record<string, any>, l) === l.en);
    expect(flagged.length).toBe(PANEL_LEAVES.length);
  });
});

describe('#19403 round 9 — ⭐⭐ the ZERO is a property of the PREDICATE, not of the surface', () => {
  /** The card's headline predicate: a `.label` leaf whose every translated locale reads `en`. */
  const allThreeLabelEchoes = (
    en: Map<string, string>,
    locales: ReadonlyArray<readonly [string, Map<string, string>]>,
  ): string[] =>
    [...en.keys()].filter((k) => k.endsWith('.label') && locales.every(([, m]) => m.get(k) === en.get(k)));

  /** The per-locale reading of the same catalog, over EVERY string leaf. */
  const perLocaleEchoes = (en: Map<string, string>, locale: Map<string, string>): string[] =>
    [...en.keys()].filter((k) => locale.get(k) === en.get(k));

  it('⭐⭐ the headline predicate is BLIND to a panel one locale reads in English — on a synthetic catalog', () => {
    // Dark, and deliberately independent of what this tree holds on any given
    // day: a population that every locale but one has authored returns ZERO from
    // the all-three predicate and NON-ZERO from the per-locale one, in the same
    // run. That is the whole claim this round's write-up has to make, executed.
    const en = new Map([['panel.fields.thing.label', 'Lifecycle']]);
    const zh = new Map([['panel.fields.thing.label', '生命周期']]);
    const ja = new Map([['panel.fields.thing.label', 'Lifecycle']]);
    const es = new Map([['panel.fields.thing.label', 'Lifecycle']]);
    expect(allThreeLabelEchoes(en, [['zh-CN', zh], ['ja-JP', ja], ['es-ES', es]])).toEqual([]);
    expect(perLocaleEchoes(en, ja)).toEqual(['panel.fields.thing.label']);
    expect(perLocaleEchoes(en, es)).toEqual(['panel.fields.thing.label']);
    expect(perLocaleEchoes(en, zh)).toEqual([]);
    // …and the same predicate DOES fire when all three echo, so its zero above
    // is a discrimination rather than a predicate that never says yes.
    const jaEcho = new Map([['panel.fields.thing.label', 'Lifecycle']]);
    expect(
      allThreeLabelEchoes(en, [['zh-CN', jaEcho], ['ja-JP', ja], ['es-ES', es]]),
    ).toEqual(['panel.fields.thing.label']);
  });

  it('⭐ this catalog: the headline reads ZERO, and the per-locale remainder does NOT', () => {
    const en = flattenLeaves(enMetadataForms as Record<string, any>);
    const locales = TRANSLATED_LOCALES.map(
      ([name, forms]) => [name, flattenLeaves(forms)] as const,
    );
    // Exact — a new all-three echo arriving tomorrow reds this on the day it lands.
    expect(
      allThreeLabelEchoes(en, locales),
      'a `.label` key echoes in all three locales again — this card is not done with that predicate',
    ).toEqual([]);
    // ⛔ And the surface is NOT clean. Shrink-only against the reading this round
    // took on its own base (39 before, 33 after: 32 `object.fields.lifecycle.*`
    // leaves in two locales, plus `email_template.fields.variables.helpText`), so
    // round 10 driving it toward 0 leaves this green.
    const REMAINDER_AT_ROUND_9 = 33;
    const remainder = [...en.keys()].filter((k) => locales.some(([, m]) => m.get(k) === en.get(k)));
    expect(
      remainder.length,
      'more leaves echo than this round measured — a new family arrived, decide it',
    ).toBeLessThanOrEqual(REMAINDER_AT_ROUND_9);
    // Lit: the walk really read a catalog, which a pair of zeroes would not show.
    expect(en.size).toBeGreaterThan(500);
    expect(locales.every(([, m]) => m.size === en.size)).toBe(true);
  });
});

describe('#19403 round 9 — the provenance table agrees these leaves are now authored', () => {
  // A second, independent witness to the same fact, from a table nobody edits by
  // hand. An entry exists exactly while a leaf is still a byte copy of the
  // source revision, so re-filling a decided leaf and re-running the extract
  // brings its row back and reds this block — a different trigger than the
  // catalog assertion above.
  for (const [locale, table] of PROVENANCE) {
    it(`${locale}: no decided leaf is still recorded as an extractor fill`, () => {
      expect(Object.keys(table).length, `${locale} provenance table is empty`).toBeGreaterThan(100);
      const stillFilled = DECISIONS.filter((d) => table[provenanceKey(d)] !== undefined).map(idOf);
      expect(stillFilled, 'these leaves are still byte copies of their source revision').toEqual([]);
      // Stronger, and shrink-only: NOTHING under `report.` is a fill any more.
      expect(
        Object.keys(table).filter((k) => k.startsWith('metadataForms.report.')),
        'a report leaf is still an extractor fill and no row decides it',
      ).toEqual([]);
    });

    it(`${locale}: the provenance lookup can say "still a fill" — both directions, in this locale`, () => {
      // Dark. The verdict above is a run of `undefined`s, which is also what a
      // misspelt key shape returns — and the `metadataForms.` prefix these tables
      // carry, and the bundles do not, is exactly the misspelling that reads 0
      // for everything and looks like a clean result.
      //
      // Leg 1 — the key rule: every `metadataForms.*` key names a real `en` leaf.
      const enPaths = flattenLeaves(enMetadataForms as Record<string, any>);
      const formKeys = Object.keys(table).filter((k) => k.startsWith('metadataForms.'));
      const strays = formKeys.filter((k) => !enPaths.has(k.slice('metadataForms.'.length)));
      expect(strays, 'a provenance key names no leaf of the en catalog — the key rule moved').toEqual([]);
      // Leg 2 — the composer under test obeys that same rule.
      for (const d of DECISIONS) {
        expect(provenanceKey(d)).toBe(`metadataForms.${idOf(d)}`);
        expect(enPaths.has(idOf(d)), `${idOf(d)} is not a leaf of the en catalog`).toBe(true);
      }
      // Leg 3 — ⭐ THE DISCRIMINATION, over a population THIS ROUND DOES NOT
      // TOUCH so it cannot shrink as rounds land: every metadata-form leaf that
      // still echoes in this locale must carry a row, and every leaf a translator
      // wrote must carry none. A real positive AND a real negative from the same
      // composer, in the same run.
      const localePaths = flattenLeaves(
        (TRANSLATED_LOCALES.find(([name]) => name === locale)![1]) as Record<string, any>,
      );
      const echoing = [...enPaths].filter(([p, en]) => localePaths.get(p) === en).map(([p]) => p);
      const authored = [...enPaths]
        .filter(([p, en]) => localePaths.has(p) && localePaths.get(p) !== en)
        .map(([p]) => p);
      expect(authored.length, `${locale} has no authored metadata-form leaf to sample`).toBeGreaterThan(50);
      expect(
        echoing.filter((p) => table[`metadataForms.${p}`] === undefined),
        'an echoing metadata-form leaf carries NO provenance row — the lookup under-reports',
      ).toEqual([]);
      expect(
        authored.filter((p) => table[`metadataForms.${p}`] !== undefined),
        'an authored metadata-form leaf carries a provenance row — the lookup over-reports',
      ).toEqual([]);
      // zh-CN has answered every metadata-form leaf, so it contributes the
      // NEGATIVE half only; ja-JP and es-ES still carry the round 10 population
      // and contribute the positive half.
      if (locale === 'zh-CN') {
        expect(echoing, 'zh-CN started echoing a metadata-form leaf again').toEqual([]);
      } else {
        expect(echoing.length, `${locale} has no echoing leaf to sample`).toBeGreaterThan(0);
      }
    });
  }
});

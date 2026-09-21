// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 4 — the DECISION LEDGER for the STANDALONE FIELD panel en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record for ONE panel family, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts` and the three earlier rounds of
// this card extended (`object-field-editor-panel-`, `page-interface-panel-`,
// `dataset-panel-echo-decisions.test.ts`): one row per string leaf, each
// carrying its verdict per locale, the reason it was reached, and the `en`
// source it was judged against.
//
// ## The family
//
// The nine echoing keys of the STANDALONE `field` metadata form — the field
// editor reached on its own, as opposed to the one embedded in the object
// panel. Both string leaves of each are decided: a panel whose field name is
// Chinese and whose tooltip is English is the same defect half fixed.
//
//   ⇒ decided here: 9 label keys · 18 string leaves · 3 locales = 54 decisions.
//
// The card's extension rule also takes in the SECTION HEADING each key sits
// under and the type's own display pair. On this panel all of those were
// ALREADY authored — `field.label` is 字段 / フィールド / Campo and all four
// `field.sections.*` label+description pairs carry their own text in all three
// locales — so the family adds no leaf there. That is a measurement, not an
// omission: the derived pin below walks all 85 string leaves of the `field`
// entry and requires every one of them to be non-echoing, which is what makes
// the claim checkable rather than asserted.
//
// ## THE CONTROL THIS PANEL SUPPLIES THAT NO EARLIER ROUND COULD: the authored
// ## twin at the SAME KEY PATH
//
// `object.fields.fields.*` is the SAME field editor, embedded in the object
// panel, and it was decided in round 1 of this card. Fourteen of the eighteen
// leaves here have a twin there, authored in all three locales, and seven of
// those twins carry a BYTE-IDENTICAL `en` source:
//
//   placeholder.label · valueDomain.label · rows.label ·
//   summaryOperations.object.label · summaryOperations.function.label ·
//   summaryOperations.function.helpText · summaryOperations.field.label
//
// ⇒ the identical key, the identical English, one authored and one echoing, in
// one bundle. Earlier rounds argued from a same-string precedent elsewhere in
// the catalog; here the precedent is the same spec key rendered one panel over.
// An echo cannot be the deliberate rendering when the same key is rendered
// otherwise beside it.
//
// The remaining four keys have no twin at all — `relatedListFilter` (#19085
// added it to `field.form.ts` only) and three of the five `summaryOperations`
// row properties — and are decided from their own helpText and their schema.
//
// ## The #19430 trap, met and checked AT THE SCHEMA before a word was rendered
//
// `field.fields.valueDomain.helpText` names `iana_time_zone`,
// `iso_4217_currency` and `iso_3166_alpha2` in prose. Those are the three
// members of `ValueDomainSchema` (`packages/spec/src/shared/value-domain.zod.ts`),
// a `z.enum`. Rendering them as words would tell an author in their own
// language to write a token the schema refuses — the defect round 2 filed as
// #19430. They are kept English.
//
// ⚠️ The authored twin CANNOT answer this one: `object.fields.fields.valueDomain.helpText`
// reads "Standard the written value must belong to; a write carrying a
// non-member is refused" and names no token at all. The twin settled the
// prose; the schema settled the tokens. Same key, two sources of evidence.
//
// `summaryOperations.function.helpText` is the other leaf that could have
// carried it — its `function` is `z.enum(['count','sum','min','max','avg'])` —
// and it does not: the text is the bare words "Aggregation function" and names
// no member. `summaryOperations.field.helpText` names `count`, one member of
// that same enum, and keeps it English.
//
// ## The instrument, with its controls
//
// Census: flatten every `*.metadata-forms.generated.ts` bundle, compare each
// `.label` leaf against `en`. On base fbc12be31, before this change:
//
//   en string leaves / `.label` leaves            893 / 538
//   POSITIVE CONTROL — labels genuinely translated 500 (zh-CN) · 484 · 484
//   label keys echoing in ALL THREE locales          38 ⇒ 114 leaves
//
// After: 29 keys / 87 leaves, control 509 · 493 · 493 — echoes down 9 and the
// control up 9, same population, same run. A parser matching too broadly
// cannot produce that agreement.
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf
// is still a byte copy of the source revision. All 18 leaves decided here
// carried one in all three locales — 18 rows under `metadataForms.field` per
// locale, and exactly 18 — while the other 67 string leaves of the `field`
// entry carried none in any of them. `pnpm i18n:extract` dropped the 18 rows
// per locale for the leaves this round rendered, so the table now records them
// as authored — asserted below.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { fieldForm } from '@objectstack/spec/data';

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
   * field, `sections` for a section heading. Every row this round is `fields`;
   * the other two are carried because the derived population below reaches
   * them and a later round on this panel will need them.
   */
  scope: 'type' | 'fields' | 'sections';
  /** The bundle key under `field.<scope>` (`field` itself for `type`). */
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
    scope: 'fields',
    key: 'placeholder',
    prop: 'label',
    en: 'Placeholder',
    verdict: ALL_TRANSLATE,
    reason:
      'THE AUTHORED TWIN AT THE SAME KEY PATH, byte-identical en: object.fields.fields.placeholder.label is 占位文本 / プレースホルダー / Marcador de posición — the same spec key, rendered in the field editor embedded in the object panel and decided in round 1 of this card. action.fields.params.placeholder.label is a second exact-string precedent with the identical rendering. Two authored answers to this exact word, and this was the only echo of it.',
  },
  {
    scope: 'fields',
    key: 'placeholder',
    prop: 'helpText',
    en: 'Hint text shown inside the empty input (disappears once a value is entered); use inlineHelpText for always-visible help',
    verdict: ALL_TRANSLATE,
    reason:
      'The twin object.fields.fields.placeholder.helpText carries a SHORTER en ("Hint text shown inside the empty input; disappears once a value is entered") authored as 显示在空输入框内的提示文本；输入内容后消失 / 空の入力欄の内側に表示されるヒント文言。値を入力すると消えます / Texto de ayuda que se muestra dentro del campo vacío; desaparece al introducir un valor. That authored clause is reused verbatim in sense; the extra clause this source carries names `inlineHelpText`, which is KEPT ENGLISH because it is a spec key an author types (field.zod.ts:1854), not an English phrase — the same position-sensitive rule round 3 recorded for `include` inside a helpText.',
  },
  {
    scope: 'fields',
    key: 'valueDomain',
    prop: 'label',
    en: 'Value Domain',
    verdict: ALL_TRANSLATE,
    reason:
      'THE AUTHORED TWIN AT THE SAME KEY PATH, byte-identical en: object.fields.fields.valueDomain.label is 值域 / 値ドメイン / Dominio de valores. It is the only answer this catalog gives to the term, and this was its only echo.',
  },
  {
    scope: 'fields',
    key: 'valueDomain',
    prop: 'helpText',
    en: 'Standard the written value must belong to: iana_time_zone, iso_4217_currency or iso_3166_alpha2. A write carrying a non-member is refused',
    verdict: ALL_TRANSLATE,
    reason:
      'THE #19430 TRAP LEAF OF THIS FAMILY, and the schema was read before a word was rendered. `iana_time_zone` / `iso_4217_currency` / `iso_3166_alpha2` are the three members of ValueDomainSchema (packages/spec/src/shared/value-domain.zod.ts), a z.enum — rendering them as words tells an author to write a token the schema refuses, which is exactly the defect round 2 filed. KEPT ENGLISH. The prose around them follows the twin object.fields.fields.valueDomain.helpText (写入值必须归属的标准；写入非成员值将被拒绝 and its ja/es), and ⚠️ that twin names NO token, so it could not have settled this half: the twin settled the prose, the schema settled the tokens.',
  },
  {
    scope: 'fields',
    key: 'rows',
    prop: 'label',
    en: 'Rows',
    verdict: ALL_TRANSLATE,
    reason:
      'DECIDED BETWEEN TWO AUTHORED PRECEDENTS BY SENSE, not by string. This catalog answers the bare word `Rows` twice: object.fields.fields.rows.label is 行数 / 行数 / Filas (an editor HEIGHT, counted in text rows) and report.fields.rows.label / report.fields.blocks.rows.label are 行 / 行 / Filas (a report axis). This key is the first sense — its own helpText says "Inline editor height in text rows" — so it takes 行数, the byte-identical twin at the same key path, and departs from the report reading in zh-CN and ja-JP. es-ES renders both senses Filas, so no choice arises there.',
  },
  {
    scope: 'fields',
    key: 'rows',
    prop: 'helpText',
    en: 'Inline editor height in text rows',
    verdict: ALL_TRANSLATE,
    reason:
      'The twin object.fields.fields.rows.helpText ("Inline editor height (text rows)") is authored 内联编辑器高度（文本行数） / インライン編集欄の高さ（テキスト行数） / Altura del editor en línea (filas de texto). Same sentence, parenthetical rather than prepositional; rendered to match this source\'s phrasing while keeping the twin\'s vocabulary for every term.',
  },
  {
    scope: 'fields',
    key: 'relatedListFilter',
    prop: 'label',
    en: 'Related List Filter',
    verdict: ALL_TRANSLATE,
    reason:
      'THE ONE LABEL IN THIS FAMILY WITH NO SAME-STRING PRECEDENT: `Related List` returns zero hits across BOTH catalogs, and there is no twin (#19085 added this row to field.form.ts alone). Decided instead by composing this catalog\'s own authored renderings of its two parts — `Related` is 关联 / 関連 / relacionad- (sys_email.fields.related_object.label is 关联对象 / 関連オブジェクト / Objeto relacionado) and `Filter` is 筛选 / フィルター / Filtro (four authored precedents). ⚠️ Recorded as a LITERAL rendering, not an expansion: unlike round 3\'s `include`, the English compound already names its content, so nothing had to be added to make the label answer "filter what?".',
  },
  {
    scope: 'fields',
    key: 'relatedListFilter',
    prop: 'helpText',
    en: "Default filter for this relationship's related list on the parent's detail page — AND-composed with the parent-record match, and the tab badge counts the same set",
    verdict: ALL_TRANSLATE,
    reason:
      '`AND` is the boolean operator the sentence describes the filter being composed with, and this catalog keeps it English inside translated prose on an AUTHORED precedent: dataset.fields.filter.helpText is 以 AND 方式并入每个查询 / すべてのクエリに AND で結合されます / combinado con AND en cada consulta. Kept. Everything else is rendered, `tab` on this catalog\'s authored 标签页 / タブ / pestaña (view.fields.tabs.label); `badge` has no precedent here and takes each locale\'s ordinary word, recorded as the one term in this family chosen without one.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.object',
    prop: 'label',
    en: 'Object',
    verdict: ALL_TRANSLATE,
    reason:
      'HANDED TO THIS FAMILY BY ROUND 3, which read this leaf while judging dataset.fields.object.label, deliberately did NOT use it as evidence there, and named the `field` family as its successor. The twin at the same key path — object.fields.fields.summaryOperations.object.label — is byte-identical en and authored 对象 / オブジェクト / Objeto, and five further exact-string precedents (object.label, hook.fields.object.label, page.fields.object.label, dashboard.fields.globalFilters.object.label and the twin) give the identical answer. Not one authored leaf in this catalog renders the bare word `Object` any other way.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.object',
    prop: 'helpText',
    en: 'Child object to aggregate',
    verdict: ALL_TRANSLATE,
    reason:
      'The twin object.fields.fields.summaryOperations.object.helpText ("Source child object name") is authored 来源子对象名称 / 集計元の子オブジェクト名 / Nombre del objeto hijo de origen. This source says "to aggregate" rather than "source … name", so the twin supplies the vocabulary (子对象 / 子オブジェクト / objeto hijo) and `aggregate` takes this catalog\'s authored 聚合 / 集計 / agregar, from the same twin block.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.function',
    prop: 'label',
    en: 'Function',
    verdict: ALL_TRANSLATE,
    reason:
      'THE AUTHORED TWIN AT THE SAME KEY PATH, byte-identical en: object.fields.fields.summaryOperations.function.label is 函数 / 関数 / Función, and it is the only authored answer to this word in either catalog.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.function',
    prop: 'helpText',
    en: 'Aggregation function',
    verdict: ALL_TRANSLATE,
    reason:
      'THE STRONGEST ROW IN THE FAMILY: the twin object.fields.fields.summaryOperations.function.helpText is byte-identical in `en` AND authored — 聚合函数 / 集計関数 / Función de agregación — so this row copies an existing authored decision about this exact string rather than reaching a new one. ⚠️ Checked for the #19430 trap and clear: the field it documents is z.enum([count,sum,min,max,avg]) (field.zod.ts), but this text names no member, so there is no token to keep.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.field',
    prop: 'label',
    en: 'Field',
    verdict: ALL_TRANSLATE,
    reason:
      'THE AUTHORED TWIN AT THE SAME KEY PATH, byte-identical en: object.fields.fields.summaryOperations.field.label is 字段 / フィールド / Campo, and `field.label` — this panel\'s own type display name — is the same three words. ⚠️ One precedent DELIBERATELY NOT USED: object.fields.lifecycle.ttl.field.label reads 时间字段 in zh-CN but still echoes "Field" in ja-JP and es-ES, so in two of three locales it is not an authored answer at all; it belongs to the `object` family and is left there.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.field',
    prop: 'helpText',
    en: 'Child field to aggregate (ignored for count)',
    verdict: ALL_TRANSLATE,
    reason:
      'The twin object.fields.fields.summaryOperations.field.helpText ("Field on the child object to aggregate (ignored for count)") is authored 子对象上参与聚合的字段（count 时忽略） / 集計対象となる子オブジェクトのフィールド（count では無視） / Campo del objeto hijo que se agrega (se ignora para count). ⭐ `count` is a MEMBER of the summaryOperations.function z.enum and the authored twin already keeps it English in all three locales — the #19430 rule applied one round before this card reached this key. Kept.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.relationshipField',
    prop: 'label',
    en: 'Relationship Field',
    verdict: ALL_TRANSLATE,
    reason:
      'No twin (the object panel does not offer this row) and no exact-string precedent for the compound. Composed from this catalog\'s two authored halves: `relationship` is 关系 / 関係 / relación (field.fields.summaryOperations.helpText renders parent-child relationships as 父子关系 / 親子関係 / relaciones padre-hijo — the PARENT of this very key — and dataset.fields.include.helpText renders Relationship … field names the same way), and `Field` is 字段 / フィールド / Campo as decided two rows above.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.relationshipField',
    prop: 'helpText',
    en: 'Child FK back to this parent (auto-detected when omitted)',
    verdict: ALL_TRANSLATE,
    reason:
      '`FK` is the abbreviation, not a token an author types — the schema key is `relationshipField` and the value is a field name — so it is RENDERED rather than kept, on this catalog\'s authored precedent for the expanded term: sys_oauth_access_token.fields.*.help render `Foreign key to …` as 外键 / 外部キー / Clave foránea in four separate leaves. Contrast the sibling row above, where `AND` IS kept: an abbreviation of an English term is rendered, an operator or enum member an author must type is not.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.filter',
    prop: 'label',
    en: 'Filter',
    verdict: ALL_TRANSLATE,
    reason:
      'No twin, but four exact-string authored precedents all answering identically — view.fields.filter.label, dashboard.fields.widgets.filter.label, dataset.fields.filter.label and dataset.fields.measures.filter.label are every one of them 筛选 / フィルター / Filtro. The last is the closest structural analogue: a row-scoped filter inside an aggregation editor, decided in round 3 of this card.',
  },
  {
    scope: 'fields',
    key: 'summaryOperations.filter',
    prop: 'helpText',
    en: 'Only child rows matching this predicate are aggregated (e.g. status == received)',
    verdict: ALL_TRANSLATE,
    reason:
      '`predicate` takes this catalog\'s authored 判定式 / 述語 / Predicado (object.fields.fields.visibleWhen / readonlyWhen / requiredWhen helpTexts, three authored leaves). The worked example `status == received` is KEPT ENGLISH VERBATIM — `status` is a field name and `received` a stored data value, the same position round 3 recorded for `account.region` and the literal value `account` — because an author who retypes a rendered version of it writes metadata that matches nothing.',
  },
];

function leafOf(bundle: Record<string, any>, d: Decision): unknown {
  const field = bundle.field;
  return d.scope === 'type' ? field?.[d.prop] : field?.[d.scope]?.[d.key]?.[d.prop];
}

/** The provenance-table key for a decided leaf. */
function provenanceKey(d: Decision): string {
  return d.scope === 'type'
    ? `metadataForms.field.${d.prop}`
    : `metadataForms.field.${d.scope}.${d.key}.${d.prop}`;
}

/** The dotted id a decision is reported under. */
function idOf(d: Decision): string {
  return d.scope === 'type' ? `field.${d.prop}` : `field.${d.scope}.${d.key}.${d.prop}`;
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

interface PanelLeaf {
  scope: 'type' | 'fields' | 'sections';
  key: string;
  prop: string;
  en: string;
}

/** Every string leaf of the `field` panel, DERIVED from the `en` catalog. */
function panelLeaves(): PanelLeaf[] {
  const out: PanelLeaf[] = [];
  const field = (enMetadataForms as Record<string, any>).field ?? {};
  for (const [prop, value] of Object.entries(field)) {
    if (typeof value === 'string') out.push({ scope: 'type', key: 'field', prop, en: value });
  }
  for (const scope of ['fields', 'sections'] as const) {
    for (const [key, entry] of Object.entries(field[scope] ?? {})) {
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
  const field = bundle.field;
  return l.scope === 'type' ? field?.[l.prop] : field?.[l.scope]?.[l.key]?.[l.prop];
}

/**
 * The two halves of the blind spot, re-derived from `fieldForm` by the rule
 * `repeater-row-properties.test.ts` uses — a field that enumerates `fields` is
 * walked for its children ONLY when `type === 'repeater'`.
 *
 * `covered` is what that pin sees on this form; `skipped` is what it does not,
 * and the extractor emits catalog keys for BOTH because it walks a form field's
 * declared `fields` whatever the declared type is.
 */
function enumeratedChildren(): { covered: string[]; skipped: string[] } {
  const covered: string[] = [];
  const skipped: string[] = [];
  const walk = (fields: any[] | undefined, prefix = ''): void => {
    for (const f of fields ?? []) {
      if (!f || typeof f !== 'object' || !f.field) continue;
      const path = prefix ? `${prefix}.${f.field}` : String(f.field);
      if (Array.isArray(f.fields)) {
        const sink = f.type === 'repeater' ? covered : skipped;
        for (const child of f.fields) if (child?.field) sink.push(`${path}.${child.field}`);
        walk(f.fields, path);
      }
    }
  };
  walk(((fieldForm as any).sections ?? []).flatMap((s: any) => s.fields ?? []));
  return { covered, skipped };
}

const { covered: ROW_PROPERTIES, skipped: UNWALKED_CHILDREN } = enumeratedChildren();

describe('#19403 round 4 — the ledger itself (controls before verdicts)', () => {
  it('decides every echoing string leaf of the 9 keys this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 9 keys, 18 leaves, three
    // locales, 54 decisions.
    expect(DECISIONS.length).toBe(18);
    expect(new Set(DECISIONS.map((d) => `${d.scope}.${d.key}`)).size).toBe(9);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(54);
    for (const d of DECISIONS) {
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
      ).toBe('helpText+label');
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
    // the source catalog itself and it must flag all 18 rows, or a green
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
      scope: 'fields',
      key: 'valueDomain',
      prop: 'label',
      en: 'Value Domain',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'A synthetic row that exists only to prove this file can refuse an undeclared echo.',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN field.fields.valueDomain.label']);
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

describe('#19403 round 4 — the catalogs hold what the ledger decided', () => {
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

  it('the machine tokens the ledger decided to KEEP are still English in every locale', () => {
    // The #19430 half, asserted rather than described. These are enum members,
    // a spec key and a worked example an author retypes; a later reword that
    // renders one of them writes metadata the schema refuses.
    const kept: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      ['valueDomain', 'helpText', ['iana_time_zone', 'iso_4217_currency', 'iso_3166_alpha2']],
      ['placeholder', 'helpText', ['inlineHelpText']],
      ['summaryOperations.field', 'helpText', ['count']],
      ['summaryOperations.filter', 'helpText', ['status == received']],
      ['relatedListFilter', 'helpText', ['AND']],
    ];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const [key, prop, tokens] of kept) {
        const text = forms.field?.fields?.[key]?.[prop];
        expect(typeof text, `${locale} field.fields.${key}.${prop}`).toBe('string');
        for (const token of tokens) {
          expect(
            (text as string).includes(token),
            `${locale} field.fields.${key}.${prop} no longer carries the token ${token} verbatim`,
          ).toBe(true);
        }
      }
    }
    // Dark — the same lookup with a token none of them carries must NOT pass,
    // so a green above cannot come from an `includes` that matches anything.
    const sample = (zhCNMetadataForms as Record<string, any>).field?.fields?.valueDomain?.helpText as string;
    expect(sample.includes('iso_9999_invented')).toBe(false);
  });
});

describe('#19403 round 4 — the provenance table agrees these leaves are now authored', () => {
  // A second, independent witness to the same fact, from a table nobody edits
  // by hand. An entry exists exactly while a leaf is still a byte copy of the
  // source revision, so re-filling a decided leaf and re-running the extract
  // brings its row back and reds this block — even in the locale where no
  // second locale exists to disagree with it. It fires on a different trigger
  // than the catalog assertion above (a re-fill FOLLOWED BY an extract, rather
  // than the re-fill itself), which is what makes it a witness and not a
  // restatement.
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
      // finds it. Deliberately matched by PATTERN rather than pinned to a
      // family, so a later round of this card cannot red this control by
      // fixing one.
      const sample = Object.keys(table).find((k) => /^metadataForms\.[^.]+\.(fields|sections)\..+\.[^.]+$/.test(k));
      expect(sample, `${locale} provenance table records no metadata-form leaf`).toBeTruthy();
      const parts = /^metadataForms\.([^.]+)\.(fields|sections)\.(.+)\.([^.]+)$/.exec(sample!);
      expect(parts, 'the table key does not decompose').toBeTruthy();
      const [, type, scope, key, prop] = parts!;
      expect(`metadataForms.${type}.${scope}.${key}.${prop}`, 'composing the key back must reproduce it').toBe(sample);
      expect(table[sample!], 'the lookup this file performs finds a key the table holds').toBeTruthy();
      // And the composer under test builds exactly those two templates.
      expect(provenanceKey({ ...DECISIONS[0], scope: 'fields', key: 'k', prop: 'label' })).toBe(
        'metadataForms.field.fields.k.label',
      );
      expect(provenanceKey({ ...DECISIONS[0], scope: 'type', key: 'field', prop: 'label' })).toBe(
        'metadataForms.field.label',
      );
    });
  }
});

describe('#19403 round 4 — the panel population, DERIVED (the pin no census had)', () => {
  it('the derivation reaches this panel, and only this panel', () => {
    // Lit — floors, not exact counts, so a key added to the field form is
    // caught by the echo rule below rather than by a number nobody can
    // interpret. Measured on base fbc12be31: 85 string leaves on the `field`
    // entry (the 18 decided here plus 67 already-authored neighbours).
    expect(PANEL_LEAVES.length).toBeGreaterThan(80);
    expect(new Set(PANEL_LEAVES.map((l) => `${l.scope}.${l.key}`)).size).toBeGreaterThan(35);
    for (const key of ['placeholder', 'valueDomain', 'summaryOperations', 'summaryOperations.filter', 'options.color']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} is on the field panel`,
      ).toBe(true);
    }
    for (const key of ['basics', 'configuration', 'formula', 'advanced']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === key)).toBe(true);
    }
    expect(PANEL_LEAVES.some((l) => l.scope === 'type' && l.prop === 'label')).toBe(true);
    // Dark — the derivation is the `field` entry and nothing else. These keys
    // exist in the catalog on OTHER types, so a walk that read the whole bundle
    // would pick them up.
    for (const key of ['interfaceConfig', 'drilldown', 'runtimeFilter', 'retryPolicy', 'validations', 'include']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} belongs to another type and is not a field leaf`,
      ).toBe(false);
    }
    for (const key of ['dataset_binding', 'joined_blocks', 'interface', 'source']) {
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
        const id = leaf.scope === 'type' ? `field.${leaf.prop}` : `field.${leaf.scope}.${leaf.key}.${leaf.prop}`;
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

describe('#19403 round 4 — the blind spot, FOURTH shape: a type-level coverage control over a per-field gap', () => {
  it('what the existing pin CAN see on this panel was already translated — the covered slice is its own control', () => {
    // `repeater-row-properties.test.ts` derives a row property for every child
    // of a `type: 'repeater'` field. On `fieldForm` that is exactly ONE
    // repeater — `options`, with six children — and every one of those six
    // carried its own text in all three locales before this round. Everything
    // the existing pin could see here was fine.
    expect(ROW_PROPERTIES.length).toBe(6);
    expect(ROW_PROPERTIES).toContain('options.color');
    expect(ROW_PROPERTIES).toContain('options.visibleWhen');
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const key of ROW_PROPERTIES) {
        const en = (enMetadataForms as Record<string, any>).field?.fields?.[key]?.label;
        expect(typeof en, `en field.fields.${key}.label`).toBe('string');
        expect(
          forms.field?.fields?.[key]?.label,
          `${locale} field.fields.${key}.label was translated before this round and must stay so`,
        ).not.toBe(en);
      }
    }
  });

  it('what it CANNOT see is a SECOND enumerated parent on the same form, whose five children were the broken ones', () => {
    // ⭐ The fourth shape, and the sharpest yet. `summaryOperations` declares
    // five children exactly as `options` does, so the EXTRACTOR emits a catalog
    // key for each — it walks a form field's declared `fields` whatever the
    // declared type is. The pin does not: it filters `type === 'repeater'`, and
    // `summaryOperations` is a `composite`. All five of its children echoed in
    // all three locales, and they are five of the nine keys this round decides.
    expect(UNWALKED_CHILDREN.length).toBe(5);
    for (const child of ['object', 'function', 'field', 'relationshipField', 'filter']) {
      expect(UNWALKED_CHILDREN).toContain(`summaryOperations.${child}`);
      expect(
        ROW_PROPERTIES.includes(`summaryOperations.${child}`),
        `summaryOperations.${child} is NOT derived by the repeater pin`,
      ).toBe(false);
      // …and the extractor emitted it anyway, which is why the gap was invisible
      // rather than merely uncovered.
      expect(
        typeof (enMetadataForms as Record<string, any>).field?.fields?.[`summaryOperations.${child}`]?.label,
        `the catalog carries a key for summaryOperations.${child}`,
      ).toBe('string');
    }
    const decidedUnwalked = DECISIONS.filter((d) => UNWALKED_CHILDREN.includes(d.key));
    expect(decidedUnwalked.length, 'both string leaves of all five unwalked children are decided here').toBe(10);
  });

  it("⭐ the existing pin's own coverage control reports `field` as covered — and that green is produced by the OTHER parent", () => {
    // This is the half worth writing down. `repeater-row-properties.test.ts`
    // asserts `carrying.has('field') === true` as its vacuity control, and that
    // assertion PASSES — on `options`, whose six children were never broken —
    // while the five broken children hang off `summaryOperations`, on the same
    // form, invisible to it. A per-TYPE coverage control cannot see a per-FIELD
    // gap: the pin is green over exactly the keys that were broken, one
    // ENUMERATED PARENT to the side of what it walks, rather than one level up
    // as round 3 measured.
    const coveredParents = new Set(ROW_PROPERTIES.map((k) => k.replace(/\.[^.]+$/, '')));
    const skippedParents = new Set(UNWALKED_CHILDREN.map((k) => k.replace(/\.[^.]+$/, '')));
    expect([...coveredParents]).toEqual(['options']);
    expect([...skippedParents]).toEqual(['summaryOperations']);
    // The type is "carried" — the control the other pin reads — yet none of the
    // leaves this round had to decide is inside its derivation.
    expect(ROW_PROPERTIES.length, 'field DOES carry repeater row properties, so the other pin counts it covered').toBeGreaterThan(0);
    const decidedInside = DECISIONS.filter((d) => ROW_PROPERTIES.includes(d.key)).map(idOf);
    expect(decidedInside, 'no leaf decided here is one the existing pin already derives').toEqual([]);
    // And the repeater parents' OWN string leaves are outside it in both
    // directions — round 3's shape, still true here: `summaryOperations.label`
    // and `.helpText` were authored, `options.label` and `.helpText` too, and
    // neither pair is a row property.
    for (const parent of ['options', 'summaryOperations']) {
      expect(ROW_PROPERTIES.includes(parent), `${parent} is not itself a row property`).toBe(false);
      expect(UNWALKED_CHILDREN.includes(parent), `${parent} is not itself an unwalked child`).toBe(false);
    }
  });
});

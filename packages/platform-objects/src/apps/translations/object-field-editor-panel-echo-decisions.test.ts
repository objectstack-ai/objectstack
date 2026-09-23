// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 — the DECISION LEDGER for the OBJECT FIELD-EDITOR panel en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record for ONE panel family, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts`: one row per string leaf, each
// carrying its verdict per locale, the reason it was reached, and the `en`
// source it was judged against.
//
// ## The family, and why the card is not taken in one sweep
//
// The card's population is the `.label` leaves of the metadata-form catalogs;
// 79 of the 538 read their `en` source in all three locales on this base. Those
// 79 are not one card's worth of judgement, so this round takes one family —
// the object field editor, `object.fields['fields.*']`, the 14 keys the card
// samples (placeholder, valueDomain, rows, deleteBehavior, expression …) — and
// decides every string leaf of those keys, `helpText` included: a panel whose
// field name is Chinese and whose tooltip is English is the same defect half
// fixed.
//
// ⇒ decided here: 14 keys × 2 string leaves × 3 locales = 84 decisions.
//
// ## The instrument, with both of its controls
//
// Census: flatten every `*.metadata-forms.generated.ts` bundle, compare each
// `.label` leaf against `en`. On base 0862063ba, before this change:
//
//   en `.label` leaves                             538
//   POSITIVE CONTROL — labels genuinely translated  459 (zh-CN) · 443 · 443
//   labels echoing `en`                              79 (zh-CN) · 95 · 95
//   label keys echoing in ALL THREE locales           79 ⇒ 237 leaves
//
// The control is what makes the echo count mean something: 459 translated
// against 79 echoing is a discrimination, not a parser that matches
// everything.
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf
// is still a byte copy of the source revision. Every one of the 28 leaves
// decided here carried one in all three locales; every AUTHORED leaf on the
// same panel (label, type, required, defaultValue, maxLength, …) carried none
// in any of them. `pnpm i18n:extract` dropped the 84 rows for the leaves this
// round translated, so the table now records them as authored.
//
// ## Why no pin saw this panel — measured, not assumed
//
// `repeater-row-properties.test.ts` derives its population from the forms and
// already refuses an en-echo inside it. It filters on `spec.type ===
// 'repeater'`, and the object form declares its field editor as
// `{ field: 'fields', type: 'record' }` with 35 children — so that derivation
// yields exactly four row properties for `objectForm` (`fields.options.label`
// / `.value` / `.color` / `.description`) and none of the 14 keys here. The
// derived pin at the foot of this file closes that gap for this panel: it
// walks the `object.fields['fields.*']` leaves out of the `en` catalog, so a
// key added to the field editor tomorrow, or a re-fill of a decided one, is
// red on the day it lands rather than a card later.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';

const TRANSLATED_LOCALES: ReadonlyArray<readonly [string, Record<string, any>]> = [
  ['zh-CN', zhCNMetadataForms as Record<string, any>],
  ['ja-JP', jaJPMetadataForms as Record<string, any>],
  ['es-ES', esESMetadataForms as Record<string, any>],
];

/** `translate` — the echo was an unauthored fill. `echo` — the English IS the rendering. */
type Verdict = 'translate' | 'echo';

interface Decision {
  /** Metadata type owning the form panel. */
  type: string;
  /** The bundle key under `<type>.fields`. */
  key: string;
  /** Which string leaf of that entry this row decides. */
  prop: 'label' | 'helpText';
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
 * the leaf held a provenance entry in all three locales while its authored
 * neighbours held none.
 */
const PANEL_CONTROL =
  'Prose, not a term of art. Its neighbours on this same panel (defaultValue, maxLength, searchable, sortable, returnType) are authored in all three locales, and this leaf carried a provenance-table entry in all three while none of them did — which is what an unauthored fill looks like here.';

const DECISIONS: readonly Decision[] = [
  {
    type: 'object',
    key: 'fields.placeholder',
    prop: 'label',
    en: 'Placeholder',
    verdict: ALL_TRANSLATE,
    reason:
      "This catalog's own authored answer for this exact English word is one panel away: action.fields.params.placeholder.label reads 占位文本 / プレースホルダー / Marcador de posición. A translator who judged the English right here would have had to judge it wrong there. A fill.",
  },
  {
    type: 'object',
    key: 'fields.placeholder',
    prop: 'helpText',
    en: 'Hint text shown inside the empty input; disappears once a value is entered',
    verdict: ALL_TRANSLATE,
    reason: PANEL_CONTROL,
  },
  {
    type: 'object',
    key: 'fields.valueDomain',
    prop: 'label',
    en: 'Value Domain',
    verdict: ALL_TRANSLATE,
    reason:
      'A term of art with a settled rendering in each locale (值域 / 値ドメイン / Dominio de valores), and this panel translates its other constrained-value labels — maskingRule and returnType are authored — rather than keeping them English. The sibling field panel echoes the same key, which is the extractor default reaching both panels, not the same judgement taken twice.',
  },
  {
    type: 'object',
    key: 'fields.valueDomain',
    prop: 'helpText',
    en: 'Standard the written value must belong to; a write carrying a non-member is refused',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose stating a refusal rule — exactly the kind of sentence an author needs in their own language — and a byte copy in all three locales while the adjacent maskingRule.helpText, a longer sentence with embedded literals, is authored in all three.',
  },
  {
    type: 'object',
    key: 'fields.rows',
    prop: 'label',
    en: 'Rows',
    verdict: ALL_TRANSLATE,
    reason:
      'Decided AGAINST the same-string precedent, which is why it needed judging: report.fields.rows.label is authored as 行 / 行 / Filas, but that leaf names a pivot axis while this one is a COUNT of text rows (its own helpText says so). zh-CN and ja-JP therefore depart to 行数; es-ES keeps Filas, which carries both senses.',
  },
  {
    type: 'object',
    key: 'fields.rows',
    prop: 'helpText',
    en: 'Inline editor height (text rows)',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose, and the leaf that settles the label above it: it is what tells a reader this Rows is a height, not an axis. Left English it would leave the one disambiguating sentence on the panel unreadable in three locales.',
  },
  {
    type: 'object',
    key: 'fields.lookupFilters',
    prop: 'label',
    en: 'Lookup Filters',
    verdict: ALL_TRANSLATE,
    reason:
      'Rendered with the machine token kept: `lookup` is a field TYPE value here, and the authored zh-CN/ja-JP/es-ES text of fields.reference.helpText keeps both `lookup` and `tree` in English inside otherwise translated prose. Only the common noun is rendered, with this catalog\'s settled word for Filter (筛选 / フィルター / Filtro, from view.fields.filter and dashboard.fields.widgets.filter).',
  },
  {
    type: 'object',
    key: 'fields.lookupFilters',
    prop: 'helpText',
    en: 'Filter rules applied to the picker ({field, operator, value})',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose wrapped around an authorable literal. The literal ({field, operator, value}) is the shape the author must type and stays byte-identical; the sentence around it is rendered — the same split the authored maskingRule.helpText makes for its preset literals.',
  },
  {
    type: 'object',
    key: 'fields.deleteBehavior',
    prop: 'label',
    en: 'Delete Behavior',
    verdict: ALL_TRANSLATE,
    reason:
      'The sharpest case on this panel: the SAME concept is authored one metadata type across — field.fields.deleteBehavior.label reads 删除行为 / 削除動作 / Comportamiento al eliminar — while the object panel\'s copy stayed English. One concept cannot be a decision on one panel and the right rendering on the other.',
  },
  {
    type: 'object',
    key: 'fields.deleteBehavior',
    prop: 'helpText',
    en: 'What happens when the referenced record is deleted',
    verdict: ALL_TRANSLATE,
    reason:
      'Same evidence as its label: field.fields.deleteBehavior.helpText carries the authored sentence for a near-identical English source in all three locales (被引用记录删除时的处理方式 / 参照先レコード削除時の動作 / Qué ocurre cuando se elimina el registro referenciado).',
  },
  {
    type: 'object',
    key: 'fields.expression',
    prop: 'label',
    en: 'Expression',
    verdict: ALL_TRANSLATE,
    reason:
      'Authored at two other paths in this package for the identical English word: field.fields.expression.label and objects.sys_job.fields.schedule_expression.label, both 表达式 / 式 / Expresión in all three locales.',
  },
  {
    type: 'object',
    key: 'fields.expression',
    prop: 'helpText',
    en: 'CEL formula expression',
    verdict: ALL_TRANSLATE,
    reason:
      'CEL is a language name and stays verbatim; the rest is prose. The formula vocabulary already exists on this very panel — returnType.helpText ("Result type for formulas") is authored in all three locales — so this leaf was simply never reached.',
  },
  {
    type: 'object',
    key: 'fields.summaryOperations',
    prop: 'label',
    en: 'Summary Operations',
    verdict: ALL_TRANSLATE,
    reason:
      'field.fields.summaryOperations.label authors the same container under the same name in all three locales (汇总操作 / 集計操作 / Operaciones de resumen). The object panel holds the identical concept and stayed English.',
  },
  {
    type: 'object',
    key: 'fields.summaryOperations',
    prop: 'helpText',
    en: 'Roll-up: which child object, which field, which aggregation',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose naming three vocabularies (child object, field, aggregation) that this catalog already renders elsewhere, and its sibling field.fields.summaryOperations.helpText is authored for the same roll-up sentence — es-ES keeps "roll-up" exactly as that sibling does.',
  },
  {
    type: 'object',
    key: 'fields.summaryOperations.object',
    prop: 'label',
    en: 'Object',
    verdict: ALL_TRANSLATE,
    reason:
      'The container above it was authored on the sibling panel while its three row properties were not — the fill pattern, key for key. 对象 / オブジェクト / Objeto is what this catalog calls Object at nine other paths (object.label, hook.fields.object, page.fields.object, dashboard.fields.globalFilters.object, …).',
  },
  {
    type: 'object',
    key: 'fields.summaryOperations.object',
    prop: 'helpText',
    en: 'Source child object name',
    verdict: ALL_TRANSLATE,
    reason:
      'Four words of prose, no machine token, and the neighbouring reference.helpText — a far longer sentence about the same relationship — is authored in all three locales.',
  },
  {
    type: 'object',
    key: 'fields.summaryOperations.field',
    prop: 'label',
    en: 'Field',
    verdict: ALL_TRANSLATE,
    reason:
      '字段 / フィールド / Campo is this catalog\'s authored answer for the bare word Field at seven other paths (field.label, page.fields.interfaceConfig.sort.field, dataset.fields.measures.field, action.fields.params.field, …). Only the roll-up row properties kept the English.',
  },
  {
    type: 'object',
    key: 'fields.summaryOperations.field',
    prop: 'helpText',
    en: 'Field on the child object to aggregate (ignored for count)',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose with one machine value inside it. `count` is an aggregation value the author writes, so it stays English, following this catalog\'s own token discipline in the authored fields.reference.helpText; the sentence around it is rendered.',
  },
  {
    type: 'object',
    key: 'fields.summaryOperations.function',
    prop: 'label',
    en: 'Function',
    verdict: ALL_TRANSLATE,
    reason:
      'Rendered as the plain word (函数 / 関数 / Función) and deliberately NOT as "aggregation function": the source says Function at the label and Aggregation function at the helpText one line below, and collapsing the two would translate away a distinction the source draws.',
  },
  {
    type: 'object',
    key: 'fields.summaryOperations.function',
    prop: 'helpText',
    en: 'Aggregation function',
    verdict: ALL_TRANSLATE,
    reason:
      'Two words, and the term this catalog already uses for aggregation in the authored sibling roll-up sentence (聚合 / 集計 / agregación). Left English it would be the only untranslated tooltip in a panel whose every other tooltip is authored.',
  },
  {
    type: 'object',
    key: 'fields.autonumberFormat',
    prop: 'label',
    en: 'Autonumber Format',
    verdict: ALL_TRANSLATE,
    reason:
      'A compound of two ordinary words: Format is authored as 格式 / フォーマット / Formato at three other paths (dataset.fields.measures.format, sys_saved_report.format, sys_report_schedule.format), and this panel authors its other format-shaped label, maskingRule, rather than keeping it English.',
  },
  {
    type: 'object',
    key: 'fields.autonumberFormat',
    prop: 'helpText',
    en: 'e.g. "INV-{0000}"; date tokens {YYYY}/{MM}/{DD} and {field_name} interpolation supported',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose around authorable literals. The tokens ("INV-{0000}", {YYYY}/{MM}/{DD}, {field_name}) are the syntax the author types and stay byte-identical in every locale; only the sentence that explains them is rendered.',
  },
  {
    type: 'object',
    key: 'fields.visibleWhen',
    prop: 'label',
    en: 'Visible When',
    verdict: ALL_TRANSLATE,
    reason:
      'The phrase already has an authored answer in this catalog, twice: field.fields.options.visibleWhen.label and action.fields.params.visible.label both read 可见条件 / 表示条件 / Condición de visibilidad.',
  },
  {
    type: 'object',
    key: 'fields.visibleWhen',
    prop: 'helpText',
    en: 'CEL predicate — field is shown only when TRUE',
    verdict: ALL_TRANSLATE,
    reason:
      'The catalog\'s authored CEL sentences (action.fields.params.visible / disabled helpText) supply the pattern. `predicate` is kept distinct from `expression` — 判定式 / 述語 / predicado — because this panel uses both words two entries apart, one for a boolean and one for a formula.',
  },
  {
    type: 'object',
    key: 'fields.readonlyWhen',
    prop: 'label',
    en: 'Readonly When',
    verdict: ALL_TRANSLATE,
    reason:
      'Composed from two halves this catalog has already authored: readonly is 只读 / 読み取り専用 / Solo lectura on this same panel, and the "… When" suffix has its rendering at field.fields.options.visibleWhen. Nothing here needed inventing, which is why leaving it English was never a decision.',
  },
  {
    type: 'object',
    key: 'fields.readonlyWhen',
    prop: 'helpText',
    en: 'CEL predicate — field is read-only when TRUE (enforced server-side)',
    verdict: ALL_TRANSLATE,
    reason:
      'Same pattern as visibleWhen.helpText, and the parenthetical matters most to the reader who cannot read it: "(enforced server-side)" is the sentence that says this is not a UI-only hint. This panel renders its other parenthetical qualifiers in all three locales.',
  },
  {
    type: 'object',
    key: 'fields.requiredWhen',
    prop: 'label',
    en: 'Required When',
    verdict: ALL_TRANSLATE,
    reason:
      'Composed from two halves this catalog has already authored: required is 必填 / 必須 / Obligatorio on this same panel, and the "… When" suffix has its rendering at field.fields.options.visibleWhen.',
  },
  {
    type: 'object',
    key: 'fields.requiredWhen',
    prop: 'helpText',
    en: 'CEL predicate — field is required when TRUE (enforced server-side)',
    verdict: ALL_TRANSLATE,
    reason:
      'Same pattern as its readonly twin, and the same reason for the parenthetical: a required-when rule the server enforces is a validation contract, not a hint, and the sentence saying so was English in all three locales.',
  },
];

/** The leaf a row points at, in a given catalog. */
function leafOf(forms: Record<string, any>, d: Decision): unknown {
  return forms[d.type]?.fields?.[d.key]?.[d.prop];
}

/**
 * The ledger's own refusal, as a predicate so it can be PROVED capable of
 * firing. Every verdict in this round is `translate`, so asserting the rule
 * over `DECISIONS` alone would be a check that evaluates nothing.
 */
function undeclaredEchoes(rows: readonly Decision[]): string[] {
  const bad: string[] = [];
  for (const d of rows) {
    for (const [locale, verdict] of Object.entries(d.verdict)) {
      if (verdict !== 'echo') continue;
      if ((d.departures?.[locale] ?? '').length <= 40) bad.push(`${locale} ${d.type}.fields.${d.key}.${d.prop}`);
    }
  }
  return bad;
}

/** Every string leaf of the object field-editor panel, derived from the `en` catalog. */
function panelLeaves(): Array<{ key: string; prop: string; en: string }> {
  const out: Array<{ key: string; prop: string; en: string }> = [];
  const fields = (enMetadataForms as Record<string, any>).object?.fields ?? {};
  for (const [key, entry] of Object.entries(fields)) {
    if (!key.startsWith('fields.') || !entry || typeof entry !== 'object') continue;
    for (const [prop, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value === 'string') out.push({ key, prop, en: value });
    }
  }
  return out;
}

const PANEL_LEAVES = panelLeaves();

describe('#19403 — the ledger itself (controls before verdicts)', () => {
  it('decides every string leaf of the 14 keys this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 14 keys, 28 leaves, three
    // locales, 84 decisions.
    expect(DECISIONS.length).toBe(28);
    expect(new Set(DECISIONS.map((d) => d.key)).size).toBe(14);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(84);
    for (const d of DECISIONS) {
      expect(d.type, 'this round is the object field-editor panel only').toBe('object');
      expect(d.key.startsWith('fields.'), `${d.key} is outside this panel`).toBe(true);
      expect(Object.keys(d.verdict).sort(), `${d.key}.${d.prop} names every translated locale`).toEqual([
        'es-ES',
        'ja-JP',
        'zh-CN',
      ]);
    }
    // Every decided key is decided on BOTH of its string leaves — a panel
    // whose field name is translated and whose tooltip is not is the same
    // defect half fixed.
    for (const key of new Set(DECISIONS.map((d) => d.key))) {
      expect(
        DECISIONS.filter((d) => d.key === key)
          .map((d) => d.prop)
          .sort(),
        `${key} is decided on one leaf only`,
      ).toEqual(['helpText', 'label']);
    }
  });

  it('every row is pinned to the live `en` source it was decided against', () => {
    for (const d of DECISIONS) {
      expect(
        (enMetadataForms as Record<string, any>)[d.type]?.fields?.[d.key]?.[d.prop],
        `en ${d.type}.fields.${d.key}.${d.prop} moved — re-judge the decision, do not refresh this row`,
      ).toBe(d.en);
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must fail for all 28 rows, or a green
    // verdict run means nothing.
    const flagged = DECISIONS.filter((d) => leafOf(enMetadataForms as Record<string, any>, d) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `${d.type}.fields.${d.key}.${d.prop} records no reason`).toBeGreaterThan(40);
    }
  });

  it('refuses an `echo` verdict that carries no per-locale reason — proved on a synthetic row', () => {
    // Every verdict in this round is `translate`, so the rule has nothing to
    // evaluate over DECISIONS. Assert it there AND prove the predicate fires,
    // or the requirement is a phantom check that deleting would leave green.
    expect(undeclaredEchoes(DECISIONS), 'a declared echo here carries no reason').toEqual([]);

    const synthetic: Decision = {
      type: 'object',
      key: 'fields.placeholder',
      prop: 'label',
      en: 'Placeholder',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'A synthetic row that exists only to prove this file can refuse an undeclared echo.',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN object.fields.fields.placeholder.label']);
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

describe('#19403 — the catalogs hold what the ledger decided', () => {
  for (const [locale, forms] of TRANSLATED_LOCALES) {
    it(`${locale}: every decided leaf matches its verdict`, () => {
      for (const d of DECISIONS) {
        const id = `${locale} ${d.type}.fields.${d.key}.${d.prop}`;
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

describe('#19403 — the panel population, DERIVED (the pin no census had)', () => {
  it('the derivation reaches this panel, and only this panel', () => {
    // Lit — floors, not exact counts, so a field added to the editor is caught
    // by the echo rule below rather than by a number nobody can interpret.
    // Measured on base 0862063ba: 41 entries, 78 string leaves.
    expect(PANEL_LEAVES.length).toBeGreaterThan(70);
    expect(new Set(PANEL_LEAVES.map((l) => l.key)).size).toBeGreaterThan(35);
    for (const key of ['fields.placeholder', 'fields.summaryOperations.function', 'fields.options.label']) {
      expect(
        PANEL_LEAVES.some((l) => l.key === key),
        `${key} is on the object field-editor panel`,
      ).toBe(true);
    }
    // Dark — the derivation is not "every key in the catalog". The object
    // form's own top-level keys and the sibling `field` panel are outside it.
    for (const key of ['name', 'label', 'enable.feeds']) {
      expect(PANEL_LEAVES.some((l) => l.key === key), `${key} is not a field-editor leaf`).toBe(false);
    }
    expect(PANEL_LEAVES.every((l) => l.prop === 'label' || l.prop === 'helpText')).toBe(true);
  });

  it('no leaf on this panel reads its `en` source unless the ledger decided it is an echo', () => {
    const undecided: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const { key, prop, en } of PANEL_LEAVES) {
        if (forms.object?.fields?.[key]?.[prop] !== en) continue;
        const decided = DECISIONS.find((d) => d.key === key && d.prop === prop);
        if (decided?.verdict[locale] === 'echo') continue;
        undecided.push(`${locale} object.fields.${key}.${prop} (${JSON.stringify(en)})`);
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
      ({ key, prop, en }) => (enMetadataForms as Record<string, any>).object?.fields?.[key]?.[prop] === en,
    );
    expect(flagged.length).toBe(PANEL_LEAVES.length);
  });
});

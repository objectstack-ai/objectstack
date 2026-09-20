// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19355 — the DECISION LEDGER for the report / dataset panel en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record for the four keys #19355 names, one row per string
// leaf, each with the verdict and the reason it was reached.
//
// Why the population here is a LIST while `repeater-row-properties.test.ts`
// DERIVES its own. That file's population is the enumerated repeater row
// properties — 124 of them, measured on this base — and these four keys are
// top-level form fields, outside it. Widening that derivation to all declared
// form-field paths (417, same base) would be red on 230 further echo leaves
// across 82 keys the moment it landed: neighbouring debt nobody has decided
// yet. A pin that lands red is not a pin, so the derived population stays as
// #17508 drew it, and the DECIDED leaves are enumerated here instead. A key
// enters this list when someone judges it, never before.
//
// The instrument that measured the verdicts, with both of its controls, is the
// package's own provenance table `<locale>.source-hashes.generated.ts`: an
// entry exists exactly while the leaf is still a byte copy of the source
// revision. Every leaf this card found echoing carried one in all three
// locales (positive control); `dataset.fields.measures.helpText`, the one leaf
// at these keys that a translator had already written, carried none in any of
// them (negative control). `pnpm i18n:extract` dropped the 21 rows for the
// leaves this card translated, so the table now records them as authored.
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

const SIBLING_PRECEDENT =
  'The same panel carries the identical concept one repeater level down, with text #19345 authored deliberately in all three locales. A translator who judged the English word right at the top level would not have written the translated one a few entries below it, so the echo was a fill, not a rendering.';

const DECISIONS: readonly Decision[] = [
  {
    type: 'report',
    key: 'dataset',
    prop: 'label',
    en: 'Dataset',
    verdict: ALL_TRANSLATE,
    reason: `${SIBLING_PRECEDENT} Precedent: report.fields['blocks.dataset'].`,
  },
  {
    type: 'report',
    key: 'dataset',
    prop: 'helpText',
    en: 'Dataset to bind (measures/dimensions come from its semantic layer)',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose, not a term of art, and it was a byte copy in all three locales while the sibling helpTexts on the same panel (type, columns, order, chart) were authored. A fill.',
  },
  {
    type: 'report',
    key: 'values',
    prop: 'label',
    en: 'Values',
    verdict: ALL_TRANSLATE,
    reason: `${SIBLING_PRECEDENT} Precedent: report.fields['blocks.values'].`,
  },
  {
    type: 'report',
    key: 'values',
    prop: 'helpText',
    en: 'Measure names (from the dataset) to display',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose. Its own sibling order.helpText names the same two vocabularies (rows/columns dimensions, values measures) in authored text in every locale, so the vocabulary existed and this leaf simply never got it.',
  },
  {
    type: 'report',
    key: 'rows',
    prop: 'label',
    en: 'Rows',
    verdict: ALL_TRANSLATE,
    reason: `${SIBLING_PRECEDENT} Precedent: report.fields['blocks.rows'], and the adjacent top-level columns is authored on the same panel.`,
  },
  {
    type: 'report',
    key: 'rows',
    prop: 'helpText',
    en: 'Dimension names (from the dataset) to group rows by',
    verdict: ALL_TRANSLATE,
    reason:
      'Prose, and the neighbouring columns.helpText — the same sentence for the other axis — is authored in all three locales. Nothing distinguishes the two but one having been reached.',
  },
  {
    type: 'dataset',
    key: 'measures',
    prop: 'label',
    en: 'Measures',
    verdict: ALL_TRANSLATE,
    reason:
      'The sharpest case: the SAME leaf carried a hand-authored helpText in all three locales while its label was a byte copy of the source. One leaf cannot be a decision and a fill at once, and the helpText settles which one it was.',
  },
  {
    type: 'dataset',
    key: 'measures',
    prop: 'helpText',
    en: 'Each: name, aggregate, field (optional for count), and display format/currency',
    verdict: ALL_TRANSLATE,
    reason:
      'Already authored before this card in all three locales — recorded because it is this ledger\'s negative control: the one leaf at these four keys that held no provenance-table entry, which is what an authored leaf looks like.',
  },
];

/** The leaf a row points at, in a given catalog. */
function leafOf(forms: Record<string, any>, d: Decision): unknown {
  return forms[d.type]?.fields?.[d.key]?.[d.prop];
}

describe('#19355 — the ledger itself (controls before verdicts)', () => {
  it('decides every string leaf of the four keys the card names, and nothing else', () => {
    // Lit — the ledger is the size it claims: four keys, eight leaves, three
    // locales, 24 decisions.
    expect(DECISIONS.length).toBe(8);
    expect(new Set(DECISIONS.map((d) => `${d.type}.fields.${d.key}`))).toEqual(
      new Set(['report.fields.values', 'report.fields.rows', 'report.fields.dataset', 'dataset.fields.measures']),
    );
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(24);
    for (const d of DECISIONS) {
      expect(Object.keys(d.verdict).sort(), `${d.type}.${d.key}.${d.prop} names every translated locale`).toEqual([
        'es-ES',
        'ja-JP',
        'zh-CN',
      ]);
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
    // the source catalog itself and it must fail for all 8 rows, or a green
    // verdict run means nothing.
    const flagged = DECISIONS.filter((d) => leafOf(enMetadataForms as Record<string, any>, d) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason, and every `echo` records its per-locale departure', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `${d.type}.fields.${d.key}.${d.prop} records no reason`).toBeGreaterThan(40);
      for (const [locale, verdict] of Object.entries(d.verdict)) {
        if (verdict !== 'echo') continue;
        const departure = d.departures?.[locale] ?? '';
        expect(
          departure.length,
          `${locale} ${d.type}.fields.${d.key}.${d.prop} is a declared echo with no reason — an undeclared echo is the debt this ledger exists to tell apart`,
        ).toBeGreaterThan(40);
      }
    }
  });
});

describe('#19355 — the catalogs hold what the ledger decided', () => {
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

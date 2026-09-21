// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The `view` panel's `userFilters` tooltip names the legal values of a STRICT
// enum, and it is the only place that panel names them at all. So that
// sentence is not ordinary prose: the tokens inside it are what an author —
// or an AI reading the panel — types into `userFilters.element`, and
// `UserFiltersSchema` refuses anything else.
//
// All three translated catalogs used to render those tokens as ordinary words
// (下拉 / 标签页 / 开关 · ドロップダウン / タブ / トグル ·
// desplegable / pestañas / interruptor), so a translated-locale author was
// shown a value the schema rejects. The repair keeps the enum values verbatim
// English inside the translated sentence and leaves the prose around them
// translated — the shape the `page` Interface panel already uses for its
// filter-mode labels.
//
// This pins THAT leaf, in the three locales, and nothing wider: the assertion
// is per-value and the values are checked against the schema itself, so a
// token that stops being writable reddens here rather than being re-spelled
// into the tooltip by hand.
//
// Two controls keep it from passing vacuously:
//
//   1. THE SCHEMA LEG. Every token asserted present is first `safeParse`d
//      through `UserFiltersSchema` and must be ACCEPTED, and the words the
//      translations used to carry are `safeParse`d and must be REFUSED. A
//      tooltip rewritten to name some other word passes leg 2 and fails leg 1.
//   2. THE STILL-TRANSLATED LEG. Each translated helpText must differ from the
//      `en` source and must still carry its own prose. "Fixing" the red by
//      copying the English sentence into all three catalogs — the inverse
//      defect, and the one #19403 was filed for — fails this leg.

import { describe, it, expect } from 'vitest';
import { UserFiltersSchema } from '@objectstack/spec/ui';

import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';

/** The values `UserFiltersSchema.element` accepts — asserted below, not assumed. */
const ELEMENT_VALUES = ['dropdown', 'tabs', 'toggle'] as const;

/**
 * What each locale's tooltip used to name in place of the tokens above.
 *
 * `tabs` is deliberately absent from every row: its former word is also the
 * locale's ordinary word for the "tab presets" PROSE at the end of the same
 * sentence (标签页预设 · タブプリセット · preajustes de pestañas), which is
 * translated on purpose and must stay. Asserting its absence would demand the
 * prose be de-translated — the inverse defect again — so `tabs` is covered by
 * the verbatim-presence leg alone.
 */
const FORMER_TRANSLATIONS: Readonly<Record<string, readonly string[]>> = {
  'zh-CN': ['下拉', '开关'],
  'ja-JP': ['ドロップダウン', 'トグル'],
  'es-ES': ['desplegable', 'interruptor'],
};

/** A fragment of prose each locale must still render in its own language. */
const PROSE_ANCHOR: Readonly<Record<string, string>> = {
  'zh-CN': '快速筛选栏',
  'ja-JP': 'クイックフィルターバー',
  'es-ES': 'Barra de filtros rápidos',
};

const TRANSLATED_LOCALES: ReadonlyArray<readonly [string, Record<string, any>]> = [
  ['zh-CN', zhCNMetadataForms as Record<string, any>],
  ['ja-JP', jaJPMetadataForms as Record<string, any>],
  ['es-ES', esESMetadataForms as Record<string, any>],
];

const helpTextOf = (forms: Record<string, any>): string => {
  const help = forms?.view?.fields?.userFilters?.helpText;
  expect(typeof help, 'view.fields.userFilters.helpText is missing from this catalog').toBe('string');
  return help as string;
};

describe('view.fields.userFilters helpText names writable element tokens', () => {
  it('control: the tokens it names are exactly what the schema accepts', () => {
    for (const value of ELEMENT_VALUES) {
      expect(
        UserFiltersSchema.safeParse({ element: value }).success,
        `UserFiltersSchema refused '${value}' — the tooltip would be naming an unwritable value`,
      ).toBe(true);
    }
  });

  it('control: the words the translations used to name are refused', () => {
    for (const [locale, words] of Object.entries(FORMER_TRANSLATIONS)) {
      for (const word of words) {
        expect(
          UserFiltersSchema.safeParse({ element: word }).success,
          `UserFiltersSchema accepted '${word}' (${locale}) — this control no longer proves anything`,
        ).toBe(false);
      }
    }
  });

  it('en: the source names every accepted token verbatim', () => {
    const help = helpTextOf(enMetadataForms as Record<string, any>);
    for (const value of ELEMENT_VALUES) {
      expect(help, `en helpText does not name '${value}'`).toContain(value);
    }
  });

  for (const [locale, forms] of TRANSLATED_LOCALES) {
    it(`${locale}: names every accepted token verbatim`, () => {
      const help = helpTextOf(forms);
      for (const value of ELEMENT_VALUES) {
        expect(
          help,
          `${locale} helpText does not name '${value}' — a translated-locale author is shown a value the schema refuses`,
        ).toContain(value);
      }
      for (const word of FORMER_TRANSLATIONS[locale]!) {
        expect(help, `${locale} helpText still spells the enum value as '${word}'`).not.toContain(word);
      }
    });

    it(`${locale}: the prose around them is still translated`, () => {
      const help = helpTextOf(forms);
      expect(help, `${locale} helpText is a byte copy of the en source`).not.toBe(
        helpTextOf(enMetadataForms as Record<string, any>),
      );
      expect(help, `${locale} helpText lost its own prose`).toContain(PROSE_ANCHOR[locale]!);
    });
  }
});

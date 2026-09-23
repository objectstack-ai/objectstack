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
// translated.
//
// This pins THAT leaf, in the three locales, and nothing wider: it reads one
// key. What keeps it from passing vacuously — or passing while the defect
// class walks back in — is four controls, each of which fails on its own:
//
//   1. THE SET IS DERIVED, NOT LISTED. `SCHEMA_ELEMENT_VALUES` is read off
//      `UserFiltersSchema.shape.element` (unwrapping `.default()`) and asserted
//      SET-EQUAL to the literal below. Every tooltip assertion then runs over
//      the DERIVED set. So enum GROWTH reddens — add a fourth member and this
//      control fails and every locale fails the presence leg — and not only
//      enum shrinkage. A hand-listed set catches shrinkage alone and lets a new
//      legal value go unnamed in all four catalogs with the pin green, which is
//      this card's own defect class reintroduced.
//   2. THE SCHEMA LEG. Every derived token is `safeParse`d through
//      `UserFiltersSchema` and must be ACCEPTED; the words the translations
//      used to carry, and the capitalised spellings the neighbouring `page`
//      panel shows for its `filter-mode` widget, are `safeParse`d and must be
//      REFUSED. A tooltip rewritten to name some other word fails here.
//   3. THE EXACT-SET LEG. The tooltip's parenthetical must name the derived
//      values and NOTHING ELSE, in order. Checking only "no fewer" lets
//      `(dropdown / tabs / toggle / chips)` through.
//   4. THE STILL-TRANSLATED LEG. Each translated helpText must differ from the
//      `en` source and must still carry its own prose at BOTH ends of the
//      sentence. Anchoring the leading fragment alone lets the trailing half
//      revert to English — #19403's defect surviving on the larger half of the
//      sentence. "Fixing" a red by copying the whole English sentence into the
//      three catalogs fails here too.

import { describe, it, expect } from 'vitest';
import { UserFiltersSchema } from '@objectstack/spec/ui';

import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';

/**
 * The values `UserFiltersSchema.element` accepts, READ OFF THE SCHEMA.
 *
 * `element` is `z.enum([...]).default('dropdown')`, so the enum node sits
 * behind the default wrapper. Unwrapped here rather than reached for by a
 * fixed path, and the shape is asserted below — a derivation that silently
 * yielded `undefined` would make every assertion over it vacuous.
 */
const SCHEMA_ELEMENT_VALUES: readonly string[] = (() => {
  let node: any = (UserFiltersSchema as any).shape?.element;
  for (let hop = 0; hop < 5 && (node?.def ?? node?._def)?.type === 'default'; hop += 1) {
    node = (node.def ?? node._def).innerType;
  }
  return node?.options ?? [];
})();

/** What that set is expected to be — the pin half of control 1. */
const EXPECTED_ELEMENT_VALUES = ['dropdown', 'tabs', 'toggle'] as const;

/**
 * Spellings that must stay UNWRITABLE, so the presence assertions above cannot
 * be satisfied by a word the schema would refuse.
 *
 * Two groups. The per-locale rows are what each tooltip used to name. The
 * shared row is the capitalised set the neighbouring `page` Interface panel
 * shows for its `filter-mode` widget (`None / Tabs / Dropdown`): those are UI
 * mode names, not enum tokens — `z.enum` is case-sensitive, so the enum
 * refuses them, and `None` is not a member at all (it stands for the absence
 * of the config). Asserted here so the difference is a measurement rather than
 * a remark.
 *
 * `tabs` is deliberately absent from every per-locale row: its former word is
 * also the locale's ordinary word for the "tab presets" PROSE at the end of
 * the same sentence (标签页预设 · タブプリセット · preajustes de pestañas),
 * which is translated on purpose and must stay. Asserting its absence would
 * demand the prose be de-translated — the inverse defect again — so `tabs` is
 * covered by controls 1, 3 and the presence leg instead.
 */
const FORMER_TRANSLATIONS: Readonly<Record<string, readonly string[]>> = {
  'zh-CN': ['下拉', '开关'],
  'ja-JP': ['ドロップダウン', 'トグル'],
  'es-ES': ['desplegable', 'interruptor'],
};
const NEIGHBOURING_PANEL_LABELS = ['None', 'Tabs', 'Dropdown'] as const;

/**
 * Prose each locale must still render in its own language, at BOTH ends of the
 * sentence — the leading clause and the trailing one.
 */
const PROSE_ANCHORS: Readonly<Record<string, readonly [string, string]>> = {
  'zh-CN': ['快速筛选栏', '暴露的字段或标签页预设'],
  'ja-JP': ['クイックフィルターバー', '公開フィールドまたはタブプリセット'],
  'es-ES': ['Barra de filtros rápidos', 'campos expuestos o preajustes de pestañas'],
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

/**
 * The tokens a tooltip names, read out of the parenthetical that carries them.
 * Both ASCII and full-width brackets, because each locale keeps its own
 * punctuation. Returns `[]` when no parenthetical names the first value — a
 * sentence reshaped past this reader's reach, which reddens rather than
 * silently measuring nothing.
 */
const namedTokens = (help: string): string[] => {
  const first = SCHEMA_ELEMENT_VALUES[0];
  if (first === undefined) return [];
  for (const match of help.matchAll(/[(（]([^)）]*)[)）]/g)) {
    const inner = match[1] ?? '';
    if (inner.includes(first)) {
      return inner.split('/').map((part) => part.trim()).filter((part) => part.length > 0);
    }
  }
  return [];
};

describe('view.fields.userFilters helpText names writable element tokens', () => {
  it('control: the asserted set IS the schema\'s set, derived not copied', () => {
    expect(
      Array.isArray(SCHEMA_ELEMENT_VALUES) && SCHEMA_ELEMENT_VALUES.length > 0,
      'could not read the enum off UserFiltersSchema.shape.element — every assertion below would be vacuous',
    ).toBe(true);
    expect(
      [...SCHEMA_ELEMENT_VALUES].sort(),
      'UserFiltersSchema.element no longer accepts exactly these values — the tooltip names a set the schema has moved away from, in all four catalogs',
    ).toEqual([...EXPECTED_ELEMENT_VALUES].sort());
  });

  it('control: every value it names is accepted by the schema', () => {
    for (const value of SCHEMA_ELEMENT_VALUES) {
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

  it('control: the neighbouring panel\'s filter-mode labels are refused too', () => {
    for (const label of NEIGHBOURING_PANEL_LABELS) {
      expect(
        UserFiltersSchema.safeParse({ element: label }).success,
        `UserFiltersSchema accepted '${label}' — the page panel's capitalised labels would then be enum tokens, and this tooltip could borrow their shape`,
      ).toBe(false);
    }
  });

  it('en: the source names every accepted value, and only those', () => {
    const help = helpTextOf(enMetadataForms as Record<string, any>);
    for (const value of SCHEMA_ELEMENT_VALUES) {
      expect(help, `en helpText does not name '${value}'`).toContain(value);
    }
    expect(namedTokens(help), 'en helpText names a different set from the enum').toEqual([
      ...SCHEMA_ELEMENT_VALUES,
    ]);
  });

  for (const [locale, forms] of TRANSLATED_LOCALES) {
    it(`${locale}: names every accepted value verbatim, and only those`, () => {
      const help = helpTextOf(forms);
      for (const value of SCHEMA_ELEMENT_VALUES) {
        expect(
          help,
          `${locale} helpText does not name '${value}' — a translated-locale author is shown a value the schema refuses, or is never shown a legal one`,
        ).toContain(value);
      }
      expect(
        namedTokens(help),
        `${locale} helpText names a different set from the enum — an extra token here is a value the schema refuses`,
      ).toEqual([...SCHEMA_ELEMENT_VALUES]);
      for (const word of FORMER_TRANSLATIONS[locale]!) {
        expect(help, `${locale} helpText still spells the enum value as '${word}'`).not.toContain(word);
      }
    });

    it(`${locale}: the prose at both ends is still translated`, () => {
      const help = helpTextOf(forms);
      expect(help, `${locale} helpText is a byte copy of the en source`).not.toBe(
        helpTextOf(enMetadataForms as Record<string, any>),
      );
      const [leading, trailing] = PROSE_ANCHORS[locale]!;
      expect(help, `${locale} helpText lost its leading prose`).toContain(leading);
      expect(help, `${locale} helpText lost its trailing prose`).toContain(trailing);
    });
  }
});

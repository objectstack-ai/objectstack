/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8148 — the FIFTH refusal sentence reaches the packs, and it is the
 * only SHARED one.
 *
 * objectui#6755 ruled (maintainer, 2026-08-29) that a widget's OWN refusal
 * sentence goes through `useFieldTranslation` + `FIELD_DEFAULTS`, and named
 * three sentences; objectui#6888 added `LocationField`'s residue arm as the
 * fourth. The four already keyed are each ONE widget's. This one is not: a
 * single literal in `numberBadInput.tsx` served `NumberField`, `CurrencyField`,
 * `PercentField` and BOTH of `GeolocationField`'s boxes, through one hook, with
 * five different `example` values.
 *
 * The consequence that made it worth keying is on the geolocation surface:
 * `GeolocationField` sits beside `LocationField`, whose three refusals are all
 * keyed, so two adjacent coordinate widgets refused bad input in two different
 * languages on the same form.
 *
 * ## ⭐ The authoring question this card had to answer
 *
 * Triage's fence: `example` is produced per widget, and a pack that writes its
 * decimals with a comma separator would collide with the `latitude, longitude`
 * example pair in the adjacent widget. The answer taken is the INTERPOLATED
 * hole — one key, `{{example}}` filled by the widget in ASCII — rather than
 * five per-widget keys. {@link NO_PACK_SPELLS_A_DECIMAL} is the assertion that
 * distinguishes it from the design not taken: with the example keyed per
 * widget, every pack would hold a decimal numeral it could re-punctuate, and
 * `1234,56` reads as the PAIR `fields.location.refusedFormat` asks for.
 *
 * ## Shape inherited from `LocationField.residueI18n-6888.test.tsx`
 *
 * - **Positive AND negative together.** `createSafeTranslation` falls back to
 *   `FIELD_DEFAULTS[key]`, which is byte-identical to the literal it replaced —
 *   so a pack that resolves NOTHING renders exactly what the hard-coded string
 *   used to. Only "says the translated thing" plus "no English survives"
 *   separates keyed from still-hard-coded.
 * - **A positive control for the pack read, in this run.** `AddressField`'s
 *   `fields.address.*` keys were keyed by objectui#4028; if the provider were
 *   dead, that control fails too and no negative assertion here could be read
 *   as a pass.
 * - **`en` and provider-less are NO-OP pins.** They state, as a fact of this
 *   change rather than a hope, why
 *   `NumberInputWidgets.badInputAnnounce.test.tsx` keeps every verdict it had.
 * - ⛔ Everything about WHAT the sentence says is read off the RENDERED widget,
 *   never off `badInputMessage`'s return value. The one unit assertion below is
 *   about the WIRING (which key, which hole), not about the copy.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

import { NumberField } from '../widgets/NumberField';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';
import { GeolocationField } from '../widgets/GeolocationField';
import { AddressField } from '../widgets/AddressField';
import { badInputMessage } from '../widgets/numberBadInput';
import { BAD_INPUT_AGREED } from './numberInputBrowserReadings.js';

/**
 * Every widget of this class takes the same three runtime props, but their
 * `value` and `field` types differ (a number here, a `GeolocationValue`
 * there). ONE structural type expresses that, so this suite needs a single
 * `unknown` cast per widget instead of an `any` at every call site
 * (AGENTS.md #6) — the same shape
 * `NumberInputWidgets.badInputAnnounce.test.tsx` uses.
 */
type NumberishWidget = React.ComponentType<{
  value: unknown;
  onChange: (v: unknown) => void;
  field: Record<string, unknown>;
}>;

const asWidget = (w: unknown) => w as NumberishWidget;

const addressField: Record<string, unknown> = { name: 'billing_address', type: 'address' };

/**
 * A string both happy-dom and Chromium read as `badInput` — the only kind this
 * environment may drive (see `numberInputBrowserReadings.ts`).
 */
const BAD = BAD_INPUT_AGREED[0];

/**
 * The five `example` values the ONE sentence is produced with, per box.
 *
 * ⭐ This table is the card: four widgets, FIVE call sites. A key that
 * hard-coded any one of these would still render four of the five wrong.
 */
const BOXES = [
  {
    name: 'NumberField',
    example: '1234',
    box: 0,
    Widget: asWidget(NumberField),
    field: { name: 'qty', type: 'number' } as Record<string, unknown>,
    initial: null as unknown,
  },
  {
    name: 'CurrencyField',
    example: '1234.56',
    box: 0,
    Widget: asWidget(CurrencyField),
    field: { name: 'amount', type: 'currency', currency: 'USD', precision: 2 } as Record<string, unknown>,
    initial: null as unknown,
  },
  {
    name: 'PercentField',
    example: '12.5',
    box: 0,
    Widget: asWidget(PercentField),
    field: { name: 'rate', type: 'percent' } as Record<string, unknown>,
    initial: null as unknown,
  },
  {
    name: 'GeolocationField (latitude)',
    example: '30.2741',
    box: 0,
    Widget: asWidget(GeolocationField),
    field: { name: 'where', type: 'geolocation' } as Record<string, unknown>,
    initial: {} as unknown,
  },
  {
    name: 'GeolocationField (longitude)',
    example: '120.1551',
    box: 1,
    Widget: asWidget(GeolocationField),
    field: { name: 'where', type: 'geolocation' } as Record<string, unknown>,
    initial: {} as unknown,
  },
] as const;

/** Every `example` the five boxes ask for, in one place. */
const EXAMPLES = BOXES.map(b => b.example);

/** One box, mounted the way a host mounts it. */
function elementFor(which: number) {
  const b = BOXES[which];
  return <b.Widget value={b.initial} onChange={vi.fn()} field={b.field} />;
}

function renderIn(language: string | null, element: React.ReactElement) {
  if (language === null) return render(element);
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {element}
    </I18nProvider>,
  );
}

/**
 * Drive one box into `badInput` and read the diagnostic the person sees.
 *
 * ⛔ Deliberately the RENDERED element, not `badInputMessage`'s return value:
 * a helper that returned a translated string while the widget still drew the
 * literal would pass an assertion on the helper and fail the user.
 */
function refusalFrom(language: string | null, which: number): string | null {
  const { container } = renderIn(language, elementFor(which));
  const boxes = container.querySelectorAll('input[type=number]');
  fireEvent.change(boxes[BOXES[which].box] as HTMLElement, { target: { value: BAD } });
  const p = container.querySelector('p.text-red-500');
  return p ? (p.textContent || '').trim() : null;
}

/** The English sentence, one `example` filled in — byte-identical to the old literal. */
const EN = (example: string) =>
  `Not saved: the text in this box is not a number. Enter a plain decimal (example: ${example}).`;

/**
 * English fragments that must NOT survive a translated render.
 *
 * All three are the defect: the frame, the noun and the verb the old
 * implementation wrote in TypeScript and no pack could reach.
 */
const ENGLISH_FRAGMENTS = ['Not saved:', 'is not a number', 'Enter a plain decimal'];

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* The control: a key that ALREADY resolves through this channel.              */
/* -------------------------------------------------------------------------- */

describe('the locale channel is live in this run (control for objectui#8148)', () => {
  it('resolves fields.address.* — keyed by objectui#4028 — under zh', () => {
    // Without this, a blank or English diagnostic below would be a dead
    // provider rather than a missing key, and every negative assertion in this
    // file would pass for the wrong reason.
    renderIn('zh', React.createElement(asWidget(AddressField), { value: {}, onChange: vi.fn(), field: addressField }));
    expect(screen.getByLabelText('街道地址')).toBeInTheDocument();
    expect(screen.getByLabelText('城市')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* English is byte-identical — what the announce suite's verdicts rest on.     */
/* -------------------------------------------------------------------------- */

describe('the English default is byte-identical after keying (objectui#8148)', () => {
  it.each(BOXES.map((b, i) => [b.name, i, b.example] as const))(
    '%s renders the same sentence under an en provider',
    (_name, index, example) => {
      expect(refusalFrom('en', index)).toBe(EN(example));
    },
  );

  it.each(BOXES.map((b, i) => [b.name, i, b.example] as const))(
    '%s renders the same sentence with NO provider at all',
    (_name, index, example) => {
      expect(refusalFrom(null, index)).toBe(EN(example));
    },
  );
});

/* -------------------------------------------------------------------------- */
/* ⭐ The control that makes this a READING, not a translation test.           */
/* -------------------------------------------------------------------------- */

describe('all five examples still reach the rendered sentence (objectui#8148)', () => {
  it('has five distinct examples across four widgets', () => {
    // The property that made this the only SHARED sentence of the five, and the
    // reason a key hard-coding one example would not have done the card.
    expect(new Set(EXAMPLES).size).toBe(5);
    expect(EXAMPLES).toEqual(['1234', '1234.56', '12.5', '30.2741', '120.1551']);
  });

  it.each(['en', 'zh', 'ja', 'ar'])('every box still quotes its own example in %s', language => {
    // Before AND after: the numeral is the widget's, not the locale's, so a
    // translated render must still carry it verbatim.
    BOXES.forEach((b, index) => {
      const message = refusalFrom(language, index) ?? '';
      expect(message, `${b.name} lost its example in ${language}`).toContain(b.example);
    });
  });

  it('each box quotes ONLY its own example, in every language checked', () => {
    // The failure a single hard-coded example would produce: four boxes quoting
    // a fifth box's numeral. `1234` is a substring of nothing else here, and
    // `12.5`/`120.1551` are checked by exact-position containment below.
    for (const language of ['en', 'zh'] as const) {
      BOXES.forEach((b, index) => {
        const message = refusalFrom(language, index) ?? '';
        for (const other of EXAMPLES) {
          if (other === b.example || b.example.includes(other)) continue;
          expect(message, `${b.name} quoted ${other} in ${language}`).not.toContain(other);
        }
      });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The reader's language, on every box, with no English left behind.           */
/* -------------------------------------------------------------------------- */

describe("the bad-input refusal speaks the reader's language (objectui#8148)", () => {
  it.each([
    ['zh', '未保存：此输入框中的文本不是数字。请输入普通小数（例如 1234）。'],
    ['ja', '保存されていません: このボックスのテキストは数値ではありません。通常の小数で入力してください（例: 1234）。'],
    ['ar', 'لم يتم الحفظ: النص في هذا المربع ليس رقمًا. أدخل رقمًا عشريًا عاديًا (مثال: 1234).'],
  ])('says NumberField\'s refusal in %s', (language, expected) => {
    expect(refusalFrom(language, 0)).toBe(expected);
  });

  it.each([
    ['zh', 0],
    ['zh', 4],
    ['ja', 2],
    ['ar', 3],
    ['ru', 1],
  ] as const)('leaves no English grammar behind in %s for box %s', (language, index) => {
    // The negative half of the pair. `createSafeTranslation` renders the
    // English default when a key does not resolve, so this is what tells a
    // keyed sentence from a still-hard-coded one.
    const message = refusalFrom(language, index) ?? '';
    for (const fragment of ENGLISH_FRAGMENTS) {
      expect(message, `${language} kept the English fragment "${fragment}"`).not.toContain(fragment);
    }
    // The example DOES stay ASCII: it is what the box asks the person to type.
    expect(message).toContain(BOXES[index].example);
  });

  it('the two GEOLOCATION boxes both speak it, which is the card\'s sharpest case', () => {
    // `GeolocationField` sits beside `LocationField`, already keyed. Before this
    // card the two coordinate widgets refused in two different languages.
    expect(refusalFrom('zh', 3)).toContain('未保存：');
    expect(refusalFrom('zh', 4)).toContain('未保存：');
  });
});

/* -------------------------------------------------------------------------- */
/* ⭐ The hole, asserted against the design NOT taken.                          */
/* -------------------------------------------------------------------------- */

describe('the example is a HOLE, not five per-widget keys (objectui#8148)', () => {
  const LANGS = ['en', 'zh', 'ja', 'ko', 'de', 'es', 'fr', 'pt', 'ru', 'ar'] as const;

  /**
   * One pack's `fields.number` block, READ THROUGH ITS REAL TYPE.
   *
   * ⛔ Deliberately not `(builtInLocales as any)[lang]`: `builtInLocales` is an
   * `as const` object, so typing the access makes a renamed or dropped key a
   * COMPILE error in `type-check` rather than a runtime miss.
   */
  const numberPack = (lang: (typeof LANGS)[number]) => builtInLocales[lang].fields.number;

  it('gives every pack the one key, with the interpolation hole intact', () => {
    for (const lang of LANGS) {
      expect(Object.keys(numberPack(lang)), `${lang}`).toEqual(['badInput']);
      expect(numberPack(lang).badInput, `${lang}`).toContain('{{example}}');
    }
  });

  /**
   * ⭐ NO_PACK_SPELLS_A_DECIMAL — the assertion that separates the answer taken
   * from the one that was not.
   *
   * Triage's fence: a pack that wrote its decimals with a comma separator would
   * collide with the `latitude, longitude` example pair the adjacent widget
   * asks for. With the example in a hole, no pack writes a decimal at all — so
   * the collision cannot occur, rather than being avoided by good behaviour.
   */
  it('NO_PACK_SPELLS_A_DECIMAL — no pack carries a numeral for this key', () => {
    for (const lang of LANGS) {
      expect(numberPack(lang).badInput, `${lang} spells a digit`).not.toMatch(/\d/);
    }
  });

  it('every pack states it in its own words', () => {
    // A pack that copied `en` verbatim would pass the key-parity gate and still
    // ship the defect this card closes.
    const en = numberPack('en').badInput;
    for (const lang of LANGS) {
      if (lang === 'en') continue;
      expect(numberPack(lang).badInput, `${lang} is still the English sentence`).not.toBe(en);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The wiring: ONE key, read at ONE place.                                     */
/* -------------------------------------------------------------------------- */

describe('the sentence is composed at exactly one place (objectui#8148)', () => {
  it('badInputMessage reads fields.number.badInput and passes the example as the hole', () => {
    // ⛔ Not an assertion about the COPY — the rendered assertions above own
    // that. This pins the property triage asked for: the key is read INSIDE
    // `badInputMessage`, so the four widgets cannot grow a second spelling.
    const asked: Array<[string, unknown]> = [];
    const spy = (key: string, options?: Record<string, unknown>) => {
      asked.push([key, options]);
      return 'TRANSLATED';
    };
    expect(badInputMessage(spy, '1234')).toBe('TRANSLATED');
    expect(asked).toEqual([['fields.number.badInput', { example: '1234' }]]);
  });

  it('keying it did not change what the widget EMITS', () => {
    // objectui#6780's rule, inherited rather than re-decided here: this guard
    // announces, it does not refuse — refusing would wipe the very text the
    // message points at.
    const onChange = vi.fn();
    const NumberWidget = asWidget(NumberField);
    const { container } = renderIn(
      'zh',
      <NumberWidget value={null} onChange={onChange} field={{ name: 'qty', type: 'number' }} />,
    );
    const box = container.querySelector('input[type=number]') as HTMLInputElement;
    fireEvent.change(box, { target: { value: BAD } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(container.querySelectorAll('p.text-red-500')).toHaveLength(1);
  });
});

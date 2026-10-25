/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6793 — drive the `type="number"` widget class with what a browser
 * CAN deliver, and assert what the product actually does with it.
 *
 * ## The gap this closes
 *
 * `NumberInputWidgets.environmentDivergence.test.tsx` (objectui#6765) pins that
 * happy-dom does not implement the HTML value-sanitization algorithm, so a
 * `fireEvent.change` in this package can put text in `.value` that no browser
 * ever puts there. That file records the divergence deliberately, as ONE HALF
 * of a disagreement, and says so.
 *
 * What nothing recorded is the other half: **no test in this repository drove
 * these widgets with the values a real browser delivers and asserted the
 * emission.** So the class had a pinned oracle for a fiction and no oracle at
 * all for the product. This file is that oracle, and it is deliberately unable
 * to become the other thing — every string it drives is asserted to be one the
 * platform itself reads without `validity.badInput` (see the last describe).
 *
 * ## What was MEASURED for this file, on this base
 *
 * Chromium 141.0.7390.37 via Playwright 1.62.1
 * (`executablePath: '/opt/pw-browsers/chromium'`), a real `<input type="number">`
 * on a real page, driven KEY BY KEY with `keyboard.press`, reading `.value` and
 * `validity.badInput` after every keystroke:
 *
 * ```
 * typed "12abc"  ''  1:'1'  2:'12'  a:'12'  b:'12'  c:'12'
 * typed "1.2.3"  ''  1:'1'  .:'1'   2:'1.2' .:'1.2' 3:'1.23'
 * typed "0x10"   ''  0:'0'  x:'0'   1:'01'  0:'010'
 * typed "1e"     ''  1:'1'  e:''  <- and validity.badInput becomes TRUE
 * typed ""       ''
 * ```
 *
 * ⭐ The load-bearing shape, and the reason this file drives ARRAYS: a browser
 * does not deliver one post-sanitization string, it delivers a SEQUENCE of
 * them, one per accepted keystroke. `"1e"` is the case that makes the
 * difference visible — the box moves `'' -> '1' -> ''`, so React sees a real
 * change and the widget is told to clear. Driving the single value `''` into a
 * box that already reads `''` is not a change at all and emits nothing, which
 * is a different fact about a different user action (see the empty row).
 *
 * The same keystroke runs pasted (`keyboard.insertText`) land on the identical
 * final readings; a programmatic `.value = x` write is a third route and lands
 * on `''` for every one of these strings, with `badInput` FALSE — Chromium
 * reports that it cannot read the USER's input, and a script write has no user
 * input to fail on. That third route is objectui#6780's subject, not this
 * card's; its full matrix is in that card's PR.
 *
 * ## The card's 6-of-10, RE-DERIVED rather than quoted
 *
 * objectui#6793 relayed "the oracle and the product disagree in 6 of 10
 * measured cases" from objectui#6780 / #6765. Re-derived here by driving each
 * case BOTH ways through the real widgets — the fabricated whole string, and
 * the measured browser sequence — the count reproduces exactly, and
 * `divergence.test` below asserts the six by name so the figure cannot rot into
 * a quotation again.
 *
 * ⚠️ The card's other claim does NOT survive re-derivation, and is corrected
 * here rather than repeated: *"every existing unit test for these widgets
 * drives a string no browser can deliver."* Measured across every test file in
 * this repository that renders `CurrencyField`, `PercentField`, `NumberField`
 * or `GeolocationField`, exactly ONE drives such a string —
 * `NumberInputWidgets.environmentDivergence.test.tsx`, which exists to record
 * that divergence. Every other one already drives `'10'`, `'15'`, `'75'`,
 * `'6000'`, `'2'`, `'1234.56'`, `'1234.567'` — all browser-deliverable.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { FieldMetadata } from '@object-ui/types';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';
import { NumberField } from '../widgets/NumberField';
import { GeolocationField, type GeolocationValue } from '../widgets/GeolocationField';

type WidgetName = 'currency' | 'percent' | 'number' | 'geolocation';

/**
 * What a real Chromium leaves in `.value` after each keystroke, for the four
 * strings objectui#6765 measured plus the empty one — reduced to the readings
 * that CHANGE, because React only reports a change.
 *
 * ⚠️ The last element of each array is the same final reading objectui#6765
 * pinned as `BROWSER_READINGS` (`'12'`, `'1.23'`, `'010'`). This table is a
 * superset of that list, not a second dialect of it: when objectui#6780's
 * `__tests__/numberInputBrowserReadings.ts` lands, this belongs beside those
 * numbers in that one module. Kept here for now because that file does not
 * exist on `main` and this card must not edit an unmerged sibling's source.
 */
const BROWSER_KEYSTROKES: ReadonlyArray<{ typed: string; delivers: readonly string[] }> = [
  { typed: '12abc', delivers: ['1', '12'] },
  { typed: '1.2.3', delivers: ['1', '1.2', '1.23'] },
  { typed: '0x10', delivers: ['0', '01', '010'] },
  { typed: '1e', delivers: ['1', ''] },
  // Nothing typed: the box never changes, so no `change` event is delivered at
  // all. Driving `''` here rather than `[]` would be the same non-event.
  { typed: '', delivers: [] },
];

/**
 * A host that ECHOES the emission back into `value`, the way a real form does.
 * These are CONTROLLED inputs: with a bare spy host `value` never moves, React
 * sees no change between two identical values, and every reading after the
 * first is suppressed. A sequence cannot be driven without this.
 *
 * `echo` is off only for the single-event fabricated drives in the divergence
 * derivation below: those model one synthetic event rather than a typing
 * session, and echoing a `NaN` emission back into a controlled input makes
 * React warn about the `value` attribute for a reading no user can produce.
 */
const renderHost = (widget: WidgetName, echo = true) => {
  const onChange = vi.fn();
  const field = {
    currency: { name: 'amount', type: 'currency', currency: 'USD', precision: 2 },
    percent: { name: 'rate', type: 'percent', precision: 2 },
    number: { name: 'qty', type: 'number', precision: 2 },
    geolocation: { name: 'where', type: 'geolocation' },
  }[widget] as FieldMetadata;
  const Host = () => {
    // Two states rather than one `unknown`: three of these widgets are scalar
    // and one is composite, so a single loosely-typed slot would be the only
    // place in this file the compiler stops checking the thing being measured.
    const [scalar, setScalar] = React.useState<number | null>(null);
    const [coords, setCoords] = React.useState<GeolocationValue>({});
    const onScalar = (next: number) => {
      onChange(next);
      if (echo) setScalar(next);
    };
    const onCoords = (next: GeolocationValue) => {
      onChange(next);
      if (echo) setCoords(next);
    };
    switch (widget) {
      case 'currency':
        return <CurrencyField value={scalar as number} onChange={onScalar} field={field} />;
      case 'percent':
        return <PercentField value={scalar as number} onChange={onScalar} field={field} />;
      case 'number':
        return <NumberField value={scalar as number} onChange={onScalar} field={field} />;
      case 'geolocation':
        return <GeolocationField value={coords} onChange={onCoords} field={field} />;
    }
  };
  const { container } = render(<Host />);
  return {
    input: container.querySelector('input[type=number]') as HTMLInputElement,
    onChange,
  };
};

/**
 * `GeolocationField` is a composite: it emits the whole coordinate object, and
 * the box this file drives is its LATITUDE. Read that one key so the four
 * widgets are comparable; `NO_CALL` distinguishes "never told" from "told
 * nothing".
 */
const NO_CALL = Symbol('onChange was never called');

const emissionsOf = (widget: WidgetName, deliveries: readonly string[], echo = true) => {
  const { input, onChange } = renderHost(widget, echo);
  for (const delivered of deliveries) {
    fireEvent.change(input, { target: { value: delivered } });
  }
  const calls = onChange.mock.calls.map(([emitted]) =>
    widget === 'geolocation' && emitted != null
      ? (emitted as { latitude?: number }).latitude
      : emitted,
  );
  cleanup();
  return { calls, last: calls.length === 0 ? NO_CALL : calls[calls.length - 1] };
};

/** What each widget is MEASURED to emit once the browser's keystrokes arrive. */
const PRODUCT: ReadonlyArray<{
  widget: WidgetName;
  typed: string;
  emits: number | null | undefined | typeof NO_CALL;
}> = [
  // `parseFloat` widgets. The percent pair stores fractions, so 12% is 0.12.
  { widget: 'currency', typed: '12abc', emits: 12 },
  { widget: 'currency', typed: '1.2.3', emits: 1.23 },
  { widget: 'currency', typed: '0x10', emits: 10 },
  { widget: 'currency', typed: '1e', emits: null },
  { widget: 'currency', typed: '', emits: NO_CALL },
  { widget: 'percent', typed: '12abc', emits: 0.12 },
  { widget: 'percent', typed: '1.2.3', emits: 0.0123 },
  { widget: 'percent', typed: '0x10', emits: 0.1 },
  { widget: 'percent', typed: '1e', emits: null },
  { widget: 'percent', typed: '', emits: NO_CALL },
  // `Number()` widgets. On the strings a browser can actually deliver they
  // agree with the `parseFloat` pair on every row — the two parsers only part
  // company on residue, which never arrives.
  { widget: 'number', typed: '12abc', emits: 12 },
  { widget: 'number', typed: '1.2.3', emits: 1.23 },
  { widget: 'number', typed: '0x10', emits: 10 },
  { widget: 'number', typed: '1e', emits: null },
  { widget: 'number', typed: '', emits: NO_CALL },
  // This row USED to be the odd one out, and the history is kept because the
  // reading is what the divergence was reported from: `GeolocationField`
  // cleared a coordinate to `undefined` where the other three cleared to
  // `null`, because it builds an object rather than emitting a scalar. That
  // was pinned here as product behaviour and reported rather than fixed under
  // objectui#6793 — then fixed under objectui#6848, which is why the `1e` row
  // now reads `null` like its three siblings. The class has ONE rule again;
  // `GeolocationClearEmission.test.tsx` holds the fix's own pins.
  { widget: 'geolocation', typed: '12abc', emits: 12 },
  { widget: 'geolocation', typed: '1.2.3', emits: 1.23 },
  { widget: 'geolocation', typed: '0x10', emits: 10 },
  { widget: 'geolocation', typed: '1e', emits: null },
  { widget: 'geolocation', typed: '', emits: NO_CALL },
];

const deliveriesFor = (typed: string) =>
  BROWSER_KEYSTROKES.find(row => row.typed === typed)!.delivers;

describe('objectui#6793 — the product, driven the way a browser drives it', () => {
  it.each(PRODUCT)(
    '$widget: typing $typed emits $emits',
    ({ widget, typed, emits }) => {
      const { last } = emissionsOf(widget, deliveriesFor(typed));
      expect(last).toBe(emits);
    },
  );

  it('never emits NaN on any keystroke of any measured sequence', () => {
    // The whole-sequence claim, not just the final one. It is worth its own
    // assertion because two of these widgets parse with `Number()`, which
    // answers `NaN` for residue — the reading that would reach a form, and a
    // record, if residue ever arrived. Measured: it does not.
    for (const { widget } of PRODUCT) {
      for (const { typed, delivers } of BROWSER_KEYSTROKES) {
        const { calls } = emissionsOf(widget, delivers);
        for (const emitted of calls) {
          expect(
            typeof emitted === 'number' && Number.isNaN(emitted),
            `${widget} emitted NaN while the browser delivered ${JSON.stringify(typed)}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('objectui#6793 — the 6-of-10 divergence, re-derived', () => {
  /**
   * The card quoted "6 of 10". This derives it: for each of the ten cases
   * objectui#6765 pinned, drive the fabricated whole string the old oracle
   * drives, drive the browser's real keystrokes, and compare the two emissions.
   *
   * ⛔ The fabricated column is NOT an endorsement of anything. It is measured
   * here only to produce the count, exactly as the divergence pin does.
   */
  const CARD_CASES = PRODUCT.filter(c => c.widget === 'currency' || c.widget === 'percent');

  it('measures ten cases and finds exactly six disagreements', () => {
    expect(CARD_CASES).toHaveLength(10);
    const diverging = CARD_CASES.filter(({ widget, typed }) => {
      const fabricated = emissionsOf(widget, [typed], false).last;
      const browser = emissionsOf(widget, deliveriesFor(typed)).last;
      return !Object.is(fabricated, browser);
    });
    expect(diverging.map(c => `${c.widget}:${c.typed}`)).toEqual([
      'currency:1.2.3',
      'currency:0x10',
      'currency:1e',
      'percent:1.2.3',
      'percent:0x10',
      'percent:1e',
    ]);
    expect(diverging).toHaveLength(6);
  });

  it('and finds eight in the two widgets the card never measured', () => {
    // `NumberField` and `GeolocationField` are named by the card but were not
    // in objectui#6765's table. They diverge harder, because `Number()` answers
    // `NaN` where `parseFloat` answers a truncation: four of five rows each.
    const rest = PRODUCT.filter(c => c.widget === 'number' || c.widget === 'geolocation');
    const diverging = rest.filter(({ widget, typed }) => {
      const fabricated = emissionsOf(widget, [typed], false).last;
      const browser = emissionsOf(widget, deliveriesFor(typed)).last;
      return !Object.is(fabricated, browser);
    });
    expect(diverging.map(c => `${c.widget}:${c.typed}`)).toEqual([
      'number:12abc',
      'number:1.2.3',
      'number:0x10',
      'number:1e',
      'geolocation:12abc',
      'geolocation:1.2.3',
      'geolocation:0x10',
      'geolocation:1e',
    ]);
  });
});

describe('objectui#6793 — this file cannot regress into driving a fiction', () => {
  /**
   * The self-guard, and the reason this suite is allowed to exist alongside the
   * divergence pin. Every string driven above is checked against the PLATFORM's
   * own predicate — `validity.badInput`, the browser stating in its own words
   * whether it can read the text. happy-dom implements that predicate even
   * though it skips the sanitization, which is precisely what makes the check
   * possible here: the four strings the old oracle drives all answer TRUE, and
   * every string this file drives answers FALSE.
   */
  it('drives only values the platform reads as a number', () => {
    const input = document.createElement('input');
    input.type = 'number';
    for (const { typed, delivers } of BROWSER_KEYSTROKES) {
      for (const delivered of delivers) {
        input.value = delivered;
        expect(
          input.validity.badInput,
          `${JSON.stringify(delivered)} (from typing ${JSON.stringify(typed)}) is not ` +
            'something this environment reads as a number, so it cannot be a browser reading',
        ).toBe(false);
      }
    }
  });

  it('and the strings it deliberately does not drive are the unreadable ones', () => {
    // The contrast, so the guard above cannot be read as vacuous: the four
    // whole strings objectui#6765's table drives are exactly the ones the
    // platform refuses. That is the difference between the two suites, stated
    // as an assertion rather than as prose.
    const input = document.createElement('input');
    input.type = 'number';
    for (const { typed } of BROWSER_KEYSTROKES) {
      if (typed === '') continue;
      input.value = typed;
      expect(input.validity.badInput, `${JSON.stringify(typed)} became readable`).toBe(true);
    }
  });
});

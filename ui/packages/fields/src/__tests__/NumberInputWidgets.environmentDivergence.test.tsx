/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6765 — the ORACLE for `CurrencyField` / `PercentField` disagrees
 * with the PRODUCT, and until this file nothing said so.
 *
 * Both widgets render `type="number"` inputs and hand `parseFloat(e.target.value)`
 * to `onChange` with no whole-string guard of their own. The card that filed
 * this measured that **happy-dom — this package's test environment — does not
 * implement the HTML value-sanitization algorithm**, and drew the conclusion
 * that any test written for these two widgets exercises a code path no browser
 * takes.
 *
 * ## What this card MEASURED, which the filing card explicitly had not
 *
 * The real browser. Chromium 141.0.7390.37 via Playwright 1.62.1, driving the
 * REAL widgets mounted in a real page, through the routes a user actually has
 * (keystrokes, Ctrl+V paste, and a programmatic value set):
 *
 * ```
 *                     happy-dom                    real Chromium
 * route/input         e.target.value  onChange     box.value  onChange
 * typed  "12abc"      "12abc"         12           "12"       12
 * typed  "1.2.3"      "1.2.3"         1.2          "1.23"     1.23    <- DIFFERS
 * pasted "0x10"       "0x10"          0            "010"      10      <- DIFFERS
 * typed  "1e"         "1e"            1            ""         null    <- DIFFERS
 * typed  ""           ""              (no call)    ""         (no call)
 * el.value = "12abc"  "12abc"         --           ""         --      <- DIFFERS
 * ```
 *
 * Three readings out of five DISAGREE, and they disagree in the direction that
 * matters: a pin written in this environment asserting `"0x10"` yields `0`
 * would be asserting the exact opposite of the product, which yields `10`.
 *
 * ## The consequence that decides this card
 *
 * **Residue never reaches these widgets in a real browser.** The browser
 * filters the keystroke or the paste BEFORE the change event, so by the time
 * `handleChange` runs the text is already a well-formed number — or the empty
 * string. So objectui#6715's anchored `WHOLE_NUMBER_TEXT` guard, which is the
 * right answer for `LocationField` (a `type="text"` box with nothing filtering
 * it), is here a **no-op**: it accepts every string these boxes can produce and
 * rejects only strings this test environment fabricates. That is asserted
 * below against #6715's OWN regex, read out of its source rather than
 * transcribed, so there is no second dialect of "what a number is" and the
 * claim moves if #6715 moves.
 *
 * ⛔ This file deliberately does NOT pin the truncating emissions as product
 * behaviour. `12`, `1.2`, `0` for `"12abc"`, `"1.2.3"`, `"0x10"` are recorded
 * here as ENVIRONMENT ARTIFACTS and asserted only as one half of a
 * disagreement; nothing here says any of them is correct. Freezing them in
 * place is the failure this card exists to prevent.
 *
 * ## Reproducing the browser column
 *
 * The harness is not committed — it was a Vite page mounting the two widgets
 * from source, served on a scratch port, driven by Playwright with
 * `executablePath: '/opt/pw-browsers/chromium'`. The numbers above are quoted
 * in the two widgets' own source comments, which is where the next person
 * reading `parseFloat(e.target.value)` will look.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';

/**
 * The measured record moved to `numberInputBrowserReadings.ts` (objectui#6780)
 * so this suite and the announcement suite read ONE set of numbers. Nothing
 * about the readings changed; they are the same values this file pinned.
 */
import {
  BROWSER_READINGS,
  HAPPY_DOM_FABRICATIONS,
  BAD_INPUT_DISAGREEMENTS,
} from './numberInputBrowserReadings.js';

/**
 * A host that ECHOES the emission back into `value`, the way a real form does.
 *
 * Not decoration: these are CONTROLLED inputs, so with a bare spy host `value`
 * never moves off `null`, React sees no change between two identical values and
 * suppresses the second `onChange` entirely. The silent-drop case below needs
 * two changes in sequence and cannot be driven without this — the same coupling
 * the browser harness had.
 */
const renderHost = (widget: 'currency' | 'percent') => {
  const onChange = vi.fn();
  const field = widget === 'currency'
    ? { name: 'amount', type: 'currency', currency: 'USD', precision: 2 }
    : { name: 'rate', type: 'percent', precision: 2 };
  const W: any = widget === 'currency' ? CurrencyField : PercentField;
  const Host = () => {
    const [value, setValue] = React.useState<number | null>(null);
    return (
      <W
        value={value}
        onChange={(v: any) => {
          onChange(v);
          setValue(v);
        }}
        field={field as any}
      />
    );
  };
  const { container } = render(<Host />);
  return { input: container.querySelector('input[type=number]') as HTMLInputElement, onChange };
};

describe('objectui#6765 — happy-dom does not sanitize a type="number" input', () => {
  it('keeps residue in .value, where a real browser returns the empty string', () => {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = '12abc';

    // The lying oracle, pinned. In Chromium the same two lines leave `.value`
    // as '' — measured, and the reason every widget test in this package needs
    // reading twice. The day happy-dom implements the sanitization algorithm
    // this goes red, which is exactly when someone should be told, because
    // every `fireEvent.change` in this package changes meaning that day.
    expect(input.value).toBe('12abc');
    expect(parseFloat(input.value)).toBe(12);
  });

  it('still reports validity.badInput, so it half-implements the algorithm', () => {
    // Load-bearing, not trivia: `validity.badInput` is the signal objectui#6780
    // built its guard on, because it is the PLATFORM's own predicate rather
    // than a renderer-side dialect.
    //
    // ⚠️ This file used to add "the ONE signal that agrees between this
    // environment and the browser". objectui#6780 measured that and it is too
    // strong — see `BAD_INPUT_DISAGREEMENTS` and the matrix above it. The
    // agreement is between happy-dom's PROGRAMMATIC verdict and Chromium's
    // TYPED verdict, it holds for a subset, and in Chromium `badInput` is never
    // true for a script write at all. The corrected statement is pinned below.
    const input = document.createElement('input');
    input.type = 'number';
    for (const text of HAPPY_DOM_FABRICATIONS) {
      input.value = text;
      expect(input.validity.badInput).toBe(true);
    }
    input.value = '';
    expect(input.validity.badInput).toBe(false);
  });

  it('does NOT agree with Chromium on badInput for eight measured inputs', () => {
    // objectui#6780's correction, pinned so the overstated one-liner cannot
    // come back. Each row is this environment's own reading; `chromiumTyped` is
    // the browser's, measured by typing the string key by key.
    const input = document.createElement('input');
    input.type = 'number';
    for (const row of BAD_INPUT_DISAGREEMENTS) {
      input.value = row.input;
      expect(
        input.validity.badInput,
        `happy-dom's reading of ${JSON.stringify(row.input)} moved; the ` +
          'agreement matrix in numberInputBrowserReadings.ts is now stale',
      ).toBe(row.happyDom);
      expect(row.happyDom).not.toBe(row.chromiumTyped);
    }
  });
});

describe('objectui#6765 — a whole-string guard has nothing left to reject here', () => {
  /**
   * ⚠️ The oracle is the PLATFORM's own `validity.badInput`, deliberately, and
   * not a transcription of objectui#6715's `WHOLE_NUMBER_TEXT`. That regex is
   * module-private to `LocationField.tsx`, and this card must not edit that
   * file to export it; copying its source here would create exactly the second
   * dialect of "what a number is" that AGENTS.md #0.1 forbids. `badInput` is
   * the better oracle anyway — it is the browser stating, in its own words,
   * whether it can read the text. ⚠️ objectui#6780 narrowed the claim that used
   * to end this paragraph ("the ONE signal happy-dom and Chromium agree on"):
   * they agree on a measured SUBSET, and in Chromium `badInput` is never true
   * for a programmatic write at all. See `BAD_INPUT_DISAGREEMENTS`.
   */
  it('the platform already reads every measured browser value as a whole number', () => {
    const input = document.createElement('input');
    input.type = 'number';
    for (const reading of BROWSER_READINGS) {
      input.value = reading;
      expect(
        input.validity.badInput,
        `${JSON.stringify(reading)} was measured coming out of a real Chromium ` +
          'number input, so nothing downstream of it has residue left to reject',
      ).toBe(false);
    }
  });

  it('and already calls every residue string bad input', () => {
    const input = document.createElement('input');
    input.type = 'number';
    for (const fabricated of HAPPY_DOM_FABRICATIONS) {
      input.value = fabricated;
      expect(input.validity.badInput).toBe(true);
    }
    // Which is the whole finding: a whole-string guard added to CurrencyField
    // or PercentField could only ever fire on the second list — strings this
    // environment fabricates and a browser never delivers. It would change
    // nothing a user can reach, and would make a happy-dom test go green over a
    // branch the product never executes.
  });
});

describe('objectui#6765 — the oracle and the product disagree, per widget', () => {
  /**
   * `[input, happy-dom emission, real-Chromium emission]`. The third column is
   * MEASURED against the mounted widget, not derived. `null` means the widget
   * emitted `null`; `undefined` means `onChange` was never called.
   *
   * ⛔ Column two is not a statement that the emission is correct.
   */
  const CASES: Array<{
    widget: 'currency' | 'percent';
    input: string;
    happyDom: number | null | undefined;
    browser: number | null | undefined;
  }> = [
    { widget: 'currency', input: '12abc', happyDom: 12, browser: 12 },
    { widget: 'currency', input: '1.2.3', happyDom: 1.2, browser: 1.23 },
    { widget: 'currency', input: '0x10', happyDom: 0, browser: 10 },
    { widget: 'currency', input: '1e', happyDom: 1, browser: null },
    { widget: 'currency', input: '', happyDom: undefined, browser: undefined },
    { widget: 'percent', input: '12abc', happyDom: 0.12, browser: 0.12 },
    { widget: 'percent', input: '1.2.3', happyDom: 0.012, browser: 0.0123 },
    { widget: 'percent', input: '0x10', happyDom: 0, browser: 0.1 },
    { widget: 'percent', input: '1e', happyDom: 0.01, browser: null },
    { widget: 'percent', input: '', happyDom: undefined, browser: undefined },
  ];

  it.each(CASES)(
    '$widget with $input: this environment emits $happyDom, the browser emits $browser',
    ({ widget, input, happyDom }) => {
      const { input: el, onChange } = renderHost(widget);
      fireEvent.change(el, { target: { value: input } });
      const emitted = onChange.mock.calls.length === 0 ? undefined : onChange.mock.calls[0][0];
      expect(emitted).toBe(happyDom);
      cleanup();
    },
  );

  it('disagrees on three of the four non-empty inputs, in both widgets', () => {
    const diverging = CASES.filter(c => !Object.is(c.happyDom, c.browser));
    expect(diverging.map(c => `${c.widget}:${c.input}`)).toEqual([
      'currency:1.2.3',
      'currency:0x10',
      'currency:1e',
      'percent:1.2.3',
      'percent:0x10',
      'percent:1e',
    ]);
  });

  it('emits null for text the browser is still DISPLAYING — a silent drop', () => {
    // objectui#6716's class, measured rather than assumed. In Chromium, typing
    // `1e` leaves the box VISIBLY showing `1e` while `.value` reads `''`; the
    // widget emits `null`, `aria-invalid` stays `false`, and no diagnostic is
    // drawn. Asserted here as the environment's nearest reachable equivalent:
    // the empty string is the browser's only channel for "text I am showing but
    // cannot read", and these widgets answer it silently.
    //
    // ⚠️ objectui#6780 landed the announcement and this pin deliberately did
    // NOT go red, which is itself the finding: it drives `''`, and an empty box
    // is `badInput === false` in BOTH engines. Clearing a field is a CLEARED
    // field, not unreadable text, and it must stay silent — announcing here
    // would fire on every deletion. The route that is now announced is the one
    // this environment cannot reach: in Chromium the user types `1e`, the box
    // keeps DISPLAYING it, `.value` reads `''` AND `badInput` is true. See
    // `NumberInputWidgets.badInputAnnounce.test.tsx`.
    for (const widget of ['currency', 'percent'] as const) {
      const { input: el, onChange } = renderHost(widget);
      fireEvent.change(el, { target: { value: '5' } });
      fireEvent.change(el, { target: { value: '' } });
      expect(onChange).toHaveBeenLastCalledWith(null);
      expect(el.getAttribute('aria-invalid')).toBe('false');
      cleanup();
    }
  });
});

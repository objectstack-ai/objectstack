/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6780 — a `type="number"` widget may no longer DISPLAY one value and
 * store another with nothing said.
 *
 * Ruled 2026-08-29 (option A): announce when `e.target.validity.badInput` is
 * true, across the whole `type="number"` widget CLASS as one change —
 * `CurrencyField`, `PercentField`, `NumberField`, `GeolocationField` — reusing
 * objectui#6716's refusal shape.
 *
 * ## What makes this a real fix and not a second no-op
 *
 * objectui#6715's anchored guard was measured to be a provable no-op on this
 * surface: it rejected only strings the test environment fabricates. This guard
 * was measured the other way round, in Chromium 141.0.7390.37 via Playwright,
 * typing each string key by key into a real number input:
 *
 *  - it FIRES on nine keyboard-reachable states (`1e`, `1e-`, `1e+`, `5e`, `-`,
 *    `.`, `+`, `-.`, `e`), each of which leaves `.value` at `''` while the box
 *    keeps DISPLAYING the text — confirmed by screenshot-comparing the box
 *    against an untouched one;
 *  - it NEVER fires on anything a real browser puts in `.value`
 *    ({@link BROWSER_READINGS}, all six `badInput === false`).
 *
 * ## ⚠️ Why this file drives only four of those nine
 *
 * happy-dom and Chromium do NOT agree about `badInput` in general — see the
 * matrix in `numberInputBrowserReadings.ts`. A unit test here may drive only
 * the strings where happy-dom's programmatic verdict matches Chromium's typed
 * verdict ({@link BAD_INPUT_AGREED}). Driving `0x10` or `12abc` would go green
 * over a branch the product never executes, which is the failure objectui#6765
 * exists to prevent; driving `-` or `.` would go red over behaviour that is
 * correct in the product. The other five are product behaviour this environment
 * cannot reproduce, and they are covered by the browser measurement only.
 *
 * ## ⛔ What is deliberately NOT asserted here
 *
 * That the widget refuses the edit. It does not — objectui#6716's shape refuses
 * and this one only announces, because refusing would make React restore the
 * control and wipe the very text the diagnostic points at. The emission
 * assertions below pin that on purpose.
 *
 * ## ⚠️ What objectui#8148 moved in this file, and why
 *
 * This suite used to spell its expectation as `badInputMessage(example)`. That
 * helper no longer composes an English sentence on its own: objectui#8148
 * routed the sentence through `useFieldTranslation` + `FIELD_DEFAULTS` (the
 * fifth application of objectui#6755's ruling), so it now takes the widget's
 * `t` and reads `fields.number.badInput`. A test cannot call it without
 * fabricating a `t`, and a fabricated `t` would make the expectation the
 * TEST's copy rather than the product's.
 *
 * So the expectation is spelled here as {@link EN_BAD_INPUT}, the English the
 * provider-less render produces — byte-identical to the literal this suite
 * asserted before, which is why every verdict below is UNCHANGED. That
 * byte-identity is not assumed here: `numberBadInput.i18n-8148.test.tsx`
 * asserts it through the rendered widget under an `en` provider and with no
 * provider at all, alongside the translated renders this file does not cover.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';
import { NumberField } from '../widgets/NumberField';
import { GeolocationField } from '../widgets/GeolocationField';
import {
  BROWSER_READINGS,
  BAD_INPUT_AGREED,
  BAD_INPUT_AGREED_CLEAN,
  CHROMIUM_KEYBOARD_REACHABLE_BAD_INPUT,
} from './numberInputBrowserReadings.js';

afterEach(() => cleanup());

/**
 * The sentence a provider-less render draws, one `example` filled in.
 *
 * ⚠️ Spelled here rather than imported (see the header): after
 * objectui#8148 the sentence's source is the locale pack, and the English
 * value is byte-identical to the literal this file asserted before.
 */
const EN_BAD_INPUT = (example: string) =>
  `Not saved: the text in this box is not a number. Enter a plain decimal (example: ${example}).`;

/**
 * Every widget of this class takes the same three runtime props, but their
 * `value` and `field` types differ (a number here, a `GeolocationValue` there).
 * ONE structural type expresses that, so the suite needs a single `unknown`
 * cast per widget instead of an `any` at every call site (AGENTS.md #6).
 */
type NumberishWidget = React.ComponentType<{
  value: unknown;
  onChange: (v: unknown) => void;
  field: Record<string, unknown>;
  onBlur?: React.FocusEventHandler<HTMLElement>;
}>;

const asWidget = (w: unknown) => w as NumberishWidget;

/**
 * Mount a widget with a host that ECHOES the emission back into `value`, the
 * way a real form does. Not decoration: these are CONTROLLED inputs, so with a
 * bare spy host `value` never moves and React suppresses the second change —
 * the same coupling the objectui#6765 suite needed.
 */
function mountWidget(
  Widget: NumberishWidget,
  field: Record<string, unknown>,
  initial: unknown,
  extra: { onBlur?: React.FocusEventHandler<HTMLElement> } = {},
) {
  const onChange = vi.fn();
  const Host = () => {
    const [value, setValue] = React.useState<unknown>(initial);
    return (
      <Widget
        value={value}
        onChange={v => { onChange(v); setValue(v); }}
        field={field}
        {...extra}
      />
    );
  };
  const { container } = render(<Host />);
  const boxes = container.querySelectorAll('input[type=number]');
  return { container, onChange, boxes, box: boxes[0] as HTMLInputElement };
}

/** The four widgets of the class, each with the example its own message quotes. */
const WIDGETS = [
  {
    name: 'CurrencyField',
    example: '1234.56',
    mount: () =>
      mountWidget(
        asWidget(CurrencyField),
        { name: 'amount', type: 'currency', currency: 'USD', precision: 2 },
        null,
      ),
  },
  {
    name: 'PercentField',
    example: '12.5',
    mount: () =>
      mountWidget(asWidget(PercentField), { name: 'rate', type: 'percent', precision: 2 }, null),
  },
  {
    name: 'NumberField',
    example: '1234',
    mount: () => mountWidget(asWidget(NumberField), { name: 'qty', type: 'number' }, null),
  },
  {
    name: 'GeolocationField (latitude)',
    example: '30.2741',
    mount: () => mountWidget(asWidget(GeolocationField), { name: 'where', type: 'geolocation' }, {}),
  },
] as const;

/** The drawn diagnostic, read the way a person reads it. */
const diagnostic = (container: HTMLElement): string | null => {
  const p = container.querySelector('p.text-red-500');
  return p ? (p.textContent || '').trim() : null;
};

/* -------------------------------------------------------------------------- */
/* 1. The announcement itself — objectui#6716's shape, on all four widgets.    */
/* -------------------------------------------------------------------------- */

describe.each(WIDGETS)('$name announces bad input (objectui#6780)', ({ example, mount }) => {
  it('is silent before anything is typed', () => {
    const { container, box } = mount();
    expect(diagnostic(container)).toBeNull();
    expect(box.getAttribute('aria-invalid')).not.toBe('true');
  });

  it.each(BAD_INPUT_AGREED)('marks the control invalid and says why, for %s', text => {
    const { container, box } = mount();
    fireEvent.change(box, { target: { value: text } });

    // The a11y state a screen reader reads...
    expect(box).toHaveAttribute('aria-invalid', 'true');
    // ...and a reason a person can read, in objectui#6716's `Not saved:` shape.
    expect(diagnostic(container)).toBe(EN_BAD_INPUT(example));
    expect(diagnostic(container)).toContain('Not saved:');
  });

  it('marks the refused control with the shared refusal border', () => {
    const { box } = mount();
    fireEvent.change(box, { target: { value: '1e' } });
    expect(box.className).toContain('border-red-500');
  });

  it.each(BAD_INPUT_AGREED_CLEAN)('stays silent for %s, which the browser can read', text => {
    const { container, box } = mount();
    fireEvent.change(box, { target: { value: text } });
    expect(diagnostic(container)).toBeNull();
    expect(box.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('clears the announcement once the entry is corrected', () => {
    const { container, box } = mount();
    fireEvent.change(box, { target: { value: '1e' } });
    expect(diagnostic(container)).not.toBeNull();

    fireEvent.change(box, { target: { value: '12' } });
    expect(diagnostic(container)).toBeNull();
    expect(box.getAttribute('aria-invalid')).not.toBe('true');
  });

  /* ---- the blur arm ---- */

  it('announces on BLUR, the route that fires no change event at all', () => {
    // The measured paste case: pasting `1e` into an EMPTY box moves `.value`
    // from `''` to `''`, so React's input-value tracking suppresses the
    // synthetic onChange entirely — one DOM `input` event fires and no
    // `onChange` reaches the widget. Modelled here by putting the box in that
    // state WITHOUT a change event, then blurring. `badInput` is still true at
    // blur time in Chromium, which is what makes this arm work.
    const { container, box, onChange } = mount();
    box.value = '1e';
    expect(onChange).not.toHaveBeenCalled();
    expect(diagnostic(container)).toBeNull();

    fireEvent.blur(box);

    expect(diagnostic(container)).toBe(EN_BAD_INPUT(example));
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('a blur on a readable box says nothing', () => {
    const { container, box } = mount();
    box.value = '12';
    fireEvent.blur(box);
    expect(diagnostic(container)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The guard ANNOUNCES; it does not refuse. Pinned deliberately.            */
/* -------------------------------------------------------------------------- */

describe('objectui#6780 announces without changing what is emitted', () => {
  it('CurrencyField still emits, exactly as it did before the guard', () => {
    const { box, onChange } = WIDGETS[0].mount();
    fireEvent.change(box, { target: { value: '1e' } });
    // happy-dom leaves `.value` as `'1e'`, so `parseFloat` yields 1 here; a real
    // Chromium hands the same handler `''` and it emits `null`. BOTH are the
    // pre-guard emission — the point is that the guard did not suppress it.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a cleared box is still a cleared box, and still silent', () => {
    // `''` is `badInput === false` in both engines. Announcing on it would fire
    // on every deletion, which is why it is in the CLEAN list.
    const { container, box, onChange } = WIDGETS[0].mount();
    fireEvent.change(box, { target: { value: '5' } });
    fireEvent.change(box, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(diagnostic(container)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Not a no-op — the property that separates this from objectui#6715.       */
/* -------------------------------------------------------------------------- */

describe('objectui#6780 fires on input a real browser can produce', () => {
  it('never fires on any value a real Chromium was measured to emit', () => {
    // The anti-no-op assertion, read off the SAME measured list the
    // objectui#6765 suite pins, so there is no second dialect and the claim
    // moves if the measurement moves.
    const input = document.createElement('input');
    input.type = 'number';
    for (const reading of BROWSER_READINGS) {
      input.value = reading;
      expect(
        input.validity.badInput,
        `${JSON.stringify(reading)} came out of a real Chromium number input, ` +
          'so the guard must not refuse it',
      ).toBe(false);
    }
  });

  it('the keyboard-reachable bad-input list is non-empty and contains the reproduced defect', () => {
    // objectui#6715's guard was a no-op because its "would reject" set was
    // empty for anything reachable. This one's is not: nine states, measured by
    // typing them into a real Chromium.
    expect(CHROMIUM_KEYBOARD_REACHABLE_BAD_INPUT.length).toBe(9);
    expect(CHROMIUM_KEYBOARD_REACHABLE_BAD_INPUT).toContain('1e');
    // And every string this suite drives is one of them, so nothing here is
    // asserted about a state a user cannot reach.
    for (const t of BAD_INPUT_AGREED) {
      expect(CHROMIUM_KEYBOARD_REACHABLE_BAD_INPUT).toContain(t);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 4. The composite: two boxes, two independent readings.                      */
/* -------------------------------------------------------------------------- */

describe('GeolocationField reads its two boxes independently (objectui#6780)', () => {
  const mountGeo = () => {
    const { container, boxes } = mountWidget(
      asWidget(GeolocationField),
      { name: 'where', type: 'geolocation' },
      {},
    );
    return { container, lat: boxes[0] as HTMLInputElement, lng: boxes[1] as HTMLInputElement };
  };

  it('bad latitude does not mark the longitude box invalid', () => {
    const { container, lat, lng } = mountGeo();
    fireEvent.change(lat, { target: { value: '1e' } });

    expect(lat).toHaveAttribute('aria-invalid', 'true');
    expect(lng).toHaveAttribute('aria-invalid', 'false');
    expect(container.querySelectorAll('p.text-red-500')).toHaveLength(1);
  });

  it('names each coordinate with its own example', () => {
    const { container, lat, lng } = mountGeo();
    fireEvent.change(lat, { target: { value: '1e' } });
    fireEvent.change(lng, { target: { value: '1e' } });

    const messages = Array.from(container.querySelectorAll('p.text-red-500')).map(
      p => (p.textContent || '').trim(),
    );
    expect(messages).toEqual([EN_BAD_INPUT('30.2741'), EN_BAD_INPUT('120.1551')]);
  });

  it('the longitude box announces on blur too', () => {
    const { container, lng } = mountGeo();
    lng.value = '1e';
    fireEvent.blur(lng);
    expect(diagnostic(container)).toBe(EN_BAD_INPUT('120.1551'));
  });
});

/* -------------------------------------------------------------------------- */
/* 5. The new blur arms must not eat the host's own onBlur.                    */
/* -------------------------------------------------------------------------- */

describe('the added onBlur composes the host handler instead of replacing it', () => {
  /**
   * `onBlur` is a DECLARED DOM pass-through key (`FieldWidgetDomProps`), so
   * `toDomProps` delivers a host's handler onto these controls. A widget that
   * writes its own `onBlur` AFTER that spread silently drops it — this
   * package's DECLARED-BUT-NOT-DELIVERED class (objectui#3290 / objectui#3222).
   *
   * ⭐ `CurrencyField` joined this list in objectui#6802. It was excluded here
   * on the reading that it "has overridden the host's `onBlur` since long
   * before this card, no host in this repo passes one today". ⛔ The second
   * half of that is FALSE, and the note is corrected rather than moved: the
   * form renderer hosts every field through react-hook-form's `Controller` and
   * spreads the controller field — which always carries an `onBlur` — into the
   * widget's props, so this widget was opting currency fields out of blur-mode
   * validation on every form in the repo. The user-visible reproduction lives
   * in `hostOnBlurDelivery-e2e.test.tsx`; `TagsField`, which carried the same
   * shape and is not a `type="number"` widget, is pinned in
   * `TagsField.hostOnBlur.test.tsx`.
   */
  it.each([
    ['PercentField', PercentField, { name: 'rate', type: 'percent' }],
    ['NumberField', NumberField, { name: 'qty', type: 'number' }],
    ['GeolocationField', GeolocationField, { name: 'where', type: 'geolocation' }],
    ['CurrencyField', CurrencyField, { name: 'amount', type: 'currency', currency: 'USD' }],
  ])('%s still calls a host onBlur', (_name, Widget, field) => {
    const hostBlur = vi.fn();
    const { box } = mountWidget(asWidget(Widget), field, undefined, { onBlur: hostBlur });
    fireEvent.blur(box);
    expect(hostBlur).toHaveBeenCalledTimes(1);
  });

  it('and still announces on that same blur', () => {
    const hostBlur = vi.fn();
    const { container, box } = mountWidget(
      asWidget(NumberField),
      { name: 'qty', type: 'number' },
      undefined,
      { onBlur: hostBlur },
    );
    box.value = '1e';
    fireEvent.blur(box);
    expect(hostBlur).toHaveBeenCalledTimes(1);
    expect(within(container).getByText(EN_BAD_INPUT('1234'))).toBeInTheDocument();
  });
});

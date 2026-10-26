/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6716 — a refusal must be ANNOUNCED, not silent.
 *
 * `LocationField` refuses to emit for input it cannot accept, and used to say
 * nothing when it did. Two refusals shared that silence: text that is not a
 * comma-separated pair (pre-existing), and a pair outside the spec's coordinate
 * range (objectui#6714). In both, `onChange` is simply not called; the box is a
 * controlled input, so the typed text disappeared, `aria-invalid` read `"false"`
 * throughout, and nothing was rendered to explain it.
 *
 * ⛔ This does NOT reverse #6714. Refusal stays refusal — every pin below that
 * asserts "no emission" is #6714's rule, unchanged. This card only makes the
 * refusal visible.
 *
 * ## Why the diagnostic is the WIDGET's, not the form renderer's
 *
 * Triage first routed the fix to `buildValidationRules`, to keep ONE producer
 * for the published objectui#3222 `error` slot. That route was measured on
 * `faac0d935` and is structurally unable to express this refusal: a real
 * `location` branch installed there is invoked with `undefined` in BOTH refusal
 * arms, because a refusal means `onChange` never fires, so the typed text never
 * becomes a form value at all — while the same branch fires correctly for a
 * STORED out-of-range pair. `buildValidationRules` compiles value-shaped rules;
 * a refusal has no value. It HAS one as of objectui#6744 — for that STORED
 * case, never for these refusal arms — and this card did not give it one.
 *
 * So the state is the widget's own, following `ObjectField`'s live precedent in
 * this same directory: a second name (`parseError` there, `refusalError` here),
 * never the published slot, OR-ed into `aria-invalid` and rendered as the
 * widget's own short line. The published `error` keeps exactly one author — the
 * last test in this file is the pin for that.
 *
 * ## Why the box now HOLDS the refused text
 *
 * That is the one piece of controlled-input semantics this card changes, and it
 * was taken on a measurement rather than on taste. The minimal shape — refusal
 * state only, value still derived from `value` — was BUILT and driven first. It
 * is incoherent: with no draft, React restores the control in the same tick, so
 * the message points at an empty box, and every keystroke of a legitimate entry
 * is judged as a finished one. Measured on the minimal shape, typing a valid
 * `30.27, 120.15` one character at a time: the box read `""` after all 13
 * keystrokes, the refusal was lit after 12 of them INCLUDING the last, and the
 * form stored `place: null`. The diagnostic could not tell "refused" from
 * "still typing" because nothing survived the keystroke. Holding the draft is
 * what makes the announcement honest — the same coupling `ObjectField` has.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { valueSchemaFor } from '@objectstack/spec/data';

import { LocationField, type LocationValue } from '../widgets/LocationField';

const LOCATION_SCHEMA = valueSchemaFor({ type: 'location' } as any)!;

const field = { name: 'site', label: 'Site', type: 'location' } as any;

/** A stored, in-range value — the "prior value" a refusal must leave standing. */
const STORED: LocationValue = { lat: 10, lng: 20 };

function box(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

/** The widget's own refusal line, or `null` when it is announcing nothing. */
function diagnostic(container: HTMLElement): string | null {
  const p = container.querySelector('p');
  return p ? p.textContent : null;
}

function mount(value: unknown = STORED, extra: Record<string, unknown> = {}) {
  cleanup();
  const onChange = vi.fn();
  const { container } = render(
    <LocationField
      field={field}
      value={value as LocationValue | null}
      onChange={onChange}
      {...(extra as any)}
    />,
  );
  return { container, onChange };
}

/**
 * What the SPEC says about a pair, rendered the way the widget renders it.
 *
 * ⛔ The expected sentence is never typed out with `90` / `180` in it. A bound
 * copied into this file is a second contract that keeps passing on the day the
 * schema moves — the exact failure objectui#6714 was about, reintroduced in the
 * test. The oracle is the schema's own issues.
 */
function expectedRangeMessage(pair: unknown): string {
  const parsed = LOCATION_SCHEMA.safeParse(pair);
  if (parsed.success) throw new Error('expectedRangeMessage called on a pair the spec ACCEPTS');
  const detail = parsed.error.issues
    .map((i: any) => `${i.path.join('.') || 'value'}: ${i.message}`)
    .join('; ');
  return `Not saved: ${detail}`;
}

/* -------------------------------------------------------------------------- */
/* Arm 1 — the FORMAT refusal, silent since long before #6714.                 */
/* -------------------------------------------------------------------------- */

describe('LocationField announces a FORMAT refusal (objectui#6716)', () => {
  it('marks the control invalid and says why, instead of swallowing the edit', () => {
    const { container, onChange } = mount();
    fireEvent.change(box(), { target: { value: 'not a coordinate' } });

    // The announcement: state on the control, and a reason a person can read.
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(diagnostic(container)).toBe(
      'Not saved: enter a latitude, longitude pair (example: 30.2741, 120.1551).',
    );
    // #6714's rule, untouched: the refusal still refuses.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the refused text in the box, so the message has something to point at', () => {
    mount();
    fireEvent.change(box(), { target: { value: 'not a coordinate' } });
    expect(box()).toHaveValue('not a coordinate');
  });

  it('announces the pair-shaped text that still is not a pair', () => {
    // `parts.length === 2` but neither half is a number — the other half of the
    // format arm, and the one a "does it contain a comma" shortcut would miss.
    const { container, onChange } = mount();
    fireEvent.change(box(), { target: { value: 'here, there' } });
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(diagnostic(container)).toContain('Not saved:');
    expect(onChange).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Arm 2 — the RANGE refusal #6714 added.                                      */
/* -------------------------------------------------------------------------- */

describe('LocationField announces a RANGE refusal (objectui#6716)', () => {
  it('marks the control invalid and reports the SPEC\'s own complaint', () => {
    const { container, onChange } = mount();
    fireEvent.change(box(), { target: { value: '999, 999' } });

    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(diagnostic(container)).toBe(expectedRangeMessage({ lat: 999, lng: 999 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ['91, 0', { lat: 91, lng: 0 }],
    ['0, 181', { lat: 0, lng: 181 }],
    ['-91, 0', { lat: -91, lng: 0 }],
    ['0, -181', { lat: 0, lng: -181 }],
  ])('names the offending coordinate for %s', (typed, pair) => {
    const { container } = mount();
    fireEvent.change(box(), { target: { value: typed } });
    expect(diagnostic(container)).toBe(expectedRangeMessage(pair));
    // The message carries the key the spec complained about, and only that one.
    const offending = Object.keys(pair).filter(k => (pair as any)[k] !== 0);
    for (const key of offending) expect(diagnostic(container)).toContain(`${key}:`);
  });

  it('keeps the refused pair in the box', () => {
    mount();
    fireEvent.change(box(), { target: { value: '999, 999' } });
    expect(box()).toHaveValue('999, 999');
  });
});

/* -------------------------------------------------------------------------- */
/* Correcting a refusal clears the announcement.                               */
/* -------------------------------------------------------------------------- */

describe('LocationField clears the announcement when the refusal is corrected (objectui#6716)', () => {
  it.each([['format', 'not a coordinate'], ['range', '999, 999']])(
    'a corrected %s refusal leaves no diagnostic and emits the value',
    (_arm, refused) => {
      const { container, onChange } = mount();
      fireEvent.change(box(), { target: { value: refused } });
      expect(box()).toHaveAttribute('aria-invalid', 'true');

      fireEvent.change(box(), { target: { value: '30.2741, 120.1551' } });
      expect(box()).toHaveAttribute('aria-invalid', 'false');
      expect(diagnostic(container)).toBeNull();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toEqual({ lat: 30.2741, lng: 120.1551 });
    },
  );

  it('clearing the box clears the announcement too, and still emits null', () => {
    const { container, onChange } = mount();
    fireEvent.change(box(), { target: { value: '999, 999' } });
    fireEvent.change(box(), { target: { value: '' } });
    expect(diagnostic(container)).toBeNull();
    expect(box()).toHaveAttribute('aria-invalid', 'false');
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

/* -------------------------------------------------------------------------- */
/* The other direction: a valid coordinate must cost nothing.                  */
/* -------------------------------------------------------------------------- */

describe('LocationField still accepts every coordinate the spec accepts (objectui#6716)', () => {
  it.each([
    ['30.2741, 120.1551', { lat: 30.2741, lng: 120.1551 }],
    ['90, 180', { lat: 90, lng: 180 }],
    ['-90, -180', { lat: -90, lng: -180 }],
    ['0, 0', { lat: 0, lng: 0 }],
  ])('%s emits, announces nothing, and stays valid', (typed, expected) => {
    expect(LOCATION_SCHEMA.safeParse(expected).success).toBe(true);
    const { container, onChange } = mount(null);
    fireEvent.change(box(), { target: { value: typed } });
    expect(onChange.mock.calls.map(c => c[0])).toEqual([expected]);
    expect(diagnostic(container)).toBeNull();
    expect(box()).toHaveAttribute('aria-invalid', 'false');
  });

  /**
   * The realistic interaction, and the pin the whole shape rests on: a person
   * types a coordinate ONE CHARACTER AT A TIME.
   *
   * This is what fails under the minimal (no-draft) shape — measured there:
   * every keystroke erased, the refusal lit on the LAST one too, and nothing
   * emitted. Here the draft accumulates, the announcement clears the moment the
   * text is a pair the spec accepts, and what the user typed is what is emitted.
   */
  it('lets a coordinate be TYPED, character by character, and ends clean', async () => {
    const user = userEvent.setup();
    const { container, onChange } = mount(null);
    await user.click(box());
    await user.type(box(), '30.27, 120.15');

    expect(box()).toHaveValue('30.27, 120.15');
    expect(box()).toHaveAttribute('aria-invalid', 'false');
    expect(diagnostic(container)).toBeNull();
    const emissions = onChange.mock.calls.map(c => c[0]);
    expect(emissions[emissions.length - 1]).toEqual({ lat: 30.27, lng: 120.15 });
  });

  /**
   * A host that does NOT echo the emission back — an `onChange` spy, a
   * debounced or normalising host. The draft must survive it.
   *
   * The first draft-sync rule written for this card ("overwrite whenever the
   * draft disagrees with `value`") fired on every keystroke here and erased the
   * text as it was typed, leaving `20.15` in the box for the run above. The
   * rule reacts to the VALUE CHANGING instead, which is the only event that
   * means "somebody else set this field".
   */
  it('keeps what was typed when the host never echoes the value back', () => {
    const { container, onChange } = mount(null);
    fireEvent.change(box(), { target: { value: '30.27, 120.15' } });
    // `value` is still `null` — this parent ignores emissions entirely.
    expect(box()).toHaveValue('30.27, 120.15');
    expect(diagnostic(container)).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('adopts a value that arrives from OUTSIDE the box', () => {
    // The record finishing its load, or a host resetting the form: nothing has
    // been typed, so the box must show what is now stored.
    cleanup();
    const { rerender } = render(<LocationField field={field} value={null} onChange={vi.fn()} />);
    expect(box()).toHaveValue('');
    rerender(<LocationField field={field} value={{ lat: 12, lng: 34 }} onChange={vi.fn()} />);
    expect(box()).toHaveValue('12, 34');
  });

  it('still carries the optional keys across an in-range edit (objectui#6664)', () => {
    const { onChange } = mount({ lat: 30.2741, lng: 120.1551, altitude: 5, accuracy: 12 });
    fireEvent.change(box(), { target: { value: '31.2304, 121.4737' } });
    expect(onChange.mock.calls.map(c => c[0])).toEqual([
      { lat: 31.2304, lng: 121.4737, altitude: 5, accuracy: 12 },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* The published slot keeps exactly one author.                                */
/* -------------------------------------------------------------------------- */

describe('LocationField leaves the published `error` slot single-authored (objectui#3222)', () => {
  it('honours a HOST-produced error without rendering its text', () => {
    // `error` is the form renderer's; its TEXT is drawn by `<FormMessage/>`. A
    // widget that also rendered it would double-display it (the reason the
    // widget contract documents `error` as read-only-for-aria-invalid).
    const { container } = mount(STORED, { error: 'Host says this field is required' });
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(container.textContent).not.toContain('Host says this field is required');
    expect(diagnostic(container)).toBeNull();
  });

  it('ORs the two, so a host error survives a widget-side clear', () => {
    const { container } = mount(STORED, { error: 'Host says no' });
    // A refusal, then a correction: the widget's own state clears, the host's
    // does not — and `aria-invalid` still reports the host's.
    fireEvent.change(box(), { target: { value: '999, 999' } });
    expect(diagnostic(container)).not.toBeNull();
    fireEvent.change(box(), { target: { value: '30.2741, 120.1551' } });
    expect(diagnostic(container)).toBeNull();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
  });
});

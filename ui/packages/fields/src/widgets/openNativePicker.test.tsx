/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `openNativePicker` and its sole router (objectui#7570).
 *
 * ## What this file closes
 *
 * `openNativePicker.ts` was named by ZERO test files in the repo, while the
 * sibling helper `DateField` also routes through — `toDateInputValue` — was
 * named by two. `DateField` itself is well covered
 * (`src/datetime-widgets.test.tsx` holds a dedicated block,
 * `__tests__/date-locale-channel.test.tsx` pins the locale channel), but not
 * one of those cases FIRES A CLICK, so the only call site of this helper —
 * the `onClick` handler in `DateField.tsx` — was never executed. "This file is
 * well covered" was true of the file and false of that line, which is the
 * shape a coverage number hides best.
 *
 * This is a coverage gap, not a defect report: no wrong behaviour was
 * observed, and nothing here changes `openNativePicker.ts` or `DateField.tsx`.
 *
 * ## Why the helper is NOT mocked
 *
 * Mocking `openNativePicker` would let these tests assert "we called the thing
 * we mocked" — coverage up, protection zero. The real helper runs; the
 * observable side effect is `showPicker()`, spied on the prototype.
 *
 * happy-dom 20.11.2 does NOT implement `HTMLInputElement.showPicker`, and the
 * helper's call is optional (`input.showPicker?.()`), so WITHOUT a stand-in
 * the click produces no observable effect at all and any assertion here would
 * pass for an empty reason. Installing the spy on the prototype is therefore
 * load-bearing, not decoration — the same route
 * `packages/components/src/renderers/form/__tests__/form-date-picker-click.test.tsx`
 * takes for the form renderer's copy of this behaviour. What is pinned is the
 * CALL PATH; the browser's own picker behaviour is out of reach of this DOM
 * and is deliberately not claimed.
 *
 * ## What is deliberately NOT pinned
 *
 * The ORDER of the two statements in the handler. Swapping them changes no
 * observable outcome, so an order assertion would fail a legitimate refactor
 * while guarding nothing. What IS pinned is that a single click runs BOTH —
 * which is what a short-circuit (either statement swallowing the other) breaks.
 */
import type { MouseEvent } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DateField } from './DateField';
import { openNativePicker } from './openNativePicker';
import type { FieldWidgetComponentProps } from './types';

/**
 * Install a `showPicker` spy on the prototype and record the receiver of every
 * call. The receiver is what proves the helper was handed the FIELD'S OWN
 * input (`e.currentTarget`) rather than some other element.
 */
function spyOnNativePicker() {
  const receivers: EventTarget[] = [];
  const showPicker = vi.fn(function (this: HTMLInputElement) {
    receivers.push(this);
  });
  HTMLInputElement.prototype.showPicker = showPicker;
  return { showPicker, receivers };
}

afterEach(() => {
  // `Reflect.deleteProperty`, not `delete`: lib.dom declares `showPicker(): void`
  // as a REQUIRED member, so `delete` on it is a compile error (TS2790) even
  // though the runtime property is one this file put there.
  Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
});

const baseProps: FieldWidgetComponentProps<string> = {
  field: { name: 'due_on', label: 'Due on', type: 'date' } as FieldWidgetComponentProps<string>['field'],
  value: '',
  onChange: vi.fn(),
  readonly: false,
};

function renderDateField(extra: Partial<FieldWidgetComponentProps<string>> = {}) {
  const { container } = render(<DateField {...baseProps} {...extra} />);
  const input = container.querySelector('input[type="date"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('DateField rendered no date input — the fixture, not the claim, is broken.');
  }
  return input;
}

describe('DateField — the sole router into openNativePicker (objectui#7570)', () => {
  it('PIN 1: clicking the field invokes the helper on the field\'s own input', () => {
    const { showPicker, receivers } = spyOnNativePicker();

    const input = renderDateField();
    expect(showPicker).not.toHaveBeenCalled(); // rendering alone must not open it

    fireEvent.click(input);

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(receivers[0]).toBe(input);
  });

  it('PIN 2: a host onClick delivered through DOM props is not swallowed', () => {
    spyOnNativePicker();

    let seenCurrentTarget: EventTarget | null = null;
    const hostOnClick = vi.fn((event: MouseEvent<HTMLElement>) => {
      seenCurrentTarget = event.currentTarget;
    });

    const input = renderDateField({ onClick: hostOnClick });
    fireEvent.click(input);

    expect(hostOnClick).toHaveBeenCalledTimes(1);
    // Read inside the handler: React nulls `currentTarget` once dispatch ends,
    // so asserting it off the recorded call afterwards would read `null`.
    expect(seenCurrentTarget).toBe(input);
  });

  it('PIN 3: one click runs BOTH — neither statement short-circuits the other', () => {
    const { showPicker } = spyOnNativePicker();
    const hostOnClick = vi.fn();

    const input = renderDateField({ onClick: hostOnClick });
    fireEvent.click(input);

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(hostOnClick).toHaveBeenCalledTimes(1);
  });
});

describe('openNativePicker — the helper itself (objectui#7570)', () => {
  function makeInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'date';
    return input;
  }

  it('opens the picker for an ordinary enabled input', () => {
    const { showPicker } = spyOnNativePicker();
    openNativePicker(makeInput());
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('stays shut for a disabled input', () => {
    const { showPicker } = spyOnNativePicker();
    const input = makeInput();
    input.disabled = true;
    openNativePicker(input);
    expect(showPicker).not.toHaveBeenCalled();
  });

  it('stays shut for a readOnly input', () => {
    const { showPicker } = spyOnNativePicker();
    const input = makeInput();
    input.readOnly = true;
    openNativePicker(input);
    expect(showPicker).not.toHaveBeenCalled();
  });

  it('swallows a throwing showPicker — the native icon still works', () => {
    const input = makeInput();
    input.showPicker = () => {
      throw new Error('NotAllowedError: showPicker() requires a user gesture');
    };
    expect(() => openNativePicker(input)).not.toThrow();
  });

  it('is a no-op where the browser has no showPicker at all', () => {
    // No spy installed in this case, and `afterEach` removed any prior one, so
    // the property is genuinely absent — the happy-dom / older-browser shape.
    const input = makeInput();
    expect(input.showPicker).toBeUndefined();
    expect(() => openNativePicker(input)).not.toThrow();
  });
});

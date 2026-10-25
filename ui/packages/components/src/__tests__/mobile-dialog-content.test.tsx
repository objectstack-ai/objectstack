/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * MobileDialogContent guards against a portalled dropdown closing the whole
 * dialog. Radix Select / Popover render their flyout into a portal at
 * `document.body` (outside the dialog DOM), so clicking empty space inside an
 * open dropdown reads as an "interact outside" and used to dismiss the dialog.
 * `isInsidePopperLayer` is the predicate that suppresses that case while
 * leaving a genuine backdrop click (which still closes the dialog) untouched.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  isInsidePopperLayer,
  usePopperAwareInteractOutside,
} from '../custom/mobile-dialog-content';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isInsidePopperLayer', () => {
  it("treats a click inside a Radix popper wrapper as the dialog's own dropdown", () => {
    const host = mount(
      '<div data-radix-popper-content-wrapper><div role="listbox"><div id="opt">option</div></div></div>',
    );
    expect(isInsidePopperLayer(host.querySelector('#opt'))).toBe(true);
  });

  it('matches the select content / viewport variants too', () => {
    const host = mount(
      '<div data-radix-select-content><div data-radix-select-viewport><span id="item">x</span></div></div>',
    );
    expect(isInsidePopperLayer(host.querySelector('#item'))).toBe(true);
    expect(isInsidePopperLayer(host.querySelector('[data-radix-select-content]'))).toBe(true);
  });

  it('does NOT match a genuine backdrop / outside-the-dropdown target', () => {
    const host = mount('<div id="overlay" data-radix-dialog-overlay></div>');
    expect(isInsidePopperLayer(host.querySelector('#overlay'))).toBe(false);
  });

  it('is null/undefined safe', () => {
    expect(isInsidePopperLayer(null)).toBe(false);
    expect(isInsidePopperLayer(undefined)).toBe(false);
  });
});

/**
 * usePopperAwareInteractOutside — the deferred-dismissal path (#2156).
 *
 * radix-dialog@1.1.17 defers its outside-pointerdown verdict to the `click`
 * phase, but radix-select dismisses and unregisters on `pointerdown`. The one
 * click that closes an open dropdown therefore ALSO reads as the dialog's own
 * outside click and used to dismiss the whole modal. The hook snapshots
 * "popper open?" on document pointerdown (capture) and swallows the
 * pointer-initiated interact-outside that follows.
 */
describe('usePopperAwareInteractOutside', () => {
  const pointerInteractOutside = (target: Element) =>
    ({
      detail: { originalEvent: { type: 'pointerdown', target } },
      preventDefault: vi.fn(),
    }) as any;

  const dispatchPointerDown = () =>
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  it('swallows the interact-outside when a popper flyout was open at pointerdown', () => {
    mount('<div data-radix-popper-content-wrapper><div role="listbox"></div></div>');
    const inner = vi.fn();
    const { result } = renderHook(() => usePopperAwareInteractOutside(inner));

    dispatchPointerDown();
    const event = pointerInteractOutside(document.body);
    result.current(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it('lets a plain backdrop click through when no popper is open', () => {
    const inner = vi.fn();
    const { result } = renderHook(() => usePopperAwareInteractOutside(inner));

    dispatchPointerDown();
    const event = pointerInteractOutside(document.body);
    result.current(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledWith(event);
  });

  it('closes normally on the SECOND click after the dropdown-closing one', () => {
    const host = mount('<div data-radix-popper-content-wrapper></div>');
    const inner = vi.fn();
    const { result } = renderHook(() => usePopperAwareInteractOutside(inner));

    // First click: popper open → swallowed (it closes the dropdown).
    dispatchPointerDown();
    const first = pointerInteractOutside(document.body);
    result.current(first);
    expect(first.preventDefault).toHaveBeenCalled();

    // Dropdown unmounts; second click must dismiss the dialog again.
    host.remove();
    dispatchPointerDown();
    const second = pointerInteractOutside(document.body);
    result.current(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledWith(second);
  });

  it('still guards a target INSIDE a (possibly detached) popper layer', () => {
    const host = mount('<div data-radix-popper-content-wrapper><span id="in">x</span></div>');
    const target = host.querySelector('#in')!;
    const { result } = renderHook(() => usePopperAwareInteractOutside());

    const event = pointerInteractOutside(target);
    result.current(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not apply the popper flag to focus-driven interact-outside', () => {
    mount('<div data-radix-popper-content-wrapper></div>');
    const inner = vi.fn();
    const { result } = renderHook(() => usePopperAwareInteractOutside(inner));

    dispatchPointerDown();
    const event = {
      detail: { originalEvent: { type: 'focusin', target: document.body } },
      preventDefault: vi.fn(),
    } as any;
    result.current(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledWith(event);
  });
});

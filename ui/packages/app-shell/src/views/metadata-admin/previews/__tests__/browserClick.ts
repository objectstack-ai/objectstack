// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { fireEvent } from '@testing-library/react';

const POINTER_ID = 1;

/**
 * A primary-button click dispatched the way a browser dispatches it
 * (objectui#11546).
 *
 * `fireEvent.click` alone skips the press, and happy-dom records
 * `setPointerCapture` without routing any event by it. A browser sends the
 * pointerup and the click to the element that took pointer capture during the
 * press, then releases the capture. That routing is what hid objectui#11546
 * from the flow canvas pins: in Chromium, the canvas background captured a
 * node press on a read-only canvas, the click landed on the viewport, and the
 * node's own select never ran. This helper does that routing, so a press that
 * leaks to the background fails the pin the way it fails in a browser.
 */
export function browserClick(target: HTMLElement): void {
  const at = { button: 0, pointerId: POINTER_ID, clientX: 10, clientY: 10 };
  fireEvent.pointerDown(target, at);
  const captor = capturing() ?? target;
  fireEvent.pointerUp(captor, at);
  fireEvent.click(captor, { button: 0 });
  releaseAll();
}

/**
 * A primary-button press that moves before it is released, routed the same
 * way. Returns the element that held pointer capture during the move, or null
 * when nothing captured the press.
 */
export function browserDrag(target: HTMLElement, dx: number, dy: number): HTMLElement | null {
  fireEvent.pointerDown(target, { button: 0, pointerId: POINTER_ID, clientX: 0, clientY: 0 });
  const captor = capturing();
  const routed = captor ?? target;
  fireEvent.pointerMove(routed, { pointerId: POINTER_ID, clientX: dx, clientY: dy });
  fireEvent.pointerUp(routed, { button: 0, pointerId: POINTER_ID, clientX: dx, clientY: dy });
  releaseAll();
  return captor;
}

function capturing(): HTMLElement | null {
  return Array.from(document.body.querySelectorAll<HTMLElement>('*')).find((el) => el.hasPointerCapture?.(POINTER_ID)) ?? null;
}

/** A browser releases capture implicitly after pointerup; happy-dom does not. */
function releaseAll(): void {
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (el.hasPointerCapture?.(POINTER_ID)) el.releasePointerCapture(POINTER_ID);
  }
}

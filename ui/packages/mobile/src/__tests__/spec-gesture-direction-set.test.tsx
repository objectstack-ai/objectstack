/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `swipe` fires on MEMBERSHIP of the declared direction set (objectui#7974).
 *
 * `SwipeGestureConfig.direction` is declared `SpecSwipeDirection[]` — a set.
 * The hook used to read `direction[0]` and fuse it into one direction-specific
 * recognizer, so every element after the first was declared and then never
 * honoured, and an empty set silently recognized a LEFT swipe. It also carried
 * an `as string` cast that let a scalar `direction` through the runtime even
 * though the declared type rejects it.
 *
 * These run against the real `useGesture` — the recognizer choice and the
 * membership filter are two halves of one behaviour, and mocking the
 * recognizer would pin only the half that lives in this file.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { SpecGestureConfig, SwipeGestureConfig } from '@object-ui/types';
import { useSpecGesture } from '../useSpecGesture';

function Surface(props: {
  config: SpecGestureConfig;
  onSwipe?: (direction: string) => void;
  onGesture?: (context: { type: string; direction?: string }) => void;
}) {
  const ref = useSpecGesture<HTMLDivElement>(props);
  return <div ref={ref} data-testid="surface" />;
}

/** A touch event jsdom does not construct: the handlers read `touches[0]` and
 *  `changedTouches[0]`, and nothing else on the event. */
function fireTouch(el: HTMLElement, type: 'touchstart' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  const list = [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: list });
  Object.defineProperty(event, 'changedTouches', { value: list });
  el.dispatchEvent(event);
}

/** Drag from the centre by (dx, dy) — past any threshold these cases declare. */
function swipe(el: HTMLElement, dx: number, dy: number) {
  fireTouch(el, 'touchstart', 200, 200);
  fireTouch(el, 'touchend', 200 + dx, 200 + dy);
}

const config = (swipeConfig: SwipeGestureConfig): SpecGestureConfig => ({
  type: 'swipe',
  enabled: true,
  swipe: swipeConfig,
});

describe('swipe honours the whole declared direction set', () => {
  it('fires for EVERY member, not just the first', () => {
    const onSwipe = vi.fn();
    const { getByTestId } = render(
      <Surface config={config({ direction: ['left', 'up'], threshold: 60 })} onSwipe={onSwipe} />,
    );
    const surface = getByTestId('surface');

    swipe(surface, -120, 0);
    expect(onSwipe, 'the first member of the declared set').toHaveBeenCalledWith('left');

    onSwipe.mockClear();
    swipe(surface, 0, -120);
    expect(onSwipe, 'a member after the first — this is what `direction[0]` dropped').toHaveBeenCalledWith('up');
  });

  it('does not fire for a direction the set does not declare', () => {
    const onSwipe = vi.fn();
    const { getByTestId } = render(
      <Surface config={config({ direction: ['left', 'up'], threshold: 60 })} onSwipe={onSwipe} />,
    );

    swipe(getByTestId('surface'), 120, 0);
    expect(onSwipe, 'a right swipe is outside the declared set').not.toHaveBeenCalled();
  });

  it('an EMPTY declared set fires for nothing — it does not default to left', () => {
    const onSwipe = vi.fn();
    const { getByTestId } = render(
      <Surface config={config({ direction: [], threshold: 60 })} onSwipe={onSwipe} />,
    );

    swipe(getByTestId('surface'), -120, 0);
    expect(onSwipe, 'nothing is declared, so nothing is a member').not.toHaveBeenCalled();
  });

  it('the fallback reports the SPEC gesture and the detected direction', () => {
    const onGesture = vi.fn();
    const { getByTestId } = render(
      <Surface config={config({ direction: ['down'], threshold: 60 })} onGesture={onGesture} />,
    );

    swipe(getByTestId('surface'), 0, 120);
    expect(onGesture).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'swipe', direction: 'down' }),
    );
  });

  it('the declared type admits no scalar — nothing re-softens what the cast used to accept', () => {
    // @ts-expect-error — `direction` is `SpecSwipeDirection[]`; a scalar is the
    // shape the removed `as string` cast used to let through at runtime.
    const scalar: SwipeGestureConfig = { direction: 'left', threshold: 80 };
    expect(scalar.direction).toBe('left');
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Gesture type ↔ gesture vocabulary parity + dispatch (#2942).
 *
 * `useSpecGesture` never read `config.type` — it branched on which
 * sub-object was present, so `pan` / `drag` / `rotate` / `double_tap` (types
 * with no sub-object) all kept the `'tap'` initializer and fired on a tap.
 *
 * The vocabulary this pins USED to be `@objectstack/spec/ui`'s
 * `GestureTypeSchema`. `@objectstack/spec` 17.0.0-rc.3 deleted the whole
 * `ui/touch` module (objectstack#4988, PR objectstack#5321) because none of it
 * had an authoring door, and objectui#3363 recorded this file as one of the
 * three that would go red on the dependency refresh that brought it in.
 *
 * The pin is RE-POINTED rather than deleted: `SPEC_GESTURE_TYPES` in
 * `@object-ui/types` is the same vocabulary under its new owner, and both
 * directions still say something real — every declared gesture type must reach
 * a recogniser, and `SPEC_GESTURE_TYPE_MAP` must not grow an entry the
 * vocabulary does not declare. Deleting it instead would have removed live
 * coverage of the very bug #2942 fixed, on the strength of an upstream change
 * that did not touch this repo's behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SPEC_GESTURE_TYPES } from '@object-ui/types';
import { useSpecGesture, SPEC_GESTURE_TYPE_MAP } from '../useSpecGesture';
import { useGesture } from '../useGesture';

vi.mock('../useGesture', () => ({ useGesture: vi.fn(() => ({ current: null })) }));

const gestureNames: string[] = [...SPEC_GESTURE_TYPES];

describe('useSpecGesture covers the declared gesture vocabulary', () => {
  it('reads a non-empty vocabulary', () => {
    expect(gestureNames, 'could not read SPEC_GESTURE_TYPES from @object-ui/types').not.toEqual(
      [],
    );
  });

  it('maps every declared gesture type onto a recognizer', () => {
    const unmapped = gestureNames.filter((name) => !(name in SPEC_GESTURE_TYPE_MAP));
    expect(unmapped, 'these validate and then recognize as a plain tap').toEqual([]);
  });

  it('maps only declared gesture types', () => {
    const extra = Object.keys(SPEC_GESTURE_TYPE_MAP).filter(
      (name) => !gestureNames.includes(name),
    );
    expect(extra, 'undeclared gesture dialect — add it to SPEC_GESTURE_TYPES first').toEqual([]);
  });
});

describe('the declared type drives recognition', () => {
  beforeEach(() => vi.mocked(useGesture).mockClear());

  const recognizerFor = (config: Record<string, unknown>) => {
    renderHook(() => useSpecGesture({ config: config as never, onGesture: () => {} }));
    return vi.mocked(useGesture).mock.calls.at(-1)?.[0]?.type;
  };

  it("'double_tap' / 'pan' / 'drag' / 'rotate' no longer collapse to tap", () => {
    expect(recognizerFor({ type: 'double_tap' })).toBe('double-tap');
    expect(recognizerFor({ type: 'pan' })).toBe('pan');
    expect(recognizerFor({ type: 'drag' })).toBe('pan');
    expect(recognizerFor({ type: 'rotate' })).toBe('rotate');
  });

  it('swipe recognizes ANY direction — the declared set is filtered, not fused into the recognizer', () => {
    // It used to fuse `direction[0]` into a direction-specific recognizer, which
    // is how every element after the first was declared and never honoured
    // (objectui#7974). Membership of the declared set is pinned behaviourally in
    // `spec-gesture-direction-set.test.tsx`, against the real recognizer.
    expect(recognizerFor({ type: 'swipe', swipe: { direction: ['up'] } })).toBe('pan');
  });

  it('legacy configs without a type still resolve from their sub-object', () => {
    expect(recognizerFor({ longPress: { duration: 400 } })).toBe('long-press');
    expect(recognizerFor({ pinch: {} })).toBe('pinch');
  });
});

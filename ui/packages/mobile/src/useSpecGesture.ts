/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useGesture } from './useGesture.js';
import type { GestureType, SpecGestureConfig } from '@object-ui/types';

export interface UseSpecGestureOptions {
  /** Spec gesture configuration */
  config: SpecGestureConfig;
  /** Callback when a swipe gesture is detected */
  onSwipe?: (direction: string) => void;
  /** Callback when a pinch gesture is detected */
  onPinch?: (scale: number) => void;
  /** Callback when a long-press gesture is detected */
  onLongPress?: () => void;
  /** Callback when a double-tap gesture is detected */
  onDoubleTap?: () => void;
  /** Callback when a pan/drag gesture is detected (any-direction move) */
  onPan?: (direction: string) => void;
  /** Callback when a rotate gesture is detected (degrees, CW positive) */
  onRotate?: (rotation: number) => void;
  /**
   * Fallback for gestures without a dedicated callback. Its `type` is the
   * DECLARED spec gesture, never the recognizer's own name for the same move.
   */
  onGesture?: (context: { type: string; direction?: string; scale?: number; rotation?: number }) => void;
}

/**
 * `SPEC_GESTURE_TYPES` (the retired `ui/touch` vocabulary, owned by
 * `@object-ui/types` since objectstack#4988) → the recognizer
 * {@link GestureType} `useGesture` implements. Note the two sides are
 * different vocabularies, which is why this map exists at all: the retired
 * spec's `drag` and `pan` are one recognizer
 * (any-direction move past the threshold); `swipe` declares a SET of
 * directions, so it recognizes on that same any-direction move and fires only
 * when the DETECTED direction is a member of the declared set — no single
 * recognizer name carries that, which is why its entry below is a placeholder.
 * Exported for the spec-parity test.
 *
 * Before #2942 the hook never read `config.type` at all — it branched on
 * which SUB-OBJECT was present (`swipe` / `pinch` / `longPress`), so
 * `pan` / `drag` / `rotate` / `double_tap` (types with no sub-object) all
 * fell through to the `'tap'` initializer and fired on a tap.
 */
export const SPEC_GESTURE_TYPE_MAP: Record<string, GestureType> = {
  swipe: 'swipe-left', // placeholder; the hook recognizes any direction and filters by the declared set
  pinch: 'pinch',
  long_press: 'long-press',
  double_tap: 'double-tap',
  drag: 'pan',
  pan: 'pan',
  rotate: 'rotate',
};

/**
 * Spec-aware gesture hook that maps a {@link SpecGestureConfig} — the retired
 * `@objectstack/spec` `ui/touch` tuning shape, a different contract from the
 * direction-fused {@link GestureType} vocabulary `useGesture` speaks — onto
 * the existing useGesture hook.
 *
 * @example
 * ```tsx
 * const ref = useSpecGesture({
 *   config: { type: 'swipe', enabled: true, swipe: { direction: ['left'], threshold: 80 } },
 *   onSwipe: (dir) => console.log('Swiped', dir),
 * });
 * return <div ref={ref}>Swipe me</div>;
 * ```
 */
export function useSpecGesture<T extends HTMLElement = HTMLElement>(
  options: UseSpecGestureOptions,
) {
  const { config, onSwipe, onPinch, onLongPress, onDoubleTap, onPan, onRotate, onGesture: onAny } = options;
  const enabled = config.enabled ?? true;

  // The DECLARED type drives recognition (#2942) — `config.type` is required
  // by the spec's `GestureConfigSchema`. The sub-object presence checks below
  // only back-fill legacy configs that predate the type field.
  const declared: string | undefined =
    typeof (config as { type?: unknown }).type === 'string'
      ? ((config as { type?: string }).type as string)
      : config.swipe
        ? 'swipe'
        : config.longPress
          ? 'long_press'
          : config.pinch
            ? 'pinch'
            : undefined;

  let gestureType: GestureType = 'tap';
  let threshold: number | undefined;
  let longPressDuration: number | undefined;
  let onGesture: (ctx: { direction?: string; scale?: number; rotation?: number }) => void = () => {};
  // `type` goes LAST in every payload below. The recognizer's own `type`
  // travels inside `ctx` at runtime (`GestureContext.type`), so a `type`
  // written BEFORE the spread is overwritten by it and the callback reports the
  // recognizer instead of the declared spec gesture (objectui#9691). The two
  // are different vocabularies — see `SPEC_GESTURE_TYPE_MAP` — so they agree
  // only by coincidence, arm by arm.
  const fallback = (ctx: { type: string; direction?: string; scale?: number; rotation?: number }) => onAny?.(ctx);

  switch (declared) {
    case 'swipe': {
      // `SwipeGestureConfig.direction` is declared as a SET
      // (`SpecSwipeDirection[]`), so recognition is the any-direction move past
      // the threshold and the swipe fires only when the DETECTED direction is a
      // MEMBER of that set. `direction[0]` would honour one element of a declared
      // many; a scalar `direction` is rejected by the declared type and nothing
      // re-admits it here (AGENTS.md #0.1). An empty or absent set declares no
      // direction, so it fires for none.
      const declaredDirections: readonly string[] = config.swipe?.direction ?? [];
      gestureType = 'pan';
      threshold = config.swipe?.threshold;
      onGesture = (ctx) => {
        const detected = ctx.direction;
        if (detected === undefined || !declaredDirections.includes(detected)) return;
        if (onSwipe) onSwipe(detected);
        else fallback({ ...ctx, type: 'swipe' });
      };
      break;
    }
    case 'long_press':
      gestureType = 'long-press';
      longPressDuration = config.longPress?.duration;
      onGesture = () => (onLongPress ? onLongPress() : fallback({ type: 'long_press' }));
      break;
    case 'pinch':
      gestureType = 'pinch';
      onGesture = (ctx) => (onPinch ? onPinch(ctx.scale ?? 1) : fallback({ ...ctx, type: 'pinch' }));
      break;
    case 'double_tap':
      gestureType = 'double-tap';
      onGesture = () => (onDoubleTap ? onDoubleTap() : fallback({ type: 'double_tap' }));
      break;
    case 'pan':
    case 'drag':
      gestureType = 'pan';
      onGesture = (ctx) => (onPan ? onPan(ctx.direction ?? 'left') : fallback({ ...ctx, type: declared }));
      break;
    case 'rotate':
      gestureType = 'rotate';
      onGesture = (ctx) => (onRotate ? onRotate(ctx.rotation ?? 0) : fallback({ ...ctx, type: 'rotate' }));
      break;
    default:
      break;
  }

  return useGesture<T>({
    type: gestureType,
    onGesture,
    threshold,
    longPressDuration,
    enabled,
  });
}

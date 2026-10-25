/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { GestureType, GestureContext } from '@object-ui/types';

export interface UseGestureOptions {
  /** Gesture type to detect */
  type: GestureType;
  /** Callback when gesture is detected */
  onGesture: (context: GestureContext) => void;
  /** Minimum distance for swipe detection (pixels) */
  threshold?: number;
  /** Duration for long-press detection (milliseconds) */
  longPressDuration?: number;
  /** Whether gesture detection is enabled */
  enabled?: boolean;
}

/**
 * Hook for detecting touch gestures on an element.
 * Returns a ref to attach to the target element.
 * 
 * @example
 * ```tsx
 * const gestureRef = useGesture({
 *   type: 'swipe-left',
 *   onGesture: (ctx) => console.log('Swiped left!', ctx),
 * });
 * return <div ref={gestureRef}>Swipe me</div>;
 * ```
 */
export function useGesture<T extends HTMLElement = HTMLElement>(
  options: UseGestureOptions,
) {
  const ref = useRef<T>(null);
  const startRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Real double-tap needs the PREVIOUS tap's timestamp — the old
  // implementation fired on every single qualifying tap (#2942).
  const lastTapRef = useRef<number>(0);
  // Two-touch tracking for pinch/rotate: initial + latest distance/angle
  // between the two touch points.
  const twoTouchRef = useRef<{ d0: number; a0: number; d1: number; a1: number } | null>(null);

  const { type, onGesture, threshold = 50, longPressDuration = 500, enabled = true } = options;

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      startRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

      // Pinch/rotate baseline — distance and angle between the two touches.
      if ((type === 'pinch' || type === 'rotate') && e.touches.length >= 2) {
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dx2 = t2.clientX - t1.clientX;
        const dy2 = t2.clientY - t1.clientY;
        const d = Math.hypot(dx2, dy2);
        const a = (Math.atan2(dy2, dx2) * 180) / Math.PI;
        twoTouchRef.current = { d0: d, a0: a, d1: d, a1: a };
      }

      if (type === 'long-press') {
        longPressTimerRef.current = setTimeout(() => {
          if (startRef.current) {
            onGesture({
              type: 'long-press',
              startPosition: { x: startRef.current.x, y: startRef.current.y },
              endPosition: { x: startRef.current.x, y: startRef.current.y },
              distance: 0,
              duration: longPressDuration,
              velocity: 0,
            });
          }
        }, longPressDuration);
      }
    },
    [type, onGesture, longPressDuration, enabled],
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!enabled || !startRef.current) return;
      clearTimeout(longPressTimerRef.current);

      const touch = e.changedTouches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = Date.now() - startRef.current.time;
      const velocity = distance / Math.max(duration, 1);

      const context: GestureContext = {
        type,
        startPosition: { x: startRef.current.x, y: startRef.current.y },
        endPosition: { x: touch.clientX, y: touch.clientY },
        distance,
        duration,
        velocity,
      };

      // Pinch / rotate resolve from the two-touch delta, not the single-touch
      // path below. Fired once on release, like the other discrete gestures.
      if (type === 'pinch' || type === 'rotate') {
        const t2 = twoTouchRef.current;
        twoTouchRef.current = null;
        startRef.current = null;
        if (!t2 || t2.d0 <= 0) return;
        const scale = t2.d1 / t2.d0;
        // Normalize the angle delta into (-180, 180].
        let rotation = t2.a1 - t2.a0;
        if (rotation > 180) rotation -= 360;
        if (rotation <= -180) rotation += 360;
        if (type === 'pinch' && Math.abs(scale - 1) >= 0.1) {
          onGesture({ ...context, scale });
        } else if (type === 'rotate' && Math.abs(rotation) >= 15) {
          onGesture({ ...context, rotation });
        }
        return;
      }

      // Detect gesture type
      if (type === 'tap' && distance < 10 && duration < 300) {
        onGesture(context);
      } else if (type === 'double-tap') {
        // Two qualifying taps within 350ms — a single tap must NOT fire
        // (it used to, collapsing double-tap into tap, #2942).
        if (distance < 10 && duration < 300) {
          const now = Date.now();
          if (now - lastTapRef.current <= 350) {
            lastTapRef.current = 0;
            onGesture(context);
          } else {
            lastTapRef.current = now;
          }
        }
      } else if (distance >= threshold) {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        let direction: GestureContext['direction'];

        if (absX > absY) {
          direction = dx > 0 ? 'right' : 'left';
        } else {
          direction = dy > 0 ? 'down' : 'up';
        }

        context.direction = direction;

        if (
          (type === 'swipe-left' && direction === 'left') ||
          (type === 'swipe-right' && direction === 'right') ||
          (type === 'swipe-up' && direction === 'up') ||
          (type === 'swipe-down' && direction === 'down') ||
          type === 'pan'
        ) {
          onGesture(context);
        }
      }

      startRef.current = null;
    },
    [type, onGesture, threshold, enabled],
  );

  const handleTouchMove = useCallback((e: TouchEvent) => {
    // Cancel long-press if finger moves
    if (type === 'long-press') {
      clearTimeout(longPressTimerRef.current);
    }
    // Track the latest two-touch distance/angle for pinch/rotate.
    if ((type === 'pinch' || type === 'rotate') && twoTouchRef.current && e.touches.length >= 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dx2 = t2.clientX - t1.clientX;
      const dy2 = t2.clientY - t1.clientY;
      twoTouchRef.current.d1 = Math.hypot(dx2, dy2);
      twoTouchRef.current.a1 = (Math.atan2(dy2, dx2) * 180) / Math.PI;
    }
  }, [type]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchmove', handleTouchMove);
      clearTimeout(longPressTimerRef.current);
    };
  }, [handleTouchStart, handleTouchEnd, handleTouchMove, enabled]);

  return ref;
}

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface PullToRefreshOptions {
  /** Callback when pull-to-refresh is triggered */
  onRefresh: () => Promise<void>;
  /** Minimum pull distance to trigger refresh (pixels) */
  threshold?: number;
  /** Whether pull-to-refresh is enabled */
  enabled?: boolean;
}

/**
 * Hook for implementing pull-to-refresh behavior.
 * Returns a ref to attach to the scrollable container.
 */
export function usePullToRefresh<T extends HTMLElement = HTMLElement>(
  options: PullToRefreshOptions,
) {
  const { onRefresh, threshold = 80, enabled = true } = options;
  const ref = useRef<T>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startYRef = useRef(0);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled || isRefreshing) return;
      const el = ref.current;
      if (el && el.scrollTop === 0) {
        startYRef.current = e.touches[0].clientY;
      }
    },
    [enabled, isRefreshing],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!enabled || isRefreshing || !startYRef.current) return;
      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;
      if (diff > 0) {
        setPullDistance(Math.min(diff, threshold * 1.5));
      }
    },
    [enabled, isRefreshing, threshold],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!enabled || isRefreshing) return;
    // Capture distance and reset UI immediately to prevent lock during async refresh
    const distance = pullDistance;
    setPullDistance(0);
    startYRef.current = 0;
    if (distance >= threshold) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
  }, [enabled, isRefreshing, pullDistance, threshold, onRefresh]);

  /**
   * The listeners follow the ELEMENT, not the mount (objectui#10105).
   *
   * `ref` is an object ref, so nothing tells this hook when a consumer
   * attaches it. The binding used to live in an effect keyed on the handlers
   * and `enabled`, which read `ref.current` once and then waited for one of
   * those to change. A consumer whose first commit is a loading screen has
   * `ref.current === null` at that moment. When the real host appears later,
   * none of those keys has changed, so the effect never ran again and the
   * gesture was dead. The consumers that do this, and the ones that do not,
   * were measured on objectui#10105; the list is not repeated here because it
   * would go stale. The same happened when a refresh put the loading screen
   * back and the host came back as a NEW element: the listeners stayed on the
   * old, detached one.
   *
   * So the binding effect below has no dependency list and runs after every
   * commit. It re-binds only when the element it SHOULD be bound to
   * (`ref.current`, or `null` while disabled) differs from the one it IS bound
   * to. That is a DOM-identity comparison, never a comparison of memoised
   * identities (AGENTS.md §5 #10). The native listeners stay the same for the
   * life of a binding and call the latest handlers through `handlersRef`, so a
   * state change such as each `pullDistance` step during a gesture no longer
   * re-binds anything.
   */
  const handlersRef = useRef<PullHandlers>({ handleTouchStart, handleTouchMove, handleTouchEnd });
  useEffect(() => {
    handlersRef.current = { handleTouchStart, handleTouchMove, handleTouchEnd };
  });

  const bindingRef = useRef<PullBinding | null>(null);
  useEffect(() => {
    const target = enabled ? ref.current : null;
    const bound = bindingRef.current;
    if ((bound ? bound.el : null) === target) return;
    if (bound) unbindPullListeners(bound);
    bindingRef.current = target ? bindPullListeners(target, handlersRef) : null;
  });

  // Unmount. The per-commit effect above returns no cleanup on purpose, since
  // a cleanup there would re-bind on every commit. This is where the last
  // binding is released. It releases the exact listeners that were added,
  // which are recorded on the binding, so nothing depends on an identity
  // staying stable.
  useEffect(
    () => () => {
      const bound = bindingRef.current;
      if (bound) unbindPullListeners(bound);
      bindingRef.current = null;
    },
    [],
  );

  return { ref, isRefreshing, pullDistance };
}

interface PullHandlers {
  handleTouchStart: (e: TouchEvent) => void;
  handleTouchMove: (e: TouchEvent) => void;
  handleTouchEnd: () => Promise<void>;
}

/** The element the listeners are bound to, and the exact listeners bound to it. */
interface PullBinding {
  el: HTMLElement;
  start: (e: TouchEvent) => void;
  move: (e: TouchEvent) => void;
  end: () => void;
}

/**
 * One gesture, one owner: the OUTERMOST armed pull host (objectui#10105).
 *
 * Pull hosts nest. `ListView` has one, and so does the view it renders inside
 * it. A touch on the inner host bubbles to the outer one, so without a rule
 * both hooks drew an indicator and both ran their refresh for the same pull.
 * The outer one is the owner: its single refetch reloads the rows the inner
 * view was handed, and an inner view fed its rows by a parent has no refresh of
 * its own to run.
 *
 * While bound, the hook marks its element with this attribute. It is a DOM
 * attribute and not module state so that two copies of this package in one
 * page still see each other. At `touchstart` an inner host looks for a marked
 * ANCESTOR, and if one is armed it lets the gesture go: it never records a
 * start point, so its move and end handlers do nothing for this gesture. The
 * native listeners and the DOM ancestry are the same relation (the outer
 * listener receives this event because it is an ancestor), which is why the
 * check reads the DOM and not the React tree.
 */
const PULL_HOST_ATTRIBUTE = 'data-pull-to-refresh-host';

function armedPullHostAbove(el: HTMLElement): boolean {
  const parent = el.parentElement;
  return parent !== null && parent.closest(`[${PULL_HOST_ATTRIBUTE}]`) !== null;
}

function bindPullListeners(el: HTMLElement, handlers: { current: PullHandlers }): PullBinding {
  const binding: PullBinding = {
    el,
    start: (e) => {
      if (armedPullHostAbove(el)) return;
      handlers.current.handleTouchStart(e);
    },
    move: (e) => handlers.current.handleTouchMove(e),
    end: () => {
      void handlers.current.handleTouchEnd();
    },
  };
  el.setAttribute(PULL_HOST_ATTRIBUTE, '');
  el.addEventListener('touchstart', binding.start, { passive: true });
  el.addEventListener('touchmove', binding.move, { passive: true });
  el.addEventListener('touchend', binding.end, { passive: true });
  return binding;
}

function unbindPullListeners(binding: PullBinding): void {
  binding.el.removeAttribute(PULL_HOST_ATTRIBUTE);
  binding.el.removeEventListener('touchstart', binding.start);
  binding.el.removeEventListener('touchmove', binding.move);
  binding.el.removeEventListener('touchend', binding.end);
}

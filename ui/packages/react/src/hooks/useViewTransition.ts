/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useMemo } from 'react';
import { useReducedMotion } from './useReducedMotion.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewTransitionConfig {
  /** Enable view transitions (default: true) */
  enabled?: boolean;
  /** Fallback animation class when View Transitions API is unsupported */
  fallbackClass?: string;
  /** Transition duration in ms (default: 300) */
  duration?: number;
  /** Called before transition starts */
  onTransitionStart?: () => void;
  /** Called after transition completes */
  onTransitionEnd?: () => void;
}

export interface ViewTransitionResult {
  /** Whether the View Transitions API is supported */
  isSupported: boolean;
  /** Whether a transition is currently in progress */
  isTransitioning: boolean;
  /** Execute a callback with a view transition */
  startTransition: (callback: () => void | Promise<void>) => Promise<void>;
  /** CSS class to apply during transitions */
  transitionClass: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_DURATION = 300;
const DEFAULT_FALLBACK_CLASS = 'oui-view-transition-fallback';

/** Minimal type for the native ViewTransition object returned by the API. */
interface ViewTransition {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
}

function supportsViewTransitions(): boolean {
  return (
    typeof document !== 'undefined' &&
    'startViewTransition' in document
  );
}

// ---------------------------------------------------------------------------
// useViewTransition hook
// ---------------------------------------------------------------------------

/**
 * Hook for integrating with the browser View Transitions API.
 *
 * Uses the native `document.startViewTransition()` when available and
 * falls back to a temporary CSS class for animation when unsupported.
 * Respects `prefers-reduced-motion`.
 *
 * @example
 * ```tsx
 * function ViewSwitcher({ onViewChange }: { onViewChange: (v: string) => void }) {
 *   const { startTransition, transitionClass, isTransitioning } = useViewTransition();
 *
 *   const handleChange = (view: string) => {
 *     startTransition(() => onViewChange(view));
 *   };
 *
 *   return (
 *     <div className={transitionClass}>
 *       ...
 *     </div>
 *   );
 * }
 * ```
 */
export function useViewTransition(
  config: ViewTransitionConfig = {},
): ViewTransitionResult {
  const {
    enabled = true,
    fallbackClass = DEFAULT_FALLBACK_CLASS,
    duration = DEFAULT_DURATION,
    onTransitionStart,
    onTransitionEnd,
  } = config;

  const reducedMotion = useReducedMotion();
  const [isTransitioning, setIsTransitioning] = useState(false);

  const isSupported = useMemo(() => supportsViewTransitions(), []);

  const startTransition = useCallback(
    async (callback: () => void | Promise<void>): Promise<void> => {
      // Skip transition when disabled or user prefers reduced motion
      if (!enabled || reducedMotion) {
        await callback();
        return;
      }

      onTransitionStart?.();
      setIsTransitioning(true);

      try {
        if (isSupported) {
          // Use native View Transitions API
          const transition = (document as Document & {
            startViewTransition: (cb: () => void | Promise<void>) => ViewTransition;
          }).startViewTransition(callback);
          await transition.finished;
        } else {
          // Fallback: apply class, run callback, remove class after duration
          await callback();
          await new Promise<void>((resolve) => setTimeout(resolve, duration));
        }
      } finally {
        setIsTransitioning(false);
        onTransitionEnd?.();
      }
    },
    [enabled, reducedMotion, isSupported, duration, onTransitionStart, onTransitionEnd],
  );

  const transitionClass = isTransitioning && !isSupported ? fallbackClass : '';

  return {
    isSupported,
    isTransitioning,
    startTransition,
    transitionClass,
  };
}

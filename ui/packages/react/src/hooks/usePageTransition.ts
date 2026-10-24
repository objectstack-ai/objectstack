/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import { useReducedMotion } from './useReducedMotion.js';

// ---------------------------------------------------------------------------
// Types aligned with @objectstack/spec v2.0.7 PageTransitionSchema
// ---------------------------------------------------------------------------

/** Page transition type. */
export type PageTransitionType =
  | 'none'
  | 'fade'
  | 'slide_up'
  | 'slide_down'
  | 'slide_left'
  | 'slide_right'
  | 'scale'
  | 'rotate'
  | 'flip';

/** Easing function for page transitions. */
export type PageTransitionEasing =
  | 'linear'
  | 'ease'
  | 'ease_in'
  | 'ease_out'
  | 'ease_in_out'
  | 'spring';

/** Page transition configuration aligned with PageTransitionSchema. */
export interface PageTransitionConfig {
  /** Transition type. */
  type?: PageTransitionType;
  /** Duration in milliseconds. */
  duration?: number;
  /** Easing function. */
  easing?: PageTransitionEasing;
  /** Whether entering and exiting pages cross-fade. */
  crossFade?: boolean;
}

/** Resolved CSS classes and styles for a page transition. */
export interface PageTransitionResult {
  /** Tailwind CSS classes for the enter transition. */
  enterClassName: string;
  /** Tailwind CSS classes for the exit transition. */
  exitClassName: string;
  /** Inline styles for the enter transition. */
  enterStyle: React.CSSProperties;
  /** Inline styles for the exit transition. */
  exitStyle: React.CSSProperties;
  /** Whether the transition is active (not 'none' and motion not reduced). */
  isActive: boolean;
  /** The resolved transition type. */
  type: PageTransitionType;
  /** The resolved duration in ms. */
  duration: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EASING_CSS: Record<PageTransitionEasing, string> = {
  linear: 'linear',
  ease: 'ease',
  ease_in: 'ease-in',
  ease_out: 'ease-out',
  ease_in_out: 'ease-in-out',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

const ENTER_CLASSES: Record<PageTransitionType, string> = {
  none: '',
  fade: 'animate-in fade-in',
  slide_up: 'animate-in slide-in-from-bottom-4',
  slide_down: 'animate-in slide-in-from-top-4',
  slide_left: 'animate-in slide-in-from-right-4',
  slide_right: 'animate-in slide-in-from-left-4',
  scale: 'animate-in zoom-in-95',
  rotate: 'animate-in spin-in-90',
  flip: 'animate-in fade-in zoom-in-95',
};

const EXIT_CLASSES: Record<PageTransitionType, string> = {
  none: '',
  fade: 'animate-out fade-out',
  slide_up: 'animate-out slide-out-to-top-4',
  slide_down: 'animate-out slide-out-to-bottom-4',
  slide_left: 'animate-out slide-out-to-left-4',
  slide_right: 'animate-out slide-out-to-right-4',
  scale: 'animate-out zoom-out-95',
  rotate: 'animate-out spin-out-90',
  flip: 'animate-out fade-out zoom-out-95',
};

const DEFAULT_DURATION = 300;
const DEFAULT_EASING: PageTransitionEasing = 'ease_in_out';

// ---------------------------------------------------------------------------
// usePageTransition hook
// ---------------------------------------------------------------------------

/**
 * Hook for page-level transition animations aligned with
 * PageTransitionSchema from @objectstack/spec v2.0.7.
 *
 * Generates Tailwind CSS animate-in / animate-out classes and inline styles
 * for enter/exit page transitions. Respects `prefers-reduced-motion`.
 *
 * @example
 * ```tsx
 * function PageWrapper({ children }: { children: React.ReactNode }) {
 *   const transition = usePageTransition({ type: 'fade', duration: 200 });
 *
 *   return (
 *     <div className={transition.enterClassName} style={transition.enterStyle}>
 *       {children}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePageTransition(config: PageTransitionConfig = {}): PageTransitionResult {
  const {
    type = 'none',
    duration = DEFAULT_DURATION,
    easing = DEFAULT_EASING,
    crossFade = false,
  } = config;

  const reducedMotion = useReducedMotion();

  return useMemo(() => {
    const isActive = type !== 'none' && !reducedMotion;

    if (!isActive) {
      return {
        enterClassName: '',
        exitClassName: '',
        enterStyle: {},
        exitStyle: {},
        isActive: false,
        type,
        duration,
      };
    }

    const enterClassName = ENTER_CLASSES[type] || '';
    const exitClassName = EXIT_CLASSES[type] || '';

    const baseStyle: React.CSSProperties = {
      animationDuration: `${duration}ms`,
      animationTimingFunction: EASING_CSS[easing] || EASING_CSS.ease_in_out,
      animationFillMode: 'both',
    };

    const enterStyle: React.CSSProperties = { ...baseStyle };
    const exitStyle: React.CSSProperties = { ...baseStyle };

    // When crossFade is enabled, both the entering and exiting pages
    // should overlap and transition opacity simultaneously.
    if (crossFade) {
      enterStyle.position = 'absolute';
      enterStyle.inset = '0';
      exitStyle.position = 'absolute';
      exitStyle.inset = '0';
    }

    return {
      enterClassName,
      exitClassName,
      enterStyle,
      exitStyle,
      isActive: true,
      type,
      duration,
    };
  }, [type, duration, easing, crossFade, reducedMotion]);
}

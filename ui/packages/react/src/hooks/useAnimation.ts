/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';

/** Animation trigger type */
export type AnimationTriggerType = 'enter' | 'exit' | 'hover' | 'focus' | 'click';

/**
 * Easing presets aligned with the spec `EasingFunctionSchema`
 * (`ui/animation.zod.ts` — underscore spellings). The hyphen spellings are
 * this hook's historical dialect, still accepted at runtime (normalized
 * before lookup) so existing configs keep animating.
 */
export type EasingPreset =
  | 'linear'
  | 'ease'
  | 'ease_in'
  | 'ease_out'
  | 'ease_in_out'
  | 'spring'
  /** @deprecated legacy spelling — use `ease_in` */
  | 'ease-in'
  /** @deprecated legacy spelling — use `ease_out` */
  | 'ease-out'
  /** @deprecated legacy spelling — use `ease_in_out` */
  | 'ease-in-out';

/**
 * Transition presets aligned with the spec `TransitionPresetSchema`
 * (`ui/animation.zod.ts` — underscore spellings, including `rotate` and
 * `flip`). The hyphen spellings and `scale-fade` are this hook's historical
 * dialect, still accepted at runtime so existing configs keep animating —
 * but the spec's own spellings used to look up NOTHING here (#2942): the
 * map was keyed in hyphens, so `preset: 'slide_up'` validated and rendered
 * no animation at all.
 */
export type TransitionPresetType =
  | 'fade'
  | 'slide_up'
  | 'slide_down'
  | 'slide_left'
  | 'slide_right'
  | 'scale'
  | 'rotate'
  | 'flip'
  | 'none'
  /** @deprecated legacy spelling — use `slide_up` */
  | 'slide-up'
  /** @deprecated legacy spelling — use `slide_down` */
  | 'slide-down'
  /** @deprecated legacy spelling — use `slide_left` */
  | 'slide-left'
  /** @deprecated legacy spelling — use `slide_right` */
  | 'slide-right'
  /** @deprecated legacy dialect (never in the spec) — use `flip` */
  | 'scale-fade';

export interface AnimationConfig {
  /** The animation/transition preset */
  preset?: TransitionPresetType;
  /** Duration in milliseconds */
  duration?: number;
  /** Delay in milliseconds */
  delay?: number;
  /** Easing function */
  easing?: EasingPreset;
  /** Whether animation is enabled */
  enabled?: boolean;
}

/** Resolved CSS classes and styles for animation */
export interface AnimationResult {
  /** Tailwind CSS classes for the animation */
  className: string;
  /** Inline style for custom durations/delays (only when needed) */
  style: React.CSSProperties;
}

/**
 * The spec vocabularies this hook implements — exported for the parity tests,
 * which fail the moment `TransitionPresetSchema` / `EasingFunctionSchema` and
 * these sets drift in either direction (#2942).
 */
export const SUPPORTED_TRANSITION_PRESETS: ReadonlySet<string> = new Set([
  'fade', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'scale', 'rotate', 'flip', 'none',
]);
export const SUPPORTED_EASING_FUNCTIONS: ReadonlySet<string> = new Set([
  'linear', 'ease', 'ease_in', 'ease_out', 'ease_in_out', 'spring',
]);

/**
 * Normalize a legacy hyphen spelling (this hook's pre-#2942 dialect) onto the
 * spec's underscore vocabulary. `scale-fade` never existed in the spec; its
 * classes were identical to `flip`'s, so it maps there.
 */
function normalizePreset(preset: string): string {
  if (preset === 'scale-fade') return 'flip';
  return preset.replace(/-/g, '_');
}

// Keyed by the SPEC spellings (`ui/animation.zod.ts`). Class values for the
// shared presets are unchanged; `rotate`/`flip` follow `usePageTransition`'s
// enter classes (spin-in / fade+zoom), the sibling hook that always carried
// the full spec vocabulary.
const EASING_MAP: Record<string, string> = {
  linear: 'linear',
  ease: 'ease',
  ease_in: 'ease-in',
  ease_out: 'ease-out',
  ease_in_out: 'ease-in-out',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

const PRESET_CLASSES: Record<string, string> = {
  fade: 'animate-in fade-in',
  slide_up: 'animate-in slide-in-from-bottom-2',
  slide_down: 'animate-in slide-in-from-top-2',
  slide_left: 'animate-in slide-in-from-right-2',
  slide_right: 'animate-in slide-in-from-left-2',
  scale: 'animate-in zoom-in-95',
  rotate: 'animate-in spin-in-90',
  flip: 'animate-in fade-in zoom-in-95',
  none: '',
};

/**
 * Hook for applying spec-driven animations to components.
 * Implements ComponentAnimationSchema and TransitionPresetSchema
 * from @objectstack/spec v2.0.7.
 *
 * @example
 * ```tsx
 * function Card() {
 *   const animation = useAnimation({ preset: 'fade', duration: 200, easing: 'ease-out' });
 *   return <div className={animation.className} style={animation.style}>...</div>;
 * }
 * ```
 */
export function useAnimation(config: AnimationConfig = {}): AnimationResult {
  const {
    preset = 'none',
    duration,
    delay,
    easing = 'ease-out',
    enabled = true,
  } = config;

  return useMemo(() => {
    if (!enabled || preset === 'none') {
      return { className: '', style: {} };
    }

    const className = PRESET_CLASSES[normalizePreset(preset)] || '';
    const style: React.CSSProperties = {};

    if (duration !== undefined) {
      style.animationDuration = `${duration}ms`;
    }
    if (delay !== undefined) {
      style.animationDelay = `${delay}ms`;
    }
    if (easing) {
      // Spec spellings (and legacy hyphen ones) resolve through the map; an
      // out-of-vocabulary string only passes through when it is plausible raw
      // CSS (`cubic-bezier(…)`, `steps(…)`) — `ease_in_out` reaching the DOM
      // verbatim was an invalid declaration the browser silently dropped.
      style.animationTimingFunction =
        EASING_MAP[normalizePreset(easing)] ?? (easing.includes('(') ? easing : undefined);
    }

    return { className, style };
  }, [preset, duration, delay, easing, enabled]);
}

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

/** Density mode aligned with DensityMode from @objectstack/spec v2.0.7 */
export type DensityModeValue = 'compact' | 'comfortable' | 'spacious';

export interface DensityConfig {
  /** Row height in pixels for each density mode */
  rowHeights?: Record<DensityModeValue, number>;
  /** Padding classes for each density mode */
  paddingClasses?: Record<DensityModeValue, string>;
  /** Font size classes for each density mode */
  fontSizeClasses?: Record<DensityModeValue, string>;
  /**
   * Optional callback fired whenever the active density mode changes.
   * Typical use: persist the new value on the active view definition.
   * The callback is *not* invoked for the initial mount; only on user-driven
   * transitions (setMode / cycle) and when the controlled `initialMode`
   * changes from upstream.
   */
  onChange?: (mode: DensityModeValue) => void;
}

export interface DensityResult {
  /** Current density mode */
  mode: DensityModeValue;
  /** Set the density mode */
  setMode: (mode: DensityModeValue) => void;
  /** Cycle through density modes */
  cycle: () => void;
  /** Row height for the current mode (in pixels) */
  rowHeight: number;
  /** Tailwind padding class for the current mode */
  paddingClass: string;
  /** Tailwind font-size class for the current mode */
  fontSizeClass: string;
}

const DEFAULT_ROW_HEIGHTS: Record<DensityModeValue, number> = {
  compact: 32,
  comfortable: 40,
  spacious: 52,
};

const DEFAULT_PADDING_CLASSES: Record<DensityModeValue, string> = {
  compact: 'py-1 px-2',
  comfortable: 'py-2 px-3',
  spacious: 'py-3 px-4',
};

const DEFAULT_FONT_SIZE_CLASSES: Record<DensityModeValue, string> = {
  compact: 'text-xs',
  comfortable: 'text-sm',
  spacious: 'text-base',
};

const DENSITY_ORDER: DensityModeValue[] = ['compact', 'comfortable', 'spacious'];

/**
 * Hook for managing view density modes (compact/comfortable/spacious).
 * Implements DensityMode from @objectstack/spec v2.0.7.
 *
 * Behaviour:
 * - `initialMode` acts as a controlled-ish source of truth: when it changes
 *   externally (e.g. user switches to a different saved view) the internal
 *   mode follows.
 * - User-driven transitions (`setMode` / `cycle`) emit `config.onChange`,
 *   so callers can persist the choice.
 *
 * @example
 * ```tsx
 * import { DENSITY_MODE_TO_ROW_HEIGHT, rowHeightToDensityMode } from '@object-ui/core';
 *
 * // A view stores the protocol's `rowHeight`; the legacy `densityMode` key is
 * // retired on `NamedListView` (objectui#7924), so persist the spec value —
 * // here into the host's own per-user store (`saveUserRowHeight` is the
 * // host's; the console keeps the choice on the user's own list state).
 * const density = useDensityMode(rowHeightToDensityMode(activeView?.rowHeight) ?? 'comfortable', {
 *   onChange: (m) => saveUserRowHeight(vid, DENSITY_MODE_TO_ROW_HEIGHT[m]),
 * });
 * ```
 */
export function useDensityMode(
  initialMode: DensityModeValue = 'comfortable',
  config?: DensityConfig
): DensityResult {
  const [mode, setModeState] = useState<DensityModeValue>(initialMode);

  const rowHeights = config?.rowHeights ?? DEFAULT_ROW_HEIGHTS;
  const paddingClasses = config?.paddingClasses ?? DEFAULT_PADDING_CLASSES;
  const fontSizeClasses = config?.fontSizeClasses ?? DEFAULT_FONT_SIZE_CLASSES;

  // Keep latest onChange in a ref so we don't need to re-create callbacks
  // when the parent re-renders with a new function identity.
  const onChangeRef = useRef(config?.onChange);
  useEffect(() => {
    onChangeRef.current = config?.onChange;
  }, [config?.onChange]);

  // Track the upstream initialMode so we can detect external changes
  // (e.g. switching views) without firing onChange for those.
  const lastInitialRef = useRef(initialMode);
  useEffect(() => {
    if (initialMode !== lastInitialRef.current) {
      lastInitialRef.current = initialMode;
      setModeState(initialMode);
    }
  }, [initialMode]);

  const setMode = useCallback((next: DensityModeValue) => {
    setModeState((current) => {
      if (current === next) return current;
      // Fire onChange asynchronously so React state has settled.
      queueMicrotask(() => onChangeRef.current?.(next));
      return next;
    });
  }, []);

  const cycle = useCallback(() => {
    setModeState((current) => {
      const idx = DENSITY_ORDER.indexOf(current);
      const next = DENSITY_ORDER[(idx + 1) % DENSITY_ORDER.length];
      queueMicrotask(() => onChangeRef.current?.(next));
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      mode,
      setMode,
      cycle,
      rowHeight: rowHeights[mode],
      paddingClass: paddingClasses[mode],
      fontSizeClass: fontSizeClasses[mode],
    }),
    [mode, setMode, cycle, rowHeights, paddingClasses, fontSizeClasses]
  );
}

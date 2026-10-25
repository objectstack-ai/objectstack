/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { BreakpointName, ResponsiveValue } from '@object-ui/types';

/** Default breakpoint widths (Tailwind CSS compatible) */
export const BREAKPOINTS: Record<BreakpointName, number> = {
  xs: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

/** Ordered breakpoint names from smallest to largest */
export const BREAKPOINT_ORDER: BreakpointName[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];

/**
 * Resolves a responsive value to the appropriate value for the current breakpoint.
 * Falls back to the next smaller breakpoint value if the current one is not defined.
 */
export function resolveResponsiveValue<T>(
  value: ResponsiveValue<T>,
  currentBreakpoint: BreakpointName,
): T | undefined {
  // If it's not an object, it's a direct value
  if (typeof value !== 'object' || value === null) {
    return value as T;
  }

  const responsive = value as Partial<Record<BreakpointName, T>>;
  const currentIndex = BREAKPOINT_ORDER.indexOf(currentBreakpoint);

  // Walk backwards from current breakpoint to find a defined value
  for (let i = currentIndex; i >= 0; i--) {
    const bp = BREAKPOINT_ORDER[i];
    if (bp in responsive) {
      return responsive[bp];
    }
  }

  return undefined;
}

/**
 * Gets the current breakpoint name based on window width.
 */
export function getCurrentBreakpoint(width: number): BreakpointName {
  for (let i = BREAKPOINT_ORDER.length - 1; i >= 0; i--) {
    const bp = BREAKPOINT_ORDER[i];
    if (width >= BREAKPOINTS[bp]) {
      return bp;
    }
  }
  return 'xs';
}

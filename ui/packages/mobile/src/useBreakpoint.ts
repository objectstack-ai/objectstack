/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useEffect } from 'react';
import type { BreakpointName } from '@object-ui/types';
import { BREAKPOINTS, BREAKPOINT_ORDER, getCurrentBreakpoint } from './breakpoints.js';

export interface BreakpointState {
  /** Current breakpoint name */
  breakpoint: BreakpointName;
  /** Current window width */
  width: number;
  /** Whether the screen is mobile sized (< md) */
  isMobile: boolean;
  /** Whether the screen is tablet sized (md-lg) */
  isTablet: boolean;
  /** Whether the screen is desktop sized (>= lg) */
  isDesktop: boolean;
  /** Check if current breakpoint is at or above the given breakpoint */
  isAbove: (bp: BreakpointName) => boolean;
  /** Check if current breakpoint is at or below the given breakpoint */
  isBelow: (bp: BreakpointName) => boolean;
}

/**
 * Hook that tracks the current responsive breakpoint.
 * Updates on window resize with debouncing.
 */
export function useBreakpoint(): BreakpointState {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setWidth(window.innerWidth);
      }, 100);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const breakpoint = getCurrentBreakpoint(width);
  const bpIndex = BREAKPOINT_ORDER.indexOf(breakpoint);

  return {
    breakpoint,
    width,
    isMobile: bpIndex < BREAKPOINT_ORDER.indexOf('md'),
    isTablet: bpIndex >= BREAKPOINT_ORDER.indexOf('md') && bpIndex < BREAKPOINT_ORDER.indexOf('lg'),
    isDesktop: bpIndex >= BREAKPOINT_ORDER.indexOf('lg'),
    isAbove: (bp: BreakpointName) => width >= BREAKPOINTS[bp],
    isBelow: (bp: BreakpointName) => width < BREAKPOINTS[bp],
  };
}

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import type { BreakpointName } from '@object-ui/types';
import { useBreakpoint } from './useBreakpoint.js';

export interface ResponsiveContainerProps {
  /** Minimum breakpoint to show content */
  minBreakpoint?: BreakpointName;
  /** Maximum breakpoint to show content */
  maxBreakpoint?: BreakpointName;
  /** Show only on specific breakpoints */
  showOn?: BreakpointName[];
  /** Hide on specific breakpoints */
  hideOn?: BreakpointName[];
  /** Fallback content when hidden */
  fallback?: React.ReactNode;
  /** Children */
  children: React.ReactNode;
}

/**
 * Container that conditionally renders children based on the current breakpoint.
 */
export function ResponsiveContainer({
  minBreakpoint,
  maxBreakpoint,
  showOn,
  hideOn,
  fallback = null,
  children,
}: ResponsiveContainerProps) {
  const { breakpoint, isAbove, isBelow } = useBreakpoint();

  // Check showOn/hideOn lists
  if (showOn && !showOn.includes(breakpoint)) {
    return <>{fallback}</>;
  }
  if (hideOn && hideOn.includes(breakpoint)) {
    return <>{fallback}</>;
  }

  // Check min/max breakpoints
  if (minBreakpoint && !isAbove(minBreakpoint)) {
    return <>{fallback}</>;
  }
  if (maxBreakpoint && !isBelow(maxBreakpoint)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

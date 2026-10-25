/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import type { ResponsiveValue } from '@object-ui/types';
import { useBreakpoint } from './useBreakpoint.js';
import { resolveResponsiveValue } from './breakpoints.js';

/**
 * Hook that resolves a responsive value based on the current breakpoint.
 * 
 * @example
 * ```tsx
 * const columns = useResponsive({ xs: 1, sm: 2, lg: 3 });
 * // columns = 1 on mobile, 2 on sm/md, 3 on lg+
 * ```
 */
export function useResponsive<T>(value: ResponsiveValue<T>): T | undefined {
  const { breakpoint } = useBreakpoint();

  return useMemo(
    () => resolveResponsiveValue(value, breakpoint),
    [value, breakpoint],
  );
}

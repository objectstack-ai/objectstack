/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { TouchTargetConfig } from '@object-ui/types';

export interface UseTouchTargetOptions {
  /** Spec touch target configuration */
  config?: TouchTargetConfig;
}

export interface TouchTargetResult {
  /** CSS style properties enforcing minimum touch target sizes */
  style: {
    minWidth: string;
    minHeight: string;
    padding: string | undefined;
  };
  /** CSS class for touch-action optimization */
  className: string;
}

/**
 * Hook that returns style and className props enforcing minimum
 * touch target sizes per the @objectstack/spec TouchTargetConfig.
 *
 * Defaults follow WCAG 2.5.5 (44×44 CSS pixels).
 *
 * @example
 * ```tsx
 * const target = useTouchTarget({ config: { minWidth: 48, minHeight: 48 } });
 * return <button style={target.style} className={target.className}>Tap</button>;
 * ```
 */
export function useTouchTarget(options: UseTouchTargetOptions = {}): TouchTargetResult {
  const { config } = options;
  const minWidth = config?.minWidth ?? 44;
  const minHeight = config?.minHeight ?? 44;
  const padding = config?.padding ?? 0;

  return {
    style: {
      minWidth: `${minWidth}px`,
      minHeight: `${minHeight}px`,
      padding: padding > 0 ? `${padding}px` : undefined,
    },
    className: 'touch-manipulation',
  };
}

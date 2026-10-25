/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { useAuth } from './useAuth.js';

export interface PreviewBannerProps {
  /** Custom class name for the banner */
  className?: string;
}

/**
 * Banner component that displays a message when the app is in preview mode.
 * Only renders when preview mode is active. Uses the bannerMessage from
 * preview mode config, or a default message if none is provided.
 *
 * @example
 * ```tsx
 * <PreviewBanner />
 * ```
 */
export function PreviewBanner({ className }: PreviewBannerProps) {
  const { isPreviewMode, previewMode } = useAuth();

  if (!isPreviewMode) {
    return null;
  }

  const message = previewMode?.bannerMessage ?? 'You are in preview mode.';

  return (
    <div
      role="status"
      className={className}
      style={{
        padding: '8px 16px',
        backgroundColor: '#fef3c7',
        color: '#92400e',
        textAlign: 'center',
        fontSize: '14px',
        borderBottom: '1px solid #fcd34d',
      }}
    >
      {message}
    </div>
  );
}

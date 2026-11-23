// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SidebarWidthHandle — the docked console sidebar's right edge, which resizes
 * it (objectstack#36227, as Attio): dragged with the pointer between
 * {@link CONSOLE_SIDEBAR_MIN_WIDTH} and {@link CONSOLE_SIDEBAR_MAX_WIDTH}, or
 * moved with ← → (Home / End to either end). A double-click comes back to
 * {@link CONSOLE_EXPANDED_SIDEBAR_WIDTH}. `onPreview` follows a drag;
 * `onCommit` keeps the width once it ends. The same shape as the record page's
 * details-column handle (`RecordPageColumns` in `@object-ui/plugin-detail`).
 */

import * as React from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  CONSOLE_EXPANDED_SIDEBAR_WIDTH,
  CONSOLE_SIDEBAR_MAX_WIDTH,
  CONSOLE_SIDEBAR_MIN_WIDTH,
  clampConsoleSidebarWidth,
} from './consoleSidebarRail.js';

/** How far one arrow-key press moves the sidebar's edge, in CSS pixels. */
export const SIDEBAR_WIDTH_KEY_STEP = 16;

export interface SidebarWidthHandleProps {
  /** The width the sidebar has now, a drag's included. */
  width: number;
  /** A drag in progress: its width, or `null` once it ends. */
  onPreview: (width: number | null) => void;
  /** Keep this width. */
  onCommit: (width: number) => void;
}

export function SidebarWidthHandle({ width, onPreview, onCommit }: SidebarWidthHandleProps) {
  const { t } = useObjectTranslation();
  const drag = React.useRef<{ x: number; width: number; last: number } | null>(null);

  const end = (commit: boolean) => {
    const start = drag.current;
    drag.current = null;
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    onPreview(null);
    if (commit && start && start.last !== start.width) onCommit(start.last);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resize', { defaultValue: 'Resize sidebar' })}
      aria-valuenow={width}
      aria-valuemin={CONSOLE_SIDEBAR_MIN_WIDTH}
      aria-valuemax={CONSOLE_SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      data-testid="console-sidebar-resize"
      className="group/resize absolute inset-y-0 -right-1 z-20 flex w-2 cursor-col-resize touch-none justify-center focus-visible:outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width, last: width };
        document.body.style.setProperty('cursor', 'col-resize');
        document.body.style.setProperty('user-select', 'none');
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        start.last = clampConsoleSidebarWidth(start.width + event.clientX - start.x);
        onPreview(start.last);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        end(true);
      }}
      onPointerCancel={() => end(false)}
      onDoubleClick={() => {
        end(false);
        onCommit(CONSOLE_EXPANDED_SIDEBAR_WIDTH);
      }}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowLeft' ? width - SIDEBAR_WIDTH_KEY_STEP
          : event.key === 'ArrowRight' ? width + SIDEBAR_WIDTH_KEY_STEP
          : event.key === 'Home' ? CONSOLE_SIDEBAR_MIN_WIDTH
          : event.key === 'End' ? CONSOLE_SIDEBAR_MAX_WIDTH
          : null;
        if (next === null) return;
        event.preventDefault();
        const clamped = clampConsoleSidebarWidth(next);
        if (clamped !== width) onCommit(clamped);
      }}
    >
      <span
        aria-hidden="true"
        className="h-full w-0.5 bg-transparent transition-colors group-hover/resize:bg-sidebar-border group-active/resize:bg-primary/60 group-focus-visible/resize:bg-ring"
      />
    </div>
  );
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SidebarWidthHandle — the docked console sidebar's page-facing edge (its
 * right edge, or its left edge in a right-to-left language, objectstack#37914),
 * which resizes it (objectstack#36227, as Attio): dragged with the pointer between
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
  isRightToLeft,
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
  // `toward` is +1 when a move to the right widens the sidebar (left to right),
  // -1 when it narrows it (right to left, where the sidebar sits on the right).
  const drag = React.useRef<{ x: number; width: number; last: number; toward: 1 | -1 } | null>(null);

  const end = (commit: boolean) => {
    const start = drag.current;
    drag.current = null;
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    onPreview(null);
    if (commit && start && start.last !== start.width) onCommit(start.last);
  };

  // The handle can go away mid-drag: ⌘/Ctrl+B folds the sidebar, or the window
  // narrows past 768 px, while the edge is still held. The drag then ends as a
  // cancel: the page is selectable again and the sidebar goes back to the
  // width it had when the drag began, the way a pointer-cancel ends it.
  const previewRef = React.useRef(onPreview);
  React.useEffect(() => {
    previewRef.current = onPreview;
  });
  React.useEffect(
    () => () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      previewRef.current(null);
    },
    [],
  );

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
      className="group/resize absolute inset-y-0 -end-1 z-20 flex w-2 cursor-col-resize touch-none justify-center focus-visible:outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = {
          x: event.clientX,
          width,
          last: width,
          toward: isRightToLeft(event.currentTarget) ? -1 : 1,
        };
        document.body.style.setProperty('cursor', 'col-resize');
        document.body.style.setProperty('user-select', 'none');
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        start.last = clampConsoleSidebarWidth(start.width + start.toward * (event.clientX - start.x));
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
        // The arrow toward the page widens the sidebar: → in a left-to-right
        // language, ← in a right-to-left one, where the edge faces left.
        const step = isRightToLeft(event.currentTarget) ? -SIDEBAR_WIDTH_KEY_STEP : SIDEBAR_WIDTH_KEY_STEP;
        const next =
          event.key === 'ArrowLeft' ? width - step
          : event.key === 'ArrowRight' ? width + step
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

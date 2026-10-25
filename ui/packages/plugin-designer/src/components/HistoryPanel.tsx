/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Button, ScrollArea } from '@object-ui/components';
import { Undo2, Redo2, History as HistoryIcon, RotateCcw } from 'lucide-react';
import type { UndoRedoState } from '../hooks/useUndoRedo';
import { useDesignerTranslation } from '../hooks/useDesignerTranslation';

export interface HistoryPanelProps<T> {
  /** The undo/redo state returned by `useUndoRedo` / `useDesignerHistory`. */
  history: UndoRedoState<T>;
  /**
   * Render each entry's label. Receives the entry itself, its index in the
   * combined `[past, current, future]` timeline, and a relative position
   * (`-N` for past, `0` for current, `+N` for future).
   */
  renderLabel?: (entry: T, index: number, position: number) => React.ReactNode;
  /** Optional title shown at the top of the panel. */
  title?: string;
  /** Compact / minimal mode hides the title and action buttons. */
  compact?: boolean;
  className?: string;
}

/**
 * Visual timeline of recent operations, paired with `useUndoRedo`.
 *
 * Renders the combined past + current + future stack as a vertical list. Each
 * entry is clickable and jumps the underlying state via `history.jumpTo()`.
 * The current entry is highlighted; future entries are dimmed to show that
 * they will be re-applied if selected.
 *
 * Example:
 * ```tsx
 * const history = useDesignerHistory(initialDraft, { persistKey: 'designer' });
 * <HistoryPanel
 *   history={history}
 *   renderLabel={(draft, idx) => `Step ${idx + 1}: ${draft.lastAction ?? 'edit'}`}
 * />
 * ```
 */
export function HistoryPanel<T>({
  history,
  renderLabel,
  title = 'History',
  compact = false,
  className,
}: HistoryPanelProps<T>) {
  const { timeline, currentIndex, undo, redo, jumpTo, canUndo, canRedo } = history;
  const { t } = useDesignerTranslation();

  const defaultRenderLabel = React.useCallback(
    (_entry: T, _index: number, position: number) => {
      if (position === 0) return 'Current';
      if (position < 0) return `Earlier (${Math.abs(position)} step${Math.abs(position) > 1 ? 's' : ''} back)`;
      return `Later (${position} step${position > 1 ? 's' : ''} forward)`;
    },
    [],
  );
  const labelFn = renderLabel ?? defaultRenderLabel;

  return (
    <div
      className={['flex flex-col h-full min-h-0 border rounded-md bg-card', className]
        .filter(Boolean)
        .join(' ')}
      data-testid="history-panel"
    >
      {!compact && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <HistoryIcon className="size-4" aria-hidden="true" />
            {title}
            <span className="text-xs text-muted-foreground tabular-nums">
              ({timeline.length})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              aria-label={t('designer.undo')}
              data-testid="history-panel-undo"
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={redo}
              disabled={!canRedo}
              aria-label={t('designer.redo')}
              data-testid="history-panel-redo"
            >
              <Redo2 className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <ol className="p-1.5 space-y-0.5">
          {timeline.map((entry, idx) => {
            const position = idx - currentIndex;
            const isCurrent = idx === currentIndex;
            const isFuture = idx > currentIndex;
            return (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => jumpTo(idx)}
                  data-testid={`history-panel-entry-${idx}`}
                  data-current={isCurrent || undefined}
                  className={[
                    'group w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs rounded transition-colors',
                    isCurrent
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                    isFuture ? 'opacity-60' : '',
                  ].filter(Boolean).join(' ')}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span
                    className={[
                      'inline-block size-1.5 rounded-full shrink-0',
                      isCurrent ? 'bg-primary' : 'bg-muted-foreground/40',
                    ].join(' ')}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">{labelFn(entry, idx, position)}</span>
                  {isCurrent && (
                    <RotateCcw className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </ScrollArea>
    </div>
  );
}

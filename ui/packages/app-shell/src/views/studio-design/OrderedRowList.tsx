/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ordered list the object settings panel authors its ORDER-ONLY keys with
 * (`highlightFields`, `relatedLists`): numbered rows, each one draggable to a
 * new place or moved with its up / down buttons (the keyboard path — the drag
 * has no keyboard equivalent), and removable.
 *
 * It owns the drag state and the row chrome, nothing else: what a row says,
 * what a move or a removal writes, and anything drawn around the list (an add
 * picker, a preview) stay with the editor that hosts it.
 */

import React from 'react';
import { GripVertical, X } from 'lucide-react';
import { InspectorReorderButtons } from '../metadata-admin/inspectors/_shared.js';

export function OrderedRowList({
  items,
  renderRow,
  onMove,
  onRemove,
  removeLabel,
  ariaLabel,
  rowTestId,
  disabled,
}: {
  /** The row keys, in order (unique). */
  items: readonly string[];
  /** What row `key` says. */
  renderRow: (key: string, index: number) => React.ReactNode;
  /** Move the row at `from` to `to` (both in range, never equal). */
  onMove: (from: number, to: number) => void;
  onRemove: (key: string) => void;
  /** The remove button's accessible name for `key`. */
  removeLabel: (key: string) => string;
  /** The list's accessible name. */
  ariaLabel: string;
  /** The row's `data-testid` for `key`. */
  rowTestId: (key: string) => string;
  disabled?: boolean;
}) {
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    onMove(from, to);
  };
  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };
  if (items.length === 0) return null;
  return (
    <ol className="space-y-1" aria-label={ariaLabel}>
      {items.map((key, i) => (
        <li
          key={key}
          data-testid={rowTestId(key)}
          draggable={!disabled}
          onDragStart={(e) => {
            e.dataTransfer?.setData('text/plain', key);
            setDragIndex(i);
          }}
          onDragOver={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            setOverIndex(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex !== null) move(dragIndex, i);
            endDrag();
          }}
          onDragEnd={endDrag}
          className={
            'flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 text-[12px]'
            + (overIndex === i && dragIndex !== null && dragIndex !== i ? ' border-primary' : '')
            + (dragIndex === i ? ' opacity-50' : '')
          }
        >
          {!disabled && (
            <GripVertical
              className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">{renderRow(key, i)}</span>
          {!disabled && (
            <>
              <InspectorReorderButtons index={i} total={items.length} onMove={(to) => move(i, to)} />
              <button
                type="button"
                aria-label={removeLabel(key)}
                onClick={() => onRemove(key)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

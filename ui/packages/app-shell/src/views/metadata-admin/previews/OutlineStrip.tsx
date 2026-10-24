// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * OutlineStrip — clickable chip strip that lets users select
 * sub-elements inside a preview whose main canvas renders through a
 * sealed external renderer (SchemaRenderer, ReportRenderer, …) and
 * therefore can't intercept clicks directly.
 *
 * The strip sits above the canvas. Each chip emits a selection on
 * click; the currently-selected one gets a ring. Empty list collapses
 * the strip entirely so the canvas takes the full preview height
 * outside design mode.
 */

import { Plus } from 'lucide-react';
import { cn } from '@object-ui/components';

export interface OutlineEntry {
  /** Selection id to emit. */
  id: string;
  /** Human-readable chip label. */
  label: string;
}

export function OutlineStrip({
  title,
  entries,
  selectedId,
  onSelect,
  onAdd,
  addLabel,
}: {
  title: string;
  entries: OutlineEntry[];
  selectedId: string | null;
  onSelect: (entry: OutlineEntry) => void;
  /**
   * Optional: render a `+` chip at the end. Clicking it should append
   * a new item to the underlying array, set selection to the new item,
   * and let the inspector open immediately.
   */
  onAdd?: () => void;
  /** Tooltip / aria-label for the Add chip. Defaults to "Add". */
  addLabel?: string;
}) {
  if (entries.length === 0 && !onAdd) return null;
  return (
    <div className="border-b bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onSelect(e); }}
            className={cn(
              'rounded border bg-background px-2 py-0.5 text-xs hover:border-primary/50 cursor-pointer',
              selectedId === e.id && 'ring-2 ring-primary border-primary',
            )}
          >
            {e.label}
          </button>
        ))}
        {onAdd && (
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onAdd(); }}
            className="rounded border border-dashed bg-background px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary cursor-pointer inline-flex items-center gap-1"
            aria-label={addLabel ?? 'Add'}
            title={addLabel ?? 'Add'}
          >
            <Plus className="h-3 w-3" />
            <span>{addLabel ?? 'Add'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

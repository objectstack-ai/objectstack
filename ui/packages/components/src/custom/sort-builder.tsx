/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { X, Plus, GripVertical } from "lucide-react"
import { createSafeTranslation } from "@object-ui/i18n"
import type { SortItem as SpecSortItem } from "@objectstack/spec/shared"

import { cn } from "../lib/utils"
import { Button } from "../ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"

const useSafeSortTranslation = createSafeTranslation(
  {
    'sortBuilder.sortBy': 'Sort by',
    'sortBuilder.thenBy': 'Then by',
    'sortBuilder.selectField': 'Select field',
    'sortBuilder.ascending': 'A → Z',
    'sortBuilder.descending': 'Z → A',
    'sortBuilder.oldestFirst': 'Oldest → Newest',
    'sortBuilder.newestFirst': 'Newest → Oldest',
    'sortBuilder.addSort': 'Add sort',
    'sortBuilder.removeSort': 'Remove sort',
    'sortBuilder.reorder': 'Drag to reorder',
  },
  'sortBuilder.sortBy',
)

/** Field types whose order is time: their direction reads "Oldest → Newest". */
const DATE_SORT_TYPES = new Set(['date', 'datetime'])

/**
 * One row of the SortBuilder UI: the spec's `SortItem` (`{ field, order }`)
 * plus the React key this list needs.
 *
 * Derived rather than re-declared (objectstack#4115). The old hand copy agreed
 * with the spec key-for-key, which is the state one spec release away from
 * drifting — a new sort key (`nulls`, say) would have appeared in the spec and
 * silently gone missing here. `id` is the ONE local addition and it is
 * synthetic: `normalize()` mints it, and `SortBuilder`'s change comparison
 * strips it before diffing precisely because it is not part of the contract.
 */
export interface SortItem extends SpecSortItem {
  /** React key for the row. Synthetic — never part of the emitted sort. */
  id: string;
}

export interface SortBuilderProps {
  fields?: Array<{
    value: string
    label: string
    /**
     * Listed but not choosable (objectui#11943). A disabled entry still names
     * a row whose current field it is, so that row shows its label and can be
     * changed or removed, but no row's dropdown lets the user pick it and
     * "Add sort" never seeds it. "Add sort" seeds the first entry that is not
     * disabled, and is itself disabled when every entry is.
     */
    disabled?: boolean
    /**
     * The field's type (objectstack#27520). A `date` or `datetime` row names
     * its direction as time ("Oldest → Newest") instead of "A → Z". Absent,
     * the row reads "A → Z" as before.
     */
    type?: string
  }>;
  value?: SortItem[];
  onChange?: (value: SortItem[]) => void;
  className?: string;
  /**
   * The host draws each level's face itself (objectstack#35884: the phone
   * sheet's two-line level) and 「Add sort」 (none is drawn). The levels, their
   * order, the handle (mouse, touch, keys) and every write stay the builder's.
   */
  renderLevel?: (level: SortBuilderLevel) => React.ReactNode;
}

/** One level, as {@link SortBuilderProps.renderLevel} receives it. */
export interface SortBuilderLevel {
  item: SortItem;
  /** The builder's reorder handle for this level. */
  handle: React.ReactNode;
  /** The words for this field's two directions. */
  direction: { asc: string; desc: string };
  setOrder: (order: 'asc' | 'desc') => void;
  remove: () => void;
}

export function SortBuilder({
  fields = [],
  value = [],
  onChange,
  className,
  renderLevel,
}: SortBuilderProps) {
  const { t } = useSafeSortTranslation()
  // Normalize incoming items: ensure every row has an `id` (React key) and
  // accept either `order` (internal) or `sortOrder` (spec) for the direction.
  const normalize = React.useCallback((rows: any[]): SortItem[] => {
    return (rows || []).map((row, idx) => ({
      id: row?.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sort-${idx}-${row?.field ?? ''}`),
      field: row?.field ?? '',
      order: (row?.order ?? row?.sortOrder ?? 'asc') as 'asc' | 'desc',
    }));
  }, []);

  const [items, setItems] = React.useState<SortItem[]>(() => normalize(value));

  React.useEffect(() => {
    const next = normalize(value);
    // Compare ignoring the synthetic `id` so external updates don't loop
    const stripIds = (rs: SortItem[]) => rs.map(({ id: _id, ...rest }) => rest);
    if (JSON.stringify(stripIds(next)) !== JSON.stringify(stripIds(items))) {
      setItems(next);
    }
  }, [value, items, normalize]);

  const handleChange = (newItems: SortItem[]) => {
    setItems(newItems);
    onChange?.(newItems);
  };

  // One row per field (objectstack#27520): a second key on a field the sort
  // already orders by changes nothing, so a field another row holds is not
  // offered to this one. A row's own field stays choosable in its dropdown.
  const heldBy = new Map<string, string>();
  for (const item of items) if (item.field && !heldBy.has(item.field)) heldBy.set(item.field, item.id);
  const takenElsewhere = (field: string, rowId: string) => {
    const holder = heldBy.get(field);
    return holder !== undefined && holder !== rowId;
  };

  // A new row starts on the first field the user may choose: a disabled
  // entry is only there for the row that already names it, and a field a row
  // already sorts by is not offered again.
  const firstChoosable = fields.find((f) => !f.disabled && !heldBy.has(f.value));

  // A date's direction is time, not the alphabet (objectstack#27520).
  const typeOf = new Map(fields.map((f) => [f.value, f.type]));
  const directionLabels = (field: string) =>
    DATE_SORT_TYPES.has(typeOf.get(field) ?? '')
      ? { asc: t('sortBuilder.oldestFirst'), desc: t('sortBuilder.newestFirst') }
      : { asc: t('sortBuilder.ascending'), desc: t('sortBuilder.descending') };

  const addItem = () => {
    const newItem: SortItem = {
      id: crypto.randomUUID(),
      field: firstChoosable?.value || "",
      order: 'asc',
    };
    handleChange([...items, newItem]);
  };

  const updateItem = (id: string, updates: Partial<SortItem>) => {
    handleChange(items.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const removeItem = (id: string) => {
    handleChange(items.filter(item => item.id !== id));
  };

  // objectstack#35876 — the levels' order is the sort's priority: a row's
  // handle drags it to another place, and ArrowUp / ArrowDown on the focused
  // handle move it one place.
  const dragFrom = React.useRef<number | null>(null);
  const handleRefs = React.useRef(new Map<string, HTMLElement>());
  const moveItem = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    handleChange(next);
    return moved.id;
  };

  // objectstack#35884 — a touch has no HTML5 drag: a finger on the handle
  // moves its level by pointer events instead. The level under the finger is
  // where it lands; lifting the finger moves it there.
  const rowsRef = React.useRef<HTMLDivElement | null>(null);
  const [touchDrag, setTouchDrag] = React.useState<{ from: number; over: number } | null>(null);
  const indexAt = (clientY: number): number => {
    // The levels are the list's own children, one per level.
    const rows = Array.from(rowsRef.current?.children ?? []);
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return Math.max(0, rows.length - 1);
  };
  const touchHandlers = (index: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' || items.length < 2) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setTouchDrag({ from: index, over: index });
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (!touchDrag) return;
      const over = indexAt(event.clientY);
      if (over !== touchDrag.over) setTouchDrag({ from: touchDrag.from, over });
    },
    onPointerUp: () => {
      if (!touchDrag) return;
      moveItem(touchDrag.from, touchDrag.over);
      setTouchDrag(null);
    },
    onPointerCancel: () => setTouchDrag(null),
  });

  // The handle, one control for every level face: mouse drag (HTML5), touch drag
  // (pointer events), and ArrowUp / ArrowDown when focused.
  const renderHandle = (item: SortItem, index: number, className?: string) => (
    // A `span`, not a `<button>`: Firefox starts no HTML5 drag from a
    // button. It is a keyboard control all the same (role, tab stop, arrows).
    <span
      role="button"
      tabIndex={items.length > 1 ? 0 : -1}
      aria-disabled={items.length < 2 || undefined}
      ref={(node) => {
        if (node) handleRefs.current.set(item.id, node);
        else handleRefs.current.delete(item.id);
      }}
      draggable={items.length > 1}
      onDragStart={(event) => {
        event.stopPropagation();
        dragFrom.current = index;
        event.dataTransfer?.setData('text/plain', String(index));
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        dragFrom.current = null;
      }}
      onKeyDown={(event) => {
        const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
        if (to === null) return;
        event.preventDefault();
        const moved = moveItem(index, to);
        // The handle keeps focus at the row's new place.
        if (moved) requestAnimationFrame(() => handleRefs.current.get(moved)?.focus());
      }}
      {...touchHandlers(index)}
      // A bottom sheet that closes on a downward swipe leaves this drag alone.
      data-vaul-no-drag=""
      aria-label={t('sortBuilder.reorder')}
      title={t('sortBuilder.reorder')}
      className={cn(
        "inline-flex h-9 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:opacity-40",
        className,
      )}
      data-testid="sort-builder-handle"
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </span>
  );

  const rowDropHandlers = (index: number) => ({
    // The drag is this list's own: a host that draws the builder inside
    // its own drag target (a reorderable chip) never sees it.
    onDragOver: (event: React.DragEvent) => {
      if (dragFrom.current === null) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onDrop: (event: React.DragEvent) => {
      if (dragFrom.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      moveItem(dragFrom.current, index);
      dragFrom.current = null;
    },
  });

  return (
    <div className={cn("space-y-3", className)}>
      <div ref={rowsRef} className={renderLevel ? "divide-y rounded-lg border" : "space-y-2"}>
        {items.map((item, index) => {
          const direction = directionLabels(item.field);
          const over = touchDrag && touchDrag.over === index && touchDrag.from !== index;
          if (renderLevel) return (
            <div key={item.id} className={cn(over && "bg-accent")} data-testid="sort-builder-row" {...rowDropHandlers(index)}>
              {renderLevel({
                item,
                handle: renderHandle(item, index, "h-11 w-8"),
                direction,
                setOrder: (order) => updateItem(item.id, { order }),
                remove: () => removeItem(item.id),
              })}
            </div>
          );
          return (
          // Below `sm` a level takes three lines so no select cuts its label:
          // the words, then the field beside Remove, then the direction.
          <div
            key={item.id}
            className={cn(
              "flex items-center gap-2 max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)_auto]",
              over && "rounded bg-accent",
            )}
            data-testid="sort-builder-row"
            {...rowDropHandlers(index)}
          >
             {renderHandle(item, index, "max-sm:col-start-1 max-sm:row-start-1 max-sm:row-span-3 max-sm:h-auto")}
             <span className="text-sm font-medium w-16 text-muted-foreground max-sm:col-start-2 max-sm:col-span-2 max-sm:w-auto">
               {index === 0 ? t('sortBuilder.sortBy') : t('sortBuilder.thenBy')}
             </span>
             <div className="flex-1 min-w-0 max-sm:col-start-2 max-sm:row-start-2">
                <Select
                  value={item.field}
                  onValueChange={(val) => updateItem(item.id, { field: val })}
                >
                  <SelectTrigger className="h-9 max-sm:h-11" data-testid="sort-builder-field">
                    <SelectValue placeholder={t('sortBuilder.selectField')} />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map(f => (
                      <SelectItem
                        key={f.value}
                        value={f.value}
                        disabled={f.disabled || takenElsewhere(f.value, item.id)}
                      >
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
             </div>
             <div className="w-36 max-sm:col-start-2 max-sm:col-span-2 max-sm:row-start-3 max-sm:w-auto">
                <Select
                  value={item.order}
                  onValueChange={(val) => updateItem(item.id, { order: val as 'asc' | 'desc' })}
                >
                  <SelectTrigger className="h-9 max-sm:h-11" data-testid="sort-builder-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">{direction.asc}</SelectItem>
                    <SelectItem value="desc">{direction.desc}</SelectItem>
                  </SelectContent>
                </Select>
             </div>
             <Button
               variant="ghost"
               size="icon"
               className="h-9 w-9 shrink-0 max-sm:col-start-3 max-sm:row-start-2 max-sm:h-11 max-sm:w-11"
               onClick={() => removeItem(item.id)}
               aria-label={t('sortBuilder.removeSort')}
             >
               <X className="h-4 w-4" />
             </Button>
          </div>
          );
        })}
      </div>
      {!renderLevel && <Button
        variant="outline"
        size="sm"
        onClick={addItem}
        className="h-8 max-sm:h-11"
        disabled={!firstChoosable}
      >
        <Plus className="h-3 w-3 mr-2" />
        {t('sortBuilder.addSort')}
      </Button>}
    </div>
  );
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sidebar Favorites section's own rows — the favorites that are not
 * navigation entries (a starred list view, record, object, dashboard, page) —
 * as a list the user orders by dragging (objectstack#27594). It is the same
 * gesture the pinned entries above it take (`NavigationRenderer`'s pinned
 * list, objectui#12059): a row is dragged by its own link, with no grip at
 * rest; from the keyboard, Space picks the focused row up, the arrow keys move
 * it, Space drops it and Escape cancels. The other rows hold still and an
 * insertion line shows where the row lands. A drop reports the ids of the rows
 * drawn here, in their new order. The rows are `SidebarMenuItem`s for the
 * menu list the section already draws them in (`extraFavorites`).
 *
 * @module
 */

import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDndContext,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  type KeyboardSensorOptions,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SidebarMenuItem, cn } from '@object-ui/components';

/** Pixels a pointer moves before a press becomes a drag, so a click still follows the link. */
const DRAG_ACTIVATION_DISTANCE = 5;

/** Space starts and ends a keyboard drag; Enter stays the link's. */
const KEYBOARD_SENSOR: KeyboardSensorOptions = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
};

/** The other rows hold still while one is dragged; the insertion line shows where it lands. */
const holdRowsStill: SortingStrategy = () => null;

const startedByKeyboard = (event: { activatorEvent: Event | null }) => event.activatorEvent?.type === 'keydown';

/**
 * Swallows the click that ends a pointer drag: the button is released over the
 * row's own link, and the browser would follow it with a full page load.
 */
function swallowClickAfterPointerDrag(): void {
  const swallow = (event: MouseEvent) => event.preventDefault();
  window.addEventListener('click', swallow, { capture: true });
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
}

/** What a row hands the element that starts its drag: its own link. */
export interface FavoriteRowDragProps {
  ref: (element: HTMLElement | null) => void;
  'aria-describedby': string;
  onKeyUp: (event: React.KeyboardEvent) => void;
  [listener: string]: unknown;
}

export interface SortableFavoriteRowsProps<T extends { id: string }> {
  items: readonly T[];
  /** Called on a drop with the ids of the rows, in their new order. */
  onReorder: (ids: string[]) => void;
  /** The row's content inside its `SidebarMenuItem`; spread `drag` on the row's link. */
  renderRow: (item: T, drag: FavoriteRowDragProps) => React.ReactNode;
}

export function SortableFavoriteRows<T extends { id: string }>({ items, onReorder, renderRow }: SortableFavoriteRowsProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR),
  );
  const ids = items.map((item) => item.id);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!startedByKeyboard(event)) swallowClickAfterPointerDrag();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  };
  const handleDragCancel = (event: DragCancelEvent) => {
    if (!startedByKeyboard(event)) swallowClickAfterPointerDrag();
  };

  return (
    <DndContext
      id="sidebar-favorites"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={ids} strategy={holdRowsStill}>
        {items.map((item) => (
          <SortableFavoriteRow key={item.id} id={item.id}>
            {(drag) => renderRow(item, drag)}
          </SortableFavoriteRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableFavoriteRow({ id, children }: { id: string; children: (drag: FavoriteRowDragProps) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, activeIndex, index } =
    useSortable({ id });
  const { activatorEvent } = useDndContext();
  // A keyboard drag leaves the row in place, dimmed, so it never covers the
  // row it is over: the insertion line alone shows where it lands.
  const heldInPlace = isDragging && activatorEvent?.type === 'keydown';
  const style: React.CSSProperties = {
    transform: heldInPlace ? undefined : CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
  };
  const dropIndicator = isOver && !isDragging && activeIndex !== -1 ? (activeIndex < index ? 'after' : 'before') : null;
  const drag: FavoriteRowDragProps = {
    ref: setActivatorNodeRef,
    ...(listeners as DraggableSyntheticListeners & Record<string, unknown>),
    'aria-describedby': attributes['aria-describedby'],
    onKeyUp: (event: React.KeyboardEvent) => {
      if (event.code === 'Space') event.preventDefault();
    },
  };
  return (
    <SidebarMenuItem ref={setNodeRef} style={style} className="relative" data-favorite-id={id}>
      {dropIndicator && (
        <span
          aria-hidden="true"
          data-drop-indicator={dropIndicator}
          className={cn(
            'pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-primary',
            dropIndicator === 'before' ? '-top-px' : '-bottom-px',
          )}
        />
      )}
      {children(drag)}
    </SidebarMenuItem>
  );
}

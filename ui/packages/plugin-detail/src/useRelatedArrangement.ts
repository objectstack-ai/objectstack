/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { useIsMobile } from '@object-ui/components';
import type { RelatedCardChrome } from './relatedListCompact';
import {
  editRelatedArrangement,
  resolveRelatedArrangement,
  type RelatedArrangement,
  type RelatedArrangementEdit,
  type RelatedCardId,
  type ResolvedRelatedArrangement,
} from './synth/relatedArrangement';

export interface UseRelatedArrangementOptions {
  /** The cards' default order (the page's). */
  defaultOrder: readonly RelatedCardId[];
  /** The reader's stored arrangement (the host's workspace preference). */
  arrangement?: RelatedArrangement;
  /** Keep a new arrangement; absent, the choices hold for this view only. */
  onArrangementChange?: (next: RelatedArrangement) => void;
  /** Enlarge a card's list in place (the host's `?related=`). */
  onEnlarge?: (id: RelatedCardId) => void;
  /** Make each panel's ⠿ handle a drag source (desktop column tiers). */
  draggable?: boolean;
  /** The drag's start / end, for the stack that draws the drop line. */
  onDragStart?: (id: RelatedCardId) => void;
  onDragEnd?: () => void;
}

export interface RelatedArrangementControls {
  resolved: ResolvedRelatedArrangement;
  edit: (change: RelatedArrangementEdit) => void;
  /** The chrome card `id` at shown position `index` hands its list. */
  chromeOf: (id: RelatedCardId, index: number) => RelatedCardChrome;
}

/**
 * The reader's arrangement of a page's related panels, live (objectstack#27055,
 * Targets 7 and 10; objectstack#27524, Targets 1 and 10): the stored value
 * laid over the default order, the edits written back through the host, and
 * each panel's chrome (the ⠿ handle's drag and ⌥↑ / ⌥↓, the ⋯ menu's hide,
 * the way to the whole list), for the right column's panel stack. The record
 * page's tab row reads the same stored value (`resolveRelatedArrangement`),
 * so the panels and their tabs stand in one order.
 *
 * A relationship new since the reader's last drag is stamped as seen the
 * first time this reader's page shows it (rule 3's 48 h clock).
 */
export function useRelatedArrangement({
  defaultOrder,
  arrangement,
  onArrangementChange,
  onEnlarge,
  draggable = false,
  onDragStart,
  onDragEnd,
}: UseRelatedArrangementOptions): RelatedArrangementControls {
  const isMobile = useIsMobile();
  const [localArrangement, setLocalArrangement] = React.useState<RelatedArrangement | undefined>(undefined);
  const stored = onArrangementChange ? arrangement : localArrangement;
  const write = onArrangementChange ?? setLocalArrangement;
  // The 48 h 「新」 clock is read once per mount (a render must stay pure);
  // every edit below stamps its own time in the event handler.
  const [now] = React.useState(() => Date.now());
  const resolved = resolveRelatedArrangement(defaultOrder, stored, now);
  const edit = (change: RelatedArrangementEdit) =>
    write(editRelatedArrangement(defaultOrder, stored, change, Date.now()));

  const unseenKey = resolved.unseen.join('|');
  React.useEffect(() => {
    if (!unseenKey || !stored) return;
    write(
      editRelatedArrangement(defaultOrder, stored, { kind: 'mark-seen', ids: unseenKey.split('|'), at: Date.now() }, Date.now()),
    );
    // Stamp once per set of unseen ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenKey]);

  const chromeOf = (id: RelatedCardId, index: number): RelatedCardChrome => ({
    id,
    fresh: resolved.fresh.has(id),
    onMoveUp: index > 0 ? () => edit({ kind: 'move-up', id }) : undefined,
    onMoveDown: index < resolved.order.length - 1 ? () => edit({ kind: 'move-down', id }) : undefined,
    onHide: () => edit({ kind: 'hide', id }),
    onEnlarge: onEnlarge ? () => onEnlarge(id) : undefined,
    dragHandleProps:
      draggable && !isMobile
        ? {
            draggable: true,
            onDragStart: (event: React.DragEvent) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', id);
              // The handle is a few pixels; the reader drags the whole panel.
              const panel = (event.currentTarget as HTMLElement).closest('[data-related-card-id]');
              if (panel && typeof event.dataTransfer.setDragImage === 'function') {
                event.dataTransfer.setDragImage(panel, 16, 16);
              }
              onDragStart?.(id);
            },
            onDragEnd: () => onDragEnd?.(),
          }
        : undefined,
  });

  return { resolved, edit, chromeOf };
}

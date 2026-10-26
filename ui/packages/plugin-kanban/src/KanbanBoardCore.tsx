/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { Suspense } from 'react';
import { Skeleton } from '@object-ui/components';
import { createSafeTranslation } from '@object-ui/i18n';
// ⚠️ A cycle, and a harmless one: `./index` imports this module back. The
// binding is read at RENDER time only, never while either module evaluates,
// which is the same shape `ObjectKanban.tsx` <-> `index.tsx` already has.
import { bucketCardsIntoColumns } from './index';
import type { KanbanRendererProps } from './index';

const useUncolumnedT = createSafeTranslation(
  { 'kanban.uncategorized': 'Uncategorized' },
  'kanban.uncategorized',
);

// 🚀 Lazy load the implementation files
const LazyKanban = React.lazy(() => import('./KanbanImpl'));

/**
 * The document this board reads: `KanbanRendererProps['schema']` WITHOUT the
 * Quick Add pair. The two keys are left out of the type on purpose, so that a
 * `schema.quickAdd` / `schema.onQuickAdd` read written into this module does
 * not compile.
 */
export type KanbanBoardCoreSchema = Omit<KanbanRendererProps['schema'], 'quickAdd' | 'onQuickAdd'>;

export interface KanbanBoardCoreProps {
  schema: KanbanBoardCoreSchema;
  /** Forwarded unchanged — see `KanbanRendererProps.objectFields`. */
  objectFields?: KanbanRendererProps['objectFields'];
  /** Forwarded unchanged — see `KanbanRendererProps.onCardMove`. */
  onCardMove?: KanbanRendererProps['onCardMove'];
  /**
   * Whether the cards may be dragged at all (default `true`). A PROP, never a
   * schema key: `ObjectKanban` passes `false` when its `kanbanCardMove` row of
   * the affordance-to-grant map is closed (objectui#12082), so the board offers
   * no move the caller may not make.
   */
  cardsMovable?: boolean;
  /** Half of the Quick Add pair. Only `KanbanRenderer` supplies it. */
  quickAdd?: boolean;
  /** The other half of the Quick Add pair. Only `KanbanRenderer` supplies it. */
  onQuickAdd?: (columnId: string, title: string) => void;
}

/**
 * The board both kanban entry points render. It buckets flat `data` into
 * lanes (`bucketCardsIntoColumns`) and hands the result to the lazily loaded
 * `KanbanImpl`.
 *
 * ⛔ INTERNAL (objectui#11234). `index.tsx` is the package barrel, and this
 * component is deliberately NOT re-exported from it. The two callers are
 * `KanbanRenderer`, the exported component a React host mounts, and
 * `ObjectKanban`, which every `object-kanban` entry point reaches.
 *
 * ## Why the Quick Add pair arrives as PROPS, and never off `schema`
 *
 * Ruling B of the director seat's decision batch #91 (objectui#8285): the
 * object-bound board does not grow an inline record-creation write path, and
 * the Quick Add pair stays with a React host. So the two callers differ on
 * exactly this pair:
 *
 *   - `KanbanRenderer` reads `schema.quickAdd` / `schema.onQuickAdd` and passes
 *     both here. Its public props are unchanged, so a host that mounts it keeps
 *     the control.
 *   - `ObjectKanban` passes neither. An `object-kanban` board draws no Quick Add
 *     control, whatever its document carries.
 *
 * This is also what lets `ObjectKanbanSchema.onQuickAdd` be a TOMBSTONE rather
 * than a runtime slot. `check:handler-key-reads` refuses a `'retired'`
 * disposition while a renderer reachable from the registration still reads the
 * key off the document. The `object-kanban` path used to reach
 * `KanbanRenderer`'s `schema.onQuickAdd` read. That read kept the key a runtime
 * slot, although on that path the function was never called. The path now
 * reaches this component, which reads neither key off the document, so the arm
 * carries the tombstone.
 *
 * ⛔ Do not read `quickAdd` or `onQuickAdd` off `schema` here. That puts the
 * read back on the `object-kanban` path, and the gate reports
 * `retired-but-read`. `KanbanBoardCoreSchema` leaves both keys out so that such
 * a read fails `type-check` first.
 */
export const KanbanBoardCore: React.FC<KanbanBoardCoreProps> = ({
  schema,
  objectFields,
  onCardMove,
  cardsMovable,
  quickAdd,
  onQuickAdd,
}) => {
  const { t } = useUncolumnedT();
  // ⚡️ Adapter: Map flat 'data' + 'groupBy' to nested 'cards' structure.
  const processedColumns = React.useMemo(
    () =>
      bucketCardsIntoColumns(
        schema.columns ?? [],
        schema.data,
        schema.groupBy,
        schema.coverImageField,
        t('kanban.uncategorized'),
      ),
    [schema, t],
  );

  return (
    <Suspense fallback={<Skeleton className="w-full h-[600px]" />}>
      <LazyKanban
        columns={processedColumns}
        onCardMove={onCardMove}
        cardsMovable={cardsMovable}
        onCardClick={schema.onCardClick}
        className={schema.className}
        quickAdd={quickAdd}
        onQuickAdd={onQuickAdd}
        coverImageField={schema.coverImageField}
        conditionalFormatting={schema.conditionalFormatting}
        objectFields={objectFields}
        swimlaneField={schema.swimlaneField}
        countsAreWindowed={schema.countsAreWindowed}
      />
    </Suspense>
  );
};

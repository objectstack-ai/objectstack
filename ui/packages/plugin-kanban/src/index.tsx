/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry, elementDataSourceBlock } from '@object-ui/core';
import {
  ElementDataSourceGate,
  useSchemaContext,
  type ElementDataSourceMapping,
} from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ComponentInput, KanbanConditionalFormattingRule } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';
import { KanbanBoardCore } from './KanbanBoardCore';

/**
 * Sentinel column id for records whose `groupBy` value matches no declared
 * column (a status the board doesn't render, an edited/removed picklist
 * option, imported legacy data, or an empty value). Before #2792 these were
 * accumulated during bucketing and then silently dropped — the board looked
 * empty while the list footer still counted the rows. They now surface in a
 * trailing "Uncategorized" lane so no record is invisible and the visible
 * card total reconciles with the record count. Exported so the drag handler
 * can refuse to persist this non-option value as a real status.
 */
export const KANBAN_UNCOLUMNED_ID = '__uncolumned__';

/**
 * Names, on the console, every stored group value that matched no lane id
 * (objectui#10069). Since lanes match by `id` only, the commonest cause is a
 * record that stored an option's LABEL (`'In Progress'`) instead of its value
 * (`'in_progress'`); before the ruling such a record reached its lane through
 * the retired title key, so the warn is what makes the narrowing visible
 * rather than a silent move into "Uncategorized".
 *
 * ONE warn per distinct raw value per bucketing pass — never one per record,
 * and never deduplicated across passes. Per value, because the count of
 * offending records is unbounded (a whole imported table can carry labels)
 * while the count of distinct values is bounded by the vocabulary. Per pass,
 * because a pass is one render or data load of one board: module-level
 * deduplication would stay silent for the next board, or for this board after
 * its picklist or data changed, which is exactly when an author looks for it.
 * The pass count is already bounded by `KanbanRenderer`'s memo.
 *
 * The empty value is not warned: a record with no group value is the ordinary
 * "not yet categorised" state (#2792), not a value/label mismatch.
 */
function warnUnmatchedGroupValues(
  unmatchedKeys: string[],
  groups: Record<string, any[]>,
  columns: Array<any>,
  groupBy: string,
): void {
  const offending = unmatchedKeys.filter((key) => key !== '');
  if (offending.length === 0) return;
  // `String()` for non-strings: a lane id is unvalidated input here, and
  // `JSON.stringify` throws on a bigint — a warn must never break the board.
  const show = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v) : String(v));
  const laneIds = columns.map((col: any) => show(col.id)).join(', ');
  for (const key of offending) {
    console.warn(
      `[plugin-kanban] ${groups[key].length} record(s) with ${JSON.stringify(groupBy)} = ` +
        `${JSON.stringify(key)} match no lane id and are shown in the trailing "Uncategorized" lane. ` +
        `Lanes match the stored option value by lane id only, never by lane title ` +
        `(objectui#10069). Available lane ids: [${laneIds}].`,
    );
  }
}

/**
 * The single place flat `data` + `groupBy` is bucketed into per-column card
 * arrays. Kept pure (title passed in, not translated here) so it can be unit
 * tested directly — see index.bucket.test.ts. Records whose group value maps
 * to no declared column land in a trailing `KANBAN_UNCOLUMNED_ID` lane
 * instead of being dropped (#2792).
 */
export function bucketCardsIntoColumns(
  columns: Array<any>,
  data: Array<any> | undefined,
  groupBy: string | undefined,
  coverImageField: string | undefined,
  uncolumnedTitle: string,
): Array<any> {
  const mapCoverImage = (item: any) => {
    if (!coverImageField) return item;
    const imgValue = item[coverImageField];
    if (!imgValue) return item;
    const coverImage = typeof imgValue === 'string' ? imgValue : imgValue?.url;
    return coverImage ? { ...item, coverImage } : item;
  };

  // No flat data / grouping key: return columns as-is (cover-mapped).
  if (!data || !groupBy || !Array.isArray(data)) {
    return columns.map((col: any) => ({
      ...col,
      cards: (col.cards || []).map(mapCoverImage),
    }));
  }

  // Build the lane lookup: a record belongs to a lane when its stored group
  // value equals that lane's `id` — the option value — and nothing else
  // (objectui#10069, ruling A). The lane `title` is PRESENTATION only: it used
  // to be lowercased into this map as a second, undeclared bucketing key, so
  // renaming a lane, relabelling a picklist option, or switching locale (lane
  // titles are translated — `localizeColumn` / `translateOptions` in
  // `ObjectKanban.tsx`) moved records between lanes. ⛔ Do not map `title`
  // here again: a record that stores a label instead of the option value is a
  // DATA defect, surfaced loudly by the warn below rather than absorbed.
  // The id comparison stays case-folded, as it was before the ruling — the
  // ruling retires the title key, not the folding of the id key.
  // ⚠️ Null prototype, not `{}` (objectui#9043). This map and `groups` below are
  // keyed by RECORD DATA, which no schema guards — `@objectstack/spec` narrows the
  // lane `id` (objectui#8913), not the values stored in the grouped field — so a
  // stored value like 'constructor' or '__proto__' would otherwise be answered by
  // `Object.prototype` instead of by what this function actually put here:
  //   - the READ below is `laneIdByFoldedId[k] ?? rawKey`, and `??` only falls
  //     back on null/undefined, so an INHERITED member is returned as if it were
  //     a declared lane id;
  //   - the WRITE `laneIdByFoldedId['__proto__'] = col.id` on a prototype-bearing
  //     object invokes the `__proto__` setter, which silently ignores a string —
  //     so a lane legitimately declared with that option value loses its mapping.
  // `Object.prototype.hasOwnProperty.call(...)` would close the READ only; the
  // write hazard needs the null prototype, which is why both maps take that route.
  const laneIdByFoldedId: Record<string, string> = Object.create(null);
  columns.forEach((col: any) => {
    if (col.id) laneIdByFoldedId[String(col.id).toLowerCase()] = col.id;
  });

  // 1. Group data by key, normalizing a case-folded match onto the lane id.
  // ⚠️ Null prototype for the same reason (objectui#9043), and this is the leg that
  // CRASHES: on a `{}` accumulator `acc['toString']` is the inherited METHOD, which
  // is truthy, so the array is never created and the next line calls `.push` on a
  // function — thrown during render, so the user sees a blank board with nothing
  // naming the record. `acc['__proto__'] = []` would likewise hit the setter and be
  // dropped, and step 2's `groups[col.id]` read would answer `Object.prototype` for
  // a lane declared `{ id: '__proto__' }`, which spreads as "not iterable".
  // ⚠️ The repair keeps every record: an offending one keeps its own value as its
  // group key and still surfaces in the trailing lane, never discarded (#2792).
  const groups = data.reduce((acc, item) => {
    const rawKey = String(item[groupBy] ?? '');
    const key = laneIdByFoldedId[rawKey.toLowerCase()] ?? rawKey;
    if (!acc[key]) acc[key] = [];
    acc[key].push(mapCoverImage(item));
    return acc;
  }, Object.create(null) as Record<string, any[]>);

  // 2. Inject into declared columns.
  const mapped = columns.map((col: any) => ({
    ...col,
    cards: [
      ...(col.cards || []).map(mapCoverImage), // Preserve static cards
      ...(groups[col.id] || []),               // Add dynamic cards
    ],
  }));

  // 3. Catch records whose group key matched no column (#2792). Without this
  // they sit in `groups` and are dropped — `groups[col.id]` never reads a key
  // that isn't a column id — so the board silently loses rows the list footer
  // still counts. Surface them in a trailing "Uncategorized" lane; dragging
  // one out to a real column repairs its status (the drag handler refuses to
  // persist a move INTO here).
  // ⚠️ Key this membership test the way the injection above keys its READ.
  // `groups[col.id]` is a property read, so it coerces the id: a lane
  // `{ id: 1 }` correctly picks up the group stored under `'1'`, and every key
  // `Object.keys(groups)` yields is a string. A Set built from the RAW id
  // therefore answers `new Set([1]).has('1') === false` and sweeps the very
  // records the injection already took — the board renders each of them twice,
  // once in its lane and once in "Uncategorized" (objectui#8993). Membership is
  // decided twice here, so both decisions must use the same key spelling.
  // A symbol is the one id a property read does NOT stringify, so it is kept
  // as-is rather than pushed through `String()` (which throws on symbols):
  // `Object.keys` never yields a symbol, so such a lane keeps today's reading.
  const knownIds = new Set<PropertyKey>(
    columns.map((col: any) => (typeof col.id === 'symbol' ? col.id : String(col.id))),
  );
  const unmatchedKeys = Object.keys(groups).filter((key) => !knownIds.has(key));
  const uncolumnedCards = unmatchedKeys.flatMap((key) => groups[key]);
  warnUnmatchedGroupValues(unmatchedKeys, groups, columns, groupBy);
  if (uncolumnedCards.length > 0) {
    mapped.push({ id: KANBAN_UNCOLUMNED_ID, title: uncolumnedTitle, cards: uncolumnedCards });
  }
  return mapped;
}

// Export types for external use
// ⛔ `KanbanSchema` RETIRED with the bare `kanban` node type key (objectui#8802).
// ⛔ `ColumnWidthConfig` DELETED — no key referenced it, nothing read it (objectui#10582).
export type { KanbanCard, KanbanColumn, CardTemplate, InlineFieldDefinition } from './types';
export { ObjectKanban };
export type { ObjectKanbanComponentProps } from './ObjectKanban';

/**
 * @deprecated Use `ObjectKanbanComponentProps`. Renamed in objectui#4650
 * because `@objectstack/spec/ui` owns `ObjectKanbanProps` from 17.0.0, where it
 * means the AUTHORED props document of the `object-kanban` element — not this
 * component's props. The alias denotes the SAME type and is kept only so
 * existing importers keep compiling.
 */
export type { ObjectKanbanComponentProps as ObjectKanbanProps } from './ObjectKanban';

// Phase 13 L2/L3: New components and hooks
export { InlineQuickAdd } from './InlineQuickAdd';
export type { InlineQuickAddProps } from './InlineQuickAdd';
export { CardTemplates } from './CardTemplates';
export type { CardTemplatesProps } from './CardTemplates';
export { useCrossSwimlaneMove } from './useCrossSwimlaneMove';
export type { Swimlane, CrossSwimlaneMoveEvent, UseCrossSwimlaneOptions, UseCrossSwimlaneMoveReturn } from './useCrossSwimlaneMove';
export { useQuickAddReorder } from './useQuickAddReorder';
export type { UseQuickAddReorderOptions, UseQuickAddReorderReturn } from './useQuickAddReorder';

export interface KanbanRendererProps {
  schema: {
    type: string;
    id?: string;
    className?: string;
    columns?: Array<any>;
    data?: Array<any>;
    groupBy?: string;
    swimlaneField?: string;
    /**
     * TWO parameters since objectui#9357. `KanbanRenderer` hands this value
     * straight to `KanbanImpl` (`onCardClick={schema.onCardClick}` below),
     * whose `SortableCard` invokes it as `onCardClick?.(card, e)` with the DOM
     * click event — the modifier payload a host needs for Cmd/Ctrl/middle-click.
     * Declaring one parameter described a call this component never makes.
     * `any` rather than `React.MouseEvent` keeps this face in agreement with its
     * published twin `ObjectKanbanSchema.onCardClick` (objectui#9341), which may
     * not name a React type.
     */
    onCardClick?: (card: any, event?: any) => void;
    quickAdd?: boolean;
    onQuickAdd?: (columnId: string, title: string) => void;
    coverImageField?: string;
    conditionalFormatting?: KanbanConditionalFormattingRule[];
    /**
     * The lane counts below are counts of a fetched WINDOW, not of the group
     * (`5591f03bd`). Injected by `ObjectKanban`, the only entry point that
     * issues the windowed `$top` query and can therefore know the answer;
     * `ObjectKanban` supplies nothing on the schema-only `kanban-ui` entry,
     * whose `data` arrives whole from its author and whose counts are complete
     * by construction. Not MEANT to be an authorable input for exactly that
     * reason — same shape and same argument as the `objectFields` prop BELOW,
     * and likewise absent from this component's registry `inputs`. ⚠️ Unlike
     * that prop it still rides this schema bag, so on `kanban-ui` an author can
     * in fact write it; batch #70 did not name the key, so it is recorded here
     * rather than moved (objectui#7742).
     */
    countsAreWindowed?: boolean;
  };
  /**
   * The object's field definitions, injected by `ObjectKanban` (the only entry
   * point that fetches an object schema). Card conditional formatting needs
   * them so a rule comparing a relation field sees the stored foreign key
   * rather than the record `$expand` substituted for it — the board expands
   * relations exactly as the grid does, so without this the SAME rule on the
   * SAME view worked on the grid and silently never matched on the board
   * (objectui#3501).
   *
   * ⛔ INTENDED AS AN INTERNAL CHANNEL, NOT AN AUTHORING SURFACE (objectui#7742,
   * maintainer decision batch #70, 2026-09-07). It sits HERE — a React prop, a
   * sibling of `schema` — and deliberately NOT inside `schema`, which is where
   * it used to live. Inside `schema` it was reachable by an AUTHOR: `BaseSchema`
   * is `.passthrough()`, `SchemaRenderer` hands the node through, and on the
   * schema-only `kanban-ui` entry (which has no object schema of its own to
   * substitute) an authored `objectFields` reached
   * `resolveConditionalFormatting` verbatim. Nothing declared it on any schema
   * face, so nothing judged it either.
   *
   * ⚠️ THE MOVE CLOSED THE `kanban` ARM; THE KEY IS CLOSED AT THE RENDERER
   * BOUNDARY. `ObjectKanbanRenderer` forwards its rest-spread to
   * `ObjectKanban`, which discards it (`void _props;`), so an authored
   * `objectFields` on a node it serves reaches nothing. The KEY is
   * closed one layer up: since objectui#8818, `objectFields` is on
   * `SchemaRenderer`'s stripped-metadata list (the destructure that feeds its
   * `...componentProps` rest), and the legacy `props` alias bag drops it too,
   * so an authored value reaches no component prop on any type key. The
   * schema-only `kanban-ui` registration that once served THIS component is
   * retired (objectui#8257), so no registry key resolves here at all:
   * `ObjectKanban` is the one caller, and it passes this prop.
   *
   * ⚠️ `countsAreWindowed` above is the SAME shape and the same argument, and
   * the batch #70 ruling did not name it — it stays on the schema bag, recorded
   * rather than fixed here.
   */
  objectFields?: unknown;

  /**
   * The board's card-move callback, injected by the host that owns the write.
   *
   * ⛔ A React PROP, a sibling of `schema`, and deliberately NOT a member of the
   * `schema` bag (objectui#9342, executing the ruling on PR objectui#9338; the
   * objectui#7742 remedy `objectFields` above already took, one member over,
   * under maintainer decision batch #70).
   *
   * Inside `schema` the key was reachable by an AUTHOR and reached NOTHING.
   * `BaseSchema` is `.passthrough()`, so `onCardMove` was accepted and KEPT on
   * an `object-kanban` document, and then dropped: `ObjectKanban` substitutes
   * its own `handleCardMove` on the schema it hands down — that wrapper owns the
   * optimistic write, the required-fields dialog and the rollback — and declares
   * no `onCardMove` React prop of its own (its rest parameter is discarded), so
   * neither channel delivered. Measured, driven rather than inferred, with
   * `onCardClick` as the lit control on the same document and the same render
   * (`__tests__/handlerKeyDispositionsMeasured-7804.test.tsx`).
   *
   * Moving the READ here is what lets the `object-kanban` arm tombstone the key
   * with `handlerKeyRefusal(…, 'retired', …)` and still satisfy
   * `check:handler-key-reads`, whose contract is that a tombstone "has no read
   * site BY CONSTRUCTION". What that gate could not see is that the value at the
   * old read was substituted one hop earlier.
   *
   * ⚠️ NARROWS A PUBLISHED PROPS SURFACE. A host that rendered `KanbanRenderer`
   * directly and wrote the key inside `schema` gets a TS error if it is typed
   * and a silent drop if it is not; it must move the function to this prop.
   */
  onCardMove?: (cardId: string, fromColumnId: string, toColumnId: string, newIndex: number) => void;
}

/**
 * KanbanRenderer - The public API for the kanban board component
 * The board it renders handles lazy loading internally using React.Suspense
 *
 * ## The Quick Add pair lives HERE, and nowhere on the `object-kanban` path
 *
 * This component reads `schema.quickAdd` and `schema.onQuickAdd` and hands both
 * to the internal `KanbanBoardCore` as explicit props. That is the host pair
 * ruling B keeps (objectui#8285, director seat, decision batch #91): "`kanban-ui`
 * keeps the pair meanwhile". With the `kanban-ui` tag retired (objectui#8257),
 * this exported component is where the pair lives, so a React host that mounts
 * it gets the control.
 *
 * `ObjectKanban` renders `KanbanBoardCore` directly and supplies neither half
 * (objectui#11234). So an `object-kanban` board has no read of either key, and
 * `ObjectKanbanSchema.onQuickAdd` is a tombstone on both faces. The full
 * argument is on `KanbanBoardCore`.
 */
export const KanbanRenderer: React.FC<KanbanRendererProps> = ({ schema, objectFields, onCardMove }) => (
  <KanbanBoardCore
    schema={schema}
    objectFields={objectFields}
    onCardMove={onCardMove}
    quickAdd={schema.quickAdd}
    onQuickAdd={schema.onQuickAdd}
  />
);

/**
 * ⛔ The `kanban-ui` node type key is RETIRED (objectui#8257, maintainer ruling
 * 2026-09-09), together with `kanban-enhanced` below. `KanbanRenderer` itself
 * stays exported and stays in use — `ObjectKanban` renders it — it is only the
 * REGISTRY KEY that is gone.
 *
 * ## The measurement the ruling was taken on
 *
 * Exact node-type spellings, whole repo: `kanban-ui` was authored 0 times in
 * JSON and 0 times in TS/TSX as a registry-resolved node, against a firing
 * control of 2 JSON / 128 TS occurrences for the live sibling `object-grid` and
 * a silent control (`zzz-not-a-type`, 0). ⇒ a registered type key no document
 * in this repository has ever authored. Declaring an arm for it would have
 * committed the repo to a validation face for a spelling with no writers — the
 * opposite of what ADR-0049 enforce-or-remove asks.
 *
 * ## Why unregistering is the whole retirement
 *
 * ⚠️ `BaseSchemaCore` ends `.passthrough()` (and `BaseSchema` closed with
 * `[key: string]: any` until objectui#8347), so a dropped MEMBER KEY is KEPT,
 * not refused, on the zod face (objectui#7664).
 * That hazard needs a schema face to arise on, and this key never had one:
 * measured whole-repo, `@object-ui/types` declares `kanban-ui` as a component
 * node type ZERO times (firing control: `object-kanban`, 2 — `objectql.ts` and
 * its Zod mirror). There is no arm to convert into a named refusal.
 * ⇒ Registration-only retirement.
 *
 * ## ⭐ What this closed as a side effect — objectui#8818
 *
 * `SchemaRenderer` strips a fixed, enumerated metadata list and spreads the
 * REST as React props. When this registration was retired `objectFields` was
 * not on that list, and `KanbanRenderer` — then registered here for
 * `kanban-ui` — declares `objectFields` as a real prop (objectui#7742). So an
 * AUTHORED `objectFields` reached the predicate layer verbatim on this entry,
 * with no schema face declaring or judging it. Retiring this registration
 * closed that ENTRY: nothing resolves `kanban-ui` any more, so no authored node
 * reaches `KanbanRenderer` through the registry.
 *
 * The CLASS is closed as well, at the boundary: since objectui#8818
 * `objectFields` is on `SchemaRenderer`'s stripped-metadata list, and the
 * legacy `props` alias bag drops it too, so an authored value reaches no
 * component prop on any type key, whichever renderer declares the prop next.
 *
 * Pinned in `src/__tests__/kanban-family-registry-keys-retired-8257.test.ts`.
 */

/**
 * Standard Export Protocol — for manual integration.
 *
 * ⛔ The `kanban`, `kanban-enhanced` and `kanban-ui` keys are RETIRED
 * (objectui#8802 / objectui#8257, maintainer rulings 2026-09-09), so this map
 * publishes the one surviving spelling. A host that mounted the retired keys
 * from here was re-teaching them under its own registry; `object-kanban` is the
 * key to mount.
 */
export const kanbanComponents = {
  'object-kanban': ObjectKanban,
};

/**
 * ⛔ The `kanban-enhanced` node type key is RETIRED (objectui#8257, maintainer
 * ruling 2026-09-09) — the card's own subject.
 *
 * ## What went, and what went with it
 *
 * The registration read `onColumnToggle`, `enableVirtualScrolling` and
 * `virtualScrollThreshold` off `schema` and declared them as `inputs`, while
 * `@object-ui/types` declared no `kanban-enhanced` arm at all: the type was
 * dispatched by the registry and validated by nothing but `BaseSchema`'s
 * passthrough. ⇒ Re-measured on this branch and CONFIRMED rather than assumed:
 * with the registration gone those three keys have NO authorable surface left
 * anywhere in the repo — 0 declarations on any schema face, 0 remaining
 * `inputs` entries, 0 read sites (firing control on the same instrument:
 * `groupBy`, which keeps 1 declaration + read sites on the surviving
 * `object-kanban` face). objectui#8257's question is resolved by the removal of
 * its subject, not by an answer.
 *
 * ## The measurement the ruling was taken on
 *
 * `kanban-enhanced` was authored 0 times in JSON and 0 times in TS/TSX, against
 * the same firing control (`object-grid`, 2 JSON / 128 TS) and silent control
 * (`zzz-not-a-type`, 0) the `kanban-ui` note above cites.
 *
 * `KanbanEnhanced` was NOT, and never had been, reachable from outside this
 * package: `package.json` `exports` publishes exactly two entries — `.` and
 * `./style.css` — and this barrel never re-exported the component, so
 * `@object-ui/plugin-kanban/KanbanEnhanced` was never a resolvable specifier
 * for a consumer. (An earlier revision of this note claimed it was; that claim
 * was wrong and is corrected here rather than deleted, because it is what a
 * reader would otherwise copy.) What this card removed is the registry key and
 * the `React.lazy` wrapper that existed only to serve it. It left the module
 * itself on disk, with zero non-test importers, because deleting published
 * source is a further narrowing that needed its own maintainer ruling.
 *
 * ⚠️ That ruling came: objectui#8932 (2026-09-11, ratified 2026-09-24) deleted
 * `KanbanEnhanced.tsx`, the two test references it had left, and with them the
 * `dist/KanbanEnhanced.d.ts` typings the package still emitted for it. (Through
 * 17.6.0 the component itself was also bundled into `dist/index.js`, behind the
 * `kanban-enhanced` key; it left the bundle with this card's retirement.)
 *
 * Pinned in `src/__tests__/kanban-family-registry-keys-retired-8257.test.ts`
 * (the key) and `src/__tests__/kanbanEnhancedRetired-8932.test.ts` (the file).
 */

/**
 * What `ObjectKanban` reads for its own query: `objectName`, `filter`, `sort`
 * and `limit` (`ObjectKanban.tsx`, the `dataSource.find` call — `$filter:
 * schema.filter`, `$orderby: convertSortToQueryParams(schema.sort)`, `$top:
 * resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE)`).
 *
 * `limit` was unmapped until objectui#4025, on the rationale that the board
 * "fetches with a fixed `$top: 100`, so there is no key to write it to". That
 * rationale was false in a way nobody could see from here: the cap was written
 * `{ options: { $top: 100 } }`, and `options` is not a `QueryParams` key — no
 * adapter reads it, so the window was not fixed, it did not exist. #4025 moved
 * the cap to a real top-level `$top` and made it read `schema.limit`, so the
 * flag comes with the read site (the order `object-timeline` did it in, #4009)
 * and a bound view's `pagination.pageSize` now actually caps the board.
 *
 * Still deliberately NOT mapped:
 *
 * - `columns` — a board's `columns` are its SWIMLANES (`{ id, title }` per
 *   `groupBy` value), not a field projection; a saved view's field list written
 *   there would render one empty lane per field name.
 *
 * `sort` IS mapped (objectui#10068). The binding declares it for every element
 * (`ELEMENT_DATA_SOURCE_INPUT`, the spec's `ElementDataSourceSchema`), and it
 * used to be accepted here and dropped: the board fetched with no `$orderby`.
 * The fetch now lowers it onto `$orderby` the way every sibling block does
 * (`convertSortToQueryParams`), so the order is the server's. Lanes keep that
 * order: records are bucketed by `groupBy` in fetch order and nothing re-sorts
 * a lane. There is no manual in-lane rank to contend with — a same-lane drop
 * persists nothing and the board claims no position (objectui#8826).
 *
 * ⚠️ `schema.sort` is the GATE's carrier for `dataSource.sort`, not an authoring
 * key on this block: the spec's `object-kanban` props declare no top-level
 * `sort` and refuse one, and neither `ObjectKanbanSchema` face declares it.
 */
const OBJECT_KANBAN_DATA_SOURCE: ElementDataSourceMapping = {
  filter: true,
  sort: true,
  limit: 'limit',
};

/** Does an authored `columns` list carry lanes with their own `cards`? */
const lanesCarryCards = (columns: unknown): boolean =>
  Array.isArray(columns) && columns.some((column) => Array.isArray((column as { cards?: unknown } | null)?.cards));

// Register object-kanban for ListView integration
export const ObjectKanbanRenderer: React.FC<{ schema: any; [key: string]: any }> = elementDataSourceBlock(({ schema, ...props }) => {
  // `useSchemaContext()` may hand back a NULL adapter: a host with nothing
  // bound spells absence either way, and the seam declares both
  // (`DataSource | null | undefined`, objectui#7912). The widget below
  // declares the single spelling `dataSource?: DataSource`, so collapse the
  // two absences into that one here rather than widening the widget.
  const { dataSource: contextDataSource } = useSchemaContext() || {};
  const dataSource = contextDataSource ?? undefined;
  // The spec's `PageComponentSchema.dataSource` binding (objectstack#6953):
  // before this, a board authored with `dataSource: { object, view }` and no
  // `objectName` never fetched — the effect is gated on `schema.objectName` —
  // so it rendered its declared lanes with no cards and no error.
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={schema}
      mapping={OBJECT_KANBAN_DATA_SOURCE}
      dataSource={dataSource}
      testId="object-kanban"
      errorTitle={t('element.board.sourceUnresolved', {
        defaultValue: 'This board’s data source could not be resolved',
      })}
      // A board that names its object in neither place has nothing to fetch,
      // and drew an empty board with "No cards" — the answer an empty query
      // gives (objectui#11605). Every other rung of the board's record-source
      // ladder supplies rows without an object: records a parent view hands
      // down (`data` prop), a `bind` path, and inline `data` (an empty array is
      // a static board, so presence is the test, not length). So do lanes that
      // carry their own `cards`, which the board keeps ("Preserve static cards"
      // in the column merge above).
      requiresObject={
        schema?.data == null
        && schema?.bind == null
        && !Array.isArray((props as { data?: unknown }).data)
        && !lanesCarryCards(schema?.columns)
      }
    >
      {(bound) => <ObjectKanban schema={bound} dataSource={dataSource} {...props} />}
    </ElementDataSourceGate>
  );
});

/**
 * The authoring surface both `ObjectKanbanRenderer` tags publish, spelled ONCE
 * and spread into both registrations (objectui#8201).
 *
 * ## Why it is shared rather than hand-copied
 *
 * `object-kanban` and `view:kanban` are the SAME renderer, so the only way the
 * two lists could ever disagree is a hand-copy that missed one — which is
 * precisely what this card found: `filter` reached both because objectui#8186
 * edited both, but nothing structural said it had to.
 *
 * ## Why these keys were added
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-kanban']` carries FIFTEEN
 * top-level keys on the installed 18.1.0 pin, fourteen of them live, the
 * same set as 17.5.0 through 17.7.0: 17.5.0
 * added `navigation` and turned `quickAdd` into a tombstone (typed `never`,
 * refused by name — objectui#8285's ruled retirement, landed). This list
 * published three until objectui#8186 added `filter`. ⚠️ The shape carried
 * THIRTEEN when objectui#8201 was filed and FOURTEEN through 17.4.0, which
 * added `limit` (see below). Each number is correct about its own spec
 * version, which is why this one names its version.
 * The gap was STRUCTURAL rather than considered — the console registers this
 * block with `ComponentRegistry.registerLazy` and `getConfig` is loaded-only by
 * design, so the block sat outside the console's reverse-parity population
 * entirely until objectui#8176 loaded it. objectui#8201 asked the per-key
 * question that census never got to ask.
 *
 * Each key below was measured against a read site that CHANGES BEHAVIOUR on the
 * `ObjectKanban` path — not a mention, and not a read site belonging to the
 * sibling `kanban-ui` block, which is a different renderer with a different
 * declared surface:
 *
 *   - `groupBy` — `ObjectKanban.tsx` materializes the lanes from this field's
 *     picklist options, `bucketCardsIntoColumns` buckets records by its value,
 *     and a drag between lanes writes the new value back to the record.
 *   - `cardTitle` / `titleField` — one choice with two spellings, `cardTitle`
 *     first; it selects the record field rendered as the card title.
 *   - `swimlaneField` — becomes `effectiveSchema.swimlaneField`, which
 *     `KanbanImpl` splits the board into horizontal swimlanes on (and keys its
 *     per-lane collapsed-state storage by).
 *   - `coverImageField` — `bucketCardsIntoColumns` maps it onto each card's
 *     `coverImage`, which `KanbanImpl` renders as the card's `<img>`.
 *
 * objectui#8313 added the four ARRAY/OBJECT-armed keys the same census left
 * behind. Each was measured at ITS OWN SINK rather than assumed to share one,
 * because the four sinks answer four different questions and only one of them
 * is a pass-through:
 *
 *   - `data` — read TWICE, and the two reads differ. As a GATE it SUPPRESSES
 *     the board's own query; as a VALUE, `rawData = external || boundData ||
 *     schema.data || fetchedData` selects it and `effectiveData` REBUILDS every
 *     member into a card, so it is not a pass-through and no identity claim is
 *     true of it. ⚠️ The gate is DOUBLY guarded on the authored-node path, and
 *     naming only one guard would be wrong: `SchemaRenderer` spreads
 *     non-metadata schema properties as React props, so an authored `data`
 *     arrives as `schema.data` AND as this component's `data` prop — which
 *     makes `hasExternalData` true and returns from the fetch effect at its
 *     first line, BEFORE `if (schema.objectName && !boundData && !schema.data)`
 *     is reached. Measured, not reasoned: removing either guard alone leaves
 *     the query suppressed and the member pin green; removing both makes the
 *     board query and reddens both of its gate rows by name.
 *   - `cardFields` — `resolveKanbanCardFields(schema.cardFields, objectDef)`,
 *     exported and pure. It answers WHICH FIELD NAMES the author chose, which
 *     is a different question from which cells a card ends up carrying: the
 *     card loop further drops a name that duplicates the title and one whose
 *     value is empty. Both are measured; the pin says which row is which.
 *   - `grouping` — one nested position and no more:
 *     `schema.grouping?.fields?.[0]?.field` is the FALLBACK for
 *     `swimlaneField`. Everything else inside `grouping`, later `fields`
 *     entries included, is inert on this board — which is why the declared
 *     description says so rather than implying a shape the board does not read.
 *   - `conditionalFormatting` — the only one this file reads NOWHERE.
 *     `ObjectKanban.tsx` never names it (measured: zero occurrences, against
 *     nine for `cardFields` in the same file); it travels on the
 *     `{ ...schema }` spread into `effectiveSchema` and then into
 *     `KanbanRenderer`, which forwards it to `KanbanImpl`'s `getCardStyles`.
 *     An edit replacing that spread with an explicit key list would drop the
 *     key silently, and the member pin is the only thing that would notice.
 *
 * ## What declaring them widens, and on what grounds (clause ②)
 *
 * Declaring an input WIDENS the authoring surface, so the grounds are stated
 * rather than assumed. They are the same grounds objectui#8186 (`filter`) and
 * objectui#8223 (`sort`) cleared on: the SPEC already declares all five and the
 * RENDERER already honours all five, so this restores `declared = enforced`
 * instead of publishing anything new. Measured with a control on the same
 * `safeParse` call — because "the spec declares it" is an assumption
 * objectui#8172 once falsified for `limit`: four faces taught the key and the
 * strict `ComponentPropsMap` refused it BY NAME. ⚠️ That reading is HISTORY as of
 * @objectstack/spec 17.4.0. objectstack#16503 (landed as objectstack#16562)
 * added `limit: z.number().int().positive().optional()` to
 * `ComponentPropsMap['object-kanban']` — the maintainer's option-A ruling on
 * objectui#8172, the contract catching up with a capability that was already
 * implemented, typed, mapped and documented — so `limit` is DECLARED below with
 * the others. Re-measured here rather than inherited: all four faces now agree
 * (renderer `$top: schema.limit ?? DEFAULT_KANBAN_LIMIT`; BOTH `@object-ui/types`
 * faces, TS and zod; `content/docs/plugins/plugin-kanban.mdx`; the spec).
 * ⛔ The declaration carries NO default: a materialised `limit` would defeat the
 * gate's `readLimit(base) === undefined` branch, and a bound view's
 * `pagination.pageSize` would then never fill it. `DEFAULT_KANBAN_FETCH_BATCH_SIZE = 100`
 * stays documented rather than declared. An unrecognised probe key draws
 * `unrecognized_keys` on these calls while none of the declared keys does.
 *
 * ## `navigation` — objectui#8652 (maintainer ruling 「B」)
 *
 * The spec declares it on this element from 17.5.0 — the platform half of
 * the ruling, which the 17.5.0 bump booked as OWED to objectui#8652 rather than
 * declaring (objectui#11111 decision 3 = B). This entry is the objectui half,
 * together with the `ObjectKanbanSchema` member in `@object-ui/types`. The
 * board honours the block through `useNavigationOverlay`, member by member —
 * an overlay `mode`, `new_window`, `none`, `preventNavigation`, `openNewTab`,
 * `size`, and since objectui#11293 `page`, which is also what a block without
 * `mode` resolves to: the hook hands a `page` click with no `onNavigate` to
 * the record navigator the host publishes, so the description no longer warns
 * that `page` opens nothing. It states where `page` has no record page to
 * open instead — a host that publishes no navigator. Members pinned in
 * `__tests__/kanbanNavigationMembers-8652.test.tsx`.
 *
 * ## What is deliberately NOT here
 *
 * `quickAdd`, the fifteenth key, is RETIRED rather than undeclared-pending
 * (objectui#8285, director seat 2026-09-08, decision batch #91, ruling B: the
 * board does not grow an inline record-creation write path). It never drew
 * anything on this block — `KanbanImpl` gates the control on `quickAdd &&
 * onQuickAdd`, and `onQuickAdd` is a host-supplied function nothing on the
 * `ObjectKanban` path supplies — so publishing it here would advertise
 * configuration this renderer drops. The spec tombstones it in 17.5.0, and both
 * `ObjectKanbanSchema` faces refuse it by name. `ObjectKanban` no longer
 * forwards it: it renders the internal `KanbanBoardCore`, which takes the pair
 * only as explicit props, and it supplies neither half. Since objectui#11234
 * that holds for `onQuickAdd` too, which is now a tombstone on both faces.
 * `KanbanRenderer` above keeps the pair for a React host that mounts it
 * directly. Pinned in `__tests__/quickAddRetiredNotForwarded-8285.test.tsx`,
 * whose registration row also asserts this list still leaves it out.
 *
 * The declarations are pinned per tag and per key, so removing one from this
 * list reddens a NAMED row rather than a file:
 * `__tests__/scalarKeysAreDeclaredAndHonoured-8201.test.ts` for the five scalar
 * keys, `__tests__/structuredKeysAreDeclaredAndHonoured-8313.test.ts` for the
 * four array/object-armed ones. The MEMBER shape of those four — the second
 * obligation objectui#8212 created, which a declaration pin cannot carry — is
 * `__tests__/ObjectKanban.structuredMembersReachTheirSinks-8313.test.tsx`.
 */
const OBJECT_KANBAN_INPUTS: ComponentInput[] = [
  // NOT required, as on the spec row (objectui#11605): `ComponentPropsMap
  // ['object-kanban']` leaves `objectName` optional "because the
  // component-level `dataSource` binding can supply the object instead", and
  // the gate in `ObjectKanbanRenderer` lands `dataSource.object` here. The page
  // compile reads this list, so `required: true` refused a bound node the row
  // and the renderer accept. A node with neither is answered by the gate's
  // "no object named" hint (`requiresObject` above).
  {
    name: 'objectName',
    type: 'string',
    description:
      'Object this board lists. Not required: the node\'s `dataSource` binding can name the object instead, and `dataSource.object` lands on this key, outranking an authored value. With neither, and no rows from `data`, `bind` or a parent view, the board shows a hint naming this key instead of an empty board.',
  },
  { name: 'columns', type: 'array' },
  { name: 'filter', type: 'array', description: 'Base query filter — the `ViewFilterRule` array `[{ field, operator, value }, ...]`, narrowing the records the board fetches. Lowered to `$filter` on the query.' },
  { name: 'limit', type: 'number', description: 'Row cap — the most records the board fetches, lowered to the query’s top-level `$top` (renderer default 100). The board renders every fetched record into a lane and offers no pagination, so this is the author’s window on the object rather than a page size. PRECEDENCE: a node-level `dataSource` binding’s own `limit` wins outright; the `pagination.pageSize` of a view that binding names fills this key only when the node leaves it unset.' },
  { name: 'groupBy', type: 'string', description: 'Record field whose value buckets cards into lanes. Its picklist options become the lanes when `columns` is absent, and a drag between lanes writes the target lane’s value back to the record. A value matching no lane lands in the trailing “Uncategorized” lane rather than disappearing.' },
  { name: 'cardTitle', type: 'string', description: 'Record field rendered as the card title. Read AHEAD of `titleField`, which is the legacy spelling of the same choice; when neither yields a value the shared record-display resolver names the card.' },
  { name: 'titleField', type: 'string', description: 'Legacy spelling of `cardTitle` — the record field rendered as the card title. `cardTitle` wins when both are authored.' },
  { name: 'swimlaneField', type: 'string', description: 'Record field that splits the board into horizontal swimlanes. When absent the board falls back to `grouping.fields[0].field`.' },
  { name: 'coverImageField', type: 'string', description: 'Record field holding a card cover image — a URL string, or a file object carrying a `url`. Any other value leaves the card without a cover.' },
  { name: 'data', type: 'array', description: 'Inline records to render instead of fetching. Authoring it SUPPRESSES the board’s own query entirely. Members are records: the board reads `id` (or `_id`) as the card identity, the `groupBy` field’s value as the lane, the card-title field, `coverImageField`, and every `cardFields` entry. Records handed down by a parent view and a `bind` expression both take priority over it.' },
  { name: 'cardFields', type: 'array', description: 'Record field NAMES rendered as cells on each card, in the order written. Members are bare names, not entry objects. An explicit list wins over the object’s `highlightFields` role; unlike that fallback it is NOT filtered against the object definition, so a name the object no longer declares simply renders no cell. An empty array reads as omitted.' },
  { name: 'grouping', type: 'object', description: 'Only `grouping.fields[0].field` is read, and only as the FALLBACK for `swimlaneField`: it names the record field that splits the board into horizontal swimlanes when no `swimlaneField` is authored. An explicit `swimlaneField` wins. Every other position inside `grouping`, later `fields` entries included, is inert on this board.' },
  { name: 'conditionalFormatting', type: 'array', description: 'Per-card style rules, each `{ condition, style }` — a CEL `condition` over the card’s own `record.*` and a CSS `style` map, the rule a list view declares. The first matching rule styles that card alone. A rule comparing a relation field sees the stored foreign key rather than the expanded record. The native `{ field, operator, value }` rule and a colour written beside `condition` instead of inside `style` are retired and refused by name (objectui#11522).' },  { name: 'navigation', type: 'object', description: 'What a card click opens — the `{ mode, size, openNewTab, preventNavigation }` block a list view declares. With the key ABSENT a click opens the record in a drawer. `mode` is an overlay (`drawer`, `modal`, `split`, `popover`), `new_window`, `page` or `none`, and a block written without `mode` takes the spec’s `page` default. `page` opens the record page through the record navigator the host publishes (the console publishes one on its custom pages, record pages and list views); under a host that publishes none, such as an embedded renderer, there is no record page to open and the click opens nothing. `openNewTab: true` opens the record page in a new tab and outranks every mode except `none`, `preventNavigation: true` opens nothing, and `size` sets the overlay width. A click handler from a parent view outranks the whole key.' },
];

ComponentRegistry.register(
  'object-kanban',
  ObjectKanbanRenderer,
  {
    namespace: 'plugin-kanban',
    label: 'Object Kanban',
    category: 'view',
    inputs: [...OBJECT_KANBAN_INPUTS],
  }
);
/**
 * ⛔ The bare `kanban` node type key is RETIRED (objectui#8802, maintainer
 * ruling 2026-09-09: 「从我们的业务需求角度，我应该只需要 `object-kanban`」).
 * `object-kanban` above is the one spelling this plugin serves.
 *
 * ## What this dissolves rather than patches
 *
 * The two published faces of this key returned OPPOSITE verdicts on the same
 * document: the registry `inputs` above (shared into both registrations by
 * objectui#8201) declared `titleField`, while the `kanban` Zod arm refused it
 * BY NAME after batch #70. With the key gone there is no arm left to disagree
 * with — objectui#8802's four options are all moot.
 *
 * ## ⚠️ Unlike its `gantt` / `kanban-ui` / `kanban-enhanced` siblings, this one
 * had a DECLARED FACE, so unregistering is only half of it
 *
 * `@object-ui/types` declared `KanbanSchema` with `type: 'kanban'` and mirrored
 * it in `zod/complex.zod.ts`. A plain deletion there would have been the
 * objectui#7664 failure: `BaseSchema` is `.passthrough()`, so a document naming
 * a dropped spelling validates GREEN and renders nothing. The Zod arm is
 * therefore a NAMED REFUSAL (`retiredNodeType()`, `zod/tombstone.zod.ts`)
 * pointing the author at `object-kanban`, and the TS face leaves `ComplexSchema`
 * and `SchemaRegistry` so `tsc` refuses the literal at the authoring site.
 *
 * ## ⛔ Two layers, and only one of them moved
 *
 * `kanban` is ALSO a STORED `NamedListView.type` — the value `CreateViewDialog`
 * writes and every tenant's database holds. That layer is untouched:
 * `packages/plugin-view/src/ObjectView.tsx`'s `switch (viewType)` already emits
 * `object-kanban` for a stored `kanban` view, as it emits `object-*` for all
 * twelve view types. ⇒ Every kanban view any user ever created through the
 * console already renders through the surviving spelling; this retirement moves
 * zero stored documents.
 *
 * Pinned in `src/__tests__/kanban-family-registry-keys-retired-8257.test.ts`
 * and `@object-ui/types`' `__tests__/bare-kanban-node-key-retired-8802.test.ts`.
 */
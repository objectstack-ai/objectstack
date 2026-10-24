/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Data Display Component Schemas
 * 
 * Type definitions for components that display data and information.
 * 
 * @module data-display
 * @packageDocumentation
 */

import type {
  ChartAxis as SpecChartAxis,
  ChartType as SpecChartType,
  I18nLabel,
  // The spec's report AUTHOR shape (`z.input` of `ReportSchema`; `spec-report.ts`
  // re-exports the same type as `SpecReportInput`), for `DrillDownConfig.report`.
  Report as SpecReportInput,
} from '@objectstack/spec/ui';
import type { BaseSchema, SchemaNode } from './base.js';
import type { BreadcrumbSchema } from './navigation.js';

/**
 * Alert component
 */
export interface AlertSchema extends BaseSchema {
  type: 'alert';
  /**
   * Alert title
   */
  title?: string;
  /**
   * Alert description/message
   */
  description?: string;
  /**
   * Alert variant
   * @default 'default'
   */
  variant?: 'default' | 'destructive';
  /**
   * Alert icon
   */
  icon?: string;
  /**
   * Whether alert is dismissible
   */
  dismissible?: boolean;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `alert` renderer spreads it onto the `<Alert>` element, which has no such
   * event (React attaches nothing). The zod twin refuses it by name; author
   * behaviour as a node type (`{ "type": "toast" }`, an `action:button` node)
   * instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onDismiss?: never;
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049; INVERTED by objectui#6771) —
   * `alert` reads `children`, and no renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read): the `schema.children` read in
   * `packages/components/src/renderers/data-display/alert.tsx`. The same sweep
   * finds zero `body` reads for this node type.
   *
   * ⚠️ THIS MEMBER SWAPPED SIDES, and the principle did not. objectui#8284
   * tombstoned `children` here, because `body` was then the only key this
   * renderer read — `alert` was one of the dozen registrations for which
   * `body` was the ONLY door. objectui#6771 retired that spelling across the
   * protocol, the renderer converged on `children`, and the tombstone follows
   * the read: the channel a renderer does not read is refused by name, on both
   * published faces (maintainer ruling, summon #17 decision batch #2,
   * 2026-09-07). Which key that is changed; the rule did not.
   *
   * @deprecated Not a channel `alert` reads — author `children`.
   */
  body?: never;
}

/**
 * Statistic component for dashboards
 */
export interface StatisticSchema extends BaseSchema {
  type: 'statistic';
  /**
   * The label/title of the statistic (e.g. "Total Revenue")
   */
  label?: string;
  /**
   * The main value (e.g. "$45,231.89")
   */
  value: string | number;
  /**
   * Optional trend indicator
   */
  trend?: 'up' | 'down' | 'neutral';
  /**
   * Additional description (e.g. "+20.1% from last month")
   */
  description?: string;
  /**
    * Optional icon name
    */
  icon?: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `statistic` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `description`, `icon`, `label`, `trend`, `value` (in
   * `packages/components/src/renderers/data-display/statistic.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `statistic` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `statistic` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `description`, `icon`, `label`, `trend`, `value` (in
   * `packages/components/src/renderers/data-display/statistic.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `statistic` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Badge component
 */
export interface BadgeSchema extends BaseSchema {
  type: 'badge';
  /**
   * Badge text
   */
  label?: string;
  /**
   * Badge variant
   * @default 'default'
   */
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  /**
   * Badge icon
   */
  icon?: string;
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049; INVERTED by objectui#6771) —
   * `badge` reads `children`, and no renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read): the `schema.children` read in
   * `packages/components/src/renderers/data-display/badge.tsx`. The same sweep
   * finds zero `body` reads for this node type.
   *
   * ⚠️ THIS MEMBER SWAPPED SIDES, and the principle did not. objectui#8284
   * tombstoned `children` here, because `body` was then the only key this
   * renderer read — `badge` was one of the dozen registrations for which
   * `body` was the ONLY door. objectui#6771 retired that spelling across the
   * protocol, the renderer converged on `children`, and the tombstone follows
   * the read: the channel a renderer does not read is refused by name, on both
   * published faces (maintainer ruling, summon #17 decision batch #2,
   * 2026-09-07). Which key that is changed; the rule did not.
   *
   * @deprecated Not a channel `badge` reads — author `children`.
   */
  body?: never;
}

/**
 * Avatar component
 */
export interface AvatarSchema extends BaseSchema {
  type: 'avatar';
  /**
   * Image source URL
   */
  src?: string;
  /**
   * Alt text
   */
  alt?: string;
  /**
   * Fallback text (initials)
   */
  fallback?: string;
  /**
   * Avatar size
   * @default 'default'
   */
  size?: 'sm' | 'default' | 'lg' | 'xl';
  /**
   * Avatar shape
   * @default 'circle'
   */
  shape?: 'circle' | 'square';
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `avatar` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `alt`, `fallback`, `src` (in
   * `packages/components/src/renderers/data-display/avatar.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `avatar` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `avatar` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `alt`, `fallback`, `src` (in
   * `packages/components/src/renderers/data-display/avatar.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `avatar` reads — nothing renders it.
   */
  children?: never;
}

/**
 * List component
 */
export interface ListSchema extends BaseSchema {
  type: 'list';
  /**
   * Heading drawn above the list.
   *
   * READ SITE: `packages/components/src/renderers/data-display/list.tsx`, which
   * draws `schema.title` in an `h3` above the list when it is set; the `list`
   * registration publishes it as an input. Undeclared until objectui#11347,
   * surviving only on `BaseSchema`'s index signature. The installed
   * `@objectstack/spec` has no row for `list`, and the published
   * `skills/objectui` expressions guide authors `title` on a `list` node, so
   * the key is declared where the renderer and the registry already honour it
   * rather than retired.
   */
  title?: string;
  /**
   * List items — the entries drawn when {@link BaseSchema.bind} resolves no
   * array.
   *
   * READ SITE: `packages/components/src/renderers/data-display/list.tsx`, which
   * reads `useDataScope(schema.bind)` FIRST and falls back to this member only
   * when the bound value is not an array (`Array.isArray(schema.items)`, so the
   * read is guarded).
   *
   * Optional since objectui#11405. It was REQUIRED, so a bind-only `list` —
   * which draws one entry per element of the bound array — was refused by both
   * published faces and could not be annotated with its own type. The
   * requirement the renderer really has, at least one of `bind` / `items`
   * present (⛔ not exactly one: `items` is the fallback beside `bind`), lives
   * on the mirror as a refinement (`listHasAnEntrySource` in
   * `zod/data-display.zod.ts`, keyed `LIST_ENTRIES_REQUIRED`), so the published
   * declaration and the published validator say the same thing.
   */
  items?: ListItem[];
  /**
   * Whether list is ordered
   * @default false
   */
  ordered?: boolean;
  /**
   * List item dividers
   * @default false
   */
  dividers?: boolean;
  /**
   * Dense/compact layout
   * @default false
   */
  dense?: boolean;
  /**
   * Classes on the wrapper `div` around the title and the list.
   *
   * READ SITE: `packages/components/src/renderers/data-display/list.tsx` —
   * `cn("space-y-2", schema.wrapperClass)`. Undeclared until
   * objectui#7722, surviving only on `BaseSchema`'s index signature: the same
   * key, on the same class of read, that `CheckboxSchema` (`b74a8598d`),
   * `FileUploadSchema` and `FilterBuilderSchema` (objectui#6150) declare.
   * Distinct from `className`, which the renderer hands to the `ul` / `ol`.
   */
  wrapperClass?: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `list` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program built from the repo-root `tsconfig.json` on a BUILT tree — an
   * unbuilt tree resolves a workspace package to `any`, and `any` reads as
   * NEITHER, which is the shape that hides a hit. A docblock mention is not an
   * AST node and `schema.bodyExtra` is a different property, so neither can
   * score. Every read is filed under the DECLARED TYPE of the object it is read
   * from; this declaration carries none. What the renderer DOES read off this
   * node, from the same instrument: `bind`, `items`, `ordered`, `title`,
   * `wrapperClass` (in `packages/components/src/renderers/data-display/list.tsx`).
   *
   * ⭐ THE ITEM CHANNEL IS A DIFFERENT KEY AND STAYS LIVE. That renderer draws
   * each entry from its `content` (`renderChildren(item.content)`) — a read filed
   * under {@link ListItem}, NOT under this node, and `content` is neither of the
   * two node channels refused here. Until objectui#9590 that read fell back to an
   * item-level `body`; an instrument that attributed THAT read here would have
   * made `list` a `body` reader and this tombstone a mistake, so the item channel
   * is pinned as still live in `__tests__/content-channel-family-d-9256.test.ts`.
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9544, AND WHAT CHANGED. It was
   * held for a SERIAL constraint, ⛔ never a verdict: this file was being
   * edited by another slice. Ownership is separately measured —
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:list`
   * as the SOLE claimant of the bare `list` key, because `view:list` in
   * `packages/plugin-list` passes `skipFallback: true`. Re-derive from that
   * instrument rather than from this sentence. ⚠️ Ownership and readership are
   * DIFFERENT questions: settling who owns a bare key does not license a
   * tombstone, and reading the one for the other is what would have narrowed
   * `button`, which reads both channels live.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `list` reads — nothing renders it. Author the
   * rows as `items`, whose entries carry `content`.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `list` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program built from the repo-root `tsconfig.json` on a BUILT tree — an
   * unbuilt tree resolves a workspace package to `any`, and `any` reads as
   * NEITHER, which is the shape that hides a hit. A docblock mention is not an
   * AST node and `schema.bodyExtra` is a different property, so neither can
   * score. Every read is filed under the DECLARED TYPE of the object it is read
   * from; this declaration carries none. What the renderer DOES read off this
   * node, from the same instrument: `bind`, `items`, `ordered`, `title`,
   * `wrapperClass` (in `packages/components/src/renderers/data-display/list.tsx`).
   *
   * ⭐ THE ITEM CHANNEL IS A DIFFERENT KEY AND STAYS LIVE. That renderer draws
   * each entry from its `content` (`renderChildren(item.content)`) — a read filed
   * under {@link ListItem}, NOT under this node, and `content` is neither of the
   * two node channels refused here. Until objectui#9590 that read fell back to an
   * item-level `body`; an instrument that attributed THAT read here would have
   * made `list` a `body` reader and this tombstone a mistake, so the item channel
   * is pinned as still live in `__tests__/content-channel-family-d-9256.test.ts`.
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9544, AND WHAT CHANGED. It was
   * held for a SERIAL constraint, ⛔ never a verdict: this file was being
   * edited by another slice. Ownership is separately measured —
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:list`
   * as the SOLE claimant of the bare `list` key, because `view:list` in
   * `packages/plugin-list` passes `skipFallback: true`. Re-derive from that
   * instrument rather than from this sentence. ⚠️ Ownership and readership are
   * DIFFERENT questions: settling who owns a bare key does not license a
   * tombstone, and reading the one for the other is what would have narrowed
   * `button`, which reads both channels live.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `list` reads — nothing renders it. Author the
   * rows as `items`, whose entries carry `content`.
   */
  children?: never;
}

/**
 * List item
 */
export interface ListItem {
  /**
   * Unique item identifier
   */
  id?: string;
  /**
   * Item label/title
   */
  label?: string;
  /**
   * Item description
   */
  description?: string;
  /**
   * Item icon
   */
  icon?: string;
  /**
   * Item avatar image
   */
  avatar?: string;
  /**
   * Whether item is disabled
   */
  disabled?: boolean;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `list` renderer renders each item as `<li>{content}</li>` and never reads
   * it. The zod twin refuses it by name; author behaviour as a node type (`{
   * "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onClick?: never;
  /**
   * Item content — THE item's content key. A string is placed as-is; a node or
   * an array of nodes renders through `SchemaRenderer` (objectui#9590).
   */
  content?: SchemaNode | SchemaNode[];
  /**
   * RETIRED (objectui#9590) — author `content`.
   *
   * The `list` renderer used to fall back to an item-level `body` when
   * `content` was missing, and that fallback was the only way a node rendered
   * inside an item, because `content` was placed as a raw React child. This
   * face never declared `body`. The renderer now draws `content` through
   * `renderChildren`, the fallback is gone, and the key is refused by name:
   * `tsc` here, and `ListItemSchema`'s alias refusal naming `content` at parse.
   *
   * @deprecated Retired item-level spelling of `content` — author `content`.
   */
  body?: never;
}

/**
 * One key of a table's sort order.
 *
 * Structurally the id-less half of `SortItem` in `@object-ui/components` (whose
 * `id` exists only as a React key for the sort-builder rows), so a `SortItem[]`
 * is assignable here without conversion. This package takes no dependencies, so
 * the shared shape is declared rather than imported.
 */
export interface TableSortItem {
  /** Field to sort by — an `accessorKey` of the table's columns. */
  field: string;
  order: 'asc' | 'desc';
}

/**
 * Every `type` spelling a `TableColumn` may carry — the canonical value set for
 * this key (`fc62bb490`, maintainer ruling 2026-08-25, Option B: the 8-literal
 * interface union is canonical).
 *
 * This tuple is the SINGLE declaration of that vocabulary. `TableColumnSchema`
 * in `zod/data-display.zod.ts` builds its `z.enum` from this array rather than
 * restating the members, so the interface and the validator cannot drift apart
 * the way they had (the interface declared these 8; the mirror was a bare
 * `z.string()` that blessed `type: 'money'` and any other typo).
 */
export const TABLE_COLUMN_TYPES = [
  'text', 'number', 'date', 'datetime', 'currency', 'percent', 'boolean', 'action',
] as const;

/** Data type a table column is formatted/edited as. */
export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

/**
 * Undeclared `type` spellings the data-table renderer used to read, folded onto
 * the canonical spelling they mean (`fc62bb490`).
 *
 * These are NOT part of the published vocabulary and deliberately do not appear
 * in {@link TABLE_COLUMN_TYPES}: the ruling rejected alias proliferation, so the
 * renderer's extra dialect DISAPPEARS at the producer seam instead of getting
 * declared. `int` / `integer` / `float` / `double` were members of the
 * data-table's `NUMERIC_EDIT_TYPES`; `datetime-local` had its own editor branch.
 * Same treatment, and the same wording, as the param-type dialect documented at
 * {@link ObjectUiLocalParamFieldType} in `ui-action.ts` (`datetime-local` →
 * `datetime` there too).
 *
 * Authoring one of these is refused by `TableColumnSchema` — the fold exists for
 * VALUES IN FLIGHT from a column-inference producer, not for authored metadata.
 */
const TABLE_COLUMN_TYPE_ALIASES: Readonly<Record<string, TableColumnType>> = {
  int: 'number',
  integer: 'number',
  float: 'number',
  double: 'number',
  'datetime-local': 'datetime',
};

/**
 * Fold an inferred column type onto the canonical {@link TableColumnType}
 * vocabulary, for use at a producer's emit seam (`fc62bb490`).
 *
 * Column inference reads an OBJECT SCHEMA's field type, whose vocabulary is
 * `@objectstack/spec`'s `FieldType` — 49 values, only 7 of which are members of
 * this union. Forwarding that verbatim into `TableColumn.type` is what made the
 * declaration a lie and forced an `as any` cast in the renderer. Producers call
 * this at the point they hand columns to `data-table`, so the slot only ever
 * holds a value it declares.
 *
 * Three outcomes, and the third is the load-bearing one:
 *
 * - a canonical spelling passes through unchanged;
 * - a known alias folds onto its canonical spelling (`int` → `number`);
 * - ⭐ ANYTHING ELSE yields `undefined` — the `type` ANNOTATION is dropped, and
 *   the COLUMN IS NEVER DROPPED. This is the general case, and it is where the
 *   42 out-of-union spec field types (`select`, `lookup`, `user`, `file`,
 *   `formula`, …) land. Dropping the annotation is behaviour-preserving at the
 *   only consumer that reads this key: `data-table`'s inline editor branches on
 *   `date` / `datetime` / the numeric set and otherwise falls through to a text
 *   input — which is exactly the `undefined` path. The dedicated widget those
 *   fields DO get is chosen by the host's `renderCellEditor`, which resolves the
 *   field through `column.accessorKey` and never reads `type`. Mapping them to
 *   `'text'` instead would assert something false about a `lookup` column;
 *   absence says only what is true — this column's type is not one of the 8.
 */
export function normalizeTableColumnType(value: unknown): TableColumnType | undefined {
  if (typeof value !== 'string') return undefined;
  if ((TABLE_COLUMN_TYPES as readonly string[]).includes(value)) return value as TableColumnType;
  return TABLE_COLUMN_TYPE_ALIASES[value];
}

/**
 * Table column definition
 */
export interface TableColumn {
  /**
   * Column header text
   */
  header: string;
  /**
   * Key to access data in row object
   */
  accessorKey: string;
  /**
   * Header CSS class
   */
  className?: string;
  /**
   * Cell CSS class
   */
  cellClassName?: string;
  /**
   * Column width
   */
  width?: string | number;
  /**
   * Column minimum width
   */
  minWidth?: string | number;
  /**
   * Text alignment
   * @default 'left'
   */
  align?: 'left' | 'center' | 'right';
  /**
   * Pin column to side
   */
  fixed?: 'left' | 'right';
  /**
   * Data type for formatting
   */
  type?: TableColumnType;
  /**
   * Whether column is sortable
   * @default true
   */
  sortable?: boolean;
  /**
   * Whether column is filterable
   * @default true
   */
  filterable?: boolean;
  /**
   * Whether column is resizable
   * @default true
   */
  resizable?: boolean;
  /**
   * Whether column is editable (for inline editing)
   * @default true
   */
  editable?: boolean;
  /**
   * Custom cell renderer function
   *
   * RUNTIME SLOT (objectui#7759 group E, objectui#6124 shape) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name. Kept callable here because `data-table`
   * calls `col.cell(cellValue, row)` (as do `ObjectGrid` and `VirtualGrid`).
   */
  cell?: (value: any, row: any) => any;
  /**
   * Icon node rendered into the header cell, before the header text (e.g. the
   * column-type icons `ObjectGrid` writes under `showColumnTypeIcons`). A
   * rendered React node — a runtime slot like {@link TableColumn.cell}, not
   * serializable metadata.
   *
   * Declared by objectui#6424 (maintainer ruling 2026-08-27): `data-table`
   * rendered this key while the declaration refused it, so a typed author got
   * a compile error — and a silent strip from the zod mirror — for a key the
   * renderer honours. The declaration, the parse road, and the renderer's
   * behaviour now agree; the renderer's internal column reads remain
   * any-mediated (the `col: any` normalization in `data-table.tsx`) — a
   * standing instrument gap, not closed here.
   */
  headerIcon?: React.ReactNode;
  /**
   * Size this column to its own content instead of to a measured width: the
   * auto-width pass skips it, and `data-table` renders it as a `width:1%` +
   * `whitespace-nowrap` cell with no `overflow-hidden` clamp. Written by
   * `ObjectGrid` on the injected row-actions `_actions` column, whose inline
   * buttons carry no string data and were otherwise pinned to the 80px floor
   * and clipped.
   *
   * Declared by objectui#6424 (maintainer ruling 2026-08-28, Option A) — the
   * card's second key, in the same shape {@link TableColumn.headerIcon}
   * landed in. Retiring the reads was excluded BY MEASUREMENT, not
   * preference: shipped source authors `fitContent: true`, and
   * `data-table-fit-content.test.tsx` pins the un-clipped result. Before
   * this, a typed author got a compile error — and a silent strip from the
   * zod mirror — for a key the renderer honours.
   */
  fitContent?: boolean;
  /**
   * Field-meta override: display format pattern for the cell value (e.g.
   * `"$0,0"`, `"0%"`, `"YYYY-MM-DD"`), honoured by `object-data-table`'s cell
   * pipeline — `renderFieldValue`'s currency / percent / date branches — and
   * by the numeric right-alignment inference. Documented as an author
   * override by `@object-ui/plugin-dashboard`'s README and exercised by its
   * cells suite. The plain `data-table` renderer does not read it; its
   * type-driven rendering is {@link TableColumn.type} / `cell`.
   *
   * Declared by objectui#6425 (maintainer ruling 2026-08-27, per-key): the
   * widget honoured this key while the declaration refused it, so a typed
   * author got a compile error — and a silent strip from the zod mirror —
   * for documented, tested behaviour. Declaring is truth-maintenance.
   */
  format?: string;
  /**
   * Field-meta override: option list for select-flavoured columns — `value`
   * matched against the cell value, `label` rendered, `color` driving the
   * badge/dot appearance. Honoured by `object-data-table`'s cell pipeline
   * (`SelectCellRenderer`, after the per-option translation pass) ahead of
   * the object schema's own options; documented as an author override by
   * `@object-ui/plugin-dashboard`'s README. The plain `data-table` renderer
   * does not read it.
   *
   * Declared by objectui#6425 (maintainer ruling 2026-08-27, per-key), same
   * stroke as {@link TableColumn.format}.
   */
  options?: Array<{ value: any; label: string; color?: string }>;
  /**
   * Field-meta override: ISO 4217 currency code (e.g. `"EUR"`) for
   * currency-formatted cells, honoured by `object-data-table`'s cell
   * pipeline (`renderFieldValue` and `CurrencyCellRenderer`) ahead of both
   * the symbol inferred from {@link TableColumn.format} and the tenant
   * default currency (ADR-0053). The plain `data-table` renderer does not
   * read it.
   *
   * Declared by objectui#6425 (maintainer ruling 2026-08-27, per-key): kept
   * in production but never promised before — declaring makes the existing
   * behaviour honest.
   */
  currency?: string;
  /**
   * Let long cell text WRAP onto further lines instead of being clipped to one:
   * `data-table` renders the cell body `whitespace-normal break-words` in place
   * of its default `truncate`. Absent or `false` leaves the truncating
   * behaviour exactly as it was.
   *
   * ⚠️ {@link TableColumn.fitContent} WINS over this key. A fit column is
   * `width:1%` with no `minWidth` / `maxWidth` clamp, so the auto table layout
   * sizes it from its content alone, and `whitespace-nowrap` is what holds that
   * content's min-content width at its max-content width — one line. Drop
   * nowrap and min-content falls back to the longest WORD, so the two keys do
   * not compose: honouring `wrap` there collapses the column instead of
   * wrapping it. Measured in Chromium on objectui#6650, the same cell shape
   * both ways: 463.9px wide on one line with nowrap, 70.9px wide over ten lines
   * without it — 6.5x narrower and 5.9x taller. Pinned in
   * `data-table-column-wrap.test.tsx`.
   *
   * Declared by objectui#6650 (maintainer ruling 2026-09-02, Option B:
   * implement). `@objectstack/spec` declares `ListColumn.wrap` and describes it
   * to authors as "Allow text wrapping"; until this card no renderer anywhere
   * read it, so the promise was made at authoring time and silently broken at
   * render time. `ObjectGrid.generateColumns()` forwards the authored key into
   * this slot and `data-table` reads it here — declared, forwarded, rendered.
   */
  wrap?: boolean;
  /**
   * The column holds a MASKED value — a credential whose cell is drawn as a
   * mask. `data-table` withholds the raw value on every path of its own that
   * reads it:
   * - Ctrl+C / Cmd+C on one of its cells writes nothing to the clipboard;
   * - the cell carries no `title` tooltip;
   * - the table's CSV export leaves the column out;
   * - the column never enters inline edit (on any trigger), because every
   *   editor is seeded with the raw value;
   * - the client search leaves the column out of its predicate;
   * - its sort is disabled: the header is inert and the header menu offers no
   *   sort, under client and manual sorting alike, and a client sort already
   *   set on it stops ordering the rows;
   * - its auto width is sized from its header, never from its values.
   *
   * Absent or `false` leaves every one of those paths exactly as it was. The
   * last three are objectui#10657, which folded objectui#10658. Under
   * `manualSearch` the table searches nothing itself: what the host's search
   * matches is the host's.
   *
   * ⚠️ The flag withholds; it does not DRAW. The mask a reader sees comes from
   * the PRODUCER's {@link TableColumn.cell} renderer. The table draws a column
   * with no `cell` as its value, flag or not.
   *
   * ⭐ The producer decides, and the rule is not restated here. `ObjectGrid`,
   * `RelatedList` (`@object-ui/plugin-detail`) and `ObjectDataTable`
   * (`@object-ui/plugin-dashboard`) stamp this flag from `isMaskedFieldType()`
   * in `@object-ui/fields` (objectui#8686), the one authority for "is this
   * field type's cell drawn as a mask", reading the column's authored type and
   * the object-declared type as a narrow-only UNION — a column authoring
   * `type: 'text'` over a `secret` field keeps the flag once the object's
   * types are known. `@object-ui/components` cannot import `@object-ui/fields`,
   * so the table obeys the flag instead of asking the question itself.
   *
   * `RelatedList` and `ObjectDataTable` fail closed: while their object
   * definition is in flight, or after its read failed, they stamp EVERY column.
   *
   * WITHHELD columns (objectui#10657, which folded objectui#10706): while an
   * object-bound producer's field types are unknown (the definition is in
   * flight, or its read failed), a column it cannot type draws as the mask
   * instead of as text, and carries this flag; it stays so when the read
   * failed. In `ObjectGrid` and `ObjectDataTable` that is a column with no
   * authored `type`; `RelatedList` draws its cells from the object's types
   * only, so there it is every column without a `cell` of its own. A host that
   * already holds the object's fields hands them to `ObjectGrid`
   * (`objectFields`, as `ListView` does), so that grid has no such window.
   *
   * `ObjectGrid` also leaves every masked or withheld field of its object out
   * of its own client export, draws those fields through `cell` on its mobile
   * card, and refuses them as grouping keys. Not covered there: the
   * server-streamed export (`exportDownload`) sends the masked columns as
   * before and relies on the server's masking; and the client JSON export, and
   * this table's CSV export of a lookup column, write an expanded lookup
   * record whole, so a credential field of the related object is not pruned.
   *
   * Declared by objectui#10583: the grid drew the mask while the table's
   * keyboard copy wrote `String(row[accessorKey])` for every cell — the grid
   * face of the disclosure objectui#8440 closed on the detail page.
   */
  masked?: boolean;
  /**
   * The column's cells draw chips (a select or status field's badges). The
   * table gives such a column a minimum width of its widest drawn chip,
   * measured once per data load, so a single-word value is never cut to an
   * ellipsis; text columns keep their width and truncate instead. Applies
   * over an explicit `width` and a user's resize alike: neither can take
   * the column below that floor.
   *
   * Written by `ObjectGrid` from the column's field type, because the table
   * cannot tell a chip from text: `type` has no select member, and a `cell`
   * renderer is opaque to it (objectui#12708).
   */
  chips?: boolean;
  /**
   * The column's raw value is a FOREIGN KEY: the id of a referenced record
   * (a `lookup`, `master_detail`, `tree` or `user` field), while its `cell`
   * renderer draws that record's name (for a lookup the viewer cannot read,
   * "Restricted record"). The cell carries no `title` tooltip, which would show
   * the raw id the drawn cell withholds. Absent or `false`, the tooltip is as
   * before.
   *
   * Unlike {@link TableColumn.masked}, it withholds nothing else: copy, CSV
   * export, inline edit, search and sort are unchanged.
   *
   * Written by `ObjectGrid` from the column's field type, because the table
   * cannot tell a reference from text: `type` has no reference member
   * (objectui#13377).
   */
  foreignKey?: boolean;
}

/**
 * Column definition for the STATIC `table` renderer (`type: 'table'`) — the
 * narrow declared subset that renderer actually reads, so declared = enforced
 * holds per renderer (objectui#5474, maintainer ruling 2026-08-22, Option C:
 * split the types).
 *
 * {@link TableColumn} above remains the rich shared shape that `data-table`
 * honours (`DataTableSchema`, detail-view relations) — it is
 * deliberately NOT narrowed. The static renderer
 * (`packages/components/src/renderers/complex/table.tsx`) reads exactly five
 * column keys: `header`, `accessorKey`, `className`, `cellClassName`, `width`
 * (measured on objectui#5474; every other key was accepted, type-checked, and
 * did nothing, with no diagnostic).
 *
 * The `?: never` members are ADR-0049 retirement tombstones — this package's
 * convention (see `crud.ts` `confirm` and `complex.ts` `DashboardWidgetSchema`):
 * authoring one is a tsc error here and a loud parse rejection in the Zod twin
 * (`zod/data-display.zod.ts` `StaticTableColumnSchema`). Implementing the keys
 * on this renderer instead (Option A) was considered and NOT chosen — it would
 * duplicate `data-table`'s capabilities and leave two interactive tables to
 * maintain. Authors who need the interactive set migrate the node to
 * `type: 'data-table'`, whose columns keep the rich {@link TableColumn}.
 */
export interface StaticTableColumn {
  /**
   * Column header text
   */
  header: string;
  /**
   * Key to access data in row object
   */
  accessorKey: string;
  /**
   * Header CSS class
   */
  className?: string;
  /**
   * Cell CSS class
   */
  cellClassName?: string;
  /**
   * Column width
   */
  width?: string | number;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it. Use `data-table` for the interactive set.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  minWidth?: never;
  /**
   * NOT on the static `table` surface (objectui#6650) — declared on the rich
   * {@link TableColumn} only, where `data-table` reads it. The static renderer
   * has no truncation to opt out of. Use `data-table` for the interactive set.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  wrap?: never;
  /**
   * NOT on the static `table` surface (objectui#10583) — declared on the rich
   * {@link TableColumn} only, where `data-table` reads it. The static renderer
   * has no keyboard copy, tooltip, export or inline edit for it to withhold.
   * Use `data-table` for the interactive set.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  masked?: never;
  /**
   * NOT on the static `table` surface (objectui#12708) — declared on the rich
   * {@link TableColumn} only, where `data-table`'s column sizing reads it. The
   * static renderer has no column sizing for it to floor.
   * Use `data-table` for the interactive set.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  chips?: never;
  /**
   * NOT on the static `table` surface (objectui#13377) — declared on the rich
   * {@link TableColumn} only, where `data-table`'s cell tooltip reads it. The
   * static renderer draws no `title` tooltip for it to withhold.
   * Use `data-table` for the interactive set.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  foreignKey?: never;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it; a right-aligned column authored here was
   * silently inert. Use `data-table`, or a Tailwind `cellClassName` such as
   * `text-right`, which this renderer does honour.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  align?: never;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it. Use `data-table` for the interactive set.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  fixed?: never;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it. Use `data-table` for the interactive set.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  type?: never;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it. Sorting is `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  sortable?: never;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it. Filtering is `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  filterable?: never;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it. Resizing is `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  resizable?: never;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it. Inline editing is `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  editable?: never;
  /**
   * RETIRED from the static `table` surface (objectui#5474, ADR-0049) — the
   * static renderer never read it. Custom cells are `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  cell?: never;
  /**
   * NOT on the static `table` surface (objectui#6424, under #5474's lockstep
   * rule: every rich key needs a deliberate static-side decision). Declared on
   * the rich {@link TableColumn} only — the static renderer never read it.
   * Header icons are `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  headerIcon?: never;
  /**
   * NOT on the static `table` surface (objectui#6424, under #5474's lockstep
   * rule: every rich key needs a deliberate static-side decision). Declared
   * on the rich {@link TableColumn} only — the static renderer has no
   * auto-width pass to opt out of and no per-cell overflow clamp to lift
   * (its measured read set is the five live keys above). Content-hugging
   * columns are `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  fitContent?: never;
  /**
   * NOT on the static `table` surface (objectui#6425, under #5474's lockstep
   * rule: every rich key needs a deliberate static-side decision). Declared
   * on the rich {@link TableColumn} only — the static renderer reads no
   * field-meta overrides (its measured read set is the five live keys above).
   * Formatted cells are `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  format?: never;
  /**
   * NOT on the static `table` surface (objectui#6425, under #5474's lockstep
   * rule). Declared on the rich {@link TableColumn} only — the static
   * renderer reads no field-meta overrides. Select badges are `data-table`'s
   * capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  options?: never;
  /**
   * NOT on the static `table` surface (objectui#6425, under #5474's lockstep
   * rule). Declared on the rich {@link TableColumn} only — the static
   * renderer reads no field-meta overrides. Currency cells are
   * `data-table`'s capability.
   * @deprecated Not part of the static `table` renderer's contract.
   */
  currency?: never;
}

/**
 * Simple STATIC table component — renders inline `data` against `columns`,
 * nothing more. For hover/stripe styling, sorting, filtering, selection or
 * inline editing use `data-table` ({@link DataTableSchema}).
 */
export interface TableSchema extends BaseSchema {
  type: 'table';
  /**
   * Table caption
   */
  caption?: string;
  /**
   * Table columns — the narrow static subset ({@link StaticTableColumn}),
   * split from the rich shared {@link TableColumn} by objectui#5474 so
   * declared = enforced holds per renderer.
   */
  columns: StaticTableColumn[];
  /**
   * Table data rows
   */
  data: any[];
  /**
   * Table footer content
   */
  footer?: SchemaNode | SchemaNode[] | string;
  /**
   * RETIRED (objectui#5474, maintainer ruling 2026-08-22, ADR-0049
   * enforce-or-remove): the static renderer never implemented row hover
   * highlighting — the key carried a `@default true` annotation describing
   * behaviour that did not exist, and the reference page taught it as working.
   * `?: never` is this package's tombstone convention (see `crud.ts`
   * `confirm`): authoring the key is a tsc error here and a loud parse
   * rejection in the Zod twin. Row hover styling is `data-table` behaviour —
   * migrate the node to `type: 'data-table'`.
   * @deprecated Retired — use `data-table` for interactive row affordances.
   */
  hoverable?: never;
  /**
   * RETIRED (objectui#5474, maintainer ruling 2026-08-22, ADR-0049
   * enforce-or-remove): the static renderer never implemented striped rows —
   * same tombstone as `hoverable` above. Alternate-row styling can be
   * expressed today with Tailwind on `className`
   * (e.g. `[&_tbody_tr:nth-child(even)]:bg-muted/50`), which this renderer
   * does honour.
   * @deprecated Retired — style rows via `className`, or use `data-table`.
   */
  striped?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `table` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `caption`, `columns`, `data`, `footer` (in
   * `packages/components/src/renderers/complex/table.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `table` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `table` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `caption`, `columns`, `data`, `footer` (in
   * `packages/components/src/renderers/complex/table.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `table` reads — nothing renders it.
   */
  children?: never;
}

/**
 * A single extra per-row action rendered in the data-table's row overflow
 * menu (after Edit/Delete). Used to surface an object's own row actions in
 * embedded tables — e.g. a detail page's related list showing the child
 * object's `list_item` actions. The host pre-localizes `label`/`confirmText`
 * and executes the action via {@link DataTableSchema.onRowActionDef}.
 */
export interface DataTableRowAction {
  /** Stable action name. */
  name: string;
  /** Display label (already localized). */
  label?: string;
  /** Lucide icon name (kebab-case). */
  icon?: string;
  /** `'danger'` renders the item in the destructive color. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  /** Confirmation prompt shown before the action runs. */
  confirmText?: string;
  /** Remaining action metadata is preserved for the host executor. */
  [k: string]: unknown;
}

/**
 * One group band of a grouped `data-table` (objectui#12620). See
 * {@link DataTableSchema.rowGroups}.
 */
export interface DataTableRowGroup {
  /** Unique key of the group; React key of its band row and `data-group-key` on it. */
  key: string;
  /**
   * The band's content: what the host draws inside the one cell that spans
   * every column (the chevron, the group value, the count).
   */
  band: React.ReactNode;
  /**
   * The group's own data rows, drawn under its band. Empty when the group is
   * collapsed or when it only holds nested groups (they follow it in the list).
   */
  rows: any[];
  /**
   * Optional content drawn in a full-width row after the group's rows, such as
   * a server-paged group's pager or its loading line.
   */
  footer?: React.ReactNode;
  /** Nesting level, 0 for the outermost groups. Written to `data-group-depth`. @default 0 */
  depth?: number;
}

/**
 * Enterprise data table with advanced features
 */
export interface DataTableSchema extends BaseSchema {
  type: 'data-table';
  /**
   * Render the table without its outer rounded border. Useful when the
   * table is embedded inside a parent container that already provides
   * visual framing (e.g. grouped rows, sub-tables).
   * @default false
   */
  borderless?: boolean;
  /**
   * Drop the table's own horizontal/vertical scroll container so the table
   * overflows into a shared parent scroll container instead. Used by the
   * grouped grid: its one table (see {@link DataTableSchema.rowGroups})
   * overflows into the grid's own scroller, which holds both scrollbars and
   * keeps the sticky header at its top.
   * @default false
   */
  disableInnerScroll?: boolean;
  /**
   * Table caption
   */
  caption?: string;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `toolbar` (objectui#6881, maintainer
   * ruling 2026-08-31: retire, do NOT wire).
   *
   * What was measured (objectui#6881, re-measured on the retiring PR's base):
   * declared on both published faces, documented, mirrored — and read by
   * NOTHING. `data-table.tsx`, the registered renderer for `type:
   * 'data-table'`, contains the word only in two prose comments and never
   * reads `schema.toolbar`; the sibling `emptyAction` slot on this same
   * interface IS mounted through `SchemaRenderer`, so the zero is a reading,
   * not a blind query. An author who wrote a toolbar got a green document and
   * a blank result, with no signal anywhere that said so.
   *
   * `?: never` is this package's tombstone convention (see `crud.ts`
   * `confirm`, {@link StaticTableColumn}, `TimelineSchema`'s `timeScale`), NOT
   * a deletion: `BaseSchema`'s `[key: string]: any` admitted a deleted key as
   * `any` until objectui#8347, and a widened value still carries one
   * unchecked — the same silence one layer over. The Zod twin refuses it
   * loudly via `retirementTombstone()` (`zod/data-display.zod.ts`).
   *
   * RETIRED (objectui#6881, ADR-0049) — never mounted by the data-table
   * renderer. Use the built-in toolbar chrome instead (`searchable` /
   * `exportable`), or compose your own nodes beside the table. A real
   * toolbar slot must arrive as a redesigned proposal WITH its enforcing
   * reader, per the ruling — not by reviving this key.
   */
  toolbar?: never;
  /**
   * Table columns
   */
  columns: TableColumn[];
  /**
   * Table data rows
   */
  data: any[];
  /**
   * Enable pagination
   * @default true
   */
  pagination?: boolean;
  /**
   * Rows per page
   * @default 10
   */
  pageSize?: number;
  /**
   * Options offered in the "rows per page" selector. When omitted the table
   * falls back to its built-in list (5/10/20/50/100). The current `pageSize`
   * is always merged in so the selector can show the active value even if it
   * is not one of the configured options.
   */
  pageSizeOptions?: number[];
  /**
   * Server-side ("manual") pagination. When true, `data` is treated as the
   * already-fetched current page (not sliced locally), `rowCount` provides the
   * total match count used to compute total pages, the current page is
   * controlled via `page`, and page/size changes are reported through
   * `onPageChange` / `onPageSizeChange` so the caller can re-fetch. Without it
   * the table paginates the in-memory `data` client-side (legacy behavior).
   * @default false
   */
  manualPagination?: boolean;
  /**
   * Total number of rows matching the query on the server. Only used when
   * `manualPagination` is true — drives the total-page count.
   */
  rowCount?: number;
  /**
   * Controlled current page (1-based) for `manualPagination`.
   */
  page?: number;
  /**
   * Called when the user navigates to another page under `manualPagination`.
   */
  onPageChange?: (page: number) => void;
  /**
   * Called when the user changes the page size under `manualPagination`.
   */
  onPageSizeChange?: (pageSize: number) => void;
  /**
   * Server-side ("manual") sorting. When true the table does NOT sort `data`
   * locally — it is already in the order the server returned — and a column
   * header click reports the requested sort through `onSortChange` instead.
   *
   * Set this whenever `data` is one window of a larger collection. Sorting a
   * window locally orders **that page**, which reads on screen as "the list is
   * sorted by this column" and is not (objectui#3106).
   *
   * Deliberately independent of `manualPagination`: a windowed related list
   * paginates itself (`pagination: false`) while its rows still come from the
   * server one page at a time.
   *
   * The table keeps NO sort state of its own in this mode — `sort` is the only
   * source of truth, and the header renders and cycles that. A private copy
   * alongside a controlled prop is how the original defect arose.
   * @default false
   */
  manualSorting?: boolean;
  /**
   * The active sort, when `manualSorting` is on. Drives the header indicators
   * and is the value each header click transforms. Ignored otherwise (the table
   * owns its sort in client mode).
   */
  sort?: TableSortItem[];
  /**
   * Called with the sort a header click asks for, when `manualSorting` is on.
   *
   * Always exactly one key: a header click REPLACES the order rather than
   * appending to it, so the column under the cursor is the one the list is
   * sorted by. Multi-key sorts come from a host's own sort builder, and the
   * header renders them (numbered) without being able to produce one.
   *
   * Never empty. In client mode the third click clears the sort, which is
   * meaningful there — the rows return to the order they arrived in. Against a
   * server-paged collection there is no such order to return to: an unsorted
   * paged read is arbitrary per page (objectstack#4363), so offering it from a
   * header would hand the user a worse lie than the one being fixed. Removing
   * a sort entirely stays with the host's sort builder.
   *
   * Without this callback the headers render inert (no cursor, no icons) rather
   * than accepting clicks that go nowhere.
   */
  onSortChange?: (sort: TableSortItem[]) => void;
  /**
   * Enable search
   * @default true
   */
  searchable?: boolean;
  /**
   * Server-side ("manual") search. When true the table does NOT filter `data`
   * locally — it is already the result the server produced for the whole
   * collection — and typing in the search box reports the term through
   * `onSearchChange` instead.
   *
   * Set this whenever `data` is one window of a larger collection. Filtering a
   * window locally searches **that page**, which reads on screen as "2 results
   * in this list" while every row outside the window never participated
   * (objectui#3118). It is the filter-axis twin of `manualSorting`, and tied to
   * the same question: is `data` a window, or the collection?
   *
   * The table keeps NO search state of its own in this mode — `search` is the
   * only source of truth, and the box renders that. A private copy alongside a
   * controlled prop is how the original defect arose.
   * @default false
   */
  manualSearch?: boolean;
  /**
   * The active search term, when `manualSearch` is on. Drives the search box's
   * value and is what the host turned into a server `$search` (ADR-0061: the
   * client sends the term, the server resolves which fields it matches from the
   * object's metadata). Ignored otherwise (the table owns its term in client
   * mode).
   */
  search?: string;
  /**
   * Called with the term the user typed, when `manualSearch` is on. The host is
   * expected to re-read the collection with it and return to page 1 — a new
   * term makes the old page index a different set of rows.
   *
   * Without this callback the search box is not rendered at all under
   * `manualSearch`. A box that filters nothing is the same class of lie as one
   * that filters only the page you can see, and there is no honest local
   * fallback: the rows to search are not in the browser.
   */
  onSearchChange?: (search: string) => void;
  /**
   * Enable row selection
   * - boolean: Enable/disable selection (true = multiple selection)
   * - 'single': Single row selection
   * - 'multiple': Multiple row selection
   * @default false
   */
  selectable?: boolean | 'single' | 'multiple';
  /**
   * RETIRED (objectui#6152 round 5, ADR-0049) — there is no authored checkbox
   * style. Delete the key: `selectable` alone turns selection on. How the
   * checkbox shows is the table's own (objectui#12423): it sits in the row's
   * leading cell — beside the row number when `showRowNumbers` is on — and is
   * revealed on row hover, on focus, on a coarse pointer and on every row
   * while any row is selected.
   *
   * It was `'always' | 'hover'`, and `data-table` honoured `'hover'` (the checkbox
   * cell faded in on row hover) — but nothing wrote it. Measured on the retiring
   * change's base, a reading at that revision and ⛔ not a live count: no document
   * in this repository or in `objectstack` authors it (every tracked
   * JSON file, Markdown JSON fence and `type: 'data-table'` object literal), and a
   * type-checker census over every package found its one destructuring read and
   * no producer. A published capability with no author and no producer is
   * retired, ⛔ not kept for its sunk cost, and the hover branch went with it.
   *
   * A `?: never` tombstone and ⛔ not a deletion, by the retire-vs-remove
   * discriminator stated on `ChatbotSchema` in `complex.ts` (cited, not restated
   * here): this member's published comment taught `'hover'` as a working style,
   * and on a {@link BaseSchema} carrier a deleted member read as `any` through
   * the index signature until objectui#8347 (a widened value still skips the
   * excess-property check), so a stale `'hover'` would type-check in silence. The
   * zod twin refuses the key by name.
   *
   * @deprecated Not part of this contract — the table decides how its
   * selection checkboxes show.
   */
  selectionStyle?: never;
  /**
   * Whether to render the built-in "N selected" count in the table toolbar.
   * Set false when an outer container (e.g. ObjectGrid's BulkActionBar) already
   * surfaces the selection, to avoid a duplicate — and otherwise orphaned —
   * toolbar row.
   * @default true
   */
  showSelectionCount?: boolean;
  /**
   * Enable column sorting
   * @default true
   */
  sortable?: boolean;
  /**
   * Enable CSV export
   * @default false
   */
  exportable?: boolean;
  /**
   * Show row actions (edit/delete)
   * @default false
   */
  rowActions?: boolean;
  /**
   * Enable column resizing
   * @default true
   */
  resizableColumns?: boolean;
  /**
   * Enable column reordering
   * @default true
   */
  reorderableColumns?: boolean;
  /**
   * Row edit handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by `renderers/complex/data-table.tsx` (`schema.onRowEdit?.(row)`).
   */
  onRowEdit?: (row: any) => void;
  /**
   * Row delete handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by `renderers/complex/data-table.tsx` (`schema.onRowDelete?.(row)`).
   */
  onRowDelete?: (row: any) => void;
  /**
   * Per-record CEL predicates gating the built-in row Edit item
   * (objectui#2614), from the object's `userActions.edit` object form.
   * `visibleWhen` false → the item is not rendered for that row (fail-closed);
   * `disabledWhen` true → rendered disabled (fail-soft). Bare CEL string or
   * `{ dialect: 'cel', source }` envelope, evaluated per row with the record
   * bound as `record.*` and bare fields.
   */
  rowEditPredicates?: { visibleWhen?: unknown; disabledWhen?: unknown };
  /**
   * Per-record CEL predicates gating the built-in row Delete item
   * (objectui#2614), from the object's `userActions.delete` object form.
   */
  rowDeletePredicates?: { visibleWhen?: unknown; disabledWhen?: unknown };
  /**
   * Extra per-row action definitions rendered in the row overflow menu, after
   * Edit/Delete. Each is dispatched via {@link onRowActionDef} with the clicked
   * row. Surfaces an object's own row actions in embedded tables (e.g. a detail
   * page's related list). Requires {@link rowActions} to be enabled.
   */
  rowActionDefs?: DataTableRowAction[];
  /**
   * Handler invoked when one of {@link rowActionDefs} is chosen from the row
   * overflow menu.
   *
   * RUNTIME SLOT (objectui#6124, declared by `75fca9669`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is called by `renderers/complex/data-table.tsx`
   * (`onActionDef={schema.onRowActionDef}`). Supplied by `RelatedList`
   * (`@object-ui/plugin-detail`), which forwards its own `onRowAction` React
   * prop onto the `data-table` node it builds.
   */
  onRowActionDef?: (action: DataTableRowAction, row: any) => void | Promise<void>;
  /**
   * Selection change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by `renderers/complex/data-table.tsx`
   * (`schema.onSelectionChange(selectedData)`).
   */
  onSelectionChange?: (selectedRows: any[]) => void;
  /**
   * Bump this value to imperatively clear the table's internal row selection.
   * The table clears its checkbox selection whenever the key changes to a new
   * value. Lets a host (e.g. a grid clearing selection after a bulk action)
   * reset the checkboxes, which are otherwise internal table state.
   */
  selectionResetKey?: string | number;
  /**
   * Columns reorder handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by `renderers/complex/data-table.tsx`
   * (`schema.onColumnsReorder(newColumns)`).
   */
  onColumnsReorder?: (columns: TableColumn[]) => void;
  /**
   * Enable inline cell editing
   * When true, cells become editable on double-click or Enter key
   *
   * HOST-PAIRED, not an authored flag (objectui#6152 round 5): the table only
   * STAGES an edit; persisting it is the job of the `onRowSave` / `onCellChange`
   * / `onBatchSave` slots, which a host supplies in code — `ObjectGrid` sets this
   * key on the `data-table` node it builds, together with that save path. A JSON
   * document can supply no function, so an authored `editable: true` stages edits
   * that nothing saves. To edit records inline from a document, author an
   * `object-grid`, which carries the save path itself.
   * @default false
   */
  editable?: boolean;
  /**
   * Enable single-click editing mode
   * When true with editable, clicking a cell enters edit mode (instead of double-click)
   *
   * HOST-PAIRED with {@link DataTableSchema.editable} (objectui#6152 round 5):
   * `ObjectGrid` sets it in code; no document authors it.
   * @default false
   */
  singleClickEdit?: boolean;
  /**
   * Arrow-key cell navigation on the WAI-ARIA grid pattern (objectui#11068).
   *
   * When `true` the table is exposed as a `grid` and its data cells take ONE
   * place in the Tab sequence between them — a roving tab stop that starts on
   * the first cell and stays on the cell that last held focus — instead of one
   * stop per cell. Arrow keys move focus one cell; Home / End go to the first /
   * last cell of the row, and Ctrl+Home / Ctrl+End to the first / last cell of
   * the page. A cell being edited keeps every key for its editor, and an edit
   * ended from the keyboard (Enter / Escape) hands focus back to its cell, so
   * the arrows carry on from there. A widget a cell renders (a link, a button)
   * keeps its own Tab stop.
   *
   * SET IN CODE, not authored on this node (the class of
   * {@link DataTableSchema.editable}): `ObjectGrid` resolves the `object-grid`
   * node's own `keyboardNavigation` — the key the spec's `object-grid` row
   * declares, defaulting to on when the grid is inline-editable — and hands the
   * answer to the table it builds. Absent here means off: every data cell stays
   * its own Tab stop, as it always was.
   * @default false
   */
  keyboardNavigation?: boolean;
  /**
   * Host-supplied cell editor for inline editing (`bf97b98c8`).
   *
   * RUNTIME SLOT (objectui#7759 group E, objectui#6124 shape) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name. Kept callable here because `data-table`
   * reads `schema.renderCellEditor` and calls it; `ObjectGrid` supplies it.
   *
   * When a cell enters edit mode the table calls this FIRST and renders what it
   * returns; returning `null` means "no widget for this column" and the table
   * falls through to its built-in text / number / date inputs. It exists so a
   * higher layer (e.g. `ObjectGrid`) can hand a cell the SAME dedicated widget
   * the form uses for that field type — select, lookup, boolean — without the
   * component layer, which is deliberately `@object-ui/fields`-free, having to
   * re-implement any of them.
   *
   * The returned node is wrapped by the table so it gains the exit-edit
   * affordances the built-in editors have (Enter commits from a single-line
   * input, Escape cancels, click-outside commits); `stage` records a value
   * without leaving edit mode, `commit` saves, `cancel` discards.
   *
   * A widget may stage on every change or only when its control loses focus
   * (objectui#12664): before Enter or a click outside commits, the table
   * blurs the control that holds focus inside the editor, so a widget that
   * reads its input on blur — the platform date picker parses its
   * locale-formatted text there — calls `stage` first, and the commit saves
   * that value. Escape does not blur first: it discards.
   *
   * ⚠️ Declared as of `bf97b98c8` (maintainer ruling 2026-08-30). `data-table`
   * has read this key on the production path since inline editing landed — it
   * did so through a `(schema as any)` cast, which existed for no reason other
   * than this declaration's absence and is gone with it. Nothing new runs; a
   * misspelling is now caught at authoring time instead of failing silently.
   *
   * The context carries the row TWICE, deliberately (objectui#7188): `row` is
   * the PERSISTED record and `pendingRow` is that record with the row's
   * staged-but-unsaved edits merged over it. A widget that scopes itself by a
   * sibling field (a `dependsOn` lookup) wants the staged one, so picking a
   * parent re-scopes the child before anything is saved — the form's
   * live-record semantics (PR objectui#2216). `row` was NOT redefined to mean
   * the merged record: that would silently change an already-published member,
   * and a host that needs the persisted value would have lost its only source.
   */
  renderCellEditor?: (ctx: {
    column: any;
    /** The PERSISTED record — what the data source last returned for this row. */
    row: any;
    /**
     * `row` shallow-merged with this row's staged, unsaved edits (the table's
     * `pendingChanges` entry). The same object as `row` when nothing is staged.
     * The record a dependent widget should scope itself by (objectui#7188).
     */
    pendingRow: any;
    value: any;
    stage: (v: any) => void;
    commit: (v?: any) => void;
    cancel: () => void;
  }) => React.ReactNode;
  /**
   * Group bands (objectui#12620): draw the table as ONE table, with one header,
   * whose body is a band row per group followed by that group's rows.
   *
   * RUNTIME SLOT — host-built React content, NOT authorable metadata: JSON has
   * no React node, so the zod twin refuses this key by name. Supplied by
   * `ObjectGrid` (`@object-ui/plugin-grid`) for a grouped view.
   *
   * When set, the table draws the rows of these groups and ignores `data`; a
   * nested group follows its parent in the list. Each band is one cell whose
   * `colSpan` covers the utility cells and every column, so the columns keep
   * one width across bands. A client-side sort orders rows WITHIN each group
   * and never moves a row to another band. Selection, keyboard navigation,
   * copy and export see the data rows only. Pagination is the host's: the
   * table's own pager is not drawn.
   */
  rowGroups?: DataTableRowGroup[];
  /**
   * Cell value change handler
   * Called when a cell value is edited
   *
   * RUNTIME SLOT (objectui#6124, declared by `75fca9669`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is called by `renderers/complex/data-table.tsx`
   * when an inline edit is staged, with the staged value and the edited record's
   * row. Supplied by `ObjectGrid` (`@object-ui/plugin-grid`), which forwards the
   * React prop of the same name off `ObjectGridComponentProps`.
   *
   * `rowIndex` is computed when the call is made (objectui#12310): the row's
   * global index while the table holds the record, and `-1` when the rows it
   * holds no longer include it (a re-read or a client-side search dropped the
   * record while its editor was open). A pending edit belongs to its record
   * (`row.id`, or the row object for a row without one), never to a position,
   * so `row` is that record's own row in both cases: the held row, or else the
   * row the editor was opened on.
   */
  onCellChange?: (rowIndex: number, columnKey: string, newValue: any, row: any) => void;
  /**
   * Row save handler
   * Called when saving changes for a single row
   *
   * RUNTIME SLOT (objectui#6124, declared by `75fca9669`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is called by `renderers/complex/data-table.tsx`
   * from a row's own save button, with that record's staged changes and its
   * row. Supplied by `ObjectGrid` as `onRowSave ?? defaultRowSave` — the left
   * limb is the React prop of the same name on `ObjectGridComponentProps`, the
   * right a dataSource-backed default installed only when no host wired one.
   *
   * `rowIndex` is the row's global index when the call is made
   * (objectui#12310). The button is drawn only on a row the table holds, so it
   * is never negative here.
   */
  onRowSave?: (rowIndex: number, changes: Record<string, any>, row: any) => void | Promise<void>;
  /**
   * Batch save handler
   * Called when saving changes for multiple rows
   *
   * RUNTIME SLOT (objectui#6124, declared by `75fca9669`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is called by `renderers/complex/data-table.tsx`
   * (`await schema.onBatchSave(changesToSave)`). Supplied by `ObjectGrid` as
   * `onBatchSave ?? defaultBatchSave`, the same two-limb shape as
   * {@link onRowSave}.
   *
   * The outcome is read PER ROW (objectui#12292). A batch is several
   * independent writes, so some can land while others are refused, and the
   * server does not take the landed ones back. A handler that knows which rows
   * did not persist resolves with `{ failed }`, each entry naming a row by the
   * `rowIndex` it was handed: the table keeps and flags exactly those rows and
   * clears the rest. Resolving with nothing means every row persisted.
   * Rejecting means the handler cannot say which rows landed, so the table
   * keeps and flags every row, as it always has.
   *
   * Each entry is one record's pending edit, resolved by the record, never by
   * a position (objectui#12310). While the table holds the record, `row` is
   * its current row and `rowIndex` its global index when Save All is pressed.
   * A record the table no longer holds (a re-read or a client-side search
   * dropped it, or it sits on another server page) is still handed over:
   * `row` is the row the edit was staged against, and `rowIndex` is negative
   * (`-1`, `-2`, …, distinct within one batch), since no position in the held
   * rows is that record's. A `{ failed }` entry names its row by the
   * `rowIndex` it was handed, negatives included.
   */
  onBatchSave?: (
    changes: Array<{ rowIndex: number; changes: Record<string, any>; row: any }>,
  ) => void | Promise<void | { failed: Array<{ rowIndex: number; error: unknown }> }>;
  /**
   * Row click handler
   * Called when a row is clicked
   *
   * RUNTIME SLOT (objectui#6124, declared by `75fca9669`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is called by `renderers/complex/data-table.tsx`
   * (`schema.onRowClick(row, e)`, gated on `!e.defaultPrevented`). THREE
   * suppliers, measured: `ObjectGrid` passes `navigation.handleClick`,
   * `ObjectDataTable` passes
   * `schema.onRowClick ?? (recordDrillEnabled ? handleRowClick : undefined)`
   * (its own forwarding face, `ObjectDataTableSchema.onRowClick`, carries the
   * same refusal arm), and `RelatedList` forwards its own React prop of this
   * name.
   *
   * TWO parameters since objectui#9462, and the second is the reason that card
   * exists: the renderer's two call sites — the row's own click handler and the
   * hover "open record" button, `schema.onRowClick?.(row, e)` — each had the
   * DOM event in hand and passed only the row. The suppliers above route this
   * slot straight into `useNavigationOverlay`'s `handleClick`, which reads
   * `metaKey` / `ctrlKey` / `button` off that second argument, so a host wiring
   * Cmd/Ctrl/middle-click received `undefined` and "open in a new tab" silently
   * became an ordinary navigation. Spelled `any` and not `HandleClickModifiers`
   * for the reason objectui#9341 measured on `ObjectKanbanSchema.onCardClick`:
   * that interface lives in `@object-ui/react`, which depends on THIS package,
   * so naming it here is a phantom dependency and closes a cycle. `BaseSchema`'s
   * own `onClick` / `onChange` / `onSubmit` already use this spelling.
   */
  onRowClick?: (row: any, event?: any) => void;
  /**
   * Dynamic row class name
   * Function that returns a CSS class string for each row
   */
  rowClassName?: (row: any, index: number) => string | undefined;
  /**
   * Dynamic row inline style
   * Function that returns CSSProperties for each row (e.g., from conditionalFormatting).
   */
  rowStyle?: (row: any, index: number) => React.CSSProperties | undefined;
  /**
   * Extra CSS classes folded into the table's UTILITY body cells
   * (`bf97b98c8`) — and ONLY those three, each rendered only when its
   * feature is on: the leading selection-checkbox cell (`selectable`), the
   * row-number cell (`showRowNumbers` without `selectable` — with both on the
   * number is drawn inside the selection cell, objectui#12423), and the
   * trailing row-actions cell (`rowActions`).
   *
   * ⚠️ It does NOT reach a data cell. A data cell folds
   * {@link TableColumn.cellClassName} — the per-column key — and nothing else,
   * so the two class slots style DISJOINT cells and never combine on one cell.
   * (The empty-state cell and the add-record row cell take neither.) The
   * population is checkable: `data-table.tsx` folds this key at exactly three
   * `cn(cellClassName, …)` call sites, and the data-cell one folds
   * `col.cellClassName`.
   *
   * Its live use is row density, and it is only half of that. Row height is a
   * property of the cells, not of the `<tr>` — `rowClassName` cannot express
   * it — so a host that renders compact / short / tall rows sets the per-cell
   * padding on BOTH slots: `ObjectGrid` folds its density class into every
   * column's `cellClassName` and passes the same class here, which is what
   * keeps the checkbox and row-number cells the same height as the data beside
   * them. Setting only this key leaves every data cell at the table
   * primitive's default `p-4`.
   *
   * ⚠️ Declared as of `bf97b98c8` (maintainer ruling 2026-08-30). `data-table`
   * has destructured this key off the schema and folded it into those three
   * cells all along; only the declaration was missing. `string` matches
   * {@link BaseSchema.className} and {@link TableColumn.cellClassName} — the
   * renderer passes it through `cn()`, which would also swallow an array or an
   * object, but one authored spelling for a class slot is the contract.
   */
  cellClassName?: string;
  /**
   * Number of columns to freeze (left-pin)
   * When set, the first N columns remain fixed while the rest scroll horizontally.
   * @default 0
   */
  frozenColumns?: number;
  /**
   * Show row numbers in the first column (Airtable-style). With `selectable`
   * on too, the number and the checkbox share that one leading cell: the
   * number by default, the checkbox on row hover, on focus and while any row
   * is selected (objectui#12423).
   * @default false
   */
  showRowNumbers?: boolean;
  /**
   * Show "+ Add record" row at the bottom of the table (Airtable-style)
   * @default false
   */
  showAddRow?: boolean;
  /**
   * Optional schema node rendered inside the empty-state, e.g. an
   * "Add record" button. Lets the empty state become an actionable
   * invitation rather than a dead end.
   */
  emptyAction?: SchemaNode;
  /**
   * Callback when the "+ Add record" row is clicked
   *
   * RUNTIME SLOT (objectui#6124, declared by `75fca9669`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is called by `renderers/complex/data-table.tsx`
   * (`onClick={() => schema.onAddRecord?.()}`). Supplied by `ObjectGrid`, which
   * forwards the React prop of the same name off `ObjectGridComponentProps`;
   * `ObjectManager` and `FieldDesigner` (`@object-ui/plugin-designer`) are two
   * hosts that fill it.
   */
  onAddRecord?: () => void;
  /**
   * Column resize handler
   * Called when a column is resized
   *
   * RUNTIME SLOT (objectui#6124, declared by `75fca9669`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is called by `renderers/complex/data-table.tsx`
   * (`schema.onColumnResize?.(resizedColumn, finalWidth)` at the end of a resize
   * drag — objectui#6175 wired that read).
   *
   * ⚠️ Its channel is NOT the one its six siblings above use, and the difference
   * was measured rather than inferred: no React prop anywhere carries this key.
   * `ObjectGrid` supplies its own closure here and reports the MERGED
   * `{ order, widths }` layout to its host through `onColumnStateChange`
   * instead, because the table vocabulary is per-event and the grid's is the
   * persisted blob. A live function still reaches the renderer through this
   * interface, which is what makes the slot real.
   */
  onColumnResize?: (columnKey: string, width: number) => void;
  /**
   * Column reorder handler (new order of accessorKeys)
   * Called when columns are reordered via drag-and-drop
   */
  onColumnReorder?: (newOrder: string[]) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `data-table` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `emptyAction`, `onAddRecord`, `onBatchSave`, `onCellChange`,
   * `onColumnResize`, `onColumnsReorder`, `onRowActionDef`, `onRowClick`,
   * `onRowDelete`, `onRowEdit`, `onRowSave`, `onSelectionChange`,
   * `renderCellEditor`, `rowActionDefs`, `rowDeletePredicates`,
   * `rowEditPredicates` (in
   * `packages/components/src/renderers/complex/data-table.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `data-table` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `data-table` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `emptyAction`, `onAddRecord`, `onBatchSave`, `onCellChange`,
   * `onColumnResize`, `onColumnsReorder`, `onRowActionDef`, `onRowClick`,
   * `onRowDelete`, `onRowEdit`, `onRowSave`, `onSelectionChange`,
   * `renderCellEditor`, `rowActionDefs`, `rowDeletePredicates`,
   * `rowEditPredicates` (in
   * `packages/components/src/renderers/complex/data-table.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `data-table` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Markdown renderer component
 */
export interface MarkdownSchema extends BaseSchema {
  type: 'markdown';
  /**
   * Markdown content
   */
  content: string;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `sanitize` (objectui#6972).
   *
   * Declared `?: boolean` with `@default true` and read by NOTHING — and, worse
   * than an ordinary inert key, it implied a switch that does not exist.
   * Sanitization is UNCONDITIONAL: `rehypePlugins` in
   * `packages/plugin-markdown/src/MarkdownImpl.tsx` is a module-level `const`
   * array whose last link is `[rehypeSanitize, sanitizeSchema]`, handed to
   * `ReactMarkdown` as-is — no ternary, no `if`, no runtime assembly. So
   * `sanitize: false` type-checked, passed the Zod mirror and changed nothing
   * while reading as a security-relevant control, and `sanitize: true`
   * promised a gate the author never controlled either. Both readings lied.
   * The enforce arm of enforce-or-remove would be a switch that DISABLES XSS
   * sanitization, which is not an acceptable outcome, so for this key the
   * ruling collapses to remove (triage on objectui#6972).
   *
   * Measured on the retiring PR's base: `MarkdownRenderer`
   * (`plugin-markdown/src/index.tsx`) forwards exactly `content` and
   * `className` to `MarkdownImpl`, whose props type accepts only those two;
   * `grep -rn "schema.sanitize"` over `packages/` and `apps/` returns nothing,
   * against a control of 20 `.tsx` files reading `schema.content` in the same
   * query shape — the zero is a reading, not a blind query.
   *
   * `?: never` is this package's tombstone convention (see `crud.ts`
   * `confirm`, {@link StaticTableColumn}, `DataTableSchema.toolbar` above),
   * NOT a deletion: `BaseSchema`'s `[key: string]: any` admitted a deleted key
   * as `any` until objectui#8347, and a widened value still carries one
   * unchecked — the same silence one layer over. The Zod twin refuses
   * it loudly via `retirementTombstone()` (`zod/data-display.zod.ts`). Both
   * published faces carry the refusal: `@object-ui/plugin-markdown` re-exports
   * this one authority (objectui#6172), so its consumers meet the same
   * declaration.
   *
   * RETIRED (objectui#6972, ADR-0049) — sanitization is unconditional; there
   * is no authored spelling that disables it. Delete the key.
   * @deprecated Not part of `MarkdownSchema`'s contract — the value was inert.
   */
  sanitize?: never;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `components` (objectui#6972).
   *
   * Declared `?: Record<string, any>` ("custom components for markdown
   * elements") and read by NOTHING: `MarkdownRenderer` forwards only `content`
   * and `className`, `MarkdownImplProps` accepts only those two, and the
   * `components` map `MarkdownImpl` hands to `ReactMarkdown` is its OWN
   * module-level `mdComponents` (the mermaid / metadata fence overrides),
   * never merged with anything off the schema. `grep -rn "schema.components"`
   * over `packages/` and `apps/` returns nothing, against the same
   * `schema.content` control as `sanitize` above.
   *
   * Removed rather than wired, under the PM's declared veto window on
   * objectui#6972: a map of React component overrides is not a
   * JSON-authorable value — the same shape as the handler keys objectui#6124
   * retired ("JSON has no function value"). It is NOT a `runtime-slot`
   * either: no host path (no `MarkdownImpl` prop, no plugin API, no app-shell
   * or runner site) consumes such a map, so there is no TypeScript twin to
   * keep callable for hosts. A real override slot must arrive as a proposal
   * WITH its enforcing reader, not by reviving this key.
   *
   * Same convention as `sanitize` above: `?: never` here,
   * `retirementTombstone()` on the Zod twin, both published faces.
   *
   * RETIRED (objectui#6972, ADR-0049) — never read by the markdown renderer.
   * Delete the key.
   * @deprecated Not part of `MarkdownSchema`'s contract — the value was inert.
   */
  components?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `markdown` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `markdown` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `markdown` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `markdown` registration (`@object-ui/plugin-markdown`) reads the node
   * through an inline props type and forwards only `content` and `className`
   * to the Markdown implementation; nothing on that path reads the node's
   * `body` or `children`. `SchemaRenderer` strips `body` and `children` out
   * of the props bag it spreads, so neither reaches the component by another
   * route, and the registration declares no `children` slot (objectui#9910).
   *
   * What it renders instead: `content`, rendered as sanitized Markdown.
   *
   * @deprecated Not a channel `markdown` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Tree view node
 */
export interface TreeNode {
  /**
   * Unique node identifier
   */
  id: string;
  /**
   * Node label
   */
  label: string;
  /**
   * Node icon
   */
  icon?: string;
  /**
   * Whether node is expanded by default
   * @default false
   */
  defaultExpanded?: boolean;
  /**
   * Whether node is selectable
   * @default true
   */
  selectable?: boolean;
  /**
   * Child nodes
   */
  children?: TreeNode[];
  /**
   * Additional data
   */
  data?: any;
}

/**
 * Tree view component
 */
export interface TreeViewSchema extends BaseSchema {
  type: 'tree-view';
  /**
   * RETIRED (`16a725f96`, ADR-0049 enforce-or-remove) — the second spelling
   * of the tree's one inline-nodes slot, read only as the LAST limb of
   * `boundData || schema.nodes || schema.data || []`. Maintainer ruling B1
   * (2026-09-04): retire `data`; `nodes` is the only inline spelling; `nodes`
   * stays OPTIONAL and no presence refinement is added — a `bind`-only
   * tree-view (`{ type: 'tree-view', bind: 'treeNodes' }`) is a legal,
   * rendering document because `bind` is the FIRST source the renderer reads.
   *
   * History: REQUIRED until `777e5c6f4` (PR #7533) made it optional (it had
   * refused four catalog entries the renderer draws correctly). That PR kept
   * it DECLARED because {@link BaseSchema} declares `data?: any` (zod twin
   * `z.any().optional()`), so deleting the member would ADMIT the key
   * unvalidated — and that same fact is why this is a tombstone, not a
   * deletion: `?: never` here beats the inherited `any`, and the zod tombstone
   * on the extended schema beats the base's `z.any()`; both directions are
   * pinned in `__tests__/tree-view-data-retired-6951.test.ts`. The renderer no
   * longer reads it (`tree-view.tsx:105` is `boundData || schema.nodes || []`).
   * Write `nodes` (or bind the tree with `bind`); the array is unchanged.
   * @deprecated Not part of this contract — write `nodes`.
   */
  data?: never;
  /**
   * Inline tree nodes — the ONE inline spelling.
   *
   * READ SITE: `renderers/data-display/tree-view.tsx:105`, the second limb of
   * `boundData || schema.nodes || []` — a `bind`-resolved value wins, and
   * {@link BaseSchema.bind} stays the first-read source, which is why this
   * member is optional and no "at least one of" rule exists (ruling B1, `16a725f96`).
   *
   * Declared by objectui#6150, which deliberately stopped at the declaration:
   * `{ type: 'tree-view', nodes }` only became a LEGAL document at
   * `777e5c6f4` (PR #7533), the accept-set change that relaxed the then
   * required `data`; `16a725f96` retired that `data` spelling outright (the
   * tombstone above). The registration's own `inputs` and `defaultProps`
   * spell it `nodes`, and the four catalog entries ARE those `defaultProps`.
   */
  nodes?: TreeNode[];
  /**
   * Heading rendered above the tree.
   *
   * READ SITE: `renderers/data-display/tree-view.tsx:115` (presence gate) and
   * `:117` (the `h3` body).
   */
  title?: string;
  /**
   * Default expanded node IDs
   */
  defaultExpandedIds?: string[];
  /**
   * Default selected node IDs
   */
  defaultSelectedIds?: string[];
  /**
   * Controlled expanded node IDs
   */
  expandedIds?: string[];
  /**
   * Controlled selected node IDs
   */
  selectedIds?: string[];
  /**
   * Enable multi-selection
   * @default false
   */
  multiSelect?: boolean;
  /**
   * Show lines connecting nodes
   * @default true
   */
  showLines?: boolean;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `tree-view` renderer spreads it onto a `<div>` that has no such event;
   * nodes receive only `onNodeClick`. The zod twin refuses it by name; author
   * behaviour as a node type (`{ "type": "toast" }`, an `action:button` node)
   * instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onSelectChange?: never;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `tree-view` renderer spreads it onto a `<div>` that has no such event;
   * nodes receive only `onNodeClick`. The zod twin refuses it by name; author
   * behaviour as a node type (`{ "type": "toast" }`, an `action:button` node)
   * instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onExpandChange?: never;
  /**
   * Node click handler — INVOKED, not merely read, so this is a call
   * signature and not a value shape.
   *
   * READ SITE: `packages/components/src/renderers/data-display/tree-view.tsx:98`
   * (presence gate `if (schema.onNodeClick)`) and `:99` (the call
   * `schema.onNodeClick(node)`), where `node` is the clicked
   * {@link TreeNode}. The handler's return value is discarded.
   *
   * ⚠️ THE MIRROR NOW DECLARES IT — as a NAMED REFUSAL, not as a shape
   * (`604476d97`, the `TreeViewSchema` slice; `handlerKeyRefusal(…,
   * 'runtime-slot', …)` in `../zod/data-display.zod.ts`). ⛔ This paragraph
   * used to say the key was "NOT mirrored, deliberately", citing
   * objectui#6152's ruling that a runtime slot never gets a mirror. That
   * ruling is intact and this is not an exception to it: what landed is not a
   * SHAPE for the function — `z.function()` is unsatisfiable by any serialized
   * document — but a refusal BY NAME, so the author of
   * `{ "type": "tree-view", "onNodeClick": { "action": "toast" } }` is told why
   * instead of having the object accepted by `BaseSchema`'s `.passthrough()`
   * and handed to this call site, which expects a function.
   *
   * ⇒ the key therefore sits in `__tests__/zod-mirror-parity.test.ts`'s
   * `KnownDrift` (declared on both faces, deliberately different shapes) and
   * ⛔ NO LONGER in `RuntimeOnlyDeclared`. The programmatic channel is
   * unchanged: a TypeScript host that builds this node still supplies the
   * function through THIS member, which is why it stays callable here.
   */
  onNodeClick?: (node: TreeNode) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `tree-view` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `bind`, `nodes`, `onNodeClick`, `title` (in
   * `packages/components/src/renderers/data-display/tree-view.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `tree-view` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `tree-view` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `bind`, `nodes`, `onNodeClick`, `title` (in
   * `packages/components/src/renderers/data-display/tree-view.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `tree-view` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Chart type
 */
/**
 * Chart Type — `@objectstack/spec`'s own `ChartType` re-exported (issue
 * #2231/#2901; formerly a hand-written union that had drifted to 7 of 19 values).
 *
 * Re-exported rather than restated, so a chart family the spec adds cannot go
 * missing here.
 */
export type ChartType = SpecChartType;

/**
 * One series of the objectui `ChartSchema` node — a display name that also
 * NAMES THE COLUMN to plot, plus that column's presentation options.
 *
 * ⚠️ It carries no numbers of its own. Rows come from the chart node's
 * chart-level `data`, `name` (or `dataKey`) selects the column within each row,
 * and the category axis comes from `xAxisKey` / `xAxis`. That is the model
 * `normalizeChartSchema` in `@object-ui/plugin-charts` implements, and the only
 * one it has ever implemented. This header described an inline `data` array
 * indexed by the chart's `categories` until `b0d308da9` measured that no such
 * reader exists; `data` is now a retirement tombstone — see the member below.
 *
 * Renamed off `ChartSeries` (objectstack#4115): `@objectstack/spec/ui` owns that
 * name for a **dataset-bound series descriptor** — `{ name, label?, type?,
 * stack?, yAxis, variant?, dashArray?, opacity? }`, where `name` identifies a
 * MEASURE and the values come from the query, so it carries no `data` at all.
 * The two are not mutually assignable in either direction. `@object-ui/plugin-charts`
 * talks to the spec's shape (`ChartSeries.type` per-series family overrides,
 * `ChartSeries.stack`); this one belongs to the static SDUI chart node.
 */
export interface ChartDataSeries {
  /**
   * Series name — also selects this series' column within each chart-level
   * `data` row when {@link dataKey} is absent.
   *
   * ⚠️ OPTIONAL since `5f789538d` (maintainer ruling 2026-09-02, the `chart`
   * row): `normalizeSeries` reads `str(raw.dataKey) ?? str(raw.name)`, so
   * `dataKey` alone is a complete binding and the required flag refused a
   * document the renderer draws. At least one of the two must still be present
   * — a series that resolves to neither is dropped in silence by the
   * normalizer, and the zod mirror refuses it by name.
   */
  name?: string;
  /**
   * Column this series plots within each chart-level `data` row — the internal
   * spelling of {@link name}, and the one the renderer takes when both are
   * written (`normalizeChartSchema.ts:239`).
   */
  dataKey?: string;
  /**
   * RETIRED (`b0d308da9`, ADR-0049 enforce-or-remove) — the inline-data model
   * this key belonged to was never implemented. `normalizeChartSchema`'s
   * `normalizeSeries` reads `dataKey`/`name`, `label`, `chartType`/`type`,
   * `variant`, `opacity`, `dashArray`, `stack`, `yAxis` and `color`; `data` is
   * not among them, so an authored array was dropped in silence — while the
   * declaration made it REQUIRED, so no author could leave it out.
   *
   * Put the rows on the chart node's own chart-level `data`, name the column
   * with this series' `name` (or `dataKey`), and put the category axis on
   * `xAxisKey`. Maintainer ruling 2026-08-31: immediate tombstone, no
   * dual-reading window.
   * @deprecated Not part of `ChartDataSeries`' contract — the value was inert.
   */
  data?: never;
  /**
   * Per-series chart family override, for a combo chart: this series draws as a
   * line (or bar, or area) on a chart whose own `chartType` is something else.
   *
   * Declared because the renderer already READS it and the documentation already
   * authored it (objectui#6121, maintainer ruling 2026-08-25). The read is
   * `normalizeChartSchema`'s `normalizeSeries` in `@object-ui/plugin-charts`:
   *
   *     const family = str(raw.chartType) ?? str(raw.type);
   *     if (family === 'bar' || family === 'line' || family === 'area') …
   *
   * so `type` is the AUTHOR spelling of the same override `chartType` carries
   * internally, and it reaches `NormalizedSeries.chartType` either way.
   *
   * ⚠️ The union is the three families that read does honour — NOT the full
   * {@link ChartType}. A `type: 'pie'` on a series is dropped in silence by the
   * normalizer, so declaring the wider union would advertise a per-series
   * override that nothing performs. `@objectstack/spec`'s own `ChartSeries.type`
   * is the wider `ChartType`; this is the objectui inline-data node's series, a
   * deliberately separate shape (objectstack#4115 — see this interface's header),
   * and it declares what its own renderer enforces.
   */
  type?: 'bar' | 'line' | 'area';
  /**
   * Series color
   */
  color?: string;
  /**
   * Legend / tooltip name for this series — the spec's `I18nLabel`: a plain
   * string, or an inline locale map (`{ en: 'Revenue', 'zh-CN': '收入' }`),
   * the same spelling as {@link BaseSchema.label}.
   *
   * Declared by objectui#7546. `normalizeSeries` reads it through `label()`
   * (`normalizeChartSchema.ts:242` — a string as-is, the first string value of
   * a map), and the legend takes it at `ChartRenderer.tsx:157`
   * (`s.label || s.dataKey`) and `AdvancedChartImpl.tsx:1364`. Until this
   * declaration the Zod mirror STRIPPED it in silence — `ChartDataSeriesSchema`
   * is a non-strict `z.object` — so a parsed series lost its name and the
   * legend fell back to the column key.
   */
  label?: string | I18nLabel;
  /**
   * Visual role. `'comparison'` is the muted period-over-period overlay
   * (`AdvancedChartImpl.tsx:2010-2033` — lower opacity, dashed stroke, and it
   * is left out when the primary series are counted); `'primary'` (the
   * default) is the normal treatment.
   *
   * The union is the spec's own `ChartSeries.variant` pair. The normalizer
   * also tolerates a third spelling, `'current'` (`normalizeChartSchema.ts:247`),
   * but that is the renderer's INTERNAL default — written only by the
   * compare-to producers onto `dataKey`-shaped arrays handed straight to
   * `ChartRenderer` (`ObjectChart.tsx:852`, `DatasetWidget.tsx:1486`), which
   * never pass through this mirror — and by nothing an author writes (docs,
   * fixtures and designer inputs: 0, controls lit). It is NOT a member here,
   * so the published face does not fossilise a renderer-side tolerance into a
   * second contract (AGENTS.md #0.1); the normalizer's own tolerance is
   * a separate card's decision and is unchanged by this. Any other value is
   * dropped in silence by the normalizer, so the mirror refuses it by name
   * instead (objectui#7546).
   */
  variant?: 'primary' | 'comparison';
  /**
   * Stroke and fill opacity. Read by `num()` (`normalizeChartSchema.ts:365`
   * — any finite number; the mirror refuses `NaN`, `Infinity` and strings the
   * same way) and applied by `seriesStyle` (`AdvancedChartImpl.tsx:114-115`),
   * which hands it to EVERY mark family: `fillOpacity` on a Bar or Scatter
   * mark, `strokeOpacity` on a Line mark, both on an Area mark (objectui#7546).
   * Declared as the read's own domain: the spec's `ChartSeries.opacity` bounds
   * it to 0–1, a bound the renderer does not enforce (SVG clamps at paint,
   * nothing is dropped), so the mirror does not refuse an out-of-range value
   * either.
   *
   * UNCONDITIONAL, as the spec declares it: it applies whatever the series'
   * `variant`. It used to be honoured only on a `variant: 'comparison'` series
   * — `comparisonStyle` returned `null` for any other variant, so elsewhere the
   * value was read and then discarded — and objectui#7698 closed that in the
   * RENDERER rather than by narrowing this face to match (AGENTS.md #0.1).
   * What is still gated on `variant: 'comparison'` is the DEFAULT this key
   * overrides: the muted treatment a comparison overlay gets when it carries
   * no `opacity` of its own.
   */
  opacity?: number;
  /**
   * SVG `stroke-dasharray` override, e.g. `"4 4"` for a dashed line
   * (`normalizeChartSchema.ts:367`; applied by `seriesStyle`,
   * `AdvancedChartImpl.tsx:116`) (objectui#7546).
   *
   * UNCONDITIONAL, as the spec declares it, and reaching every mark family —
   * but only a STROKED mark shows a dash, and this renderer strokes Line and
   * Area marks, so on a Bar or Scatter mark the value reaches the DOM and
   * paints nothing. That is the mark's own geometry, not a condition on the
   * key, and it is the one asymmetry with {@link ChartDataSeries.opacity},
   * which paints on every family.
   *
   * TWO gaps used to narrow it, and objectui#7698 closed both: the
   * `variant: 'comparison'` guard that discarded it on a primary series, and
   * the Bar and Scatter marks, which passed `fillOpacity` only and dropped
   * `strokeDasharray` (and `strokeOpacity`) even where a comparison series had
   * authored one — so a fix aimed at the guard alone would have left this key
   * broken on those two families. What is still gated on
   * `variant: 'comparison'` is the DEFAULT it overrides: the overlay's `'4 4'`
   * dash on a Line or Area mark.
   */
  dashArray?: string;
  /**
   * Stack group id — series sharing one id stack together. Becomes Recharts'
   * `stackId` (`normalizeChartSchema.ts:252`; `AdvancedChartImpl.tsx:1893`,
   * `:2023`) (objectui#7546).
   */
  stack?: string;
  /**
   * Which y-axis this series binds to on a dual-axis chart. Narrowed to the two
   * sides the renderer binds (`normalizeChartSchema.ts:254-255`;
   * `AdvancedChartImpl.tsx:1887`, `:2019`) — the spec's `ChartSeries.yAxis`
   * carries the same union (objectui#7546).
   */
  yAxis?: 'left' | 'right';
  /**
   * NOT A KEY OF THIS SERIES — a named ALIAS REFUSAL pointing at {@link type}
   * (objectui#7694; `domain:ui` PM ruling on objectui#7546 and the contract
   * review of `8fe8e5c16`'s pull request: option A, the posture `@objectstack/spec` takes).
   *
   * `chartType` is the renderer's INTERNAL spelling of the declared `type`: the
   * first limb of `normalizeSeries`' `str(raw.chartType) ?? str(raw.type)`
   * (`normalizeChartSchema.ts:244`), written only by the internal-shape
   * producers that hand `dataKey`-shaped arrays straight to `ChartRenderer`
   * (`ObjectChart.tsx`, `DatasetWidget.tsx`; `core/utils/chart-presentation.ts`
   * translates authored `type` INTO it) — and by no author. Re-measured at
   * implementation time, series-level, with lit controls
   * (`dataKey` / `name` / `type` / `color`): docs 0 (controls 10 / 11 / 2 / 2),
   * fixtures 0 (3 / 2 / 0 / 2), designer inputs 0 (the `chart` registration's
   * `series` is one `code` input), src literals 0 (13 / 3 / 1 / 0), tests 9
   * (70 / 48 / 11 / 8 — every one an internal-shape array that never meets the
   * mirror). Limb ablation over 304 files / 5817 tests: deleting
   * `str(raw.chartType) ??` left all green; deleting `?? str(raw.type)` went
   * 2 red. The card's readings, re-taken, agree.
   *
   * The spec's `ChartSeriesSchema` lists `chartType` in its alias map as a
   * spelling of `type` and refuses it by name — "Did you mean `chartType` →
   * `type`?" — and this face answers with the same sentence
   * (`aliasKeyRefusal()` in `zod/tombstone.zod.ts`). The two alternatives were
   * ruled out: FOLDING it onto `type` would let the alias overwrite the
   * canonical key when both are written (the renderer reads `chartType` FIRST,
   * inverting objectui#7113's precedence rule), and DECLARING it as a second
   * writable name would mint the N-dialects hazard of AGENTS.md #0.1 against
   * the spec's own alias map.
   *
   * Until this declaration the non-strict Zod mirror STRIPPED the key in
   * silence: `{ name: 'x', chartType: 'line' }` parsed green to `{ name: 'x' }`
   * and the series drew in the chart's family — precisely what the author was
   * overriding. Now the mirror refuses it by name and this `?: never` is a
   * `tsc` error at the authoring site. Write {@link type}. The renderer's own
   * read of the internal spelling is untouched — a reader decision, not this
   * declaration's.
   */
  chartType?: never;
  /**
   * NOT A KEY OF THIS SERIES — refused by name (objectui#11681).
   *
   * `aggregate` is the renderer-internal carrier of a dataset measure's
   * aggregate: `buildChartSeries` (`@object-ui/core`) copies it from the
   * dataset answer's `fields[].aggregate`, and a value axis whose series all
   * plot a `count` / `count_distinct` draws whole-number ticks. An author has
   * no business writing it — `aggregate: 'count'` on a currency sum would
   * strip the decimals the axis needs — so `ChartDataSeriesSchema.aggregate`
   * refuses it by name and this `?: never` is a `tsc` error at the authoring
   * site. Declare the aggregate on the dataset measure instead.
   */
  aggregate?: never;
}

/**
 * Chart component
 */
export interface ChartSchema extends BaseSchema {
  type: 'chart';
  /**
   * Chart type
   */
  chartType: ChartType;
  /**
   * Chart title
   */
  title?: string;
  /**
   * Chart description
   */
  description?: string;
  /**
   * An ALTERNATIVE SERIES LIST — not axis labels.
   *
   * ⚠️ Read this before authoring. `normalizeChartSchema` consumes `categories`
   * only when `series` is absent, and then runs each entry through the same
   * series normalizer, where a bare string means `{ dataKey }`. So these strings
   * name COLUMNS TO PLOT, exactly as `series` does — they do not label the
   * category axis, and when `series` IS present they are ignored outright.
   *
   * The category axis comes from `xAxisKey` / `xAxis`. This docblock read
   * "X-axis labels/categories" until `b0d308da9` measured the read that has
   * always been there (maintainer ruling 2026-08-31 — prose follows machine).
   */
  categories?: string[];
  /**
   * Data series
   */
  series: ChartDataSeries[];
  /**
   * Rows to plot — one object per row, keyed by column name. A series' `name`
   * (or `dataKey`) picks the column to plot within each row, and
   * {@link xAxisKey} names the category column.
   *
   * ⚠️ Declared by objectui#7113. This is the data model the renderer has always
   * implemented and this interface never declared: rows reached
   * `ChartRenderer.tsx:164` and were read back as columns at
   * `AdvancedChartImpl.tsx:2229` while surviving here only on `BaseSchema`'s
   * index signature. The `ChartDataSeries.data` tombstone above has been
   * pointing authors at this key since `b0d308da9`.
   */
  data?: Array<Record<string, any>>;
  /**
   * Row key holding the category (x) axis.
   *
   * The bare-string sibling spelling `xAxis: 'month'` folds onto this key when
   * the zod mirror parses, and does not survive the parse. The spec's `xAxis`
   * CONFIG OBJECT is a different key and is not folded — its `field` also
   * answers the column question, but its `format` / `title` / `showGridLines`
   * are presentation the fold would discard. It is declared as {@link xAxis}.
   */
  xAxisKey?: string;
  /**
   * The category (x) axis — `@objectstack/spec`'s axis CONFIG object, the type of
   * `ChartConfigSchema.xAxis`: `{ field, title, format, min, max, stepSize,
   * showGridLines, position, logarithmic }`, strict, with `field` required.
   *
   * Declared by objectui#7690 (ruling 5809510046, branch 2 — declare). The spec
   * declares the object and this node renders it — `normalizeChartSchema` reads
   * exactly its nine keys — so the type IS the spec's, not a restatement of it.
   * Until then the object survived only on `BaseSchema`'s index signature: read
   * by the renderer, checked by nothing.
   *
   * `field` names the category column exactly as {@link xAxisKey} does, and
   * `xAxisKey` wins when both are written — the renderer's own precedence.
   *
   * The `string` arm is NOT a second spelling of the axis object: it is the
   * objectui#7113 alias of {@link xAxisKey}, accepted at parse and folded onto
   * that key, so it never survives a parse. Write `xAxisKey` for the column.
   */
  xAxis?: string | SpecChartAxis;
  /**
   * The value (y) axes — an ARRAY of `@objectstack/spec`'s axis CONFIG objects,
   * the type of `ChartConfigSchema.yAxis`. The first entry is the primary axis;
   * a second entry declares the right-hand axis a series binds to with
   * `yAxis: 'right'`.
   *
   * Declared by objectui#7690 beside {@link xAxis}, and for the same reason.
   * Only the spec's list is a member: a single axis object, or a bare column
   * name, is refused at parse by name.
   *
   * With neither {@link series} nor {@link categories}, the axes' `field`s name
   * the plotted columns.
   */
  yAxis?: SpecChartAxis[];
  /**
   * Chart height
   */
  height?: string | number;
  /**
   * Chart width
   */
  width?: string | number;
  /**
   * Show legend
   * @default true
   */
  showLegend?: boolean;
  /**
   * Show grid
   * @default true
   */
  showGrid?: boolean;
  /**
   * Enable animations
   * @default true
   */
  animate?: boolean;
  /**
   * Chart configuration (library-specific)
   */
  config?: Record<string, any>;
  /**
   * Optional drill-down configuration. When enabled, clicking a chart
   * segment opens a filtered list view (drawer/dialog).
   */
  drillDown?: DrillDownConfig;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `chart` reads NEITHER content
   * channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `chart` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `chart` reads NEITHER content
   * channel, so an authored child list here rendered NOTHING: no render-time
   * error or warning and no element; only the parser tier's `not-a-container`
   * warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The `chart`
   * registration (`@object-ui/plugin-charts`, and its `chart:bar` alias)
   * reads the node through `ChartRenderer`'s inline props type; nothing on
   * that path reads the node's `body` or `children`. `SchemaRenderer` strips
   * `body` and `children` out of the props bag it spreads, so neither reaches
   * the component by another route, and the registration declares no
   * `children` slot (objectui#9910).
   *
   * What it renders instead: a chart of the `data` rows, drawn by `chartType`
   * and `series`.
   *
   * @deprecated Not a channel `chart` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Aggregation function for pivot table values
 */
export type PivotAggregation = 'sum' | 'count' | 'avg' | 'min' | 'max';

/**
 * Declarative drill-down configuration shared by pivot tables and charts.
 *
 * When a user clicks a pivot cell / chart segment, the engine opens a side
 * drawer (default) listing the underlying records filtered by the click
 * context. All values support `${event.*}` interpolation; sensible defaults
 * are derived from the widget's row/column/groupBy fields when omitted.
 *
 * Pivot event payload:  rowKey, colKey, rowLabel, colLabel, value, scope
 * Chart event payload:  category, series, value
 *
 * ## Declared = delivered (objectui#3354)
 *
 * Every key below is read by at least one block that takes this interface or a
 * per-block shape derived from it. A block that can never honour a key refuses
 * it by name on its own shape rather than accepting and dropping it
 * ({@link ObjectMetricDrillDownConfig}, {@link ObjectPivotDrillDownConfig},
 * {@link ObjectDataTableDrillDownConfig}; objectui#9002, objectui#10685), so
 * every `target` arm a block's shape admits is one that block honours:
 * `object-data-table`'s shape admits `'drawer'` and `'dialog'` only. Two keys
 * used to break that rule for every block and were removed rather than left as
 * authoring bait:
 *
 *  - `view?: string` — self-described as "reserved"; no renderer ever looked it
 *    up, so the drawer rendered its inline `object-data-table` regardless.
 *  - `sort?: Array<{ field; dir? }>` — documented as "default sort applied to
 *    the drill list"; no widget passed it into the drilled table schema.
 *
 * Do not re-add a key here before a renderer reads it. This type is what the
 * protocol's own `drillDown` declaration is derived from (objectstack#5022), so
 * a dead key here becomes a dead key with protocol authority.
 */
export interface DrillDownConfig {
  /** Master switch. Set to true (or supply any other field) to enable. */
  enabled?: boolean;
  /**
   * Which drill interaction a row click performs. Read by `object-data-table`
   * alone, on its row click (objectui#10685):
   *
   * - `'record'` (the default) — **drill-to-record**: the clicked row already
   *   *is* a single record, so the drawer shows that record's detail. This
   *   mirrors Salesforce list-view row → record and Power BI's "see records"
   *   row interaction.
   * - `'filter'` — **drill-through**: the interaction of a click point that is
   *   an aggregated bucket, listing the records behind it filtered by the click
   *   context. A table row is not such a bucket, and `object-data-table` has no
   *   drill-through arm, so there this value turns the row drill off.
   *
   * A block whose every click point is an aggregate always drills through, so
   * it has nothing for this key to choose and refuses it on its own drill shape
   * ({@link ObjectPivotDrillDownConfig}, {@link ObjectMetricDrillDownConfig}).
   */
  mode?: 'filter' | 'record';
  /**
   * Where the drill-down lands. Defaults to `'drawer'`.
   *
   * - `'drawer'` — in-place side sheet listing the records (peek without
   *   leaving the dashboard). The mainstream default.
   * - `'dialog'` — same content in a centered modal (used when stacking over
   *   another drawer).
   * - `'navigate'` — skip the in-place view and go straight to the object's
   *   full list page (sort / bulk-select / export / shareable URL). Requires a
   *   host that provides drill navigation (see `DrillNavigationContext`); falls
   *   back to `'drawer'` when none is available.
   *
   * Independent of `target`, the in-place drawer also offers an "Open in list →"
   * affordance when a host navigation handler is present, so users can escalate
   * from a peek to the full list at any time.
   */
  target?: 'drawer' | 'dialog' | 'navigate';
  /**
   * Filter applied to the drilled list view. Each value supports
   * `${event.x}` interpolation (e.g. `"${event.rowKey}"`).
   * When omitted, the engine derives a default filter from the widget's
   * row/column/groupBy fields and the click payload.
   */
  filter?: Record<string, unknown>;
  /** Drawer/dialog title. Supports `${event.*}` interpolation. */
  title?: string;
  /**
   * Drill into an analytical report instead of the raw record list.
   *
   * This is the M3 "Dashboard → Report → List → Record" path: the KPI on the
   * dashboard expands into a multi-dimensional breakdown report; the report
   * itself can drill into a list of records (via its own row-click drill),
   * which can drill into a single record.
   *
   * The report is written inline and is dataset-bound (ADR-0021),
   * `@objectstack/spec`'s `ReportSchema` author shape by reference: the document
   * the drawer wraps in the `report` node, whose `report` member is that same
   * schema (objectui#11440), so its members, required keys and refusals apply
   * unchanged. The drawer joins the block's resolved drill filter to the
   * report's own `runtimeFilter` with `$and` and writes the result as the
   * report's `runtimeFilter`, the one filter key the dataset renderer applies
   * (objectui#5137, objectui#11506). The spec refuses `filter` here.
   *
   * ⛔ The pre-9.0 object-bound form (`objectName` plus column objects) is
   * retired (objectui#11506), with no alias window: nothing produced it, the
   * spec refuses it (`objectName` is an alias of `dataset`), and through the
   * real drawer it drew an empty presentation and issued no query, so a drill
   * filter reached nothing under either key.
   *
   * ⛔ The named reference, `{ name }`, is retired too (objectui#11517), with no
   * alias window: no renderer resolved a report name against any registry, so
   * `DrillDownDrawer` listed the records for it, as for a drill with no
   * `report`, and nothing produced it. A bare `{ name }` is not a report: this
   * type refuses it for the members the spec requires, and both zod faces refuse
   * it by name.
   */
  report?: SpecReportInput;
  /**
   * Optional column whitelist for the inline drill list. When omitted the
   * data table renders all default columns.
   */
  columns?: string[];
  /** Hard cap on rows fetched. */
  maxRows?: number;
}

/**
 * The `object-metric` block's drill-down shape: {@link DrillDownConfig} with
 * `filter` and `mode` REFUSED BY NAME (objectui#9002, ruling B, a per-block
 * refusal). The shared type keeps both members for the blocks that read them;
 * only this block's declaration takes them away.
 *
 * A metric is one aggregated number, so neither member has anything to act on:
 *
 *  - `filter` is interpolated against a click event (`${event.*}`) by
 *    `computeDrillFilter`, and a metric tile has no click context: no row,
 *    column, category or series. The drilled list is scoped by the metric's
 *    OWN `filter` instead, which is the block's registered promise that the
 *    number and the records behind it always agree. An override would break
 *    that promise.
 *  - `mode` decides drill-to-record versus drill-through for a clicked ROW. A
 *    metric has no row. It always drills through to its records.
 *
 * Refused as `?: never` tombstones rather than omitted: an omitted key on an
 * object literal is an excess-property error only while the literal is fresh,
 * and a tombstone also carries the reason and the block that does read the key
 * into the error an author (or an AI) sees at the declaration.
 *
 * ⚠️ This is a TypeScript declaration, so it refuses the keys where an author
 * types against it (`ObjectMetricWidget`'s `drillDown` prop). A stored JSON
 * config reaches the block without passing through this type.
 */
export interface ObjectMetricDrillDownConfig extends DrillDownConfig {
  /**
   * REFUSED BY NAME on `object-metric` (objectui#9002). A metric has no click
   * event for `${event.*}` to resolve against, and its drilled list is scoped
   * by the metric's own `filter`. Drill filters apply on `object-chart` and
   * `object-pivot`, which hand this member to `computeDrillFilter`.
   *
   * @deprecated Not a member `object-metric` reads. Scope the metric with its own `filter`.
   */
  filter?: never;
  /**
   * REFUSED BY NAME on `object-metric` (objectui#9002). A metric has no row to
   * open as a record, so it always drills through to the records behind the
   * number. `mode` applies on `object-data-table`, whose row click reads it.
   *
   * @deprecated Not a member `object-metric` reads. A metric always lists its records.
   */
  mode?: never;
}

/**
 * The `object-pivot` block's drill-down shape: {@link DrillDownConfig} with
 * `mode` REFUSED BY NAME (objectui#10685, which applies objectui#9002's ruling
 * B, a per-block refusal, to the sibling blocks of `object-metric`).
 *
 * Every click point on a pivot is an aggregated bucket: a cell, a row or
 * column header, or a total, and never a single record. So a pivot always
 * drills through to the records behind the clicked value, and `mode`, which
 * chooses drill-to-record for a clicked ROW, has nothing to choose here. Every
 * other member is read: `enabled` by `isDrillEnabled`, `filter` by
 * `computeDrillFilter`, `title` by `resolveDrillTitle`, and `target`,
 * `columns`, `maxRows` and `report` by the `DrillDownDrawer` the block opens.
 *
 * A `?: never` tombstone rather than an omission, for the reason
 * {@link ObjectMetricDrillDownConfig} gives: it also refuses a value that is
 * not a fresh literal, and it carries the reason into the error an author (or
 * an AI) sees.
 *
 * ⚠️ This is a TypeScript declaration, so it refuses the key where an author
 * types against it (`ObjectPivotTable`'s `schema.drillDown`). A stored JSON
 * config is judged by the `object-pivot` arm of `@object-ui/types/zod` since
 * objectui#11440, which refuses `mode` by name in the bag's `drillDown`.
 * (`PivotTableSchema`, the plain `pivot` node, gained its own zod mirror in
 * objectui#10859 batch 2, and there `drillDown` is refused whole:
 * the key is a retirement tombstone on both faces since objectui#10932, because
 * nothing drills a `pivot` node. This type is where a pivot drill is authored.)
 */
export interface ObjectPivotDrillDownConfig extends DrillDownConfig {
  /**
   * REFUSED BY NAME on `object-pivot` (objectui#10685). A pivot's click point
   * is always an aggregated bucket, so it always drills through to the records
   * behind it, and there is no row to open as a record. `mode` applies on
   * `object-data-table`, whose row click reads it.
   *
   * @deprecated Not a member `object-pivot` reads. A pivot always lists the records behind the clicked value.
   */
  mode?: never;
}

/**
 * The `object-data-table` block's drill-down shape: {@link DrillDownConfig}
 * with `filter`, `maxRows` and `report` REFUSED BY NAME and `target` narrowed
 * to its two in-place arms (objectui#10685, which applies objectui#9002's ruling
 * B, a per-block refusal, to the sibling blocks of `object-metric`).
 *
 * A data table drills to the RECORD its clicked row already is: the row click
 * opens that record in `RecordDetailDrawer`, which lists nothing. The three
 * refused members each configure a drilled record LIST (the filter that scopes
 * it, the cap on its rows, the report that replaces it), and this block has no
 * list drill for them to apply to: `mode: 'filter'` turns its row drill off
 * rather than drilling through. `target: 'navigate'` opens the object's full
 * LIST page through the host's `openRecordList`, which is the wrong destination
 * for one record, and the block used to draw it as a drawer instead.
 *
 * What the block reads: `enabled` by `isDrillEnabled`; `mode`, where `'record'`
 * (the default) opens the row and `'filter'` turns the drill off; `title`, a
 * non-template title that heads the record drawer; `columns`, the record
 * drawer's field whitelist; and `target`, `'drawer'` or `'dialog'`.
 *
 * `?: never` tombstones for the reason {@link ObjectMetricDrillDownConfig}
 * gives: they refuse a value that is not a fresh literal too, and they carry
 * the reason into the error an author (or an AI) sees.
 *
 * Twin of the `drillDown` member of `ObjectDataTableSchema`'s zod mirror
 * (`zod/objectql.zod.ts`), which refuses the same members by name, so a stored
 * JSON config carrying one is refused at `objectui validate` as well.
 */
export interface ObjectDataTableDrillDownConfig extends DrillDownConfig {
  /**
   * REFUSED BY NAME on `object-data-table` (objectui#10685). A drill `filter`
   * scopes a drilled record list, and this block drills to the one record its
   * row already is. Drill filters apply on `object-chart` and `object-pivot`,
   * which hand this member to `computeDrillFilter`.
   *
   * @deprecated Not a member `object-data-table` reads. A row opens the record it already is.
   */
  filter?: never;
  /**
   * REFUSED BY NAME on `object-data-table` (objectui#10685). `maxRows` caps a
   * drilled record list, and this block drills to one record. It applies on
   * `object-chart`, `object-pivot` and `object-metric`, whose drill lists page
   * by it.
   *
   * @deprecated Not a member `object-data-table` reads. A row opens the record it already is.
   */
  maxRows?: never;
  /**
   * REFUSED BY NAME on `object-data-table` (objectui#10685). A drill `report`
   * replaces a drilled record list, and this block drills to one record. It
   * applies on `object-pivot` and `object-metric`, whose `DrillDownDrawer`
   * renders it.
   *
   * @deprecated Not a member `object-data-table` reads. A row opens the record it already is.
   */
  report?: never;
  /**
   * Where the record drill lands: `'drawer'` (the default) or `'dialog'`.
   *
   * `'navigate'` is REFUSED on `object-data-table` (objectui#10685): it opens
   * the object's full list page through the host's `openRecordList`, and this
   * block's row opens one record. `'navigate'` applies on `object-chart`,
   * `object-pivot` and `object-metric`.
   */
  target?: 'drawer' | 'dialog';
}

/**
 * Pivot table (cross-tabulation) component
 *
 * Renders a matrix where rows correspond to one field,
 * columns to another, and cells show an aggregated value.
 */
export interface PivotTableSchema extends BaseSchema {
  type: 'pivot';
  /**
   * Pivot table title
   */
  title?: string;
  /**
   * Field used for row headers
   */
  rowField: string;
  /**
   * Field used for column headers
   */
  columnField: string;
  /**
   * Field whose values are aggregated in cells
   */
  valueField: string;
  /**
   * Aggregation function applied to valueField
   * @default 'sum'
   */
  aggregation?: PivotAggregation;
  /**
   * Source data rows
   */
  data: Record<string, unknown>[];
  /**
   * Show a totals column on the right
   * @default false
   */
  showRowTotals?: boolean;
  /**
   * Show a totals row at the bottom
   * @default false
   */
  showColumnTotals?: boolean;
  /**
   * Numeric format string (e.g. "$,.2f") — applied via simple prefix/suffix/decimals
   */
  format?: string;
  /**
   * Mapping of column header values to Tailwind text-color classes
   */
  columnColors?: Record<string, string>;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `drillDown` on the `pivot` node
   * (objectui#10932, triage grade: retire, do NOT wire a drill).
   *
   * What was measured: declared here as the shared {@link DrillDownConfig},
   * accepted by the zod arm, and honoured by nothing. `PivotTable` fired a
   * drill only when its HOST passed an `onDrillDown` handler, and the one host
   * that does is `ObjectPivotTable` (`object-pivot`). The `pivot` registration
   * hands the node to `PivotTable` bare, console's lazy stub loads that same
   * registration, and `DashboardGridLayout`'s static-data pivot is rendered
   * through it, so every `pivot` path left the key inert: clicking a cell did
   * nothing, with no signal. A static-data pivot also has nothing to drill
   * into: a drill lists the records behind a value, and a pivot over inline
   * `data` names no object to query them from.
   *
   * `?: never` is this package's tombstone convention (see
   * `DataTableSchema.toolbar`, {@link StaticTableColumn}), NOT a deletion:
   * `BaseSchema`'s `[key: string]: any` admitted a deleted key as `any` until
   * objectui#8347, and a widened value still carries one unchecked. The Zod twin refuses it loudly via `retirementTombstone()`
   * (`zod/data-display.zod.ts`), naming the same remedy.
   *
   * RETIRED (objectui#10932, ADR-0049) — a `pivot` node draws a cross-tab of
   * the rows you pass in and drills nowhere. For a pivot whose cells open the
   * records behind a value, author an `object-pivot` (`objectName` + the same
   * `rowField` / `columnField` / `valueField`), whose `drillDown` is
   * {@link ObjectPivotDrillDownConfig}.
   *
   * @deprecated Not a member `pivot` reads — author `object-pivot` to drill.
   */
  drillDown?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `pivot` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `bind`, `columnField`, `data`, `filter`, `objectName`, `rowField`, `title`
   * (in `packages/plugin-dashboard/src/ObjectPivotTable.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `pivot` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `pivot` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `bind`, `columnField`, `data`, `filter`, `objectName`, `rowField`, `title`
   * (in `packages/plugin-dashboard/src/ObjectPivotTable.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `pivot` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Timeline event — the element type of the RETIRED `TimelineSchema.events`
 * (objectui#6170, ADR-0049 stage 2).
 *
 * `TimelineSchema.events`, the member that named it, is now a `?: never`
 * tombstone, and no renderer ever read it. It stays exported because retiring
 * a published type NAME is a separate break that ruling did not name. ⛔ Not a timeline element shape — an authored feed entry is a
 * {@link TimelineFeedItem} (its date key is `time`, not `date`).
 */
export interface TimelineEvent {
  /**
   * Event unique identifier
   */
  id?: string;
  /**
   * Event title
   */
  title: string;
  /**
   * Event description
   */
  description?: string;
  /**
   * Event date/time
   */
  date: string | Date;
  /**
   * Event icon
   */
  icon?: string;
  /**
   * Event color
   */
  color?: string;
  /**
   * Event content
   */
  content?: SchemaNode | SchemaNode[];
}

/**
 * The axis-bucket vocabulary for the `gantt` variant.
 *
 * One spelling, one source: these are exactly the six values of
 * `@objectstack/spec` `ui/TimelineConfig.json#scale`, and exactly the six
 * `TIMELINE_SCALES` that `packages/plugin-timeline/src/renderer.tsx`
 * (`resolveTimelineScale`) accepts. Declared here so the two agree by
 * construction rather than by coincidence.
 */
export type TimelineScale = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * The colour an authored timeline element names — a feed item's marker, or a
 * gantt bar. Exactly the five `content/docs/plugins/plugin-timeline.mdx`
 * documents under "Marker Variants" (objectui#6356, ruling Q2 = C).
 *
 * The marker primitive paints three more (`todo`, `in-progress`, `done`).
 * Those are reached only by `ObjectTimeline`, which composes a record's own
 * value into this slot through the renderer-internal handoff type in
 * `packages/plugin-timeline` — they are not an authoring vocabulary, and the
 * gantt bar paints none of them.
 */
export type TimelineItemVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

/**
 * One authored element of a FEED timeline — `variant` `vertical` (the default)
 * or `horizontal` (objectui#6356).
 *
 * ## The seven keys, and why there are no more
 *
 * Maintainer ruling on objectui#6356, Q1 = A: the authored feed element
 * declares the seven keys the docs page documents and every authored corpus
 * writes — and nothing else. `ObjectTimeline` composes five further keys onto
 * each record it maps (`color`, `group`, `meta`, `startDate`, `endDate`, plus
 * the `_data` record handle), and `TimelineRenderer`'s vertical branch reads
 * them; the horizontal branch reads none of them. They are RENDERER-INTERNAL:
 * typed by the handoff type inside `packages/plugin-timeline`, never declared
 * here, and refused when authored on the strict authoring face.
 *
 * This interface is closed on purpose. An object literal typed
 * {@link TimelineSchema} that carries a key no arm of the element declares is
 * an excess-property error, and the zod mirror's strict authoring face refuses
 * the same key by name.
 */
export interface TimelineFeedItem {
  /** When it happened — an ISO 8601 date string, formatted by `dateFormat`. */
  time?: string;
  /**
   * The entry's heading. REQUIRED (objectui#6356, ruling Q2 = C): it is the
   * key that tells a feed item from a gantt row, and the zod mirror judges
   * each element against the arm `variant` selects by it.
   */
  title: string;
  /** Secondary line under the title. */
  description?: string;
  /** Marker colour. */
  variant?: TimelineItemVariant;
  /** Emoji or short text drawn inside the marker. */
  icon?: string;
  /** Extra content rendered below the description. */
  content?: SchemaNode | SchemaNode[];
  /** Tailwind classes for the entry. */
  className?: string;
}

/**
 * One bar inside a {@link TimelineGanttItem} (objectui#6356).
 *
 * Every key is optional, and that is the ruling's scope rather than an
 * omission: objectui#6356 made the ROW's `label` required and named nothing on
 * the bar. A bar with no usable dates is not a validation failure — it reaches
 * the render-time `timeline.gantt.unusableRange` diagnostic, which stays the
 * defined outcome for it (objectui#6759, objectui#6770).
 *
 * ⚠️ A `type` alias and not an `interface`, on purpose. It sits one level down
 * inside {@link TimelineGanttItem}, whose zod twin's bar is `.passthrough()`,
 * so the twin's input type carries a string index signature there. An
 * interface has no IMPLICIT index signature and is not assignable to one; an
 * object type literal is. As an interface, `TimelineGanttItem.items` read as
 * narrower-than-declared in `zod-mirror-parity.test.ts` for that reason alone,
 * though both faces accept the same bars. A literal typed with it is still
 * checked for excess properties exactly as an interface is.
 */
export type TimelineGanttItemBar = {
  /** Bar label, drawn inside the bar and in its tooltip. */
  title?: string;
  /**
   * Bar start. The accept set is the renderer's own date rule (objectui#6781,
   * ruling 2026-08-30, option A): a string, a FINITE number (epoch
   * milliseconds), or a `Date`.
   */
  startDate?: string | number | Date;
  /**
   * Bar end — same accept set as {@link TimelineGanttItemBar.startDate}.
   *
   * Inclusive for a date-only value (objectui#11112): a `YYYY-MM-DD` end is
   * drawn through the end of the day it names, so `2024-01-01` to
   * `2024-01-31` fills January and a bar that starts and ends on the same day
   * is one day wide. A value with a time part, a number or a `Date` is an
   * instant, and the bar ends at it.
   */
  endDate?: string | number | Date;
  /** Bar colour. */
  variant?: TimelineItemVariant;
};

/**
 * One authored ROW of a gantt timeline — `variant: 'gantt'` (objectui#6356).
 *
 * `label` is REQUIRED (ruling Q2 = C) for the reason `title` is on
 * {@link TimelineFeedItem}: it tells a row from a feed item. `items` stays
 * optional — a row with no bars yet is an ordinary empty state (objectui#6750).
 */
export interface TimelineGanttItem {
  /** Row label, drawn in the row-label gutter. */
  label: string;
  /** The row's bars. */
  items?: TimelineGanttItemBar[];
}

/**
 * Timeline component (`type: 'timeline'`).
 *
 * ## The members below are the set `TimelineRenderer` actually reads
 *
 * objectui#6170, maintainer ruling 2026-08-25 (「同意」), the same family rule
 * adopted on objectui#6172: **the exported type aligns to the measured
 * authored + read set.** Before that ruling this interface declared `events` /
 * `orientation` / `position` and nothing else, and the divergence was
 * invisible to `tsc` because {@link BaseSchema} carried `[key: string]: any` —
 * every key the renderer reads resolved as `any`, so `schema: TimelineSchema`
 * constrained nothing. (The index signature itself was objectui#5155 /
 * objectui#6269's, deliberately not touched here; objectui#8347 removed it.)
 *
 * Measured on `origin/main` @ `79ebf30d1`: `TimelineRenderer`
 * (`plugin-timeline/src/renderer.tsx:250`) reads NINE keys off this node —
 * `variant`, `items`, `dateFormat`, `onItemClick`, `minDate`, `maxDate`,
 * `rowLabel`, `scale`, `timeScale` — and NONE of `events` / `orientation` /
 * `position`. EIGHT of those nine are declared below; `onItemClick` is not, on
 * purpose — it is a runtime slot `ObjectTimeline` installs when it composes
 * this schema, not authorable metadata, and this package's convention keeps
 * callback-shaped keys off the authored surface (see `RuntimeOnlyDeclared` in
 * `__tests__/zod-mirror-parity.test.ts`). That measurement is a dated record
 * and is kept as one: `timeScale` has since been RETIRED (objectui#6355,
 * ruling 2026-08-27), so the read set is EIGHT keys today and `scale` is the
 * sole axis spelling. The registration's own `inputs` metadata and
 * `content/docs/plugins/plugin-timeline.mdx`'s property table agreed with the
 * renderer all along; only this type disagreed — including with the docs
 * page's own TypeScript example, which did not compile, because `events` was
 * required and nothing writes it.
 *
 * ## Two timelines, and this is the presentational one
 *
 * `TimelineSchema` describes HOW TO DRAW a rail from items already in hand.
 * The OBJECT-BOUND config — WHICH RECORD FIELDS to project — is
 * `@objectstack/spec`'s `TimelineConfig`, surfaced here as
 * {@link ListViewTimelineConfig} (`startDateField` / `titleField` / …) and
 * consumed by `ObjectTimeline`, which resolves those field names against
 * fetched records and composes the presentational shape below before handing
 * it to `TimelineRenderer`. The two vocabularies are disjoint by design; only
 * `scale` is common to both, deliberately spelled the same in each.
 */
export interface TimelineSchema extends BaseSchema {
  type: 'timeline';
  /**
   * Layout variant. The renderer implements exactly these three and returns
   * `null` for anything else.
   * @default 'vertical'
   */
  variant?: 'vertical' | 'horizontal' | 'gantt';
  /**
   * The rows to draw — feed items, or gantt rows when `variant` is `gantt`.
   *
   * ## The element is declared: two arms, and `variant` picks one
   *
   * objectui#6356 (maintainer ruling 2026-09-27, Q1 = A, Q2 = C) declares the
   * element as the union of its two authored shapes:
   *
   * - `vertical` (the default) / `horizontal` — a {@link TimelineFeedItem},
   *   the seven documented keys with `title` required;
   * - `gantt` — a {@link TimelineGanttItem}, `{ label, items? }` with `label`
   *   required, each bar a {@link TimelineGanttItemBar}.
   *
   * Both arms are CLOSED, so a literal carrying a key neither arm declares is
   * an excess-property error here. ⚠️ Which arm an element must match depends
   * on `variant`, a key of the PARENT, and TypeScript cannot see that: a gantt
   * row on a feed timeline type-checks. That cross-shape case is refused at the
   * validation door instead — the zod mirror (`./zod/data-display.zod.ts`)
   * judges each element against the arm `variant` selects, in a node-level
   * refinement, because before this ruling it parsed green and drew an empty,
   * unlabelled entry with no diagnostic.
   *
   * The five keys `ObjectTimeline` composes onto a record-mapped feed item
   * (`color`, `group`, `meta`, `startDate`, `endDate`) and its `_data` handle
   * are renderer-internal and are NOT part of this element — see
   * {@link TimelineFeedItem}.
   *
   * ## What objectui#7164 and objectui#7365 pinned still holds
   *
   * Every element is an OBJECT (objectui#7164), a gantt row's own `items`, when
   * present, is an ARRAY of OBJECTS, and a `null` bar is refused by its own
   * name, at `items[i].items[j]` (objectui#7365, director seat decision batch
   * #71, 2026-09-07, option B). Those refusals keep their own paths: the mirror
   * judges the arm in a refinement that runs AFTER them, not by an element-level
   * union that would fold them into one nested `invalid_union`.
   *
   * ⛔ The render-time diagnostic is UNCHANGED
   * (`timeline.gantt.unusableRange.malformedRow` and the ten language packs are
   * untouched) — the renderer stays only ever MORE lenient than `validate`, and
   * the date diagnostic remains the defined outcome for anything reaching it.
   */
  items?: Array<TimelineFeedItem | TimelineGanttItem>;
  /**
   * How item dates are rendered.
   * @default 'short'
   */
  dateFormat?: 'short' | 'long' | 'iso';
  /**
   * Gantt axis bucket size. **Canonical spelling** — it is `@objectstack/spec`
   * `ui/TimelineConfig.json`'s axis key AND the renderer's only read
   * (`resolveTimelineScale`). The `timeScale` alias it used to fall back to is
   * RETIRED (objectui#6355) and tombstoned below.
   * @default 'month'
   */
  scale?: TimelineScale;
  /**
   * RETIRED (objectui#6355, maintainer ruling 2026-08-27) — this renderer's
   * pre-spec dialect for the gantt axis bucket. Author {@link
   * TimelineSchema.scale}, which `@objectstack/spec` owns and this renderer
   * now reads exclusively.
   *
   * `?: never` is this package's tombstone convention (see {@link
   * StaticTableColumn} objectui#5474, `crud.ts` `confirm` objectui#4314), and
   * it is load-bearing rather than decorative. {@link BaseSchema} carried
   * `[key: string]: any` until objectui#8347, and a deletion is still refused
   * only on a fresh literal, so DELETING this member would let the retired
   * spelling type-check green through a widened value and do nothing — the renderer no longer reads it,
   * and the axis would silently fall back to the `month` default with no
   * diagnostic. That is the silent axis breakage objectui#2942 closed, running
   * in the other direction. Keeping the key declared as `never` is what makes
   * the retirement audible at the authoring boundary.
   *
   * Lockstep with the Zod twin (`zod/data-display.zod.ts`, `z.never()`): both
   * halves or neither, since either half alone leaves the other surface
   * silently accepting the retired spelling. Absent stays valid on both, so a
   * document that never wrote the alias is untouched.
   *
   * @deprecated RETIRED (objectui#6355) — author `scale` instead.
   */
  timeScale?: never;
  /**
   * Header label above the Gantt row-label gutter.
   * @default 'Items'
   */
  rowLabel?: string;
  /**
   * Override the auto-calculated Gantt axis start (`YYYY-MM-DD`).
   */
  minDate?: string;
  /**
   * Override the auto-calculated Gantt axis end (`YYYY-MM-DD`).
   */
  maxDate?: string;
  /**
   * RETIRED (objectui#6170, ADR-0049 stage 2) — author {@link
   * TimelineSchema.items} instead, each entry a {@link TimelineFeedItem}
   * (`{ time, title, … }`).
   *
   * No renderer ever read this key: a timeline authored with `events` drew an
   * EMPTY rail, with no render-time error or warning; only the parser tier's
   * `unknown-prop` warning noticed it. objectui#6170's maintainer ruling
   * (2026-08-25, 「同意」) sent it, {@link TimelineSchema.orientation} and
   * {@link TimelineSchema.position} down the ADR-0049 enforce-or-remove route,
   * and the producer census recorded on objectui#6170 (a dated reading, not
   * re-derived here) found no author of any of the three that expected it to
   * render — so the route is REMOVE, not enforce.
   *
   * `?: never` is this package's tombstone convention (see
   * {@link TimelineSchema.timeScale} a few members above, {@link StaticTableColumn}
   * objectui#5474), and it is load-bearing rather than decorative.
   * {@link BaseSchema} carried `[key: string]: any` until objectui#8347, and a
   * deletion is still refused only on a fresh literal, so DELETING this member
   * would let the retired key type-check green through a widened value and
   * keep drawing an empty rail
   * — the silent no-op this retirement exists to make audible. Keeping it
   * declared as `never` is what turns it into a compile error.
   *
   * Lockstep with the Zod twin (`zod/data-display.zod.ts`,
   * `retirementTombstone()`): both halves or neither, since either half alone
   * leaves the other surface silently accepting the retired key. Absent stays
   * valid on both. The element type it used to name, {@link TimelineEvent},
   * stays exported; this member no longer references it.
   *
   * @deprecated RETIRED (objectui#6170) — author `items` instead.
   */
  events?: never;
  /**
   * RETIRED (objectui#6170, ADR-0049 stage 2) — author {@link
   * TimelineSchema.variant} instead (`'vertical'`, `'horizontal'` or
   * `'gantt'`).
   *
   * No renderer ever read this key: the layout is chosen by `variant`, so an
   * authored `orientation: 'horizontal'` drew the default vertical rail in
   * silence. Tombstoned `?: never` rather than deleted, for the reason
   * {@link TimelineSchema.events} gives; lockstep with the Zod twin.
   *
   * @deprecated RETIRED (objectui#6170) — author `variant` instead.
   */
  orientation?: never;
  /**
   * RETIRED (objectui#6170, ADR-0049 stage 2) — and NOTHING replaces it.
   *
   * It promised to put the vertical rail's entries on the `left`, `right` or
   * both sides (`alternate`). No renderer ever read it, and no key does that
   * job today: the vertical rail is always drawn on the left edge. Tombstoned
   * `?: never` rather than deleted, for the reason {@link TimelineSchema.events}
   * gives; lockstep with the Zod twin.
   *
   * @deprecated RETIRED (objectui#6170) — no replacement; the vertical rail is always on the left.
   */
  position?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `timeline` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node, on EITHER of its two readers.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program built from the repo-root `tsconfig.json` on a BUILT tree — an
   * unbuilt tree resolves a workspace package to `any`, and `any` reads as
   * NEITHER, which is the shape that hides a hit. Every read is filed under the
   * DECLARED TYPE of the object it is read from; this declaration carries none.
   * What `TimelineRenderer` DOES read off this node, from the same instrument:
   * `items`, `minDate`, `maxDate`, `rowLabel` — plus `variant`, `dateFormat`
   * and `scale`, which reach it by destructuring.
   *
   * ⭐ BOTH readers were measured, not just the declared one. The bare
   * `timeline` key is owned by `view:timeline` (`ObjectTimelineRenderer` in
   * `packages/plugin-timeline`), whose props are `any`-typed, so a
   * receiver-type sweep alone would have scored it as "reads neither" for the
   * wrong reason. It was attributed directly instead: `packages/plugin-timeline`
   * contains NO `body` / `children` read of any kind, on any receiver.
   * `plugin-timeline:timeline` — the presentational `TimelineRenderer` this
   * declaration types — passes `skipFallback: true` and stands down from the
   * bare key. Re-derive ownership with
   * `pnpm check:registry-bare-names --table` (objectui#9264).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9544: a SERIAL constraint on this
   * file, ⛔ never a verdict. ⚠️ Ownership and readership are DIFFERENT
   * questions — settling who owns a bare key does not license a tombstone, and
   * reading the one for the other is what would have narrowed `button`, which
   * reads both channels live.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `timeline` reads — nothing renders it. Author the
   * rows as `items`.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `timeline` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node, on EITHER of its two readers.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program built from the repo-root `tsconfig.json` on a BUILT tree — an
   * unbuilt tree resolves a workspace package to `any`, and `any` reads as
   * NEITHER, which is the shape that hides a hit. Every read is filed under the
   * DECLARED TYPE of the object it is read from; this declaration carries none.
   * What `TimelineRenderer` DOES read off this node, from the same instrument:
   * `items`, `minDate`, `maxDate`, `rowLabel` — plus `variant`, `dateFormat`
   * and `scale`, which reach it by destructuring.
   *
   * ⭐ BOTH readers were measured, not just the declared one. The bare
   * `timeline` key is owned by `view:timeline` (`ObjectTimelineRenderer` in
   * `packages/plugin-timeline`), whose props are `any`-typed, so a
   * receiver-type sweep alone would have scored it as "reads neither" for the
   * wrong reason. It was attributed directly instead: `packages/plugin-timeline`
   * contains NO `body` / `children` read of any kind, on any receiver.
   * `plugin-timeline:timeline` — the presentational `TimelineRenderer` this
   * declaration types — passes `skipFallback: true` and stands down from the
   * bare key. Re-derive ownership with
   * `pnpm check:registry-bare-names --table` (objectui#9264).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9544: a SERIAL constraint on this
   * file, ⛔ never a verdict. ⚠️ Ownership and readership are DIFFERENT
   * questions — settling who owns a bare key does not license a tombstone, and
   * reading the one for the other is what would have narrowed `button`, which
   * reads both channels live.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `timeline` reads — nothing renders it. Author the
   * rows as `items`.
   */
  children?: never;
}

/**
 * Breadcrumb — ONE authority, and it lives in `./navigation.ts`.
 *
 * This module declared its own `BreadcrumbItem` / `BreadcrumbSchema` until
 * objectui#6349. They were not a second dialect, they were a stale COPY: a
 * strict subset of the navigation declarations, missing `BreadcrumbItem.icon` /
 * `onClick` / `siblings` and `BreadcrumbSchema.maxItems`, with no key declared
 * differently on either side. Everything that actually reads a breadcrumb was
 * already on the navigation declaration — `registry.ts` maps the `'breadcrumb'`
 * component type to it, `packages/types/src/index.ts` re-exports it under the
 * bare names, `zod/navigation.zod.ts` mirrors it, and
 * `content/docs/components/data-display/breadcrumb.mdx` documents `icon` and
 * `maxItems` on THIS page. The copy's only reach was the
 * `@object-ui/types/data-display` subpath and the {@link DataDisplaySchema}
 * union below, both of which under-declared what the renderer honours.
 *
 * A re-export is one declaration with a second export site, which is exactly
 * how this monorepo is meant to fan a type out; the recurrence guard
 * (`scripts/__tests__/one-authority-per-exported-name-6273.test.ts`) does not
 * count it. 2026-08-25 family ruling, objectui#6172 decision 甲/A1.
 */
export type { BreadcrumbItem, BreadcrumbSchema } from './navigation.js';

/**
 * Keyboard key component
 */
export interface KbdSchema extends BaseSchema {
  type: 'kbd';
  /**
   * Key label (single key)
   */
  label?: string;
  /**
   * Key labels (multiple keys)
   */
  keys?: string | string[];
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `kbd` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `keys`, `label` (in
   * `packages/components/src/renderers/data-display/kbd.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `kbd` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `kbd` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `keys`, `label` (in
   * `packages/components/src/renderers/data-display/kbd.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `kbd` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Bar chart component (`bar-chart`), rendered by `@object-ui/plugin-charts`
 * over Recharts.
 *
 * Declared here for the same reason `MarkdownSchema` above is: a registered
 * component type that `AnyComponentSchema` (`./zod/index.zod.ts`) does not
 * model cannot be validated at all — `objectui validate` refuses every document
 * that names it, and `objectui check` reports it as unrecognised
 * (objectui#6318). `@object-ui/types` has zero dependencies and cannot import
 * the plugin's own `BarChartSchema`, so this is the twin-declaration shape the
 * markdown and kanban components already carry.
 *
 * ⚠️ Derived from READ SITES, not from a view of what a bar chart should
 * accept: `packages/plugin-charts/src/ChartRenderer.tsx:28-38`
 * (`ChartBarRenderer`) forwards exactly `data`, `dataKey`, `xAxisKey`,
 * `height`, `className` and `color` into the lazy chart implementation, and the
 * registration's `inputs`/`defaultProps` (`plugin-charts/src/index.tsx:45-64`)
 * name the same five authorable keys.
 *
 * ⛔ Not to be confused with {@link ChartSchema} (`type: 'chart'`), the
 * multi-series component with its own `series`/`chartType` vocabulary. This one
 * plots a single `dataKey` and is reached only under the `bar-chart` keyword.
 */
export interface BarChartSchema extends BaseSchema {
  type: 'bar-chart';
  /**
   * Rows to plot. Each row supplies one bar: its category comes from
   * {@link xAxisKey} and its magnitude from {@link dataKey}.
   */
  data?: Array<Record<string, any>>;
  /**
   * Row key holding the bar's value (the y axis).
   *
   * @default 'value'
   */
  dataKey?: string;
  /**
   * Row key holding the bar's category label (the x axis).
   *
   * @default 'name'
   */
  xAxisKey?: string;
  /**
   * Chart height in pixels. A number, not a CSS length — the registration
   * declares `type: 'number'` and defaults it to 400.
   *
   * @default 400
   */
  height?: number;
  /**
   * Bar fill colour, forwarded to Recharts verbatim.
   *
   * @default '#8884d8'
   */
  color?: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `bar-chart` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `bar-chart` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `bar-chart` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `bar-chart` registration (`@object-ui/plugin-charts`) reads the node
   * through `ChartBarRenderer`'s inline props type, which forwards `data`,
   * `dataKey`, `xAxisKey`, `height`, `className` and `color` and nothing
   * else. `SchemaRenderer` strips `body` and `children` out of the props bag
   * it spreads, so neither reaches the component by another route, and the
   * registration declares no `children` slot (objectui#9910).
   *
   * What it renders instead: one bar per `data` row, its value from `dataKey`
   * and its category from `xAxisKey`.
   *
   * @deprecated Not a channel `bar-chart` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Union type of all data display schemas
 */
export type DataDisplaySchema =
  | AlertSchema
  | BadgeSchema
  | AvatarSchema
  | ListSchema
  | TableSchema
  | DataTableSchema
  | MarkdownSchema
  | TreeViewSchema
  | ChartSchema
  | PivotTableSchema
  | TimelineSchema
  | HtmlSchema
  | StatisticSchema
  | BreadcrumbSchema
  | KbdSchema
  | BarChartSchema;

/**
 * Raw HTML component
 */
export interface HtmlSchema extends BaseSchema {
  type: 'html';
  /**
   * The HTML content string
   */
  html: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `html` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `html` (in `packages/components/src/renderers/basic/html.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `html` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `html` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `html` (in `packages/components/src/renderers/basic/html.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `html` reads — nothing renders it.
   */
  children?: never;
}

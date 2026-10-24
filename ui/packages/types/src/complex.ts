/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Complex Component Schemas
 * 
 * Type definitions for advanced/composite components.
 * 
 * @module complex
 * @packageDocumentation
 */

import type {
  DashboardWidget as SpecDashboardWidget,
  GlobalFilter as SpecGlobalFilter,
  Dashboard as SpecDashboard,
  I18nLabel,
  ViewFilterOperator as SpecViewFilterOperator,
} from '@objectstack/spec/ui';
import type { BaseSchema, SchemaNode } from './base.js';
import type { DASHBOARD_SPEC_EXCLUDED } from './zod/complex.zod.js';
// `GroupingConfig`, `KanbanConditionalFormattingRule` and `ViewNavigationConfig`
// were imported for `KanbanSchema`'s `grouping`, `conditionalFormatting` and
// `navigation` members and had no other reader in this module; they left with
// the retired `'kanban'` arm (objectui#8802). All three are still declared and
// still exported from their own modules.

/**
 * Kanban card — the shape the registered `'kanban'` renderer reads.
 *
 * ## Why this dialect lives here (objectui#7664, maintainer ruling (a), 2026-09-05)
 *
 * `@object-ui/types` used to declare a DIFFERENT board under the same
 * `'kanban'` key — the `DeclarativeKanban*` trio (`columns` with `color`,
 * `draggable`, cards with `labels` / `assignees` / `priority`), which was the
 * `'kanban'` arm of `ComplexSchema` → `AnyComponentSchema` → `safeValidateSchema`
 * — while the renderer registered for that key (`ObjectKanbanRenderer` in
 * `@object-ui/plugin-kanban`) consumed the plugin's own `KanbanSchema`. A board
 * could pass `objectui validate` and render EMPTY, because the validator and the
 * renderer honoured two unrelated faces (objectui#6086 measured the consequence).
 *
 * The ruling: for an authored `type: 'kanban'` document the PLUGIN dialect is
 * authoritative, so this package declares exactly that dialect and
 * `@object-ui/plugin-kanban` imports it back rather than declaring its own
 * (`packages/plugin-kanban/src/types.ts` re-exports these names — one
 * declaration, one authority, the dependency direction unchanged: `types`
 * declares, the plugin conforms). The declarative trio and its three Zod
 * mirrors are retired in the same change (ADR-0049 enforce-or-remove): its only
 * retained value was the validator arm, and that arm now validates this shape.
 * objectui#6172's "keep both faces" half is what this reverses; the ruling says
 * so explicitly.
 *
 * Every member below was carried from the plugin's declaration verbatim. The
 * runtime-computed members (`cardSubtitle`, `cardFieldCells`, `coverImage`,
 * a badge's `colorStyle`) are what `ObjectKanban` writes onto the cards it
 * hands the board and what `KanbanImpl` reads back (the one board since
 * objectui#8932 deleted `KanbanEnhanced`); the Zod
 * mirror (`zod/complex.zod.ts`) passes those through the way it passes
 * `TableColumn.headerIcon` through (objectui#6424).
 *
 * `React.CSSProperties` / `React.ReactNode` resolve through the ambient
 * namespace, the way `data-display.ts` already spells `headerIcon` and
 * `rowStyle` — this package still declares no React dependency.
 */
export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  badges?: Array<{
    label: string;
    variant?: "default" | "secondary" | "destructive" | "outline";
    /**
     * Optional Tailwind class string applied to the badge. When set, it
     * overrides `variant` so callers can reuse the same colors as list/grid
     * cells.
     *
     * Derive it the way the grid cell derives it, or the same option renders
     * two colours on one screen (objectui#5183): prefer
     * `getBadgeHexAppearance(color)` from `@object-ui/fields` and use its
     * `className` — passing its `colorStyle` too — and fall back to
     * `getBadgeColorClasses(color, value)` only when it returns `undefined`.
     */
    colorClass?: string;
    /**
     * Inline style accompanying `colorClass`. **Required whenever the class
     * string came from `getBadgeHexAppearance`** — that className reads CSS
     * custom properties which only this style declares, so a badge carrying
     * the class without the style references undefined variables. Pass the
     * helper's `style` verbatim; leave unset on the palette-family path.
     */
    colorStyle?: React.CSSProperties;
  }>;
  /**
   * Synthesized card subtitle (e.g. "Account: Acme · Amount: $150K"). Rendered
   * in preference to `description` so we don't have to overwrite the record's
   * real `description` field — which would corrupt detail-view and edit-form
   * displays once a card is opened.
   *
   * Read by `KanbanImpl`; absent on a board that renders plain descriptions.
   */
  cardSubtitle?: string;
  /**
   * Structured per-field cells. When provided, the card body renders each
   * field via the unified `@object-ui/fields` cell-renderer pipeline (same
   * as Grid/Gallery), so lookup/user/email/url/phone/boolean/etc. fields
   * keep their semantic styling instead of being flattened to a text join.
   *
   * Takes precedence over `cardSubtitle` / `description` when present.
   */
  cardFieldCells?: Array<{ field: string; label?: string; node: React.ReactNode }>;
  /**
   * Resolved cover-image URL for the card, derived from the board's
   * `coverImageField`. Read by both board implementations.
   */
  coverImage?: string;
  [key: string]: any;
}

/**
 * Kanban column — a lane of the registered `'kanban'` renderer.
 */
export interface KanbanColumn {
  id: string;
  title: string;
  /**
   * Cards in this column.
   *
   * Named `cards` because that is what the board reads and every authored
   * document writes: `KanbanImpl` and `bucketCardsIntoColumns` read
   * `column.cards` (measured at `240b80f31`: 12 lines in `KanbanImpl`, and 8
   * in `KanbanEnhanced` until objectui#8932 deleted it), and the two catalog
   * entries, the plugin docs and `content/docs/api/schema-reference.md` all
   * author it. The retired declarative face spelled this `items` until
   * `240b80f31` — a spelling with zero read sites, which made every authored
   * board fail `safeValidateSchema` while rendering correctly (objectui#6318's
   * bucket).
   */
  cards: KanbanCard[];
  /**
   * WIP limit — the card count at which the lane warns. Never reaches the
   * query; the board's fetch window is `ObjectKanbanSchema.limit`
   * (`./objectql.ts`) — the `kanban` arm that used to declare it retired with
   * the node key (objectui#8802).
   */
  limit?: number;
  className?: string;
  /**
   * Whether the lane renders collapsed: narrowed to a title spine, its cards
   * withheld, and its heading a disclosure the viewer can open again.
   *
   * The AUTHORED value is the lane's initial state only — once a viewer toggles
   * the lane, their decision holds for that session, including across the data
   * refreshes that rebuild these lane objects. Reading it as a locked state
   * would make a lane's cards permanently unreachable and its drop target
   * blind.
   *
   * Honoured by the registered board (`@object-ui/plugin-kanban`'s `KanbanImpl`,
   * on BOTH of its layouts — the flat lane and each row of the swimlane grid)
   * since objectui#9628, and by `KanbanEnhanced` before it. Until that card the
   * key was declared on both published faces and read only by `KanbanEnhanced`,
   * which no production source imports — so an authored value parsed green and
   * reached nothing.
   */
  collapsed?: boolean;
  /**
   * RETIRED with the declarative face (objectui#7664, ADR-0049) — `color` was a
   * `DeclarativeKanbanColumn` member, and no registered board reads a column
   * colour (measured: zero `column.color` read sites across `KanbanImpl`,
   * `KanbanEnhanced`, `ObjectKanban`).
   *
   * A tombstone rather than a plain removal on BOTH prongs of the
   * discriminator the precedent changesets state (objectui#5941, #7526), in
   * its amended form (`5f8190c8c`): a `?: never` tombstone is available
   * only on a SURVIVING CARRIER — `KanbanColumn` survives this retirement,
   * while a whole exported type name has no carrier and is removed outright —
   * and on such a carrier it is used when either prong holds: (1) it steers
   * authors to a named live replacement KEY, or (2) it keeps loud a key the
   * docs taught as working. Both hold here:
   *
   *   - prong 1: `className` is that live replacement — style a lane through
   *     it;
   *   - prong 2: `content/docs/api/schema-reference.md` taught this key as
   *     working. Before this card its kanban example authored a `color` on
   *     every one of its three columns (`"color": "#6366f1"` and two more) and
   *     its `columns` row read "each with `id`, `title`, `color`, and `cards`".
   *
   * ⚠️ The hazard prong 2 guards here is a SILENT STRIP, not a silent keep:
   * `KanbanColumn` does not extend {@link BaseSchema}, so its mirror is a plain
   * (non-passthrough) object. Measured on the built mirror: an undeclared
   * column key is accepted and dropped from the parsed output, while this
   * tombstone refuses `color` by name. A board that has always authored lane
   * colours therefore gets told, instead of quietly losing them.
   * @deprecated Not part of this contract — the value was inert.
   */
  color?: never;
}

/**
 * ⛔ `KanbanSchema` — the `'kanban'` arm — is RETIRED (objectui#8802,
 * maintainer ruling 2026-09-09: 「从我们的业务需求角度，我应该只需要
 * `object-kanban`」, recorded verbatim and not translated).
 *
 * ## What this dissolves
 *
 * The bare `kanban` node type key published TWO faces with OPPOSITE verdicts on
 * the same document: `@object-ui/plugin-kanban`'s registry `inputs` declared
 * `titleField` while this arm refused it by name after batch #70
 * (objectui#7742). With the key retired there is no arm left to disagree with,
 * so objectui#8802's four options are moot rather than chosen between.
 *
 * ## Where the vocabulary went
 *
 * ⛔ Nowhere, and that is the point: `object-kanban` has ALWAYS had its own
 * declared face, {@link ObjectKanbanSchema} (`./objectql.ts`), and an
 * `object-kanban` document has always been judged by it alone. Retiring this
 * arm therefore changes the verdict on `type: 'kanban'` documents only. The
 * keys this arm alone declared — `columns`, `cardTitle`, `swimlaneField`,
 * `grouping`, `conditionalFormatting`, `navigation` — were never part of the
 * `object-kanban` face and are not being removed from it.
 *
 * ## ⚠️ Why the Zod mirror is a NAMED REFUSAL and not a deletion
 *
 * {@link BaseSchema}'s Zod twin ends `.passthrough()` (and the interface closed
 * with `[key: string]: any` until objectui#8347). A dropped MEMBER key is
 * therefore KEPT, not refused, on the Zod face — the failure objectui#7664's own
 * first cut shipped at `onCardClick`. A dropped
 * TYPE LITERAL behaves differently on a DISCRIMINATED union (`AnyComponentSchema`
 * selects one arm from the authored literal), so removal alone would already
 * refuse — but only with the union's generic `Invalid input`, naming no remedy.
 * ⇒ `zod/complex.zod.ts` keeps an arm for the literal and refuses it BY NAME
 * through `retiredNodeType()`, pointing the author at `object-kanban`.
 *
 * The TypeScript half of the refusal is this deletion: with no `kanban` arm in
 * {@link ComplexSchema} and no `'kanban'` entry in `SchemaRegistry`, `tsc`
 * refuses the literal at the authoring site.
 *
 * ## ⛔ The layer that did NOT move
 *
 * `kanban` also names a STORED `NamedListView.type` (`./objectql.ts`) — the
 * value `CreateViewDialog` writes and every tenant's database holds. It is
 * UNTOUCHED. `plugin-view`'s `ObjectView` maps a stored `kanban` view onto the
 * node type `object-kanban` already, as it does for all twelve stored view
 * types, so every board any user ever created through the console already
 * renders through the surviving spelling and this retirement moves zero stored
 * documents.
 *
 * {@link KanbanCard}, {@link KanbanColumn} and {@link CardTemplate} are NOT
 * retired — the renderer and the `CardTemplates` component still consume
 * them. `ColumnWidthConfig`, which this arm also carried, lost its one
 * `plugin-kanban` reader to objectui#8522 and was then deleted, with its Zod
 * mirror, by objectui#10582 (pinned in
 * `./__tests__/column-width-config-retired-10582.test.ts`).
 *
 * Pinned in `./__tests__/bare-kanban-node-key-retired-8802.test.ts`.
 */

/**
 * A predefined card template with pre-filled field values.
 */
export interface CardTemplate {
  /** Unique template identifier */
  id: string;
  /** Human-readable template name */
  name: string;
  /** Optional Lucide icon name */
  icon?: string;
  /** Pre-filled field values */
  values: Record<string, any>;
}

/**
 * Calendar view mode — the registered `calendar-view` renderer's rendered set.
 *
 * `'agenda'` was retired from this union (`b55a34647`): no view ever
 * rendered it — the renderer resolved it to the `'month'` default — and no
 * measured app authors it (ADR-0049 enforce-or-remove, the value-level
 * residue of objectui#5667's key-level convergence).
 */
export type CalendarViewMode = 'month' | 'week' | 'day';

/**
 * Calendar event
 */
export interface CalendarEvent {
  /**
   * Unique event identifier
   */
  id: string;
  /**
   * Event title
   */
  title: string;
  /**
   * Event description
   */
  description?: string;
  /**
   * Event start date/time
   */
  start: string | Date;
  /**
   * Event end date/time
   */
  end: string | Date;
  /**
   * Whether event is all day
   */
  allDay?: boolean;
  /**
   * Event color
   */
  color?: string;
  /**
   * Additional event data
   */
  data?: any;
}

/**
 * Calendar view component.
 *
 * The authored surface of the registered `calendar-view` renderer, converged
 * on the renderer's measured read set (objectui#5667): the calendar's events
 * are COMPUTED from the node's `data` array plus the five field-name keys
 * below — there is no authorable `events` key. An authored `events` is dropped
 * by design (objectui#4433); this repo's action metadata rides
 * `properties.action`, not a calendar prop.
 *
 * Nine formerly declared keys — `events` (the interface's only required key
 * besides `type`, and the one the renderer refuses), `defaultView`,
 * `defaultDate`, `date`, `views`, `editable`, `onEventCreate`,
 * `onEventUpdate`, `onDateChange` — are RETIRED rather than implemented:
 * none had a read site on the authored-node path, and no measured app authors
 * any of them (ADR-0049 enforce-or-remove, objectui#5667).
 */
export interface CalendarViewSchema extends BaseSchema {
  type: 'calendar-view';
  /**
   * Records to display as events — the renderer computes its events from this
   * array plus the field-name keys below.
   *
   * Redeclared from `BaseSchema` (same `any` type) because a binding
   * expression string is also legal here and resolves to the array before the
   * renderer reads it. A non-array value renders an empty calendar.
   */
  data?: any;
  /**
   * Record field to use for the event title.
   * @default 'title'
   */
  titleField?: string;
  /**
   * Record field containing the event start date/time.
   * @default 'start'
   */
  startDateField?: string;
  /**
   * Record field containing the event end date/time.
   * @default 'end'
   */
  endDateField?: string;
  /**
   * Record field indicating an all-day event.
   * @default 'allDay'
   */
  allDayField?: string;
  /**
   * Record field to use for the event color.
   * @default 'color'
   */
  colorField?: string;
  /**
   * Calendar view mode.
   *
   * {@link CalendarViewMode} equals the renderer's rendered set since
   * `b55a34647` retired `'agenda'`; at runtime the renderer still resolves
   * any off-union value in raw metadata to the `'month'` default.
   * @default 'month'
   */
  view?: CalendarViewMode;
  /**
   * Initial calendar date — an ISO date string when authored as JSON; a
   * `Date` instance is accepted from a React host.
   */
  currentDate?: string | Date;
  /**
   * Show the "New event" affordance; clicking it dispatches a
   * `{ type: 'create' }` action on the node's action channel (objectui#4454).
   * @default false
   */
  allowCreate?: boolean;
  /**
   * Tailwind classes for the calendar container. Redeclared from `BaseSchema`
   * as part of the converged authored surface.
   */
  className?: string;
  /**
   * Event click handler — HOST-ONLY. The renderer forwards it only when the
   * value is a function, which authored JSON can never produce; supply it from
   * a React host (`<SchemaRenderer ... onEventClick={fn} />`).
   *
   * RUNTIME SLOT (objectui#7344, the objectui#6124 shape) — the zod twin, which
   * declared `z.function()` in a multi-line spelling PR #7339's census missed,
   * now refuses this key by name, like `onViewChange` below.
   */
  onEventClick?: (event: CalendarEvent) => void;
  /**
   * View change handler — HOST-ONLY, same rule as {@link
   * CalendarViewSchema.onEventClick}.
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * read by `calendar-view`'s `pickHostCallbacks` off the spread props
   * (function values only).
   */
  onViewChange?: (view: CalendarViewMode) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `calendar-view` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `allDayField`, `colorField`, `data`, `endDateField`, `startDateField`,
   * `titleField` (in
   * `packages/plugin-calendar/src/calendar-view-renderer.tsx`).
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
   * @deprecated Not a channel `calendar-view` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `calendar-view` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `allDayField`, `colorField`, `data`, `endDateField`, `startDateField`,
   * `titleField` (in
   * `packages/plugin-calendar/src/calendar-view-renderer.tsx`).
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
   * @deprecated Not a channel `calendar-view` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Filter condition — one flat row of a {@link FilterGroup}.
 *
 * The single name authority for the builder's row (objectui#9306):
 * `@object-ui/components` derives its `FilterBuilderRow` from this
 * declaration, restating only its two named extensions — `operator` (these
 * ids plus the opt-in `exists` / `notExists`) and a narrower `value`. It
 * carries a name of its own (objectui#6349, batch 12), so
 * `FilterBuilderCondition` means this authored row and nothing else.
 */
export interface FilterBuilderCondition {
  /**
   * Row identity.
   *
   * REQUIRED, and deliberately asymmetric with `FilterGroup.id` below
   * (objectui#8415). The group's `id` has zero read sites and is optional for
   * that reason; a CONDITION's `id` is the identity every affordance on the row
   * matches on — `removeCondition`, `updateCondition`, `changeOperator` and
   * `changeField` in `packages/components/src/custom/filter-builder.tsx`, plus
   * the React `key`. The component's `FilterBuilderRow` takes this member
   * from this declaration rather than restating it (objectui#9306), and
   * `addCondition` emits `crypto.randomUUID()`.
   *
   * Undeclared, it was STRIPPED by the `z.object` mirror in silence, so a
   * correctly authored row validated and rendered with no individual identity:
   * every affordance is handed `undefined`, `c.id === conditionId` is TRUE for
   * every id-less row, and so one click removes all of them at once — the
   * clicked row included — while one edit fans out across all of them. A row
   * cannot be edited or removed on its own. (Not "matches none"; the failure is
   * en bloc.) Declaring it is what makes `declared = enforced`.
   */
  id: string;
  /**
   * Field to filter
   */
  field: string;
  /**
   * Filter operator — the spec's canonical view-filter vocabulary, taken BY
   * REFERENCE (`ViewFilterOperator`, the element type of
   * `VIEW_FILTER_OPERATORS` in `@objectstack/spec/ui`), so this member and
   * its zod mirror (`FilterOperatorSchema`, which is the spec rule's own
   * operator member) state one set (objectui#9559, ruling B).
   *
   * It used to be typed by a 14-member local union that disagreed with BOTH
   * the protocol and the mirror: it carried `is_empty` / `is_not_empty` where
   * the mirror carried `is_null` / `is_not_null`, and neither face had
   * `icontains`, `before`, `after` or `between`.
   *
   * Canonical spellings only, deliberately narrower than what the mirror
   * PARSES: the mirror also accepts the spec's legacy aliases (`lessThan`,
   * `gt`, …) and normalises them to these members on parse, because stored
   * metadata carries them — but the spec marks that table a deprecated
   * migration bridge that new producers must not emit, and a type is what a
   * new producer writes against.
   *
   * Spelled with the spec's type directly. This package used to publish the
   * same set as `FilterBuilderOperator`, a second name for the spec's type
   * beside `@object-ui/components`' `FilterBuilderOperator` (these ids plus
   * the opt-in pair); that name now means the builder's vocabulary only
   * (objectui#6349, batch 12). Import `ViewFilterOperator` from
   * `@objectstack/spec/ui` to name this set.
   */
  operator: SpecViewFilterOperator;
  /**
   * Filter value
   */
  value?: any;
}

/**
 * Filter group — the shape `FilterBuilder` reads (`d4493fdbc`, the
 * `filter-builder` group; maintainer ruling 2026-09-02, director seat summon
 * #8, verbatim 「同意」).
 *
 * The gate is `isValidGroup` in `packages/components/src/custom/filter-builder.tsx`:
 * `Array.isArray(v.conditions) && (v.logic === "and" || v.logic === "or")`.
 * `logic` is the read key; the former `operator` on this face had zero read
 * sites, and a group spelled that way fails the gate, falls back to
 * `EMPTY_GROUP` and renders an EMPTY board.
 *
 * ONE level, never nested (objectui#9306, maintainer ruling 「A 撤掉嵌套声明」).
 * This declaration is the single name authority for the builder's group:
 * `@object-ui/components` derives its `FilterBuilderRowGroup` from it, under
 * a name of its own (objectui#6349, batch 12), rather than declaring a second
 * `FilterGroup`.
 */
export interface FilterGroup {
  /**
   * Group id.
   *
   * OPTIONAL on purpose. `isValidGroup` never consults it and nothing reads
   * `filterGroup.id`; measured, deleting it from an authored group renders
   * byte-identically. It is declared because the component's `FilterBuilderRowGroup`
   * (derived from this one) carries it, `EMPTY_GROUP` emits it and it round-trips out through
   * `onChange` — so a document that carries it should be TYPE-CHECKED on it
   * rather than admitted unvalidated.
   */
  id?: string;
  /**
   * How the conditions combine — the key `isValidGroup` reads.
   * @default 'and'
   */
  logic: 'and' | 'or';
  /**
   * The condition rows, FLAT: every entry is one field / operator / value row.
   *
   * A nested sub-group is RETIRED (objectui#9306, ADR-0049 enforce-or-remove).
   * This used to be `(FilterBuilderCondition | FilterGroup)[]`, but nothing
   * honoured the nesting. `FilterBuilder` draws each entry as one flat row and
   * has no control that creates a group; given a sub-group it drew a row with
   * blank field and operator triggers and showed the sub-group's own conditions
   * nowhere. The consumers that turn a group into a query or a stored filter
   * read the entries as rows too (a one-time reading on objectui#9306, not
   * re-derived here). The zod mirror (`FilterGroupSchema`) refuses a sub-group
   * by name, so the loss is a validation error instead of a blank row.
   */
  conditions: FilterBuilderCondition[];
}

/**
 * Filter builder component
 */
export interface FilterBuilderSchema extends BaseSchema {
  type: 'filter-builder';
  /**
   * Available fields for filtering
   */
  fields: FilterField[];
  /**
   * REFUSED BY NAME (objectui#10825, ADR-0049) — never read.
   *
   * It was declared `defaultValue?: FilterGroup`, and nothing reads it: the
   * `filter-builder` renderer hands `FilterBuilder` `schema.value || props.value`,
   * and `FilterBuilder` has no `defaultValue` prop. Measured through the real
   * `SchemaRenderer`, a group authored here drew the same empty builder as a
   * node with no filter key at all. Author the group as {@link value} instead.
   *
   * @deprecated Not read by `filter-builder` — author the group as `value`.
   */
  defaultValue?: never;
  /**
   * Controlled filter value — a {@link FilterGroup}, the only shape
   * `FilterBuilder` reads (its `isValidGroup` gate needs `logic` and
   * `conditions`).
   *
   * The zod mirror follows this declaration (objectui#10825): a bare condition
   * is refused by name, with the prescription to wrap it in
   * `{ logic, conditions: [ … ] }`. It used to be accepted there, and the
   * builder then drew it as an empty group.
   */
  value?: FilterGroup;
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `filter-builder` renderer as `props.onChange` after
   * `SchemaRenderer` spreads it.
   */
  onChange?: (filter: FilterGroup) => void;
  /**
   * REFUSED BY NAME (objectui#9306, ADR-0049) — `filter-builder` has no nested
   * groups, so there is nothing for this switch to allow.
   *
   * It was declared `allowGroups?: boolean` with a documented default of
   * `true`, and no renderer read it: `FilterBuilder` takes `fields`, `value`,
   * `onChange`, `className`, `showClearAll` and `extraOperators`, and draws
   * every entry of `conditions` as one flat row. Nesting itself is retired on
   * {@link FilterGroup.conditions}. Remove the key.
   *
   * @deprecated Not read by `filter-builder` — nested groups are retired.
   */
  allowGroups?: never;
  /**
   * REFUSED BY NAME (objectui#9306, ADR-0049) — `filter-builder` has no nested
   * groups, so there is no depth to limit.
   *
   * It was declared `maxDepth?: number` with a documented default of `3`, and
   * no renderer read it (the same reading as `allowGroups` above). Remove the
   * key.
   *
   * @deprecated Not read by `filter-builder` — nested groups are retired.
   */
  maxDepth?: never;
  /**
   * Tailwind classes on the outermost wrapper `div`.
   *
   * READ SITE: `packages/components/src/renderers/complex/filter-builder.tsx`
   * — `className={schema.wrapperClass || ''}`.
   *
   * Distinct from {@link BaseSchema.className}, which this renderer applies
   * further in. Declared by objectui#6150.
   */
  wrapperClass?: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `filter-builder` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `fields`, `label`, `name`, `value`, `wrapperClass` (in
   * `packages/components/src/renderers/complex/filter-builder.tsx`).
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
   * @deprecated Not a channel `filter-builder` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `filter-builder` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `fields`, `label`, `name`, `value`, `wrapperClass` (in
   * `packages/components/src/renderers/complex/filter-builder.tsx`).
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
   * @deprecated Not a channel `filter-builder` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Filter field definition — one entry of `FilterBuilderSchema.fields`
 * (`d4493fdbc`, same ruling).
 *
 * Renamed from `name` to `value`: every read site matches on `value`
 * (`fields.find((f) => f.value === …)` in `getOperatorsForField`,
 * `changeField`, `getInputType` and `renderValueInput`; `fields[0]?.value` in
 * `addCondition`; `<SelectItem value={field.value}>` in the field dropdown),
 * `name` had zero, and `FilterBuilderProps.fields` in
 * `packages/components/src/custom/filter-builder.tsx` already declares
 * `Array<{ value, label, type? }>`.
 */
export interface FilterField {
  /**
   * Field key — the identity the builder matches a condition's `field`
   * against, and the value its field dropdown puts on each option.
   */
  value: string;
  /**
   * Field label
   */
  label: string;
  /**
   * Field type — the value FAMILY the column is edited in. OPTIONAL: absent
   * means `text`, which is what `valueFamilyForFieldType` and
   * `operatorsForFieldType` both read (`fieldType || "text"` and
   * `const type = fieldType || "text"` in `custom/filter-builder.tsx`).
   *
   * The fourteen members are the published doc's
   * (`content/docs/components/complex/filter-builder.mdx`), which objectui#7562
   * ruled the authority for this authoring surface, in the doc's own order.
   * Every one of them was measured to have a renderer branch before this union
   * widened — the ruling's precondition — and none had to be withdrawn from the
   * doc. The mirror's docblock (`zod/complex.zod.ts`, `FilterFieldSchema`)
   * carries the branch-by-branch table with the file:line for each bucket.
   *
   * `string` is still absent and is the contrast that makes the rest read: it
   * is named nowhere in the renderer and reaches the text control only by the
   * unrecognised-word fallthrough, so it is a phantom (`d4493fdbc`). `text`
   * shares that fallthrough but IS named — line 408 is where an absent `type`
   * acquires it — which is why one is declared and the other is not.
   */
  type?:
    | 'text' | 'number' | 'currency' | 'percent' | 'rating'
    | 'date' | 'datetime' | 'time'
    | 'boolean'
    | 'select' | 'status'
    | 'lookup' | 'master_detail' | 'user';
  /**
   * Available operators for this field.
   *
   * The spec's canonical filter vocabulary, taken BY REFERENCE
   * (`ViewFilterOperator`, the element type of `VIEW_FILTER_OPERATORS` in
   * `@objectstack/spec/ui`), so the declaration and its zod mirror state one
   * set and cannot drift apart again (objectui#10286, applying the
   * objectui#7759 ruling: where the spec declares a vocabulary, both faces
   * align to it — and for filter operators the spec's canonical words win).
   * Until then this key restated the row's local operator union of that time,
   * which declared `is_empty` / `is_not_empty` where the mirror declared
   * `is_null` / `is_not_null`, so each face refused a spelling the other
   * accepted.
   *
   * ⚠️ Nothing renders this key today: the builder draws a field's operator
   * dropdown from its `type` alone (`operatorsForFieldType` in
   * `packages/components/src/custom/filter-builder.tsx`). The vocabulary is
   * settled here; whether the key should be honoured or retired is a separate
   * question this declaration does not answer.
   */
  operators?: SpecViewFilterOperator[];
  /**
   * Options (for select type)
   */
  options?: { label: string; value: any }[];
}

/**
 * Carousel item
 */
export interface CarouselItem {
  /**
   * Unique item identifier
   */
  id?: string;
  /**
   * Item content
   */
  content: SchemaNode | SchemaNode[];
}

/**
 * Carousel component
 */
export interface CarouselSchema extends BaseSchema {
  type: 'carousel';
  /**
   * Carousel items
   */
  items: CarouselItem[];
  /**
   * Option bag forwarded VERBATIM to the underlying embla carousel.
   *
   * READ SITE: `packages/components/src/renderers/complex/carousel.tsx:23` —
   * `opts={schema.opts}`, passed straight through to the `Carousel`
   * primitive, whose own `opts` is embla's `EmblaOptionsType`.
   *
   * ⚠️ Deliberately declared OPEN rather than as the two-key shape the docs
   * page shows (`{ loop?, align? }`). The renderer forwards the whole bag, so
   * every other embla option authored today reaches the library and works;
   * declaring the documented pair would REFUSE those authored documents —
   * a narrowing of a published surface, which is a ruling and not a
   * declaration. objectui#6150 records the capability as it is; picking a
   * narrower shape is escalated with that card.
   */
  opts?: Record<string, unknown>;
  /**
   * Scroll axis.
   *
   * READ SITE: `renderers/complex/carousel.tsx:24` —
   * `orientation={schema.orientation || 'horizontal'}`.
   *
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';
  /**
   * Tailwind classes applied to EACH slide (not the container — that is
   * {@link BaseSchema.className}).
   *
   * READ SITE: `renderers/complex/carousel.tsx:30` —
   * `className={schema.itemClassName}` on every `CarouselItem`.
   */
  itemClassName?: string;
  /**
   * Auto-play interval (ms)
   */
  autoPlay?: number;
  /**
   * Show navigation arrows
   * @default true
   */
  showArrows?: boolean;
  /**
   * Show pagination dots
   * @default true
   */
  showDots?: boolean;
  /**
   * Enable infinite loop
   * @default true
   */
  loop?: boolean;
  /**
   * Items visible at once
   * @default 1
   */
  itemsPerView?: number;
  /**
   * Gap between items
   */
  gap?: number;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `carousel` renderer spreads it onto a `<div>` that has no such event (React
   * attaches nothing). The zod twin refuses it by name; author behaviour as a
   * node type (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onSlideChange?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `carousel` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `itemClassName`, `items`, `opts`, `orientation`, `showArrows` (in
   * `packages/components/src/renderers/complex/carousel.tsx`).
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
   * @deprecated Not a channel `carousel` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `carousel` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `itemClassName`, `items`, `opts`, `orientation`, `showArrows` (in
   * `packages/components/src/renderers/complex/carousel.tsx`).
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
   * @deprecated Not a channel `carousel` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Chatbot message
 */
export interface ChatMessage {
  /**
   * Unique message identifier
   */
  id: string;
  /**
   * Message role
   */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /**
   * Message content
   */
  content: string;
  /**
   * Message timestamp
   */
  timestamp?: string | Date;
  /**
   * Message metadata
   */
  metadata?: any;
  /**
   * Whether this message is currently being streamed
   */
  streaming?: boolean;
  /**
   * Tool invocations associated with this message (for tool-calling flows)
   */
  toolInvocations?: ChatToolInvocation[];
  /**
   * Chain-of-thought / reasoning text emitted alongside the answer.
   * Surfaced by the chatbot UI as a collapsible "Thoughts" panel.
   */
  reasoning?: string;
  /**
   * Optional citation / RAG sources for this assistant message.
   * Surfaced by the chatbot UI as an inline citation panel.
   */
  sources?: ChatMessageSource[];
  /**
   * Optional backend trace id (e.g. the `ai_traces.id` produced by
   * `@objectstack/service-ai`'s auto-tracing) for "view trace" affordances.
   */
  traceId?: string;
  /**
   * Per-message avatar image URL, overriding the chatbot-level
   * `userAvatarUrl` / `assistantAvatarUrl` for this one message.
   *
   * READ SITE: `packages/plugin-chatbot/src/index.tsx:173–174` —
   * `message.avatar || userAvatarUrl` on a user message and
   * `message.avatar || assistantAvatarUrl` on an assistant one; the
   * authoring-to-runtime seam (`chatMessageAdapter.ts`, `...passthrough`)
   * carries it untouched. Undeclared until objectui#7295: this interface has
   * no index signature (objectui#5155 — and must not gain one), so an author
   * annotating `ChatbotSchema.messages` was told a value that renders is an
   * error (TS2353), and the zod mirror — a plain strip-mode `z.object` —
   * dropped it at parse. objectui#4424's `RuntimeOnlyMessageKeys` named only
   * the three keys API mode lifts out of the stream, never the two a human
   * author writes by hand.
   */
  avatar?: string;
  /**
   * Per-message avatar fallback text (initials), shown when `avatar` is unset
   * or fails to load; overrides the chatbot-level `userAvatarFallback` /
   * `assistantAvatarFallback` for this one message.
   *
   * READ SITE: `packages/plugin-chatbot/src/index.tsx:177–178` —
   * `message.avatarFallback || userAvatarFallback` on a user message and
   * `message.avatarFallback || assistantAvatarFallback` on an assistant one.
   * Same history as `avatar` above (objectui#7295).
   */
  avatarFallback?: string;
}

/**
 * Citation / RAG source attached to a chat message.
 */
export interface ChatMessageSource {
  id?: string;
  title?: string;
  url: string;
}

/**
 * Represents a tool invocation from an AI assistant message
 */
export interface ChatToolInvocation {
  /**
   * Unique tool call identifier
   */
  toolCallId: string;
  /**
   * Name of the tool being invoked
   */
  toolName: string;
  /**
   * Arguments passed to the tool
   */
  args?: Record<string, unknown> | unknown;
  /**
   * Result of the tool invocation (set when complete)
   */
  result?: unknown;
  /**
   * Error text when the tool call ends in an error state.
   */
  errorText?: string;
  /**
   * Tool invocation state. The legacy `partial-call`/`call`/`result` values
   * are kept for back-compat; the AI SDK v6 lifecycle states map cleanly to
   * `input-streaming`/`input-available`/`output-available`/`output-error`
   * and are accepted directly.
   *
   * ⛔ The SDK's three APPROVAL states — `approval-requested`,
   * `approval-responded` and `output-denied` — are NOT authorable
   * (objectui#10018, the residual clause of the objectui#8426 ruling). A chat
   * runtime produces them: from the SDK's approval envelope, or promoted from
   * an ObjectStack pending-action tool result. An authored claim of one — with
   * or without an `approval` envelope — is refused here and by the Zod mirror,
   * so a schema cannot declare an approval the runtime has nothing to back.
   * They still reach a host on the way OUT, which is why `ChatbotSchema.onSend`
   * does not hand back this authoring shape — see {@link ChatMessageHandedBack}.
   */
  state?:
    | 'partial-call'
    | 'call'
    | 'result'
    | 'input-streaming'
    | 'input-available'
    | 'output-available'
    | 'output-error';
  /**
   * AI SDK v6 approval envelope — the data a human decision on this tool call
   * is carried by, and the piece that makes the three approval states
   * ACTIONABLE rather than merely displayable (objectui#8442).
   *
   * The SDK's own tool-part union makes this envelope REQUIRED alongside
   * `approval-requested`, `approval-responded` and `output-denied`: a value
   * that claims one of those states without it is not a constructible SDK
   * part. Carrying it here is what lets a mapper hand a rehydrated pending
   * approval to a chat surface without the surface re-parsing the tool result.
   *
   * Optional because none of the states an author may declare REQUIRES one:
   * the three that do are runtime-only and are shed from the `state` union
   * above (objectui#10018), so an authored invocation cannot claim one of them
   * with or without this envelope. Of the authorable states, the SDK's union
   * admits an already-decided envelope (`approved: true`) on `output-available`
   * and `output-error` only; its two input states admit none.
   */
  approval?: {
    /** Approval request id — the key a decision is replied on. */
    id: string;
    /** The decision, once made. Absent while the request is outstanding. */
    approved?: boolean;
    /** Free-text reason supplied with the decision. */
    reason?: string;
    /** True when policy decided without asking a human. */
    isAutomatic?: boolean;
    /** Signature over the approval, when the transport signs decisions. */
    signature?: string;
  };
}

/**
 * The AI SDK's three approval lifecycle states — RUNTIME-ONLY (objectui#10018).
 *
 * Shed from {@link ChatToolInvocation}'s authoring `state` union: a chat
 * runtime produces them (from the SDK's approval envelope, or promoted from an
 * ObjectStack pending-action tool result) and an author never does. They are
 * named here for ONE reader — {@link ChatMessageHandedBack}, the shape a chat
 * runtime hands BACK to a host — and are ⛔ deliberately NOT exported: the
 * authoring package gives an author no name to reach for.
 *
 * `@object-ui/plugin-chatbot` spells the same three states on its runtime
 * `ChatbotEnhancedToolInvocation` (named apart from this authoring
 * `ChatToolInvocation` since objectui#6349, batch 5: two meanings, two names).
 * Its `chat-message-contract.test.ts` derives this alias
 * through `ChatbotSchema['onSend']` and pins the two spellings EQUAL, so
 * neither can move alone.
 */
type ChatToolRuntimeOnlyState = 'approval-requested' | 'approval-responded' | 'output-denied';

/**
 * One chat message as a chat runtime hands it BACK to a host — the element
 * type of `ChatbotSchema.onSend`'s `messages`.
 *
 * The authoring {@link ChatMessage} widened by exactly one thing: its tool
 * invocations may also be in a {@link ChatToolRuntimeOnlyState}. A runtime
 * hands back the thread it holds, and in API mode that thread holds approval
 * states the authoring face refuses (objectui#10018) — so typing the callback's
 * `messages` as the authoring `ChatMessage[]` would understate the values a
 * host receives. ⛔ Not exported, for the same reason as the states above;
 * a host that needs to spell it reads it off the slot:
 * `Parameters<NonNullable<ChatbotSchema['onSend']>>[1]`.
 */
type ChatMessageHandedBack = Omit<ChatMessage, 'toolInvocations'> & {
  toolInvocations?: Array<
    Omit<ChatToolInvocation, 'state'> & {
      state?: ChatToolInvocation['state'] | ChatToolRuntimeOnlyState;
    }
  >;
};

/**
 * Chatbot component — the authoring face of the
 * `ComponentRegistry.register('chatbot', ...)` registration in
 * `packages/plugin-chatbot/src/renderer.tsx` (objectui#7655).
 *
 * ## Six ADR-0049 retirement tombstones (`a4611b3e2`)
 *
 * `loading`, `showAvatars`, `userAvatar`, `assistantAvatar`, `markdown` and
 * `height` are `?: never` below, each paired with a `retirementTombstone()`
 * arm on the Zod twin (`zod/complex.zod.ts`). They were declared here,
 * mirrored there, and read by NO registration — a published type teaching six
 * knobs that did nothing.
 *
 * The instrument, re-measured on this branch's base rather than inherited
 * from the card: one `schema.KEY` count per `ComponentRegistry.register(...)`
 * body of `renderer.tsx`, the file split at the three register calls
 * (`chatbot` / `chatbot-enhanced` / `chatbot-floating`). All six read
 * 0 / 0 / 0. Lit controls on the same instrument in the same pass —
 * `placeholder` 1 / 1 / 1, `messages` 1 / 1 / 1, `userAvatarUrl` 1 / 1 / 1,
 * `maxHeight` 1 / 1 / 0, `floatingConfig` 0 / 0 / 1, `processVisibility`
 * 0 / 1 / 0 — so the zeros are readings, not a blind grep.
 *
 * The named-read census is now the WHOLE channel. It was not always: the
 * `chatbot-floating` registration used to end its `<FloatingChatbot>` element
 * with a raw `{...props}` spread, which handed the panel's `<ChatbotEnhanced>`
 * every authored key unfiltered — and that component HAS a `showAvatars` prop,
 * so the key was live there by accident. The card behind `d3499b315` ruled FENCE: the spread
 * is filtered through `toDomProps` and moved to the head of the element, the
 * shape the two sibling registrations already used. ⇒ `showAvatars` is a key
 * the FENCE turned dark, not a key nothing ever read; the other five were live
 * on no channel at any time (`loading`, `userAvatar`, `assistantAvatar`,
 * `markdown` and `height` are not `ChatbotEnhancedProps` members either —
 * markdown exists there only as `enableMarkdown` — so the spread had nothing
 * to land them on).
 *
 * ⚠️ `processVisibility` is deliberately NOT part of this retirement:
 * `chatbot-enhanced` reads it (0 / 1 / 0), and objectui#7655 left the member
 * here exactly as it was.
 *
 * ## Why tombstones and not deletions — the mirror decides it here
 *
 * All six HAVE a Zod arm, so deleting the declaration would trade one silent
 * no-op for another: `BaseSchema` is `.passthrough()` on the Zod side (and
 * carried a `[key: string]: any` index signature on the TS side until
 * objectui#8347), so an UNDECLARED key is not refused there, it is KEPT. That is the hazard the two-prong
 * discriminator leaves to the carrier — where there is no mirror there is "no
 * silent-strip hazard for prong 2 to guard" (`mobile.ts`, objectui#5941 /
 * #7526 / `5f8190c8c`: a `?: never` tombstone is available only on a SURVIVING
 * CARRIER — `ChatbotSchema` survives, while a whole exported type name has no
 * carrier and is removed outright — and on such a carrier it is used when
 * either prong holds: it steers authors to a named live replacement KEY, or it
 * keeps loud a key the docs taught as working). Here there IS a mirror to host
 * the refusal, and prong 1 holds by the letter for
 * four of the six — `userAvatar` → `userAvatarUrl`, `assistantAvatar` →
 * `assistantAvatarUrl`, `height` → `maxHeight`, `markdown` →
 * `enableMarkdown` on a `chatbot-enhanced` node. Each member's own comment
 * names its replacement, or says there is none.
 *
 * ## Why not ENFORCE, decided per key
 *
 * The other arm of enforce-or-remove was taken key by key and refused each
 * time. `<Chatbot>` — the component THIS registration renders
 * (`plugin-chatbot/src/index.tsx`) — declares `messages`, `placeholder`,
 * `onSendMessage`, `disabled`, `showTimestamp`, `userAvatarUrl`,
 * `userAvatarFallback`, `assistantAvatarUrl`, `assistantAvatarFallback` and
 * `maxHeight`, and not one of the six. Enforcing any of them would mean
 * growing a component prop (a feature, not a retirement) or wiring a SECOND
 * spelling of a key that already works — the N dialects AGENTS.md #0.1
 * forbids. Per-key argument in each member's comment.
 *
 * Pinned in `__tests__/chatbot-dark-keys-retired-7703.test.ts`.
 */
export interface ChatbotSchema extends BaseSchema {
  type: 'chatbot';
  /**
   * Chat messages
   */
  messages: ChatMessage[];
  /**
   * Input placeholder
   * @default 'Type a message...'
   */
  placeholder?: string;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `loading` (`a4611b3e2`). See
   * {@link ChatbotSchema} for the census, the instrument and the route.
   *
   * Chat progress is RUNTIME state, not authorable metadata. The `chatbot`
   * registration derives it from `useObjectChat` as `isLoading` and spends it
   * on `disabled={hostDisabled || isLoading}`; `<Chatbot>` declares no
   * `loading` prop for an authored value to land on. So `loading: true` never
   * showed a spinner and `loading: false` never hid one.
   *
   * ENFORCE was refused here on the classification, not only on the missing
   * prop: an authored boolean would be a static declaration of a value the
   * chat runtime owns and updates per token — it would fight the runtime, not
   * configure it (AGENTS.md #8: state that a refresh must survive never lives
   * in metadata that cannot see the refresh).
   *
   * There is NO replacement key: nothing authorable selects this. Delete it.
   *
   * @deprecated Not part of this contract — the value was inert. Loading is
   * derived from the chat runtime.
   */
  loading?: never;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `chatbot` renderer wires its own `handleSendMessage` and `toDomProps` drops
   * the key. The zod twin refuses it by name; author behaviour as a node type
   * (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onSendMessage?: never;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `showAvatars` (`a4611b3e2`). See
   * {@link ChatbotSchema} for the census, the instrument and the route.
   *
   * ⭐ The one key of the six whose provenance is a FENCE, not an absence.
   * `<ChatbotEnhanced>` really does have a `showAvatars` prop, and until
   * `d3499b315` the `chatbot-floating` registration's raw trailing
   * `{...props}` spread delivered an authored value straight to it — measured
   * live through the real host. The ruling behind it was FENCE: the spread now goes
   * through `toDomProps` at the head of the element, so the key is dark on all
   * three registrations by ruling. It was never live on a `chatbot` node: no
   * registration forwards it by name, and this one renders `<Chatbot>`, which
   * has no such prop — the card's own counter-example, re-confirmed here.
   *
   * ENFORCE was refused: on a `chatbot` node it has no target to forward to,
   * and re-declaring it on the two faces that CAN reach `<ChatbotEnhanced>`
   * would re-open by declaration exactly the channel `d3499b315` closed by
   * fence, one card earlier. `@default true` was published prose only — the
   * plain `<Chatbot>` renders an avatar beside every message unconditionally,
   * with no gate, and `<ChatbotEnhanced>`'s own prop defaults to `false`.
   *
   * There is no replacement KEY. The avatar IMAGES are `userAvatarUrl` /
   * `assistantAvatarUrl` and their `*Fallback` siblings, which all three
   * registrations read; delete this one.
   *
   * @deprecated Not part of this contract — the value was inert on a `chatbot`
   * node and is dark everywhere since `d3499b315`.
   */
  showAvatars?: never;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `userAvatar` (`a4611b3e2`). See
   * {@link ChatbotSchema} for the census, the instrument and the route.
   *
   * Write **`userAvatarUrl`** (with `userAvatarFallback` for the text shown
   * while it loads or fails) — the live spelling, read 1 / 1 / 1 and declared
   * on all three faces through {@link ChatbotSharedKey}. `userAvatar` has zero
   * word-boundary hits anywhere in `packages/plugin-chatbot/src`: not a stale
   * read, a spelling no code ever had.
   *
   * ENFORCE was refused: wiring it would give one avatar image TWO authorable
   * spellings, the second de-facto contract AGENTS.md #0.1 exists to stop.
   *
   * @deprecated Not part of this contract — the value was inert. Write
   * `userAvatarUrl`.
   */
  userAvatar?: never;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `assistantAvatar` (`a4611b3e2`). See
   * {@link ChatbotSchema} for the census, the instrument and the route.
   *
   * Write **`assistantAvatarUrl`** (with `assistantAvatarFallback`) — the live
   * spelling, read 1 / 1 / 1 and declared on all three faces through
   * {@link ChatbotSharedKey}. `assistantAvatar` has zero word-boundary hits
   * anywhere in `packages/plugin-chatbot/src`.
   *
   * ENFORCE was refused for the same reason as `userAvatar`: a second
   * authorable spelling of one image is a second contract.
   *
   * @deprecated Not part of this contract — the value was inert. Write
   * `assistantAvatarUrl`.
   */
  assistantAvatar?: never;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `markdown` (`a4611b3e2`). See
   * {@link ChatbotSchema} for the census, the instrument and the route.
   *
   * The `chatbot` node renders `<Chatbot>`, which has no markdown path at all:
   * it prints message content as text, so there was never a renderer for this
   * switch to reach. Markdown is a `chatbot-enhanced` / `chatbot-floating`
   * capability, where the live spelling is **`enableMarkdown`** on
   * {@link ChatbotEnhancedSchema} / {@link ChatbotFloatingSchema} (read
   * 0 / 1 / 1). `markdown` is not a `ChatbotEnhancedProps` member either.
   *
   * ENFORCE was refused twice over: on this node it would mean building a
   * markdown renderer into `<Chatbot>` (a feature), and on the other two it
   * would be a second spelling of `enableMarkdown`. `@default true` was
   * published prose the plain component never honoured.
   *
   * @deprecated Not part of this contract — the value was inert. Author
   * `type: 'chatbot-enhanced'` with `enableMarkdown` instead.
   */
  markdown?: never;
  /**
   * How much agent reasoning/tool detail to show.
   * @default 'summary'
   */
  processVisibility?: 'hidden' | 'summary' | 'debug';
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `height` (`a4611b3e2`). See
   * {@link ChatbotSchema} for the census, the instrument and the route.
   *
   * Write **`maxHeight`** (a CSS length string, default `'500px'`) — the live
   * spelling, read 1 / 1 / 0 and forwarded to `<Chatbot>`'s own `maxHeight`
   * prop. On a `chatbot-floating` node neither key applies: size that panel
   * with `floatingConfig.panelHeight`, a NUMBER of pixels, which is what the
   * panel reads.
   *
   * ENFORCE was refused: `<Chatbot>` has no `height` prop, and adding one
   * beside the `maxHeight` it already forwards would publish two authorable
   * spellings for one dimension — with a `string | number` union that does not
   * even match the live key's `string`.
   *
   * @deprecated Not part of this contract — the value was inert. Write
   * `maxHeight`, or `floatingConfig.panelHeight` on a floating node.
   */
  height?: never;

  // --- AI / service-ai integration fields ---

  /**
   * Backend API endpoint for chat (e.g., '/api/v1/ai/chat').
   * When set, the chatbot uses streaming SSE via the vercel/ai SDK.
   * When not set, the chatbot falls back to local auto-response mode (legacy/demo).
   */
  api?: string;
  /**
   * Conversation ID for multi-turn context.
   * Sent to the backend as an `x-conversation-id` HTTP header.
   */
  conversationId?: string;
  /**
   * System prompt to configure assistant behavior.
   */
  systemPrompt?: string;
  /**
   * AI model identifier (e.g., 'gpt-4o', 'claude-3-opus').
   */
  model?: string;
  /**
   * Whether streaming is enabled for AI responses.
   * @default true
   */
  streamingEnabled?: boolean;
  /**
   * Additional headers to send with API requests (e.g., auth tokens).
   */
  headers?: Record<string, string>;
  /**
   * Additional body parameters to include with each API request.
   */
  requestBody?: Record<string, unknown>;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `maxToolRoundtrips` (objectui#5605). Picked
   * by name onto {@link ChatbotEnhancedSchema} and {@link ChatbotFloatingSchema},
   * so all three chat nodes refuse it with this one declaration.
   *
   * ENFORCE was measured and is not reachable from a chat node: the tool loop
   * runs on the server agent inside ONE streamed response (the chat runtime,
   * `@ai-sdk/react`'s `useChat`, is given no client tool loop), `useChat` has no
   * numeric round-trip cap, and neither chat request schema in
   * `@objectstack/spec` carries a cap field. The value used to be threaded from
   * the document into the chat hook and dropped there, so setting it never
   * limited anything.
   *
   * Cap tool-calling loops on the agent instead — `planning.maxIterations`,
   * which the platform spec declares (default 10).
   *
   * @deprecated Not part of this contract — the value was never honoured.
   * Delete the key; cap tool loops on the agent (`planning.maxIterations`).
   */
  maxToolRoundtrips?: never;
  /**
   * Callback when an error occurs during streaming or API calls.
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * forwarded by `plugin-chatbot` into `useObjectChat({ onError })`.
   */
  onError?: (error: Error) => void;

  // --- Local display + legacy auto-response fields (objectui#6169) ---
  //
  // Lifted from an anonymous inline intersection that used to live ONLY at
  // `packages/plugin-chatbot/src/renderer.tsx`'s `chatbot` registration site
  // (`ComponentRegistry.register('chatbot', ...)`), where nothing outside
  // that one file could reference, validate, or document them. Each key
  // below was read-site-censused before being declared here — every one has
  // a live reader in `renderer.tsx` and/or `useObjectChat.ts`; none were
  // dead. `disabled` is deliberately NOT redeclared in this group: it is
  // already `BaseSchema.disabled` (`boolean | string`), read generically by
  // `SchemaRenderer` for every node type, not specific to `chatbot`.

  /**
   * Display a timestamp on each message.
   * @default false
   */
  showTimestamp?: boolean;
  /**
   * URL of the user's avatar image.
   */
  userAvatarUrl?: string;
  /**
   * Fallback text shown when `userAvatarUrl` is not set or fails to load.
   * @default 'You'
   */
  userAvatarFallback?: string;
  /**
   * URL of the assistant's avatar image.
   */
  assistantAvatarUrl?: string;
  /**
   * Fallback text shown when `assistantAvatarUrl` is not set or fails to load.
   * @default 'AI'
   */
  assistantAvatarFallback?: string;
  /**
   * Maximum height of the chat message container (CSS value).
   * @default '500px'
   */
  maxHeight?: string;
  /**
   * Enable local auto-response (demo/playground) mode. Ignored once `api`
   * is set — API mode replaces the local echo entirely.
   * @default false
   */
  autoResponse?: boolean;
  /**
   * The text of the local auto-response, used when `autoResponse` is true.
   */
  autoResponseText?: string;
  /**
   * Delay in milliseconds before the local auto-response is sent.
   * @default 1000
   */
  autoResponseDelay?: number;
  /**
   * Called after a message is sent, in both API and local auto-response mode,
   * with the trimmed content and the full message list at that point.
   * `messages` is the thread the chat runtime HOLDS, not the one that was
   * authored: the authoring {@link ChatMessage} shape whose tool invocations
   * may also carry the three runtime-only approval states
   * ({@link ChatMessageHandedBack}). API mode produces those states and the
   * authoring face refuses them (objectui#10018), so ⚠️ a handler that
   * declares its parameter as the authoring `ChatMessage[]` no longer
   * type-checks against this slot — that shape is narrower than the values
   * the handler receives. Let the parameter be inferred from this slot.
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * forwarded by `plugin-chatbot` into `useObjectChat({ onSend })`.
   */
  onSend?: (content: string, messages: ChatMessageHandedBack[]) => void;

  // --- Floating / FAB configuration ---

  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `displayMode` (objectui#7654, maintainer
   * ruling B, 2026-09-05). Write the node `type` instead: `'chatbot-floating'`
   * for the trigger-and-panel presentation, `'chatbot'` / `'chatbot-enhanced'`
   * for an inline one. The node's `type` is the one selector of presentation;
   * this key was a second spelling of that choice that no renderer has ever
   * read.
   *
   * What was measured, on the retiring PR's base: `displayMode` was declared
   * here and on {@link ChatbotFloatingSchema}, offered as a "Display Mode"
   * control in the `chatbot-floating` registration's `inputs`, and seeded as
   * `'floating'` by that registration's `defaultProps` — and read by nothing.
   * `chatbot-floating` renders `<FloatingChatbot>` unconditionally and
   * `chatbot` never looked at the key, so `'floating'` on a `chatbot` node
   * produced no trigger and `'inline'` on a `chatbot-floating` node changed
   * nothing. A whole-repo `git grep` census over tracked files, build output
   * excluded, returned those sites, the doc comments and ledger entries beside
   * them, one historical CHANGELOG line and two unrelated `displayMode` props
   * (`GridField`, `MasterDetailForm`); the same pass over `floatingConfig`, a
   * key that IS read, returned 79 lines, so the instrument was not blind. The
   * control and the seed are removed in the same change; the restatement of
   * that control is this tombstone plus the release note (`5f4514f7b`: a
   * control is restated, never deleted into a vacuum).
   *
   * ## Why a tombstone — discriminator prong 2 — and why it is loud-vs-silent here
   *
   * A `?: never` tombstone is available only on a surviving carrier
   * (`ChatbotSchema` survives) and is used when either prong of this package's
   * discriminator holds: it steers authors to a named live replacement KEY,
   * or it keeps loud a key the docs taught as working. Prong 2 holds: the key
   * was advertised in the 3.3.0 release record (`CHANGELOG.md:578`, "Extended
   * `ChatbotSchema` with `displayMode` (`'inline' | 'floating'`) …") and its
   * published comment told authors it selected the presentation. Prong 1 is
   * not met by the letter — the replacement is the discriminant `type`, not a
   * new key — which is why the guidance above names `type`.
   *
   * On a carrier extending {@link BaseSchema} — every component schema in this
   * package — deleting an optional member was SILENT in every value shape while
   * `BaseSchema` carried `[key: string]: any` (until objectui#8347), because the
   * index signature defeated both excess-property checking and the weak-type
   * check. Measured on THIS member at the time with `tsc -p tsconfig.test.json`, a no-index-signature control carrier
   * (`FloatingChatbotConfig`) lit in the same run (TS2353 on a fresh undeclared
   * key, TS2559 on a lone-key widened value):
   *
   *   | route      | fresh `'floating'` | fresh `'bogus'` | widened `'floating'` |
   *   |------------|--------------------|-----------------|----------------------|
   *   | declared   | clean              | TS2322          | clean                |
   *   | DELETED    | clean              | clean           | clean                |
   *   | TOMBSTONED | TS2322             | TS2322          | TS2322               |
   *
   * Deleted, the member read as `any` through the index signature and even a
   * wrong-typed value went quiet. Since objectui#8347 a deletion trips TS2353
   * on a fresh literal, with no name for the remedy, and still rides a widened
   * value clean. Tombstoned, PRESENCE with any value is a compile error in every
   * shape, by name — a channel deletion cannot produce through a widened value:
   * on a `BaseSchema` carrier the two routes were loud-vs-silent, and through a
   * widened value they still are. Pinned, the deleted row included as a live control, in
   * `__tests__/chatbot-display-mode-retired.test.ts`.
   *
   * ## Runtime: unchanged, deliberately — zero validation before and after
   *
   * There is NO `retirementTombstone()` half. `displayMode` has never had a
   * Zod arm: it sits in the `UnmirroredDeclared` ledger for both
   * `complex.zod.ts#ChatbotSchema` and `#ChatbotFloatingSchema`
   * (`__tests__/zod-mirror-parity.test.ts`), and `BaseSchema` is
   * `.passthrough()`, so a stored document carrying `displayMode: 'floating'`
   * — every node the designer ever created — parsed green before this change
   * and parses green after it, and the value is dropped at render time as it
   * always was. Minting an arm to refuse it would be the declared-but-
   * unmirrored axis (objectui#6152); the retirement test pins both twins'
   * shapes as a tripwire so that whoever mints the mirror adds the
   * `retirementTombstone()` half at that time. objectui#6152 round 4 took the
   * question under that ruling and kept the refusal TypeScript-only: stored
   * designer documents carry `displayMode: 'floating'`, so no arm is minted
   * and the key stays unmirrored on both twins by decision, not as debt.
   *
   * @deprecated Not part of this contract — the value was inert. The node
   * `type` selects the presentation.
   */
  displayMode?: never;

  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `floatingConfig` on a `chatbot` node
   * (objectui#6152 round 5, the seat's answer A). Author a `chatbot-floating`
   * node instead: {@link ChatbotFloatingSchema.floatingConfig} is the one
   * declaration of the trigger and panel geometry, and that registration is the
   * one that reads it.
   *
   * What was measured, on the retiring change's base (a reading at that
   * revision, ⛔ not a live count): a type-checker census over every package
   * found no read of this member and no producer outside one test; a runtime
   * probe through the real `SchemaRenderer` and registry rendered a `chatbot`
   * node byte-for-byte the same with and without a full `floatingConfig`
   * (a `placeholder` control moved the DOM, and the same config on a
   * `chatbot-floating` node drew its title); and no document authored it on a
   * `chatbot` node. The `chatbot` registration forwards only DOM-safe props,
   * so the value never reached `<Chatbot>`, which has no trigger or panel to
   * apply it to.
   *
   * Retired from THIS face only. {@link ChatbotFloatingSchema} does not
   * inherit it: that face extends `Pick<ChatbotSchema, ChatbotSharedKey |
   * 'maxToolRoundtrips'>` and declares its own `floatingConfig`, and its zod
   * twin spreads the shared pick and mirrors the member itself — so no
   * re-declaration was needed, and the floating face is untouched.
   *
   * A `?: never` tombstone and ⛔ not a deletion, by the discriminator stated
   * on {@link ChatbotSchema.displayMode} above (cited, not restated): a deleted
   * member on this {@link BaseSchema} carrier read as `any` through the index
   * signature until objectui#8347 (and still rides a widened value), and this
   * member's published comment advertised the floating
   * configuration on the `chatbot` face. The zod twin refuses it by name.
   *
   * @deprecated Not a key `chatbot` reads — author `type: 'chatbot-floating'`
   * with `floatingConfig`.
   */
  floatingConfig?: never;
  /**
   * REFUSED BY NAME (objectui#8572, ADR-0049) — the chat API's body params are
   * authored as `requestBody`, and `body` on this node means what it means on
   * every other component: the content slot. Write `requestBody`.
   *
   * ⚠️ The two faces were not saying the same thing, and only one of them
   * carried the record. HERE `body` has always arrived from {@link BaseSchema}
   * as the node slot, with the params declared beside it as `requestBody` since
   * that rename; the record-shaped arm — "Additional API body params" — lived
   * on the ZOD twin alone, and that is the published face this retirement
   * narrows. The `?: never` here is what makes `tsc` say the same thing at the
   * authoring site. ⇒ the pair stops being two meanings of one key, the
   * collision `__tests__/zod-mirror-parity.test.ts` carried under `KnownDrift`
   * and the state maintainer ruling A on objectui#8572 (decision batch #137,
   * item 4, 2026-09-15) ends.
   *
   * ⛔ It was NOT narrowed to the node slot — that reading was option C on the
   * card and was refused by name: `chatbot` reads NEITHER content channel, so a
   * node-slot `body` would be legal and inert, which is the silence the
   * retirement exists to end. It is refused instead, the disposition the
   * sibling `children` tombstone below already carries — and that tombstone's
   * own measurement names `body` in the same sentence.
   *
   * What the renderer does instead: it spells the chat runtime's `body` option
   * off `requestBody` (`body: schema.requestBody`), which is why a `body`
   * authored here reached nothing — `SchemaRenderer` strips both content keys
   * out of the props bag it spreads, and no read in `packages/plugin-chatbot`
   * names `schema.body`. ⛔ That absence is not restated here as a count: the
   * instruments that re-derive it are the read-site census in
   * `__tests__/content-channel-family-d-9256.test.ts` and the arm pins in
   * `__tests__/node-recursion-point-8344.test.ts`.
   *
   * ⚠️ DELIVERY SURFACE, stated because it bounds what this buys. The zod
   * refusal is PARSE-TIME and this member is COMPILE-TIME, and the runtime
   * render path is neither: `SchemaRenderer` validates in dev builds only, and
   * through `@object-ui/core`'s hand-written `validateSchema`, which walks base
   * keys and recurses into content — it never consults these mirrors, so it has
   * no per-component key to refuse. ⇒ an authored `body` that meets neither
   * `tsc` nor a root parse (`objectui validate`, which runs the strict
   * authoring face) is dropped exactly as silently after this change as
   * before it. The refusal is delivered where documents are AUTHORED and
   * CHECKED, not where they are rendered.
   * `objectui check` does not deliver it: `body` is one of the structural root
   * keys that command recognises a file by, and a file recognised that way is
   * never parsed against the schema. The CLI's verdict is `objectui validate`.
   *
   * @deprecated Not a channel `chatbot` reads — author the chat API's body
   * params as `requestBody`.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `chatbot` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `api`, `assistantAvatarFallback`, `assistantAvatarUrl`, `autoResponse`,
   * `autoResponseDelay`, `autoResponseText`, `conversationId`, `headers`,
   * `maxHeight`, `messages`, `model`, `onError`, `onSend`,
   * `placeholder`, `requestBody`, `showTimestamp`, `streamingEnabled`,
   * `systemPrompt`, `userAvatarFallback`, `userAvatarUrl` (in
   * `packages/plugin-chatbot/src/renderer.tsx`).
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
   * @deprecated Not a channel `chatbot` reads — nothing renders it.
   */
  children?: never;
}

/**
 * The chat-surface keys that ALL THREE `plugin-chatbot` registrations read
 * (objectui#7655) — the members {@link ChatbotEnhancedSchema} and
 * {@link ChatbotFloatingSchema} pick off {@link ChatbotSchema} by name, so the
 * three faces share ONE declaration and ONE doc comment per key.
 *
 * Every member was read-site-censused per registration on the PR's base: one
 * NAMED `schema.KEY` read in each of the three `ComponentRegistry.register(...)`
 * bodies of `packages/plugin-chatbot/src/renderer.tsx`, forwarded into
 * `useObjectChat` or onto the rendered component. (Named reads are the
 * instrument; the `chatbot-floating` registration also HAD an unfiltered
 * props spread on this census's base — fenced since, `d3499b315`; see
 * {@link ChatbotFloatingSchema}.) The instrument was lit by
 * keys that are NOT shared — `processVisibility` read 0 / 1 / 0 across
 * `chatbot` / `chatbot-enhanced` / `chatbot-floating` and `floatingConfig`
 * 0 / 0 / 1 — so a zero in that census is a reading, not a blind grep.
 *
 * Exported only because an exported interface may not extend a `Pick` over a
 * private name (TS4022). It is a census, not an authoring face, and it is not
 * re-exported from the package entry: the node types are.
 */
export type ChatbotSharedKey =
  | 'messages'
  | 'placeholder'
  | 'api'
  | 'conversationId'
  | 'systemPrompt'
  | 'model'
  | 'streamingEnabled'
  | 'headers'
  | 'requestBody'
  | 'onError'
  | 'showTimestamp'
  | 'userAvatarUrl'
  | 'userAvatarFallback'
  | 'assistantAvatarUrl'
  | 'assistantAvatarFallback'
  | 'autoResponse'
  | 'autoResponseText'
  | 'autoResponseDelay'
  | 'onSend';

/**
 * `chatbot-enhanced` component — the authoring face of the
 * `ComponentRegistry.register('chatbot-enhanced', ...)` registration in
 * `packages/plugin-chatbot/src/renderer.tsx` (objectui#7655, under the
 * objectui#6169 / #6172 family ruling: every component node has exactly one
 * named, importable authoring-face type).
 *
 * Until objectui#7655 this node had no importable type: {@link ChatbotSchema}
 * pins `type` to `'chatbot'`, so an author either dropped to untyped JSON or
 * annotated with `ChatbotSchema` and lied about `type`. The registration's
 * parameter type was an anonymous `ChatbotSchema & { ... }` intersection
 * local to the renderer, referenceable by nothing outside that file.
 *
 * What is declared here is what THIS registration reads — censused per key on
 * the PR's base, not copied off `ChatbotSchema`:
 *
 *   - the nineteen {@link ChatbotSharedKey} members every registration reads;
 *   - the `maxToolRoundtrips` retirement tombstone (objectui#5605), picked off
 *     {@link ChatbotSchema} so all three chat nodes refuse it with one declaration;
 *   - `maxHeight` and `processVisibility`, which `chatbot-enhanced` forwards to
 *     `<ChatbotEnhanced>` by name and `chatbot-floating` has no named read for
 *     (its panel is sized by `floatingConfig.panelHeight`; for the second,
 *     unnamed channel on that registration see {@link ChatbotFloatingSchema});
 *   - `enableMarkdown`, `enableFileUpload`, `surface` and the `onClear`
 *     runtime slot, which `ChatbotSchema` never declared.
 *
 * NOT declared, on purpose: `loading`, `showAvatars`, `userAvatar`,
 * `assistantAvatar`, `markdown` and `height` — `ChatbotSchema` members this
 * registration has no read for. `disabled` and `className` are inherited from
 * {@link BaseSchema}: `SchemaRenderer` evaluates `disabled` / `disabledOn`
 * for every node type and hands the verdict to the registration as a prop, so
 * redeclaring `disabled` here as `boolean` would only narrow away the
 * expression-string half of an inherited field (objectui#6169, `c93b4d5f3`).
 */
export interface ChatbotEnhancedSchema
  extends BaseSchema,
    Pick<ChatbotSchema, ChatbotSharedKey | 'maxToolRoundtrips' | 'maxHeight' | 'processVisibility'> {
  type: 'chatbot-enhanced';
  /**
   * Render assistant messages as markdown. Forwarded to `<ChatbotEnhanced>`'s
   * `enableMarkdown` prop; an unauthored value falls back to `true` at the
   * registration (`schema.enableMarkdown ?? true`).
   * @default true
   */
  enableMarkdown?: boolean;
  /**
   * Show the file-attachment control in the composer. Forwarded to
   * `<ChatbotEnhanced>`'s `enableFileUpload` prop; an unauthored value falls
   * back to `false` at the registration.
   * @default false
   */
  enableFileUpload?: boolean;
  /**
   * Visual chrome for the chat surface (objectui#6687, maintainer ruling
   * 2026-08-29). `'card'` keeps the embeddable bordered panel; `'plain'`
   * removes the panel chrome for a full-page chat workspace. Declared on this
   * node only: `chatbot-enhanced` is the one registration that renders
   * `<ChatbotEnhanced>` and has a `surface` prop to forward it to. Passed
   * through `undefined` when unauthored, so the component's own `'card'`
   * default keeps applying.
   *
   * The plugin's `ChatbotSurface` alias (`@object-ui/plugin-chatbot`) is the
   * component-side spelling of this same union; the plugin's tests pin the
   * two equal so they cannot drift into two dialects (AGENTS.md #0.1).
   * @default 'card'
   */
  surface?: 'card' | 'plain';
  /**
   * Called after the conversation is cleared through the composer's clear
   * control, once the chat runtime has dropped its messages.
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because
   * `plugin-chatbot`'s `handleClear` invokes `schema.onClear?.()`.
   */
  onClear?: () => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `chatbot-enhanced` reads
   * NEITHER content channel: no renderer read consumes `body` or `children` for
   * this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `api`, `assistantAvatarFallback`, `assistantAvatarUrl`, `autoResponse`,
   * `autoResponseDelay`, `autoResponseText`, `conversationId`,
   * `enableFileUpload`, `enableMarkdown`, `headers`, `maxHeight`,
   * `messages`, `model`, `onClear`, `onError`, `onSend`,
   * `placeholder`, `processVisibility`, `requestBody`, `showTimestamp`,
   * `streamingEnabled`, `surface`, `systemPrompt`, `userAvatarFallback`,
   * `userAvatarUrl` (in `packages/plugin-chatbot/src/renderer.tsx`).
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
   * @deprecated Not a channel `chatbot-enhanced` reads — nothing renders it.
   */
  children?: never;
}

/**
 * `chatbot-floating` component — the authoring face of the
 * `ComponentRegistry.register('chatbot-floating', ...)` registration
 * (objectui#7655; same ruling and same census discipline as
 * {@link ChatbotEnhancedSchema}). The floating-action-button presentation: a
 * trigger in a page corner that opens a chat panel overlay.
 *
 * Declared here is what THIS registration reads by name (`schema.KEY`),
 * censused per key on the PR's base:
 *
 *   - the nineteen {@link ChatbotSharedKey} members;
 *   - the `maxToolRoundtrips` retirement tombstone (objectui#5605);
 *   - `enableMarkdown`, `enableFileUpload` and the `onClear` runtime slot,
 *     forwarded into the panel's `<ChatbotEnhanced>`;
 *   - `floatingConfig`, the trigger and panel geometry
 *     ({@link FloatingChatbotConfig}) — declared on THIS face alone since
 *     objectui#6152 round 5 retired the `chatbot` face's copy, which that
 *     registration never read (this face never inherited it: the `Pick` above
 *     leaves it out) — and `displayMode`, a `?: never` tombstone on both
 *     faces since objectui#7654; see each member's comment.
 *
 * NOT declared, on purpose: `maxHeight` (the panel pins its inner chat to
 * `100%` of `floatingConfig.panelHeight` AFTER any forwarded value, so an
 * authored `maxHeight` is dead here), `processVisibility` and `surface` (no
 * named read in this registration), and the six `ChatbotSchema` legacy
 * members no registration reads by name. `disabled` / `className` are
 * inherited from {@link BaseSchema}, as on the two sibling faces.
 *
 * The named-read census used to not be the only channel: this registration
 * ended its `<FloatingChatbot>` element with a raw `{...props}` spread —
 * every authored key `SchemaRenderer` forwards, unfiltered — and the panel
 * is a `<ChatbotEnhanced>`, so an authored `processVisibility`, `surface` or
 * `showAvatars` reached it (measured through the real host, `d3499b315`).
 * That channel was accidental, not contract, and is now CLOSED: the spread
 * is fenced through `toDomProps` and moved to the head of the element, the
 * same shape the two sibling registrations already use, so this face's
 * declared set is now also its delivered set. `processVisibility` and
 * `surface` are dark on `chatbot-floating` on purpose, same as `showAvatars`
 * above — author them on `chatbot-enhanced` instead.
 */
export interface ChatbotFloatingSchema
  extends BaseSchema,
    Pick<ChatbotSchema, ChatbotSharedKey | 'maxToolRoundtrips'> {
  type: 'chatbot-floating';
  /**
   * Render assistant messages as markdown inside the panel. Forwarded to the
   * panel's `enableMarkdown` prop; an unauthored value falls back to `true` at
   * the registration.
   * @default true
   */
  enableMarkdown?: boolean;
  /**
   * Show the file-attachment control in the panel's composer. Forwarded to
   * the panel's `enableFileUpload` prop; an unauthored value falls back to
   * `false` at the registration.
   * @default false
   */
  enableFileUpload?: boolean;
  /**
   * Called after the conversation is cleared through the panel's clear
   * control, once the chat runtime has dropped its messages.
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata; the zod twin refuses it by name. Kept callable here because
   * `plugin-chatbot`'s `handleClear` invokes `schema.onClear?.()`.
   */
  onClear?: () => void;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — the same `displayMode` retirement as
   * {@link ChatbotSchema.displayMode} (objectui#7654, maintainer ruling B,
   * 2026-09-05); the rationale, the measurements and the runtime note live
   * there, once. Declared here as well because objectui#7655 put the member on
   * this face with `ChatbotSchema`'s own three lines so the retirement would
   * find it on both faces — and because this is the face of the one
   * registration that offered the control: a `chatbot-floating` node IS the
   * floating presentation, so there is nothing left for this key to select.
   * `type: 'chatbot-floating'` is the whole spelling.
   * @deprecated Not part of this contract — the value was inert. The node
   * `type` selects the presentation.
   */
  displayMode?: never;
  /**
   * Configuration for the floating action button and the panel it opens —
   * read by `chatbot-floating` alone and forwarded to `<FloatingChatbot>`.
   * The one declaration of this geometry: {@link ChatbotSchema.floatingConfig}
   * is a retirement tombstone since objectui#6152 round 5.
   */
  floatingConfig?: FloatingChatbotConfig;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `chatbot-floating` reads
   * NEITHER content channel: no renderer read consumes `body` or `children` for
   * this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `api`, `assistantAvatarFallback`, `assistantAvatarUrl`, `autoResponse`,
   * `autoResponseDelay`, `autoResponseText`, `conversationId`,
   * `enableFileUpload`, `enableMarkdown`, `floatingConfig`, `headers`,
   * `messages`, `model`, `onClear`, `onError`, `onSend`,
   * `placeholder`, `requestBody`, `showTimestamp`, `streamingEnabled`,
   * `systemPrompt`, `userAvatarFallback`, `userAvatarUrl` (in
   * `packages/plugin-chatbot/src/renderer.tsx`).
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
   * @deprecated Not a channel `chatbot-floating` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Configuration for the floating chatbot FAB widget.
 */
export interface FloatingChatbotConfig {
  /**
   * Position of the FAB trigger button.
   * @default 'bottom-right'
   */
  position?: 'bottom-right' | 'bottom-left';
  /**
   * Whether the panel is open by default on mount.
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Width of the floating panel.
   * @default 400
   */
  panelWidth?: number;
  /**
   * Height of the floating panel.
   * @default 520
   */
  panelHeight?: number;
  /**
   * Title displayed in the panel header.
   * @default 'Chat'
   */
  title?: string;
  /**
   * ADR-0049 RETIREMENT TOMBSTONE — `triggerIcon` (objectui#7654).
   *
   * `?: never` is this package's tombstone convention (see {@link
   * ComponentInput} in `base.ts`, `crud.ts` `confirm`, and {@link
   * StaticTableColumn} in `data-display.ts`): the key stays DECLARED and
   * becomes UNWRITABLE, so authoring one is a `tsc` error here.
   *
   * What was measured, on the merge-base of the retiring PR: nothing reads it.
   * `FloatingChatbot` (`plugin-chatbot/src/FloatingChatbot.tsx`) destructures
   * six of this interface's seven keys — `position`, `defaultOpen`,
   * `panelWidth`, `panelHeight`, `title`, `triggerSize` — and never this one;
   * `FloatingChatbotTrigger` takes no icon prop at all, so the promised
   * `'MessageCircle'` default never rendered either. A whole-repo `git grep`
   * census over tracked files, build output excluded, returned exactly this
   * declaration and one historical CHANGELOG line; the same pass over
   * `triggerSize`, a key that IS read, returned ten sites across four files, so
   * the instrument was demonstrably not blind.
   *
   * It is also absent from the `chatbot-floating` registration's `inputs` AND
   * its `defaultProps` (`plugin-chatbot/src/renderer.tsx`), so no designer
   * control ever offered it and no designer-created node carries it. The key
   * was reachable from TypeScript alone — which is exactly the surface this
   * tombstone closes.
   *
   * ## Why there is NO `retirementTombstone()` half, and why that is not an omission
   *
   * The other tombstones in this package pair `?: never` with a
   * `retirementTombstone()` refusal on the Zod twin. There is no twin to carry
   * one here: `FloatingChatbotConfig` has NO Zod mirror at all, and
   * `floatingConfig` sits in the `UnmirroredDeclared` ledger
   * (`__tests__/zod-mirror-parity.test.ts`, `complex.zod.ts#ChatbotSchema`).
   * `BaseSchema` is `.passthrough()`, so the whole `floatingConfig` object
   * rides through unvalidated — before this change and after it, byte for
   * byte. Minting a mirror to host a refusal would be the declared-but-
   * UNMIRRORED axis (objectui#6152), a different defect from this one: a key
   * can be mirrored and inert, or unmirrored and live, and fixing one says
   * nothing about the other. This retirement deliberately does not widen into
   * it, so `triggerIcon`'s refusal is TYPE-LEVEL ONLY. Runtime parse behaviour
   * is unchanged.
   *
   * ⚠️ AMENDED by objectui#6152 round 4, which minted that mirror. The
   * `chatbot-floating` twin now declares `floatingConfig` through a
   * module-private restatement of this interface in `zod/complex.zod.ts`, and
   * that restatement carries the `retirementTombstone()` half for this key, so
   * on a `chatbot-floating` node `floatingConfig.triggerIcon` is refused at
   * runtime too. `ChatbotSchema.floatingConfig` stays unmirrored — the `chatbot`
   * registration never reads it — so on a `chatbot` node the refusal is still
   * type-level only. The paragraph above is the reading this retirement landed
   * on.
   *
   * ⚠️ AMENDED again by objectui#6152 round 5, which RETIRED
   * `ChatbotSchema.floatingConfig` on both faces. A `chatbot` node now refuses
   * the whole `floatingConfig` key — `triggerIcon` with it — at compile time and
   * at parse time, so "type-level only" no longer holds anywhere: the one face
   * that still declares this interface is `chatbot-floating`, where both halves
   * of this refusal hold.
   *
   * ## Why a tombstone and not a deletion, with only the `tsc` channel available
   *
   * The usual argument for `?: never` over deletion is about the mirror (an
   * undeclared key is silently STRIPPED by a non-strict `z.object`), and with
   * no mirror here that argument does not apply. The tombstone earns its place
   * on the TypeScript channel alone instead, measured both ways:
   *
   *   - DELETED, a fresh object literal is refused — `TS2353: Object literal
   *     may only specify known properties` — but a WIDENED value is not.
   *     `const raw = { triggerIcon: 'Sparkles' }; const c: FloatingChatbotConfig
   *     = raw;` compiled CLEAN, because excess-property checking does not reach
   *     a non-fresh type. That is the silent no-op traded for another one.
   *   - TOMBSTONED, both paths are refused: the declared `never` makes the
   *     assignment itself ill-typed, so freshness stops mattering.
   *
   * ⚠️ That `tsc` contrast is the MECHANISM, not the discriminator. It applied
   * equally to objectui#4919 and #5942, which were removed outright, so it
   * cannot be what separates the routes. What decides the route is this
   * package's retire-vs-remove discriminator in its amended form
   * (`5f8190c8c`, the same wording the `chatbot` tombstones above carry): a
   * `?: never` tombstone is available only on a SURVIVING CARRIER —
   * `FloatingChatbotConfig` survives this retirement, while a whole exported
   * type name has no carrier and is removed outright — and on such a carrier
   * it is used when either prong holds. PRONG 2 is the one that holds here:
   * the key was advertised in the 3.3.0 release record (2026-04-17, the "New
   * ChatbotSchema floating fields" entry, which names `triggerIcon` among
   * `FloatingChatbotConfig`'s options) and its published JSDoc promised
   * `@default 'MessageCircle'` — the docs taught it as working. Prong 1 does
   * NOT hold: there is no replacement key, which is why the guidance below
   * names the trigger's own markup instead.
   *
   * Pinned in `__tests__/floating-chatbot-trigger-icon-retired.test.ts`,
   * including the deletion contrast, so nobody can "simplify" this back into a
   * deletion without that file going red.
   *
   * RETIRED (objectui#7654, ADR-0049) — never read: the FAB trigger renders a
   * fixed icon and takes no icon prop. There is no authored spelling that
   * changes it; the trigger's markup is the only place to change it.
   * @deprecated Not part of `FloatingChatbotConfig`'s contract — the value was inert.
   */
  triggerIcon?: never;
  /**
   * Custom size for the FAB trigger button in pixels.
   * @default 56
   */
  triggerSize?: number;
}

/**
 * objectui COMPONENT types admitted into a dashboard **widget slot** — the
 * CLOSED enum the maintainer ruling of 2026-08-14 (objectstack#8593) directs
 * `metric-card` into, verbatim: *an SDUI dashboard COMPONENT node validates
 * against objectui's own component schema; the spec's `DashboardSchema` governs
 * stored dashboard metadata documents only and grows no component projection;
 * `metric-card` joins objectui's own CLOSED component enum as an explicitly
 * allowed objectui extension, NOT the spec widget enum.*
 *
 * A member here is not a visualization family at all. `classifyWidgetType`
 * (`@object-ui/plugin-dashboard`'s `widgetDispatch.ts`) returns `passthrough`
 * for it, and `DashboardRenderer` then hands `{ ...widget }` straight to
 * `SchemaRenderer`, which resolves it through `ComponentRegistry` — so the
 * widget slot is holding an ordinary objectui SDUI **component node** whose
 * other keys are that component's own props (`value` / `icon` / `trend` /
 * `trendValue` for `metric-card`, declared as registry `inputs` at
 * `plugin-dashboard/src/index.tsx`). Those props are NOT widget keys and must
 * not be added to {@link DashboardWidgetSchema}; a member of this list is
 * validated as a component node against objectui's own component schema —
 * `BaseSchema` plus the registered inputs it declares (objectui#11467). On the
 * TypeScript face that node is {@link DashboardWidgetSlotComponentSchema}, the
 * component arm — first, as in the Zod twin — of
 * `DashboardComponentSchema.widgets` (objectui#7952).
 *
 * ⛔ Not a widget TYPE (objectui#11483). This list is the component arm's own
 * `type` and nothing else: it is no member of {@link DashboardWidgetTypeName}
 * or its Zod twin, so the slot reads a `metric-card` through the component arm
 * alone, and that arm's required `value` is the one spelling of what the card
 * draws from. While it was also a widget type, `{ type: 'metric-card', title }`
 * parsed as a widget and `MetricCard` drew an empty figure. No widget key binds
 * the card's figure. objectui#11483 measured, through the real
 * `DashboardRenderer` and `DashboardGridLayout`, that a `dataset` then drew
 * `DatasetWidget` in the card's place by a rule that ignored the `type`. Since
 * objectui#11598 (2026-10-04) both surfaces read a widget key on the widget arm
 * alone: a `metric-card` carrying one (`dataset`, `options`, `component`, …) is
 * refused by the strict face and is not drawn as a widget — the card draws its
 * own keys. Since objectui#11514 the TypeScript widget
 * arm, {@link DashboardWidgetSchema}'s `type`, names no member either: a slot
 * entry is read by the slot's element type, not by the widget arm.
 *
 * ⛔ CLOSED on purpose. The ruling's triage block named an open
 * "extension allowed" hatch as the thing to avoid: an open hatch re-creates
 * exactly the hole the catalog gate exists to close, because a typo'd or
 * retired `type` would keep validating. Adding a member is a deliberate act
 * with a registration behind it — `examples/schema-catalog/test/
 * plugin-dashboard-component-schema.test.ts` is the standing gate, and
 * `__tests__/report-chart-query-spec-parity.test.ts` pins the closure. The
 * member also needs an arm that declares ITS registered inputs: the one
 * component arm declares `metric-card`'s (objectui#11467), so a second member
 * would inherit that card's props. The Zod arm's `type` is checked against
 * this exact one-member list (`zod/complex.zod.ts`), so `tsc` refuses the
 * build until the arm is split per member.
 */
export const DASHBOARD_COMPONENT_WIDGET_TYPES = ['metric-card'] as const;

/** An objectui component type legal in a dashboard widget slot. */
export type DashboardComponentWidgetType = (typeof DASHBOARD_COMPONENT_WIDGET_TYPES)[number];

/**
 * objectui-only widget FAMILIES — visualization families objectui renders that
 * `@objectstack/spec`'s `ChartTypeSchema` does not model. Distinct from
 * {@link DASHBOARD_COMPONENT_WIDGET_TYPES} above: these two really are widget
 * types (`classifyWidgetType` routes `list` to the table family and `custom` to
 * the author-supplied-`component` branch), they just have no spec counterpart.
 *
 * The pre-existing divergence, previously carried only as prose on the `type`
 * key ("widened off the spec's enum") and enforced nowhere. If the spec adopts
 * either family, drop it from here and let it flow in from the spec enum.
 */
export const DASHBOARD_WIDGET_TYPE_EXTENSIONS = ['list', 'custom'] as const;

/** An objectui-only dashboard widget family. */
export type DashboardWidgetTypeExtension = (typeof DASHBOARD_WIDGET_TYPE_EXTENSIONS)[number];

/**
 * The CLOSED vocabulary a dashboard widget's `type` may name.
 *
 * The spec half flows in BY REFERENCE (`SpecDashboardWidget['type']`, i.e. the
 * spec's `ChartTypeSchema`) rather than being restated, so a family the spec
 * adds or retires lands here with no edit — the same discipline
 * {@link DashboardWidgetSchema} already uses for its key set. objectui's own
 * extension set, {@link DASHBOARD_WIDGET_TYPE_EXTENSIONS}, is spelled out above
 * with its reason. {@link DashboardComponentWidgetType} was a third member until
 * objectui#11483: a component type is not a widget type, and the slot reads a
 * `metric-card` through its component arm alone (see
 * {@link DASHBOARD_COMPONENT_WIDGET_TYPES}). An authoring surface that offers
 * widget types (a designer palette, an inspector's type picker) is typed by this
 * name, so it cannot offer the card as a widget it would save without a `value`.
 *
 * This used to be bare `string`. That was the open hatch: `type: 'metrci-card'`
 * type-checked, validated, and rendered the registry's red OBJUI-001 panel —
 * and `examples/schema-catalog` is an AI few-shot retrieval source, so what it
 * shows is what gets copied.
 *
 * Zod twin: `zod/complex.zod.ts` `DashboardWidgetTypeSchema`.
 */
export type DashboardWidgetTypeName =
  | NonNullable<SpecDashboardWidget['type']>
  | DashboardWidgetTypeExtension;

/**
 * Dashboard Widget Layout
 */
export interface DashboardWidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Dashboard Widget — DERIVED from `@objectstack/spec/ui`'s `DashboardWidget`
 * (objectstack#4115): every spec key it does not override flows in through the
 * `extends` above, so the key set tracks the protocol instead of being restated.
 *
 * Supports two formats:
 * 1. **Component format** (legacy): `{ id, component: { type, ... }, layout }`
 * 2. **Shorthand format** (@objectstack/spec): `{ type: 'metric'|'bar'|…, options: {…}, layout }`
 *
 * `Partial<>` because the spec requires `id` while stored objectui dashboards
 * (and every widget in the legacy component format) omit it. The `Omit` list is
 * the set of keys objectui deliberately re-types, each explained at its
 * declaration below; anything not listed there is the spec's.
 *
 * Zod twin: `zod/complex.zod.ts` `DashboardWidgetSchema`.
 * Drift guard: `__tests__/report-chart-query-spec-parity.test.ts`.
 */
export interface DashboardWidgetSchema
  extends Omit<Partial<SpecDashboardWidget>, 'type' | 'options' | 'chartConfig' | 'filter'> {
  // `id`, `title`, `description`, `colorVariant`, `dataset`, `dimensions`,
  // `values`, `filterBindings`, `requiresObject`, `requiresService`,
  // `compareTo`, … all flow in from the spec through the `extends` above — do
  // not restate them here.
  //
  // `actionUrl`, `actionType`, `actionIcon` and `aria` flow in too, but as
  // RETIRED keys: @objectstack/spec 17.0.0-rc.3 (objectstack#5010, ADR-0049 D2)
  // turned them into `retiredKey` tombstones, so the spec types them `never`
  // and the Zod twin refuses any value. They inherit as `?: never` — authoring
  // one is a tsc error here and a parse error at validation. Reading one still
  // type-checks (`never | undefined`), which is how objectui's widget config
  // panel kept producing `actionUrl` until objectstack#7129. A dashboard
  // widget's click-through affordance lives in `header.actions[]`, whose own
  // `actionUrl` is unrelated and still live.
  //
  // `responsive` inherits the same way, from a SEPARATE retirement:
  // @objectstack/spec 17.0.0-rc.6 (objectstack#4876, ADR-0049 D2) — so its
  // tombstone message differs from the four above. It was re-typed `any` here
  // on the stated grounds that "the renderer reads a per-breakpoint record";
  // objectui#3173's measurement found zero `widget.responsive` read points in
  // the whole repo and zero authored occurrences in either corpus, so that
  // premise was false and the override only made TS accept a key the Zod twin
  // already refused. ⚠️ This note used to add that the shared `ResponsiveConfig`
  // shape was "NOT gone — it stays live on `page.components[].responsive`,
  // which `useResponsiveConfig` really does read". Both halves of that have
  // since expired and it is corrected rather than left standing, because a
  // stale liveness claim is what the next agent reads as the measurement:
  // objectstack#11027 retired `ResponsiveConfigSchema` outright (the census
  // behind it measured `page.components[].responsive` inert), and objectui#7580
  // deleted `useResponsiveConfig` with it at zero callers. What survives the
  // retirement is the BREAKPOINT vocabulary, re-homed into `@object-ui/types`
  // and `@object-ui/layout` because renderers implement it (the `grid` node's
  // breakpoint `columns`, and `ResponsiveGrid` since objectui#11441 retired its
  // `responsive-grid` node key) — not this key.
  // Pinned by `__tests__/report-chart-query-spec-parity.test.ts`.
  /**
   * Component schema (legacy format) — objectui-only, no spec counterpart.
   *
   * A `metric-card` node and nothing else (objectui#12163, ruling C): the widget
   * slot's component arm, {@link DashboardWidgetSlotComponentSchema}
   * (objectui#11467), the one component node the 2026-08-14 slot ruling admits
   * (objectstack#8593). A `metric-card` written here is the same node the slot
   * holds directly, so its registered inputs are typed by the same members. The
   * dashboard renders it through the registry (`toDashboardNodeType`, then
   * `SchemaRenderer`).
   *
   * Until objectui#12163 this was `DashboardWidgetSlotComponentSchema | SchemaNode`,
   * the second arm being any other node a `custom` widget's `component` carried.
   * A dashboard widget binds a dataset (ADR-0021), so a node of any other type
   * is a compile error here, and the Zod twin (`zod/complex.zod.ts`
   * `DashboardWidgetSchema.component`) refuses it by name on both faces.
   */
  component?: DashboardWidgetSlotComponentSchema;
  layout?: DashboardWidgetLayout;
  /**
   * Widget visualization type (spec shorthand format).
   *
   * CLOSED — see {@link DashboardWidgetTypeName}. The spec's families flow in by
   * reference; objectui's additions are the two named, closed sets.
   * It was `string` until objectui#4600, which is why a retired family, a typo,
   * or a component type nothing registers all type-checked here and only
   * surfaced as the renderer's red OBJUI-001 panel at runtime.
   *
   * The same set as the Zod twin's `type`: no {@link DashboardComponentWidgetType}
   * (objectui#11483 on the Zod faces, objectui#11514 here). A `metric-card` is
   * read by the slot's component arm alone,
   * {@link DashboardWidgetSlotComponentSchema}, whose required `value` governs,
   * so a `metric-card` with no `value` is refused on this face as on both Zod
   * faces. This interface is the widget arm only: a `widgets[]` entry's read
   * type is the slot's element type, `DashboardComponentSchema['widgets'][number]`,
   * which `plugin-dashboard`'s renderers annotate entries with. Pinned in
   * `__tests__/metric-card-needs-value-11483.test.ts`.
   */
  type?: DashboardWidgetTypeName;
  /** Widget-specific configuration (spec shorthand format). Kept `unknown` — objectui
   *  renderers pass widget-family-specific bags the spec's `options` object does not model. */
  options?: unknown;
  /**
   * Chart APPEARANCE for chart-type widgets — the spec's
   * `DashboardWidgetChartConfigSchema`, the dataset-bound carrier of the chart
   * config.
   *
   * Every key is still `any` on this face except the five the spec retired on
   * this carrier, and those five are typed BY REFERENCE from the spec's own
   * members, so each is the spec's retired-key type: an authored value is a
   * compile error, the verdict the Zod twin already gives at parse because
   * `zod/complex.zod.ts` `DashboardWidgetSchema` takes the spec's `chartConfig`
   * by reference. Only the key NAMES are written here; whether a key admits a
   * value is the spec's answer, so a key the spec re-opened would compile again
   * with no edit to this member.
   *
   *  - `aria` (objectui#4044): @objectstack/spec 17.5.0 retired
   *    `ChartConfig.aria` (ADR-0049 D2; no chart renderer ever applied it). The
   *    accessible name a chart DOES apply is the sibling `description`, which
   *    the chart renderer lowers to `role="img"` plus `aria-label`.
   *  - `type`, `xAxis`, `yAxis`, `series` (objectui#11315): the same 17.5.0
   *    release retired them on THIS carrier only (ADR-0021 · ADR-0049 D2). A
   *    dataset-bound widget's dataset owns the chart's structure: the family
   *    is the widget's own `type`, the category axis is `dimensions`, and the
   *    measures and series are `values`. The four stay authorable on the react
   *    `ObjectChart` tier, whose chart is bound to inline `data`.
   *
   * Pinned by `__tests__/chartconfig-aria-retired-4044.test.ts` and
   * `__tests__/chartconfig-structure-retired-11315.test.ts`.
   */
  chartConfig?: {
    [key: string]: any;
    aria?: NonNullable<SpecDashboardWidget['chartConfig']>['aria'];
    type?: NonNullable<SpecDashboardWidget['chartConfig']>['type'];
    xAxis?: NonNullable<SpecDashboardWidget['chartConfig']>['xAxis'];
    yAxis?: NonNullable<SpecDashboardWidget['chartConfig']>['yAxis'];
    series?: NonNullable<SpecDashboardWidget['chartConfig']>['series'];
  };
  /**
   * Data binding: filter conditions. Kept `any` — objectui passes an ObjectQL
   * FilterNode array here, not the spec's `FilterCondition` envelope.
   */
  filter?: any;
  /**
   * Enable search input for table-type widgets. objectui-only — no spec counterpart.
   * @default false
   */
  searchable?: boolean;
  /**
   * Enable pagination for table-type widgets. objectui-only — no spec counterpart.
   * @default false
   */
  pagination?: boolean;
}

/**
 * A COMPONENT node sitting directly in a dashboard's widget slot — the
 * `metric-card` extension the 2026-08-14 ruling (objectstack#8593) admits, on
 * the TypeScript face. Twin of `zod/complex.zod.ts`
 * `DashboardWidgetSlotComponentSchema`, spelled the same way that arm is:
 * `BaseSchema` plus a `type` narrowed to the CLOSED component set
 * ({@link DASHBOARD_COMPONENT_WIDGET_TYPES}), the spec's widget `layout`, and
 * the inputs the `metric-card` registration declares.
 *
 * ## The registered inputs are declared members (objectui#11467)
 *
 * `title`, `value`, `icon`, `trend` and `trendValue` are `MetricCard`'s
 * registry `inputs` (`plugin-dashboard:metric-card`), and `MetricCard` reads
 * every one of them — measured twice: a type-checker census of the props
 * `MetricCard` destructures and renders, and a runtime probe that removed one
 * key at a time from a widget a real `DashboardRenderer` drew. The sixth
 * input, `description`, is the `BaseSchema` member of the same type, so it is
 * inherited, not restated. Until objectui#11467 the five reached the compiler
 * only through `BaseSchema`'s `[key: string]: any`, so each was `any` here and
 * the README's `metric-card` literals compiled on nothing but that signature,
 * which objectui#8347 removed.
 *
 * Each member's type is the prop `MetricCard` declares for it, and `trend`'s
 * vocabulary is the registration's enum. This package depends on neither, so
 * both are held to these members by the registering package's own test,
 * against `MetricCardProps` and the live registration:
 * `metricCardRegisteredInputsStrictFace-11022.test.ts` in
 * `@object-ui/plugin-dashboard`'s `__tests__`.
 *
 * They are component props, not widget keys, and MUST NOT be declared on
 * {@link DashboardWidgetSchema} — the compiler's own TS2561 suggestion ("Did
 * you mean to write 'values'?") points at exactly that forbidden repair.
 * `title` is the one name both arms declare: the widget's heading there, the
 * card's heading here.
 *
 * Every other key still reaches this arm through `BaseSchema`'s index
 * signature while it stands; the Zod twin keeps the same `.passthrough()`.
 *
 * Until objectui#7952 this arm existed on the Zod face only:
 * `DashboardComponentSchema.widgets` was `DashboardWidgetSchema[]`, so the
 * `metric-card` blocks `plugin-dashboard/README.md` teaches parsed green
 * under `safeParse` and `tsc --strict` refused every one of them (6 × TS2561
 * on `value`, measured at `fc32921`). Ruled option (a) by the director seat
 * (decision batch #68, 2026-09-07, maintainer 「同意」): the TypeScript face
 * gains the component arm; the Zod face is untouched.
 *
 * Exported on purpose, where the Zod twin is not. The compiler does not force
 * it — measured in this package's own build (`declaration` + `composite`,
 * TypeScript 6.0.3): a non-exported arm referenced from the exported
 * `DashboardComponentSchema` emits into `dist/complex.d.ts` as a local
 * interface, exit 0, and a barrel consumer still writes the node with no
 * name. The export is an authoring-surface decision — a name an author can
 * annotate the node with, which `plugin-dashboard/README.md` teaches — taken
 * deliberately in the opposite direction to the Zod arm, whose own docblock
 * keeps that const private because its routing is an internal property of
 * the slot. Same interface shape as {@link DashboardComponentSchema} itself
 * (`extends BaseSchema` + a literal `type`), which is why it is an interface
 * rather than an intersection.
 *
 * Pinned by `__tests__/dashboard-widget-slot-component-arm-7952.test.ts`.
 */
export interface DashboardWidgetSlotComponentSchema extends BaseSchema {
  /** An objectui component type legal in a widget slot — the CLOSED set. */
  type: DashboardComponentWidgetType;
  /**
   * The slot's grid position — the spec's widget `layout`, BY REFERENCE
   * (`SpecDashboardWidget['layout']`), so this arm and the spec agree on the
   * four numbers with no restated shape (objectui#11070 round 11).
   *
   * The one widget key this arm declares. It is not a `MetricCard` prop: the
   * dashboard reads it off every `widgets[]` entry, and `DashboardGridLayout`'s
   * Save Layout (`mergeLayoutIntoSchema`) writes it onto every entry, a
   * component node included. Through the index signature it was `any` here
   * and refused as undeclared by the strict authoring face. The Zod twin
   * (`zod/complex.zod.ts`) declares the same spec member.
   */
  layout?: SpecDashboardWidget['layout'];
  /**
   * The card's heading: a plain string or the spec's inline per-locale map
   * (`I18nLabel`), which `MetricCard` resolves for the active language.
   */
  title?: string | I18nLabel;
  /**
   * The figure the card shows, drawn as given. The one REQUIRED input: the
   * registration marks it `required`, and a card without it draws an empty
   * figure. Since objectui#11483 the validator has no other reading of a
   * `metric-card` in the slot, so a card without it is refused there.
   */
  value: string | number;
  /** A Lucide icon name, drawn beside the heading. */
  icon?: string;
  /**
   * The trend's direction, drawn as the arrow and colour in front of
   * `trendValue` — the registration's enum. Drawn only together with
   * `trendValue`.
   */
  trend?: 'up' | 'down' | 'neutral';
  /** The trend's text, such as `+12%`. Drawn only together with `trend`. */
  trendValue?: string;
  /**
   * REFUSED BY NAME (objectui#4425) — the card's heading is `title`.
   *
   * {@link BaseSchema} declares `label`, and this node inherited it, but
   * nothing on the `metric-card` path reads it: the registration
   * (`plugin-dashboard:metric-card`) declares `title`, and `MetricCard` draws
   * `title` as the heading. `label` is how the sibling `metric` node
   * (`plugin-dashboard:metric`) spells its heading, so an author who knows that
   * node wrote it here and got a card with no heading: no render-time error or
   * warning, and the parser tier's `validateTree` does not walk a dashboard's
   * `widgets`. Under the objectui#8284 ruling (one spelling per rendered thing)
   * the member is restated as a refusal, in the shape `body` / `children` below
   * take.
   *
   * The zod twin is the private slot arm in `zod/complex.zod.ts`, which
   * refuses `label` by name and names `title` in the message.
   *
   * @deprecated Not a key `metric-card` reads. Write the heading as `title`.
   */
  label?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `metric-card` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `metric-card` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `metric-card` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element. In a widget slot nothing
   * else noticed it either: the parser tier's `not-a-container` warning
   * (objectui#9910) walks `children`, never `widgets`.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D public-block slice).
   * `DashboardRenderer` hands a `metric-card` widget to `SchemaRenderer` as
   * the widget's own keys; the registration (`plugin-dashboard:metric-card`)
   * renders `MetricCard`, which reads `title`, `value`, `icon`, `trend`,
   * `trendValue`, `description`, `loading` and `error`, and no read of the
   * node's `body` or `children` exists on that path. `SchemaRenderer` strips
   * `body` and `children` out of the props bag it spreads, so neither reaches
   * the component by another route, and the registration declares no
   * `children` slot (objectui#9910).
   *
   * The zod twin is the private slot arm in `zod/complex.zod.ts`, which
   * declares both members with the same guidance.
   *
   * What it renders instead: one KPI card — `title`, `value`, `icon`,
   * `trend` / `trendValue` and `description`.
   *
   * @deprecated Not a channel `metric-card` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Dashboard Schema
 *
 * ## The spec half is taken BY REFERENCE (objectui#9736)
 *
 * The zod mirror (`zod/complex.zod.ts` `DashboardComponentSchema`) is
 * `BaseSchema.extend(SpecDashboardFields.shape).extend({…})`, so every key
 * `@objectstack/spec/ui`'s `DashboardSchema` declares reaches the published
 * validator by reference. This interface used to restate only the members the
 * renderers read, which left the validator admitting keys the type never
 * declared (the package-lock envelope `_lock*` / `_package*` / `_provenance`,
 * written by the packaging pipeline, and `protection`) and the spec's
 * tombstones (`aria`, `refreshInterval`, `performance`) typed `any` through
 * `BaseSchema`'s index signature.
 *
 * Now it extends `Omit< Dashboard, … >` over `DASHBOARD_SPEC_EXCLUDED`, the one
 * `as const` array the mirror's `specFieldsExcept` call also reads, so the two
 * faces project the same spec surface and move together on a pin bump. A
 * tombstone surfaces as an optional member typed `undefined`: authoring a
 * value is a compile error, the verdict the validator gives at parse.
 *
 * `header` comes from that projection too (objectui#7759 group A). Until then
 * it was omitted on this face alone and restated by hand, and the restatement
 * disagreed with the spec in both directions: `actions[].label` was `string`
 * against the spec's `I18nLabel`, `actions[].actionUrl` optional where the spec
 * requires it, and `actions[].actionType` an open `string` against the spec's
 * `ActionType` enum. The mirror always validated the spec's member, so an
 * inline per-locale action label parsed green, `tsc` refused it, and the
 * renderer handed the map to React as a button child. The spec declares the
 * key, so under that card's ruling (5617465269, principle 1) the declaration
 * follows the spec rather than the other way round, and `DashboardRenderer`
 * resolves the label. Pinned by
 * `__tests__/dashboard-header-global-filters-spec-7759.test.ts`.
 *
 * Pinned by `__tests__/twins-spec-by-reference-9736.test.ts`.
 */
export interface DashboardComponentSchema extends BaseSchema, Omit<SpecDashboard, (typeof DASHBOARD_SPEC_EXCLUDED)[number]> {
  type: 'dashboard';
  // `title` was DECLARED here until `5d0876c5c`, under the comment "Dashboard
  // title displayed in the header" — by then a description of behaviour that had
  // stopped existing: objectui#7509 retired all five dashboard-root `title` read
  // arms under ADR-0049 (`1cca678ba`), so the key was declared, documented as
  // rendering, and inert. The header text is the spec-canonical `label`
  // (`BaseSchema`), resolved through `pickLocalized`; `plugin-dashboard` has no
  // dashboard-root `title` read site left (pinned by that package's
  // `__tests__/dashboardAuthoredInputs.test.tsx`).
  //
  // Unlike `aria` below there is NO spec tombstone to inherit: `@objectstack/spec`'s
  // strict `DashboardSchema` refuses a root `title` as an UNRECOGNIZED key, not with
  // a named removal message, so the Zod twin (`zod/complex.zod.ts`, `.passthrough()`
  // via `BaseSchema`) gains no refusal from this deletion and ⛔ must not be given a
  // hand-written one — that would assert a spec behaviour that does not exist.
  // This deletion removed the type-level suggestion and the false rendering claim,
  // not a key that ever rendered. `BaseSchema`'s index signature typed an authored
  // `title` as `any` after it, until objectui#8347 removed the signature; an
  // authored `title` is a compile error now. Pinned by
  // `__tests__/dashboard-title-retired-declaration.test.ts`.
  columns?: number;
  gap?: number;
  /**
   * The widget slot — TWO arms, matching the Zod twin (`zod/complex.zod.ts`
   * `DashboardComponentSchema.widgets`, component arm first): a component
   * node ({@link DashboardWidgetSlotComponentSchema}, `type` in the closed
   * {@link DASHBOARD_COMPONENT_WIDGET_TYPES}) or a spec-family / legacy
   * `component`-envelope widget ({@link DashboardWidgetSchema}).
   *
   * One-armed (`DashboardWidgetSchema[]`) until objectui#7952, which refused
   * the shape the 2026-08-14 ruling (objectstack#8593) admits and the runtime
   * renders — see the arm's own docblock for the measurement and the ruling.
   *
   * ⚠️ How the union judges a literal, recorded so nobody reads it as a hatch
   * (pinned next to the arm):
   *  - a literal that NAMES a `type` outside the component set is discriminated
   *    by it — `{ type: 'bar', bogus: 1 }` is refused, because `'bar'`
   *    excludes the component arm and `DashboardWidgetSchema` has no `bogus`;
   *  - a literal with NO `type` (the legacy `component` envelope) cannot be
   *    discriminated, so its excess-property check runs against both arms.
   *    Until objectui#8347 the component arm's index signature satisfied it,
   *    so `{ component, bogus: 1 }` compiled here; with `BaseSchema`'s
   *    signature gone it is refused, as on the Zod face (`.strict()` widget
   *    schema);
   *  - a `metric-card` with NO `value` (`{ type: 'metric-card', title }`) is
   *    refused here as on both Zod faces: no arm but the component arm names
   *    `metric-card` (objectui#11483 on the Zod faces, objectui#11514 here).
   *    Read an entry by this element type,
   *    `DashboardComponentSchema['widgets'][number]`, and narrow it on `type`
   *    to reach a widget key: the component arm is not assignable to
   *    {@link DashboardWidgetSchema}.
   */
  widgets: Array<DashboardWidgetSlotComponentSchema | DashboardWidgetSchema>;
  /**
   * Auto-refresh interval in seconds. When set, the dashboard will periodically
   * trigger onRefresh.
   *
   * Renamed from `refreshInterval` in @objectstack/spec 17.4.0 (objectstack#15680,
   * ruling B on objectstack#14478: a duration-shaped number carries its unit in
   * the key name, never only in the describe prose). The spec's `DashboardSchema`
   * — which this node derives its spec-owned half from — now REFUSES the old
   * spelling with a `retiredKey` tombstone naming this one, so the two faces
   * would disagree at parse if this declaration had stayed (objectui#7783).
   */
  refreshIntervalSeconds?: number;
  // `header` is not declared here: it is inherited from the `Omit< Dashboard, … >`
  // projection above, i.e. the spec's `DashboardHeader` by reference — see this
  // interface's docblock for the restatement it replaced (objectui#7759 group A).
  /**
   * Global filter configurations.
   * Applied across all dashboard widgets.
   *
   * BOUND to `@objectstack/spec`'s `GlobalFilter` rather than restated
   * (objectui#4032, merged scope from the #4163 part-1 audit). It used to be a
   * hand-written inline object literal that happened to carry the same nine
   * keys, and the copy drifted in the one direction that costs the most:
   * `label` was declared `string` here long after the spec widened it (and its
   * `options[].label`) to `I18nLabel`. Because the restatement was NARROWER
   * than the contract, an authored per-locale map was a legal document that
   * objectui's own types said could not exist — so every read site that
   * stringified one was invisible to `tsc`, which is precisely how the filter
   * bar shipped `[object Object]: All` and how `normalizeFilterOptions` shipped
   * a coercion that discarded map labels in every locale.
   *
   * `DashboardWidgetSchema` above already takes this route (`extends
   * Omit<Partial< SpecDashboardWidget >, …>`), which is why the widget half of
   * the same widening WAS compile-visible and got repaired in #4208. Binding is
   * preferred over restating for exactly that asymmetry: the key set and the
   * value vocabularies now track the protocol instead of a snapshot of it.
   */
  globalFilters?: SpecGlobalFilter[];
  // `dateRange` was DECLARED here until objectui#10334 — a hand-written
  // `{ field?, defaultRange?, allowCustomRange? }` whose `defaultRange` was bound
  // to the spec's `DateRangeDefaultRange` (objectui#4984) while its Zod twin
  // restated the key as a bare `z.string()`, so the validator admitted preset
  // names this type refused (the `WiderThanDeclared` row objectui#7759 group F
  // left behind). The key is spec-declared, so both faces now take the spec's
  // AUTHORING member by reference: `dateRange` is no longer on
  // `DASHBOARD_SPEC_EXCLUDED`, and this interface inherits it from the
  // `Omit< Dashboard, … >` projection above. Pinned by
  // `__tests__/dashboard-daterange-spec-10334.test.ts`.
  // `aria` was DECLARED here until objectui#5830, under a comment claiming
  // alignment with @objectstack/spec AriaPropsSchema — by then the opposite of
  // the contract: the spec removed `dashboard.aria` at the objectstack-ai/objectstack#3896 audit
  // close-out (no dashboard renderer ever applied it), so
  // `DashboardSchema.shape.aria` is a tombstone that refuses any value, the
  // Zod twin (`zod/complex.zod.ts`) inherits that refusal through
  // `SpecDashboardFields`, and `plugin-dashboard` has no `schema.aria` read
  // site. Since objectui#9736 this interface inherits the same tombstone from
  // the spec projection (`aria?: undefined`), so an authored `aria` is now a
  // compile error rather than `any` through the index signature. Pinned by
  // `__tests__/dashboard-aria-retired-contract-twins.test.ts`.
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `dashboard` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `columns`, `dateRange`, `description`, `gap`, `globalFilters`, `header`,
   * `label`, `name`, `refreshIntervalSeconds`, `type`, `widgets` (in
   * `packages/plugin-dashboard/src/DashboardGridLayout.tsx`,
   * `packages/plugin-dashboard/src/DashboardRenderer.tsx`,
   * `packages/plugin-dashboard/src/DashboardWithConfig.tsx`,
   * `packages/plugin-designer/src/DashboardEditor.tsx`).
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
   * @deprecated Not a channel `dashboard` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `dashboard` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `columns`, `dateRange`, `description`, `gap`, `globalFilters`, `header`,
   * `label`, `name`, `refreshIntervalSeconds`, `type`, `widgets` (in
   * `packages/plugin-dashboard/src/DashboardGridLayout.tsx`,
   * `packages/plugin-dashboard/src/DashboardRenderer.tsx`,
   * `packages/plugin-dashboard/src/DashboardWithConfig.tsx`,
   * `packages/plugin-designer/src/DashboardEditor.tsx`).
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
   * @deprecated Not a channel `dashboard` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Union type of all complex schemas
 */
export type ComplexSchema =
  // ⛔ `KanbanSchema` (`type: 'kanban'`) RETIRED here — objectui#8802,
  // maintainer ruling 2026-09-09. Its Zod twin keeps an arm for the literal so
  // an authored `type: "kanban"` is refused BY NAME and pointed at
  // `object-kanban`; on this face the retirement IS the absence, which is what
  // makes `tsc` refuse the literal at the authoring site.
  | CalendarViewSchema
  | FilterBuilderSchema
  | CarouselSchema
  | ChatbotSchema
  | ChatbotEnhancedSchema
  | ChatbotFloatingSchema
  | DashboardComponentSchema;

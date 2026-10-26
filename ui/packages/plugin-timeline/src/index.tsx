/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { cn, cva } from "@object-ui/components"
import type { VariantProps } from "class-variance-authority"

const Timeline = React.forwardRef<
  HTMLOListElement,
  React.HTMLAttributes<HTMLOListElement>
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn("relative ml-3 border-l border-gray-200", className)}
    {...props}
  />
))
Timeline.displayName = "Timeline"

const timelineItemVariants = cva("ml-6", {
  variants: {
    density: {
      default: "mb-10",
      compact: "mb-3",
      comfortable: "mb-6",
    },
  },
  defaultVariants: { density: "default" },
})

const TimelineItem = React.forwardRef<
  HTMLLIElement,
  React.HTMLAttributes<HTMLLIElement> & VariantProps<typeof timelineItemVariants>
>(({ className, density, ...props }, ref) => (
  <li
    ref={ref}
    className={cn(timelineItemVariants({ density }), className)}
    {...props}
  />
))
TimelineItem.displayName = "TimelineItem"

const timelineMarkerVariants = cva(
  "absolute -left-3 w-6 h-6 rounded-full border-2 flex items-center justify-center",
  {
    variants: {
      variant: {
        default: "bg-blue-200 border-blue-400",
        success: "bg-emerald-200 border-emerald-500",
        warning: "bg-amber-200 border-amber-500",
        danger: "bg-red-200 border-red-500",
        info: "bg-purple-200 border-purple-500",
        todo: "bg-slate-200 border-slate-400",
        "in-progress": "bg-blue-200 border-blue-500",
        done: "bg-emerald-200 border-emerald-500",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

type TimelineMarkerVariant = VariantProps<typeof timelineMarkerVariants>["variant"]

const TimelineMarker = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: TimelineMarkerVariant
  }
>(({ className, variant = "default", ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(timelineMarkerVariants({ variant }), className)}
      {...props}
    />
  )
})
TimelineMarker.displayName = "TimelineMarker"

const TimelineContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={className}
    {...props}
  />
))
TimelineContent.displayName = "TimelineContent"

const TimelineTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("font-semibold text-lg mb-1", className)}
    {...props}
  />
))
TimelineTitle.displayName = "TimelineTitle"

const TimelineTime = React.forwardRef<
  HTMLTimeElement,
  React.TimeHTMLAttributes<HTMLTimeElement>
>(({ className, ...props }, ref) => (
  <time
    ref={ref}
    className={cn("text-sm font-normal text-gray-500 mb-2 block", className)}
    {...props}
  />
))
TimelineTime.displayName = "TimelineTime"

const TimelineDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-base text-gray-700", className)}
    {...props}
  />
))
TimelineDescription.displayName = "TimelineDescription"

// Horizontal Timeline Components
const TimelineHorizontal = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative flex overflow-x-auto py-8", className)}
    {...props}
  />
))
TimelineHorizontal.displayName = "TimelineHorizontal"

const TimelineHorizontalItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("shrink-0 w-64 relative", className)}
    {...props}
  />
))
TimelineHorizontalItem.displayName = "TimelineHorizontalItem"

// Gantt-style Timeline Components (Airtable-like)
const TimelineGantt = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative w-full border rounded-lg overflow-hidden", className)}
    {...props}
  />
))
TimelineGantt.displayName = "TimelineGantt"

const TimelineGanttHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex border-b bg-gray-50", className)}
    {...props}
  />
))
TimelineGanttHeader.displayName = "TimelineGanttHeader"

const TimelineGanttRowLabels = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("w-48 border-r bg-white", className)}
    {...props}
  />
))
TimelineGanttRowLabels.displayName = "TimelineGanttRowLabels"

const TimelineGanttGrid = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex-1 overflow-x-auto", className)}
    {...props}
  />
))
TimelineGanttGrid.displayName = "TimelineGanttGrid"

const TimelineGanttRow = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center border-b min-h-12", className)}
    {...props}
  />
))
TimelineGanttRow.displayName = "TimelineGanttRow"

const TimelineGanttLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-4 py-2 font-medium text-sm truncate", className)}
    {...props}
  />
))
TimelineGanttLabel.displayName = "TimelineGanttLabel"

const TimelineGanttBar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    start?: number
    width?: number
    variant?: "default" | "success" | "warning" | "danger" | "info"
  }
>(({ className, start = 0, width = 100, variant = "default", ...props }, ref) => {
  const variantClasses = {
    default: "bg-blue-500 hover:bg-blue-600",
    success: "bg-green-500 hover:bg-green-600",
    warning: "bg-yellow-500 hover:bg-yellow-600",
    danger: "bg-red-500 hover:bg-red-600",
    info: "bg-purple-500 hover:bg-purple-600",
  }

  return (
    <div
      ref={ref}
      className={cn(
        "absolute h-8 rounded-md transition-colors cursor-pointer",
        variantClasses[variant],
        className
      )}
      style={{
        left: `${start}%`,
        width: `${width}%`,
      }}
      {...props}
    />
  )
})
TimelineGanttBar.displayName = "TimelineGanttBar"

const TimelineGanttBarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-2 py-1 text-white text-xs font-medium truncate", className)}
    {...props}
  />
))
TimelineGanttBarContent.displayName = "TimelineGanttBarContent"

export {
  Timeline,
  TimelineItem,
  timelineItemVariants,
  TimelineMarker,
  timelineMarkerVariants,
  TimelineContent,
  TimelineTitle,
  TimelineTime,
  TimelineDescription,
  TimelineHorizontal,
  TimelineHorizontalItem,
  TimelineGantt,
  TimelineGanttHeader,
  TimelineGanttRowLabels,
  TimelineGanttGrid,
  TimelineGanttRow,
  TimelineGanttLabel,
  TimelineGanttBar,
  TimelineGanttBarContent,
}

// Export renderer to register the component with ObjectUI
export * from './renderer';

// Export ObjectTimeline
export { ObjectTimeline } from './ObjectTimeline';
export type { ObjectTimelineProps } from './ObjectTimeline';

import { ComponentRegistry, elementDataSourceBlock } from '@object-ui/core';
import type { ComponentInput } from '@object-ui/types';
import { ObjectTimeline } from './ObjectTimeline';
import {
  ElementDataSourceGate,
  useSchemaContext,
  type ElementDataSourceMapping,
} from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';

/**
 * `object-timeline` maps `object` + `filter` + `sort` + `limit` — every key its
 * fetch now reads (objectstack#7137).
 *
 * Until objectstack-ai/objectstack#7137 the fetch was `dataSource.find(schema.objectName, { options: { $top:
 * 100 } })`: no `$filter`, no `$orderby`, and a cap nested under a key no adapter
 * reads. objectstack#7121 therefore mapped `object` alone and said so, rather than
 * writing the composed filter/sort/limit onto keys nobody read — which would have
 * looked like the binding was honoured while changing nothing about the rows.
 * objectstack-ai/objectstack#7137 added the read sites (`$filter` / `$orderby` / `$top: schema.limit ?? 100`),
 * so the flags come with them and a named `view` now actually narrows the rail.
 *
 * `columns` stays unmapped for the same reason a calendar's does: a timeline
 * projects the fields its `timeline` config names (title / start / end /
 * description / color / groupBy), not a view's column list.
 */
const OBJECT_TIMELINE_DATA_SOURCE: ElementDataSourceMapping = {
  filter: true,
  sort: true,
  limit: 'limit',
};

// Register object-timeline component
export const ObjectTimelineRenderer: React.FC<any> = elementDataSourceBlock(({ schema, ...props }) => {
  const { dataSource } = useSchemaContext() || {};
  // The spec's `PageComponentSchema.dataSource` binding (objectstack#7121): a
  // timeline authored with the binding and no flat `objectName` never fetched —
  // every branch of its effect is gated on `schema.objectName` — and rendered an
  // empty rail with no request and no error.
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={schema}
      mapping={OBJECT_TIMELINE_DATA_SOURCE}
      dataSource={dataSource}
      testId="object-timeline"
      errorTitle={t('element.timeline.sourceUnresolved', {
        defaultValue: 'This timeline’s data source could not be resolved',
      })}
    >
      {(bound) => <ObjectTimeline schema={bound} dataSource={dataSource} {...props} />}
    </ElementDataSourceGate>
  );
});

// `filter` and `sort` are declared on BOTH registrations of this renderer
// (objectui#8220): `ObjectTimeline` lowers both onto its object query
// (`$filter` / `$orderby`), and `@objectstack/spec`'s `object-timeline` row
// declares both, so without an input the html tier's `validateTree` reported a
// working key as `unknown-prop` on either tag. `view:timeline` is the same
// renderer under a second tag, so it declares the same pair — the
// `view:calendar` precedent (objectui#7712 / objectui#8171). `filter` is the
// RULE-ARRAY arm only — the spec refuses the MongoDB-style record form at this
// door, and `type: 'array'` makes the html tier refuse it too. Pinned in
// `__tests__/queryKeysDeclared-8220.test.tsx`.
//
// objectui#11168 slice 5 rewrote the `sort` description: it opened with "Entry
// order", and measured, the rail draws entries composed from records by their
// start date whatever the key says (`effectiveItems` in `./ObjectTimeline`
// sorts them), so the key orders the QUERY, not the rail.
const TIMELINE_FILTER_DESCRIPTION = 'Base query filter in the rule-array form `[{ field, operator, value }, ...]`, narrowing the records the timeline fetches. Context tokens such as `{current_user_id}` are resolved first, then the filter is lowered to `$filter` on the query. Authored `items` or `data` suppress that query, so the key then narrows nothing. The MongoDB-style record form is not this key’s shape.';
const TIMELINE_SORT_DESCRIPTION = 'Order of the records the timeline fetches, in `[{ field, order }]` form, lowered to `$orderby` on the same query. The rail draws entries composed from records by their start date, earliest first, whatever this order. Authored `items` or `data` suppress the query, so the key then orders nothing.';

// ## `navigation` — objectui#8654 (the timeline arm of objectui#8652's ruling 「B」)
//
// `@objectstack/spec` 17.5.0 declares it on the `object-timeline` row, for this
// block standalone — the platform half of the ruling. This row is the objectui
// half, together with the `navigation` member of `ObjectTimelineProps`'s schema
// in `./ObjectTimeline`. It is declared on both tags for the reason `filter` and
// `sort` are above: `view:timeline` is the same renderer under a second tag,
// the precedent the calendar's shared input list follows for this key.
//
// The description states what `ObjectTimeline` does with each member, measured
// on the real component, and it differs from the board's and the calendar's in
// two places: this renderer supplies no drawer default, so an ABSENT key opens
// nothing, and it hands the split shell no main panel, so `split` opens nothing
// either. `page`, and a block without `mode`, open the record page through the
// host's record navigator as on the siblings, and nothing under a host that
// publishes none (objectui#11293). Since objectui#11168 slice 5 a timeline may
// name no `objectName`, and the hook builds the record page from it: there
// `page` opens nothing and a new tab opens at the entry's id alone, so the
// description says that too (round 2, from the at-tier record on PR #11422).
// Members pinned in
// `__tests__/timelineNavigationMembers-8654.test.tsx`; a renderer that changes
// any of these reddens those rows, and the fix is to rewrite this description.
const TIMELINE_NAVIGATION_DESCRIPTION = 'What an entry click opens — the `{ mode, size, openNewTab, preventNavigation }` block a list view declares. With the key ABSENT a click opens nothing: this renderer supplies no drawer default. `mode` is an overlay (`drawer`, `modal`, `split`, `popover`), `new_window`, `page` or `none`, and a block written without `mode` takes the spec’s `page` default. `drawer`, `modal` and `popover` open the entry’s record in that overlay, but `split` opens nothing, because the timeline hands the split shell no main panel; `new_window` opens the record page in a new tab; `none` opens nothing. `page` opens the record page of the timeline’s `objectName` through the record navigator the host publishes (the console publishes one on its custom pages, record pages and list views); under a host that publishes none, such as an embedded renderer, or on a timeline that names no `objectName`, there is no record page to open and the click opens nothing. `preventNavigation: true` opens nothing whatever the mode, `openNewTab: true` opens the record page in a new tab and outranks every mode except `none`, and `size` sets the overlay width. On a timeline that names no `objectName`, `new_window` and `openNewTab` open no record page either: the new tab’s address is a slash and the entry’s `id` alone (its `_id` when it has no `id`, `undefined` when it has neither). A click handler from a parent view outranks the whole key.';

// ## The ten row keys objectui#11168 slice 5 measured, and `objectName`
//
// `@objectstack/spec` 17.5.0's `object-timeline` row declares fifteen keys, and
// until slice 5 this registration published five. The repo-wide parity guard
// (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`) could not
// see the other ten while it did not load this lazily registered plugin; it
// loads it now. Under objectui#11111 decision 3 = B each key is decided by its
// own measurement, and the renderer honours all ten — `timeline`, `limit`,
// `data`, `items`, `dateFormat`, `rowLabel`, `minDate`, `maxDate`,
// `descriptionField` and `mapping` — so all ten are declared. Each is measured
// through the real `SchemaRenderer` and this registration in
// `__tests__/objectTimelineInputs-11168.test.tsx`.
//
// Where the row's own describe is true of this renderer, the description starts
// with it word for word (pinned against the installed row), and each sentence
// after it is a measurement. `descriptionField` keeps only the describe's first
// sentence: its second calls the key the only spelling of that binding, and
// measured, `mapping.description` is a second spelling that outranks it.
//
// `objectName` is no longer REQUIRED. `items`, `data` and a `bind` path draw
// entries with no object, and a `dataSource` binding supplies one; the page
// validator raised `missing-required-prop` on timelines the row and the
// renderer both accept.
//
// `view:timeline` (which also answers the bare `timeline` key) is the same
// renderer under a second tag, so it publishes the same list, as it already
// did for `filter`, `sort` and `navigation`. The guard judges `object-timeline`
// only, because the spec carries no row for the second tag; the pin's
// registration rows hold both tags.
const TIMELINE_OBJECT_NAME_DESCRIPTION = 'Object this timeline binds to. Optional because the component-level `dataSource` binding can supply the object instead — this block registers through `ElementDataSourceGate`, which lowers the binding onto this key before the renderer sees the node. A timeline drawn from `items`, `data` or a `bind` path issues no query and needs none to draw, but `navigation` still reads it: without it `page` opens nothing and `new_window` / `openNewTab` open no record page.';
const TIMELINE_CONFIG_DESCRIPTION = 'Timeline configuration, the author face — the same block `ListViewSchema.timeline` declares: { startDateField, endDateField, titleField, groupByField, colorField, scale }. The flat top-level spellings beside it are the runtime handoff, not a second authoring spelling. On entries composed from records, `startDateField` is the entry’s date, `endDateField` the end printed after it, `titleField` the title, `groupByField` the field whose value heads each group (without it, entries group into date buckets), and `colorField` the field whose option colour, or the value itself when it is a colour literal, paints the marker. Each outranks the flat key of the same binding, and `titleField` / `startDateField` outrank `mapping`’s `title` / `date`. `scale` sets the axis unit of the gantt branch, which on this block draws authored `items` only.';
const TIMELINE_LIMIT_DESCRIPTION = 'Maximum number of records loaded onto the rail (row cap); lowered to the query\'s top-level `$top` (renderer default 100). A timeline renders one rail with no pagination control, so this is the author\'s window rather than a page size. A value that is not a positive integer is ignored with a console warning, and the default cap applies.';
const TIMELINE_DATA_DESCRIPTION = 'Pre-fetched records — read FIRST as the rail\'s row source, ahead of the data-scope binding and the fetch, and composed into entries through the same `timeline` field bindings a fetched row takes; authoring it suppresses the object query entirely. Distinct from `items`, which is the already-composed entry shape and wins over this key when both are written.';
const TIMELINE_ITEMS_DESCRIPTION = 'Static inline entries — read ahead of every record source, `data` above included, and bypasses the object query entirely (the renderer becomes a pass-through). Each entry is the kind this node\'s `variant` selects: a feed entry `{ time?, title, description?, variant?, icon?, content?, className? }` (`variant` absent / `vertical` / `horizontal`), or a gantt row `{ label, items? }` (`variant: \'gantt\'`) whose bars are `{ title?, startDate?, endDate?, variant? }`, each date a string or epoch milliseconds. These are `@object-ui/types`\'s `TimelineFeedItem` and `TimelineGanttItem`. They are drawn as written: the `timeline` block’s field bindings, `mapping` and `descriptionField` do not apply to them.';
const TIMELINE_DATE_FORMAT_DESCRIPTION = 'How each entry\'s date is rendered (renderer default `short`): `short` / `long` are locale-formatted, `iso` is the locale-free machine form.';
const TIMELINE_ROW_LABEL_DESCRIPTION = 'Header label for the gantt row column — read by the gantt branch only, which on this block needs authored `items`. Without it the header shows the default label.';
const TIMELINE_MIN_DATE_DESCRIPTION = 'Pin the gantt axis start (ISO `yyyy-mm-dd`) instead of deriving it from the rows; only a non-empty value is honoured. A value that is not a date, or a `minDate` after `maxDate`, refuses the chart with a diagnostic naming it.';
const TIMELINE_MAX_DATE_DESCRIPTION = 'Pin the gantt axis end (ISO `yyyy-mm-dd`) instead of deriving it from the rows; only a non-empty value is honoured. A value that is not a date, or a `maxDate` before `minDate`, refuses the chart with a diagnostic naming it.';
const TIMELINE_DESCRIPTION_FIELD_DESCRIPTION = 'Field rendered as each entry\'s description (renderer default `description`). It is declared flat because the `timeline` block has no member for it, and `mapping.description` outranks it when both are written.';
const TIMELINE_MAPPING_DESCRIPTION = 'Record-to-entry field mapping `{ title?, date?, description?, variant? }`, each a field name — the binding record read BETWEEN the `timeline` block and the flat fallbacks. Its `variant` member (the field whose value picks each marker colour, renderer default `variant`) is the only spelling that binding has. On the vertical rail a colour that `timeline.colorField` resolves for an entry outranks that marker colour.';

/**
 * The one input list both tags publish (`object-timeline` and `view:timeline`):
 * the same renderer reads the same keys under either.
 */
const OBJECT_TIMELINE_INPUTS: ComponentInput[] = [
  { name: 'objectName', type: 'string', description: TIMELINE_OBJECT_NAME_DESCRIPTION },
  { name: 'variant', type: 'enum', enum: ['vertical', 'horizontal', 'gantt'] },
  { name: 'filter', type: 'array', description: TIMELINE_FILTER_DESCRIPTION },
  { name: 'sort', type: 'array', description: TIMELINE_SORT_DESCRIPTION },
  { name: 'navigation', type: 'object', description: TIMELINE_NAVIGATION_DESCRIPTION },
  { name: 'timeline', type: 'object', description: TIMELINE_CONFIG_DESCRIPTION },
  { name: 'limit', type: 'number', description: TIMELINE_LIMIT_DESCRIPTION },
  { name: 'data', type: 'array', description: TIMELINE_DATA_DESCRIPTION },
  { name: 'items', type: 'array', description: TIMELINE_ITEMS_DESCRIPTION },
  { name: 'dateFormat', type: 'enum', enum: ['short', 'long', 'iso'], description: TIMELINE_DATE_FORMAT_DESCRIPTION },
  { name: 'rowLabel', type: 'string', description: TIMELINE_ROW_LABEL_DESCRIPTION },
  { name: 'minDate', type: 'string', description: TIMELINE_MIN_DATE_DESCRIPTION },
  { name: 'maxDate', type: 'string', description: TIMELINE_MAX_DATE_DESCRIPTION },
  { name: 'descriptionField', type: 'string', description: TIMELINE_DESCRIPTION_FIELD_DESCRIPTION },
  { name: 'mapping', type: 'object', description: TIMELINE_MAPPING_DESCRIPTION },
];

ComponentRegistry.register('object-timeline', ObjectTimelineRenderer, {
  namespace: 'plugin-timeline',
  label: 'Object Timeline',
  category: 'view',
  inputs: [...OBJECT_TIMELINE_INPUTS],
});

ComponentRegistry.register('timeline', ObjectTimelineRenderer, {
  namespace: 'view',
  label: 'Timeline View',
  category: 'view',
  inputs: [...OBJECT_TIMELINE_INPUTS],
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Report Presentation Schema
 *
 * Defines the ObjectUI runtime *presentation* layer for reports:
 * sections, toolbar config, schedule UI, conditional formatting,
 * export presets, etc. These are UX enhancements that the
 * `@objectstack/spec` UI Protocol intentionally does not prescribe.
 *
 * ## Layering
 *
 * - **Protocol / definition:** `./spec-report.ts` re-exports the
 *   authoritative spec `Report` under `SpecReport`. JSON authored
 *   against the spec must work with ObjectUI without rewriting.
 *
 * - **Presentation (this file):** `ReportComponentSchema`, `ReportSection`,
 *   `ReportScheduleConfig`, etc. Drive the legacy `ReportRenderer` /
 *   `ReportViewer` / `ReportBuilder`. Will be gradually thinned as
 *   spec-native renderers take over (see plugin-report roadmap).
 *
 * Use {@link specReportToPresentation} (from `./spec-report`) to
 * convert a spec `Report` into this presentation shape during the
 * migration window.
 */

import type { z } from 'zod';
import type { ReportType as SpecReportType } from '@objectstack/spec/ui';
import type { BaseSchema, SchemaNode } from './base.js';
import type { ChartSchema } from './data-display.js';

/**
 * Report Export Format
 */
export type ReportExportFormat = 'pdf' | 'excel' | 'csv' | 'json' | 'html';

/**
 * Report Schedule Frequency
 */
export type ReportScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * Report Aggregation Type
 */
export type ReportAggregationType = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinct';

/**
 * Report Field Definition
 */
export interface ReportField {
  /**
   * Field name/identifier
   */
  name: string;

  /**
   * Display label
   */
  label?: string;

  /**
   * Field type — drives type-aware cell rendering.
   *
   * The narrow primitives (string/number/date/boolean) are kept for backwards
   * compatibility, while the broader object-field types (select, multi_select,
   * lookup, reference, email, url, phone, image, richtext, json, datetime,
   * time, percent, currency, file, user, etc.) let the renderer pick the
   * right cell component (Badge for select, link for email/url/phone, ✓/✗
   * for boolean, thumbnail for image, …) instead of falling back to
   * `String(value)`.
   *
   * When the report is bound to an object (`objectName`), the runtime should
   * auto-hydrate this from the corresponding ObjectField so authors don't
   * need to repeat type metadata.
   *
   * `'owner'` was a member until objectui#4814 retired that field-type
   * spelling (ruling A′), carried onto the published twins by objectui#4914.
   * This union is the `.d.ts` half of the contract — while it listed the word,
   * editor autocomplete offered a spelling the renderer refuses with a
   * tombstone. It moves in lockstep with its runtime twin
   * `ReportFieldSchema.type` (`packages/types/src/zod/reports.zod.ts`); the two
   * report faces are never split. Write an owner column as
   * `{ type: 'user', name: 'owner' }`.
   */
  type?:
    | 'string'
    | 'text'
    | 'number'
    | 'date'
    | 'datetime'
    | 'time'
    | 'boolean'
    | 'select'
    | 'multi_select'
    | 'status'
    | 'lookup'
    | 'reference'
    | 'master_detail'
    | 'email'
    | 'url'
    | 'phone'
    | 'currency'
    | 'percent'
    | 'image'
    | 'file'
    | 'user'
    | 'richtext'
    | 'html'
    | 'markdown'
    | 'json'
    | 'tags';

  /**
   * Options for select / multi_select / status types.
   * Used by the cell renderer to resolve raw value → label and badge color.
   */
  options?: Array<{ value: string | number; label: string; color?: string }>;

  /**
   * Target object for lookup / reference / master_detail types.
   * Used by the cell renderer to build a deep-link to the related record.
   */
  referenceTo?: string;

  /**
   * Aggregation function
   */
  aggregation?: ReportAggregationType;

  /**
   * Format string
   */
  format?: string;

  /**
   * Show in summary
   */
  showInSummary?: boolean;

  /**
   * Sort order
   */
  sortOrder?: number;

  /**
   * Custom render style (e.g., 'badge' for status fields).
   * Most types now have sensible default rendering — this is for opt-in
   * overrides only.
   */
  renderAs?: 'badge' | 'text';

  /**
   * Color mapping for badge rendering (value → CSS class or color).
   * Takes precedence over per-option colors when both are provided.
   */
  colorMap?: Record<string, string>;
}

/**
 * Report Filter Definition
 */
export interface ReportFilter {
  /**
   * Field to filter on
   */
  field: string;

  /**
   * Filter operator
   */
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'between' | 'in' | 'not_in';

  /**
   * Filter value
   */
  value?: any;

  /**
   * Multiple values (for 'in' operator)
   */
  values?: any[];
}

/**
 * Report Group By Definition
 */
export interface ReportGroupBy {
  /**
   * Field to group by
   */
  field: string;

  /**
   * Display label
   */
  label?: string;

  /**
   * Sort direction
   */
  sort?: 'asc' | 'desc';
}

/**
 * Report Section Definition
 */
export interface ReportSection {
  /**
   * Section type
   */
  type: 'header' | 'summary' | 'chart' | 'table' | 'text' | 'page-break';

  /**
   * Section title
   */
  title?: string;

  /**
   * Section content
   */
  content?: SchemaNode | SchemaNode[];

  /**
   * Chart configuration (for type='chart')
   */
  chart?: ChartSchema;

  /**
   * Columns to display (for type='table')
   */
  columns?: ReportField[];

  /**
   * Text content (for type='text')
   */
  text?: string;

  /**
   * Visibility condition
   */
  visible?: boolean | string;
}

/**
 * Report Schedule Configuration
 */
export interface ReportScheduleConfig {
  /**
   * Schedule enabled
   */
  enabled?: boolean;

  /**
   * Frequency
   */
  frequency?: ReportScheduleFrequency;

  /**
   * Specific day of week (for weekly)
   */
  dayOfWeek?: number;

  /**
   * Specific day of month (for monthly)
   */
  dayOfMonth?: number;

  /**
   * Time to run (HH:mm format)
   */
  time?: string;

  /**
   * Timezone
   */
  timezone?: string;

  /**
   * Email recipients
   */
  recipients?: string[];

  /**
   * Email subject
   */
  subject?: string;

  /**
   * Email body
   */
  body?: string;

  /**
   * Export formats to attach
   */
  formats?: ReportExportFormat[];
}

/**
 * Report Export Configuration
 */
export interface ReportExportConfig {
  /**
   * Export format
   */
  format: ReportExportFormat;

  /**
   * Filename template
   */
  filename?: string;

  /**
   * Include headers
   */
  includeHeaders?: boolean;

  /**
   * Page orientation (for PDF)
   */
  orientation?: 'portrait' | 'landscape';

  /**
   * Page size (for PDF)
   */
  pageSize?: 'A4' | 'A3' | 'Letter' | 'Legal';

  /**
   * Custom options
   */
  options?: Record<string, any>;
}

/**
 * Report Type — derived from `@objectstack/spec`'s `ReportType` enum (issue
 * #2231/#2901; formerly a hand-written union).
 *
 * - `tabular` — flat list, no grouping
 * - `summary` — row-wise grouping with aggregations
 * - `matrix`  — row × column pivot
 * - `joined`  — multiple independent report blocks stacked
 *
 * The mirror was missing `joined`, so a spec-valid joined report did not
 * type-check against `ReportComponentSchema.reportType`. Derived rather than restated so
 * a report format the spec adds cannot go missing here. (`ReportComponentSchema.reportType`
 * itself is retired by objectui#6152 round 4 — nothing read it; this alias stays, as the
 * spec's report-type vocabulary.)
 */
export type ReportType = z.infer<typeof SpecReportType>;

/**
 * Report Schema - Main report configuration
 */
export interface ReportComponentSchema extends BaseSchema {
  type: 'report';

  /**
   * Report title
   */
  title?: string;

  /**
   * Report description
   */
  description?: string;

  /**
   * RETIRED (objectui#6152 round 4, ADR-0049 enforce-or-remove) — declared as the
   * report's layout type, and read by nothing.
   *
   * A type-checker census over every package's sources found ZERO reads of this
   * member (and no untyped read of the name), and no document authored it. Its one
   * producer was in code — `specReportToPresentation` in `./spec-report.ts` wrote it
   * onto the presentation it hands `report-viewer`, which never looked at it — and
   * that write is removed in the same change. A spec report's own `type` is what
   * selects a dataset-bound report's layout; this presentation key selected nothing.
   *
   * `?: never` rather than deleted: this interface carried `BaseSchema`'s index
   * signature, so a deleted member would type-check silently (since
   * objectui#8347, through a widened value only), while a tombstone
   * makes presence a `tsc` error, and the zod twin refuses the key by name.
   *
   * @deprecated RETIRED (objectui#6152) — nothing reads it. Delete the key.
   */
  reportType?: never;

  /**
   * Data source configuration — RETIRED (objectui#6121, maintainer ruling of
   * 2026-08-30, decision batch #8; ADR-0049 enforce-or-remove).
   *
   * The key was annotated `DataSource`, the RUNTIME ADAPTER interface declared
   * in `./data.ts` (`find(resource, params)`, `searchAll?()`, and friends). No
   * JSON document can author that shape, and nothing ever read the key off a
   * report schema: `@object-ui/plugin-report`'s `ReportRenderer` takes its
   * adapter as a React prop or off `SchemaRendererContext`, never off
   * `schema.dataSource`, and the live 9.0 path binds a semantic-layer
   * `dataset` instead (ADR-0021). Measured zero authored occurrences in this
   * repo and in the sibling `objectstack` checkout, whose authored reports all
   * bind `dataset` — that measurement is the ruling's own deprecation-window
   * exit criterion.
   *
   * `?: never` rather than deleted, so an author who still writes the key gets
   * a `tsc` error at the authoring site and a NAMED refusal from the zod twin
   * (`retirementTombstone` in `./zod/reports.zod.ts`) instead of a silently
   * stripped key — the disposition objectui#7344 landed for `onSave` /
   * `onCancel` on {@link ReportBuilderSchema}.
   *
   * ⚠️ The REPLACEMENT binding key the ruling names — `data?: ViewData` — is
   * deliberately NOT declared here. `data` is already taken on this interface
   * by the report ROW array below, which `LegacyReportRenderer` reads
   * (`data.length`, `data.map`, and as the chart's rows); declaring the
   * binding under that same name would put two authoring contracts on one key
   * inside one renderer, which is the objectstack#5576 collision this card's
   * own ruling rejected option D for. Escalated on objectui#6121.
   *
   * @deprecated Retired — no read site ever consumed this key.
   */
  dataSource?: never;

  /**
   * Report fields
   */
  fields?: ReportField[];

  /**
   * Report filters
   */
  filters?: ReportFilter[];

  /**
   * Group by configuration
   */
  groupBy?: ReportGroupBy[];

  /**
   * Report sections
   */
  sections?: ReportSection[];

  /**
   * Schedule configuration
   */
  schedule?: ReportScheduleConfig;

  /**
   * Default export format
   */
  defaultExportFormat?: ReportExportFormat;

  /**
   * Per-format export configuration, keyed by {@link ReportExportFormat}.
   *
   * `Partial<Record<…>>`, not a total `Record` (objectui#6121, maintainer ruling
   * 2026-08-25): a total `Record` made configuring ONE format an error unless the
   * author declared all five (`pdf`, `excel`, `csv`, `html`, `json`) — the
   * documented three-format example on `content/docs/core/report-schema.mdx`
   * failed with `TS2739 … missing the following properties …: html, json`.
   *
   * The runtime twin was never total: `ReportComponentSchema.exportConfigs` in
   * `./zod/reports.zod.ts` is `z.record(z.string(), ReportExportConfigSchema)`,
   * whose keys are all optional. So the TS declaration was stricter than the
   * validator that actually judges authored JSON — a format the type demanded
   * and the parser did not. This makes the two agree, in the direction the
   * validator already took.
   *
   * A format absent from this map exports with the renderer's defaults; it is
   * not "unsupported". Widening pinned by
   * `__tests__/report-schema-authoring-face.test.ts`.
   */
  exportConfigs?: Partial<Record<ReportExportFormat, ReportExportConfig>>;

  /**
   * Show export buttons
   */
  showExportButtons?: boolean;

  /**
   * Show print button
   */
  showPrintButton?: boolean;

  /**
   * Show schedule button
   */
  showScheduleButton?: boolean;

  /**
   * Auto-refresh interval (in seconds)
   */
  refreshInterval?: number;

  /**
   * Loading state
   */
  loading?: boolean;

  /**
   * Report data
   */
  data?: any[];

  /**
   * Conditional formatting rules
   */
  conditionalFormatting?: Array<{
    field: string;
    operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
    value: any;
    backgroundColor?: string;
    textColor?: string;
  }>;

  /**
   * RETIRED (objectui#6152 round 4, ADR-0049 enforce-or-remove) — declared as
   * "visual chart editor output", and read and written by nothing.
   *
   * A type-checker census over every package's sources found ZERO reads of this
   * member on a report (the `chartConfig` a dashboard widget carries is a different
   * key on a different type), no in-code producer, and no document authoring it,
   * so an authored value configured nothing.
   *
   * `?: never` rather than deleted: this interface carried `BaseSchema`'s index
   * signature, so a deleted member would type-check silently (since
   * objectui#8347, through a widened value only), while a tombstone
   * makes presence a `tsc` error, and the zod twin refuses the key by name.
   *
   * @deprecated RETIRED (objectui#6152) — nothing reads it. Delete the key.
   */
  chartConfig?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `report` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `report` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `report` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The `report`
   * registration (`@object-ui/plugin-report`) dispatches the node through
   * `ReportRenderer`, whose three paths read the report definition; no read
   * of the node's `body` or `children` exists in that package.
   * `SchemaRenderer` strips `body` and `children` out of the props bag it
   * spreads, so neither reaches the component by another route, and the
   * registration declares no `children` slot (objectui#9910).
   *
   * What it renders instead: a dataset-bound report (ADR-0021), a stored
   * pre-9.0 spec report bridged to `report-viewer`, or the legacy `data` /
   * `columns` / `chart` presentation.
   *
   * @deprecated Not a channel `report` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Report Builder Schema - Interactive report builder component
 */
export interface ReportBuilderSchema extends BaseSchema {
  type: 'report-builder';

  /**
   * Initial report configuration
   */
  report?: ReportComponentSchema;

  /**
   * Available data sources — RETIRED (objectui#6121, maintainer ruling of
   * 2026-08-30, decision batch #8; ADR-0049 enforce-or-remove).
   *
   * Same reading as {@link ReportComponentSchema.dataSource}, one degree
   * further from a reader: no renderer is registered for `report-builder` at
   * all — measured, zero `ComponentRegistry.register('report-builder', …)`
   * sites, with the bare `'report'` registration in `@object-ui/plugin-report`
   * as the positive control that makes that zero a reading. It is the same
   * measurement that retired `onSave` / `onCancel` below (objectui#7344), and
   * the declared element type was an array of the runtime `DataSource`
   * ADAPTER, which JSON cannot author.
   *
   * @deprecated Retired — no read site ever consumed this key.
   */
  dataSources?: never;

  /**
   * Available fields
   */
  availableFields?: ReportField[];

  /**
   * Show preview
   */
  showPreview?: boolean;

  /**
   * Save callback — RETIRED (objectui#7344; the objectui#6182 ruling in the
   * objectui#6124 shape). No renderer is registered for `report-builder`, so
   * the handler-expression string this declared could never run. The zod twin
   * refuses the key by name; author behaviour as a node type instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onSave?: never;

  /**
   * Cancel callback — RETIRED (objectui#7344), the same measurement as `onSave`.
   * @deprecated Not part of this contract — the value was inert.
   */
  onCancel?: never;
}

/**
 * Report Viewer Schema - Display a generated report
 */
export interface ReportViewerSchema extends BaseSchema {
  type: 'report-viewer';

  /**
   * Report to display
   */
  report?: ReportComponentSchema;

  /**
   * Report data
   */
  data?: any[];

  /**
   * Show toolbar
   */
  showToolbar?: boolean;

  /**
   * Allow export
   */
  allowExport?: boolean;

  /**
   * Allow print
   */
  allowPrint?: boolean;

  /**
   * Loading state
   */
  loading?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `report-viewer` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. This renderer takes its configuration from
   * the props bag `SchemaRenderer` spreads rather than from `schema.*`, and
   * carries zero `body` / `children` reads either way.
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
   * @deprecated Not a channel `report-viewer` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `report-viewer` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. This renderer takes its configuration from
   * the props bag `SchemaRenderer` spreads rather than from `schema.*`, and
   * carries zero `body` / `children` reads either way.
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
   * @deprecated Not a channel `report-viewer` reads — nothing renders it.
   */
  children?: never;
}

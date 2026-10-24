/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Report Schema Zod Validators
 * 
 * Zod validation schemas for report configuration.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/reports
 * @packageDocumentation
 */

import { z } from 'zod';
// objectui#11440 — the spec's report definition, by reference: what the
// authored `report` node wraps in its `report` member (`ReportNodeSchema` below).
import { ReportSchema as SpecReportSchema } from '@objectstack/spec/ui';
import { BaseSchema, SchemaNodeSchema } from './base.zod.js';
import { ChartSchema } from './data-display.zod.js';
import { stripImportedDefaults } from './imported-defaults.js';
import { handlerKeyRefusal, neitherContentChannelGuidance, retirementTombstone } from './tombstone.zod.js';

/**
 * Report Export Format Schema
 */
export const ReportExportFormatSchema = z.enum(['pdf', 'excel', 'csv', 'json', 'html']).describe('Report export format');

/**
 * Report Schedule Frequency Schema
 */
export const ReportScheduleFrequencySchema = z.enum(['once', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly']).describe('Report schedule frequency');

/**
 * Report Aggregation Type Schema
 */
export const ReportAggregationTypeSchema = z.enum(['sum', 'avg', 'min', 'max', 'count', 'distinct']).describe('Report aggregation type');

/**
 * Report Field Schema
 *
 * `type` accepted `'owner'` until objectui#4814 retired that field-type
 * spelling (ruling A′) and objectui#4914 carried the shrink onto the published
 * contract twins. This enum is the RUNTIME half of that contract: while it
 * still listed the word, a published validator answered "legal" for a spelling
 * `@object-ui/fields` answers with a tombstone refusal — the declared ≠
 * enforced shape ADR-0049 targets. It moves in lockstep with its TS twin
 * `ReportField['type']` (`packages/types/src/reports.ts`); the two report
 * faces are never split. Report an owner column as `{ type: 'user', name:
 * 'owner' }` — the field NAME carries the ownership meaning, the type carries
 * the rendering.
 */
export const ReportFieldSchema = z.object({
  name: z.string().describe('Field name/identifier'),
  label: z.string().optional().describe('Display label'),
  type: z
    .enum([
      'string', 'text', 'number', 'date', 'datetime', 'time', 'boolean',
      'select', 'multi_select', 'status', 'lookup', 'reference', 'master_detail',
      'email', 'url', 'phone', 'currency', 'percent',
      'image', 'file', 'user',
      'richtext', 'html', 'markdown', 'json', 'tags',
    ])
    .optional()
    .describe('Field type — drives type-aware cell rendering'),
  options: z
    .array(z.object({ value: z.union([z.string(), z.number()]), label: z.string(), color: z.string().optional() }))
    .optional()
    .describe('Options for select/multi_select/status types'),
  referenceTo: z.string().optional().describe('Target object for lookup/reference/master_detail'),
  aggregation: ReportAggregationTypeSchema.optional().describe('Aggregation function'),
  format: z.string().optional().describe('Format string'),
  showInSummary: z.boolean().optional().describe('Show in summary'),
  sortOrder: z.number().optional().describe('Sort order'),
  renderAs: z.enum(['badge', 'text']).optional().describe('Custom render style override'),
  colorMap: z.record(z.string(), z.string()).optional().describe('Value → color class map for badges'),
});

/**
 * Report Filter Schema
 */
export const ReportFilterSchema = z.object({
  field: z.string().describe('Field to filter on'),
  operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'between', 'in', 'not_in']).describe('Filter operator'),
  value: z.any().optional().describe('Filter value'),
  values: z.array(z.any()).optional().describe('Multiple values (for "in" operator)'),
});

/**
 * Report Group By Schema
 */
export const ReportGroupBySchema = z.object({
  field: z.string().describe('Field to group by'),
  label: z.string().optional().describe('Display label'),
  sort: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
});

/**
 * Report Section Schema
 */
export const ReportSectionSchema = z.object({
  type: z.enum(['header', 'summary', 'chart', 'table', 'text', 'page-break']).describe('Section type'),
  title: z.string().optional().describe('Section title'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Section content'),
  chart: ChartSchema.optional().describe('Chart configuration (for type="chart")'),
  columns: z.array(ReportFieldSchema).optional().describe('Columns to display (for type="table")'),
  text: z.string().optional().describe('Text content (for type="text")'),
  visible: z.union([z.boolean(), z.string()]).optional().describe('Visibility condition'),
});

/**
 * Report Schedule Schema
 */
export const ReportScheduleSchema = z.object({
  enabled: z.boolean().optional().describe('Schedule enabled'),
  frequency: ReportScheduleFrequencySchema.optional().describe('Frequency'),
  dayOfWeek: z.number().optional().describe('Specific day of week (for weekly)'),
  dayOfMonth: z.number().optional().describe('Specific day of month (for monthly)'),
  time: z.string().optional().describe('Time to run (HH:mm format)'),
  timezone: z.string().optional().describe('Timezone'),
  recipients: z.array(z.string()).optional().describe('Email recipients'),
  subject: z.string().optional().describe('Email subject'),
  body: z.string().optional().describe('Email body'),
  formats: z.array(ReportExportFormatSchema).optional().describe('Export formats to attach'),
});

/**
 * Report Export Config Schema
 */
export const ReportExportConfigSchema = z.object({
  format: ReportExportFormatSchema.describe('Export format'),
  filename: z.string().optional().describe('Filename template'),
  includeHeaders: z.boolean().optional().describe('Include headers'),
  orientation: z.enum(['portrait', 'landscape']).optional().describe('Page orientation (for PDF)'),
  pageSize: z.enum(['A4', 'A3', 'Letter', 'Legal']).optional().describe('Page size (for PDF)'),
  options: z.record(z.string(), z.any()).optional().describe('Custom options'),
});

/** objectui#9256 (family-D re-measure): ONE refusal string for both content channels of `ReportComponentSchema`. */
const REPORT_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'report',
  'its registration (`plugin-report:report`) dispatches the node through `ReportRenderer`, whose three '
    + 'paths read the report definition and never the node\'s own child list',
  'a dataset-bound report (ADR-0021), a stored pre-9.0 spec report bridged to `report-viewer`, or the '
    + 'legacy `data` / `columns` / `chart` presentation',
);

/**
 * Report Schema
 */
export const ReportComponentSchema = BaseSchema.extend({
  type: z.literal('report'),
  title: z.string().optional().describe('Report title'),
  description: z.string().optional().describe('Report description'),
  // RETIRED (objectui#6121, maintainer ruling of 2026-08-30, decision batch #8;
  // ADR-0049 enforce-or-remove). The TS twin is `dataSource?: never`; the key
  // stays DECLARED so an authored value is refused BY NAME instead of being
  // waved through by `z.any()` and then read by nobody.
  dataSource: retirementTombstone(
    'Data source configuration — RETIRED (objectui#6121, ADR-0049). The key was declared as the ' +
      'runtime `DataSource` ADAPTER (`find(resource, params)`), which JSON has no value for, and ' +
      'no renderer ever read it off a report schema: the report renderers take their adapter as a ' +
      'React prop or from `SchemaRendererContext`. Bind a report through the semantic-layer ' +
      '`dataset` form (ADR-0021); a legacy presentation report receives its rows under `data`.',
  ),
  fields: z.array(ReportFieldSchema).optional().describe('Report fields'),
  filters: z.array(ReportFilterSchema).optional().describe('Report filters'),
  groupBy: z.array(ReportGroupBySchema).optional().describe('Group by configuration'),
  sections: z.array(ReportSectionSchema).optional().describe('Report sections'),
  schedule: ReportScheduleSchema.optional().describe('Schedule configuration'),
  defaultExportFormat: ReportExportFormatSchema.optional().describe('Default export format'),
  /**
   * Keyed by `ReportExportFormatSchema`, not by `string` (objectui#8556): the
   * declaration has been `Partial<Record<ReportExportFormat, …>>` since
   * objectui#6121 and this mirror still admitted any string key.
   *
   * `z.partialRecord`, ⛔ never `z.record(ReportExportFormatSchema, …)`:
   * measured on zod 4.4.3, the plain `z.record` over an enum key REQUIRES every
   * member, which is exactly the total-`Record` authoring face objectui#6121's
   * maintainer ruling removed from the TypeScript side.
   */
  exportConfigs: z.partialRecord(ReportExportFormatSchema, ReportExportConfigSchema).optional().describe('Export configurations'),
  showExportButtons: z.boolean().optional().describe('Show export buttons'),
  showPrintButton: z.boolean().optional().describe('Show print button'),
  showScheduleButton: z.boolean().optional().describe('Show schedule button'),
  refreshInterval: z.number().optional().describe('Auto-refresh interval (in seconds)'),
  loading: z.boolean().optional().describe('Loading state'),
  data: z.array(z.any()).optional().describe('Report data'),
  // objectui#6152 round 3 — declared on the interface and never mirrored here. READ:
  // `ReportViewer` evaluates each rule per cell (`report?.conditionalFormatting`) for
  // the report a `report-viewer` node carries, and that node's `report` member IS
  // this mirror. Restated rule for rule from the interface's inline element type.
  conditionalFormatting: z.array(z.object({
    field: z.string().describe('Field the rule tests'),
    operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than']).describe('Comparison operator'),
    value: z.any().describe('Value the field is compared with'),
    backgroundColor: z.string().optional().describe('Cell background colour when the rule matches'),
    textColor: z.string().optional().describe('Cell text colour when the rule matches'),
  })).optional().describe('Conditional formatting rules, evaluated per cell; the first matching rule styles it'),
  // objectui#6152 round 4 — two keys the interface declared and NOTHING read (a
  // type-checker census over every package's sources, no untyped read, no authored
  // document). Retired on both faces under ADR-0049 enforce-or-remove; tombstones
  // rather than deletions because `BaseSchema` is `.passthrough()`, so a deleted arm
  // would KEEP an authored value in silence. `reportType`'s one in-code producer, the
  // spec-report converter in `../spec-report.ts`, stops writing it in the same change.
  reportType: retirementTombstone(
    'RETIRED (objectui#6152, ADR-0049) — nothing ever read `reportType` off a report: the presentation '
    + 'renderer draws the same sections whatever it says. Delete the key; a dataset-bound report\'s layout '
    + 'is the spec report\'s own `type`.',
  ),
  chartConfig: retirementTombstone(
    'RETIRED (objectui#6152, ADR-0049) — nothing ever read `chartConfig` off a report, so an authored '
    + 'value configured nothing. Delete the key.',
  ),
  // objectui#9256 (family-D re-measure): the renderer reads NEITHER content channel, so both are
  // refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(REPORT_NEITHER_CHANNEL),
  children: retirementTombstone(REPORT_NEITHER_CHANNEL),
});

/**
 * Report Builder Schema
 */
export const ReportBuilderSchema = BaseSchema.extend({
  type: z.literal('report-builder'),
  report: ReportComponentSchema.optional().describe('Initial report configuration'),
  // RETIRED with `ReportComponentSchema.dataSource` above (objectui#6121), one
  // degree further from a reader: no renderer is registered for
  // `report-builder`, the same measurement that retired the two handler keys
  // below (objectui#7344).
  dataSources: retirementTombstone(
    'Available data sources — RETIRED (objectui#6121, ADR-0049). No renderer is registered for ' +
      '`report-builder`, so nothing could ever read this key, and it was declared as an array of ' +
      'the runtime `DataSource` ADAPTER, which JSON has no value for. Bind a report through the ' +
      'semantic-layer `dataset` form (ADR-0021).',
  ),
  availableFields: z.array(ReportFieldSchema).optional().describe('Available fields'),
  showPreview: z.boolean().optional().describe('Show preview'),
  // RETIRED (objectui#7344, the objectui#6182 ruling in the objectui#6124 shape):
  // no renderer is registered for `report-builder`, so neither callback could
  // ever run; both refuse by name.
  onSave: handlerKeyRefusal('onSave', 'retired', 'Save callback'),
  onCancel: handlerKeyRefusal('onCancel', 'retired', 'Cancel callback'),
});

/**
 * Report Viewer Schema
 */
export const ReportViewerSchema = BaseSchema.extend({
  type: z.literal('report-viewer'),
  report: ReportComponentSchema.optional().describe('Report to display'),
  data: z.array(z.any()).optional().describe('Report data'),
  showToolbar: z.boolean().optional().describe('Show toolbar'),
  allowExport: z.boolean().optional().describe('Allow export'),
  allowPrint: z.boolean().optional().describe('Allow print'),
  loading: z.boolean().optional().describe('Loading state'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `report-viewer` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'It takes its configuration from the props bag `SchemaRenderer` spreads, not from `schema.*`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `report-viewer` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'It takes its configuration from the props bag `SchemaRenderer` spreads, not from `schema.*`.',
  ),
});

/**
 * Report Node Schema — the AUTHORED `report` node (objectui#11440): every
 * member of {@link ReportComponentSchema}, plus `report`, the wrapper shape the
 * retired `spec-report` alias carried.
 *
 * ## Why the wrapper is declared here
 *
 * The seat ruling `5945530142` on objectui#10859 retires `spec-report` as an
 * alias of `report`, in a fixed order: `report` first declares the shape
 * `spec-report` carried, `{ "type": "report", "report": { … } }`, then the
 * emitter moves, then the alias goes. Both keys were registered on the one
 * dispatcher, `ReportRenderer` (`@object-ui/plugin-report`), whose first step
 * unwraps a node whose `report` member is an object and renders THAT: the
 * spec's report definition, dataset-bound (ADR-0021) or a stored pre-9.0 one it
 * bridges. Before this arm the strict face refused `report` on a `report` node
 * as an unrecognized key, and the tolerant face passed it unjudged.
 *
 * ## The member, by reference
 *
 * `report` is `@objectstack/spec/ui`'s `ReportSchema` through the import
 * boundary, the shape `defineReport` validates and `json-schema/ui/Report.json`
 * publishes, so the spec's members, required keys and refusals apply unchanged.
 * ⚠️ That includes the spec's own refusal of the pre-9.0 query form
 * (`objectName` / `columns` objects, "did you mean `dataset`?"): the renderer
 * still bridges such a stored report at runtime, but it is not authorable here.
 *
 * ## Why a node of its own, and not a member of `ReportComponentSchema`
 *
 * `ReportComponentSchema` is also the report RECORD that a `report-viewer` and a
 * `report-builder` hold in their own `report` member, and `ReportViewer` reads
 * no wrapper there. A wrapper declared on the record would accept, unread, a
 * report nested inside a viewer's report. So the union arms the node with this
 * schema, and `ReportComponentSchema` stays the record and its TypeScript
 * twin's mirror. When `report` is present, `ReportRenderer` renders the wrapped
 * report alone and reads none of the node's presentation members.
 */
export const ReportNodeSchema: ReportNodeZodType = ReportComponentSchema.extend({
  report: stripImportedDefaults(SpecReportSchema)
    .optional()
    .describe(
      'The report to render: `@objectstack/spec` `ReportSchema`, by reference (a dataset-bound report, ADR-0021). '
      + 'When present, `ReportRenderer` renders it and reads none of the node\'s presentation members '
      + '(objectui#11440; the wrapper the retired `spec-report` alias carried).',
    ),
});

/**
 * The TYPE of {@link ReportNodeSchema}, written out BY REFERENCE: the record's
 * shape plus the spec's `ReportSchema` by name. Without it, declaration emit
 * re-serializes the whole spec report shape inside `AnyComponentSchema`, and
 * against `@objectstack/spec` built from objectstack `main` `tsc` refuses that
 * union with TS7056 ("The inferred type of this node exceeds the maximum length
 * the compiler will serialize"), measured by the `Spec Main Shape Gate` on
 * objectui#11440's second pull request. A named type is emitted by name, as
 * `PageKindNodeSchemaType` is (`layout.zod.ts`). It is a type only: the schema
 * accepts exactly what it accepted before.
 *
 * Named `…ZodType` because this file's `…SchemaType` names are `z.infer`
 * aliases (`ReportNodeSchemaType` among them, below).
 */
export type ReportNodeZodType = z.ZodObject<
  (typeof ReportComponentSchema)['shape'] & {
    report: z.ZodOptional<typeof SpecReportSchema>;
  },
  z.core.$loose
>;

/**
 * Union of all report schemas
 */
const ReportUnionSchemaInferred = z.discriminatedUnion('type', [
  // objectui#11440 — the authored `report` node is `ReportNodeSchema` (the
  // record plus the `report` wrapper); `ReportComponentSchema` stays the record.
  ReportNodeSchema,
  ReportBuilderSchema,
  ReportViewerSchema,
]);

/**
 * The TYPE of {@link ReportUnionSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface ReportUnionZodType extends ReportUnionSchemaInferredType {
  options: ReportUnionSchemaInferredType['options'];
}
type ReportUnionSchemaInferredType = typeof ReportUnionSchemaInferred;

/** The union above, typed by its named {@link ReportUnionZodType}. */
export const ReportUnionSchema: ReportUnionZodType = ReportUnionSchemaInferred;

/**
 * Export type inference helpers
 */
export type ReportExportFormatSchemaType = z.infer<typeof ReportExportFormatSchema>;
export type ReportScheduleFrequencySchemaType = z.infer<typeof ReportScheduleFrequencySchema>;
export type ReportAggregationTypeSchemaType = z.infer<typeof ReportAggregationTypeSchema>;
export type ReportFieldSchemaType = z.infer<typeof ReportFieldSchema>;
export type ReportFilterSchemaType = z.infer<typeof ReportFilterSchema>;
export type ReportGroupBySchemaType = z.infer<typeof ReportGroupBySchema>;
export type ReportSectionSchemaType = z.infer<typeof ReportSectionSchema>;
export type ReportScheduleSchemaType = z.infer<typeof ReportScheduleSchema>;
export type ReportExportConfigSchemaType = z.infer<typeof ReportExportConfigSchema>;
export type ReportComponentSchemaType = z.infer<typeof ReportComponentSchema>;
export type ReportNodeSchemaType = z.infer<typeof ReportNodeSchema>;
export type ReportBuilderSchemaType = z.infer<typeof ReportBuilderSchema>;
export type ReportViewerSchemaType = z.infer<typeof ReportViewerSchema>;

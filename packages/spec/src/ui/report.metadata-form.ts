/**
 * Form layout for the Report metadata editor.
 *
 * Bound to {@link ReportSchema} via `data.provider = 'schema'`. The
 * `@object-ui/plugin-form` renderer resolves field metadata from the
 * Zod-derived JSON Schema served by `/api/v1/meta` and applies the
 * widget/visibility hints declared here.
 *
 * ADR-0021 single-form: a report is dataset-bound — it binds a semantic-layer
 * `dataset` and selects its `values` (measure names) grouped by `rows`
 * (dimension names). The legacy inline `objectName` + `columns` + `groupings`
 * query form was removed from {@link ReportSchema} in the 9.0 cutover, so this
 * form no longer declares those fields.
 */

import { defineMetadataForm } from './view.zod';
import { defaultPeriodOptions } from './default-period-options';

export const reportForm = defineMetadataForm({
  schemaId: 'report',
  type: 'simple',
  sections: [
    {
      label: 'Basics',
      description: 'Identity and report type.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', colSpan: 1, required: true, helpText: 'snake_case unique identifier' },
        { field: 'label', type: 'text', colSpan: 1, required: true },
        // #36447 — without its own hint this row read the shared `I18nLabel`
        // description ("Display label — … inline locale map …").
        { field: 'description', type: 'textarea', colSpan: 2, helpText: 'One sentence on what this report shows, displayed under its name.' },
        { field: 'type', colSpan: 2, helpText: 'Report type: tabular, summary, matrix or joined.' },
      ],
    },
    {
      label: 'Dataset binding',
      description: 'Where the report’s numbers come from, how they are grouped and sorted, and which records open when you click a row.',
      // A `joined` report carries its data on `blocks` instead.
      visibleWhen: "data.type != 'joined'",
      fields: [
        // #36838 — the four row titles are the blocks grid's terms below (and
        // `JoinedReportBlockSchema`'s `.meta({ title })`), so one form never
        // names the same key in two vocabularies. Without a `label` these rows
        // read the prettified keys Dataset / Values / Rows / Columns.
        { field: 'dataset', label: 'Data Source', widget: 'ref:dataset', helpText: 'The report reads its numbers from here; everyone sees only the records they have access to.' },
        // A measure may be any dataset measure (sum, count, average, ratio, derived).
        { field: 'values', label: 'Metrics', widget: 'string-tags', helpText: 'The metrics to show, such as totals, counts, averages or ratios (from the data source).' },
        { field: 'rows', label: 'Group By', widget: 'string-tags', helpText: 'The fields to group by (from the data source).' },
        // CEL visibility — only Matrix reports pivot across a second dimension.
        { field: 'columns', label: 'Group Columns By', widget: 'string-tags', visibleWhen: "data.type == 'matrix'", helpText: 'Groups spread across the columns (matrix reports only).' },
        // #3916 — ordering is authorable here or it is not authorable at all:
        // `DatasetSelection.order` has always existed on the wire, but a report
        // author had no channel to reach it. Optional — a selected time
        // dimension is chronological by default without declaring anything.
        {
          field: 'order',
          // #36447 — "Order" alone reads as a sales order to a business reader.
          label: 'Sort Order',
          type: 'repeater',
          helpText: 'What to sort by, most important first (a grouping or a metric). Time groupings sort in date order by default.',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'by', label: 'Sort By' },
            { field: 'direction', label: 'Direction' },
          ],
        },
        { field: 'drilldown', helpText: 'Click a summarized row or cell to open the records behind it.' },
      ],
    },
    {
      label: 'Joined blocks',
      description: 'Other blocks stacked into the same report, each with its own data source (joined reports only).',
      visibleWhen: "data.type == 'joined'",
      fields: [
        {
          field: 'blocks',
          type: 'repeater',
          helpText: 'Sub-reports, each with its own data source (joined reports only).',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'name', label: 'Name' },
            { field: 'label', label: 'Label' },
            { field: 'description', label: 'Description' },
            { field: 'type', label: 'Block Type' },
            // A `chart` input sat here until #20161: the key was removed from
            // `JoinedReportBlockSchema` because no renderer ever drew a block
            // chart, so this control offered a setting that plotted nothing.
            // #21714: a joined report refuses a block that binds no `dataset`
            // (#21702), so this column declares the `ref:dataset` picker the
            // top-level binding declares, marked required: a block is bound
            // in the form before save.
            { field: 'dataset', label: 'Data Source', widget: 'ref:dataset', required: true },
            { field: 'rows', label: 'Group By' },
            { field: 'columns', label: 'Group Columns By' },
            { field: 'values', label: 'Metrics' },
            { field: 'runtimeFilter', label: 'Runtime Filter' },
            { field: 'order', label: 'Sort Order' },
          ],
        },
      ],
    },
    {
      label: 'Filter & chart',
      description: 'Filter conditions and how the chart is shown.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'runtimeFilter', widget: 'json', helpText: 'A filter applied whenever the report is shown, on top of the data source’s own conditions.' },
        // #20161 — a `joined` report draws its blocks as tables and refuses a
        // container `chart`, so the control is offered only where it draws.
        { field: 'chart', type: 'composite', visibleWhen: "data.type != 'joined'", helpText: 'Chart type and settings.' },
      ],
    },
    {
      // #26548 — the report page's period and its table download. A `joined`
      // report refuses both keys (its blocks may bind different datasets, and
      // it draws one table per block), so the section is offered only where
      // they parse.
      label: 'Period & export',
      description: 'The default period of the report and the formats its table can be downloaded in.',
      collapsible: true,
      collapsed: true,
      visibleWhen: "data.type != 'joined'",
      fields: [
        // #36447 — both composites declare their children, so each row carries
        // its own business wording instead of the schema description, and
        // `os i18n extract` emits a catalog key per child.
        // `report-form-composite-children.test.ts` holds each list equal to the
        // schema's live keys: a key added to the schema later must be added here.
        {
          field: 'dateRange',
          type: 'composite',
          helpText: 'The period the report opens with, and whether people may choose their own range.',
          fields: [
            { field: 'dimension', label: 'Date Field', helpText: 'The date grouping of the data source the period applies to. Leave it empty when the data source has only one.' },
            // Each choice is named (`defaultPeriodOptions`, shared with the
            // dashboard form): with no options a select names its choices by
            // their stored values.
            {
              field: 'defaultRange',
              type: 'select',
              label: 'Default Period',
              helpText: 'The period the report opens with.',
              options: defaultPeriodOptions(),
            },
            { field: 'allowCustomRange', label: 'Allow Custom Range', helpText: 'Let people pick their own start and end dates.' },
          ],
        },
        {
          field: 'exportOptions',
          type: 'composite',
          helpText: 'Download formats (csv, xlsx) and file name. Who may download is set by the export permission on the data source’s object.',
          fields: [
            { field: 'formats', label: 'Formats', helpText: 'The download formats offered. Left unset, both csv and xlsx are offered; an empty list turns downloads off.' },
            { field: 'includeHeaders', label: 'Include Headers', helpText: 'Put the column names in the first row of the downloaded file.' },
            // The prefix replaces the report's label, which falls back to its
            // name (`buildExportFileName` in @object-ui/core, called by the
            // report export control); the date and time follow it.
            { field: 'fileNamePrefix', label: 'File Name', helpText: 'The start of the downloaded file’s name. Left empty, the file is named after the report’s label, or its name when it has no label.' },
          ],
        },
      ],
    },
    // An "Advanced" section offering `aria` + `performance` used to sit here.
    // #3496 pruned both keys from ReportSchema (dead in both layers) but left
    // this form untouched, so the section rendered two controls whose values
    // ReportSchema silently stripped on save. Removed with the keys they named;
    // metadata-form-zod-reconciliation.test.ts fails on the next such prune.
  ],
});

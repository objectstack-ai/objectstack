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

import { defineForm } from './view.zod';

export const reportForm = defineForm({
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
        { field: 'description', type: 'textarea', colSpan: 2 },
        { field: 'type', colSpan: 2, helpText: 'Report type: tabular/summary/matrix/joined' },
      ],
    },
    {
      label: 'Dataset binding',
      description: 'The semantic-layer dataset this report renders. Values are the dataset’s measures; rows are its dimensions.',
      // A `joined` report carries its data on `blocks` instead.
      visibleWhen: "data.type != 'joined'",
      fields: [
        { field: 'dataset', widget: 'ref:dataset', helpText: 'Dataset to bind (measures/dimensions come from its semantic layer)' },
        { field: 'values', widget: 'string-tags', helpText: 'Measure names (from the dataset) to display' },
        { field: 'rows', widget: 'string-tags', helpText: 'Dimension names (from the dataset) to group rows by' },
        // CEL visibility — only Matrix reports pivot across a second dimension.
        { field: 'columns', widget: 'string-tags', visibleWhen: "data.type == 'matrix'", helpText: 'Dimension names across (matrix only)' },
        // #3916 — ordering is authorable here or it is not authorable at all:
        // `DatasetSelection.order` has always existed on the wire, but a report
        // author had no channel to reach it. Optional — a selected time
        // dimension is chronological by default without declaring anything.
        { field: 'order', type: 'repeater', helpText: 'Sort keys, most significant first (a rows/columns dimension or a values measure). Time dimensions are chronological by default.' },
        { field: 'drilldown', helpText: 'Click an aggregated row/cell to open the underlying records' },
      ],
    },
    {
      label: 'Joined blocks',
      description: 'Additional dataset-bound blocks stacked into a single report (joined reports only).',
      visibleWhen: "data.type == 'joined'",
      fields: [
        { field: 'blocks', type: 'repeater', helpText: 'Dataset-bound sub-reports (joined report only)' },
      ],
    },
    {
      label: 'Filter & chart',
      description: 'Render-time scope filter and chart presentation.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'runtimeFilter', widget: 'json', helpText: 'Render-time scope filter, ANDed at query time' },
        { field: 'chart', type: 'composite', helpText: 'Chart config (type, legend, colors)' },
      ],
    },
    {
      label: 'Advanced',
      description: 'Accessibility and performance tuning.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'aria', type: 'composite', helpText: 'Accessibility labels' },
        { field: 'performance', type: 'composite', helpText: 'Caching and optimization' },
      ],
    },
  ],
});

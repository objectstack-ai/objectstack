# @object-ui/plugin-report

Report components for Object UI — render, view and export reports, with scheduling support. Report *authoring* is not part of this package.

## Features

- 🧩 **Four spec report variants** — `tabular` / `summary` / `matrix` / `joined`, dispatched by a single `<ReportRenderer schema={...}>`
- 🧮 **Server-side aggregation** — a dataset-bound report selects measures by name through `dataSource.queryDataset`; totals come back pre-aggregated (ADR-0021)
- 📅 **Period pivots** — the across axis is a dimension the dataset declares at the grain it needs; a report buckets nothing itself
- 🪜 **Multi-level grouping + totals** — row subtotals, column subtotals and grand total for `matrix`, a grand-total footer for `summary`, all server-computed
- 🎯 **Cell drill-down** — aggregated rows and matrix cells emit `DatasetDrillArgs` to the host's `onDrill` callback; the host owns navigation (ADR-0021 D2)
- 🧱 **Joined reports** — vertically stacked sub-reports; each block names its own `dataset`, filter and ordering
- 🎨 **Type-aware cells** — the presentation-layer `ReportViewer` renders `select` → Badge, `lookup` → link, `boolean` → ✓/✗, `email`/`url`/`phone` → links, `image` → thumbnail
- 🖨️ **Multi-format export** — CSV, JSON, HTML, PDF, Excel; live-data and Excel-formula variants
- 📦 **Auto-registered** — components register with `ComponentRegistry` on import; embed via `{ "type": "report", "report": {...} }`

## Installation

```bash
npm install @object-ui/plugin-report
```

**Peer Dependencies:**
- `react` ^19.0.0
- `react-dom` ^19.0.0

## Quick Start

`ReportRenderer` is the one entry point — a dispatcher that routes any report
shape to the right renderer. It takes the report as `schema`; there is no
report-authoring component in this package (see
[Legacy presentation layer](#legacy-presentation-layer)).

```tsx
import { ReportRenderer } from '@object-ui/plugin-report';
import type { DataSource } from '@object-ui/types';

// `dataSource` and `router` are host-provided.
declare const dataSource: DataSource;
declare const router: { push: (href: string) => void };

function ReportPage() {
  return (
    <ReportRenderer
      schema={{
        name: 'opp_by_stage',
        type: 'summary',
        dataset: 'opportunity_pipeline',
        rows: ['stage'],
        values: ['amount_sum', 'deal_count'],
      }}
      dataSource={dataSource}
      onDrill={({ object }) => router.push(`/records/${object}`)}
    />
  );
}
```

The dataset-bound renderer can also be addressed directly when the host has
already decided the shape — it takes the report as `report`, not `schema`:

```tsx
import { DatasetReportRenderer, isDatasetReport } from '@object-ui/plugin-report';
import type { DataSource } from '@object-ui/types';

// `stored` is whatever the host loaded; `dataSource` is host-provided.
declare const stored: unknown;
declare const dataSource: DataSource;

function StoredReportPage() {
  if (isDatasetReport(stored)) {
    return <DatasetReportRenderer report={stored} dataSource={dataSource} />;
  }
  return null;
}
```

`ReportViewer` renders a presentation-layer report, and takes a whole
`ReportViewerSchema` as `schema` — `report` / `showToolbar` are keys *inside*
that schema, not props of the component:

```tsx
import { ReportViewer } from '@object-ui/plugin-report';
import type { ReportComponentSchema } from '@object-ui/types';

// All three are host-provided.
declare const reportDefinition: ReportComponentSchema;
declare const rows: Array<Record<string, unknown>>;
declare const refetch: () => void;

function LegacyReportPage() {
  return (
    <ReportViewer
      schema={{ type: 'report-viewer', report: reportDefinition, data: rows, showToolbar: true }}
      onRefresh={refetch}
    />
  );
}
```

## Spec Reports — the four variants

A report is **dataset-bound**: it names a semantic-layer `dataset` and selects
that dataset's measures (`values`) grouped by its dimensions (`rows`, and for a
matrix also `columns`). Every name in a report is a name the dataset defines —
the report declares no object, no field, no aggregate and no date bucket of its
own. `defineReport` validates at authoring time and returns the parsed shape
`ReportRenderer` takes as `schema`:

```tsx
import { defineReport } from '@objectstack/spec/ui';
import { ReportRenderer } from '@object-ui/plugin-report';
import type { DataSource } from '@object-ui/types';

// `ds` is host-provided.
declare const ds: DataSource;

const report = defineReport({
  name: 'opp_by_stage',
  label: 'Opportunities by Stage',
  type: 'summary',
  dataset: 'opportunity_pipeline',
  rows: ['stage'],
  values: ['amount_sum', 'deal_count'],
  order: [{ by: 'amount_sum', direction: 'desc' }],
});

<ReportRenderer schema={report} dataSource={ds} />
```

| Key             | Type                                           | Meaning                                                          |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `name`          | `string` (required)                            | Identifier, at least 2 characters.                                |
| `label`         | `string` \| `Record< string, string >` (required) | Display title; the record form is the i18n shape.              |
| `type`          | `tabular` \| `summary` \| `matrix` \| `joined` | Defaults to `tabular`.                                          |
| `dataset`       | `string`                                       | The dataset this report reads.                                    |
| `rows`          | `string[]`                                     | Dimension **names** to group down.                                |
| `columns`       | `string[]`                                     | Dimension **names** across — the matrix pivot axis.               |
| `values`        | `string[]`                                     | Measure **names** to display.                                     |
| `runtimeFilter` | filter condition                               | Scope filter, merged with the filter the host passes at render.    |
| `order`         | `{ by, direction }[]`                          | Result ordering, most significant key first.                      |
| `drilldown`     | `boolean`                                      | Defaults to `true`.                                               |
| `chart`         | object                                         | Embedded visualization over the same selection.                   |
| `blocks`        | report[]                                       | `joined` only — the stacked sub-reports.                          |

The schema is **strict**: a key it does not declare is rejected, not ignored.

| `type`    | Description                                                                    |
| --------- | ------------------------------------------------------------------------------ |
| `tabular` | The selection as a flat list — `rows` + `values`, no totals                     |
| `summary` | The same table plus a server-computed grand-total footer                        |
| `matrix`  | Cross-tab: `rows` down × `columns` across, measures in the cells, plus subtotals |
| `joined`  | A vertical stack of blocks, each its own dataset-bound table                    |

The **declared type** picks the presentation — never the shape of the data that
comes back.

### Matrix (row × column pivot)

`columns` is a second list of dimension **names**, used as the across axis:

```ts
import { defineReport } from '@objectstack/spec/ui';

defineReport({
  name: 'pipeline_by_quarter',
  label: 'Pipeline Coverage by Quarter',
  type: 'matrix',
  dataset: 'opportunity_pipeline',
  rows: ['forecast_category'],
  columns: ['close_quarter'],
  values: ['amount_sum'],
});
```

`close_quarter` is a time dimension the **dataset** declares at that grain. A
report cannot bucket a date itself: the grain a measure is valid at belongs to
the semantic layer, not to one report. A `matrix` with no `columns` degrades to
the flat grouped table.

### Joined

```ts
import { defineReport } from '@objectstack/spec/ui';

defineReport({
  name: 'churn_signals',
  label: 'Customer Churn Signals',
  type: 'joined',
  blocks: [
    {
      name: 'at_risk',
      label: 'At-Risk Accounts',
      type: 'summary',
      dataset: 'account_health',
      rows: ['industry'],
      values: ['account_count'],
      runtimeFilter: { is_active: true },
    },
    {
      name: 'lost',
      label: 'Recently Lost',
      type: 'summary',
      dataset: 'opportunity_pipeline',
      rows: ['owner'],
      values: ['amount_sum'],
      runtimeFilter: { stage: 'closed_lost' },
    },
  ],
});
```

Block rules: every block names its **own** `dataset` (there is no container
dataset to inherit); the container's `runtimeFilter` is merged into each block
and the block's own keys win; each block orders itself through its own `order`;
a block's declared `type` picks its presentation; `block.type` must not be
`joined` (no recursion).

### Ordering

`order` is a list, most significant key first, lowered onto the dataset
selection so the **server** orders the query — which is why ordering by a
derived measure works and the sort applies to the whole result rather than to
one fetched page. `by` names a dimension the report groups by or a measure it
displays. For a matrix the across axis reads left-to-right in row-arrival
order, so ordering by the across dimension is what fixes the column order;
declaring nothing still reads correctly, because a selected time dimension
defaults to ascending.

With no `order`, a **select** dimension follows its field's declared option
order (table rows, matrix headers on both axes, the embedded chart's
categories): declared options first, values the options do not declare next in
the dataset's order, the empty bucket last. With several grouping dimensions the
outer one is laid out first and the inner one within each outer group; a
dimension whose field declares no options keeps the dataset's order. An
authored `order` keeps the server's order.

### Embedded chart

`chart.type` is one of the spec's chart names; `xAxis` / `yAxis` are **bare
dimension and measure names** from the report's own selection, not field paths
and not expressions:

```ts
import { defineReport } from '@objectstack/spec/ui';

defineReport({
  name: 'pipeline_by_stage',
  label: 'Pipeline by Stage',
  type: 'summary',
  dataset: 'opportunity_pipeline',
  rows: ['stage'],
  values: ['amount_sum'],
  chart: {
    type: 'bar',
    title: 'Pipeline by Stage',
    xAxis: 'stage',
    yAxis: 'amount_sum',
    showLegend: false,
  },
});
```

`series`, `colors`, `height`, `showDataLabels`, `annotations` and `interaction`
are passed through to the chart as authored.

The chart runs its own `xAxis` × `yAxis` dataset query, so it binds the same way
on every non-`joined` type. It draws above a `tabular` or `summary` table, and
below the cross-tab of a `matrix` that declares `columns`; there `xAxis` may name
a `rows` or a `columns` dimension.

## Server-side aggregation + drill-down

A dataset-bound report selects its dimensions (`rows`, and for `matrix` also
`columns`) and measures (`values`) **by name** and runs them through
`dataSource.queryDataset` — the same governed semantic-layer path that
dataset-bound dashboard widgets and the dataset preview use, so the numbers and
the server-resolved dimension labels match everywhere. Totals (row subtotals,
column subtotals, grand total) are **server-computed**: the renderer places the
pre-aggregated rows it is handed and never re-aggregates bucketed values
client-side, since measures like `avg` cannot be recombined without drifting
from the semantic layer.

When the dataset query is refused because the viewer may not read the data
(`403` / `PERMISSION_DENIED`, as the shared `classifyLoadError` from
`@object-ui/react` reads it), the report shows a localized "You don't have
access" state instead of its table, the same title a dataset dashboard widget
shows, and never the server's message. Any other failure still shows the error
and its message.

Drill-down is a **host callback, not a registered handler**: pass `onDrill` and
every aggregated row / matrix cell becomes clickable. The report emits *what was
clicked*; the host decides where that goes, because the renderer only knows
dimension names (ADR-0021 D2).

```tsx
import { ReportRenderer, type DatasetDrillArgs } from '@object-ui/plugin-report';
import type { DataSource, SpecReport } from '@object-ui/types';

// `report`, `dataSource` and `router` are host-provided.
declare const report: SpecReport;
declare const dataSource: DataSource;
declare const router: { push: (href: string) => void };

<ReportRenderer
  schema={report}
  dataSource={dataSource}
  onDrill={(args: DatasetDrillArgs) => {
    // The host resolves dataset → object and dimension → field, then navigates.
    const filter = { ...args.objectFilter, ...args.runtimeFilter };
    router.push(`/records/${args.object}?filter=${encodeURIComponent(JSON.stringify(filter))}`);
  }}
/>
```

What a drill click carries:

| `DatasetDrillArgs` | Meaning |
| ------------------ | ------- |
| `dataset`      | Dataset the clicked aggregate was computed over. |
| `groupKey`     | Dimension **name** → clicked bucket value (row dims, plus across dims for a matrix cell). |
| `runtimeFilter`| The effective render-time scope filter, if any. |
| `object`       | The dataset's base object, when the server supplied it. |
| `objectFilter` | Exact record-list filter (object **field** name → raw stored value) for the clicked bucket. Present only when the server returned the dimension→field mapping plus raw grouped values — that is what lets select/lookup dimensions filter precisely instead of by display label. |

Supply no `onDrill` and nothing is clickable; a report can also opt out with
`drilldown: false`.

## Filter-time date helpers — current limitation

The server does **not** currently evaluate `` cel`...` `` expressions
embedded in filter values. Use module-load ISO strings instead:

```ts
import { defineReport } from '@objectstack/spec/ui';

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

defineReport({
  name: 'recent_pipeline',
  label: 'Recent Pipeline',
  type: 'summary',
  dataset: 'opportunity_pipeline',
  rows: ['stage'],
  values: ['amount_sum'],
  runtimeFilter: { close_date: { $gte: daysAgo(30) } },
});
```

See the bundled CRM `customer_churn_signals` demo for the full pattern.
Native filter-time CEL evaluation is tracked for a future major version.

## Stored pre-9.0 documents — migration only

> ⚠️ **This section is about documents that already exist in storage. The shape
> it describes is NOT available for authoring** — everything above is how a
> report is written, nothing here is.

Before the ADR-0021 cutover a report carried its own query: an `objectName`,
`columns` as column *definition objects* with `aggregate`, and
`groupingsDown` / `groupingsAcross` with `sortOrder` and `dateGranularity`.
That form is **rejected by the current schema** — `objectName` and
`groupingsDown` come back as unrecognized keys, and object-shaped `columns`
fails as the wrong type (`columns` is now a list of dimension names).

Stored documents in that shape still render, through a deliberately lossy
bridge: `ReportRenderer` converts them to a presentation report and hands that
to `ReportViewer`. The converter reads the *current* keys (`values`, `rows`), so
a pre-9.0 document arrives with none of them and what comes out is the report's
title over an **empty column set**. The document renders; its columns,
groupings, aggregates and sort do not, and nothing reports an error. That is why
the bridge is a waiting room rather than a supported way to write a report.

Migrating one is a re-expression against the dataset:

| Pre-9.0 key                        | Where it goes now                                                       |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `objectName`                       | Gone from the report — the `dataset` owns the object.                    |
| `columns: [{ field, aggregate }]`  | `values: string[]`; the aggregate becomes a **measure** in the dataset.  |
| `columns: [{ field }]`             | `rows: string[]`, as a dimension.                                        |
| `groupingsDown: [{ field }]`       | `rows: string[]`.                                                        |
| `groupingsAcross: [{ field }]`     | `columns: string[]`.                                                     |
| `sortOrder` on a grouping          | `order: [{ by, direction }]` on the report.                              |
| `dateGranularity` on a grouping    | A time dimension declared at that grain **in the dataset**.              |
| `filter`                           | `runtimeFilter`.                                                         |

The part with no mechanical equivalent is the dataset itself: measures and time
dimensions the old report declared inline must exist in the semantic layer
before the migrated report can name them.

The query-form renderers that used to draw these documents inline
(`SpecReportGrid`, `MatrixRenderer`, `JoinedReportRenderer`) were removed at the
cutover and have no replacement export — the bridge above is what renders a
stored old-shape document now.

## Legacy presentation layer

`ReportViewer`, `LegacyReportRenderer` and the export functions below remain
available for pre-spec presentation reports (`{ report, data, columns, chart }`)
and are not affected by the dataset-bound pipeline above.

The authoring components that used to sit alongside them — `ReportBuilder`,
`ScheduleConfig`, `ChartConfig`, the columns/groupings editors — and the
`registerDrillHandler`-style drill helpers were **removed** in the 9.0 cutover
(see `CHANGELOG.md`). They have no replacement export in this package: report
authoring lives in the console designer, and drill-down is the `onDrill`
callback above.

### Export

Every format exporter takes the **report schema first and the rows second** —
`(report: ReportComponentSchema, data: any[], config?: ReportExportConfig)`. The
schema is where the exporter reads the columns (`report.fields`) and the download
name (`config.filename`, else `report.title`) from; there is **no filename
parameter**. All five return `void` synchronously — they trigger a browser
download — so there is nothing to `await`:

```tsx
import {
  exportReport,
  exportAsCSV,
  exportAsJSON,
  exportAsHTML,
  exportAsPDF,
  exportAsExcel,
} from '@object-ui/plugin-report';
import type { ReportComponentSchema } from '@object-ui/types';

const report: ReportComponentSchema = {
  type: 'report',
  title: 'Sales Report',
  fields: [
    { name: 'account', label: 'Account' },
    { name: 'amount', label: 'Amount', type: 'currency', aggregation: 'sum' },
  ],
};
const rows = [{ account: 'Acme', amount: 12000 }];

exportAsCSV(report, rows); // downloads "Sales Report.csv"
exportAsJSON(report, rows); // "Sales Report.json"
exportAsHTML(report, rows); // "Sales Report.html"
exportAsPDF(report, rows); // opens a print window; falls back to .html if blocked
exportAsExcel(report, rows, { format: 'excel', filename: 'sales-2026-q1.tsv' });

// `exportReport` is the router — the format comes FIRST, then the same triple.
exportReport('csv', report, rows);
```

`exportAsExcel` writes a BOM-prefixed **TSV** that Excel opens, so its default
name is `report.title` + `.tsv`, not `.xlsx`. `config.includeHeaders: false` drops the
header row; `orientation` / `pageSize` apply to the HTML and PDF paths only.

### Live Export

`exportWithLiveData` fetches the rows itself, so `dataSource` and `resource` are
**required** in `LiveExportOptions` — an options object carrying only `format`
does not compile. It is the one `async` export function, resolving to a
`LiveExportResult`:

```tsx
import { exportWithLiveData } from '@object-ui/plugin-report';
import type { DataSource, ReportComponentSchema } from '@object-ui/types';

// `myAdapter` is a host-provided DataSource (see @object-ui/data-*).
declare const myAdapter: DataSource;
declare const report: ReportComponentSchema;

const result = await exportWithLiveData(report, {
  dataSource: myAdapter,
  resource: 'orders',
  format: 'pdf',
});
// -> { success: true, recordCount: 42, format: 'pdf' }
```

The format falls back to `report.defaultExportFormat`, then `'pdf'`. Failures are
returned, not thrown: `{ success: false, recordCount: 0, format, error }`.

`exportExcelWithFormulas` is a separate, synchronous three-parameter function —
`(report, data, options)` — with the column list inside the third argument. A
column is `{ name, header, width?, numberFormat?, formula? }`: `name` is the key
read off each row (there is no `field` key), `header` is required, and a `formula`
is a template in which the `{ROW}` placeholder is replaced by that row's
spreadsheet line number:

```tsx
import { exportExcelWithFormulas } from '@object-ui/plugin-report';
import type { ReportComponentSchema } from '@object-ui/types';

declare const report: ReportComponentSchema;
declare const rows: Array<Record<string, unknown>>;

exportExcelWithFormulas(report, rows, {
  columns: [
    { name: 'amount', header: 'Amount', numberFormat: '#,##0.00' },
    { name: 'total', header: 'Total', formula: '=B{ROW}*C{ROW}' },
  ],
  includeAggregationRow: true,
  locale: 'de-DE',
});
```

Omitting `columns` derives them from `report.fields`. `includeAggregationRow`
appends a totals row built from each field's `aggregation`.

`locale` is the BCP-47 tag the numeric cells are formatted in — above, an
`amount` of `1234.5` writes `1.234,50` rather than `1,234.50`. Pass the tag the
session renders in: `useDisplayLocale()` from `@object-ui/i18n` in React, or
whatever your non-React caller resolved. This function is not a component and a
display locale is a property of the session rather than of the authored report
schema, so its caller is the only place the tag can come from. Omitted, cells
format in `'en'` — the display channel's own last resort, which is neither
`'en-US'` nor the machine's locale (objectui#10020).

### Scheduled export

A schedule is **data on the report schema**, not a component: it is
`ReportComponentSchema.schedule`, typed `ReportScheduleConfig`. Both types live
in `@object-ui/types` and are *not* re-exported here — importing them from this
package is a TS2305.

`createScheduleTrigger` turns that declared schedule into a callable a workflow
engine can invoke. It takes the report, the data source, the resource to query
and a completion callback:

```ts
import { createScheduleTrigger } from '@object-ui/plugin-report';
import type { DataSource, ReportComponentSchema, ReportScheduleConfig } from '@object-ui/types';

// `dataSource` and `notify` are host-provided.
declare const dataSource: DataSource;
declare const notify: (recipients: string[], subject: string | undefined) => void;

const report: ReportComponentSchema = {
  type: 'report',
  title: 'Monthly Sales',
  schedule: {
    enabled: true,
    frequency: 'monthly',
    dayOfMonth: 1,
    time: '07:00',
    formats: ['pdf', 'excel'],
    recipients: ['sales@example.com'],
  },
};

const trigger = createScheduleTrigger(
  report,
  dataSource,
  'orders',
  (exported: ReportComponentSchema, schedule: ReportScheduleConfig) => {
    notify(schedule.recipients ?? [], schedule.subject ?? exported.title);
  },
);

const results = await trigger(); // LiveExportResult[] — one entry per scheduled format
```

`trigger()` reads `report.schedule` itself: a schedule that is missing or
`enabled: false` exports nothing and resolves to `[]`. Otherwise it exports once
per entry in `schedule.formats` (falling back to `report.defaultExportFormat`,
then `'pdf'`) and calls the completion callback with the report and the schedule
it ran.

### Schema-Driven Usage

Importing the package registers two component types with `ComponentRegistry`:

| `type`          | Component        | Notes                                                        |
| --------------- | ---------------- | ------------------------------------------------------------ |
| `report`        | `ReportRenderer` | The dispatcher. A spec report goes under its `report` key.   |
| `report-viewer` | `ReportViewer`   | Presentation-layer viewer.                                   |

To embed a report, wrap the `@objectstack/spec` report definition (`ReportSchema`)
in a `report` node's `report` member. When `report` is present, the node renders
that report and reads none of its own presentation keys.

```json
{
  "type": "report",
  "report": {
    "name": "opp_by_stage",
    "label": "Opportunities by Stage",
    "type": "summary",
    "dataset": "opportunity_pipeline",
    "rows": ["stage"],
    "values": ["amount_sum"]
  }
}
```

There is no `report-builder` component type — the authoring component that name
addressed was removed in the 9.0 cutover, so a node declaring it resolves to
nothing. `spec-report` is retired too (objectui#11440): it was an alias of `report`
carrying the same wrapper, and a node declaring it now resolves to nothing. Write
`"type": "report"` instead; the `report` member is unchanged.

### Type-aware cell rendering

`ReportViewer` delegates cell rendering to the shared `getCellRenderer`
registry from `@object-ui/fields`, so each column is rendered with the
component appropriate for its type — instead of `String(value)`.

| `field.type`                  | Rendering                                     |
| ----------------------------- | --------------------------------------------- |
| `text` / `string`             | Plain text                                    |
| `number` / `currency` / `percent` | Locale-formatted, optional currency/percent symbol |
| `boolean`                     | ✓ / ✗ icons                                   |
| `date` / `datetime` / `time`  | Localised date/time                           |
| `select` / `multi_select` / `status` | Badge(s), label resolved from `options`, color from `option.color` or `colorMap` |
| `lookup` / `reference` / `master_detail` | Linked record name (id fallback), deep-link to `/console/apps/<app>/<referenceTo>/record/<id>` |
| `email`                       | `mailto:` link                                |
| `url`                         | External link (`target="_blank"`)             |
| `phone`                       | `tel:` link                                   |
| `image`                       | Inline thumbnail                              |
| `file`                        | Filename + download link                      |
| `user` / `owner`              | Avatar + name                                 |
| `richtext` / `html` / `markdown` | Sanitised inline content                   |
| `json`                        | Collapsed code preview                        |

These are presentation-layer columns: each entry in `report.fields` carries its
own `name`, `label` and `type`, and that declared `type` is what selects the
renderer. This package resolves nothing from object metadata — there is no
`objectName` on a report to hydrate from, and a column with no `type` renders
as plain text.

Legacy `renderAs: 'badge'` + `colorMap` is still honoured for plain
string columns.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-report)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-report)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).

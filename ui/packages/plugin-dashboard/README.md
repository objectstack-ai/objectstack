# @object-ui/plugin-dashboard

Dashboard plugin for Object UI - Create beautiful dashboards with metrics, charts, and widgets.

## Features

- **Dashboard Layouts** - Grid-based dashboard layouts
- **Metric Cards** - Display KPIs and statistics
- **Widget System** - Modular widget components
- **Responsive** - Mobile-friendly dashboard grids
- **Customizable** - Tailwind CSS styling support

## Installation

```bash
pnpm add @object-ui/plugin-dashboard
```

## Requires a bundler — plain Node cannot import this package

`DashboardGridLayout` imports `react-grid-layout`'s stylesheet at module scope
(`import 'react-grid-layout/css/styles.css'`), and Node has no loader for `.css` at all.
Importing the published entry from plain Node ESM — no bundler, no loader hooks — therefore
resolves and then fails during evaluation:

```text
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css"
  for .../react-grid-layout/css/styles.css
```

**This is a supported-configuration statement, not a bug to report.** Unbundled Node
consumption is not supported for style-carrying plugin packages. It was ruled that way on
[objectui#5384](https://github.com/objectstack-ai/objectui/issues/5384) — deliberately, over
the alternative of moving the stylesheet out of module scope — because the grid's layout rules
are not optional and no unbundled-Node consumer exists to serve.

Consume it through a host that handles CSS imports, which every supported host does: Vite,
webpack, or Next with the package listed in `transpilePackages`. If you have a real need to
import it under plain Node — SSR with no bundler, a Node-side script — please open an issue.
That reopens the question as a design decision rather than a defect, and the shape of your
consumer is the missing input.

## Usage

### Automatic Registration (Side-Effect Import)

```typescript
// In your app entry point (e.g., App.tsx or main.tsx)
import '@object-ui/plugin-dashboard';

// Now you can use dashboard types in your schemas
const schema = {
  type: 'dashboard',
  widgets: [
    {
      type: 'metric-card',
      title: 'Total Sales',
      value: '$123,456',
      trend: 'up',
      trendValue: '+12%'
    }
  ]
};
```

### What the side-effect import registers

That single import is the whole of registration — there is no components map to
iterate over. Importing the entry runs the seven live `ComponentRegistry.register(...)`
calls in `src/index.tsx`, which claim exactly these schema types. The keys below
are read off those calls:

| Namespaced key | Bare-name fallback | Renderer behind it |
| --- | --- | --- |
| `plugin-dashboard:dashboard` | `dashboard` | `DashboardRenderer` — the widget container |
| `plugin-dashboard:metric` | none — `skipFallback: true` | `MetricWidget` — one KPI value |
| `plugin-dashboard:metric-card` | none — `skipFallback: true` | `MetricCard` — KPI with trend and icon |
| `plugin-dashboard:object-metric` | `object-metric` | internal wrapper around `ObjectMetricWidget` — aggregates over an object |
| `plugin-dashboard:pivot` | `pivot` | `PivotTable` — pivot over rows you pass in |
| `plugin-dashboard:object-pivot` | `object-pivot` | `ObjectPivotTable` — a pivot queried from an object; its props go in `properties` |
| `plugin-dashboard:object-data-table` | `object-data-table` | `ObjectDataTable` — table queried from an object |

`ComponentRegistry.register` publishes `namespace:type`, and — unless the call
passes `skipFallback: true` — the bare `type` as a back-compat fallback
(`packages/core/src/registry/Registry.ts:194`, fallback branch at `:226`). Every
call behind the table above leaves `skipFallback` unset except `metric` and
`metric-card`, so each other type there resolves under both spellings.

`metric` and `metric-card` are two vocabularies that share a spelling: the
dashboard WIDGET types (`widgets[].type: 'metric'`, and the `metric-card` slot
entry) and the internal NODE keys the dashboard renders them through. The widget
types are unchanged. The node keys register with `skipFallback: true`
(objectui#10859 batch 8), and both dashboard surfaces emit the namespaced keys, so
only `plugin-dashboard:metric` / `plugin-dashboard:metric-card` resolve as nodes.

`dashboard-grid` is no longer registered (objectui#10859 batch 8: builder chrome,
with no producer and no runtime emitter). `DashboardGridLayout` is still exported;
mount it directly (see "DashboardGridLayout — persisting drag / resize edits"). The two `object-*` types are served by internal wrappers that
first resolve the spec's per-element `dataSource` binding (through
`ElementDataSourceGate` from `@object-ui/react`) and then render the exported
component, which is why those rows name a wrapper rather than an export.

⛔ One further registration is deliberately absent from the table above. Until
objectui#9533 the dashboard renderer was published as `view:dashboard`, while
`apps/console`'s lazy stubs and the CLI's known-type whitelist already spelled it
`plugin-dashboard:dashboard`; the bare `dashboard` key therefore declared one
namespace before the chunk loaded and the other after it, and the
`plugin-dashboard:dashboard` stub was never cleared, so that spelling could never
resolve. The renderer now registers under `plugin-dashboard`, and the retired
`view:dashboard` key is answered by a tombstone widget that refuses BY NAME and
names `plugin-dashboard:dashboard` as its replacement — so an authored
`view:dashboard` gets a visible refusal carrying its own migration, never a
silent fall-through. That tombstone registration passes `skipFallback: true`, so
it claims no bare key, and `view:dashboard` is deliberately NOT a renderable key:
`objectui check` reports it as unknown.

### Registering a component under your own key

To serve one of this package's components under a key of your own, register the
exported component — that is what a manual registration is here:

```typescript
import { ComponentRegistry } from '@object-ui/core';
import { MetricCard } from '@object-ui/plugin-dashboard';

ComponentRegistry.register('my-metric', MetricCard, {
  namespace: 'my-app',
  label: 'My Metric',
  category: 'Dashboard',
});
```

There is also a `dashboardComponents` export: the manual-integration map, keyed
by the **same seven schema types** as the table above (objectui#5064 re-keyed it
from component class names; since objectui#10859 batch 8 the `metric` and
`metric-card` entries are keyed `plugin-dashboard:metric` /
`plugin-dashboard:metric-card`, the type each serves, so iterating the map cannot
re-create their retired bare keys). Each key maps to the exact component the import
registers for that type — for the two `object-*` types that is the internal
data-source-gate wrapper, not the exported widget. Iterating it with
`ComponentRegistry.register(type, component)` therefore re-registers the seven
types the import has already claimed, which is still not the manual registration
above: each such call passes no `meta`, so it trips the no-namespace deprecation
warning in `register` (`packages/core/src/registry/Registry.ts:198`) and
rewrites each bare-name registry entry without its `label`/`category` metadata
(the `namespace:type` entries are untouched). The side-effect import remains the
whole of registration.

## Schema API

### Dashboard

Container for dashboard widgets:

```typescript
import type { DashboardComponentSchema, DashboardWidgetSchema } from '@object-ui/types';

declare const widgets: DashboardWidgetSchema[];

const schema: DashboardComponentSchema = {
  type: 'dashboard',
  widgets,
  columns: 3,                     // Grid columns (default: 3)
  gap: 4,                         // Gap between widgets
  className: 'w-full',
};
```

`type` and `widgets` are the required keys; every other key above is optional.

### Metric Card

Display a single metric or KPI as a dashboard widget-slot entry:

```typescript
import type { ComponentProps } from 'react';
import { MetricCard } from '@object-ui/plugin-dashboard';

// A `metric-card` entry sits directly in a dashboard's `widgets[]` — the closed
// component slot of the 2026-08-14 ruling. Its keys besides `type` are
// `MetricCard`'s own props. That props interface is not on this package's export
// surface (see "TypeScript Support" below), so they are read off the shipped
// component rather than restated here — a renamed or retyped prop stops this
// block compiling.
type MetricCardEntry = { type: 'metric-card' } & ComponentProps<typeof MetricCard>;

const card: MetricCardEntry = {
  type: 'metric-card',
  title: 'Total Sales',
  value: '$123,456',
  icon: 'trending-up',            // Lucide icon name
  trend: 'up',                    // 'up' | 'down' | 'neutral'
  trendValue: '+12%',
  description: 'vs last month',
  className: 'col-span-2',
};

const schema = { type: 'dashboard', widgets: [card] };
```

The dashboard renders the entry as the `plugin-dashboard:metric-card` node. The
bare `metric-card` NODE key is retired (objectui#10859), so a `metric-card`
outside a dashboard's `widgets[]` renders the "Unknown component type" panel.

`value` is the only required key. `title` and `description` take a plain string
or the spec's inline per-locale map (`I18nLabel`).

A card with no `value` is refused by `@object-ui/types/zod`, on the tolerant
face and the strict one. `metric-card` is not a widget type, so a card is never
read through widget keys, and no widget key stands in for `value`: the
dashboard reads a widget key (`dataset`, `options`, `component`,
`colorVariant`, …) on a widget alone, so a card draws its own keys whatever
else it carries, and the strict face refuses a widget key on it
(objectui#11483, objectui#11598). For a figure queried from a
dataset, write a `metric` widget with `dataset` and `values` (see "TypeScript
Support" below).

#### Percent `format` patterns (`'0%'`, `'0.00%'`)

A numeral pattern ending in `%` is handed whole to `formatPercent`
(`@object-ui/fields`), the same call the list-view percent cell and this
package's own record-field renderer already make. Two consequences, both of
them shared with every other percent surface in the console rather than decided
by the tile:

- **Magnitude** is read at a STATED storage, never guessed from the value. A
  `metric` tile holds no field, only a value and a pattern, and numeral's `%`
  multiplies by 100, so the pattern states a fraction: `0.25` reads `25%`, `1`
  reads `100%`, `-0.05` reads `-5%`. An `object-metric` tile over a `percent`
  field renders at that field's own storage instead, the one the list cell
  reads (`percentScaleOf` in `@objectstack/spec/data`: a fraction unless the
  field declares a `max` above 1), so a field declaring `max: 100` that
  averages `50` reads `50%`.
- **The percent sign is the locale's**, not a literal `%`: a `de-DE` session
  gets the no-break space German writes before the sign, and grouping follows
  the locale (a fraction of `12.5` reads `1,250%` in `en`).

The pattern's decimal count still belongs to the tile — `'0.00%'` renders two
decimals — because that is an author declaration on the widget rather than a
guess about the value.

## Examples

### Basic Dashboard

```typescript
const schema = {
  type: 'dashboard',
  columns: 3,
  gap: 4,
  widgets: [
    {
      type: 'metric-card',
      title: 'Total Users',
      value: '1,234',
      icon: 'users',
      trend: 'up',
      trendValue: '+12%',
      description: 'vs last month'
    },
    {
      type: 'metric-card',
      title: 'Revenue',
      value: '$56,789',
      icon: 'dollar-sign',
      trend: 'up',
      trendValue: '+8.2%',
      description: 'vs last month'
    },
    {
      type: 'metric-card',
      title: 'Active Sessions',
      value: '432',
      icon: 'activity',
      trend: 'down',
      trendValue: '-3%',
      description: 'vs last month'
    }
  ]
};
```

### Dashboard with Charts

```typescript
const schema = {
  type: 'dashboard',
  widgets: [
    {
      type: 'metric-card',
      title: 'Total Revenue',
      value: '$123,456'
    },
    {
      id: 'sales_trend',
      type: 'line',
      title: 'Sales Trend',
      dataset: 'sales',
      dimensions: ['month'],
      values: ['revenue']
    },
    {
      id: 'revenue_by_category',
      type: 'pie',
      title: 'Category Distribution',
      dataset: 'sales',
      dimensions: ['category'],
      values: ['revenue']
    }
  ]
};
```

A chart widget names its family in `type` — one of the spec's chart families,
the closed vocabulary `DashboardWidgetTypeName` declares — and binds a
`dataset` (ADR-0021), selecting the dimension it plots in `dimensions` and its
measures in `values`. It never carries rows: `options.data`,
`options.xField` and `options.yField` are not widget keys, and
`@object-ui/types/zod`'s `StrictAnyComponentSchema` refuses them by name
(objectui#11228). There is no `card` widget family and no nested `body` slot: a
widget whose `type` is outside that vocabulary is refused at validation, by
`@object-ui/types/zod`'s `DashboardComponentSchema`.

### Responsive Dashboard

```typescript
const schema = {
  type: 'dashboard',
  columns: 4,
  gap: 6,
  className: 'lg:grid-cols-4 md:grid-cols-2 sm:grid-cols-1',
  widgets: [/* widgets */]
};
```

## Integration with Data Sources

Connect dashboard to live data. `metric-card` renders the `value` it is handed:
it has no row in the spec's expression carriage map, so a `${…}` written in
`value` or `trend` reaches the screen as those characters. A widget that should
read live data is one of the `object-*` types above — they resolve the spec's
per-element `dataSource` binding and query the object themselves.

**The adapter is not a schema key.** A schema is a serialisable document; a live
adapter is an object with methods, so it cannot travel in one. An `object-*`
widget reads its adapter from React context — `useContext(SchemaRendererContext)`
at `src/ObjectMetricWidget.tsx:159`, with an explicit `dataSource` prop taking
precedence when the host renders the widget directly.

So the document stays plain data — every value in it survives `JSON.stringify`:

```typescript
import type { DashboardComponentSchema } from '@object-ui/types';

const schema: DashboardComponentSchema = {
  type: 'dashboard',
  widgets: [
    {
      type: 'metric-card',
      title: 'Total Users',
      value: 12480,
      trend: 'up'
    }
  ]
};
```

The adapter is installed once, above the whole tree, and every `object-*` widget
underneath reads it from context:

```tsx
import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
import { createObjectStackAdapter } from '@object-ui/data-objectstack';
import '@object-ui/plugin-dashboard';
import type { DashboardComponentSchema } from '@object-ui/types';

// The document from the block above.
declare const schema: DashboardComponentSchema;

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com',
  token: 'your-auth-token'
});

export const App = () => (
  <SchemaRendererProvider dataSource={dataSource}>
    <SchemaRenderer schema={schema} />
  </SchemaRendererProvider>
);
```

> A `dataSource` key **does** mean something on a schema node, but it is not this:
> it is the spec's element **binding** (`PageComponentSchema.dataSource`) — a
> declarative descriptor such as `{ object: 'orders', view: 'my_view' }`, resolved
> against the host and mapped onto the widget's own keys by the `object-*`
> registry shells in `src/index.tsx`. It belongs on the widget that reads it, not
> on the dashboard node, and a live adapter written into that slot wires nothing
> up — it is a different kind of thing wearing the same name.

## Dashboard-level filters

A dashboard can declare top-level filters — a date range and any number of
select / text filters — whose values drive **every bound widget at once**.
The filter values live as dashboard-level variables (the page/dashboard
variables primitive), and each widget declares which of **its own** fields a
filter binds to. At render time the dashboard merges the active filter values
into each bound widget's inline query (`AND`-combined with the widget's own
`filter`).

```jsonc
{
  "type": "dashboard",
  "dateRange": {
    "field": "created_at",          // default binding target
    "defaultRange": "last_30_days", // today | this_week | … | last_90_days | custom
    "allowCustomRange": true        // offer a custom from/to calendar
  },
  "globalFilters": [
    {
      "name": "region",             // stable filter name (defaults to field)
      "field": "region",            // default binding target
      "label": "Region",
      // optional "object": the object `field` lives on — its fields.<object>.<field> / fieldOptions.<object>.<field>.<value> bundle entries then win, "label" is the fallback
      "type": "select",             // text | select | date | number | lookup
      // Canonical @objectstack/spec pair form — the only form the platform
      // accepts at publish, and the only form `@object-ui/types` validates
      // (objectui#7759). The bare-string shorthand (["EMEA", …]) is NOT
      // accepted: the runtime no longer lifts it (objectui#4356) — a bare member
      // yields no option, and a dev-mode warning names it. Rewrite each X as
      // { "value": X, "label": X }.
      "options": [
        { "value": "EMEA", "label": "EMEA" },
        { "value": "APAC", "label": "APAC" },
        { "value": "AMER", "label": "AMER" }
      ]
      // or dynamic: "optionsFrom": { "object": "accounts", "valueField": "region", "labelField": "region" }
      // (`labelField` is required by the spec, even when it names the value field)
    }
  ],
  "widgets": [
    // Widgets bind a semantic-layer dataset (ADR-0021) and select its
    // dimensions/measures by name. The pre-ADR-0021 top-level `object` +
    // `categoryField`/`valueField`/`aggregate` shape was REMOVED — a widget
    // still carrying it renders "This widget uses a retired data format.
    // Edit it to bind a dataset." instead of a chart. Inline widget data
    // (`options.data`, `options.xField` / `options.yField`) is not an
    // authoring surface either: the strict authoring face refuses those keys
    // by name (objectui#11228). A stored single-value widget (`metric`,
    // `gauge`, `solid-gauge`, `kpi`, `bullet`, or one with no `type`) whose
    // `options.data` is a `{ "provider": "object", … }` query draws that same
    // retired-format prompt instead of its number (objectui#11525).
    //
    // Default binding: the filter's own `field` (dateRange → created_at).
    { "id": "w1", "type": "bar", "dataset": "invoices", "dimensions": ["status"], "values": ["count"] },
    // Explicit binding: map each filter to THIS widget's own field.
    {
      "id": "w2", "type": "line", "dataset": "accounts", "dimensions": ["signed_month"], "values": ["count"],
      "filterBindings": { "dateRange": "signed_at", "region": "sales_region" }
    },
    // Opt out of a filter with `false`.
    {
      "id": "w3", "type": "metric", "dataset": "invoices", "values": ["count"],
      "filterBindings": { "region": false }
    }
  ]
}
```

Binding rules, in precedence order:

1. `filterBindings[name]` as a string — apply the filter to that field.
2. `filterBindings[name]: false` — opt this widget out.
3. Legacy `targetWidgets` on the filter — when set, only listed widget ids
   get the default binding (an explicit `filterBindings` entry still wins).
4. Otherwise the filter applies to its own `field` (the built-in date range
   defaults to `dateRange.field ?? 'created_at'`).

Notes:

- Date presets stay symbolic (`{30_days_ago}` … date-macro tokens) until
  query time, so widgets resolve them exactly like hand-authored filters.
- Dataset-bound widgets receive the merged filter through the dataset
  query's `runtimeFilter`.
- Filter values are also readable in widget expressions as `page.<name>`
  (e.g. `page.region`), since they are hosted as dashboard variables.
- `optionsFrom` resolves distinct option values server-side (a dataset
  GROUP BY) when the data source supports dataset queries, falling back to
  a client-side dedupe over the first 200 records otherwise.
- Default bindings are metadata-aware for inline `object` widgets: a default
  field that doesn't exist on the widget's object is skipped with a console
  warning instead of emitting a query that matches nothing. Explicit
  `filterBindings` strings are always honoured as written.

## Widget accent colour (`colorVariant`)

A KPI widget can declare a semantic accent. The vocabulary is
`@objectstack/spec`'s `WidgetColorVariantSchema` enum — `default`, `blue`,
`teal`, `orange`, `purple`, `success`, `warning`, `danger` — the same eight
tokens the designer's swatch picker offers:

```typescript
import type { DashboardWidgetSchema } from '@object-ui/types';

const atRisk: DashboardWidgetSchema = {
  id: 'kpi_at_risk',
  type: 'metric',
  title: 'At-Risk Projects',
  dataset: 'project_health',
  values: ['project_count'],
  filter: { health: 'red' },
  colorVariant: 'danger',   // tints the value; card chrome stays neutral
};
```

Where the accent lands depends on the layout, not on the token:

| Layout | Accent |
| --- | --- |
| Card chrome (`MetricWidget`, an `object-metric` block) | the icon chip's background + foreground |
| Chrome-less (`MetricWidget variant: 'bare'`, and every dataset-bound `metric`) | the big number's text colour |

Both read one shared table (`src/colorVariants.ts`), so the same declaration
reads the same on either surface. `default` — and omitting the key — means "no
accent"; the widget renders in the ambient foreground colour. A token outside
the enum gets no accent and is not aliased to a nearby colour: it is invalid
metadata, rejected where it is authored and published rather than reinterpreted
here.

## A widget with no `type`, or a `type` that names no family

A widget that declares no `type` is a `metric` widget. `@objectstack/spec`'s
`DashboardWidget.type` defaults to `metric`, and both dashboard surfaces
(`DashboardRenderer` and `DashboardGridLayout`) read that default from the spec,
so the widget draws exactly as the same widget with `type: 'metric'` does,
inline or bound to a dataset (objectui#11514). objectui's validator accepts the
widget without a `type` and does not write the default in, so the surfaces are
where it resolves.

objectui's legacy `component` envelope (`{ id, component, layout }`) is not the
spec's widget, and the default is not applied to it: an envelope with no `type`
draws its `component` under its card heading.

The envelope takes a `metric-card` node only (objectui#12163), and draws one
only (objectui#12254). Both validator faces and
`DashboardWidgetSchema['component']` refuse any other node by name, at
`component`, with the fix: a dashboard widget binds a dataset (ADR-0021), so
write the widget itself in the spec form, or put a `metric-card` in the slot.
Both surfaces draw a stored envelope by the same rule: a `metric-card` draws as
written, and any other node (an `object-chart`, a `text`, an `object-metric`, a
node with no `type`) draws the same retired-format prompt as a dataset-less
metric widget and sends no query. A `custom` widget with no `component` draws
the labelled placeholder described next.

A `type` that names no widget family and no component type (a typo, or a family
the spec no longer has) is refused by both validator faces at `type`. A stored
one draws the labelled placeholder "「type」chart type is not supported yet", as
a known family with no renderer (`heatmap`) does, instead of the renderer's red
"Unknown component type" panel.

## How many measures a widget renders

A dataset-bound widget queries every measure in `values`. What it renders
depends on its shape:

- **A metric-family widget** (`metric`, `kpi`, `gauge`, `solid-gauge`,
  `bullet`) is a one-number tile. It takes exactly one measure, and
  `@objectstack/spec` refuses a second one at its door; several numbers is a
  different visual.
- **A widget with no `dimensions` and several measures** renders every one of
  them when its type is `table` / `pivot` (one row of measures) or a chart of
  the bar family (`bar`, `column`, `horizontal-bar`) or `line` / `area` /
  `combo` (one mark per measure, the measures' labels on the category axis,
  which runs down the side on a `horizontal-bar`).
- **Any other dimensionless widget with several measures** still renders the
  first one as a tile.
- **A `pie`, `donut`, `funnel`, `treemap` or `sankey` with a dimension** draws
  one series, the first measure, however many it declares: the shared chart
  renderer reads the first series only on those families.

When a widget keeps a declared measure off the screen, `DatasetWidget` logs
one console warning naming the widget, the measures it renders, and the ones it
queried and never displayed. Three shapes do that. Two take the tile: a metric
tile stored before the spec narrowed, and a widget the third bullet above
covers (no `dimensions`, several measures, and a type the second bullet does not
list, so a dimensionless `pie` is one). The third is a `pie`, `donut`,
`funnel`, `treemap` or `sankey` with a dimension and several measures
(objectui#11417). For a tile the warning
then names the spec's ADR-0087 entry
`dashboard-widget-metric-family-multi-measure-refused`, whose `replacement`
says what to author instead of a one-number tile with several measures. For
one of those five charts it says that the chart family draws a single series,
the first declared measure, and points to no entry: that one answers for a
tile. Nothing about what is drawn changes. Every door accepts the chart shape
today; the spec is to refuse it (objectstack#21293).
The widget panel (`WidgetConfigPanel`) asks the same door the spec runs: it
offers no further measure the door would refuse, and shows the door's own
message under measures it already refuses.

The behaviour is pinned by `src/__tests__/DatasetWidget.unrenderedMeasures-8894.test.tsx`,
`src/__tests__/DatasetWidget.dimensionlessMeasures-11261.test.tsx` and
`src/__tests__/WidgetConfigPanel.measureDoor-8894.test.tsx`.

## TypeScript Support

This package ships **components, not schema types** — its whole type export
surface is `WidgetConfigPanelProps`, `ConfigPanelTranslate` and the three
`WidgetDataset*` catalog types, none of which describe an authored dashboard.
The authored shape is typed by `@object-ui/types`:

| Import from `@object-ui/types` | What it types |
| --- | --- |
| `DashboardComponentSchema` | the whole `type: 'dashboard'` node — `columns`, `gap`, `widgets`, `header`, `globalFilters`, `dateRange`, `refreshIntervalSeconds`, … |
| `DashboardWidgetSchema` | one entry of `widgets[]` — the spec's `DashboardWidget` keys, plus objectui's own (`component`, `layout`, `options`, …) |
| `DashboardWidgetSlotComponentSchema` | the other kind of `widgets[]` entry — a component node placed directly in the slot, `type` one of the closed component set (`metric-card`); its other keys are that component's own props, which it declares (`title`, `value`, `icon`, `trend`, `trendValue`, and `description` from `BaseSchema`), except the spec's widget `layout`, which places the node |
| `DashboardWidgetLayout` | a widget's `{ x, y, w, h }` grid box |

```typescript
import type {
  DashboardComponentSchema,
  DashboardWidgetSchema,
  DashboardWidgetSlotComponentSchema,
} from '@object-ui/types';

// Dataset-bound KPI — the widget vocabulary (see "Dashboard-level filters").
const revenue: DashboardWidgetSchema = {
  id: 'kpi_revenue',
  type: 'metric',
  title: 'Revenue',
  dataset: 'invoices',
  values: ['count'],
  colorVariant: 'success',
};

// Single-value widget with no query: the number lives under `options`.
const users: DashboardWidgetSchema = {
  id: 'kpi_users',
  type: 'metric',
  title: 'Total Users',
  options: { value: '1,234' },
};

// Component format: a `metric-card` node in the widget's `component` slot, the
// one node the slot takes (objectui#12163). Its keys are that COMPONENT's props,
// not widget keys; it is typed by the same arm as `kpi` below.
const custom: DashboardWidgetSchema = {
  id: 'kpi_custom',
  component: {
    type: 'metric-card',
    title: 'Revenue',
    value: '$123,456',
    trend: 'up',
    trendValue: '+12%',
  },
  layout: { x: 0, y: 0, w: 3, h: 2 },
};

// Component node directly in the slot — the shape every `metric-card` example
// above uses. `type` is one of the closed component set; the other keys are
// the component's own props, which `DashboardWidgetSlotComponentSchema`
// declares.
const kpi: DashboardWidgetSlotComponentSchema = {
  type: 'metric-card',
  title: 'Revenue',
  value: '$123,456',
  trend: 'up',
  trendValue: '+12%',
};

const dashboard: DashboardComponentSchema = {
  type: 'dashboard',
  columns: 3,
  gap: 4,
  widgets: [revenue, users, custom, kpi],
};
```

There is **no per-widget-family schema type**: one `DashboardWidgetSchema`
covers every `type` (`metric`, `bar`, `table`, …) and the family-specific
settings live under `options`. `MetricCard`'s own props — `value`, `trend`,
`trendValue` — are the component's, not the widget's: `DashboardWidgetSchema`
declares none of them, and the component's props interface is not on this
package's export surface either. A `metric-card` node is typed as a COMPONENT
node in both places it can appear: in a widget's `component` slot (`custom`
above) and directly in `widgets[]` (`kpi` above, `DashboardWidgetSlotComponentSchema`
— the component arm of `DashboardComponentSchema['widgets']`, first in the
declaration as in the zod schema's two-arm slot). Either way its keys are
checked against that arm, which declares the card's registered inputs, never
as widget keys:

| Key | Type |
| --- | --- |
| `value` | `string \| number` — required |
| `title` | `string` or an inline per-locale map (`I18nLabel`) |
| `icon` | `string` — a Lucide icon name |
| `trend` | `'up' \| 'down' \| 'neutral'` — drawn with `trendValue` |
| `trendValue` | `string` — drawn with `trend` |
| `description` | `string` or `I18nLabel`, from `BaseSchema` |

`@object-ui/types/zod` judges the same members, so `objectui validate` refuses
a card directly in `widgets[]` whose `trend` is outside the three, or whose
`value` is neither a string nor a number.

### Reading a widget key off `widgets[]`

The widget keys (`colorVariant`, `filter`, `dataset`, …) are declared on the
widget arm, `DashboardWidgetSchema`, which takes them from the spec's
`DashboardWidget` row. The component arm declares none of them, so read
straight off a `widgets[]` entry such a key is a compile error: the union offers
only the keys both arms declare (before objectui#8347 removed `BaseSchema`'s index
signature, the component arm answered it as `any`). This package's own readers take an entry by the slot's
element type, `DashboardComponentSchema['widgets'][number]`. The component arm
is not assignable to `DashboardWidgetSchema`, whose `type` names no component
type, so narrow an entry on `type` first: `metric-card` is the one component
type the slot holds, and any other entry is the widget arm. The compiler checks
the narrowing, not an annotation, and the key gets its declared type:

```typescript
import type { DashboardComponentSchema } from '@object-ui/types';

declare const dashboard: DashboardComponentSchema;

const accents = dashboard.widgets.map((w) =>
  w.type === 'metric-card' ? 'default' : (w.colorVariant ?? 'default'),
);
```

`title` and `layout` are the two widget keys both arms declare. `title` is the
card's heading on the component arm, typed as `MetricCard` reads it, so it reads
as a string or an `I18nLabel` straight off a `widgets[]` entry. The component
arm takes the spec's widget `layout` by reference, because Save Layout writes it
onto every entry of `widgets[]`, a `metric-card` node included (see
[DashboardGridLayout](#dashboardgridlayout--persisting-drag--resize-edits)). So
`layout` reads with the spec's type straight off a `widgets[]` entry, and the
strict authoring face accepts it on a component node. A malformed one (not
four numbers, or a key besides `x`, `y`, `w` and `h`) is refused on either arm.

A widget with no `layout` is auto-placed by the grid. `DashboardWithConfig`'s
width and height sliders write the whole box: the dimension a slider does not
edit, and `x` and `y`, come from where the grid auto-places that widget
(`completeWidgetLayout` and `defaultWidgetPlacement` from `@object-ui/types`,
objectui#11388), so a one-dimension edit never stores a box the spec refuses.

## Customization

All components support Tailwind CSS classes:

```typescript
const schema = {
  type: 'dashboard',
  widgets: [
    {
      type: 'metric-card',
      title: 'Custom Metric',
      value: '100',
      className: 'bg-gradient-to-r from-blue-500 to-purple-600 text-white'
    }
  ]
};
```

## Type-aware list/table widget cells

Dashboard `type: 'table'` widgets bound to an `objectName` automatically
render each cell using the appropriate component for the field's type — the
same cell renderers used by `ObjectGrid` (the list view) and reports
(`@object-ui/plugin-report`).

You don't need to declare `type` on each column. The widget fetches the
object schema once and infers the renderer from the bound field:

| Field type | Cell rendering |
|---|---|
| `select` / `picklist` / `status` | Translated label inside a colored Badge |
| `lookup` / `reference` / `master_detail` / `user` / `owner` | Display name (FK is auto-expanded server-side via `$expand`) |
| `boolean` | Checkbox |
| `email` | `mailto:` link |
| `url` | Clickable link |
| `phone` | Phone link with copy button |
| `date` / `datetime` | Locale-formatted date |
| `currency` | Locale currency (or honour `format: '$0,0'`) |
| `percent` | `0%` / `0.0%` formatted (honour `format`) |
| `password` / `secret` | `••••••`, and the column is flagged `masked` (see below) |

Author overrides always win — pass `type`, `format`, `options`,
`currency`, or your own `cell` function on a column to bypass
auto-detection. An explicit `currency` (ISO 4217 code, e.g. `"EUR"`)
wins over both the symbol inferred from `format` and the tenant default
currency. A lookup column's related-object target always comes from the
object schema's own field definition — there is no column-level override
for it (objectui#6597: measured no authoring story for one).

A masked column (objectui#10657) is one the table withholds: no Ctrl+C / Cmd+C
copy, no tooltip, no CSV export column, no match in the search box, no header
sort, and a width sized from its header rather than its values. The widget
decides it with `isMaskedFieldType()` from `@object-ui/fields`, over the
column's authored `type` and the object's field type, so this is the one place
an author override does not win: `type: 'text'` over a `secret` field keeps the
flag, though the cell then draws the value as text. Rows handed in as `data`
or through `bind` can be drawn before the object schema arrives, and a failed
schema read never delivers one; in that window the widget flags every column,
and a column with no `type` of its own draws as the mask, never as text, until
the schema arrives, or for good when the read failed (objectui#10657). A column
that authors its `type` draws from it meanwhile. The record drawer a row opens
(record drill-down) draws every value as the mask in that window too.

Authored as a node, the object-bound table is `object-data-table`. A bare `table`
is the static component: it takes its rows in `data` and declares neither
`objectName` nor a column `format`.

```jsonc
{
  "type": "object-data-table",
  "objectName": "opportunity",
  "columns": [
    { "accessorKey": "name",        "header": "Opportunity" },
    { "accessorKey": "account",     "header": "Account" },
    { "accessorKey": "amount",      "header": "Amount",      "format": "$0,0" },
    { "accessorKey": "stage",       "header": "Stage" },
    { "accessorKey": "probability", "header": "Probability", "format": "0%" },
    { "accessorKey": "close_date",  "header": "Close Date",  "format": "YYYY-MM-DD" },
    { "accessorKey": "owner",       "header": "Owner" }
  ]
}
```

## DashboardRenderer — design-mode widget reorder

When `DashboardRenderer` is used in design mode (`designMode={true}` plus an
`onWidgetsReorder` callback), widgets become sortable via
[**@dnd-kit**](https://dndkit.com/). Dragging a widget over another inserts
it at that index (insertion semantics, not swap) — the array order *is* the
visual order because widgets render with `gridColumn: span W`. The renderer
calls `onWidgetsReorder(nextWidgets)` with the reordered array; the host (e.g.
`DashboardView`) is responsible for persisting the change via its DataSource.

A 5px pointer-activation distance keeps click-to-select working on the same
widget surface.

## DashboardRenderer — a document the server already translated (`localized`)

A dashboard read from ObjectStack's `/meta` route arrives translated for the
request's locale. The server resolves the packaged translation catalog, and it
keeps a published edit over that catalog: an explicit override beats the
packaged default. Pass `localized={true}` when your document came from such a
read. The renderer then draws these texts as given:

- the widget `title` and `description`;
- its own header `label` and `description`.

An inline per-locale map is still collapsed to the active language. The client
bundle is not consulted again. A second lookup would let the packaged catalog
win back over a published edit (objectui#11295). The console's dashboard page
(`DashboardView`) sets the prop.

Leave it unset for a document the server never translated: an inline block, a
preview or a design surface. The bundle keys under
`dashboards.<name>.widgets.<id>.*` are then that document's one translation
pass, as before. Header-action labels always go through the bundle, because the
server does not translate them.

## DashboardRenderer — the host draws "Refresh All" (`onRefreshStateChange`)

When the renderer holds an `onRefresh` handler it draws a "Refresh All" button,
and the same handler arms the authored `refreshIntervalSeconds` timer. A host
that draws its own page chrome can put that button in its chrome instead: pass
`onRefreshStateChange` alongside `onRefresh`. The renderer then draws no
refresh button of its own, and calls the callback with the state of its one
refresh implementation:

- `refreshing` is true while a run is in flight, manual or timed. Spin the
  button's icon and disable the button on it.
- `handleRefresh` is the run the renderer's own button would call. Wire the
  host's button to it, so a click calls `onRefresh` and shows the indicator.

The callback is called on mount, again each time `refreshing` changes, and with
`null` when there is nothing to draw: no `onRefresh` is wired, or the renderer
unmounted. A `useState` setter is enough as the callback; a new function on
every render is fine too.

The timer stays the renderer's: `onRefresh` still arms it, so the host runs no
timer of its own. The record-count badge (`recordCount`) is not handed over and
stays where the renderer draws it. The console's dashboard page
(`DashboardView`) passes the option and draws the button among its page
header's actions (objectui#12554). A host that leaves it unset gets the
renderer's button, as before.

## DashboardGridLayout — persisting drag / resize edits

`DashboardGridLayout` (a React component you mount directly; its old schema
`type: 'dashboard-grid'` was retired by objectui#10859) has an
inline **"Edit Layout"** mode that lets users drag and resize widgets via
`react-grid-layout`. When the user clicks **Save Layout**, the new grid
coordinates are merged back into `schema.widgets[].layout` and handed off
through the `onSchemaChange` callback.

```tsx
import { DashboardGridLayout } from '@object-ui/plugin-dashboard';
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DashboardComponentSchema } from '@object-ui/types';

// `dashboard` is the node being edited; `adapter` is host-provided.
declare const dashboard: DashboardComponentSchema;
declare const adapter: ObjectStackAdapter;

function DashboardEditor() {
  const client = adapter.getClient();
  return (
    <DashboardGridLayout
      schema={dashboard}
      // ✅ Preferred — write the updated schema through your data adapter.
      onSchemaChange={(next) => {
        // `name` is optional on the schema, and `saveItem` requires it — decide
        // what an unnamed dashboard means to your host instead of writing through.
        if (!next.name) return;
        client.meta.saveItem('dashboard', next.name, next);
      }}
    />
  );
}
```

The guard is not defensive noise: the callback receives a
`DashboardComponentSchema`, whose `name` is optional (`BaseSchema.name` in
`@object-ui/types`), while `client.meta.saveItem(type, name, item)` declares
`name: string`. Passing `next.name` straight through is `TS2345` under `strict`
(`Argument of type 'string | undefined' is not assignable to parameter of type
'string'`), so a copied snippet does not compile — and what the server does with
an absent name has **not** been measured here, which is the other reason this
example declines to send one rather than guessing. A host that already knows
which metadata item the grid is editing should pass that name from its own state
instead of reading it off the node.

If `onSchemaChange` is **not** provided, layout edits stay in component
state and are lost on refresh — a `console.warn` is emitted in development
to flag the missing wiring. The component never writes to `localStorage`
or any other storage on its own: persistence is the parent's concern,
delegated to whatever data adapter you have injected (REST, ObjectQL,
file system, …) per the protocol-agnostic architecture rule.

> ⚠️ **Removed in 3.4:** the legacy `persistLayoutKey` prop and its
> built-in localStorage fallback have been removed. Previously a shared
> default key `'dashboard-layout'` caused layouts to bleed across
> dashboards. If you still want a browser-local cache for a demo, do it
> in the parent inside `onSchemaChange`.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-dashboard)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-dashboard)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).

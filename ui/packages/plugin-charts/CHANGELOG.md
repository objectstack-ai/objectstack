# @object-ui/plugin-charts

## 18.1.0

### Patch Changes

- eadceab: charts: a line or area chart no longer cuts its first or last x-axis label at the chart's edge. recharts draws their categorical x axis as a point scale, which puts the edge categories on the plot edges, so a monthly trend chart drew its newest bucket "2026-10" as "2026". The axis is now inset at both ends by half a `YYYY-MM` label at the tick font. Bar charts, whose band axis already centres every category, and combo charts, which draw a value axis on each side, are unchanged (objectui#13390).
- b317942: A page-level `object-chart` bound to a `dataset` now draws a select dimension in the order its field declares its options, the order the dashboard's dataset widget already uses for the same dataset (objectui#11809). Before, the page block drew the dataset's GROUP BY order (the stored values, alphabetically), so a priority axis read High, Low, Medium, Urgent instead of Low, Medium, High, Urgent (objectui#13403). The rows are charted in declared order, values the options do not declare follow, and the empty bucket comes last; the schema handed to the renderer also carries the `categoryOrder` from `@object-ui/core`'s `buildCategoryOrder`, which a funnel orders its stages by. A dimension whose field declares no options keeps the dataset's order.
- 2c3dc72: charts: a sankey now names every node and colours its flows, and a funnel labels every stage. Sankey nodes were bare bars with no text and every link was one grey, so the chart could not be read without hovering. Each node now carries its name (to its right, or to its left in the last column so it stays on the chart), and each link is stroked in the palette colour of the category it flows into. Every link leaves the same root node, so colouring by source would paint them all one colour again. A funnel labelled each stage to the right of its segment, past the plot's edge, so only the narrowest stage's label showed. Labels now sit centred inside their segments, in foreground text with a background halo so a name wider than the narrowest segment stays legible. The sankey's "Showing N of M rows" footnote now comes from the locale packs under the new count family `chart.sankeyOmittedRows`, translated in all ten packs. The English text is unchanged (objectui#13404).
- 56b65c0: A single-series bar chart draws every bar in its series colour (objectstack#25330).
  
  A bar or horizontal-bar chart with one measure used to paint each bar a different palette colour, so the colour named nothing: the System Overview "Events by User" board drew each user in its own hue. A bar's colour now names its series. A dimension's semantic option colour (a select field's `options[].color`, such as health green/red/yellow) still paints its own bar; a category without one takes the series colour instead of a palette slot. Pie and donut slices keep one colour per category, and a chart with two or more series keeps one colour per series.
- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [ec627ab]
- Updated dependencies [0f4adc3]
- Updated dependencies [fa31856]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [d9aff15]
- Updated dependencies [4eeb174]
- Updated dependencies [afcf654]
- Updated dependencies [2c3dc72]
- Updated dependencies [2958f17]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [2c4e5f5]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [c8f8b10]
- Updated dependencies [ad74e98]
  - @object-ui/types@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/i18n@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- fd060f0: The `object-chart` and `view:chart` registrations no longer declare `objectName`
  required, so the page compile accepts a node whose `dataSource` binding names the
  object, and a chart that names its object in neither place shows a hint instead
  of an empty frame (objectui#11605).
  
  `object-chart` has no spec row. The binding doc says a node bound by
  `dataSource.object` needs no `objectName` of its own, and the renderer agrees:
  `dataSource.object` lands on `objectName` before the chart reads the node. The
  registrations still declared `required: true`, and the page compile reads them,
  so a bound chart with no `objectName` of its own was refused with
  `missing-required-prop` and the save failed.
  
  **Clause-②: yes (widening)** — an `object-chart` (or `view:chart`) node that
  names its object through `dataSource.object` and sets no `objectName` now
  compiles and saves. A node that names its object in neither place also compiles
  now, and the chart shows "No object named: set objectName or dataSource.object."
  where it used to draw an empty frame with no message. A chart with inline
  `data`, a `dataset` or a `bind` path shows no hint and renders as before. The
  published `objectName` inputs now carry a description that says the binding can
  supply them.
- 96fcf30: **Clause-②: yes (an export widens, and an accept set narrows)**
  
  A chart's value axis over a count now draws whole-number ticks (objectui#11681). Dashboard charts over a `count` measure ("Tasks by Status", "Projects by Health", "Invoices by Month") used to read 0.5, 0.8, 1.5 or 2.3 on their value axis. The dataset answer states each measure column's aggregate (`fields[].aggregate`, from `@objectstack/spec` 18). The chart now carries it to the axis, and an axis whose series all plot `count` or `count_distinct` sets `allowDecimals: false`. Any other measure on the axis keeps the previous ticks, so a sum over currency keeps its decimals. Every cartesian value axis is covered, including the horizontal-bar value axis that runs across the plot. Each side of a dual-axis chart decides for itself.
  
  - `@object-ui/core` (widens): `buildChartSeries` copies a result field's `aggregate` onto the series it derives. `ChartResultField` and `ChartSeriesBinding` gain an optional `aggregate`. `INTEGER_AGGREGATES` and `isIntegerAggregate` are new exports.
  - `@object-ui/plugin-dashboard`: the dataset widget keeps the aggregate on the series it builds. That includes the comparison overlay and the series a dimensionless chart transposes, which states an aggregate only when every measure shares it.
  - `@object-ui/plugin-charts` (widens): the `dataKey` arm of `ChartRendererProps.schema.series` and `NormalizedSeries` (carried by the exported `NormalizedChartSchema`) gain an optional `aggregate`, read by `normalizeSeries`. The accept set only widens: nothing that compiled before is refused. The member is renderer-internal.
  - `@object-ui/types` (narrows): `aggregate` on a chart series is refused by name. FROM: `ChartDataSeriesSchema` (and so `ChartSchema.series[]`) accepted `{ name, aggregate: 'count' }` and stripped the key. TO: it refuses that series with an `invalid_type` issue at `aggregate`, and `ChartDataSeries.aggregate` is typed `?: never`. The key is internal: declare the aggregate on the dataset measure instead.

### Patch Changes

- 82500a7: Rotated x-axis labels fit inside the chart, and the dashboard inspector's Layout fields are readable (objectui#11796).
  
  - **Rotated category labels are no longer cut off.** When a bar, line or area chart turns its x-axis labels to fit them, each label hangs its start away from the plot. The axis used to reserve a fixed 60px for them, which counted the text width alone, so the longest labels ran past it and the chart cut off their first letters ("acklog" for Backlog, "ogress" for In Progress on a dashboard bar chart). The axis now reserves the room its longest drawn label needs at the rotation angle: more for long labels, less for short ones, with a wide glyph (Chinese, Japanese, Korean) counted a full em. Every rotated label is now shortened with an ellipsis past 12 characters, also on axes with more than five categories, where a long label used to be clipped mid-word instead. The full name stays on the bar's tooltip. Charts whose labels do not rotate keep the axis height they had.
  - **The dashboard inspector stacks its fields.** Studio's dashboard inspector is a narrow side panel, and the dashboard form's Layout section put Columns, Gap and Refresh Interval Seconds in three columns there: a two-digit value showed one digit and the labels wrapped onto several lines. The inspector now renders every section of the form in one column, in the declared field order. Other forms keep the column layout their sections declare.
  
  Nothing is added to either package entry: no export, prop, type member or language-pack key.
- d03b022: `ObjectChart` decides its missing-category-axis refusal before it fetches, so a chart that refuses reads nothing (objectui#12061).
  
  The refusal (`chart-missing-category-axis`, objectui#8168) is drawn when an object-bound chart declares no category by any spelling (`aggregate.groupBy`, `xAxisKey`, `xAxis.field`). It was a render-time return only: the fetch ran anyway, issuing the object's `find` with no `$top` (or `aggregate` with no `groupBy`), and the rows were then discarded. Since objectui#6152 round 15, every chart list view that names no `dataset` composes that node, so each render of such a view paid for the read.
  
  Now the refusal and the fetch read one value. A refused chart issues no `find`, no `aggregate` and no comparison query, and a data-invalidation event for its object does not start one. The refusal's code, `role="alert"` and wording are unchanged, and it is still the first paint, with no loading skeleton before it. A chart with a category fetches exactly as before. A chart that is refused at mount and later given a category (for example, a spec `xAxis` added in a designer preview) fetches at that point.
- 1e6d83b: Data-bound blocks title their "data source could not be resolved" panel in the page's language (objectui#12920, the family of objectui#12910). The panel shows when a block's `dataSource.view` names a view its object does not have. Each block's title now reads `@object-ui/i18n` through `useObjectTranslation`, with the `en` pack's value as the inline default, so a page with no `I18nProvider` draws the same English it drew before.
  
  - **Plugin blocks.** `object-calendar`, `object-chart`, `object-metric`, `object-pivot`, `detail-view`, `record:related_list`, `object-form`, `embeddable-form`, `object-master-detail-form`, `record:line_items`, `object-gantt`, `object-grid`, `object-kanban`, `list-view`, `object-map` and `object-timeline` read one `element.KIND.sourceUnresolved` key per block kind. `object-metric` reads `element.number.sourceUnresolved`, the key `element:number` already reads for the same sentence. The three forms share `element.form.sourceUnresolved`. `record:related_list`'s panel for a failed `parentDataSource` read reads `element.relatedList.parentUnreadable` ("This related list’s parent record could not be read").
  - **`@object-ui/react` panel defaults.** `ElementDataSourceErrorPanel` with no `title` reads `element.component.sourceUnresolved`, and `NoDataSourcePanel` with no `title` reads `element.component.noDataSource`. A passed `title` still wins, an empty string included. Props and markup do not change.
  
  Clause-②: yes
  
  The new keys in `@object-ui/i18n` widen its exported `TranslationKeys`. No prop, input or export of these packages changes.
- 988aa9f: Charts and dataset widgets read their object's metadata through the data source, so the widgets of one dashboard ask for one object's metadata once (objectui#13039).
  
  The chart's category colours and dimension labels come from the bound object's field options. It read them with its own request to `/api/v1/meta/object/NAME`, outside the data source's metadata cache, so every chart over one object sent one more request for the same document. The chart now reads it through the data source's `getObjectSchema` when one is in scope: the read that its own group-by labels, the metric tile and the data table already use, and that the ObjectStack adapter joins while it is in flight. With no data source, or one that cannot answer `getObjectSchema`, the chart reads the document directly as before.
  
  The dataset label hook in `@object-ui/react` (`useDatasetDimensionMeta`, behind `useDatasetDimensionLabels`) made the same per-widget request, one for every non-metric dataset widget on a dashboard and for the dataset report block. It now reads through the `SchemaRendererProvider`'s data source in the same way when that source answers `getObjectSchema`, and reads the document directly otherwise.
  
  Colours, labels and dotted dimension paths resolve as they did. Nothing is added to the package entry.
- 5115c1f: Advanced chart axis tick labels now use the theme's muted foreground instead of recharts' default `#666`, so they stay readable on dark cards (objectui#13129). Every axis the advanced chart draws, cartesian and polar, shares one tick style.
- 9a4ddb2: A category x axis rotates its labels, and cuts them at 12 characters, only when the measured band cannot hold them (objectui#13241). A full-width bar chart now draws a name such as "Needs Analysis" whole and horizontal instead of "Needs Analy…"; a narrow widget whose labels do not fit keeps rotating and cutting them, with the full name on the bar's tooltip. Until the chart's width is measured, the length rule applies as before.
- 0253416: feat(plugin-list)!: a chart list view binds only an ADR-0021 `dataset`; the legacy inline chart axes and their `name` / `value` floors are retired on every route (objectui#6152, round 15)
  
  Clause-②: no
  
  **Changed (breaking for a stored chart view that names no `dataset`).** Every door refuses the
  pre-ADR-0021 chart axes on a list view: `@objectstack/spec`'s chart block is a strict object of
  `chartType`, `dataset`, `dimensions` and `values`, and `@object-ui/types`, `objectui validate` and the
  platform's view write door judge by it, top-level and in the `options` bag. The renderers kept
  reading the axes, so a chart view stored before the doors closed still drew an inline aggregate, and
  a chart view that declared nothing was drawn from the invented fields `name` and `value`. They no
  longer do, on every route that did: `ListView`'s chart branch and its capability gate, the object
  page's chart view (`@object-ui/app-shell`) and `ObjectView`'s own views (`@object-ui/plugin-view`).
  
  | stored chart block (either nesting) | what renders now | write instead |
  | :--- | :--- | :--- |
  | `xAxisField` / `categoryField`, `yAxisFields` / `valueField`, `aggregation` (and, on the object page, `series` and `filter` on the block) | the chart's refusal: "Chart category axis required", in place of the chart; a view of another type no longer offers Chart in its view switcher | `chart: { dataset, values, dimensions }`, naming an ADR-0021 dataset of the object |
  | no binding at all on a view whose `viewType` is `chart` | the same refusal, where a chart grouped by `name` and counting `value` used to draw | the same dataset block |
  
  A dataset-bound chart renders as before. The refusal is `ObjectChart`'s own screen for an object-bound
  chart that names no category axis (objectui#8168); its remedy names that component's keys, not the
  list view's dataset block.
  
  **Not measured: production.** The census before this change (objectui#6152 round 13) found no writer
  and no stored row carrying these axes in any repository corpus a seat can reach, with positive
  controls; this repository's create-view dialog writes the dataset block. Stored view and page
  metadata in deployments was not measured. A row that carries the axes renders the refusal until it is
  re-saved with a dataset block.
  
  - `@object-ui/plugin-view`: an `ObjectView` kanban view no longer reads `kanban.conditionalFormatting`.
    The list view's kanban block does not declare it, and every door that judges the block refuses it
    by name; the view's own `conditionalFormatting` is the one place it is read. The development-only
    flat-key warning no longer names `dateField`, `groupBy`, `groupField`, `imageField` or
    `subtitleField`, which it told an author to move into a block that refuses them.
  - `@object-ui/app-shell`: the object page's development-only flat-key warning no longer names the
    twelve keys every per-kind block refuses (among them `groupField`, `imageField`, `cardFields`,
    `xAxisField`, `yAxisFields`, `aggregation` and `series`).
  - `@object-ui/plugin-charts`, `@object-ui/types`: comments only, where they said the list-view relays
    still read the legacy axes.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [c096f03]
- Updated dependencies [d92b2a1]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [e8c0b96]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [7b17705]
- Updated dependencies [fc3c2cc]
- Updated dependencies [f9f4a62]
- Updated dependencies [848ba0e]
- Updated dependencies [57d82cb]
- Updated dependencies [de96f3d]
- Updated dependencies [9ca3cac]
- Updated dependencies [c910630]
- Updated dependencies [ce464d9]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [7a2c60b]
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [e06365c]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [cef0eee]
- Updated dependencies [7ebff39]
- Updated dependencies [054fd84]
- Updated dependencies [5275d1f]
- Updated dependencies [7241a81]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [f1781be]
- Updated dependencies [fbad078]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
- Updated dependencies [2312bd9]
- Updated dependencies [6d5eb34]
- Updated dependencies [c5406c2]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2571a3e]
- Updated dependencies [2a48bd4]
- Updated dependencies [8a55f0c]
- Updated dependencies [c7b30bd]
- Updated dependencies [20c6d35]
- Updated dependencies [417e245]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [ce991bd]
- Updated dependencies [3c0f806]
- Updated dependencies [1071393]
- Updated dependencies [5f75cfa]
- Updated dependencies [6757a93]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [54159d3]
- Updated dependencies [fa778e6]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [92f979d]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [7578323]
- Updated dependencies [38bb373]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [51c661e]
- Updated dependencies [7af0ab3]
- Updated dependencies [b434f5f]
- Updated dependencies [9f282ef]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [cea429b]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [068a540]
- Updated dependencies [ca45c6d]
- Updated dependencies [093d55b]
- Updated dependencies [b64fda3]
- Updated dependencies [a8051d6]
- Updated dependencies [72594f2]
- Updated dependencies [524136e]
- Updated dependencies [2b06a91]
- Updated dependencies [6f3299f]
- Updated dependencies [065a1cf]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [37db09f]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [caac3b2]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [a8e5b73]
- Updated dependencies [d9d9d98]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [8ed7e5a]
- Updated dependencies [6c4d00d]
- Updated dependencies [db8ce2f]
- Updated dependencies [726d8c9]
- Updated dependencies [f0e760a]
- Updated dependencies [a5bb7ac]
- Updated dependencies [f78efdd]
- Updated dependencies [8a8bcf3]
- Updated dependencies [f74638c]
- Updated dependencies [ef71a09]
- Updated dependencies [8614705]
- Updated dependencies [619e3f7]
- Updated dependencies [ca7a4c3]
- Updated dependencies [c9e6742]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [611566b]
- Updated dependencies [efa9cb4]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [9d857c9]
- Updated dependencies [670ea10]
- Updated dependencies [ff215d9]
- Updated dependencies [71243db]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [c7462e7]
- Updated dependencies [36e2f7b]
- Updated dependencies [ac59073]
- Updated dependencies [44cb469]
- Updated dependencies [e058d76]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [8d80845]
- Updated dependencies [69a408f]
- Updated dependencies [d2b21a1]
- Updated dependencies [5ff64ef]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [bb6c38c]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [025130c]
- Updated dependencies [76f91f8]
- Updated dependencies [ea34d9b]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [cb80001]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [47508f3]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [6f877f1]
- Updated dependencies [988aa9f]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [2d8a8b7]
- Updated dependencies [cbac9d7]
- Updated dependencies [9eb1479]
- Updated dependencies [74e37aa]
- Updated dependencies [961b69f]
- Updated dependencies [52907d7]
- Updated dependencies [f466b0a]
- Updated dependencies [673a71c]
- Updated dependencies [616df65]
- Updated dependencies [58798ec]
- Updated dependencies [8803ca5]
- Updated dependencies [e70c21d]
- Updated dependencies [4b92c5a]
- Updated dependencies [06be396]
- Updated dependencies [3650d94]
- Updated dependencies [7c05f21]
- Updated dependencies [8cd4db4]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [3c3115e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [f962cdc]
- Updated dependencies [b403bb3]
- Updated dependencies [8a25fee]
- Updated dependencies [4016370]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/i18n@18.0.0
  - @object-ui/react@18.0.0

## 17.7.0

### Minor Changes

- ad1785c: refactor(plugin-charts)!: retire the `pie-chart`, `donut-chart` and `radar-chart` node type keys; the families are `chart` + `chartType` (objectui#10859, batch 8 phase 2c)
  
  **BREAKING (authoring):** the plugin no longer registers `pie-chart`, `donut-chart` or `radar-chart` (and with them `plugin-charts:pie-chart`, `plugin-charts:donut-chart` and `plugin-charts:radar-chart`), and their `CHART_TYPE_KEYWORD_FAMILIES` rows are gone. `objectui validate` already refused each at `type`. Their one producer, this package's `examples/chart-examples.ts`, now authors `{ type: 'chart', chartType: … }`, which `objectui validate` accepts on both faces. A node still authored with one of the three types now renders the "Unknown component type" panel.
  
  Migration:
  
  - `{ "type": "pie-chart", … }` → `{ "type": "chart", "chartType": "pie", … }`, with the same keys;
  - `{ "type": "donut-chart", … }` → `{ "type": "chart", "chartType": "donut", … }`, with the same keys;
  - `{ "type": "radar-chart", … }` → `{ "type": "chart", "chartType": "radar", … }`, with the same keys.
  
  A legacy report section whose `chart.type` says one of the three now reaches the generic `chart` renderer with no family derived from that type; give it the matching `chartType`. `chart:bar` is the one family keyword this package still registers.
  
  **Clause-②: yes** — registrations leave the runtime (narrowing), released as `minor` with this banner.
- 37140f4: refactor(plugin-charts)!: retire the `scatter-chart` node type key; scatter is `chart` + `chartType: 'scatter'` (objectui#10859, batch 8 phase 2b)
  
  **BREAKING (authoring):** the plugin no longer registers `scatter-chart` (and with it `plugin-charts:scatter-chart`), a second key on the generic `ChartRenderer` whose family came from its `CHART_TYPE_KEYWORD_FAMILIES` row. That row is gone too. `objectui validate` refused a `scatter-chart` node at `type`, and nothing in this repository, its examples or objectstack authored it. A node authored `type: "scatter-chart"` now renders the "Unknown component type" panel.
  
  Migration:
  
  - `{ "type": "scatter-chart", … }` → `{ "type": "chart", "chartType": "scatter", … }`, with the same keys.
  
  A legacy report section whose `chart.type` says `scatter-chart` now reaches the generic `chart` renderer with no family derived from that type; give it `chartType: "scatter"`.
  
  `pie-chart`, `donut-chart` and `radar-chart` were ruled the same way but stay registered: this package's `examples/chart-examples.ts` still authors them, so they wait on their own decision.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` with this banner.
  
  ⚠️ **Dated note, 2026-10-02 — the three chart aliases are retired too — objectui#10859.**
  The decision this entry said `pie-chart`, `donut-chart` and `radar-chart` wait on is made (the seat's fork ruling on objectui#10859): later in this same release, phase 2c moved `examples/chart-examples.ts` to `{ type: 'chart', chartType: 'pie' | 'donut' | 'radar' }` and then unregistered all three keys, with their `plugin-charts:` twins and `CHART_TYPE_KEYWORD_FAMILIES` rows. The rest of this entry is kept as the reading of this change.
- 19f484f: `FormulaFieldMetadata` declares `@objectstack/spec`'s `expression` in place of `formula`, and three readers of a lookup's display pointer read the spec's `displayField` alone (objectui#11070, round 6). Both retired spellings go at once, with no alias.
  
  - **Types.** `FormulaFieldMetadata.formula` is removed. `FormulaFieldMetadata.expression` is `FieldSchema`'s `expression` by reference: a CEL source string, or the spec's `{ dialect, source, … }` envelope. Nothing in ObjectUI read the removed member through the type. `FieldSchema` refuses `formula` by name on every field type, with a rename hint to `expression`.
  - **Form payloads.** `sanitizeFormData` (`@object-ui/plugin-form`) no longer treats a `formula` key as a "computed" flag. Every `type: 'formula'` field is still dropped from the payload by its type, as before. Only a field of some other type that carries `formula` changes: its value is now sent like any writable field's. The spec refuses such a definition at publish, so a served one cannot carry it.
  - **Display pointer.** `deriveColumns` and `hydrateColumns` (`@object-ui/plugin-form`, the master-detail grid columns), `ObjectChart`'s group-by labels (`@object-ui/plugin-charts`) and the action-param resolver (`@object-ui/app-shell`) read `displayField`, then `reference_field`. None of them reads `display_field` any more.
  - **A fix for spec-spelled lookups in master-detail grids.** `deriveColumns` and `hydrateColumns` read `display_field || reference_field` before, with no `displayField` leg. A lookup that declared only `displayField`, which is the spec's spelling, got no display pointer on its grid column. It now gets one.
  
  A definition served through `ObjectStackAdapter.getObjectSchema` or `MetadataProvider` loses nothing: the ingestion pass (objectui#7650) stamps a stored `display_field` onto `displayField` before any of these readers sees it. Measured with a lookup carrying `display_field: 'title'` served through `ObjectStackAdapter.getObjectSchema`: the master-detail column (`deriveColumns` and `hydrateColumns`), the chart's axis label and the action param all resolve the `title` column before and after this change.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  TypeScript that writes `formula` on a `FormulaFieldMetadata` no longer compiles (an excess-property error naming the key). Rename it to `expression` and write the formula in CEL against the record, for example `record.quantity * record.unit_price`.
  
  At runtime, a lookup whose display pointer is spelled only `display_field` loses it wherever the ingestion pass does not run first. Measured before and after this change, on a lookup with `display_field: 'title'` handed to the readers directly:
  
  - **`deriveColumns` / `hydrateColumns` with a `childSchema` that did not come through the ingestion pass** (an external caller, or a master-detail form whose `DataSource` is not `ObjectStackAdapter`): the column's `displayField` was `title`. It is now absent.
  - **`ObjectChart` on a `DataSource` other than `ObjectStackAdapter`**, grouped by that lookup: the axis label came from the `title` column. It now comes from the `name` column, the generic fallback.
  - **The action-param resolver, when a host passes its own unfolded `objects`** (for example through `RecordDetailView`'s `objects` prop): the lookup param's `displayField` was `title`. It is now absent.
  
  The same lookups spelled `displayField` resolve the `title` column in all three after this change. Before it, the chart and the action param already did, and the master-detail columns did not (the fix above).
  
  **Fix:** spell the pointer `displayField`, or serve the definition through `ObjectStackAdapter`.
- 06634af: fix(plugin-charts): an `object-chart` whose `specType` is a single-value or tabular spec family draws its routed form, not a silent bar chart; the renderer has no default family (objectui#11520)
  
  **What an accepted document draws changes.** `specType` is the react tier's chart family: the react-page wrapper parks `<ObjectChart type="gauge">` there, because `type` is the node's discriminator. Both faces declare it as the spec's whole `ChartTypeSchema`, so an `object-chart` with `specType` set to `gauge`, `solid-gauge`, `metric`, `kpi`, `bullet`, `table` or `pivot` parsed on both faces, and drew a **bar chart**, with no note. The same families on `chartType` already drew the forms below.
  
  - **`gauge`, `solid-gauge`, `metric`, `kpi`, `bullet` on `specType`** now draw the number card: one row's number, the form the same family draws on `chartType`.
  - **`table`, `pivot` on `specType`** now draw the tabular notice, which names the data-table and pivot components.
  - **An off-spec `specType`** (both faces refuse it) draws the unknown-type notice, which names the value.
  - **A chart that names no family at all** (both faces refuse it: `object-chart` needs `chartType` or `specType`, and `chart` needs `chartType`) draws a notice reading "This chart names no chart type — nothing was drawn." It used to draw a bar chart. A caller that means a bar names `bar`.
  
  Every family this block draws as a chart draws exactly what it drew before, on both keys.
  
  How: `normalizeChartSchema` used to keep only the families this package draws as a chart, and `AdvancedChartImpl` drew a missing family as `'bar'`. The normalizer now hands the named family on as named, so `specType` reaches the same family dispatch `chartType` reaches, and the `'bar'` default is removed (with its four copies in the refusal guards).
  
  ⚠️ **Type.** `NormalizedChartSchema['chartType']`, exported from this package, widens from the thirteen drawn families to the declared chart families (`DeclaredChartFamily` in the emitted declarations; not a new entry export): `object-chart`'s `chartType` union together with its `specType` (the spec's `ChartType`), both read off `ObjectChartSchema` in `@object-ui/types` by reference. It is now the family the schema names, drawn or not, and a misspelled family still fails to compile. Shipped as `minor`, not `major` (objectui never declares `major`); a consumer that reads it exhaustively needs a branch for each single-value and tabular family, which this package draws no chart of.
- 045d20b: Relationship-target readers resolve a lookup's target from `reference` alone,
  dropping the `reference_to` fallback arm (objectui#6837, half 2).
  
  Maintainer ruling, 2026-08-31, 原文照录: 「objectui不是前端的项目吗?后端的元数据只要
  对,前端按协议执行就行了呀」. Protocol normalization belongs on the SERVER; the front
  end just executes the protocol. objectstack#13847 landed the server half — a
  `field-reference-to-alias` conversion rewrites stored `reference_to` to
  `reference` on the serve path and in `os migrate meta`.
  
  `reference` is the only target spelling `@objectstack/spec`'s `FieldSchema`
  declares. Measured on the installed 17.2.0: it refuses `reference_to`,
  `referenceTo` and `target` with `unrecognized_keys`, each carrying its own
  "Did you mean -> `reference`?" rename, while a nonsense key gets the same
  refusal with NO rename hint and `reference` parses clean.
  
  ## ⚠️ BREAKING for a hand-written schema that spells `reference_to` — read this
  
  **This is a behaviour change for BYO consumers, and it is being stated rather
  than shipped silently.** ObjectUI is usable without an ObjectStack backend
  (`examples/byo-backend-console`), and a hand-written TypeScript schema passes
  through no zod door, so nothing rejects the legacy spelling at authoring time.
  
  **The break surface is narrower than "all BYO consumers", and this is the
  measurement rather than a blanket claim.** Two ingestion choke points stamp both
  snake_case keys from whichever spelling arrived — `MetadataProvider`'s type
  cache for metadata type `object`, and `ObjectStackAdapter.getObjectSchema`. Any
  def that passed either one already carries `reference` and is **completely
  unaffected**. What is affected is exactly:
  
  - **A `DataSource` implementation other than `ObjectStackAdapter`.**
    `getObjectSchema` is a required member of the published `DataSource`
    interface, and the readers call it on the generic `dataSource` (through
    `useSettledSchema` and directly), so a host adapter's object schema reaches
    them raw. Every in-repo example of one is on this path:
    `ApiDataSource`, `ValueDataSource`, `packages/types/examples/rest-data-source.ts`,
    `examples/byo-backend-console/src/mockDataSource.ts`,
    `packages/runner/src/lib/mockDataSource.ts`,
    `apps/site/app/components/galleryDataSource.ts`,
    `apps/console/src/sdui-workbench-preview.tsx`,
    `packages/plugin-grid/demo/bulk-actions.tsx`.
  
  **Measured on this tree, none of those eight emits a relationship target at all** —
  `reference_to` and `reference` are both zero in each, and
  `examples/byo-backend-console` carries no lookup or master_detail field
  anywhere (its only `reference` hits are a vite triple-slash directive and a
  tsconfig `references` array). The single in-repo producer that WAS on this
  surface, `packages/plugin-gantt/demo/main.tsx`, is fixed here at the producer.
  
  ⇒ **If you author object metadata by hand and spell a lookup's target
  `reference_to`, rename that key to `reference`.** Symptom if you do not: the
  target silently fails to resolve, and the affected surface degrades rather than
  erroring — a related list is not derived, a gantt quick filter falls back to the
  distinct values in the loaded rows instead of the referenced object's full
  domain, a tree stops auto-detecting its parent pointer, a lookup cell shows a
  raw id, a chart's group-by labels stay unresolved.
  
  The ingestion choke point now emits a **dev-mode warning** when a def arrives
  carrying only `reference_to` or `referenceTo` and no `reference`. It names the
  object, the field and the offending key, and points at this ruling. Stamping is
  deliberately unchanged, so nothing that worked stops working. It is memoised
  once per **(object name, field name, spelling, target value)** — every segment
  of that key is pinned, in both directions, in
  `reference-keys.legacyWarning-6837.test.ts`.
  
  ⛔ **This warning does NOT cover the break described above, and it is worth being
  exact about that rather than letting it read as mitigation.** It lives in
  `normalizeFieldReferenceKeys`, reachable only through
  `normalizeSchemaReferenceKeys`, which has exactly two production call sites —
  `MetadataProvider` (metadata type `object`) and
  `ObjectStackAdapter.getObjectSchema`. Both of those also STAMP the def, so the
  warning fires precisely where the def still resolves and nothing is broken. A
  hand-written schema served through any OTHER `DataSource` — the break surface —
  reaches a reader raw: it never passes through this code and produces **no
  warning at all**. On that path the failure is exactly as silent as before.
  A reader-side or shared-resolver diagnostic, which would cover it, remains open
  on objectui#6837.
  
  ⚠️ **Dated note, 2026-09-29 — the call-site count above has since moved —
  objectui#7650.** "exactly two production call sites" above held when this change landed
  (`045d20ba8`). Later in this same release objectui#7650 (PR objectui#8868) added a call
  on `MetadataProvider`'s by-name object-schema serve path. Re-measured for objectui#10979
  on `main` at `2eaf5be27`, `normalizeSchemaReferenceKeys` had three production call sites:
  two in `MetadataProvider`, on its list path and on its by-name path, and one in
  `ObjectStackAdapter.getObjectSchema`.
  `.changeset/7650-metadata-item-reference-canonicalisation.md` (PR objectui#8868) states
  what ships; the text above is kept as the reading of this change.
  
  ## What did NOT change
  
  **Every key these readers EMIT is byte-identical**, and that was verified
  mechanically over the whole diff rather than asserted. Eleven of the sixteen
  sites write a target onto a bag whose own contract spells it `reference_to` (or
  camelCase `referenceTo`): the six whose read and write share a line —
  `RecordDetailDrawer`, `RelatedList`, `buildDefaultPageSchema`, `ListView`,
  `FilterConditionField`, `resolveActionParams` — plus five more that read on one
  line and emit on another, and so are just as much emitters: `RecordDetailView`,
  `RecordMetaFooter`, `ObjectGallery`, `fieldEnrichment` (all `reference_to`) and
  `UserFilters` (`referenceTo`). Only the right-hand read narrowed anywhere; the
  emitted key is what its target contract declares, and renaming it would be a
  separate change.
  
  **Three readers were deliberately left alone.** `LookupCellRenderer`
  (`fields/src/index.tsx`), `LookupField` and `UserField` read `FieldMetadata` —
  ObjectUI's OWN contract, whose `LookupFieldMetadata` declares `reference_to` and
  never declares `reference`. They are fed by the emitters above and by published
  example schemas (`examples/schema-catalog/src/schemas/fields-lookup/*.json`), so
  narrowing them would break in-repo producers, and `plugin-grid`'s
  `relationalMetaCopySet.derivation.test.ts` re-derives its read set from exactly
  those three sources — where `reference_to` is recorded with verdict
  `adapter-stamped`. `DetailViewFieldSchema` is likewise untouched.
  
  ⚠️ **Dated note, 2026-09-30 — the stamp, the three readers and the emitted key have since moved — objectui#11070.** Later in this same release objectui#11070 (round 4) retired `reference_to` inside ObjectUI as well. `normalizeFieldReferenceKeys` now FOLDS a legacy `reference_to` / `referenceTo` onto `reference` and no longer stamps `reference_to`, so "Stamping is deliberately unchanged" and "stamp both snake_case keys" above no longer describe what ships. `LookupCellRenderer`, `LookupField` and `UserField` read `reference` only; `LookupFieldMetadata`, `MasterDetailFieldMetadata` and `DetailViewField` (with `DetailViewFieldSchema`) declare `reference`; and the emitters listed under "What did NOT change" write `reference`. A hand-written schema served through a `DataSource` other than `ObjectStackAdapter` that spells only `reference_to` therefore also loses the lookup picker's target and the read cell's name. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
- 0349555: A sankey with no positive flow says so, instead of rendering an empty div
  (objectui#7140).
  
  `AdvancedChartImpl`'s sankey arm keeps only strictly positive measures, so a
  chart handed **real rows** whose measure is all `0`, all `null`, all negative,
  or unparseable built no links and returned a bare `<div>`. Measured in Chromium
  against a populated control: the control drew 1 `<svg>` / 7 `<path>` /
  26 descendants; each of those four tiles rendered `descendantCount: 1`,
  `svgCount: 0`, `textContent: ''`, and their screenshots hashed identical to one
  another. No marks, no text, no `role` — a tile indistinguishable from a widget
  that had crashed, which is the one distinction the file's other refusals exist
  to make.
  
  It now renders through the `ChartRefusal` shell those refusals already use —
  same box, same `role="status"`, and a new `data-chart-error="no-positive-flow"`
  — reading *"This chart has no flow to draw: no row's `<measure>` is above
  zero."*
  
  Two boundaries are deliberate and pinned:
  
  - **No rows at all is untouched.** That is the empty-result question, answered
    upstream in `ObjectChart` where the query outcome is known; a sentence about
    what the rows contain would be false about a dataset with no rows in it.
  - **One positive row among zeros still draws.** The refusal fires on an empty
    link set, never on a thin one.
  
  One code and one sentence for three causes (a genuinely all-zero flow, values a
  flow cannot represent because they are negative, and measures `Number(…) || 0`
  folds to zero): naming any single cause would be false for the other two, so
  the copy names the predicate the filter actually applies, which is true for all
  three. No recovery is promised. Every other chart family is byte-identical —
  eight of the twelve tiles in the browser sweep hashed unchanged.
- 0dc2c93: `compareTo` on a `scatter` chart is no longer supported — scatter joins pie / donut /
  funnel on the list of chart families that ignore it (objectui#7402, maintainer ruling
  2026-09-03).
  
  **This removes a published capability, deliberately.** Until now a `chartType: 'scatter'`
  chart (and the dashboard widget types `scatter` and `bubble`, which both render as one)
  with `compareTo` set synthesised a muted "previous period" overlay series. It drew the
  wrong picture: a scatter binds ONE measure, and the renderer reads y through the single
  `YAxis dataKey={series[0].dataKey}`, so the overlay was plotted on the PRIMARY series' y
  — "previous period" painted exactly on top of "current" (objectui#7194).
  
  Enforce-or-remove: rather than keep drawing that, the capability is removed until it can
  be drawn honestly. Drawing a real second measure on a scatter needs the multi-measure
  projection recorded as option A of objectui#7194, which is not built (zero authored
  callers). **If and when that projection lands, `compareTo` on a scatter returns with
  it** — it is the same missing mechanism, one payment.
  
  What changes for authors:
  
  - A `compareTo` on a scatter is now IGNORED rather than drawn. The primary series still
    renders exactly as before — nothing refuses, nothing goes blank, and no comparison
    query is issued on the inline chart path.
  - No `<measure>__comparison` (inline chart) / `<measure>__compare` (dashboard) series is
    appended for a scatter, so a compare-to scatter document also never reaches the
    two-or-more-series scatter refusal being added under objectui#7194.
  - Charts that keep the overlay: line, area, bar, horizontal-bar, combo. Charts that
    ignore `compareTo`: pie, donut, funnel and — as of this change — scatter (and the
    `bubble` widget type that renders as a scatter).
  
  Reachability at the time of the change: **0** authored scatter/bubble instances in-repo
  across both spellings (control `"type": "bar"` fires at 5 example files); incidence in
  deployed tenant metadata is not measurable from this repo.
- 01c27c4: Fix: a chart series' `type` override (`ChartDataSeries.type`, objectui#6121) is now
  honoured when the series array is written in the internal `dataKey` binding, not only
  the `name` binding — the same sentence #2945 shipped for the other
  dialect.
  
  `ChartRenderer`'s `isInternalShaped` fast path (introduced by #2945 to fix a different
  bug — a `name`-shaped `series` shadowing the normalized `dataKey`-shaped one) took the
  raw authored array untouched whenever every entry already carried `dataKey`, bypassing
  `normalizeSeries` — the only place `type` is translated to the renderer-internal
  `chartType`. So an author who wrote `series: [{ dataKey: 'revenue' }, { dataKey:
  'margin', type: 'line' }]` — both keys independently valid on `ChartDataSeriesSchema` —
  got neither the override nor a combo chart, silently.
  
  `ChartRenderer` now always takes the series array through the one normalization layer
  (objectui#2880 S1) instead of special-casing the `dataKey` shape around it.
  
  **Breaking on unmodified documents, deliberately — this changes rendered output.** A
  chart authored with a `dataKey`-shaped series carrying a `type` override used to render
  one family for every series; it now renders the mix the author actually described (the
  card's own regression case: two bars become one bar and one line).
  
  **Two more effects on the delivered key set for a `dataKey`-shaped series array**,
  undisclosed until now — `normalizeSeries` is a no-op on a well-formed entry, but these
  two cases were never well-formed under the old fast path either:
  
  - An i18n `label` written as a `{ en, zh-CN, … }` record on a `dataKey`-shaped entry was
    previously forwarded as that raw object; it is now resolved to a plain string (the
    first string-valued limb), matching what a `name`-shaped series already got from
    `normalizeChartSchema`.
  - A `dataKey`-shaped entry whose `dataKey` does not resolve to a non-empty string (and
    has no `name` to fall back to) was previously forwarded as-is; it is now dropped from
    the delivered series array, matching what a `name`-shaped series with no usable key
    already got.
  
  No existing well-formed internal caller (`DashboardRenderer`, `ObjectView`, the dataset
  path) changes behaviour — every series entry those callers construct already carries a
  non-empty string `dataKey` and a string `label`.
- 967e5d8: Chart `series[].opacity` and `series[].dashArray` are honoured on every series,
  not only on a `variant: 'comparison'` one (objectui#7698).
  
  `@objectstack/spec` declares `ChartSeries.opacity` ("Override series opacity")
  and `ChartSeries.dashArray` ("Override stroke dash pattern") as unconditional
  per-series overrides, and `normalizeSeries` read both off every series. The
  renderer then honoured them on a comparison overlay only, so an author who
  wrote `{ name: 'cost', opacity: 0.6 }` or `{ name: 'cost', dashArray: '4 4' }`
  on a primary series got a mark drawn exactly as if the key were absent. Fixed
  in the renderer rather than by narrowing the published declaration to match:
  the spec is the contract of record, and a renderer's partial implementation
  does not get to dictate it (AGENTS.md #0.1).
  
  **Two gaps, not one.** The `variant` guard was the visible half — `comparisonStyle`
  returned `null` for any other variant. The second half only showed on
  `dashArray`: that helper already returned an AUTHORED dash for every family
  (the `??` takes the left side whatever the kind), and the **Bar and Scatter
  marks** then passed `fillOpacity` only, dropping `strokeDasharray` and
  `strokeOpacity` on the floor — so an authored dash was lost on those two
  families even on a comparison series. A fix aimed at the guard alone would have
  left that untouched. `comparisonStyle` is now `seriesStyle`, and the Bar and
  Scatter marks pass all three channels.
  
  **Comparison series are unaffected.** The authored branch already won over the
  muted defaults, and those defaults stay gated on `variant: 'comparison'`: a
  comparison series carrying neither key keeps its lower opacity and its `'4 4'`
  line/area dash exactly as before. The two stroke defaults no mark ever consumed
  (bar and scatter — neither is stroked by this renderer) are now spelled
  `undefined`, so opening `strokeOpacity` on those marks does not hand them a
  default they never had.
  
  Only a stroked mark can show a dash, so on a `bar` or `scatter` mark an
  authored `dashArray` reaches the mark and paints nothing — the mark's geometry,
  not a condition on the key. The `ChartDataSeries` mirror docs and the
  plugin-charts reference, which stated the comparison-only condition as an
  interim measure, are corrected in the same change.
- edea22a: **BREAKING** — `SchemaRendererProvider`'s `dataSource` prop, and the context
  type every `useSchemaContext()` consumer reads back, are the published
  `DataSource` contract instead of `any`.
  
  **FROM** `dataSource={anything}` **TO** `dataSource={adapter}` — a `DataSource`
  from `@object-ui/types`, or `null` / `undefined` when the host has no adapter
  bound.
  
  ```ts
  // before — compiled, and failed at runtime on the first find()
  <SchemaRendererProvider dataSource={'not-an-adapter'}>
  // before — compiled, and no reader can do anything with it
  <SchemaRendererProvider dataSource={{}}>
  // after
  <SchemaRendererProvider dataSource={adapter}>       // a DataSource
  <SchemaRendererProvider dataSource={undefined}>     // "I have no adapter"
  ```
  
  Both sites are typed `DataSource | null | undefined` — the spelling
  `useSettledSchema` in this same package already used. The two absences are part
  of the contract, not a weakening of it: a Studio preview, a `kind:'react'` page
  rendered before the host's adapter connects, and a widget probe driving
  `apiFetch` alone all render with nothing bound, and every reader in the tree
  already guards for it. What the union refuses is everything that is not an
  adapter: a string, an empty object, a plain data bag, a partial adapter missing
  a required member.
  
  The measured cost, both halves, because the two `any`s have different blast
  radii (measured separately on `origin/main`, whole-repo type-check over the 33
  packages that depend on `@object-ui/react`):
  
  - the **context type** — the `any` that reaches every `useSchemaContext()`
    reader — reds **7 diagnostics at 7 sites in 4 packages**, all of them
    production code or a mocked module factory.
  - the **provider prop** — the injection points — reds **52 diagnostics at 27
    sites in 11 packages**, all but one of them test doubles.
  
  That ordering is the reverse of the prediction on the card: the context `any`
  was expected to be the expensive one because it infects the whole tree, and it
  is the cheap one, because every reader in the tree already guarded and none of
  them ever reached past `find` / `getObjectSchema`. The prop is the expensive
  one, because the injection points are overwhelmingly test doubles that were
  never complete adapters. The full accounting is on objectui#7912.
  
  Two runtime behaviours change, both in the "no adapter" direction and both
  strictly closer to what the surrounding code already intended:
  
  - `@object-ui/components`' `kind:'react'` page passed an empty object as its
    "no adapter yet" stand-in. An empty object is TRUTHY, so it walked past every
    `if (!dataSource)` guard written to catch exactly that state and failed later,
    at the call. It now passes the absent adapter itself, so the guard fires where
    it was meant to. The module-constant identity that stand-in existed for is
    preserved: `null` is a primitive, so the provider's memo is unaffected.
  - `@object-ui/plugin-calendar`, `@object-ui/plugin-gantt` and
    `@object-ui/plugin-kanban` collapse a `null` adapter from the context to
    `undefined` before handing it to their widget, whose prop declares the single
    spelling `dataSource?: DataSource`.
  
  Nothing else moves at runtime: no value flowing through this key changes, and
  no data path is touched. A TypeScript consumer outside this repo that handed
  this prop something other than an adapter now gets a compile error naming the
  key (TS2322 / TS2739 / TS2740), which is why the FROM/TO is spelled out above.
  
  Five `as any` reads of this context in `@object-ui/fields` are gone — they were
  redundant the moment the seam became honest — and `LookupField`'s local
  re-declaration of the imported context as a `Context` of `any`, which laundered
  its `dataSource` read while looking typed, is gone with them. Both directions of
  the contract are pinned against the real compiler in
  `SchemaRendererContext.dataSourceType.pin.test.ts`, and the card's planted
  documentation probe (a bare string in `packages/react/README.md`'s provider
  example) now fails `pnpm check:doc-snippets`, where it used to exit 0 with zero
  diagnostics.
  
  objectui#7912.
- aa6be30: `ChartRendererProps.schema.series`: the `dataKey` arm now declares `type?: string`, the
  per-series family override the `name` arm already declares, with the same member type
  (objectui#8086). The TypeScript face now states what `ChartDataSeriesSchema` (where
  `dataKey` and `name` are each independently optional beside `type`) and the renderer
  (every entry goes through `normalizeSeries`, `01c27c431`) accept. No other arm changes:
  `chartType` stays on the `dataKey` arm alone, and wins when an entry writes both.
  
  The accept set only widens. A value typed as the `dataKey` arm may now carry `type`, and
  an entry narrowed with `'dataKey' in entry` may read it; nothing that compiled before is
  refused. `ChartRendererProps` is not re-exported by name from the package entry: it
  reaches consumers as the props type of the exported `ChartRenderer` component. An object
  literal written against the whole `series` union was already accepted before this
  change, because `type` is known to the `name` arm; the gap was at the arm.
  
  The `ObjectChartSchema.series` docblock in `@object-ui/types` is restated to match: that
  copy of the internal arm does not carry `type`, and its type is unchanged.
- 0758bd8: `ObjectChart` refuses an object-bound chart that declares no category axis (objectui#8168).
  
  An object-bound chart that named no field to group by used to be composed anyway.
  `runAggregate` passed `schema.aggregate` to `ds.aggregate(objectName, { field,
  function, groupBy, filter })` with no guard on `groupBy`, and the `ds.find` leg
  handed the same bag to `aggregateRecords`, which buckets every record on
  `record[groupBy] ?? 'Unknown'`. So one path asked a driver to group by `undefined`
  and the other collapsed the whole object into a single `'Unknown'` bar — and which
  of those a reader saw was decided by the data source, not by the renderer. The only
  loud states this component had were a fetch `error` (`chart-error`) and a generic
  "No data yet"; neither is a statement about an absent binding.
  
  `ObjectCalendar`, `ObjectGantt` and `ObjectTimeline` each already refuse a view that
  declares no axis. This is the fourth, following `ObjectTimeline`'s shape
  (objectui#7459): a `role="alert"` box, `data-testid="chart-missing-category-axis"`,
  naming the bindings the author can declare — `aggregate.groupBy`, `xAxisKey`,
  `xAxis.field` — rendered from the resolver's own vocabulary so the message cannot
  drift from what the resolver reads.
  
  **Breaking, deliberately — and this repo ships breaking as `minor`.** A chart that
  previously rendered an `'Unknown'`-bucketed bar (or whatever the driver did with
  `groupBy: undefined`) now renders the refusal instead. That is the intent: the
  picture it drew was not a picture of the data.
  
  It keys on the CATEGORY alone. A measure may legitimately be absent — `count` takes
  no field — so refusing on an absent measure would refuse `count` grouped by a
  declared category, a chart that renders correctly. Four shapes are deliberately
  untouched: an ADR-0021 `dataset` chart (which may declare no dimension), a chart
  carrying authored `data` or a `bind` scope (no field name is read to fetch those
  rows), a spec-shape `xAxis: { field }` with no `xAxisKey` (resolved through
  `normalizeChartSchema`, this package's one translation of the author-facing shape),
  and every schema the five in-repo producers compose today — all five floor their own
  category, so none of them can reach the refusal.
  
  This does **not** retire the six `'name'` / `'value'` floors at the three relay faces;
  that is the remainder of objectui#7547 and is mechanical only once this screen exists.
  
  New key `chart.unconfigured.noCategoryAxis` in all ten locale packs.
- 0a174f3: fix(plugin-dashboard,core,plugin-charts): route a structured `aggregate.groupBy` on `object-metric` to the spec-shape wire
  
  An authored `aggregate.groupBy` is a union — a bare field name, or the
  structured date-bucketing node `{ field, dateGranularity?, alias? }` — and the
  two need different queries. The spec-shape
  `{ groupBy: GroupByNode[], aggregations, where }` reaches `engine.aggregate` and
  runs the server-side date-bucket engine; the legacy
  `{ field, function, groupBy, filter }` query reaches the cube/analytics wire,
  whose `dimensions` the contract declares as an array of dimension NAMES and
  which does not honour `dateGranularity` at all.
  
  `ObjectChart.runAggregate` has routed between the two since objectui#7946.
  `ObjectMetricWidget.computeOne` had no such branch: it forwarded the authored
  value straight through, so a metric widget carrying a structured node posted
  `dimensions: [{ field: 'closed_at', dateGranularity: 'month' }]` — an object
  where a name is declared. Nothing refused it and nothing reported it, so the
  author asked for one question and the platform answered another (objectui#8613).
  
  - The routing test and the payload are now one function,
    `objectAggregateSpecQuery` (with `isStructuredGroupBy`) in `@object-ui/core`.
    `ObjectChart.runAggregate` and `ObjectMetricWidget.computeOne` both call it,
    so the two renderers cannot post different wires for one authored shape. The
    measure alias is `chartMeasureKey`'s answer, i.e. what the chart's own
    `aggregateValueKey` already delegated to — the chart's posted payload is
    unchanged.
  - `ObjectMetricWidgetProps.aggregate.groupBy` said `string`. That was a claim
    about the author which nothing upstream backed: the value crosses two `any`
    seams on the way in, so the declaration refused the node at neither compile
    time nor runtime. It is now the contract's union, taken by reference through
    `ObjectChartSchema['aggregate']`.
  
  Unchanged, and pinned as controls: a plain string `groupBy` and an absent one
  (floored at the single `'_all'` bucket) still take the legacy query byte for
  byte, and an ARRAY `groupBy` still travels there too — it is not this union's
  object arm, and it must keep reaching the producer-side refusal `503cd8b89`
  landed in the adapter.
- bb383e8: Retire the "Tremor/simple format" adapter in `ChartRenderer` — the `index`,
  `category` and `value` reads (objectui#8650, triage ruling `5619609278` on
  AGENTS.md #0.1: route to the producer, ⛔ not a declaration).
  
  **Breaking, deliberately, for three keys — and NOT for the fourth.** The card
  filed four undeclared reads as one group. A cast-aware read census plus a
  TypeScript-checker declaredness reading measured them apart, and they do not
  share one verdict:
  
  - `index` / `category` (they aliased the category axis) and `value` (it became
    a single series) are **retired**. They are declared on no published face —
    not `ChartSchema`, not its zod mirror, not `ChartRendererProps.schema` — are
    advertised by no registry `inputs`, and are taught by no doc, guide or skill.
    A structural producer census over `packages/`, `apps/`, `examples/`,
    `content/docs/` and the skills corpus (5695 files, 74 chart nodes) found
    **zero** nodes writing `category` or `value` and **one** writing `index` —
    this repo's own test for the adapter. The zero is read against controls that
    fire in the same population (`xAxisKey` 41 nodes, `series` 44, `chartType`
    40, `data` 52) and a nonsense key that returns 0.
  - `categories` is **not retired and is unaffected**. It is a declared member of
    the published `ChartSchema` and of its zod mirror, is documented in the
    schema reference as an alternative series list, and was ruled live by
    the maintainer ruling of 2026-08-31. `normalizeChartSchema` — the single translation point
    (objectui#2880 S1) — already consumed it, so `ChartRenderer`'s own branch was
    a second, un-normalized read that no well-formed chart could reach. Removing
    it changes nothing for a well-formed chart and removes two wrong answers for
    a malformed one: `categories: 'revenue'` reached `.map` on a string and threw
    during render, and a `categories` whose entries the normalizer rejects
    produced a `[{ dataKey: '' }]` series.
  
  **Migration.** Write the canonical spellings, which every producer in the
  measured corpora already writes: `xAxisKey` (or the spec's `xAxis: { field }`)
  for the category axis, and `series` (or `categories`) for the plotted columns.
  A chart that still writes `index` / `category` binds no category axis, so
  `AdvancedChartImpl` falls back to its default category key, `name`. What that
  degrades to depends on the rows, and only one half of it is a refusal: rows
  carrying no `name` column hit its existing on-screen `missing-category-key`
  refusal, while rows that DO carry one plot silently against `name` instead of
  the column the author named — a wrong picture rather than a refusal. One that
  still writes `value` plots nothing.
  
  Also deletes six `(schema as any)` casts that the published declarations had
  already made unnecessary — `colors`, `categoryColors` and `categoryOrder` on
  `ChartRenderer`, and `colors`, `compareTo` and `series` on `ObjectChart` (the
  objectui#8327 bucket-(b) class: declared, then read through a needless cast).
  No behaviour changes with them; `ObjectChart.tsx` now has no `(schema as any)`
  read left at all.
- 47ba790: **BREAKING** — `ObjectChartBlock`, the registry shell exported beside `ObjectChart`, declares its props instead of taking `(props: any)` (objectui#8885).
  
  **Clause-②: yes** — a published component signature narrows. `@object-ui/plugin-charts` 17.6.0 publishes `ObjectChartBlock: (props: any) => React.JSX.Element`. It is now `(props: Omit<ObjectChartProps, 'schema'> & { schema: BaseSchema }) => React.JSX.Element`. No export is added, removed or renamed, and no runtime behaviour changes.
  
  **FROM** any props bag **TO** `ObjectChart`'s own props, with `schema` as the raw node:
  
  ```tsx
  // before: all of these compiled
  <ObjectChartBlock schema={node} dataSorce={adapter} />   // misspelled prop, silently dropped
  <ObjectChartBlock schema="object-chart" />                // a string, not a node
  <ObjectChartBlock schema={{ objectName: 'deal' }} />      // a node with no `type`
  // after: pass a node (`BaseSchema`: at least `type`) and only ObjectChart's props
  <ObjectChartBlock schema={{ type: 'object-chart', objectName: 'deal', chartType: 'bar' }} dataSource={adapter} />
  ```
  
  `schema` is `BaseSchema`, the node `SchemaRenderer` hands every registered renderer, and not `ObjectChartSchema`. The shell receives the node BEFORE `ElementDataSourceGate` maps its `dataSource` binding, so a node that carries only `{ type, dataSource: { object, view } }` is legal input. So is a node typed `chart`, the alias this same shell is registered under. The other props (`dataSource`, `onSegmentClick`) are `ObjectChartProps`' own, so a misspelled prop name is now an excess-property error.
  
  Migration: a direct caller that passed extra props through the shell must pass only `schema`, `dataSource` and `onSegmentClick`, and a node without `type` must add one. Nodes rendered through the registry (`SchemaRenderer`) are unaffected: the registry resolves renderers as `any`, and the type annotations and the single hand-off cast erase at build.
- 1b969ae: A scatter's two numeric axes now honour the spec `ChartAxis` every other chart
  family already honours, instead of dropping it.
  
  `min` / `max` / `stepSize` / `logarithmic` / `title` / `format` written on a
  chart's `xAxis` or `yAxis` were accepted by the schema and resolved by
  `normalizeChartSchema`, and then the scatter branch — alone among the families —
  never handed them to its axes. An author who pinned `min: 0` to stop a
  truncated-baseline reading got the truncated baseline back; a `logarithmic` axis
  rendered linear; explicit `stepSize` ticks and an axis `title` never appeared.
  Nothing refused and nothing looked broken: the chart drew confidently, at a scale
  the author had overridden.
  
  **This is a user-visible render change.** A scatter that already declared any of
  those keys will now draw at the domain, tick spacing, scale and labelling it
  asked for rather than at recharts' auto-fitted ones. A scatter that declares no
  axis config renders exactly as before — the derivation contributes no prop when
  there is no axis to derive from.
  
  Both axes are covered, not just the y the report named: scatter is this
  renderer's only family whose x is a numeric MEASURE rather than a category band,
  so it is the only one where these keys mean anything on x, and it was dropping
  them there too.
  
  The repair composes with the scatter edge margin rather than shadowing it. That
  margin is spent as recharts' axis `padding`, which insets the pixel range and
  leaves the domain alone, so an authored domain and the margin are now live at
  once — the domain is the author's, and no extreme mark is half-painted outside
  the plot box. A pin holds that pair together.
  
  No new key, no new exported symbol: the derivation the other families use is now
  shared by both orientations, and the scatter axes spread it.
- 3f983f4: A chart heading now follows the VIEWER's language instead of the author's key order
  (objectui#8943).
  
  `@objectstack/spec` types `ChartConfigSchema.title` as `I18nLabel` — a plain string OR
  an inline locale map — so `{ "title": { "zh-CN": "定价", "en": "Pricing" } }` is authored
  surface, not an accident. `normalizeChartSchema`'s module-local `label()` resolved the
  map arm with `Object.values(v).find(isString)`: **the first string in key order**. It
  never read the active language, never preferred `default` or `en`, and had no diagnostic
  — the chart rendered confidently in whichever language the author happened to type first.
  Reordering the JSON, with no other change, showed the same viewer a different language.
  
  `label()` now delegates to `pickLocalized` (`@object-ui/i18n`), this repository's one
  answer for that union: exact tag -> base language -> a region-qualified sibling ->
  `default` -> `en` -> first value, pinned as the twin of the backend's `resolveI18nLabel`.
  The drill-drawer heading in the same component already routed through it, so `ObjectChart`
  had two answers for one union on one node; it now has one.
  
  Every `I18nLabel` slot this module resolves is covered, not only the heading: `title`,
  `subtitle`, `description`, an axis `title` (`normalizeAxis`) and a series `label`
  (`normalizeSeries`).
  
  - `normalizeChartSchema(schema, language?)` takes an OPTIONAL second argument — the
    viewer's active language. Every existing call compiles and every non-label key is
    byte-for-byte unchanged. `ChartRenderer` reads it from `useObjectTranslation()` and
    passes it down, which is what closes the defect on the rendered path.
  - Omitting it is not neutral: `pickLocalized` reads an absent language as `en`, so a
    locale map resolves through `default` -> `en` -> first value. That is deterministic
    rather than key-order-dependent, and it is the right answer only for a caller with no
    viewer. A caller that reads a heading off the result should pass one.
  - The admission test did not widen. Only a string or an inline locale map is accepted;
    a number or boolean `title` is still refused rather than stringified, because
    broadening what the renderer accepts belongs in the spec and not in a renderer-side
    coercion (AGENTS.md #0.1).
- 14582b8: feat(types,plugin-charts): anchor `ObjectChart`'s props to `ObjectChartSchema` and declare the four keys its producers write
  
  `ObjectChart` was published as `(props: any)`, so `ObjectChartSchema` anchored
  nothing: every `schema={{ … }}` literal handed to the component was type-checked
  against nothing at all. Four keys its producers write and its renderer reads —
  `xAxisKey`, `series`, `aggregate`, `filter` — were declared on neither published
  copy of the shape, and rode `BaseSchema`'s index signature / `.passthrough()`
  unvalidated. That is the mechanism that let objectui#7891's undeclared `config`
  rung survive from the day it was written.
  
  Maintainer ruling 2026-09-09 (option A), applying objectui#6576's gallery
  treatment to the chart:
  
  - `ObjectChartProps.schema` is `ObjectChartSchema`; the published `.d.ts` no
    longer says `props: any`. `ObjectChartProps` is exported.
  - The four keys are declared on BOTH copies, with value types taken from their
    READ sites (`ChartRendererProps` for `xAxisKey` / `series`, `ObjectChart.tsx`
    for `filter`) rather than copied from any producer's literal — except where
    `@objectstack/spec` already owns the shape, which is `aggregate`: that one is
    declared BY REFERENCE as `ChartAggregate` / `ChartAggregateSchema`, so the
    authoring door here and at the react-page publish gate are one shape and
    cannot drift into two dialects.
  - `colors` converges: the zod mirror has declared it since objectui#3913 and the
    TS interface did not, a drift no ratchet could see because a mirror-only key
    is in neither of the parity guard's two difference ledgers.
  
  Two of the four are AUTHORABLE (`aggregate`, `filter` — the spec names this
  component's own props as their carrier and parses `aggregate` at the react-page
  publish gate) and two are INTERNAL, relay-composed (`xAxisKey`, `series` — every
  producer computes them and the spec's author-facing vocabulary refuses the
  internal spellings by name). The internal pair is declared anyway, because it was
  already passing through unvalidated: declaring buys the value check without
  minting authorable vocabulary, and each description says which it is.
  
  ⚠️ **Dated note, 2026-09-28 — `series` has since gained an AUTHOR arm — objectui#10770.**
  Later in this same release each `ObjectChartSchema.series` entry became ONE of two arms,
  on both faces: the spec's `ChartSeriesSchema` (TS: `ChartSeries`), by reference, which is
  AUTHORABLE (the react tier's `ObjectChart` block publishes it as its `series` prop, and the
  react-page wrapper forwards the authored array onto the node), or the unchanged INTERNAL
  `{ dataKey }` arm, still typed from `ChartRendererProps`. So "two are INTERNAL,
  relay-composed (`xAxisKey`, `series` …)" now holds for `xAxisKey` and for the
  `{ dataKey }` arm only, and "except where `@objectstack/spec` already owns the shape,
  which is `aggregate`" now takes in the `{ name }` arm of `series` too. The `series`
  description names both arms. `.changeset/10770-object-chart-react-tier-node.md` (PR
  objectui#10802) states what ships; the text above is kept as the reading of this change.
  
  `filter` keeps BOTH arms (a `FilterArray` or the ObjectQL `$filter` object), and
  narrowing to one is a decision LOCAL TO THIS NODE rather than a fleet-wide one:
  the six sibling `object-*` widgets that declare `filter` are already array-only,
  so there is no cross-widget convention to renegotiate. What blocks the narrowing
  is this component's own drill-down spread, which mis-composes the array arm into
  index keys; that is named as the successor on the member's docblock.
  
  BEHAVIOUR, from what the anchor made visible: `ObjectChart` resolved the
  group-by column twice and only one site normalised the structured
  `groupBy: { field, dateGranularity }` node. The other used the raw union as a row
  index, a field name and a drill-filter key, so a date-bucketed chart lost its
  option-colour resolution, its label→raw reverse map and its drill filter to a
  lookup on the node's stringification. Both sites now share one normalisation, and
  the behaviour is pinned at runtime by
  `plugin-charts/src/__tests__/ObjectChart.structuredGroupBy-7946.test.tsx` (drill
  filter keyed by the projected column, alias and field arms, and the label→raw
  recovery) — a compile-time pin cannot see a wrong runtime value flowing from a
  correctly-typed read.
  
  The drill drawer's heading fallback now resolves `schema.title` through
  `pickLocalized` (`@object-ui/i18n`) instead of using it as a bare string. The
  spec types that slot as `I18nLabel` — a plain string or an inline locale map —
  and the map arm used to reach the heading as an object.
  
  ## Migration — what a TS consumer of `<ObjectChart schema={…}>` must change
  
  The headline is that a wrong VALUE TYPE is now a compile error, but three
  NARROWINGS bite first, and they are what the eight edited test files in this
  change had to absorb:
  
  - **`type: 'object-chart'` is now required on the literal.** A minimal
    `schema={{ objectName: 'account', chartType: 'bar' }}` no longer compiles.
  - **`chartType` must be the declared union.** A literal written inline is fine;
    one hoisted into a non-`const` object widens to `string` and is refused. Use
    `as const` (or annotate the holder as `ObjectChartSchema`).
  - **`series` entries must be `dataKey`-shaped.** The renderer's internal arm is
    `{ dataKey, … }`; the spec's author-facing `{ name, … }` arm is a different
    shape, translated by `normalizeChartSchema` one layer down.
  
  ⚠️ **Dated note, 2026-09-28 — a `{ name }`-shaped `series` entry is now accepted —
  objectui#10770.** Later in this same release `ObjectChartSchema.series` took the spec's
  `ChartSeriesSchema` (TS: `ChartSeries`), by reference, as a second arm beside the
  `{ dataKey }` one, on both faces. So "`series` entries must be `dataKey`-shaped" no
  longer holds, and that narrowing no longer bites:
  `series: [{ name: 'total', label: 'Invoice value' }]` compiles and parses. An entry with
  neither `name` nor `dataKey` is still refused, and `normalizeChartSchema` is still the one
  translation between the arms.
  What bites instead is reading: an element of `ObjectChartSchema['series']` is a union, so
  a consumer narrows it (for example with `'dataKey' in entry`) before it reads `.dataKey`.
  `.changeset/10770-object-chart-react-tier-node.md` (PR objectui#10802) states what ships;
  the text above is kept as the reading of this change.
  
  And, from the by-reference `aggregate`:
  
  - **`aggregate.function` and `aggregate.groupBy` are REQUIRED**, `aggregate.field`
    stays optional (only `count` counts rows rather than a column), the structured
    `groupBy` node must name its `field`, and unknown members are REFUSED by name
    rather than dropped. `aggregate: {}` and `{ field: 'amount' }` used to compile
    and no longer do. This is `ChartAggregateSchema`'s accept set, which the publish
    gate has always enforced on authored `<ObjectChart aggregate={…}>` literals —
    so a document that compiles today is one the platform already accepted.
  
  The RENDERER still accepts more than this and still draws its named refusal
  screen for an aggregate that declares no category axis (objectui#8168): untyped
  producers forward `aggregate` as `any`, so out-of-contract documents keep
  arriving at runtime. Narrowing the declaration is about what an author may
  WRITE, not about what the renderer will tolerate.
  
  ⚠️ Anchoring does not buy rejection of a MISSPELLED key on the node itself:
  `BaseSchema` carries `[key: string]: any` (objectui#5155), the same ceiling
  objectui#6576 accepted. `aggregate` is the exception, and only because the spec's
  own object is strict.
  
  ⚠️ **Dated note, 2026-09-28 — `aggregate` is no longer the only strict member —
  objectui#10770.** Later in this same release a `series` entry on the `{ name }` arm became
  the spec's closed `ChartSeriesSchema`, by reference, so on the zod face a misspelled key
  in one is refused, while one in a `{ dataKey }` entry is still stripped. So "`aggregate`
  is the exception" no longer holds alone. Other changes in this release did the same for
  `drillDown` (objectui#8885) and for `xAxis` / `yAxis` (objectui#10518), each a strict spec
  object by reference. A misspelled key on the node itself still passes, as above.
  `.changeset/10770-object-chart-react-tier-node.md` (PR objectui#10802) states what ships;
  the text above is kept as the reading of this change.
- 6f017e9: Dashboard chart widgets no longer render as a blank area when their height class
  resolves to `auto`.
  
  `ChartContainer`'s min-size fallback was applied only to the wrapper `div`.
  Recharts measures its own `width:100%;height:100%` size-detector element, and a
  percentage height never resolves against an ancestor's `min-height`, so the
  wrapper obediently grew to 280px while the measured element stayed at 0 — and
  Recharts renders no children at all for a non-positive box. The result was a
  widget card with its title over an empty chart area: no marks, no refusal, no
  empty state, and permanent, because a box that never changes fires no resize.
  The floor is now applied to the measured element as well, under the same
  condition, so an author's explicit height still wins.

### Patch Changes

- a9f34df: fix(plugin-charts): the legend swatch carries its series colour as a custom property
  
  `ChartLegendContent` painted each swatch with an inline `backgroundColor`, the
  colour-bearing property AGENTS.md's styling carve-out names as forbidden. The
  swatch now publishes the author-declared colour as `--color-bg` and a static
  `bg-(--color-bg)` utility consumes it, the same shape the tooltip indicator in
  the same file already uses, so the theme keeps control of the rule. The
  rendered colour is unchanged.
- 3759c56: Gantt, chart and grid views refresh in place after a write instead of being rebuilt (objectui#10035).
  
  `ObjectGrid`, `ObjectGantt` and `ObjectChart` query for themselves and read no refresh input, so both object-view layers could show them a write only by remounting them — which lost a gantt's scroll, collapsed groups and zoom, a chart's open drill-down, and a grid's selection, column state and in-progress edit. Each now refetches when the data-invalidation bus (`notifyDataChanged` / `useDataInvalidation` from `@object-ui/react`) reports a change to the object it reads:
  
  - `@object-ui/plugin-grid`: `ObjectGrid` re-reads its rows into the same table.
  - `@object-ui/plugin-gantt`: `ObjectGantt` re-reads silently and keeps the chart mounted, as its toolbar refresh does.
  - `@object-ui/plugin-charts`: `ObjectChart` re-runs its query on both binding shapes — an object-bound aggregate follows its `objectName`, a dataset-bound chart follows the dataset's base object as the `queryDataset` answer names it.
  - `@object-ui/plugin-view`: the object view keys every view on its identity alone, and declares on the bus its own saves and deletes and each `onMutation` write it hears.
  - `@object-ui/app-shell`: the object page keys its list and its chart view on identity alone, and declares on the bus the changes it learns of without a data-source write — server actions, flows, imports, realtime events and an explicit refresh.
  
  Rows a host hands these components (`data`, `bind`, inline values) are still the host's to refresh; only the components' own queries follow the bus.
- bff63cc: A cartesian chart whose series are bound to a column no row carries now says so, naming the
  column, instead of drawing an empty frame (objectui#10396). The tile renders the existing
  `data-chart-error` placeholder with the new code `missing-series-key` and a sentence worded after
  `missing-category-key`: "This chart cannot plot its series: no row has a `KEY` field." Several
  missing keys are joined with "or". A console warning names the missing keys and the keys the rows
  do carry, as the category refusal's warning does.
  
  The shape is objectui#8266's: a fieldless count projects its value as `count`, and a series bound to
  `value` over those rows drew the category ticks and zero marks, silently. What now refuses, each of
  which drew zero marks before: a bar / column / horizontal-bar / line / area / combo chart with rows,
  when not one row carries ANY bound series key. That holds whatever else the chart declares: a
  stack, a declared `min` / `max` or `stepSize`, or a second axis.
  
  What keeps drawing, unchanged: a chart where even one row carries the key; a chart where one bound
  key is carried and another is not (the carried series draws); and a dotted key such as `a.b`,
  which the chart resolves into nested rows. A dotted key is never judged missing, so a chart that
  binds one stays silent even when it resolves nothing. A column no row carries beside a key that is
  carried but has no numeric value (for example an all-boolean series) also stays silent, as before.
  
  Precedence: `missing-category-key` wins when the category key is missing too, and
  `no-plottable-series` still owns a chart with no series at all. A key that IS carried but holds no
  numeric value on any row keeps `no-numeric-value` (objectui#7195). Scatter, pie, donut, funnel,
  treemap and radar never receive this code.
- a506001: A chart's `xAxis` object is no longer dropped when it carries `min`, `max`, `stepSize`,
  `logarithmic` or `position` without also carrying `title`, `format` or `showGridLines`
  (objectui#10516).
  
  `normalizeChartSchema` kept the x-axis object only when one of those three hand-named keys
  was present. Any other axis lost everything but its `field`, so a scatter authored with
  `xAxis: { field: 'progress', min: 0, max: 200, stepSize: 50 }` drew the auto-fitted x
  domain and ticks instead of the ones it declared, and nothing refused. The object is now
  kept whenever it carries any key of the spec's `ChartAxisSchema` other than `field`. The
  key set is the one the normalizer reads, not a second hand-written list.
  
  **User-visible render change.** A scatter whose `xAxis` declares `min` / `max` /
  `stepSize` / `logarithmic` with no title, format or grid flag now draws the x scale it asked
  for. That completes objectui#9675's x-axis repair for axes written that way. An `xAxis`
  carrying only `field` renders as before.
  
  `position` on `xAxis` now survives normalization too, but at this change no renderer reads
  it: the x axis draws along the bottom whatever it says.
  
  ⚠️ **Dated note, 2026-09-25 — the renderer now reads `xAxis.position` — objectui#10587.**
  Later in this same release the x axis takes the side `position` names where that axis can
  run along it, and a side it cannot take draws the default side with a note naming the key.
  The sentence above is kept as the reading of this change; the objectui#10587 entry states
  what ships.
- 9fbbb17: BREAKING (`@object-ui/components`): `RefreshIndicator`'s `ariaLabel` prop is now required and has no default. It used to default to the English literal "Refreshing", so the progress bar on every view that passed no name was announced in English to screen-reader users in every locale (objectui#10580). A `RefreshIndicator` rendered without `ariaLabel` now fails to type-check.
  
  (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  Migration: pass the bar's accessible name from your own translation layer, for example `ariaLabel={t('grid.refreshing')}`. The component renders the string you pass as the bar's `aria-label` and does not translate it.
  
  `ObjectGrid`, `ListView`, `ObjectChart` and `ObjectDataTable` now name their refresh bar in the active locale. The grid and the list read the `grid.refreshing` and `list.refreshing` keys their pull-to-refresh text already uses. The chart reads `chart.refreshing` and the dashboard data table reads `dashboard.refreshing`, both with no English literal behind them, so a host that renders either one with no i18next instance at all gets the key itself as the bar's name.
  
  `@object-ui/i18n`: new keys `chart.refreshing` and `dashboard.refreshing` in every built-in locale pack.
- 33b324c: A chart's `xAxis.position` now places the x axis, and a side that axis cannot take is
  refused with a note that names the key (objectui#10587).
  
  `position` is declared on `@objectstack/spec`'s `ChartAxisSchema`, which `xAxis` takes by
  reference, and since objectui#10516 the normalizer keeps it on the x-axis object. No axis
  read it, so `xAxis: { field: 'month', position: 'top' }` validated and still drew the axis
  along the bottom.
  
  - **bar, line, area and scatter** (and a combo derived from its series' families): the x
    axis runs across the plot. `top` draws it along the top; `bottom` draws it along the
    bottom, the default.
  - **horizontal-bar**: the `xAxis` object configures the category axis, which runs down the
    plot there (its `format` already applied to that axis). `left` or `right` puts the
    category axis on that side; the default stays the left.
  - **A side the axis cannot take** (`left` / `right` across the plot, `top` / `bottom` on
    horizontal-bar) draws the axis at its default side, and the chart shows a note under the
    plot (`data-chart-note="x-axis-position"`) naming `xAxis.position`, the value, and the
    side the axis was drawn on. The value still validates: `ChartAxisSchema` is shared by the
    x and y axes, and this change does not narrow it.
  
  A top axis also mirrors its title and its rotated tick labels, so both stay on the far side
  of the axis from the plot.
  
  **User-visible render change** only for a chart whose `xAxis` declares `position`. The
  bottom / no-position controls in `ChartRenderer.xAxisPosition-10587.test.tsx` pin that a
  chart declaring none still draws its x axis along the bottom with no note.
- a95ec20: An object-bound `object-chart` that names its category with `aggregate.groupBy` alone now draws that
  category, instead of being refused with `missing-category-key` (objectui#10634).
  
  A node with `objectName`, `aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' }` and
  `series`, and no `xAxisKey` or `xAxis`, passed `ObjectChart`'s absent-category screen (objectui#8168),
  whose remedy lists `aggregate.groupBy` first. The schema `ObjectChart` then handed to `ChartRenderer`
  carried no category key, so the chart floored it on `'name'`, found no `name` column in the grouped
  rows, and refused. The author had followed the refusal's own remedy and was refused again, over a key
  they never wrote.
  
  `ObjectChart` now forwards the category when the author named it only through `groupBy`. The key it
  forwards is the column the aggregate projects its group under, per the contract's result-column
  convention (`chartAggregateResultKeys` in `@objectstack/spec/ui`): the `groupBy` string, or
  `alias ?? field` for the structured `{ field, dateGranularity?, alias? }` node. This is the same
  column the dashboard relays already bind (objectui#8269). An `alias` therefore binds the aliased
  column the rows carry, not the underlying field.
  
  What does not change:
  
  - An authored category axis always wins. The forward fills an absent slot only, and asks this
    package's own axis resolution whether one is authored: `xAxisKey`, a spec-shape `xAxis: { field }`,
    or a bare string `xAxis`. It never writes over any of them.
  - Charts that draw authored rows (`data`, or a `bind` scope) are unchanged, with or without
    `objectName`. Their rows never went through the aggregate, so `groupBy` says nothing about their
    columns.
  - Dataset-bound charts (ADR-0021) are unchanged. They take their category from their dimensions.
  - The absent-category refusal fires on exactly the same nodes as before.
- 4df0f3d: A chart's `yAxis[].position` now places each value axis, and `horizontal-bar` lays out and
  binds its axes (objectui#10654, the y-side twin of objectui#10587; objectui#10655 folded in).
  
  `position` is declared on `@objectstack/spec`'s `ChartAxisSchema`, which each `yAxis` entry
  takes, and the normalizer keeps it. No axis was placed by it: it only chose which entry
  configured the right-hand axis a combo always draws (and the value format of a right-bound
  series), and how the normalizer bound the series it derives from the entries. So a lone
  `position: 'right'` entry drew its axis on the left, `top` / `bottom` passed in silence, a second
  entry was always the right-hand axis, and with no `series` a first entry at `right` took both
  derived series to the right-hand axis.
  
  - **Where each entry is drawn.** `placeYAxes` (in `normalizeChartSchema`) is the one place a y
    side is resolved; the normalizer binds each series it derives from the entries with the same
    call, so a derived series plots against its own entry's axis.
    - bar (`column`), line, area, combo and scatter: `left` / `right`. Scatter draws one y axis,
      the first entry's.
    - horizontal-bar: the value axes run across the plot, so `bottom` / `top`; a series'
      `yAxis: 'left'` binds the bottom axis and `'right'` the top one.
    - A lone entry's axis is drawn on the side it names. With two entries each is drawn on the
      side it names, and an entry that names no side takes the side the other left free.
    - **Both entries naming the same side:** the first keeps it and the second is drawn on the
      other side, with a note naming `yAxis[1].position`. `yAxis[0]` is already the primary axis
      (its `showGridLines` governs the horizontal grid), and declaration order is the one
      tie-break an author can read off the metadata.
    - A side a value axis cannot take is refused: the entry is placed as if it named none, and
      the chart shows a note under the plot (`data-chart-note="y-axis-position"`) naming
      `yAxis[N].position`, the value and the side the axis was drawn on. `ChartAxisSchema` is
      shared by both axes and is not narrowed.
  - **horizontal-bar.** Two entries draw two value axes, along the bottom and the top, and the
    bars bind to them; they were bound to `yAxisId`s the branch never rendered, and bars were
    dropped. `xAxis.title` is drawn on the category axis, and the `yAxis` title is laid out for an
    axis running across the plot, under it at the bottom and over it at the top.
  - **Grid and annotations** bind to the rendered left value axis whenever the value axes carry
    ids (a combo always; bar, line, area and horizontal-bar with two entries). They were bound to
    an axis id those charts do not render: a two-entry chart's horizontal grid lost its per-tick
    lines and its `axis: 'x'` annotations, a combo with fewer than two entries drew no annotation,
    and a two-entry horizontal-bar dropped its `axis: 'y'` annotations.
  - **A right-hand value axis** lays its title out on the far side of its tick labels, the left
    layout mirrored, as a top x axis mirrors the bottom one.
  
  **User-visible render change** for a chart whose `yAxis` entries declare `position`, a
  horizontal-bar with an axis title or two `yAxis` entries, the grid and annotations of two-entry
  and combo charts, and the title of every right-hand value axis.
  `ChartRenderer.yAxisPosition-10654.test.tsx` pins each row against its `bar` control.
- daf1405: A chart's `yAxis` entry after the second now carries a note naming it, instead of going unused
  in silence (objectui#10691).
  
  `@objectstack/spec` declares `ChartConfig.yAxis` as an uncapped list, so a third entry
  validates; a bar (`column`), line, area, combo or `horizontal-bar` chart draws at most two value
  axes, one per slot. Such an entry drew no axis and no note, while its `title`, `format`, `min`
  and `max` went unused and a series derived from it plotted against the right-hand axis.
  
  - **The note.** Every entry after the second gets a `p role="note"
    data-chart-note="y-axis-undrawn"` under the plot, in the `ChartFootnote` channel the
    `x-axis-position` / `y-axis-position` notes use. It names `yAxis[N]` and, when the chart
    declares neither `series` nor `categories`, the axis its `field` is plotted against: the one
    in the right-hand slot (the top one on `horizontal-bar`), and the entry drawn there.
  - **One answer.** `placeYAxes` lists the entries it draws on no axis (`undrawn`), with the slot
    a series derived from one binds to. The normalizer binds that series from the list, and the
    renderer writes the note from it. The binding itself is unchanged: the right-hand slot, as
    before.
  - **Not narrowed.** The accepted count does not move, and the chart is not refused: the spec
    owns the `yAxis` face.
  
  A chart with two entries or fewer, a `scatter` chart (it draws one y axis), and a family that
  draws no value axis render as before.
- 1fc77fd: A `scatter` chart's `yAxis` entry after the first now carries a note naming it, instead of
  going unused in silence (objectui#10721).
  
  `@objectstack/spec` declares `ChartConfig.yAxis` as an uncapped list, so a second entry
  validates; a `scatter` chart draws one value axis, the first entry's. objectui#10691 gave the
  bar (`column`), line, area, combo and `horizontal-bar` charts a note for each entry after the
  second, and left `scatter` as it was: with `series` authored, a second or later entry drew no
  axis and no note, and its `title`, `format`, `min` and `max` went unused.
  
  - **The note.** Every entry after the first gets a `p role="note"
    data-chart-note="y-axis-undrawn"` under the plot, in the `ChartFootnote` channel
    objectui#10691's note uses. It names `yAxis[N]` and the one axis the chart draws, `yAxis[0]`.
    It says nothing about a series derived from the entry: with neither `series` nor
    `categories`, two entries that carry a `field` are refused as before
    (`data-chart-error="scatter-multi-series"`).
  - **One answer.** The scatter slice moved into `placeYAxes`, which now takes the chart family,
    so the renderer and the normalizer place the same entries. A series the normalizer derives
    from an entry after the first now binds to the slot the one axis is drawn in, where it used to
    bind as if the chart drew two axes. A scatter reads no series binding and measures its one
    series against that axis, so what it draws does not move.
  - **Not narrowed.** The accepted count does not move, and the chart is not refused: the spec
    owns the `yAxis` face.
  
  A `scatter` chart with one entry, and every other family, render as before.
- 256b4c9: A filter refused as malformed (`INVALID_FILTER`) no longer throws out of render or out of a click
  handler at the sites that merge filters there. That holds whether this layer's filter converter
  refused it or, at the drill seam, the spec's own `parseFilterAST`. Each site now surfaces the
  refusal the way its siblings already do (objectui#10789). The filter stays **refused**: nothing
  that was refused is accepted, and no site falls back to "no filter".
  
  - **`ElementDataSourceGate` / `useElementDataSource`** (`@object-ui/react`): the gate's merge of
    the component's `filter` with the composed binding, and the merge of a saved view's filter
    with the binding's own, lowered through the throwing converter inside render. A refused
    filter from either now makes the binding `missing` with a new optional `filterRefusal` on the
    result (`error` carries its message). The gate then draws, in place of the block, the
    malformed-filter notice the wrapped blocks draw: `view.malformedFilter`, naming the refused
    operator or field. `element:record_picker`, which reads the same hook, shows its
    configuration-error panel with the refusal.
  - **`PeoplePicker` / `RecordPickerDialog`** (`@object-ui/fields`): the recents merge and the
    dialog's `mergedFilter` lower through `toFilterNodeSafely`; a refusal is shown in the picker's
    existing error state and no query runs without the filter.
  - **Drill-downs** (`ObjectChart`, `ObjectPivotTable`, `DatasetWidget`, `DatasetReportRenderer`):
    a widget or report filter refused at the drill seam made the drill click throw. The converter
    refuses some (a spec `$not`, say). The spec's `parseFilterAST` refuses others, such as a scalar
    on a list operator in either dialect: `[['stage', 'in', 'won']]` or `{ stage: { $in: 'won' } }`.
    The drill is now not opened or emitted (never with the scope dropped), and the refusal is logged
    with `console.warn`, naming the operator. `composeDrillFilter` (`@object-ui/core`) now throws
    one refusal type: the spec's `INVALID_FILTER` error is re-raised as a `FilterOperatorError` with
    its message and the same `INVALID_FILTER` / 400 envelope, and any other error passes through
    unchanged.
  - **`ListView` export** (`@object-ui/plugin-list`): the server export builds its filter inside
    its `try`, so a refusal is named in the export menu instead of escaping the click.
  - **`convertFiltersToAST`** (`@object-ui/core`): an `$or` member that is the TRUE identity no
    longer stops the members after it from being read. `{ $or: [{}, { a: {} }] }` is now refused
    like `{ $or: [{ a: {} }, {}] }` already was, instead of answering TRUE (every row); a TRUE
    disjunct beside members that lower still absorbs its `$or`.
- eb97ce6: fix(plugin-timeline,plugin-charts,i18n): a stored date-only day reads as that day in every viewer zone on the timeline, on a chart's date axis and in the published date helpers (objectui#10866, slice 2)
  
  These readers parsed a `YYYY-MM-DD` value with the engine's own `Date` parse, which reads it as UTC midnight, so every viewer west of UTC saw the day before. Each now reads the value through `toDisplayDate` from `@object-ui/core`, which rebuilds a date-only value at local midnight of the day it names. A value with a time part keeps its instant.
  
  - **Timeline.** The object timeline's date bucket, its sort and the item date the renderer prints read the value that way. West of UTC an item due today no longer sits under "Overdue", one due tomorrow no longer sits under "Today", and the `short` and `long` item faces print the stored day. The `iso` face prints a date-only value's day from local getters, and an instant's UTC day as before. A day its month does not have, such as `2026-02-30`, is no longer rolled into March: the item sits under "No date", sorts with the dateless items, and its `short` and `long` faces are the ones an unparsable value already had. An unparsable value now sorts with the dateless items too, and the `iso` face prints such a value as written where it used to throw. The gantt variant's axis headers, extent and bar positions are not changed here, so west of UTC its bar tooltip, which prints through the same item-date function, now names the stored day while the axis above it still reads the day before, until a later slice of objectui#10866.
  - **Charts.** A date-only category on the x axis reads `Sep 1` for `2026-09-01`, and `Sep 2026` on a month-grained axis, in every zone. When the display locale is a tag `Intl` refuses, the tick still prints the stored day: it reads the local-midnight value with local getters, because its `toISOString()` would name the day before east of UTC. An instant's fallback keeps its UTC day. A date-only category naming a day its month does not have falls back to the raw category, the face any other non-date category gets, instead of the rolled day.
  - **i18n helpers.** `formatDate`, `formatDateTime`, `formatRelativeTime` and `formatDateSpec` read a date-only string as the day it names: `formatDateTime` shows midnight of that day, and `formatRelativeTime` counts to the start of it. `formatDateSpec` applies its `timeZone` to an instant only, and formats a date-only value in the local zone, where the shared step's local midnight reads back as its day; a `timeZone` west of UTC no longer turns `2026-09-01` into August 31st for every viewer. All four return a day its month does not have as the raw string. `formatRelativeTime` now returns an unparsable value as its string, the face the other three already gave one, where it used to throw a `RangeError`.
- 6837bfa: fix(plugin-charts): an `object-chart` whose family is on `specType` gets `compareTo` exactly as the same family on `chartType` does, so a `specType: scatter` chart with `compareTo` draws instead of refusing, and `specType: pie` makes no comparison fetch (objectui#11530)
  
  `ObjectChart` decides two things with `chartTypeIgnoresCompareTo` from `@object-ui/core`: whether to run the comparison query, and whether to add the `__comparison` overlay series. Both read only `chartType`. A family on `specType` (the react tier's channel, which objectui#11520 routes) was invisible to them. So a family that ignores `compareTo` (`pie`, `donut`, `funnel` and `scatter` at this release) still fetched the comparison window and still got the overlay:
  
  - **`specType: scatter` with `compareTo`** made 2 aggregate calls and rendered the refusal "A scatter plots one measure. Keep exactly one series: amount, amount__comparison" (with the document's own measure). It now makes 1 call and draws the scatter.
  - **`specType: pie`, `donut` or `funnel` with `compareTo`** made a comparison call whose rows the chart never drew. It now makes 1 call. The picture is unchanged.
  
  Both decisions now read the family the chart draws, which is the value `normalizeChartSchema` hands `ChartRenderer`: `chartType`, else `specType`. The family list stays the one in `chartTypeIgnoresCompareTo`. The object fetch also re-runs when that family changes, where it used to re-run on a `chartType` change only.
  
  No other document changes: a family on `chartType` and every family that keeps `compareTo` (on either key) fetch and draw as before.
- f82f857: fix(charts): a cartesian chart that declares no series at all now says so instead of drawing an empty frame (objectui#4695)
  
  A `bar` / `horizontal-bar` / `line` / `area` / `combo` (and `column`) chart handed
  data rows but no series binding — no `series`, no `categories`, no y-axis `field`,
  so `series` reaches the renderer as `undefined` — drew axes, grid, tooltip and
  legend around zero marks and said nothing. It now renders the same placeholder
  objectui#4683 introduced for a computed-but-empty series list
  (`data-chart-error="no-plottable-series"`, `role="status"`), with its own sentence:
  "none was declared" rather than "no measure or group reached" the axis, and a
  console warning that lists the row keys a series could name.
  
  Unchanged: a chart with no rows; pie, donut, funnel, radar and scatter charts,
  which fall back to a `value` column and keep drawing; and every chart that
  declares its series.
- 39f4309: Published typings from every `vite-plugin-dts` package now carry an explicit extension on
  every relative specifier, and a type error in the declaration build now fails the build
  instead of being printed and ignored (objectui#5439, objectui#5483).
  
  **Consumers on `moduleResolution: nodenext` or `node16` may see NEW type errors, and that
  is the fix working.** These packages re-export mostly through NAMED re-exports —
  `export { useObjectChat } from './useObjectChat'`. TypeScript could not follow the
  extensionless hop, but it still DECLARED the name, so the symbol resolved to a silent
  `any`. Nothing errored; consumers simply got no types. With the extension emitted, the
  symbol carries its real type, and any call site that was relying on the `any` now type
  checks for the first time. This is the mode that produced the 21 residual `TS7006` on
  `@object-ui/app-shell` reported against objectui#5365 — a type hole that opened quietly,
  unlike objectui#5365's own `export * from './ui'` packages where the same defect surfaced
  immediately as `TS2305: has no exported member`.
  
  410 extensionless relative specifiers across 19 packages were emitted before this change;
  the count is now 0 in all 22 packages that build typings through `vite-plugin-dts`.
  `@object-ui/fields` was already clean — its sources write explicit `.js` specifiers — and
  is wired so it stays that way.
  
  The second half changes no emitted output today: 22/22 packages built green unmodified, so
  making the declaration step's exit code honest turns nothing red. It changes what a FUTURE
  regression does — print and exit 0, versus fail the build.
- 3beef6d: The spec's `dataSource` element binding is now DECLARED by the blocks that read
  it, so the html tier stops reporting the one working saved-view spelling as
  `unknown-prop` (objectui#6678).
  
  `PageComponentSchema.dataSource` — `{ object, view, filter, sort, limit }` — is
  the one spelling that resolves a saved view for an object-bound block. It works,
  and it drew the identical `unknown-prop` warning as the two spellings that do
  nothing (`viewName`, `view`), because `validateTree` looks a prop up in the
  block's declared `inputs` and no registration declared this key. On the tier
  built to accept AI-authored pages, where the diagnostic IS the contract, the
  only signal pointed away from the key that works.
  
  Adopting the maintainer ruling of 2026-08-29 — option B **in the injection
  form**:
  
  - `ELEMENT_DATA_SOURCE_INPUT` is the single declaration, in `@object-ui/core`
    beside the binding's own semantics; `Registry.register` emits it for any
    registration whose renderer passed through the new `elementDataSourceBlock()`
    seam. One mechanism, one copy — not a hand-kept declaration per block, which is
    the shape that drifts and that a new block forgets. The seam lives in
    `@object-ui/core` and is re-exported by `@object-ui/react` beside
    `ElementDataSourceGate` for discoverability; call sites take the core import,
    because a registration runs at module scope and this repo's suites partially
    mock `@object-ui/react`.
  - Seventeen renderers, in thirteen files across twelve packages, reach the seam
    and now publish the key to the save gate, the parser whitelist, the generated
    JSX authoring types and the block list. The card named nine blocks; the tree
    also has `plugin-grid`, `plugin-timeline`, two further `plugin-form` blocks and
    `element:record_picker` — nothing was hand-listed, so the mechanism covered
    them. `element:record_picker` consumes the gate's HOOK and status panels rather
    than the wrapper tag (its object lives under `properties`), and was found by a
    render probe rather than by reading sources.
  - `dataSource` on a block that does NOT read it (`flex`, `card`) still reports
    `unknown-prop`. Adding the key to `sdui-parser`'s `BASE_PROPS` was refused for
    exactly this reason — that set mirrors `BaseSchema`, and silencing the key
    everywhere would make the diagnostic lie in the other direction.
  - New `check:element-data-source-declaration` fails any source that consumes the
    gate without reaching the seam, so a block added tomorrow cannot forget.
  
  Behaviour of the binding itself is unchanged — this is a declaration, not a
  resolution change. The saved view still resolves its columns, and an
  unresolvable `view` still fails loudly rather than widening to the object's full
  scope.
  
  The spec/registry parity gates (repo-wide and the `record:related_list` per-block
  pin) now derive their accepted set from the WHOLE node contract rather than from
  `ComponentPropsMap[type]` alone. `PageComponentSchema` accepts and keeps
  `dataSource` on a page-component node — it is a node-level key, a sibling of
  `type` and `className`, not a per-block prop — so the gates' previous complaint
  was measurably wrong. Derived from the spec, not exempted, and both still
  discriminate against an invented key.
- 40c4711: A sankey that drew only SOME of its rows now says how many (objectui#7148).
  
  The sankey arm keeps strictly positive measures
  (`data.filter((r) => (Number(r?.[dataKey]) || 0) > 0)`), so a mixed dataset
  drew a normal, healthy, confident chart of a fraction of itself and nothing
  anywhere recorded that the other rows existed. Measured in Chromium across 27
  tiles: `[{New business: 40}, {Refunds: -25}, {Chargebacks: -12}]` rendered
  `svg: 1`, `path: 3`, 18 descendants, no `role`, no text, and — against a live
  console control that did fire on the same instrument — zero console output.
  Its screenshot hashed byte-identical to five other datasets, one of which
  genuinely had a single row. Six datasets, one image: a reader had no bit of
  information separating a complete flow from a third of one.
  
  The discard itself stands — a flow has no negative width, so it is the only
  thing that arm can do with those rows. What is added is a footnote under the
  plot naming the ratio and the predicate the filter applies:
  
  > Showing 1 of 3 rows — 2 rows have no `amount` above zero, which a flow
  > cannot draw.
  
  It names the predicate rather than a cause because `Number(…) || 0` folds
  negatives, zeros, `null`, unparseable strings and a missing key into one
  discard, and all five were measured reaching this branch beside a survivor;
  naming any one of them is a sentence that is false for the other four.
  
  A complete flow is byte-for-byte unchanged and gains no wrapper element, and a
  drawable sankey is never replaced by prose: the `no-positive-flow` refusal
  still owns the case where NOTHING survives the filter, and the "one positive
  among zeros still draws" boundary still draws — that fixture is itself a
  thinned dataset, so it now draws *and* says so.
- e8c553b: A scatter handed more than one series now refuses instead of drawing a false picture.
  
  Scatter binds one measure: `series[0].dataKey` is the y axis, and every series was
  handed the same rows through that one axis. A second series therefore added a
  colour and a legend entry and nothing else — measured, two series over two rows
  painted four symbols at two positions, each drawn twice, and the second measure's
  values appeared nowhere on the plot. The data was valid and the picture was
  confidently wrong, which no existing refusal could see.
  
  A `chartType: 'scatter'` with two or more `series` now renders the renderer's
  refusal shell under `data-chart-error="scatter-multi-series"`, stating that a
  scatter plots one measure, naming the fix (keep exactly one series) and listing
  the series keys it was handed. A single-series scatter is unchanged.
  
  This refusal counts authored `series` only. `compareTo` on scatter is out of
  its scope: objectui#7402 ruled (b) that scatter joins pie / donut / funnel in
  excluding `compareTo` — `supportsCompareTo` and the dashboard widget path stop
  synthesising a comparison series for it, so no `…__comparison` overlay is ever
  built for a scatter and this guard is never reached by a compare-to document.
  That exclusion ships as a separate change; until it lands, a `compareTo`
  document still reaches the renderer as two series and refuses here today.
  
  No multi-measure projection is built (maintainer ruling, 2026-09-02): nothing
  in-repo authors a two-series scatter, so that capability waits for a real caller.
  The refusal copy is `chart.scatterOneMeasure` in all ten locale packs.
- 3632060: A cartesian chart whose numeric axis has rows but nothing to build a scale from now says so
  instead of drawing an empty frame (objectui#7195). The tile renders the existing
  `data-chart-error` placeholder with the new code `no-numeric-value` and a sentence naming the
  bound key and the row count: "none of the N rows has a numeric value for KEY".
  
  The answer is keyed on the whole dataset, not on the value's type. A boolean beside one real
  number still draws (Recharts builds the scale from the number and places the booleans on it), so
  that mixed chart keeps drawing with no note. What now refuses, each of which drew zero marks
  before:
  
  - scatter, when every row's x (or y, or both) is a boolean, or a boolean mixed only with values
    that cannot be placed. That last shape used to carry a footnote implying one point was drawn;
  - bar / column / horizontal-bar / line / area / combo with no stacked bar or area series, when
    no row gives any bound series a value the axis can scale: every value boolean, `null` or an
    unparseable string. A line's `stack` has no effect in the renderer, so a "stacked" line is
    judged the same way.
  
  A chart with ANY stacked bar or stacked area series is never refused, whatever its values: the
  stack gives its axis a scale on its own, and every series on that axis is placed on it (an
  all-boolean series beside a stacked all-`null` one draws). Some of those charts draw nothing
  (a stacked all-`null` bar, a stacked area of unparseable strings); they stay silent, exactly as
  before, rather than risk a sentence over marks that are on screen.
  
  What keeps drawing, unchanged: numeric strings, `Number` objects, `Date` values, range values
  (an array read by its first two elements, both numbers, so `[1, 3]` and `[1, 2, 3]` alike: range
  bars and range areas), every chart with a STACKED bar or area series (the stack paints booleans
  as numbers, and unparseable strings, `NaN`, objects and arrays as full-height bars), a series that
  is all boolean beside a numeric one, a dual-axis chart with one live axis, and any axis whose
  spec declares both a numeric `min` and a numeric `max` (the chart builds that scale from the spec
  and places booleans on it), and any axis whose spec declares a `stepSize` (with one declared
  bound, the chart's tick builder reads booleans as 0 and 1 and supplies the other end; a `stepSize`
  alone is left silent too, erring toward silence). A `min` or `max` alone, `logarithmic` alone
  or an annotation does not build a scale, so those tiles are still refused. `''` counts as a value at zero: a line, area or scatter draws it, and a bar,
  horizontal-bar or combo paints the same zero-height picture as all-zero data, silently, exactly
  as before. A bound series key that is not a plain property of any row (a dotted path such as
  `a.b`, which Recharts resolves into nested rows, or a column no row carries) keeps the chart
  silent: the refusal fires only when every bound key is read from the rows directly. Rows with no placeable pair still get scatter's
  `no-plottable-points`, a multi-series scatter still gets `scatter-multi-series`, and
  `missing-category-key` / `no-plottable-series` still take precedence over this one.
  
  ⚠️ **Dated note, 2026-09-27 — a column no row carries is now refused when every bound key is one — objectui#10396.** Later in this same release, a bar / column / horizontal-bar / line / area / combo chart whose every bound series key names a column no row carries renders its own refusal, `missing-series-key` ("no row has a `KEY` field"), instead of staying silent. A dotted path, and a column no row carries beside a key the rows do carry, still keep the chart silent. The rest of this entry is kept as the reading of this change; the objectui#10396 entry states what that shape now renders.
- bb459ea: Name the scatter legend's series, so its swatch stops reading as a stray data point
  (objectui#7248).
  
  The Chart Gallery scatter ("Estimate vs Progress") appeared to draw a seventh point
  below the x-axis, outside the plot area. It was not a point. `ChartLegendContent`
  resolves a label as `config[nameKey || item.dataKey || 'value']`, and a `<Scatter>`
  carries **no `dataKey`** — scatter's keys live on the XAxis/YAxis, not on the mark — so
  the key collapsed to the literal string `'value'`, missed a config keyed by measure
  name, and the legend entry rendered its colour swatch with no text beside it. An 8x8
  square in `--chart-1`, the same colour as the marks, sitting under the x-axis.
  
  Measured on the running showcase in real Chromium: the swatch sat at cy 341 against a
  plot area ending at cy 295, on a y scale of 4.835 px per unit — y = -9.5, at x ≈ 45.
  That is the "x≈40, y≈-10" the report described, to the pixel, and all six real marks
  were inside the plot area at every viewport width swept from 1440 down to 480.
  
  **The y domain was not the defect and is unchanged.** Clamping it — the fix the report
  asked for — would have created the bug it described: mixed-sign and all-negative
  fixtures are pinned here drawing every mark, because recharts already extends the
  domain to cover negative values.
  
  Two changes. The scatter now passes `nameKey` so its legend resolves the measure's
  label, and `ChartLegendContent` falls back to the series `name` recharts itself put on
  the legend item when the config lookup misses. The second closes the class rather than
  this one instance: the swatch renders unconditionally, so a config miss must never
  leave it anonymous. Charts whose config already resolves are unaffected — only a
  currently-empty label changes.
- 47547d0: Localize the server's built-in aggregate measure titles on dataset charts
  (objectui#7258 — consumer half of the objectstack#14492 contract; maintainer
  ruling B, 2026-09-02).
  
  A dataset-bound chart's aggregate axis / legend title read the analytics
  service's hard-coded English `Count` on a zh console whose category labels were
  already Chinese. The renderer was passing `fields[].label` through verbatim —
  correctly, for an author-declared measure (objectui#4106) — and had no way to
  tell the server's built-in default apart from an author's label.
  
  The wire now can: `AnalyticsResult.fields[]` gains an OPTIONAL structural
  discriminator, `builtinAggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max' |
  'count_distinct'`, populated only on the server-side built-in defaults
  (objectstack#14492). This change is the consumer side of that contract:
  
  - `@object-ui/core`: `buildChartSeries` now accepts `ChartMeasureField[]` —
    `ChartResultField` plus the optional `builtinAggregate` carrier
    (`BuiltinAggregateCarrier`), declared beside the renderer shape rather than
    on it because the spec this release is built against does not carry the key
    yet; new `BUILTIN_AGGREGATES` / `BuiltinAggregate` / `isBuiltinAggregate` /
    `resolveMeasureLabel`; `ChartSeriesOptions.builtinAggregateLabels` carries
    the locale strings in (core stays React-free and i18n-free — the same
    division as `nullCategoryLabel`). A field carrying a recognised
    discriminator resolves through that map; every other field keeps its wire
    `label` verbatim — never by matching the label's text or the field's name
    (the rejected option A).
  - `@object-ui/i18n`: `builtinAggregateLabels(tt)` resolves the six strings
    through the existing `report.aggregate.*` keys (zh already carried 计数 /
    求和 / 平均 / …; all ten packs are pinned to cover the vocabulary).
  - `plugin-charts` (`ObjectChart`), `plugin-dashboard` (`DatasetWidget`),
    `plugin-report` (`DatasetReportRenderer`): pass the resolved map to
    `buildChartSeries`.
  
  Before: 合作中 / 已流失 / 潜在 under an axis titled `Count`. After: the same
  chart titled `计数`; an `en` session still reads `Count`; an author-labelled
  measure (`Tasks`) and a measure literally named `count` without the
  discriminator are byte-for-byte unchanged. Until the upstream field is
  populated the wire carries no discriminator and every chart renders exactly as
  before.
- acb5797: Fix categorical (bar/line/area/combo) x-axis labels still being dropped above
  5 buckets (objectui#7386, follow-up to objectui#7247).
  
  `xAxisCommonProps` charged every band axis above `X_AXIS_ALL_LABELS_MAX_BUCKETS`
  a `minTickGap` of 48px (32px mobile) — a time-series budget that recharts adds
  **on top of** its own measured-overlap check, not instead of it. A 7-status
  pipeline at a 290px widget (≈33px/band) dropped 4 of its 7 names even though
  nothing was actually wide enough to collide.
  
  `minTickGap` is now `0` for that branch: recharts' own measured-width overlap
  avoidance (`interval: 'preserveStartEnd'`, unchanged) is the only thing
  governing tick density above the bound, same as it already was for every tick
  it kept. Verified in real Chromium — this repo's DOM test environment reports
  zero text metrics, so it cannot exercise this change at all: at 7 and 8
  buckets and realistic widget widths, every label now draws with zero measured
  overlap (checked against each rotated label's true rotated rectangle, not an
  axis-aligned box); a 180-point daily series at 800px still thinned sensibly
  (11 ticks, zero overlap) — the "hundreds of points" case objectui#7247 guarded
  against stays protected by the same measured-overlap check, just without the
  removed extra margin.
  
  Not changed: `X_AXIS_ALL_LABELS_MAX_BUCKETS` / the ≤5-bucket "draw everything"
  branch (objectui#7247, out of this issue's scope); the scatter chart's own
  `minTickGap` (its x axis is `type="number"`, a genuinely continuous measure,
  not a categorical band — a different axis with a different, still-correct,
  constant); and recharts' angled-tick collision model, which stays on its more
  conservative projected-bounding-box approximation rather than the true
  parallel-line perpendicular-separation constraint — a deliberate,
  documented-in-code choice, not an oversight, given this change's scale (a
  handful of buckets, not a rewrite of recharts' geometry).
- e859ad0: Reserve a margin at both ends of a scatter's numeric axes, so an extreme mark is drawn
  wholly inside the plot area (objectui#7396).
  
  Both scatter axes are numeric and carry no explicit domain, so recharts fits the domain
  to `[dataMin, dataMax]` and maps it across the whole plot box. A row at either extreme
  is therefore **centred on the boundary**, and since a mark has a radius, about half of
  each extreme symbol paints outside the plot area — the half-dots hugging both edges of
  the Chart Gallery scatter.
  
  Measured on that scatter ("Estimate vs Progress") in real Chromium — viewport 1440,
  widget svg 510x350, plot area x 53..505 / y 5..296:
  
  - before: marks at cx 53, 256.4, 301.6, 414.6, 459.8, 505 with the y-max row at cy 5,
    radius 4.514px. The first and last sit exactly on the x boundary and the y-max one on
    the top boundary, each overhanging its edge by a full radius.
  - after: cx 65, 257.6, 300.4, 407.4, 450.2, 493 with the y-max row at cy 17. The worst
    case now clears its nearest edge by 7.486px, on both axes.
  
  The card reported the x axis; the y axis clipped the same way and is fixed with it.
  
  **The domain is not touched.** The margin is reserved as recharts' axis `padding`, which
  insets the pixel range the scale maps into and leaves the domain alone, so every tick
  **value** is unchanged — the axes still read 0/25/50/75/100 and 0/15/30/45/60 — and only
  the mapping moves. Padding the domain instead would invent unround tick endpoints, and it
  would write the same recharts prop a spec-declared `min`/`max` needs (objectui#9675), where
  whichever landed second would shadow the other.
  
  The margin is sized to the largest radius the scatter's declared symbol-area envelope
  admits, not to the radius drawn today, so neither a change in recharts' own default mark
  size nor a future variable-size mark can reopen it.
  
  Every scatter's marks shift inward by that margin; nothing else about the chart changes.
- ed4a2f1: fix(plugin-charts): `pie-chart`, `donut-chart`, `radar-chart` and `scatter-chart` render as the family they name
  
  A schema written as `type: 'pie-chart'` (or `plugin-charts:pie-chart`, and likewise donut / radar / scatter) drew a **bar chart**. The four registrations declared their family as `defaultProps: { chartType: … }`, and nothing on the SDUI path has ever read a registration's `defaultProps` — so `ChartRenderer` resolved no family and `AdvancedChartImpl` fell to its `'bar'` default. Valid data, a confidently wrong picture, and no `data-chart-error` that could fire.
  
  `ChartRenderer` now derives the family from the schema's own `type`, through `normalizeChartSchema` — the package's single translation point, so the exported `normalizeChartSchema` answers what the runtime actually draws. An explicit `chartType` still wins, so `plugin-charts:chart` with `chartType: 'scatter'` is unchanged.
  
  The five inert `defaultProps: { chartType: … }` are removed with it rather than left beside a mechanism that works. Registration `defaultProps` remains unread on the SDUI path repo-wide; activating it generally is a separate, wider change and is not this one.
  
  ⚠️ `scatter-chart` now genuinely reaches the scatter arm, so a two-series `scatter-chart` now renders the `scatter-multi-series` refusal it was always supposed to.
  
  ⚠️ **Dated note, 2026-10-02 — `scatter-chart` is retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2b) unregistered `scatter-chart` and
  `plugin-charts:scatter-chart`, and its `CHART_TYPE_KEYWORD_FAMILIES` row went with it; the scatter
  family is authored as `{ type: 'chart', chartType: 'scatter' }`. `pie-chart`, `donut-chart` and
  `radar-chart` stay registered. The rest of this entry is kept as the reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — `pie-chart`, `donut-chart` and `radar-chart` are retired too — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2c) unregistered the three keys, with their
  `plugin-charts:` twins and `CHART_TYPE_KEYWORD_FAMILIES` rows, after moving `examples/chart-examples.ts`
  to `{ type: 'chart', chartType: 'pie' | 'donut' | 'radar' }`. `chart:bar` is the one family keyword left.
  The rest of this entry is kept as the reading of this change.
- ff79d38: Read the spec-declared lookup spellings in two readers that could not see them at all
  (objectui#7435).
  
  `ObjectChart`'s group-by label chain and `resolveActionParams`' picker group both read the
  object-schema field def in `snake_case` only. That def is what `getObjectSchema` /
  `useMetadata()` serve, and it carries the spelling `@objectstack/spec`'s `FieldSchema`
  declares — so `displayField`, `descriptionField` and `lookupFilters` were dropped on the
  floor. The chart fell through to the generic `name` heuristic and drew a label the author
  had explicitly overridden; an action param rendered its picker with defaults. Nothing
  warned, because the readers were simply reading keys that were not there.
  
  Each of the three keys now has its declared spelling ranked FIRST, with the existing
  `snake_case` legs kept behind it in their existing order — the shape objectui#7155
  established. Measured on the pin this tree resolves, `@objectstack/spec@17.4.0`:
  `FieldSchema.safeParse` over a minimal lookup def accepts all three camelCase keys and
  refuses every snake twin with `unrecognized_keys`, with the minimal def accepted and a
  nonsense key refused as controls in the same run.
  
  The legacy legs are kept rather than retired. A per-site producer sweep found no in-repo
  producer of any of the three snake spellings and zero key-position occurrences in the
  producer repo (control lit), but two producers lie outside what that sweep measures: a
  document stored before the key was tightened, since the serve path runs no parse, and a
  host `DataSource` that never passes through the adapter's key canonicalisation. Dropping a
  leg would be a silent regression for already-authored data.
  
  Two keys deliberately gain nothing. `idField` has no `FieldSchema` spelling in either
  casing, and `titleFormat` is an object-level key whose canonical target is deprecated in
  favour of `nameField`; reading either camelCase spelling would fossilise a key no contract
  declares, so both keep their existing snake-only reads and their absence is now pinned.
- c6198c2: **Breaking for authored metadata:** `ComponentInput.label`, `ComponentInput.defaultValue` and
  `ComponentInput.advanced` are RETIRED on both faces (objectui#7493 item ① and objectui#7781;
  maintainer ruling A of 2026-09-06, immediate, no deprecation window; ADR-0049 enforce-or-remove).
  They are the three keys the manifest serializer does not forward, and nothing read them on any
  publication or consumption path.
  
  No manifest ever published them, so no consumer could ever have read them. `sdui-parser`'s
  serializer (`packages/sdui-parser/src/index.ts`) forwards exactly seven keys per input — `name`,
  `type`, `of`, `required`, `enum`, `binding`, `description` — so a value authored under any of the three
  never reached `sdui.manifest.json`, the generated JSX `.d.ts`, or a diagnostic; its boundary type
  has no slot for them; the registry's data-source seam reads `name` only; and neither the designer
  nor the app-shell inspectors consult registry `inputs` at all. A structural census over every
  `inputs:` array in the repository (re-measured on this change's merge-base, `name` 951 and `type`
  951 as the controls) counted the writes: `label` 908, `defaultValue` 245, `advanced` 9 — written on
  nearly every registration, read by nothing.
  
  FROM → TO, per key — all three **TOMBSTONED, not removed**, because the route was measured on
  the built face before it was chosen: `ComponentInputSchema` is a non-strict `z.object`, and an
  undeclared key parses GREEN and is silently STRIPPED, so a deletion would have swallowed 1,162
  authored values in silence. The tombstone is what makes the refusal loud and by name.
  
  - `label?: string` → `label?: never` on the interface, `retirementTombstone()` on the Zod mirror.
    Migration: delete the key. An input is identified by its `name` on every path that reaches it;
    nothing ever rendered a label for it.
  - `defaultValue?: any` → `defaultValue?: never` / `retirementTombstone()`. Migration: delete the
    key. The renderer's own fallback read IS the default; tell the author about it in `description`,
    which IS published. (Tightening the type to `unknown` was ruled out: it closes no error class,
    since nothing reads the value.)
  - `advanced?: boolean` → `advanced?: never` / `retirementTombstone()`. Migration: delete the key.
    No designer surface ever hid an "advanced" input; there is nothing to write instead.
  
  The retirement kit: `?: never` on `ComponentInput` (`packages/types/src/base.ts`), so authoring one
  is a `tsc` error at the registration site; `retirementTombstone()` on `ComponentInputSchema`
  (`packages/types/src/zod/base.zod.ts`), so an authored value is REFUSED at parse time with
  `code: 'invalid_type'`, the key named in the issue `path`, and the migration note as the message
  (one string, both channels). Pinned in
  `packages/types/src/__tests__/component-input-retired-keys-7493.test.ts`, which also holds a
  tree-scoped absence census over every `inputs:` array under `packages/**` and `apps/**`.
  
  Accept-set change, stated plainly for reviewers: a document that sets any of the three keys on a
  `ComponentInput` used to parse GREEN (the value was then dropped by the serializer) and now parses
  RED. Every in-repo authoring site — 1,199 keys across 110 registration files, the three standalone
  `ComponentInput[]` arrays and the two named input arrays `tsc` found included — is deleted in the same change, as the ruling's split rule
  requires; the `WidgetRegistry` seam no longer copies the widget-manifest values onto the synthesized
  `ComponentInput` (they fed nothing), and the data-source declaration `ELEMENT_DATA_SOURCE_INPUT`
  drops its `label`. The patch entries on the other packages record exactly that: their registrations
  stop authoring inert keys, with no runtime or published-manifest change.
  
  The nine test files that read `defaultValue` off a registration were re-pinned against the
  renderer's ACTUAL default (its own fallback read, or the `defaultProps` it ships) instead of the
  declaration that went away; two assertions that only restated the shadow default were dropped with
  the reason on the line.
  
  The in-repo zero is what was measured. Whether anything OUTSIDE this repository writes these keys
  is not measurable from here (the objectui#5674 limit); converting such a write from a silent drop
  into a named refusal is exactly what the tombstones buy. `WidgetInput`'s own `label` /
  `defaultValue` / `advanced` (the widget-manifest face) stay declared and writable — nothing has
  ruled on that face; that it now has no reader either is recorded as objectui#7911.
- 1fbf63f: Honour a radar series' declared presentation keys (objectui#8157).
  
  On `chartType: 'radar'` the mark rendered a bare `fillOpacity={0.6}` and read nothing
  off the series, so three things `@objectstack/spec` declares for every `ChartSeries`
  were inert at once — `opacity` and `dashArray` (both read by `normalizeSeries` and then
  discarded) and the whole `variant: 'comparison'` treatment, which is declared and
  documented with no family restriction. A radar series carrying any of the three drew
  identically to one carrying none, while every cartesian mark in the same file resolved
  its presentation through the shared `seriesStyle` helper.
  
  The radar arm now calls that helper like the cartesian arms do:
  
  - an authored `opacity` sets both the polygon's fill and its stroke opacity;
  - an authored `dashArray` dashes the polygon outline — radar is a stroked mark, so
    unlike a bar or a scatter this is a family where a dash actually paints;
  - `variant: 'comparison'` mutes a radar overlay, taking the `area` family's defaults
    (radar being the other mark this renderer both strokes and fills) rather than any
    newly invented numbers.
  
  **The default face does not move.** `0.6` was a default as much as a bug — a radar fill
  needs some opacity or an overlay is unreadable — so the literal became the fallback
  (`fillOpacity={pres.fillOpacity ?? 0.6}`) instead of being deleted. A radar series that
  declares none of the three keys paints exactly what it painted before: `fill-opacity`
  `0.6`, no stroke fade, no dash. Already-drawn radar charts that author nothing are
  untouched; only a chart that authors one of the keys changes, which is the repair.
  
  No cartesian arm changed. The helper gained `'radar'` in its `kind` union and an
  `areaLike` binding that is exactly `kind === 'area'` for every cartesian kind.
- fc32921: Fix a dashboard chart widget with a FIELDLESS `count` aggregate plotting nothing
  (objectui#8266).
  
  A widget bound to an object with `aggregate: { function: 'count', groupBy: 'status' }`
  and no `field` — the normal way to author "how many records per status" — rendered an
  empty chart. No error, no empty state: a plot frame with the category ticks drawn and
  not one mark in it, which reads exactly like "this object has no rows yet".
  
  **Cause.** The two dashboard relays (`DashboardGridLayout`, `DashboardRenderer`) each
  built the series binding as `aggregate?.field || (options.yField || 'value')`, which for
  a fieldless count resolves to `'value'`. The rows an object-bound fieldless count
  returns are keyed `'count'` — the alias the engine projects `COUNT(*)` under, pinned
  since framework#3701. A `dataKey` naming a column no row carries plots nothing, and
  neither of the renderer's two guards fires on it: the rows DO carry the category key,
  and the series array is not empty.
  
  **Fix.** `chartMeasureKey` is a new `@object-ui/core` export delegating to
  `chartAggregateValueKey` in `@objectstack/spec/ui` — the contract's own derivation of
  "the value column an object-bound aggregate produces". Both relays now consult it, and
  the row-projection side (`aggregateValueKey` in `@object-ui/plugin-charts`) is routed
  through the same function, so the two halves of the question cannot drift again.
  
  **What moves on screen.** A chart that was blank now draws. Charts that already drew are
  unaffected: a field-bearing aggregate resolves to its raw field under both the old and
  the new reading, and a chart with no `aggregate` at all keeps the author's `yField`.
  One authored key changes meaning: a `yField` written on an object-bound chart that
  ALSO declares an aggregate no longer wins over the aggregate's own column — it named a
  record column that a grouped aggregate never returns, so it plotted nothing before.
  
  **Not fixed here, and out of scope.** The same widget with no `options.xField` is
  refused by the category-axis guard naming `name`, a key the author never wrote (they
  wrote `aggregate.groupBy`). That is the category half of the same relay gap and is
  filed separately.
- 8f9d87a: Fix a dashboard chart widget that declares its category as `aggregate.groupBy` being
  refused for lacking a `name` column (objectui#8269).
  
  A widget bound to an object with `aggregate: { function: 'count', groupBy: 'status' }`
  and no `options.xField` rendered a refusal instead of a chart:
  
  > This chart cannot plot its category axis: no row has a `name` field.
  
  The author wrote `groupBy: 'status'`. Nothing on screen said `groupBy` was the key that
  had been ignored, and `name` appeared nowhere in their metadata — so the diagnostic sent
  them to debug the wrong layer.
  
  **Cause.** The two dashboard relays (`DashboardGridLayout`, `DashboardRenderer`) each
  floored the category binding on a literal — `options.xField || 'name'` — and handed it to
  the `object-chart` node without ever consulting the aggregate that decides it. An
  object-bound aggregate returns one row per group keyed by the raw `groupBy` field, so no
  row carried `name` and the category-axis guard (framework#4033) fired correctly on a
  binding that was already wrong when it arrived.
  
  **Fix.** `chartCategoryKey` is a new `@object-ui/core` export delegating to
  `chartAggregateCategoryKey` in `@objectstack/spec/ui` — the contract's own derivation of
  "the category column an object-bound aggregate produces", and the published sibling of the
  `chartAggregateValueKey` that objectui#8266 adopted for the measure axis. Both relays now
  consult it for the object-provider branch.
  
  **What moves on screen.** A widget that rendered a refusal now draws. Measured through
  `ChartRenderer` at 480x320 over the rows a fieldless count returns
  (`[{status:'open',count:2},{status:'paid',count:5}]`): the composed binding went from
  `xAxisKey: 'name'` — a `missing-category-key` refusal, 0 marks — to `xAxisKey: 'status'`,
  1 series and 2 marks with the category ticks drawn.
  
  **Unaffected.** A chart with no `aggregate` at all keeps the author's `xField` (its rows
  are raw records, so that key is the right one), an UNGROUPED aggregate keeps it too (it
  returns a single row with no category column), and the authored-literal-rows branch — the
  `chart` node composed after the object-provider check fails — keeps its floor unchanged.
  One authored key changes meaning, exactly as objectui#8266's `yField` did: an `xField`
  written on an object-bound chart that ALSO declares a `groupBy` no longer wins over the
  aggregate's own column — it named a record column a grouped aggregate never returns, so it
  produced the same refusal before.
- 681d3f1: Compose an `ObjectChart` drill-down filter instead of spreading it, so the widget's own
  filter survives into the drilled query for BOTH arms of `ObjectChartSchema.filter`
  (objectui#8944).
  
  **The defect.** `ObjectChartSchema.filter` admits a spec `FilterArray`
  (`[['region','=','emea']]`) and the ObjectQL `$filter` object (`{ region: 'emea' }`),
  and both are read — both travel verbatim to `ds.aggregate` / `ds.find`. The drill seam
  composed them by spreading the widget's filter into an object literal, which is correct
  for the object arm and silent nonsense for the array arm: spreading an array yields
  index keys, so an authored `FilterArray` drilled as
  `{ '0': ['region','=','emea'], stage: 'won' }` — the widget's conditions replaced by a
  key the query layer ignores. Nothing errored; the drawer opened and looked right.
  
  **Direction of the failure.** The widget's filter is what narrows. Dropping it made the
  drilled list a **superset** — it showed records the chart itself was scoped to exclude.
  Not a security boundary, but the worse direction for a silent bug.
  
  **The composition rule, named rather than picked.** `widget.filter ∧ drill.filter`. The
  two are independent filter sources and a drill must satisfy both: the click context only
  says which bucket of the widget's scope was asked for, so it may narrow that scope and
  never widen it. This is not a new rule — it is the contract `mergeFilterNodes` already
  states ("combine filter sources under a single `and`, each as its OWN child"), the sink
  every other multi-source filter in this repo goes through. A new
  `composeDrillFilter` helper in `@object-ui/core` applies it at the drill seam and
  documents it, then lowers the result back to the `FilterCondition` object dialect with
  `parseFilterAST` — the spec's single lowering sink — because that is the dialect both
  drill sinks take.
  
  **Compatibility.** A lone surviving source lowers back to exactly the flat object the
  spread produced, so a chart with no filter of its own drills byte-identically to before.
  Only a genuinely composed pair gains the `$and`.
  
  `serializeDrillFilterParams` (the drill "Open in list" / `target: 'navigate'` URL writer)
  learns to flatten that `$and` into the flat `filter[...]` params its own read side already
  ANDs back together. Without that it took the `String(value)` path — `$and` holds an array —
  and emitted `filter[$and]=[object Object],[object Object]` while both real conditions
  vanished, which is the outcome that function's contract says it never produces.
- 6223a9d: fix(plugin-charts): a scatter chart's grid now honours the spec axis `showGridLines`
  
  The scatter branch drew its grid from a hard-coded `vertical={false}` instead
  of the grid config every other cartesian family derives from the spec axes, so
  `showGridLines` declared on either scatter axis was accepted and then dropped.
  It now uses that same derivation: `yAxis.showGridLines: false` removes the
  horizontal lines and `xAxis.showGridLines: true` adds vertical ones.
  
  A scatter whose axes declare no `showGridLines` renders exactly as before
  (horizontal lines only).
- a78cd37: Dates and numbers across the console and the plugins format in the session's
  display locale instead of the machine's (objectui#9909).
  
  Every one of these faces handed `Intl` — directly, or through a formatter called
  without one — either no locale tag or an explicit `undefined`, which is not "the
  user's locale": it is the locale of the machine the browser runs on, which is
  neither of this repository's two locale channels.
  A German or Spanish session therefore read, beside a translated label, a date or
  an amount grouped and decimal-marked the machine's way — and an amount with
  inverted separators does not read as unformatted, it reads as a different
  number. They now go through `useDisplayLocale()` (tenant regional default, then
  the active UI language, then `'en'`), and a plain helper takes that tag from its
  caller. The surfaces:
  
  - **`@object-ui/fields`** — `GridField`'s numeric and currency cells (list mode
    and computed columns) and both total cells. The same cell helper's date branch
    already used the display locale, so a single grid row read two conventions at
    once.
  - **`@object-ui/plugin-charts`** — ISO-date x-axis ticks, compact y-axis ticks,
    the single-value face, spec `format` strings and the tooltip value.
  - **`@object-ui/app-shell`** — the organization invitations, members and
    accept-invitation dates; marketplace version dates; the AI conversation row's
    older-than-a-week date and its tooltip; the build-debug token count; the
    record approvals timeline; and the metadata-admin audit, history, external
    datasource snapshot, schema-browser row estimate, flow-run start and job
    next-fire faces. The audit, history and flow-run panels format these in the
    DISPLAY locale, not in the `locale` prop they take for their UI strings
    (`AuditPanel` defaults that prop to `'en-US'`; `HistoryPanel` and
    `FlowRunsPanel` leave it optional).
  - **`@object-ui/console`** — the approvals inbox's timestamp tooltips, amounts
    and payload summary; the audit log's timestamp column; the flow runs table and
    its run detail.
  - **`@object-ui/components`** — the export dialog's record counts and the debug
    panel's event times.
  - **`@object-ui/plugin-form`** — the analytics submission count, the
    master-detail subtotal / tax / total stack and the edit-conflict dialog's
    "their save" time.
  - **`@object-ui/plugin-chatbot`** — the approvals inbox's past-30-days date and
    the times stamped on local-mode chat messages (the user's and the
    auto-response).
  - **`@object-ui/plugin-dashboard`** — the record-count badge, and the currency
    and date-format branches of `renderFieldValue`, which was handed the display
    locale and spent it only on its percent branch.
  - **`@object-ui/plugin-grid`** — the record-detail panel's inferred currency
    value and the mobile card's amount line, siblings of date cells already on the
    display locale.
  - **`@object-ui/plugin-designer`** — `VersionHistory`'s version times.
  
  A host that mounts one of the components that newly read the display locale with
  NO `I18nProvider` now gets react-i18next's once-per-module `NO_I18NEXT_INSTANCE`
  notice in the console on the first such mount; the faces still render, in the
  channel's `'en'` last resort, and mounting an `I18nProvider` (as the console
  does) avoids the notice.
  
  **Additive API** (nothing that compiled before stops compiling):
  
  - `@object-ui/types`: `ValidationContext` gains an optional `locale`. At this
    change, the `@object-ui/core` validation engine prints the `date_min` /
    `date_max` bound in it; omitted, `Intl` follows the runtime default, as
    `formatDisplayNumber` already declares for a caller with no locale in hand.
  
    ⚠️ **Dated note, 2026-09-25 — that engine (`ValidationEngine`) is removed from
    `@object-ui/core` by a later change; `ValidationContext.locale` stays declared in
    `@object-ui/types`, and at that change nothing in `@object-ui/core` reads it —
    objectui#7659.**
  
    ⚠️ **Dated note, 2026-09-27 — `ValidationContext` itself is removed from
    `@object-ui/types` by a later change, with the rest of the Phase 3.5
    validation types it belonged to, so the `locale` member this entry adds no
    longer exists — objectui#10719.**
  - `@object-ui/plugin-report`: `exportReport`, `exportAsHTML` and `exportAsPDF`
    take a trailing optional `locale` for the exported file's "Generated:" time,
    and `LiveExportOptions` gains an optional `locale` that `exportWithLiveData`
    forwards. Omitted, the time uses the display channel's own last resort
    (`'en'`), never the machine's locale. `ReportViewer` passes the session's
    display locale. The locale is deliberately NOT a `ReportExportConfig` member:
    that type is authored report metadata, and a display locale belongs to the
    session.
  
  **One census, repository-wide.** `plugin-detail`'s machine-locale census pin
  (objectui#9786) is now a single test, `machineLocaleCensus-9909.test.ts` in
  `@object-ui/i18n`, covering every workspace package whose manifest depends on
  `@object-ui/i18n`. It refuses any call site that passes nothing, `undefined`,
  the `'default'` pseudo-tag (a subtag no locale data answers, so `Intl` resolves
  it to the machine's locale) or a hard-coded tag, unless the site is declared
  with its reason — for example the `catch` fallback for a tag `Intl` itself
  rejected, or an ISO formatter feeding `<input type="date">`. Each declared site
  is counted exactly, so deleting one without its entry is refused too. The
  per-package pin it replaces is deleted. The runtime tripwire that observes the
  argument each locale-taking call (`Intl` constructors, `Date` and `Number`
  `toLocale*`) actually receives moved into the private `@object-ui/test-support`
  package, and every surface above is pinned with it: the same data under two
  declared locales must render differently, NO locale-taking call may receive the
  machine's locale (nothing, `undefined` or `'default'`), and the surface's own
  calls must receive the declared tag. A call carrying another declared tag, such
  as the `'en'` of the session's UI language, is tolerated by design: only the
  machine's locale is the defect.
- 894d103: `ObjectChart`'s wrapper div now carries `h-full`, keeping the height chain intact from a dashboard grid cell's declared height down to the element Recharts measures. Previously the chain died at the plain auto-height wrapper: `height: 100%` on the chart container computed to `auto`, Recharts measured a permanent zero, and only the `CHART_MIN_HEIGHT` floor (`6f017e99c`) kept dashboard charts visible — at a fixed floor height instead of filling the cell (#5451). Under auto-height parents `h-full` resolves to `auto`, so non-dashboard hosts are unchanged.
- 5eddeeb: Pie, donut, funnel and treemap now say when rows carry no magnitude they can draw.
  
  These four families size a mark BY its measure, so a row whose value is zero,
  negative, `null` or unparseable stays in the data and is given no area. Measured
  in Chromium across 74 tiles: an all-zero pie put ZERO non-white pixels on the
  page while its DOM carried 31 descendants and a real `svg`; a treemap handed
  `40 / null`, `40 / 0` or `40 / -25 / -12` rendered one full-bleed leaf that was
  byte-identical to a genuinely one-row treemap; and a funnel handed `40` beside a
  `null` drew no segments at all and labelled the tile with the row that had no
  value.
  
  When no row can be sized, these charts now render the file's refusal shell
  (`no-positive-magnitude`) instead of a blank tile. When only some rows can be
  sized, the chart still draws and carries a note counting the ones it could not.
  All-positive charts, charts handed no rows at all, bar charts, and both sankey
  answers are unchanged.
- cef27e2: The value-fallback label prettifier `humanizeLabel` has one implementation instead of two byte-identical copies.
  
  `humanizeLabel` turns a stored value into a display string when nothing else
  resolves it — an option with no declared label, an object name, a chart axis
  member. It existed twice, byte for byte: once in `@object-ui/fields` (read by
  `plugin-grid`, `plugin-gantt`, `plugin-detail` and by that package's own
  renderers) and once as a deliberate local copy in `plugin-charts`'
  `ObjectChart.tsx`, whose comment said it was there "to avoid a dependency on
  `@object-ui/fields`".
  
  Two copies of one convention is a live hazard rather than tidiness: one
  dashboard can hold a chart and a grid over the same stored value, so a change
  landing on one copy alone would put that value on screen under two spellings at
  once. The single implementation now lives in `@object-ui/core` — the shared
  ancestor both packages already depend on, so the dependency the copy existed to
  avoid is still avoided and no new edge is created, and core takes no React
  (objectui#4389: core-canonical logic, plugins consume). Both former sites
  re-export it, so `import { humanizeLabel } from '@object-ui/fields'` keeps
  working unchanged.
  
  **Nothing rendered changes.** The surviving implementation is byte-identical to
  both deleted copies, and each former call site is pinned by identity against the
  core function — not by a copied output table that someone would have to remember
  to edit in two places.
  
  The core module also writes down, for the first time, why this convention stays
  distinct from `humanizeFieldKey` (the KEY fallback, in `@object-ui/plugin-dashboard`),
  which additionally splits camelCase:
  
  ```
  input                humanizeFieldKey     humanizeLabel
  needs_analysis       Needs Analysis       Needs Analysis
  NeedsAnalysis        Needs Analysis       NeedsAnalysis        <- differ
  unitPrice            Unit Price           UnitPrice            <- differ
  BestCase             Best Case            BestCase             <- differ
  lost-to-competitor   Lost-To-Competitor   Lost To Competitor   <- differ
  ```
  
  A field KEY is authored in the codebase and carries a machine spelling, so
  splitting camelCase recovers words its author meant. A stored VALUE is arbitrary
  tenant data, where a mid-token capital is not reliably a word boundary and
  splitting it rewrites what the tenant wrote (`McDonald` to `Mc Donald`). The two
  conventions also do not nest — on the last row each leaves alone the separator
  the other rewrites. Whether they should ever converge is a separate decision
  that would move rendered output in four packages at once; it is deliberately not
  made here.
- d6fe1e1: Draw every categorical x-axis label on short axes
  
  A vertical bar chart in a dashboard-width widget dropped most of its x-axis
  labels — three bars drew one label, five bars drew two — leaving the bars
  unnamed, with no legend to fall back on because a single-series bar chart has
  none.
  
  The x axis applied one tick policy to time and category alike (`preserveStartEnd`
  with a 48px `minTickGap`), which is right for hundreds of dates and wrong for a
  band axis, where a dropped tick is an identity the reader cannot recover rather
  than a sample they can interpolate. It was also keyed to the viewport rather
  than the widget, so a 200px chart inside an 800px console was treated as a wide
  one.
  
  Bar, column, line, area and combo charts now draw every label on a categorical
  x axis of five buckets or fewer — rotating, and ellipsising an over-long name
  rather than clipping it. Longer axes keep the existing measured thinning, and
  horizontal bars are unchanged.
- fb336df: Move `lucide-react` from `^1.31.0` to `^1.43.0` in every package that declares it, and
  repair what the jump breaks, so icons resolved from a STRING keep drawing a glyph.
  
  Measured once against the installed 1.43.0 artifact when this change was made; nothing in
  the repository re-derives these readings. Across the jump lucide removes no runtime export,
  no public type name and no `lucide-react/dynamic.mjs` name, and every name this repository
  imports from `lucide-react` resolves. Exactly one key leaves the runtime `icons` record:
  `Trash2`, retired in favour of `trash`.
  
  What a user sees change:
  
  - Icons the lazy icon seam draws (`resolveIcon`, objectui#9251) get their path data again.
    lucide 1.43.0 icon modules export their path data inside `__iconData` and no longer
    export `__iconNode`; the seam now reads both. Reading only `__iconNode` against 1.43.0
    leaves every such glyph an empty box, with nothing thrown or logged.
  - `DetailView`'s delete action and three schema-catalog examples spell their icon
    `trash`, not `trash-2`, so they keep resolving. The glyph is unchanged: 1.43.0's `trash`
    path data is byte-identical to the `trash-2` path data of 1.31.0 and 1.35.0. Anything
    that already authored `trash` now draws that same artwork, because lucide moved it under
    the `trash` name; a few other glyphs were also redrawn upstream.
  - Icons imported as COMPONENTS carry lucide 1.43.0's own classes: one class per declared
    alias (a spinner renders `class="lucide lucide-loader-circle lucide-loader-2 ..."`), and
    no longer the class lucide used to derive from the PascalCase key where that differs
    (`ArrowDown01` no longer carries `lucide-arrow-down01`). The canonical
    `lucide-<icon name>` class is still there, so a `.lucide-loader-circle` selector still
    matches.
  - Icons resolved from a STRING through the seam keep the classes they had: `lucide`, the
    canonical `lucide-<icon name>` class and the key-derived class. They do not carry
    lucide's per-alias classes. That is a maintainer ruling (objectui#8941, option C): the
    alias list lives only inside each lazily loaded icon module, and it was not moved into
    the eager name list. A selector that targets an alias class matches a component-imported
    icon and not a string-resolved one. This also dates the example in the objectui#9251
    entry: `trash-2` no longer resolves as a string, so no seam-drawn glyph carries
    `lucide-trash2 lucide-trash-2`; a digit-bearing name that still resolves, such as
    `arrow-down-0-1`, carries `lucide-arrow-down01 lucide-arrow-down-0-1`.
- 6c5ee71: `ObjectChart` now depends on the `fieldOptionLabel` resolver directly instead of
  holding it behind a ref, so a chart re-resolves its groupBy option labels when
  the resolver genuinely changes (objectui#5587).
  
  The ref existed for a reason that no longer holds. `useSafeFieldLabel()` returned
  a fresh object on every render outside an i18next provider, so a direct
  dependency made `fetchData`'s `useCallback` identity fresh on every render, and
  the effect that depends on `fetchData` refetched on every render — an unbounded
  loop. `ObjectChart` worked around that locally with `fieldOptionLabelRef` plus a
  `useEffect` keeping it current. `useObjectLabel`'s memo now holds with or without
  an i18next instance bound (objectui#5564), so the resolver's identity is stable
  on both paths and the indirection buys nothing.
  
  It did cost something, and that is the user-visible half: a ref-hidden dependency
  meant `fetchData` did NOT re-run when the resolver changed. A chart mounted
  before its `I18nProvider`, or rendered across a language switch, kept serving
  groupBy labels resolved by the old resolver until some unrelated dependency
  (object name, filter, aggregate) happened to move. It now refetches once on that
  transition and shows labels in the active language.
  
  Pinned by `ObjectChart.fieldOptionLabelRefetch.test.tsx`, which counts fetches
  across forced re-renders both outside and inside a provider. Reverting
  `useObjectLabel.ts` to its pre-objectui#5564 state turns the no-provider case red
  (2 fetches instead of 1, alongside React's "Maximum update depth exceeded"), so
  the removal is pinned to the fix that unlocked it rather than to a comment.
- 93bbc20: Scatter now says when it cannot place a row, instead of drawing an empty axis.
  
  Scatter is the only two-measure positional chart in the renderer: `xAxisKey` feeds
  a numeric X axis and `series[0]` a numeric Y axis, so a point exists only when
  both are numbers. Measured in real Chromium, rows it could not place produced a
  tile byte-identical to a scatter handed no rows at all, and six different
  authoring failures shared one image. A chart with one placeable row among three
  was 99.75% pixel-identical to a genuinely one-row scatter.
  
  Handed rows it cannot place any of, a scatter now renders the file's refusal
  shell under `data-chart-error="no-plottable-points"`, naming both keys. When some
  rows place and some do not it draws as before with a `data-chart-note="unplotted-points"`
  footnote carrying the count. Charts whose rows all place are byte-identical to
  before, and no wrapper element is added to them.
  
  The predicate is positional, not magnitude-based: zero and negative coordinates
  are ordinary scatter data and keep drawing.
- dd35800: `ObjectChart` now renders a self-describing empty state when its query succeeds
  and returns no rows, instead of falling through to a bare chart frame.
  
  The frame was measured in a browser rather than assumed: recharts derives its
  ticks from the data, so with an empty result the bar and line families emit two
  hairline axis rules and no `text` nodes at all, and pie/donut emit nothing —
  there are no labelled axes to tell the reader what would have been plotted.
  Beside the component's own red "Failed to load chart data" box, a blank tile
  gives the reader nothing to distinguish a young chart from a broken one.
  
  The copy is the one `plugin-dashboard` already shows on the dataset-bound path
  ("No data yet" / the load succeeded / the source name), so the same chart over
  the same empty result no longer reads two different ways depending on which
  widget drew it. Charts with inline authored data are unchanged — they ran no
  query to report on.
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3ac2de8]
- Updated dependencies [0aacecc]
- Updated dependencies [63f4f92]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [4c6f549]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [cff4b77]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [1dbb993]
- Updated dependencies [2b5f509]
- Updated dependencies [808f339]
- Updated dependencies [6cf5999]
- Updated dependencies [274e14a]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [544aca2]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [86982ac]
- Updated dependencies [cdefa2a]
- Updated dependencies [0961d5e]
- Updated dependencies [6276478]
- Updated dependencies [5e67837]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [8acc51b]
- Updated dependencies [ea9d17f]
- Updated dependencies [45362a3]
- Updated dependencies [2a943bf]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [ac2d6f1]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [f905090]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [30b11ad]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [3d6badf]
- Updated dependencies [25cb364]
- Updated dependencies [a60539b]
- Updated dependencies [de1b879]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [ad1785c]
- Updated dependencies [3b469c8]
- Updated dependencies [990a2d6]
- Updated dependencies [1c84036]
- Updated dependencies [1c84036]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
- Updated dependencies [f6ae5e2]
- Updated dependencies [eb97ce6]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [244d516]
- Updated dependencies [deca847]
- Updated dependencies [ac15833]
- Updated dependencies [ac15833]
- Updated dependencies [e2dffc9]
- Updated dependencies [328abeb]
- Updated dependencies [dd0d78f]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [e227156]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [e327c89]
- Updated dependencies [2eaf5be]
- Updated dependencies [bf7ab35]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [51c2949]
- Updated dependencies [a4b017e]
- Updated dependencies [8732846]
- Updated dependencies [559a2e2]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [c021b35]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [54997ff]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [1d6a23d]
- Updated dependencies [0645133]
- Updated dependencies [76e9df0]
- Updated dependencies [0ecaa7d]
- Updated dependencies [b24f93a]
- Updated dependencies [6158e4c]
- Updated dependencies [cff8641]
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [858eafb]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
- Updated dependencies [0ffc423]
- Updated dependencies [3cc4fe5]
- Updated dependencies [cd5b19a]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [2e3da72]
- Updated dependencies [1263e40]
- Updated dependencies [e6bc087]
- Updated dependencies [9419df1]
- Updated dependencies [8bab157]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [18d1a0a]
- Updated dependencies [7fed09d]
- Updated dependencies [58da8ae]
- Updated dependencies [a8b9889]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [2124d04]
- Updated dependencies [be52115]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
- Updated dependencies [d0fba91]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [063119f]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [f9c8c4e]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [55d18c6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [c4ab6d0]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [2b188fa]
- Updated dependencies [b654d4e]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [d0097af]
- Updated dependencies [432882b]
- Updated dependencies [64dae8e]
- Updated dependencies [b06e374]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [5ccc500]
- Updated dependencies [f3c2bb0]
- Updated dependencies [978507b]
- Updated dependencies [778138e]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [d796c8d]
- Updated dependencies [594704f]
- Updated dependencies [d3995fe]
- Updated dependencies [1b1d772]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [41b7ce3]
- Updated dependencies [ae476b8]
- Updated dependencies [39f4309]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [7cd3987]
- Updated dependencies [ee3b878]
- Updated dependencies [e304a4e]
- Updated dependencies [fda49e5]
- Updated dependencies [490d9a9]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [95f8704]
- Updated dependencies [f8cdbf2]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [e176053]
- Updated dependencies [e30ed15]
- Updated dependencies [90665e0]
- Updated dependencies [8d3a529]
- Updated dependencies [5ac2e2c]
- Updated dependencies [194fae1]
- Updated dependencies [7e19d03]
- Updated dependencies [b08b7eb]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [6fd2cf7]
- Updated dependencies [5fa06c4]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [129bcc5]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [f8c70f4]
- Updated dependencies [5d3a2d1]
- Updated dependencies [8f1d995]
- Updated dependencies [b362c1b]
- Updated dependencies [f9c34df]
- Updated dependencies [dddb942]
- Updated dependencies [00c665e]
- Updated dependencies [29754cf]
- Updated dependencies [d7de534]
- Updated dependencies [3c2b6f7]
- Updated dependencies [6e88630]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [5961030]
- Updated dependencies [f24de8b]
- Updated dependencies [c8ea8af]
- Updated dependencies [9602dc8]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [30c73cd]
- Updated dependencies [830ed58]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [c71e14d]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [748494b]
- Updated dependencies [5967be0]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [12402a9]
- Updated dependencies [aff3d7a]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [fff9645]
- Updated dependencies [9c3b7ce]
- Updated dependencies [2c1c967]
- Updated dependencies [9486ac6]
- Updated dependencies [9486ac6]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [dc4365c]
- Updated dependencies [e321d52]
- Updated dependencies [969ba84]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [b97790a]
- Updated dependencies [dbd5194]
- Updated dependencies [7c9b044]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [b392674]
- Updated dependencies [4f3a1e2]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [220c18d]
- Updated dependencies [00d3f09]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [3cab570]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [639114c]
- Updated dependencies [1490691]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [78ca238]
- Updated dependencies [d8ec8d6]
- Updated dependencies [351eb31]
- Updated dependencies [866cd1d]
- Updated dependencies [20c04b2]
- Updated dependencies [01c9023]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [8952395]
- Updated dependencies [e2b3826]
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [a4514e8]
- Updated dependencies [db3896c]
- Updated dependencies [b9f5ff1]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [4704aa4]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [72f55c9]
- Updated dependencies [26e06d7]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [3399704]
- Updated dependencies [71a4a53]
- Updated dependencies [7bf244b]
- Updated dependencies [f0bb9fa]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [caa0cd3]
- Updated dependencies [20cb8db]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [77b2a18]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [c2f0f48]
- Updated dependencies [1237ae4]
- Updated dependencies [2f61238]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [9ae871d]
- Updated dependencies [efbd566]
- Updated dependencies [2a5bf45]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [daf9d57]
- Updated dependencies [23b9958]
- Updated dependencies [c15d7ec]
- Updated dependencies [5d0876c]
- Updated dependencies [f7ace0a]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [2ce2612]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
- Updated dependencies [2af1fa7]
- Updated dependencies [c14d3a0]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [c907a9c]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [91f9276]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [a915064]
- Updated dependencies [dcbf0b2]
- Updated dependencies [52cac38]
- Updated dependencies [93fea2e]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [d1bebb0]
- Updated dependencies [95bf128]
- Updated dependencies [335abea]
- Updated dependencies [edea22a]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [e1c27e4]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [a695f50]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [6e9a3d4]
- Updated dependencies [4a292d2]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [abc1b18]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [c300267]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [7c9145f]
- Updated dependencies [1570eac]
- Updated dependencies [f391ede]
- Updated dependencies [f5cfbbd]
- Updated dependencies [f5cfbbd]
- Updated dependencies [8b532cb]
- Updated dependencies [64c3cdd]
- Updated dependencies [4d65991]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [676f677]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [55ba3ff]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [e82dad1]
- Updated dependencies [58b7b3d]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [19a0b0e]
- Updated dependencies [526fc11]
- Updated dependencies [f8e3e9a]
- Updated dependencies [b9d47ec]
- Updated dependencies [3b6bc69]
- Updated dependencies [6214db6]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [da45e6b]
- Updated dependencies [7533465]
- Updated dependencies [835f0f3]
- Updated dependencies [a9d97be]
- Updated dependencies [ed35b44]
- Updated dependencies [9ba7e9c]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [6748587]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [2bf34f7]
- Updated dependencies [15b33ae]
- Updated dependencies [7cbc724]
- Updated dependencies [7098eed]
- Updated dependencies [3df7c5c]
- Updated dependencies [fb91ac9]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [4598f6d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [44152c4]
- Updated dependencies [3939545]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [c698a81]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
- Updated dependencies [60500cb]
- Updated dependencies [2fcefb9]
- Updated dependencies [77f846a]
- Updated dependencies [bc5870c]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [f760064]
- Updated dependencies [dd19463]
- Updated dependencies [6791717]
- Updated dependencies [8ea3bee]
- Updated dependencies [100547e]
- Updated dependencies [3a58149]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [2c8474c]
- Updated dependencies [6ce89da]
- Updated dependencies [0e05aac]
- Updated dependencies [ae61ad4]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [7102b20]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [c40f3b8]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [b655a9d]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [6a576c9]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [fffa30d]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [9d9040d]
- Updated dependencies [20e317c]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [de570cc]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [19cbf10]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [fd8dace]
- Updated dependencies [72ffc34]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [bf28341]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [42887e0]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [38a9568]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [2d36552]
- Updated dependencies [45d8288]
- Updated dependencies [b2437a7]
- Updated dependencies [f157423]
- Updated dependencies [7a90afd]
- Updated dependencies [eddc1dd]
- Updated dependencies [490f482]
- Updated dependencies [27308c5]
- Updated dependencies [8689166]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [9101be5]
- Updated dependencies [f53a8d0]
- Updated dependencies [968dc1e]
- Updated dependencies [57f9b07]
- Updated dependencies [3c73d99]
- Updated dependencies [d91aed9]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [c86185e]
- Updated dependencies [fb96ecb]
- Updated dependencies [1170ed1]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/components@17.7.0

## 17.6.0

### Minor Changes

- 9ce096f: Give a chart bucket an identity distinct from its display label
  
  objectui#4508. `buildChartSeries` used the bucket's DISPLAY string as the
  bucket's own key, so two pairs of genuinely different groups were conflated —
  and the segment click that drills a bar back to its records inherited both
  conflations. The maintainer ruling (2026-08-14) approved the sentinel-identity
  direction, aligning the chart branch with the distinct-bucket-id form the pivot
  TABLE (`buildPivot`) already uses over the same dataset rows.
  
  Two collisions, one cause:
  
  - **A null group and an empty-string group drew ONE bar.** The pivot branch
    keyed buckets by `String(xRaw ?? '')`, which spells `null` and `''`
    identically. The bar took its label from whichever row created the bucket, and
    the other group's segment then resolved to no row at all — a visible bar whose
    click did nothing.
  - **A record whose stored value spells the bucket label stole the null bucket's
    drill.** A row storing the literal text `(None)` (or any localized
    `chart.nullCategory` — `(未指定)` and the other nine packs) kept its own
    bucket, so two bars carried the same axis text and BOTH resolved to the first.
    That one is a wrong drill, not a dead one: clicking the null bucket's bar
    opened the drawer on another group's records.
  
  What changed:
  
  - **`chartBucketId`** (`@object-ui/core`) is the bucket identity — the SAME
    encoder `buildPivot` keys its buckets with (`pivotBucketId` over
    `pivotDimensionValue`), so the two surfaces stop answering one question two
    ways. The pivot branch now buckets by it, which is what makes null and `''`
    two groups again.
  - **`CHART_BUCKET_ID_KEY`** carries that identity on an emitted row, written
    exactly where two DISTINCT buckets paint the same axis text — the complete set
    of cases where the display string cannot name what was clicked. An ordinary
    chart's rows are returned untouched (by identity), so no renderer-internal key
    reaches an authoring surface.
  - **`findChartSeriesRow`** takes that identity back as `options.bucketId` and
    treats it as authoritative. The renderers forward it: the drill event gains
    `categoryId` (`ChartSegmentClickEvent`, now declared once in
    `@object-ui/core` instead of inline in three packages), `AdvancedChartImpl`
    reads it off the clicked row on the cartesian, pie and funnel paths, and
    `DatasetWidget.handleChartDrill` hands it to the lookup.
  
  Behaviour change worth noting: an empty-string category no longer resolves to a
  null-valued row. That tolerance was justified as the drill layer's own spelling
  of "no group value", but no producer of this lookup's `category` writes it,
  while `''` IS the axis text a genuine empty-string group paints — so the
  tolerance was giving that group's bar a different group's records. A host that
  forwards no `categoryId` keeps its existing drill unchanged.

### Patch Changes

- e132433: A grouped chart whose SECOND dimension was never projected says so instead of
  drawing an empty frame.
  
  "Cannot know refuses loudly" was answered on the first dimension only.
  `AdvancedChartImpl`'s `hasNoCategoryKey` (framework#4033) names an unprojected
  x-axis dimension rather than drawing a bare axis; the series axis had no
  counterpart, so a pivot whose second dimension was absent from the result rows
  produced `series: []` and rendered axes, grid, tooltip and legend around zero
  marks — indistinguishable, to the author, from "no data matched".
  
  Such a chart now renders the same explanatory placeholder
  (`data-chart-error="no-plottable-series"`) and logs the same diagnostic pair the
  category-axis guard logs: the axis it did plot, and the keys its rows actually
  carry.
  
  The three-way distinction is unchanged and pinned: null / empty-string group
  values still DRAW (they are real groups with real buckets), a partially
  projected group key still draws what projects — mirroring the category axis,
  which refuses only when NOT ONE row carries the key — and an ordinary pivot
  renders unchanged. The refusal is limited to the families whose marks come from
  `series` and nothing else (bar, horizontal-bar, line, area, combo); pie, donut,
  funnel, radar and scatter draw from a `value` column with no series declared, so
  they are untouched. A caller that computed no series binding at all
  (`series === undefined`) is also untouched.
- f95434b: Combo charts drill from their marks
  
  objectui#4692, ruled Option B. `AdvancedChartImpl` built `cartesianClickProps` once and
  applied it to exactly one element — the final cartesian `ChartComponent`. The `combo`
  branch returns earlier, from its own `ComposedChart`, which was rendered with `data` and
  no click props at all, so a combo chart fired `onChartClick` never: not on a mark, not on
  the axis. Its marks are the same `Bar` / `Line` / `Area` components the drillable branch
  renders.
  
  The trap that made this worth fixing rather than documenting is that the family is
  **derived**, not only authored: `effectiveChartFamily` resolves a chart to `combo`
  whenever its series declare different families (objectui#2945), so adding `type: 'line'`
  to one series of a drillable bar chart silently turned that chart's drill-through off —
  nothing in the authored spec said drill had been touched, and nothing errored.
  
  A combo's `Bar` / `Line` / `Area` marks now emit `{ category, categoryId, series, value }`
  with the same semantics the plain cartesian branch gives, reusing the item-level
  series-identity machinery from objectui#4672 / objectui#4682: the mark handler records the
  series it was rendered with, the chart-level handler composes the one event, so a gesture
  still produces exactly one `onChartClick`. Retyping one series now changes that series'
  mark and nothing else.
  
  **Only the marks drill.** A click on a combo's plot surface or axis stays silent, where
  the plain cartesian branch falls back to its axis-level answer. A combo plots several
  measures on one plot, so a surface click there has no single series to report and the
  fallback would have to invent one — the same reasoning objectui#4672's ruling gave the
  pivoted case. Combo also carries no chart-wide pointer cursor for that reason; the
  affordance sits on the marks that answer.
  
  Radar is now the one cartesian-adjacent family with no click wiring. The `onChartClick`
  doc comment, corrected in objectui#4705 to say combo was a no-op, states the new rule and
  its one deliberate exception.
- e05db88: A clicked cartesian mark names its own series, and the drill title reads its label
  
  objectui#4672, objectui#4682.
  
  **The dead pivoted drill.** objectui#4680 fixed what a cartesian click could
  read out of recharts 3's `MouseHandlerDataParam`, and measured the wall it could
  not get past: a chart-level click is an AXIS interaction, and recharts
  dispatches those with `activeDataKey` hard-coded `undefined`, because the shared
  cursor spans every series at that tick. A pivoted dataset chart — 2 dimensions,
  1 measure, the shape ADR-0021 introduced — needs the series to resolve its drill
  row, so every segment of every such dashboard chart stayed a dead click. The
  series was left unresolved rather than guessed, and the card carried the rest.
  
  The answer is the mark itself. This renderer draws the `Bar` / `Line` / `Area`,
  so an item-level `onClick` closes over the very `dataKey` it was rendered with —
  the series is statically known, not inferred from tooltip state.
  
  Both handlers fire for one gesture (measured: item first, chart second, sharing
  one `nativeEvent` object), so the item handler does not emit. It RECORDS its
  series, stamped with that gesture, and the chart-level handler composes the one
  event. That is the double-fire answer and the additive property together:
  
  - **one click, one drill event**, because there is one emit site — not a second
    event suppressed after the fact;
  - **a click that lands on no mark is untouched**: it records nothing and falls
    through to the objectui#4680 axis answer exactly as shipped — category, bucket
    identity, and the series only where one series is plotted. Empty plot area
    stays category-only, and "drill the whole category" was rejected as a
    different product question. Nothing that resolved before stops resolving; a
    line's `dot={false}` stroke simply GAINS the exact series where it is hit;
  - pairing on the shared DOM event rather than on a flag means a record left by
    one gesture can never be adopted by a later click.
  
  The clicked key is forwarded exactly as rendered, `''` included: the
  empty-string second-dimension group draws its own bar since objectui#4673, and
  `''` is falsy, so a truthiness test on the way out would send no series at all
  and leave that bar's drill standing on the reader's coercion instead of on what
  was clicked.
  
  **The opaque drill title.** `ChartSegmentClickEvent` gains `seriesLabel`, and
  `DatasetWidget`'s drill drawer titles itself from `seriesLabel ?? series`.
  `ev.series` stays the LOOKUP key — `findChartSeriesRow` resolves it through the
  same assignment `buildChartSeries` made — and only the title reads the label.
  
  The two strings are equal for every ordinary group, which is why reading the key
  as a title went unnoticed. They part company when a group's label cannot name
  it: the null bucket beside a record whose stored value literally spells
  `(None)`, which is objectui#4508's collision on the series axis, reachable since
  objectui#4673. Both groups then key by `chartBucketId`, and the drawer opened on
  the right records under the title `Backlog / [null]`. An internal id where a
  label belongs reads as broken DATA rather than as a broken title.
  
  Neither string can do the other's job, which is why this is a second field
  rather than a change to the first: the label is not resolvable (it is exactly
  what the colliding groups share) and the key is not showable. `seriesLabel` is
  optional and absent wherever a renderer resolved no label, so every other
  chart's title is byte-identical.
- d298be8: Cartesian chart clicks report the clicked series and value again
  
  objectui#4672. `AdvancedChartImpl`'s chart-level click handler built its drill
  event from `payload.activePayload[0]` — a **recharts 2** field. This package is
  on recharts 3, which hands a chart-level `onClick` a `MouseHandlerDataParam`:
  `{ activeCoordinate, activeDataKey, activeIndex, activeLabel, activeTooltipIndex,
  isTooltipActive }`, and nothing else. `activePayload` appears nowhere in the
  shipped library, so the read was `undefined` on **every** cartesian click and
  every bar / line / area drill event carried `series: undefined, value: undefined`.
  Nothing went red: the payload is typed `any` at the call site, and every existing
  drill test either calls the pure lookup directly or stubs the chart.
  
  The handler now works from the payload recharts 3 actually sends:
  
  - **The value** is read off the clicked row — `data[activeTooltipIndex]`, the
    array this component was given — for the resolved measure, the same way the
    bucket identity has been read since objectui#4508.
  - **The series** comes from `activeDataKey` when the payload carries one, and
    otherwise from the chart's own series list when it plots exactly one series,
    where the clicked column can belong to nothing else.
  - **A click with no active tick** (the plot margins, an axis label) resolves to
    no row instead of to bucket zero. recharts reports a **null** index there, not
    an absent one, and `Number(null)` is `0` — so such a click used to drill the
    first bucket's records. That is a wrong drill, not a dead one.
  
  A drill on a single-measure chart therefore names its measure and carries its
  value again — `resolveDrillTitle` composes the drawer title from them, and an
  authored drill filter can reference `${event.value}`.
  
  **Still open, deliberately:** a chart plotting several series under the default
  SHARED cursor. Measured against recharts 3.10.1, an axis interaction is
  dispatched with `activeDataKey` hard-coded `undefined` (bar, line and area
  alike, on the mark and on empty plot area), so the payload names no series at
  all — and a pivoted dataset chart's drill lookup requires one. The series is
  left unresolved rather than guessed: naming a series the user did not click
  drills to another group's records, which is worse than the dead click. Resolving
  it needs the clicked mark rather than this payload; objectui#4672 carries that
  half.
- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [2533ec5]
- Updated dependencies [78c0f9a]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [2e82ab2]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [ef0d150]
- Updated dependencies [f34226e]
- Updated dependencies [564b605]
- Updated dependencies [e1d4251]
- Updated dependencies [40d3a33]
- Updated dependencies [8b9dc62]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [a1609a6]
- Updated dependencies [53f23bc]
- Updated dependencies [c4533dc]
- Updated dependencies [be60815]
- Updated dependencies [37f6844]
- Updated dependencies [93de4f6]
- Updated dependencies [2b50261]
- Updated dependencies [384f30d]
- Updated dependencies [ac600e5]
- Updated dependencies [97fba31]
- Updated dependencies [232f61a]
- Updated dependencies [d374caf]
- Updated dependencies [5673576]
- Updated dependencies [c1ef923]
- Updated dependencies [911ceaa]
- Updated dependencies [98eab36]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [0046d8f]
- Updated dependencies [f1d4748]
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [d109a4d]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [8c0d52e]
- Updated dependencies [aff10e2]
- Updated dependencies [70a774b]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [7458a41]
- Updated dependencies [ad13d63]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [9c60144]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [75444e3]
- Updated dependencies [58b8346]
- Updated dependencies [2d0bd16]
- Updated dependencies [a9e17b4]
- Updated dependencies [b8ce7dc]
- Updated dependencies [dad51e5]
- Updated dependencies [1c9c342]
- Updated dependencies [787c738]
- Updated dependencies [8396656]
- Updated dependencies [dbbd38a]
- Updated dependencies [8871c14]
- Updated dependencies [93fe362]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [144ef9b]
- Updated dependencies [138ab04]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
- Updated dependencies [21e4585]
  - @object-ui/types@17.6.0
  - @object-ui/i18n@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0

## 17.5.0

### Minor Changes

- 5fac011: Publish `normalizeChartSchema` from the package entry.

  `normalizeChartSchema` is the single place the author-facing chart schema is translated into the renderer's internal pipeline contract, and `ChartRenderer` calls it on every render. It was not reachable from the package's only entry point, so a consumer that wanted to assert what `AdvancedChartImpl` is actually handed had to restate the translation rather than run it. It is now exported from the entry, along with the `NormalizedChartSchema` type it returns.

  Additive only: nothing is removed or renamed, and the module was already in the entry's eager import graph via `ChartRenderer`, so this publishes a name rather than shipping new bytes.

### Patch Changes

- 5900ac5: Analytics surfaces now run resolved select-option labels through the locale bundle — the chart legend and the related list on one page stop disagreeing

  A dashboard widget grouped by a `select` field rendered the option's authored English label while the related list beside it rendered the translation. The decisive evidence in objectui#4030 is the stored value `orion`: the chart read `Orion Engineered Carbons`, a string with no resemblance to the value and matching the object's `label` byte for byte. So the analytics path had already RESOLVED the option label — it simply never ran the result through the i18n bundle before display. (`domestic → Domestic` differs from its value by case alone, which is why the first diagnosis, "the report groups by stored value", was wrong.)

  There is exactly one resolution channel and this change reuses it rather than adding a chart-side dialect: `fieldOptionLabel` from `useObjectLabel`, i.e. `{ns}.fieldOptions.<object>.<field>.<value>` — the convention `@objectstack/spec` names objectui as the reader of, and the one list, form, kanban and record-picker surfaces already translate select options through. The bundle is applied ONCE, at the output of the label net that landed in objectui#4053/#4263, on the shared option list every consumer reads: chart axis and legend, the table/pivot cells of a dotted dimension, that table's CSV export, per-category colours and the declared category order. `@object-ui/core` gains `localizeFieldOptions` (the pure mirror of `translateOptions`), an optional translator on `buildDimensionLabelMap`, and `resolveDimensionFieldMeta` — the same single relationship walk `resolveDimensionFieldOptions` performs, now keeping the object that OWNS the terminal field, because for `crm_account.industry` the bundle key is `crm_account`, not the dataset's base object.

  Two properties the fix is shaped around. The rows reach this net keyed either way — by stored value when the server did not resolve the dimension, by the English label when it did (ADR-0021) — and the reported screen is the second case, so the map answers to both keys and lands on the same translated display. And identity is untouched: `relabelDimensions` still rewrites display only, so a drilled chart segment clicked as `欧励隆` filters by `orion`, bucket ids and pivot totals keep their raw keys, and an option with no bundle entry (or an `en` console) renders exactly the authored label it renders today.

  The per-locale work moved from the metadata fetch into the render, so switching language now re-labels in place instead of waiting for a refetch.

  Not covered, and unchanged here: a LOCAL select dimension on a table/pivot, whose label the server resolves and whose client-side net is deliberately off (objectui#4263), and a dashboard global filter's own field label, which has no object name in its metadata to key a bundle lookup with — tracked on objectui#4030.

- 3fc2971: A null-keyed group renders as an explicit bucket instead of silently vanishing from a chart (objectui#4466)

  `buildChartSeries`' single-dimension branch passed rows through verbatim, so a row whose category VALUE is `null` reached recharts with a null category and drew no mark. The visible outcome was not an empty chart but a quietly wrong one: rows `[{user_id: null, event_count: 51}, {user_id: 'Dev Admin', event_count: 2}]` drew exactly ONE bar — the dominant group, 51 of 53 events, dropped while the y-axis scale still accommodated it, so the chart understated its own data and the axis proved the data had been there. With every group null it drew axes, gridlines and an axis title with zero marks and no empty state, which is the shipped first-boot state of the built-in System Overview board's "Events by User" (every seeded `sys_audit_log` row is written with `user_id = NULL`).

  The mapping lives in the shared series layer, so dashboard widgets and standalone `ObjectChart` get one answer rather than a per-chart patch in the recharts wrapper. It resolves the two-answers disagreement the card names as well: an empty result set keeps the designed empty state, a non-empty result always draws bars — the null bucket included.

  `@object-ui/core` gains `NULL_CATEGORY_LABEL` and `ChartSeriesOptions`; `buildChartSeries` and `findChartSeriesRow` each take an optional trailing `options`. Both additive — every existing call site compiles and behaves identically, and a result with no null category is still returned by array identity. The two helpers are a pair on purpose: the caller matches a clicked segment against rows that still carry the raw `null`, so `findChartSeriesRow` reads the bucket label back to that row and the newly-visible bar keeps its drill-through instead of resolving to `-1`.

  The label goes through the i18n channel (`chart.nullCategory`, en `(None)` / zh `(未指定)`, all ten packs), passed down by the renderer: `@object-ui/core` is React-free and cannot read the locale bundle, so it takes the resolved string the same way `dimensionOptionTranslator` takes a resolver. Its English constant is the floor for a provider-less host, not the mechanism.

  `hasNoCategoryKey` (framework#4033) is untouched and now documented against this: a row that does not carry the category key AT ALL is a different defect — a dimension grouped by but never projected — and keeps its explanatory placeholder. The bucket deliberately never ADDS the key to such a row, which is what keeps that guard's signal alive. Key absent → the placeholder; key present with a null value → the bucket.

- aca27fa: The multi-dimension pivot branch buckets a null first-dimension value instead of dropping its bar (objectui#4497)

  `buildChartSeries`' pivot branch (2+ dimensions, single measure) bucketed rows by `String(xRaw ?? '')` but wrote the RAW value into the emitted row, so a null first-dimension value produced `{status: null, Low: 3}` and reached recharts with a null category — which draws no mark. Measured at the DOM: a two-group pivot drew ONE bar, and an all-null pivot drew axes and gridlines with zero bar rectangles and no empty state. That is the same mechanism objectui#4466 fixed one branch below, on the branch that card deliberately left pinned as-is until the pivot's own bucketing had been measured.

  The pivot now maps a null/undefined first-dimension VALUE to the same bucket label the single-dimension branch uses — `ChartSeriesOptions.nullCategoryLabel`, defaulting to `NULL_CATEGORY_LABEL`. One doctrine, one predicate, two call sites; no new export, and every existing call site compiles and behaves identically.

  The bucket KEY is untouched, which is what keeps this a display fix: `String(xRaw ?? '')` still decides which rows share a bar, so every existing grouping is byte-identical and only the label the bucket carries changes. Rows that lack the category key entirely are still not bucketed — that shape is a dimension grouped by but never projected (framework#4033), a different defect with a different answer.

  Drill-through needed no change, which was measured rather than assumed: the pivot's emitted rows are AGGREGATED, so they are not index-aligned with `drillRawRows` and the one production caller (`DatasetWidget.handleChartDrill`) already drills by SEARCHING the raw rows through `findChartSeriesRow`. Those raw rows still carry their null, and objectui#4466's label-matching covers the multi-dimension arm as well as the single-dimension one, so the newly-visible bar resolves to the right record. Pinned at both levels so a regression in either half surfaces as the dead click it would be.

- 613b167: A dataset dimension on a dotted relationship path now renders its option labels instead of the raw stored enum

  A `DatasetDimension` whose `field` is a relationship path (`crm_account.industry`) got no select-option resolution at all: the chart plotted `education`, `finance`, `manufacturing` — the database column, unresolved — while the **same underlying field** reached as a **local** dimension rendered `Education`, `Finance`, `Manufacturing` beside it on the same dashboard. Nothing errored, so the widget just quietly showed database enum values to end users; on a non-English deployment those are words that appear nowhere else in the UI, since every form and list shows the translated label.

  The label lookup read options as `baseObject.fields[<path>]`, which only ever matches the local spelling. For a dotted path the options live on the **related** object, so the lookup missed and the renderer fell through to the stored value.

  The object-resolution step of that one lookup now walks the path: each segment before the last must be a declared relationship (`lookup` / `master_detail`, target read from `reference` / `reference_to` / `referenceTo` / `reference_to_object`), and the terminal field's options are read off the object that actually owns it. This is the same lookup for both spellings rather than a dotted-path variant beside it — a single-segment path never enters the walk and resolves exactly as before, so the local and joined paths cannot drift apart. Multi-hop paths (`crm_account.owner.department`) resolve too, which is the shape the dataset designer already emits.

  Hops ride the caller's existing `GET /meta/object/:name` channel — the same authenticated read that fetched the base object — so no new fetch layer is introduced, and objects are fetched once per resolution even when several dimensions share a prefix. Every failure stays best-effort: a segment that is not a relationship, a target that cannot be loaded, or a terminal field with no options yields no mapping and the raw value survives, exactly as it does today.

  Applies to both surfaces that carried this lookup: dashboard dataset widgets (`DatasetWidget`) and the chart view's dataset path (`ObjectChart`).

  Scope: this ends at "the label is in hand". Whether that label then passes through the i18n bundle is a separate gap tracked upstream as objectstack#5076.

- 0b49d60: Analytics: `ObjectChart` consumes the shared label-net helpers instead of a third copy

  objectui#4389 (PR #4404) named two copies of the analytics label-net glue — the dashboard's `DatasetWidget` and plugin-report's dataset block — and retired both into `@object-ui/core` + `@object-ui/react`. There was a THIRD, which that card did not name and its PR deliberately left out of scope: `packages/plugin-charts/src/ObjectChart.tsx` carried its own `translatorFor` closure, its own `buildDimensionLabelMap` loop, and its own base-object-read-then-walk composition. The `translatorFor` copy was logically identical to the two that were deleted, down to the comment explaining the binding.

  `ObjectChart` now calls core's `dimensionOptionTranslator`, `deriveDimensionLabelMaps` and `loadDimensionFieldMeta` directly. Nothing about what a label IS changes — those helpers are the same code the two retired copies were rewritten onto, so the part that was genuinely duplicated three times is now written once.

  Behaviour is unchanged by construction: same two metadata reads in the same order on the dataset path, same one read on the aggregate path, same best-effort fallback (an unresolvable path yields no entry and the raw value survives), same locale-applying memo boundary. `plugin-charts`' 22 test files / 170 assertions pass unchanged and their files are byte-identical to before, which is the acceptance evidence for a pure swap.

  The card's second, optional step — moving the DATASET path's metadata read onto `@object-ui/react`'s `useDatasetDimensionMeta` — was attempted and declined on measurement; the shape blocker is recorded on objectui#4405 and in the PR. The two bug-fix properties the family exists to state (the read rides the host's authenticated `apiFetch`, objectui#4121; the fetched metadata stays locale-free, objectui#4030 / PR #4324) therefore remain stated locally in this file, exactly as before, and are undisturbed by this change.

- bcd3e02: `ObjectChart`'s category option-color / dimension-label probe now rides the host's
  authenticated fetch (`SchemaRendererContext.apiFetch`) instead of the bare global
  `fetch`.

  Both metadata reads the effect makes — `GET /api/v1/meta/dataset/{dataset}` and
  `GET /api/v1/meta/object/{object}` — went out on the global `fetch`, so in a hosted
  console they skipped whatever the host supplies on that channel (Authorization /
  tenant headers, base-URL rewrite, draft-preview params). A bearer-token session
  carries its credential in a header rather than a cookie, so `credentials: 'include'`
  alone left these two reads unauthenticated. The effect is best-effort and swallows
  every failure, which made the symptom silent: semantic option colors and dataset
  dimension labels simply never applied, and the chart fell back to the positional
  theme palette and raw stored values.

  Standalone embeds are unaffected — with no provider (or a provider that supplies no
  `apiFetch`) the probe still uses the global `fetch`, the same documented fallback
  `useRecordEditable` and `provider: 'api'` view sources use.

- Updated dependencies [0e67b53]
- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [cb13400]
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [5cc847c]
- Updated dependencies [fa21254]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [6d641c9]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [c0f9a4b]
- Updated dependencies [b1e42d0]
- Updated dependencies [2459a3e]
- Updated dependencies [ac853ce]
- Updated dependencies [fa51109]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [d46f9b8]
- Updated dependencies [3f5f87c]
- Updated dependencies [2fea4d2]
- Updated dependencies [f5e1143]
- Updated dependencies [7f1cb33]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [2e3b0c0]
- Updated dependencies [9461dd3]
- Updated dependencies [78fa331]
- Updated dependencies [47f551b]
- Updated dependencies [31ab1ac]
- Updated dependencies [0082db8]
- Updated dependencies [ab04728]
- Updated dependencies [5bf09fd]
- Updated dependencies [06915b0]
- Updated dependencies [ff84b05]
  - @object-ui/i18n@17.5.0
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Patch Changes

- a7e39a8: `ChartContainer`'s min-size fallback survives a consumer-supplied `style` (objectstack#7026)

  The container wrote `style={{ minHeight: 280, minWidth: 0, ...props.style }}` and
  then spread `{...props}` on the line BELOW it. `props` is the rest of
  `ComponentProps< "div" >` — only `id`, `className`, `children`, `config` and
  `disableSettleRemount` are destructured out of it — so it still carried the
  consumer's `style`, and a later JSX attribute of the same name replaces an earlier
  one outright. Any caller that passed a `style` therefore replaced the whole object:
  both `minHeight` and `minWidth` vanished, and the `...props.style` merge written
  inside it never executed even once. It was dead code that read, to anyone auditing
  the file, as if the fallback were guaranteed.

  That fallback is not decorative. It exists so Recharts' `ResponsiveContainer`
  always has a non-zero box to measure: a dashboard widget that overrides the
  container's `h-[350px]` class and wraps the chart in flex/grid without an explicit
  child height leaves the box at 0, Recharts measures `width/height = -1`, and the
  chart renders invisibly — the exact failure the guard was added for.

  `style` is now destructured out of the rest props and merged explicitly, so which
  side wins is stated in code instead of being decided by JSX attribute order, and
  `{...props}` can no longer reach `style` at all.

  Precedence: **an author's explicit size wins.** Simply spreading `{...props}`
  first and merging unconditionally would have traded this bug for its mirror image
  — `minHeight: 280` injected next to an authored `height: 100` floors that 100 to
  280, silently overriding the author. So each half of the fallback applies only
  when the consumer style declares neither of its own keys: `height`/`minHeight`
  gate the height half, `width`/`minWidth` gate the width half, and a key present
  but set to `undefined`/`null` counts as not declared. Every other consumer style
  key passes through untouched.

  Behaviour change surface, deliberately narrow. A caller that supplies no `style`
  is byte-for-byte unchanged. A caller whose `style` declares a height — which today
  is the only shape in the tree, `AdvancedChartImpl`'s `containerProps` forwarding
  `ChartConfig.height` — keeps exactly the height it authored, also unchanged, and
  additionally regains the `minWidth: 0` half. What changes is the case the issue
  was filed for: a `style` carrying no size key (a margin, a padding, an
  aspect-ratio, any future container-level presentation prop routed through the same
  `containerProps` path) now keeps the min-size fallback instead of silently
  stripping it.

  Pinned in both directions, since a one-sided pin would have been satisfied by the
  mirror-image fix: a non-size `style` keeps `min-height: 280` / `min-width: 0`
  (red before this change), and an explicit `height: 100` renders as 100 with no
  `min-height` floor (red under the unconditional-merge alternative).

- 4bc6c23: Converge dashboard widget `compareTo` on the executor's `{ kind, dimension? }` contract, and make the dataset path actually render a comparison

  `CompareToConfig` was a three-branch union (`'previousPeriod' | 'previousYear' | { offset }`). `@objectstack/spec` collapsed it to the shape the analytics executor already implements — `DatasetCompareTo`, a plain strict object `{ kind: 'previousPeriod' | 'previousYear'; dimension?: string }` (objectstack#5011) — so this renderer now reads that one shape:

  - `shiftFilterByCompareTo` / `compareToTrendLabelKey` dispatch on `compareTo.kind`. The `{ offset }` duration shift is gone: `{ offset: '1y' }` is `kind: 'previousYear'`, while `'7d'` / `'1M'` have no faithful target and are restated by the author on the widget's own `filter` plus `kind: 'previousPeriod'`. No trend label key is retired — the offset arm resolved to `vsPreviousPeriod`, which survives as the `previousPeriod` fallback.
  - `DatasetWidget` no longer discards part of `compareTo`. It used to forward only the object form because the two string forms had no meaning downstream; with one shape there is nothing to discard, and a stale string is now invalid metadata rejected where it is authored rather than silently reinterpreted here.
  - **The comparison now actually runs on the dataset path.** A widget states its window in its own `filter` (a date macro, or the dashboard date-range filter merged in), but the executor shifts a `timeDimensions` entry carrying a `dateRange` — so a dataset widget asking for a comparison got "compareTo needs a dated window to shift" and rendered none. When (and only when) a comparison is requested, the resolved filter's bounded date windows are lowered into `selection.timeDimensions[].dateRange` and moved out of `runtimeFilter` (a copy left behind would intersect the shifted window with the current one and empty every comparison column). Which dimension gets shifted stays the executor's decision: every window found is lowered under the name the author wrote, and zero or two candidates surfaces the executor's own error, listing them.
  - The `<measure>__compare` columns that come back are now shown: a delta + window label on KPI widgets, a comparison column on tables, and a `variant: 'comparison'` overlay series on charts — the same treatment and the same `dashboard.trend.*` labels the inline object-provider widgets already use.

- 5bfaabd: `PageComponentSchema.dataSource` now reaches every object-bound block, not just
  `list-view` — and `element:record_picker` stops discarding `view`
  (objectstack#6953).

  objectstack#5576 wired the spec's per-element data binding
  (`dataSource: { object, view?, filter?, sort?, limit? }`) to `list-view` and left
  the same declaration inert on every other page component. Two gaps remained, and
  both were silent:

  - **`element:record_picker` read four of the five keys and dropped `view`.** So
    `dataSource: { object: 'account', view: 'hot' }` — the spec's own example —
    built a picker over EVERY account instead of the rows the saved view selects.
    Nothing threw and nothing rendered an error; the option list was simply wider
    than what was authored, which also means a user could select a record the page
    said was out of scope.
  - **`object-grid` / `object-form` / `object-kanban` / `object-calendar` /
    `object-chart` / `object-metric` / `record:related_list` read none of it.**
    Each gates its fetch on its own `objectName`, and nothing mapped
    `dataSource.object` onto it, so a page written the way the spec documents
    rendered an empty grid / a field-less form / a board with no cards / an empty
    month / an empty chart / a static metric number — with no request and no
    diagnostic anywhere. Spec-valid metadata rendering nothing is the
    objectstack#4413 shape.

  Composition follows objectstack#5576's landed semantics unchanged on every block:
  a named saved view supplies the baseline, a key written on the component itself
  overrides it, an explicit binding key overrides both, `filter` AND-combines
  ("additional filter criteria" — a binding can narrow a view, never widen it), and
  a `view` name that does not resolve renders a configuration error instead of
  degrading to the object's full scope.

  - `@object-ui/react` — new `useElementDataSourceSchema(schema, mapping, dataSource?)`
    and `ElementDataSourceGate` apply a resolved binding to the schema keys a given
    block reads, plus `ElementDataSourceErrorPanel` / `ElementDataSourceLoadingPanel`
    for the two non-final states. One precedence table for all blocks rather than
    one copy per block — that copy is how "additional filter criteria" would have
    become two dialects.
  - A mapping names **only** keys its block genuinely reads. A composed value
    written onto a key the block ignores would be accepted and dropped, which is
    the defect being removed, one layer deeper — so a kanban's swimlane `columns`
    never receive a view's field list, and a block with no row cap leaves `limit`
    unmapped. The per-block coverage table, including two residual gaps that are
    named rather than papered over, is in `content/docs/guide/data-source.md`.

  No behaviour changes for a block that carries no `dataSource`: the binding-free
  path returns the schema by reference, so nothing remounts and nothing refetches.

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [7864f03]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [ecae400]
- Updated dependencies [4bc6c23]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [f5f8744]
- Updated dependencies [7ed3360]
- Updated dependencies [69becd2]
- Updated dependencies [5e52495]
- Updated dependencies [0fa5e4d]
- Updated dependencies [b750823]
- Updated dependencies [5bfaabd]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [e24d767]
- Updated dependencies [8c60819]
- Updated dependencies [aca561a]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [48132f7]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [0ef9dfd]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [6d762da]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [f9faa7d]
- Updated dependencies [97b63d7]
- Updated dependencies [6bb454a]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0

## 17.3.0

### Minor Changes

- 9e9e9a9: `DrillDownConfig` now declares only keys a renderer reads, and `target: 'navigate'` is honoured on charts too (#3354).

  **Removed — two keys no renderer has ever read.** `DrillDownConfig.view` (self-described as "reserved") and `DrillDownConfig.sort` ("default sort applied to the drill list") had zero read sites repo-wide: the drill drawer rendered its inline `object-data-table` regardless of `view`, and no widget put `sort` into the drilled table schema. Authoring either did nothing, silently. They are removed rather than implemented because nothing asked for them, and this interface is the shape the protocol's own `drillDown` declaration is being derived from (objectstack#5022) — left in place, they were about to become dead keys carrying protocol authority. Removing a declared key from a published interface is technically breaking for anyone who wrote one, but only in the sense that TypeScript now reports what was already true at runtime: the key did nothing. Per this repo's version policy the bump stays `minor` (the fixed release group tracks `@objectstack`'s major). A compile-time pin in `@object-ui/types` keeps both keys from drifting back without a reader.

  **Fixed — `ObjectChart` no longer degrades `target: 'navigate'` to a drawer.** All five widgets share `DrillDownConfig`, whose `target` JSDoc promises `'navigate'` skips the in-place view and opens the object's full list page when the host provides drill navigation. `DrillDownDrawer` delivered that for the table / pivot / metric widgets, but `ObjectChart` draws its own drawer and branched on `'dialog'` only — so `'navigate'` fell through to the default side sheet, indistinguishable from `'drawer'` even with a host handler wired. The chart now routes `'navigate'` through `DrillNavigationContext.openRecordList` with the same merged filter the drawer would have used, and keeps the documented fallback: with no host navigation handler it degrades to the drawer. `'drawer'` / `'dialog'` behaviour is unchanged, and the header's "Open in list" escape hatch stays independent of `target`.

  The `object-chart` registry input deliberately keeps advertising `target: 'drawer' | 'dialog'` only. `ChartDrillDownSchema` in `@objectstack/spec` declares the chart drill target as those two, strictly, and the publish-time react-page lint parses that schema against the authored literal — so listing `'navigate'` in the designer palette would offer authors a value the publish gate rejects. Widening the protocol union is a spec-side follow-up (objectstack#5435); `'navigate'` works today for any host that composes an `object-chart` schema directly.

- 524a635: `<ObjectChart>` declares `drillDown` as a registry input, so the SDUI save gate treats the segment drill as a contract prop instead of an unknown one (framework#5022).

  The component has read `schema.drillDown` all along — it is what opens the drawer of underlying records when you click a bar or a slice — but the prop was declared in neither the protocol nor this registry entry. The manifest the save gate validates page JSX against is built verbatim from these `inputs`, so an author who wrote the drill got an `unknown-prop` diagnostic for a prop that works. `@objectstack/spec` now declares the shape (`ChartDrillDownSchema`, published on the react-tier `<ObjectChart>` contract); this is the renderer half.

  The published input describes the six keys the spec declares — `enabled`, `filter`, `title`, `target` (`'drawer' | 'dialog'`), `columns`, `maxRows` — and deliberately not the wider `DrillDownConfig` this repo shares with the table / pivot / metric widgets: `ObjectChart` reads none of `mode` / `report` / `view` / `sort`, and does not implement `target: 'navigate'` (it renders the drawer instead — objectui#3354).

  The untyped `(schema as any).drillDown` read is now typed as `DrillDownConfig`. Narrowing it to the spec's `ChartDrillDown` is left as a TODO on the version pin: `@objectstack/spec` is pinned at `^17.0.0-rc.2` here and the declaration lands in the next rc, and re-declaring the shape locally would be the fork that lets the two drift.

### Patch Changes

- Updated dependencies [18cd432]
- Updated dependencies [532cf8b]
- Updated dependencies [680080a]
- Updated dependencies [a7651e6]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [65516ba]
- Updated dependencies [94c5b7c]
- Updated dependencies [ca0fa8f]
- Updated dependencies [34595eb]
- Updated dependencies [3889ffb]
- Updated dependencies [5781fb1]
- Updated dependencies [7e2406a]
- Updated dependencies [9e9e9a9]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [5c856ec]
- Updated dependencies [23018cc]
- Updated dependencies [53811d1]
- Updated dependencies [68b6a28]
- Updated dependencies [0554e88]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [28b2e65]
- Updated dependencies [509104a]
- Updated dependencies [825bbe3]
- Updated dependencies [6195841]
- Updated dependencies [5dd0127]
- Updated dependencies [06632e9]
- Updated dependencies [a415684]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [5af2852]
- Updated dependencies [f833d3a]
- Updated dependencies [a6ec93d]
- Updated dependencies [2a9513d]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/i18n@17.3.0
  - @object-ui/react@17.3.0

## 17.2.0

### Minor Changes

- 4a51e77: Stop declaring 14 symbols across ten packages under names `@objectstack/spec`
  owns (objectui#3161, objectstack#4115 batch 7 — the long tail, one or two
  entries per package). All ten packages leave the ledger, which drops from 17
  collisions across 11 packages to 3 across 1.

  **Renamed exports** — in every case the spec exports the same name for a
  _different_ thing, so the old name was a mis-description rather than a dialect:

  | package                    | was                                | now                                                  | what the spec's same-named export is                                                                                                       |
  | :------------------------- | :--------------------------------- | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
  | `@object-ui/fields`        | `FieldWidgetProps`                 | `FieldWidgetComponentProps`                          | the DECLARED field-widget plugin props contract (a zod object; `field.type` is the `FieldType` enum, `readonly`/`required` carry defaults) |
  | `@object-ui/layout`        | `PageHeaderProps`                  | `PageHeaderComponentProps`                           | the authored `page:header` node — a zod schema of `title`, `subtitle`, an icon NAME, `breadcrumb`, `actions: string[]`                     |
  | `@object-ui/layout`        | `Page`                             | `PageNodeRenderer`                                   | the authored page metadata DOCUMENT (`name`, `label`, `type`, `regions`)                                                                   |
  | `@object-ui/plugin-detail` | `ObjectFieldLike`                  | `ObjectDefFieldLike`                                 | the i18n duck type `translateObject` walks (`help`/`description`, plus `[key: string]: any`)                                               |
  | `@object-ui/plugin-grid`   | `ColumnSummaryConfig`              | `ColumnSummarySetting`                               | the OBJECT form of `ListColumn.summary` **only** — the local one was the whole union, shorthand included                                   |
  | `@object-ui/plugin-grid`   | `isMultiValueField`                | `hasMultiValueShape`                                 | the spec's classifier, which requires a def with a `type`; the local one is called with `undefined`                                        |
  | `@object-ui/collaboration` | `RealtimeConfig`                   | `RealtimeSubscriptionConfig`                         | the app's realtime DECLARATION (`enabled`, `transport`, `subscriptions[]`)                                                                 |
  | `@object-ui/plugin-charts` | `ChartConfig`                      | `ChartContainerConfig`                               | the authored chart document (`type`, `xAxis`, `series`, `showLegend`, …)                                                                   |
  | `@object-ui/plugin-form`   | `FormSection` / `FormSectionProps` | `FormSectionContainer` / `FormSectionContainerProps` | the authored form-section metadata (`name`, `pane`, `visibleWhen`, `fields`)                                                               |
  | `@object-ui/providers`     | `Theme`                            | `ThemePreference`                                    | a whole theme DOCUMENT (`name`, `label`, `colors`, `typography`)                                                                           |
  | `@object-ui/runner`        | `App` (default export)             | `RunnerApp`                                          | the authored application metadata type **and** the `App.create()` builder                                                                  |
  | `@object-ui/sdui-parser`   | `ValidationResult`                 | `ManifestValidationResult`                           | plugin-manifest validation (`{ valid, errors?, warnings? }`), exported from both `kernel` and `contracts`                                  |

  `ManifestValidationResult` follows the `<what was validated>Validation<Error|Result>`
  convention registered on objectstack#4115 (`@object-ui/core` took
  `SchemaNodeValidationResult` in batch 4). `PageHeaderComponentProps` deliberately
  reuses the name `@object-ui/app-shell` already chose for its own header props in
  batch 3, so one concept does not acquire two dialect names one package apart.

  **Now derived from the spec instead of hand-written:**

  - `@object-ui/fields` — `isFileIdToken` is re-exported from
    `@objectstack/spec/data`. The local copy was character-for-character identical
    to the spec's function while its comment said it "mirrors" it, so every
    behaviour test passed and only reference identity could tell the two apart.
    The regex is a wire decision: widening it server-side while a copy here kept
    the old bound would make every new id read as "not a reference", and the
    widget would submit the legacy inline blob to a backend expecting a reference.
  - `@object-ui/plugin-detail` — `FeedFilterMode` is re-exported from
    `@objectstack/spec/data`, in a file that already imported the sibling
    `FeedItemType` from the spec.
  - `@object-ui/plugin-grid` — the eleven-member aggregation union is now the
    spec's `ColumnSummary` enum, so the total `Record<ColumnSummaryType, string>`
    label map turns a member the spec adds into a compile error instead of a
    blank footer cell. `ColumnSummarySetting` is `NonNullable<ListColumn['summary']>`,
    i.e. whatever forms the spec itself accepts. `hasMultiValueShape` delegates to
    the spec's `isMultiValueField` rather than re-deriving it from
    `MULTI_OPTION_TYPES` / `MULTI_CAPABLE_TYPES`.
  - `@object-ui/providers` — `ThemePreference` is the spec's `ThemeMode` union
    plus the one legacy `'system'` spelling this provider still honours for stored
    preferences, read off the schema's own `_zod` carrier so the package takes no
    zod dependency.

  `@objectstack/spec` moves from `devDependencies` to `dependencies` in
  `@object-ui/fields` (it re-exports a runtime function) and `@object-ui/providers`
  (its public `.d.ts` now references the spec).

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out above (see AGENTS.md §版本号策略). A `major` here would carry
  all 39 packages of the fixed group to `18.0.0` and off objectstack's 17.x line.

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [a889e31]
- Updated dependencies [09d30a4]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [d9668a7]
- Updated dependencies [4b470b9]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [f6e8d78]
- Updated dependencies [ea96284]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/components@17.2.0
  - @object-ui/core@17.2.0
  - @object-ui/react@17.2.0
  - @object-ui/i18n@17.2.0

## 17.1.0

### Minor Changes

- f1c04b6: fix(charts): a spec `series[].type` override actually draws, and a spec-shape `series` plots at all (#2945)

  #2945 listed `combo` (`plugin-charts`) as renderer-local dialect to "promote or
  delete". Neither: the spec **already models a combo chart**, per-series, and its
  own field comment says so —

  ```ts
  // spec/src/ui/chart.zod.ts — ChartSeriesSchema
  /** Series type override (combo charts) */
  type: ChartTypeSchema.optional().describe('Override chart type for this series'),
  ```

  — exactly as it models stacking with `ChartSeries.stack` rather than a
  `stacked-bar` family. So `combo` is not a name an author should reach for; it is
  what "the series disagree about their family" looks like from the renderer's
  side. `effectiveChartFamily` now derives it, and `combo` stays a documented
  renderer-local marker (internal callers pass it directly today).

  Chasing that turned up two live bugs, both silent, on the path a spec author
  takes.

  **1. The per-series override was parsed, carried, and then dropped.** Only the
  renderer's `chartType === 'combo'` branch read `series[].chartType`, so

  ```ts
  { type: 'bar', series: [{ name: 'revenue' }, { name: 'margin', type: 'line' }] }
  ```

  drew `margin` as a bar. Nothing was wrong at any layer but the last — a unit test
  even asserted the value was carried.

  **2. A spec-shape `series` rendered nothing at all.** `series` is the one binding
  both shapes spell with the same key, so `ChartRenderer`'s blanket "internal props
  win" rule let the author's `[{ name }]` shadow the normalized `[{ dataKey }]` and
  reach a renderer that reads `dataKey`. Blank chart. Every other spec binding has a
  distinct name (`xAxis` vs `xAxisKey`), which is why only this one broke — and why
  the isolated normalization tests all passed over a dead path. The raw array is now
  preferred only when it already speaks the internal shape, so internal callers are
  byte-for-byte unchanged and a mixed array works too.

  **Also fixed in passing:** the combo branch had an `area` arm under a `BarChart`
  container, and Recharts renders an `<Area>` child of `BarChart` as nothing — so an
  authored combo with an `area` series drew a blank series. The container is now
  `ComposedChart`, which is what Recharts provides for mixed marks.

  Widening only. A chart whose series all resolve to one family keeps its own
  family, an explicit `combo` is untouched, and a family with no per-series meaning
  (`pie`, `horizontal-bar`, …) is never widened. A derived combo binds series to the
  left axis unless one asks for `yAxis: 'right'` — the spec's own default — so
  widening changes the series' mark and not its scale; the legacy bar→left/line→right
  guess is kept for an authored `combo`, where it was historically the only way to
  reach a second axis.

  Guards: `effectiveChartFamily` / `comboBaseFamily` are unit-tested over the whole
  family matrix; DOM-level tests assert the **marks** rather than the derived family,
  since the carry was already covered and the drawing was what broke; and
  `spec-derived-unions.test.ts` asserts `combo` is absent from the spec's
  `ChartTypeSchema`, so the day it is adopted upstream the derivation is named as the
  thing to retire.

### Patch Changes

- Updated dependencies [62311b6]
- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [1cf0de7]
- Updated dependencies [752e18f]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [d61efd1]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [9eb932b]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [3cb9646]
- Updated dependencies [68ef584]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [c4d7b20]
- Updated dependencies [c769d3d]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [c735bf7]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [d21794c]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [9a04d25]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [07de839]
- Updated dependencies [2a40b5e]
- Updated dependencies [df613fa]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [eb4b740]
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [379728f]
- Updated dependencies [7f23cd0]
- Updated dependencies [0ded602]
- Updated dependencies [24e0e0a]
- Updated dependencies [f8a95e5]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [80edbd4]
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/components@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0
  - @object-ui/i18n@17.1.0

## 17.0.0

### Minor Changes

- aa88056: feat(charts): honor `ChartAxis.stepSize`, `ChartConfig.description` and `ChartConfig.height` (framework#3752)

  The tail of the declared-≠-delivered sweep from framework#3729 / #2880. Three
  `ChartConfig` props reached the renderer and did nothing:

  - **`ChartAxis.stepSize`** — Recharts has no "a tick every N units" prop
    (`tickCount` is a hint it may ignore, `interval` is for categorical axes), so
    honoring a step means handing it the tick array outright. `ticksFor` builds it
    from the axis's own `min`/`max` where declared and from the plotted values
    otherwise, so a step works with or without a pinned domain. A data-derived max
    rounds UP to the next step (otherwise the topmost bar sits above the last
    gridline and the axis reads as truncated); an explicit `max` clamps instead,
    since a tick outside a pinned domain would be drawn outside the plot. A step
    that would produce more than 200 ticks is refused rather than rendered — that
    is a wrong config, and drawing it would hang the page instead of surfacing the
    mistake.
  - **`ChartConfig.description`** — the accessibility description. A chart is a
    picture to a screen reader; the container now carries `role="img"` +
    `aria-label`. Without a description it stays an ordinary div, because
    stamping `role="img"` on an _unlabelled_ graphic is worse than leaving one a
    screen reader can skip.
  - **`ChartConfig.height`** — was read only by the legacy `ChartBarRenderer`, not
    by the advanced path that draws every real chart. Now applied to the chart
    container as an inline style, which beats its default `h-[350px]` class.

  `height` and `description` ride on the shared container props, so they apply to
  all eight chart families rather than one branch.

- 9b53d72: feat(charts): ObjectChart honors the spec `ChartConfig` author shape (objectui#2880 / framework#3729)

  `ChartConfigSchema` is the chart protocol, but the renderer only ever read a
  Recharts-flavoured internal shape — `chartType`, `xAxisKey`, `series[].dataKey`.
  Everything an author wrote in the SPEC shape reached the renderer and was
  silently dropped, which is exactly what ADR-0078 forbids. framework#3725
  documented the gap by trimming the published contract down to the props that
  actually worked; this closes it the other way round.

  **S1 — one normalization boundary.** `normalizeChartSchema` translates the
  author shape into the internal pipeline contract in a single place, rather than
  scattering `??` fallbacks through the render tree (framework PD #12: one
  translation is a contract mapping, N fallbacks are a second dialect):

  - `type` → `chartType`, `xAxis: { field }` → `xAxisKey`, `series: [{ name }]` →
    `series: [{ dataKey }]`
  - the report surface's bare-string `xAxis`/`yAxis` resolve too
  - `yAxis: [{ field }]` alone plots, with no `series` declared
  - **internal props win**, so `DashboardRenderer`, `ObjectView` and the dataset
    path are byte-for-byte unaffected — there is no migration

  **The `type` collision.** `ChartConfig.type` is the chart family, but on any
  surface that flattens chart config into a props bag `type` is already the SDUI
  envelope's component discriminator. Spreading props last let an author's
  `type="bar"` replace `object-chart` so the block stopped resolving; stamping the
  discriminator last ate the author's value instead. The react-page wrapper now
  keeps both: the discriminator wins the `type` slot and the author's value is
  preserved beside it as `specType`, which the normalizer reads back.

  **S2 — axis presentation.** `ChartAxis.format` drives the tick formatter (via
  `Intl.NumberFormat`, no new dependency), `min`/`max` pin the domain,
  `logarithmic` swaps the scale, `title` labels the axis, and `showGridLines` is
  honored. A second `yAxis` entry (or `position: 'right'`) turns on the secondary
  axis that `series[].yAxis` binds to — in combo charts an explicit binding now
  beats the family-derived bar→left/line→right guess. `showLegend` is honored,
  and `title`/`subtitle` render above the plot instead of only titling the
  drill-down drawer.

  **S3 — `series[].stack`, `annotations`, `interaction`.** Stacking passes the
  author's group name through as Recharts' `stackId`. Annotations render as
  `ReferenceLine` (`type: 'line'`) / `ReferenceArea` (`type: 'region'`) with the
  declared axis, colour, style and label. `interaction.tooltips: false` suppresses
  the hover card and `interaction.brush: true` adds the range selector;
  `showDataLabels` prints values on the marks. `interaction.zoom` has no Recharts
  primitive behind it and is deliberately still unimplemented rather than faked.

### Patch Changes

- 7b35e4b: fix(dashboard,charts): resolve `{current_user_id}` in widget filters (framework #3574)

  A dashboard widget filtered on `{current_user_id}` rendered `0`. The token
  reached SQL as a literal, matched no row, and nothing was logged on the client
  or the server — a silent zero that reads as "you have no work" rather than
  "this filter did not resolve". The same token in a list-view filter resolved
  correctly, so a user-scoped list and a user-scoped widget over the same data
  disagreed.

  There was no shared resolver. Three ad-hoc implementations had grown up
  independently — `ObjectView` for list views, `ObjectDataPage` for URL filter
  triples, `NavigationRenderer` for hrefs — and each understood only the filter
  shape its own surface used. `ObjectView`'s opened with
  `if (!Array.isArray(filter)) return filter`, so it could not have been reused
  by dashboard widgets even in principle: widget filters are MongoDB-style
  objects. Widgets therefore got no resolution at all — `DatasetWidget` called
  `resolveDateMacros` and nothing else, which is why `{today}` worked in a widget
  and `{current_user_id}` silently did not.

  - **`@object-ui/core`** — new `utils/filter-tokens.ts` with
    `resolveContextTokens` and `resolveFilterPlaceholders`. The latter expands
    _every_ placeholder vocabulary in one call and is what surfaces should use;
    resolving only some of them is the whole defect. The walk handles arrays and
    plain objects uniformly, so one resolver covers both platform filter shapes.
  - **`@object-ui/react`** — new `FilterScopeProvider` / `useFilterScope`. The
    renderer packages deliberately do not depend on `@object-ui/auth`, so the
    shell supplies the session values. This is a separate context from
    `PredicateScopeContext`, which is the expression evaluation scope and carries
    no organization.
  - **`@object-ui/plugin-dashboard` / `@object-ui/plugin-charts`** — all six
    widgets that previously resolved date macros only now resolve both
    vocabularies: `DatasetWidget`, `ObjectMetricWidget`, `ObjectDataTable`,
    `ObjectPivotTable`, and `ObjectChart` (dataset-bound and inline paths). The
    chart's `compareTo` comparison filter gets the session pass too — otherwise
    the overlay series silently ignored the owner clause the primary series
    honoured.
  - **`@object-ui/app-shell`** — `ObjectView`'s local `substituteFilterTokens`
    and `ObjectDataPage`'s inline `=== '{current_user_id}'` ternary now delegate
    to the shared resolver, so both also gain `{current_org_id}` and date macros.
    Two of the three ad-hoc implementations are gone rather than joined by a
    fourth.

  An unresolvable token is left intact rather than dropped: leaving it yields an
  empty result, whereas dropping the clause would _widen_ the result set and show
  a signed-out viewer everyone's data. It is no longer silent — the resolver
  warns, naming the token, and suggests the intended spelling for known
  near-misses (`{current_user}`, `{user_id}`, `{organization_id}`). Authoring-time
  enforcement lands separately as `filter-token-unknown` in `@objectstack/lint`.

- e16ed2d: fix(dashboard,charts): send widget `dateGranularity`/`sortBy`/`limit` to the query, and give funnels a real stage order (framework#3588)

  `DatasetWidget` never read `widget.options`. Four keys an author writes there
  change the query the server compiles, so a widget declaring
  `options: { dateGranularity: 'month' }` grouped by the raw timestamp and drew
  one bar per record, and `sortBy`/`sortOrder` produced no ordering at all.

  - `DatasetWidget` lowers `options.dateGranularity`, `options.sortBy` +
    `options.sortOrder`, and `options.limit` into the `DatasetSelection` it posts.
    A `sortBy` naming something the widget does not project is dropped rather than
    sent, so a stale sort key left by an edit degrades to "unordered" instead of
    failing the widget against the server's stricter validation. These keys also
    join the refetch signature, so editing one in the designer refetches instead
    of re-rendering the previous grid.
  - Funnel stages follow a **declared order**. `AdvancedChartImpl` sorted funnel
    segments by value descending, unconditionally — which overrode any server
    ordering and rendered a sales pipeline as a tidy narrowing shape whatever the
    stages' real sequence, hiding the very anomaly (a bulge at Proposal) the chart
    exists to show. It now honours a `categoryOrder`, which `DatasetWidget`
    derives from the dimension field's picklist option order — the pipeline order
    an author already declared on the object — or from an explicit
    `options.stageOrder`. With no declared order the value-descending default is
    unchanged, and a category missing from the order is kept (after the declared
    ones), never dropped.
  - New `@object-ui/core` helpers `buildCategoryOrder` / `buildCategoryRank`,
    keyed by both the stored value and the display label like the existing
    `buildOptionColorMap`, so ordering works whether or not the server resolved
    the dimension's labels.

  Requires the framework-side fix in objectstack#3588 for the selection keys to
  take effect server-side.

- 6e8fd3c: fix(charts): a fieldless `count` aggregate keyed its value column `undefined`, so the chart plotted nothing (framework#3701)

  framework#3701 pinned down what an OBJECT-bound chart aggregate names its result
  columns — the raw field names it was given (`groupBy` for the category, `field`
  for the value; no `sum_`-style decoration, unlike a dataset measure), plus the
  literal `count` when a `count` omits `field`, which is the alias the engine
  projects `COUNT(*)` under. `os validate` now lints page sources against that
  convention, so the paths that build these rows have to honour it exactly.

  Three of the four did. The odd one out was `count` — the one function that may
  legitimately omit `field` — because every row builder read `params.field`
  directly:

  - `aggregateRecords` / `ObjectDataSource.aggregateClientSide` emitted
    `{ [groupBy]: key, [undefined]: value }`, i.e. a column literally named
    `undefined` that no axis binding could ever name;
  - the legacy analytics path was worse: it remapped the server's `count` measure
    onto `params.field` and **deleted** the original key, so the value the server
    did return was thrown away before the chart saw it.

  All of them now resolve the column through one helper (`aggregateValueKey`) so a
  fieldless count lands under `count`, matching the framework contract. The
  comparison-overlay column is derived from the same key (`count__comparison`
  instead of `undefined__comparison`), and `aggregate.field` is typed optional to
  match the spec's `ChartAggregateSchema`. Charts that name a field are unchanged.

- Updated dependencies [7b21891]
- Updated dependencies [0b3be01]
- Updated dependencies [3c4d935]
- Updated dependencies [4b60d2d]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1a03af6]
- Updated dependencies [3e886eb]
- Updated dependencies [cfc675e]
- Updated dependencies [20df08c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [af705b9]
- Updated dependencies [0502a7c]
- Updated dependencies [7b35e4b]
- Updated dependencies [8fb1295]
- Updated dependencies [e16ed2d]
- Updated dependencies [c6fd752]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [c77108c]
- Updated dependencies [2735de6]
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [e05f052]
- Updated dependencies [0502a7c]
- Updated dependencies [faad45e]
- Updated dependencies [09c6a17]
- Updated dependencies [c7cff19]
- Updated dependencies [ba73a02]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [9b4b952]
- Updated dependencies [2f947e4]
- Updated dependencies [7d46648]
- Updated dependencies [9b53d72]
- Updated dependencies [bb4aa25]
- Updated dependencies [75f1cdf]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [c6cfdf1]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [263f885]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/i18n@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0

## 16.1.0

### Patch Changes

- ebe6494: chore(lint): clear the baseline lint errors in nine more packages (objectui#2713 Wave 2)

  Second wave of the #2713 lint-gate restoration (after #2730). These nine package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations. Cleared every **error** (no behavior change; warnings out
  of scope):

  - **`react-hooks/rules-of-hooks`** (`i18n`, `plugin-grid`, `plugin-view`,
    `plugin-list`) — translation helpers (`useSafeFieldLabel`,
    `useRowActionTranslation`, `useViewLabel`, `useViewTabLabel`, `useMoreLabel`)
    wrapped a provider-safe hook (`useObjectTranslation`/`useObjectLabel`, which
    never throw) in try/catch; removed the wrapper (the same fix #2709 applied in
    fields). `plugin-kanban` `ObjectKanban` moved its `if (error)` early return
    below the `useCallback` so hooks run unconditionally. `collaboration`
    `__unsafe_usePresenceContext` keeps its deliberate danger-prefix name via a
    justified scoped disable.
  - **`react-hooks/static-components`** (`layout`, `plugin-list`, `plugin-report`)
    — dynamic-icon / registry lookups (`resolveIcon`, `useRegistryComponent`) are
    stable component references, not components created during render → scoped
    disable with justification. `plugin-charts` `TreemapCell` was a _genuine_
    inline component and is hoisted to module scope (it is purely props-driven).
  - **`no-irregular-whitespace`** (`plugin-grid` `ImportWizard`) — the literal
    U+FEFF BOM prepended to exported CSV/text blobs (so Excel detects UTF-8) is
    now written as the `﻿` escape: byte-identical at runtime, no literal
    irregular-whitespace character in source.
  - **`no-useless-assignment`** (`plugin-grid` `BulkActionDialog`) — dropped a
    dead `= null` initializer that the exhaustive `switch` (incl. `default`)
    overwrites before it is read.
  - **`no-unsafe-function-type`** (`plugin-view` `ViewTabBar`) — the dnd-kit
    render-prop `listeners` map is typed `Record<string, (...args: any[]) => void>`
    instead of bare `Function`.
  - **`no-require-imports`** (`plugin-kanban`, `plugin-view` tests) — hoisted
    `vi.mock` factories use an `async` factory with `await import('react')`.

- Updated dependencies [0318118]
- Updated dependencies [1c8935a]
- Updated dependencies [af1b0db]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [1100a8b]
- Updated dependencies [7abe4cd]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
- Updated dependencies [ebe6494]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [f80aaf2]
- Updated dependencies [62b9ab5]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
  - @object-ui/i18n@16.1.0
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/components@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [ca0f5f0]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/i18n@16.0.0
  - @object-ui/core@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/i18n@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [23d65c3]
- Updated dependencies [055e1d2]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [f0f10f5]
  - @object-ui/i18n@14.1.0
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/components@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [c70bca7]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [5971cc4]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/i18n@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/components@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [53c40c2]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/i18n@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [9e38270]
- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/i18n@13.0.0
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/i18n@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/react@12.0.0
  - @object-ui/i18n@12.0.0

## 11.5.0

### Patch Changes

- fae75e2: Fix two bugs verified still-present after #2254 claimed to resolve them (framework#2620 / framework#2616 Showcase UX pass, tracked in #2268):

  - **Wizard/form `submitBehavior: 'thank-you'` allowed duplicate resubmission.** #2254 fixed the spec-bridge dropping `submitBehavior` before it reached the renderer, so the configured toast message started appearing — but `WizardForm`'s last step and `ObjectForm`'s submit handler only ever called `toast.success(...)` for `thank-you`/`next-record`; the form stayed mounted and fully filled with its submit button re-enabled once the request settled, so a second click created a second record. Both components now track a terminal `submitted` state and, when set, replace the form with a confirmation panel (using the behavior's `title`/`message`, which were also never read before) — mirroring the pattern `apps/console/src/components/FormPage.tsx` already used for its own standalone forms.

  - **Command Center-style 3-up chart bands stayed collapsed to ~100-130px, and a dataset-bound chart's measure leaked its raw field name.**
    - `responsiveStyles` (and `style`) were declared on the page-spec `PageComponent` bridge input type but never copied onto the `SchemaNode` in `spec-bridge/bridges/page.ts::mapComponent()` — so a page author's ADR-0065 layout override (e.g. forcing `display: 'grid'` on a `type: 'flex'` band) never reached `SchemaRenderer`, and the node silently fell back to its default flex layout. Both fields are now mapped through.
    - `ObjectChart`'s dataset-bound fetch path (`schema.dataset` + `ds.queryDataset(...)`) discarded the response's `fields` array (which carries each measure's `label`, e.g. `{ name: 'task_count', label: 'Tasks' }`) before it ever reached `buildChartSeries()` — whose `fields` param already resolves this correctly (see `chart-series.test.ts`) — so the legend/tooltip always fell back to the raw field name. The fetched `fields` are now captured and threaded through.

- Updated dependencies [544d8eb]
- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/i18n@11.5.0
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
- Updated dependencies [9cd9be1]
- Updated dependencies [c38d107]
- Updated dependencies [7782698]
- Updated dependencies [790558b]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/i18n@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/i18n@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0
  - @object-ui/i18n@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [6726a2b]
  - @object-ui/i18n@11.1.0
  - @object-ui/components@11.1.0
  - @object-ui/react@11.1.0
  - @object-ui/types@11.1.0
  - @object-ui/core@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0
- @object-ui/i18n@7.3.0
- @object-ui/react@7.3.0
- @object-ui/components@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [8e7c1da]
- Updated dependencies [d23db5c]
  - @object-ui/i18n@7.2.0
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0

## 7.1.0

### Minor Changes

- 677f7ed: feat(charts,dashboard): data-screen customization primitives

  - object-metric `variant:'bare'` — big tinted number + label, no card chrome
    (data-screen KPIs that stay data-bound).
  - object-chart `colors` prop overrides the theme `--chart-1..n` palette so a
    page/dashboard can brand its charts; compact metric formatting (`'0.0a'` →
    "1.1M").
  - ObjectChartSchema.chartType widened to donut/horizontal-bar/column.

### Patch Changes

- 08c47da: feat(dashboard): dataset chart widgets paint select/lookup dimensions in their option colors

  A dashboard `DatasetWidget` chart grouped by a select/lookup dimension (e.g.
  project `health`) painted its categories from the generic `--chart-1..5`
  palette — the same gap the chart view (`object-chart`) had before #1932. It now
  resolves the dimension field's option colors (using the dataset's base `object`

  - dimension→field map the query already returns) and threads them to the
    renderer as a per-category `categoryColors` map, so health green/red/yellow
    paints semantically.

  The value/label→color resolution is extracted into a shared `buildOptionColorMap`
  (`@object-ui/core`) now used by both `DatasetWidget` and `ObjectChart`.

- 93cf2b1: fix(charts): use field option colors for categorical chart dimensions

  An `object-chart` grouped by a select/lookup field (e.g. project `health`)
  painted its categories from the generic `--chart-1..5` palette, so a "Red"
  health slice rendered teal and "Green" rendered blue. The chart now resolves
  the category dimension's option colors — both the `objectName` + `groupBy`
  path and the dataset path (via the dataset's `object` + dimension `field`) —
  and threads them to the renderer as a per-category `categoryColors` map. That
  map wins over the positional palette and falls back to it for categories
  without an option color, so pie/donut slices and bar cells render in their
  semantic colors.

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/components@7.1.0
  - @object-ui/i18n@7.1.0

## 7.0.0

### Patch Changes

- c5a7d6f: Bar-chart X-axis labels no longer overlap on narrow widgets. When a chart has
  many categories (>4) or any long label (>8 chars), the tick labels are angled
  (-32°) and truncated with a hover `title`; few short labels stay horizontal.
- cb2fdb1: feat(dashboard): expand drill-in — table/list row→record + scatter/treemap/sankey drill-through

  Drill-in now covers the widgets that were missing it, and formalizes the two
  interaction semantics mainstream BI/low-code platforms separate. `DrillDownConfig`
  gains a `mode` discriminator: `'filter'` (drill-through: aggregate bucket → filtered
  record list) and `'record'` (drill-to-record: a table/list row → that record's detail).

  - Scatter, treemap and sankey charts now wire click → the existing filtered-record
    drill drawer (radar excluded — no single clickable category point). The
    Recharts-payload → drill-event mapping is extracted to pure, tested functions.
  - Object-backed table/list widgets drill to the clicked record in a read-only detail
    drawer (Sheet/Dialog), on by default (`drillDown:{enabled:false}` opts out). Field
    labels and value formatting (incl. tenant-default currency) are shared with the
    table cells so a value reads identically in both. An author-supplied `onRowClick`
    still wins.
  - The chart/KPI drill-through record lists now drill into a record too, completing the
    segment → list → record chain.

- c3749eb: feat(dashboard): dataset chart widgets drill through to records

  Dataset-bound **chart** widgets (bar/line/pie/area/donut/funnel/…) are now
  click-drillable, matching table/pivot. Clicking a segment maps it back to its
  dataset row and opens the same governed drill drawer (raw group keys preserved),
  so a chart-only dashboard is no longer an exploration dead-end. This closes the
  "object-backed chart drills but dataset chart doesn't" inconsistency and aligns
  with mainstream BI (click a chart → see records).

  - `@object-ui/core`: `findChartSeriesRow` — inverse of `buildChartSeries`,
    maps a clicked `{category, series}` back to the source dataset row index
    (matches both dims when a 2nd dimension is pivoted into series).
  - `ObjectChart`: optional `onSegmentClick` lets a host own the chart click
    (and suppress the widget's own object-drill).
  - `DatasetWidget`: lifts the drill machinery to cover both table/pivot and
    chart, and wires the chart's segment click to the precise dataset drill.

- 6cfa330: feat(dashboard): drill "Open in list" escape hatch + unify report drill

  Adopts the mainstream BI peek-then-escalate drill model. Drill-through opens an
  in-place drawer (keep context) and offers an "Open in list →" affordance to
  escalate to the object's full list page (sort / bulk-select / export / shareable
  URL) — the Looker / Power BI "see records → open in page" pattern.

  - New `DrillNavigationContext` (`@object-ui/react`): the app shell provides
    `openRecordList`; the renderer stays decoupled from console routing.
  - The drill drawers (pivot / dataset / chart / KPI) render the escape hatch when
    a host navigation handler is present, and hide it otherwise (self-contained
    peek). `DashboardView` provides the handler via `useOpenRecordList`.
  - `DrillDownConfig.target` gains `'navigate'` — skip the drawer and open the
    list directly; degrades to `'drawer'` when no host handler is available.
  - `ReportView` drill-through now opens the same in-place drawer (peek records →
    click a row to open a record) instead of navigating away; the escape hatch
    preserves the previous navigate-to-list behavior. Dashboard and report drill
    are now unified.
  - i18n: `dashboard.openInList` (en / zh).

- e270c7d: fix(chart): consume ADR-0021 `dataset` binding in list/object chart views

  Chart views authored to the current spec (ADR-0021: `dataset` + `dimensions` +
  `values`) previously rendered nothing — the renderers only read the **removed**
  legacy inline `xAxisField` / `yAxisFields` / `aggregation` shape, so a
  spec-compliant chart view showed an empty canvas. `ObjectChart` now runs the
  governed `queryDataset` path when a chart binds to a dataset (the same path the
  dashboard `DatasetWidget` uses, so numbers stay consistent), and `ListView` /
  `ObjectView` emit the dataset shape. The legacy inline aggregate is kept as a
  deprecated fallback so pre-ADR-0021 metadata keeps rendering.

  Refs objectstack-ai/objectstack#1890

- ab168e4: Dashboard charts no longer render blank on first paint. Recharts'
  `ResponsiveContainer` was a child of a `flex … justify-center` box, so it
  collapsed to content width (0) on first paint inside react-grid-layout,
  measured `width(-1)` and skipped drawing until a later resize fired its
  ResizeObserver. The chart wrapper is now a definite-width block in both the
  dashboard chart container (`plugin-charts/ChartContainerImpl`) and the shadcn
  base (`components/ui/chart`). Follow-up changeset for #1634.
- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [89e113c]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [77cc6bb]
- Updated dependencies [6c0c92c]
- Updated dependencies [97c6831]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [c09f44e]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [0ad72a6]
- Updated dependencies [3fa23a7]
- Updated dependencies [18d0339]
- Updated dependencies [59b6bbb]
- Updated dependencies [d16566f]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [2f31406]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/i18n@7.0.0
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/i18n@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2
  - @object-ui/i18n@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/i18n@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0
- @object-ui/i18n@6.2.0

## 6.1.0

### Minor Changes

- 991b62d: Add `compareTo` field to dashboard widgets for period-over-period
  comparison. Supports `'previousPeriod'`, `'previousYear'`, and
  `{ offset: '7d' | '4w' | '1M' | '1y' }`.

  - **Metric / gauge widgets** now compute a delta percentage when `compareTo`
    is set and surface it as a derived `trend` (auto-labelled via
    `dashboard.trend.vsLast*` i18n keys sniffed from the filter macros).
  - **Chart widgets** (line / area / bar / horizontal-bar / scatter / combo)
    overlay a muted comparison-period series (dashed line, lower fill opacity).
    Pie / donut / funnel ignore `compareTo`.
  - New core utilities: `shiftFilterByCompareTo`, `compareToTrendLabelKey`,
    `computeMetricDelta`, and `CompareToConfig` type.
  - `ChartSeries` now accepts `variant: 'comparison'`, `dashArray`, and
    `opacity` overrides for visual treatment.

  See `packages/plugin-dashboard/SKILL.md` for usage examples.

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/react@6.1.0
  - @object-ui/i18n@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/i18n@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/i18n@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/i18n@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/i18n@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/i18n@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/i18n@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/i18n@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/react@5.4.0
  - @object-ui/i18n@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/i18n@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/i18n@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/i18n@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/i18n@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [321294c]
- Updated dependencies [b2d1704]
- Updated dependencies [0a644f0]
- Updated dependencies [a3cb88f]
- Updated dependencies [5425608]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [e919433]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d9c3bae]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/i18n@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/components@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/i18n@5.1.1
  - @object-ui/react@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [1976691]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [49b1760]
- Updated dependencies [c0b236f]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/i18n@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0

## 5.0.2

### Patch Changes

- Updated dependencies [cab6a93]
  - @object-ui/i18n@5.0.2
  - @object-ui/components@5.0.2
  - @object-ui/react@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/i18n@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [8930b15]
- Updated dependencies [95b6b21]
- Updated dependencies [ddb08a7]
- Updated dependencies [765d50f]
- Updated dependencies [927187a]
- Updated dependencies [bae8ba8]
- Updated dependencies [8435860]
- Updated dependencies [bb2ea48]
- Updated dependencies [b14fe09]
- Updated dependencies [a7bef6e]
- Updated dependencies [74962b0]
- Updated dependencies [3154334]
- Updated dependencies [fa4c2cb]
- Updated dependencies [7213027]
  - @object-ui/components@5.0.0
  - @object-ui/i18n@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/i18n@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/i18n@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [3ee436d]
  - @object-ui/components@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/i18n@4.6.0
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [6b6afd1]
- Updated dependencies [22fa558]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/i18n@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [2bd45af]
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/i18n@4.4.0
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [5f4ac6e]
- Updated dependencies [6b683c8]
  - @object-ui/i18n@4.3.1
  - @object-ui/components@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [f196cf4]
- Updated dependencies [ee1cc96]
- Updated dependencies [0b032be]
- Updated dependencies [115d36a]
- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/i18n@4.3.0
  - @object-ui/components@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/i18n@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1

## 4.2.0

### Patch Changes

- Updated dependencies [eb738bd]
- Updated dependencies [650392e]
- Updated dependencies [84b4bf1]
  - @object-ui/i18n@4.2.0
  - @object-ui/components@4.2.0
  - @object-ui/react@4.2.0
  - @object-ui/types@4.2.0
  - @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- b4ce9e2: Fix summary reports: render chart + KPIs, correct empty-table on server-aggregated data.
  - `plugin-report`: `SpecReportGrid` now renders a KPI strip (per aggregating column) and a chart section above the grid for `summary` reports. KPI section auto-hides when no aggregating columns. New `buildChartData()` adapter buckets aggregated `ReportRow[]` to chart-ready data, auto-sorts pie/funnel descending, and falls back to row count when the chart `yAxis` points at a non-numeric column. When the data is server-aggregated, the grid switches columns to `[groupings, ${field}__${agg}]` so cells aren't empty against a raw-row column schema.
  - `plugin-charts`: register `'column'` as an alias of `'bar'` in `ChartRenderer` / `AdvancedChartImpl` (Recharts only has `BarChart`).
  - `app-shell`: `ReportView` now routes any object-backed report (matrix/joined/summary/tabular/columns/groupingsAcross) through the spec `ReportRenderer`; fully-legacy `fields`+`data` schemas still use `ReportViewer`.
  - @object-ui/types@4.1.0
  - @object-ui/core@4.1.0
  - @object-ui/i18n@4.1.0
  - @object-ui/react@4.1.0
  - @object-ui/components@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/i18n@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12

## 4.0.11

### Patch Changes

- Updated dependencies [1909bc3]
  - @object-ui/i18n@4.0.11
  - @object-ui/components@4.0.11
  - @object-ui/react@4.0.11
  - @object-ui/types@4.0.11
  - @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/i18n@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/i18n@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9

## 4.0.8

### Patch Changes

- Updated dependencies [3d58eaa]
  - @object-ui/i18n@4.0.8
  - @object-ui/components@4.0.8
  - @object-ui/react@4.0.8
  - @object-ui/types@4.0.8
  - @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
- Updated dependencies [fd15918]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/i18n@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/core@4.0.6
  - @object-ui/i18n@4.0.6
  - @object-ui/react@4.0.6

## 4.0.5

### Patch Changes

- 1dc6061: fix(build): inline dynamic imports in library outputs

  Library `vite build --lib` outputs were emitting separate code-split chunks
  (`rolldown-runtime-*.js`, `LookupField-*.js`, etc.) when source files used
  `React.lazy()` / dynamic `import()`. When consumer apps re-bundled these
  multi-file dists, the library's per-chunk rolldown-runtime collided with the
  consumer's own runtime, causing "TypeError: i is not a function" at runtime
  when lazy components tried to register themselves (e.g. TextField in
  `@object-ui/fields` after 4.0.4).

  Adding `output.inlineDynamicImports: true` to all `@object-ui/*` library vite
  configs forces a single `dist/index.js` per package, which lets consumer
  bundlers handle the library as an opaque ESM module without identifier
  mismatches across chunks.

  Affected packages: components, fields, layout, plugin-aggrid, plugin-ai,
  plugin-calendar, plugin-charts, plugin-chatbot, plugin-dashboard,
  plugin-designer, plugin-detail, plugin-editor, plugin-form, plugin-gantt,
  plugin-grid, plugin-kanban, plugin-list, plugin-map, plugin-markdown,
  plugin-report, plugin-timeline, plugin-view, plugin-workflow.

- Updated dependencies [1dc6061]
  - @object-ui/components@4.0.5
  - @object-ui/types@4.0.5
  - @object-ui/core@4.0.5
  - @object-ui/i18n@4.0.5
  - @object-ui/react@4.0.5

## 4.0.4

### Patch Changes

- d2b6ece: fix: externalize all bare imports in library builds

  Library builds (vite lib mode) now externalize every non-relative import instead of bundling third-party CJS dependencies into the published dist. This avoids inlined `require("react")` / `require("react-dom")` calls that cause `Calling \`require\` for "react" in an environment that doesn't expose the \`require\` function` runtime errors when consumer apps re-bundle the published dist.

  Specifically fixes:

  - `@object-ui/plugin-dashboard` no longer inlines `react-grid-layout` (and its transitive `react-draggable` / `react-resizable` CJS bundles). `react-grid-layout` is now declared as a peer dependency so consumers install a single ESM-friendly copy.
  - `@object-ui/components`, `@object-ui/plugin-calendar`, `@object-ui/plugin-charts`, `@object-ui/plugin-designer` no longer inline `react-i18next` / `i18next` / `use-sync-external-store` CJS shims.
  - All plugin packages now use a unified `external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname)` rule, ensuring future additions of CJS deps are automatically externalized.

- Updated dependencies [d2b6ece]
  - @object-ui/components@4.0.4
  - @object-ui/types@4.0.4
  - @object-ui/core@4.0.4
  - @object-ui/i18n@4.0.4
  - @object-ui/react@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3
  - @object-ui/i18n@4.0.3
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/i18n@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/react@4.0.0
  - @object-ui/i18n@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0
  - @object-ui/i18n@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/react@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/types@3.0.1
  - @object-ui/core@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0
  - @object-ui/core@3.0.0
  - @object-ui/react@3.0.0
  - @object-ui/components@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
  - @object-ui/react@0.3.1
  - @object-ui/components@0.3.1

## 0.3.0

### Minor Changes

- Unified version across all packages to 0.3.0 for consistent versioning

## 0.2.2

### Patch Changes

- New plugin-object and ObjectQL SDK updates

  **Added:**

  - New Plugin: @object-ui/plugin-object - ObjectQL plugin for automatic table and form generation
    - ObjectTable: Auto-generates tables from ObjectQL object schemas
    - ObjectForm: Auto-generates forms from ObjectQL object schemas with create/edit/view modes
    - Full TypeScript support with comprehensive type definitions
  - Type Definitions: Added ObjectTableSchema and ObjectFormSchema to @object-ui/types
  - ObjectQL Integration: Enhanced ObjectQLDataSource with getObjectSchema() method using MetadataApiClient

  **Changed:**

  - Updated @objectql/sdk from ^1.8.3 to ^1.9.1
  - Updated @objectql/types from ^1.8.3 to ^1.9.1

- Updated dependencies
  - @object-ui/types@0.3.0
  - @object-ui/core@0.2.2
  - @object-ui/react@0.2.2
  - @object-ui/components@0.2.2

## 0.2.1

### Patch Changes

- Patch release: Add automated changeset workflow and CI/CD improvements

  This release includes infrastructure improvements:

  - Added changeset-based version management
  - Enhanced CI/CD workflows with GitHub Actions
  - Improved documentation for contributing and releasing

- Updated dependencies
  - @object-ui/types@0.2.1
  - @object-ui/core@0.2.1
  - @object-ui/react@0.2.1
  - @object-ui/components@0.2.1

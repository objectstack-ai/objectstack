---
"@objectstack/service-analytics": patch
---

fix(analytics): sort dataset selections by the display label for select/lookup dimensions (#3680)

`DatasetSelection.order` (what a widget's `options.sortBy` lowers to) sorted a
`select` or `lookup`/`master_detail` dimension by its STORED value — the option
value or the foreign-key id — while the response rows carry the resolved display
label. A "sort by Account" therefore ordered by opaque ids and read as arbitrary;
a localized select sorted by its ASCII value while showing a non-ASCII label.

Order keys naming a label-bearing dimension now sort by the display label the
user reads. The executor receives an injected sort-key hook (`OrderLabelResolver`,
built by `queryDataset` over the same label-resolution capabilities and #3602
read scoping as the display pass); only the COMPARISON substitutes the label —
rows keep their raw values until the display pass, so drill metadata still
snapshots stored values, and ordering + windowing stay one adjacent step (a
"top 10 by account name" truncates the right ten).

Cost model: sorting by a measure or a plain/date dimension is unchanged (SQL
pushdown included). A label-ordered `select` resolves from field metadata (no
query). A label-ordered `lookup` costs one batched id→name read over the
pre-window grouped ids (chunked, and reused by the display pass via a
per-request cache), and its window can no longer be pushed into SQL — the
inherent price of ordering by a value the database doesn't store.

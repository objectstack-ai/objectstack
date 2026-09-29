---
'@objectstack/spec': minor
---

feat(spec): the stored-filter conversion rewrites a filter on a block whose rows are inline, as it does on any other block

The ADR-0087 D2 conversion `page-component-filter-record-to-rule-array` no longer leaves every filter of a page component whose rows are inline (`data: { provider: 'value', … }`, a `data` array, or `staticData`) as stored. Such a filter, the binding's `dataSource.filter` included, is now rewritten to the `[{ field, operator, value }, ...]` rule array exactly as it is on a block that queries an object. What still stays as stored, and is still reported as a TODO, is only a filter with a part that has no lossless rule spelling: a combinator, a null value, or an operator the rule vocabulary does not spell. That holds on any block.

Why the conversion declined, and why it no longer needs to: the `object-map`, `object-tree`, `object-calendar` and `object-gantt` blocks match that filter against their own rows in objectui's in-memory data source (`ValueDataSource.find`). The conversion was written against an objectui version whose `find` excluded every row for a rule array, so it left those filters alone and said so in the TODO. The objectui version this repository pins (`.objectui-sha`, the same pin the previous release shipped) lowers a rule array before it matches, and it selects the rows the stored form selected. That was measured over every operator the conversion maps: 114 filters on eight rows, null and missing values included. The same filters select no row on the objectui build just before that fix. So the decline was already protecting nothing: it only left convertible filters unconverted and reported TODOs that no longer needed to exist.

What an operator sees:

- `os migrate meta --stored` now lists such a page as a pending rewrite. It used to list it as a `skipped` row with a TODO. A preview over a database whose only legacy filters sat on inline-row blocks therefore exits 1 until `os migrate meta --stored --apply` rewrites them.
- Until then, every stored-row read replays the same rewrite, so the block reads the rule array and shows the same rows.
- Nothing an author writes is accepted or refused differently. The conversion stays retired from the authoring path, and no schema changes.

The migration entries `element-data-source-and-object-block-filter-rule-array` and `object-grid-default-filters-rule-array`, and the protocol-18 step rationale, no longer say that inline-row filters are left as stored.

ADR-0087 disposition: already registered. This changes the behaviour of the registered D2 conversion `page-component-filter-record-to-rule-array` and edits its two D3 entries. There is nothing new to register.

Clause-②: no

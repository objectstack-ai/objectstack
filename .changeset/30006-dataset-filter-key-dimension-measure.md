---
'@objectstack/lint': patch
---

fix(lint): a widget filter keyed on a dataset dimension publishes, and a filter key naming a dataset measure is refused with its own message

Clause-②: yes (widening)
Metadata-protocol: none
Skills-docs: updated here — content/docs/deployment/validating-metadata.mdx

`widget-filter-field-unknown` and `report-filter-field-unknown` now judge a bare filter key against one accept set, held in `judgeDatasetFilterKeys`, so the two rules cannot drift: a field of the dataset's object (authored or registry-injected), then a dimension of the dataset.

- **Widened:** a dashboard widget's own `filter` keyed on a dataset dimension's name (`{ state: 'open' }` for a dimension `state` over the field `status`) was refused at publish as an unknown field, although the dataset query binds it through the dimension's field. It now publishes, as the same key on a report's `runtimeFilter` already did.
- **Refused with its own message:** a bare key naming a dataset measure was already refused by both rules as an unknown field. It is now refused as a measure: a filter compares each row before aggregation, so the dataset query would compare the measure's raw column (`{ amount_sum: { $gt: 100 } }` compiles to `amount > 100`, not a filter on the total), or no column at all for a count, derived or duration measure. The fix line names the measure's column when it reads exactly one. A measure that shares a field's name is still the field, and accepted.

No key that published before is refused now.

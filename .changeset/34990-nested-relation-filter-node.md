---
'@object-ui/core': patch
---

fix(core): a relationship-path dashboard drill is sent as one nested-relation condition, so the server joins it in the database instead of the app reading related ids first

Clause-②: yes (widening)
Metadata-protocol: none

`convertFiltersToAST` now lowers the nested-relation form the spec declares on `FilterCondition` (`{ account: { owner: 'u1' } }`, a plain object with no `$` key beneath a field) to one equality node, `['account', '=', { owner: 'u1' }]`, which the spec's `parseFilterAST` reads back as the same nested condition. It used to refuse that shape as an unknown operator. The condition travels as written, deeper relations included; whether the field is a relationship is judged by the server, which refuses anything else with `INVALID_FILTER` / 400. A map that mixes `$` operators with plain keys is still refused.

`resolveDatasetDrillFilter` uses it: a dataset dimension whose field is a relationship path (`account.owner`, up to three hops) drills as `{ account: { owner: VALUE } }`, nested one level per hop, instead of reading up to 200 related ids per hop and filtering on `$in` them. No related record is read, nothing is capped, and the `too-many` answer is no longer produced; `DATASET_DRILL_RELATED_ID_CAP` and the `too-many` member of `DatasetDrillResolution` stay exported, marked deprecated. The schema reads that check each hop is a single-valued relationship, the hop limit and the empty-bucket refusal are unchanged.

One visible consequence: the drawer's "Open in list" escape hatch is not offered for a relationship-path drill, because the list page's `filter[...]` URL dialect has no spelling for a nested condition; the drill drawer itself lists the records.

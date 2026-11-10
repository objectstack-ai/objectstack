---
'@objectstack/spec': minor
---

feat(spec): type the Ask data tools' `source` block as `ObjectQuerySourceSchema`

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — `skills/objectstack-ai/SKILL.md` names the five tools for agent binding; no skill teaches their result's `source` block

`@objectstack/spec/ai` now exports `ObjectQuerySourceSchema`, its `ObjectQuerySource` type and `OBJECT_QUERY_SOURCE_TOOL_NAMES`. The schema types the `source` block that `query_records`, `query_data`, `get_record`, `aggregate_data` and `visualize_data` answer beside their result: the object, its label, the `where` as the engine accepted it (`FilterConditionSchema`), the `visible_to_you` scope, grouping, aggregations (`AggregationFunction`), ordering with its cut, related lookup paths, the latest-per-group rule, the record count and the finished citation line. An optional key is left out, never `null`; an unknown key is stripped, so an older reader keeps parsing a newer producer's block. It is the object-query sibling of `query_dataset`'s `provenance` (`DatasetProvenanceSchema`), which is unchanged. Nothing reads or writes the block in this package; a producer and a reader can now type themselves against one declaration.

---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

feat(ui): a chat answer shows how its numbers were computed, in a collapsed block that draws only the data tools' `source`

Clause-②: yes (widening)
Metadata-protocol: none

An assistant turn whose data tools answered a `source` block (`query_records`, `query_data`, `get_record`, `aggregate_data`, `visualize_data`) now ends with one collapsed "How this was computed" block, above its sources, in every process-visibility mode. Expanded, it lists per tool the object, the filter (one row per condition with the filter builder's operator words; a filter that is not a flat AND or OR of field conditions is shown as served, and no filter reads "All records"), the grouping fields, the aggregations (with the report's aggregate words), up to five record labels and then "and N more", and "Only records visible to you" for `scope: visible_to_you`. A turn with no source draws nothing new.

The block reads a copy lifted member by member: `detectAnswerSource` (in `mapMessages`) sets the new optional `ChatbotEnhancedToolInvocation.answerSource`. It never reads the tool's `result` or `args`, so no other part of a tool payload reaches it; the debug tool card and its raw payload are unchanged. A `source` without `object`, or with a declared member that is not its shape, is not drawn. The type is local until the spec declares the object-query source; `orderBy`, `limit` and `line` are not drawn.

New keys `chatbot.answerSource.*` in every locale pack (`moreRecords` is a count family).

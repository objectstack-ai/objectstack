---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

feat(ui): a chat answer shows how its numbers were computed, in a collapsed block that draws only the data tools' `source`

Clause-②: yes (widening)
Metadata-protocol: none

An assistant turn whose data tools answered a `source` block (`query_records`, `query_data`, `get_record`, `aggregate_data`, `visualize_data`) now ends with one collapsed "How this was computed" block, above its sources, in every process-visibility mode. Expanded, it lists per tool the object (its label, else its name), the filter (one row per condition with the filter builder's operator words, a condition on a lookup's record under its dotted path; a filter that is not a flat AND or OR of field conditions is shown as served, and no filter reads "All records"), the grouping fields, the aggregations (with the report's aggregate words), how many records the figures cover, and "Only records visible to you" for `scope: visible_to_you`. A turn with no source draws nothing new.

The block reads a copy lifted member by member: `detectAnswerSource` (in `mapMessages`) sets the new optional `ChatbotEnhancedToolInvocation.answerSource`, read as cloud service-ai's `ResultSource` serves it. It never reads the tool's `result` or `args`, so no other part of a tool payload reaches it; the debug tool card and its raw payload are unchanged. A `source` without `object`, or with a drawn member that is not its shape, is not drawn. `orderBy`, `limit`, `related`, `latestPer` and `line` are not drawn. The type is local until the spec declares the object-query source.

New keys `chatbot.answerSource.*` in every locale pack.

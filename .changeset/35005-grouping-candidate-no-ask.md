---
'@objectstack/service-analytics': patch
'@objectstack/mcp': patch
---

fix(analytics): a grouping or time word with only a near dimension no longer stops a matched measure with a question

Clause-②: no
Metadata-protocol: none

A question like 「按行业看销售额」 or "revenue this quarter" sends `list_datasets` a measure word with an exact match (销售额, revenue) and a grouping or time word that matches nothing exactly but is near a dimension (「按行业」 contains 行业, "this quarter" contains `quarter`). The `nextStep` note used to tell the model to ask the user about that word before using it, so an ordinary question got a clarifying question back. Now a word whose candidates are all dimensions is offered as a possible grouping: the note says not to ask about it and that it does not stop the matched measure, which is computed. A word with a measure among its candidates still asks, as before: a bare near-miss measure word (销售 near 销售额) is still `candidates_only` and computes nothing until the user answers, and beside a matched measure it is still asked about.

What changes is the note only. `decision`, `terms`, `matches` and `candidates` are the same as before for every input: a word with only dimension candidates is still `candidates_only` when it is the reported case, and its candidates are still listed. When such a word is the only word sent, the note offers the grouping and asks which number is meant, as it does for a word that equals a dimension.

The `list_datasets` tool description and the MCP `initialize` selection rule now state the scoped rule in the same words: "A word whose candidates are all dimensions is at most a possible grouping: never ask about it, and it never stops a matched measure."

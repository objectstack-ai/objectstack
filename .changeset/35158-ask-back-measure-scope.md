---
'@objectstack/skills': patch
'@objectstack/mcp': patch
'@objectstack/spec': patch
---

docs(skills): the `objectstack-ask` skill and the `list_datasets` output schema ask back only about a word with a measure among its `candidates`

Clause-②: no
Metadata-protocol: none

The `list_datasets` tool description and the MCP `initialize` selection rule already scope the ask-back: "A word whose candidates are all dimensions is at most a possible grouping: never ask about it, and it never stops a matched measure." Two texts a connected client also reads still said to ask about every word with candidates. They now carry the same sentence.

- The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it. Step 2's `candidates` row is now two rows. A word with a measure among its `candidates` is asked about the same way as a word that matches several measures; with one candidate, the client asks whether it is the one meant. A word whose `candidates` are all dimensions is at most a possible grouping: the client never asks about it, and it never stops a matched measure. So 「按行业看销售额」, where 销售额 matches a measure and 「按行业」 is only near a 行业 dimension, is computed and grouped with no question back.
- `@objectstack/spec`: the description of `ListDatasetsOutputSchema.candidates`, which `list_datasets` serves in its `outputSchema`. It said every candidate is offered for a clarifying question. It now says the clarifying question is for a term with a measure among its candidates, and carries the sentence above for a term whose candidates are all dimensions. The doc comment of `DatasetTermCandidateSchema` says the same. No shape changes: `candidates` holds the same entries in the same order.

The new skill row is paid for inside the same file, by removing text that restated another line of it: the `candidates` row's own listing instruction and "Do not pick one." (the row above states both, and the row now says "Ask the same way"), "A word matches nothing, and" in its left cell (step 1 says a word that matched nothing may have `candidates`), and "on the answer" in that step 1 bullet. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill and `content/docs/references/ai/dataset-tools.mdx` from the spec; no code path changes.

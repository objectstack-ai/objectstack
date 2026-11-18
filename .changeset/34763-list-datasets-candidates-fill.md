---
'@objectstack/service-analytics': patch
'@objectstack/mcp': patch
---

feat(analytics): `list_datasets` offers `candidates` for a term that matched nothing, and the selection text says to ask about them

Clause-②: no
Metadata-protocol: none

A business word that equalled no member's name, label or synonym used to get nothing back, so an AI went straight to the object query tools even when a listed measure was obviously what the user meant (`invoice` beside the measure labelled `Invoices`).

`list_datasets` now fills the `candidates` member the spec already declares: for each term with no match in any listed dataset, the members near it, as `{ term, dataset, member }` pointers to members listed in the same answer.

- **Near** means that, after the same normalization the matcher uses, one of the member's names, labels (any locale) or synonyms contains the term, or the term contains it, with both at least two characters (code points) long. `金额` is near `合同金额` and the reverse. No edit distance, stems or embeddings.
- **Only what the caller may read.** Candidates come from the datasets and members the answer lists. A member over a field the caller cannot read, a member over an `internal` field, and a dataset the caller may not query are never offered.
- **Never beside a match.** A term with a match anywhere in the answer has no candidates. What counts as a match is unchanged.
- **Listing order, capped.** Terms in the order sent (a repeated term is offered once), then datasets in the order listed, then each dataset's measures before its dimensions. At most `LIST_DATASETS_MAX_CANDIDATES_PER_TERM` (5) per term, with no marker for the cut. When nothing is offered the key is absent, never an empty list.

The `list_datasets` tool description and the `initialize` selection rule the HTTP MCP server sends now say: each word that matches exactly one measure is computed, and two such words are two metrics computed both; one word matching several measures is a question for the user; a word with `candidates` is the same question, listing each candidate's label, dataset label and description, and a candidate is never picked or treated as a match; no match and no candidates falls back to the object tools, saying the answer is not from a governed metric.

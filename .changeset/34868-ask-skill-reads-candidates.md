---
'@objectstack/skills': patch
'@objectstack/mcp': patch
---

docs(skills): the `objectstack-ask` skill reads `candidates` for a word that matched nothing

Clause-②: no
Metadata-protocol: none

`list_datasets` now answers a business word that matched nothing with `candidates`, the members the server offers as possible readings. The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, still told a client to judge near readings itself from the catalogue. They now read the server's list, in the same rule the `list_datasets` tool description and the `initialize` selection rule state.

What a connected client now reads, where it differs from before:

- Step 1 names `candidates`: a word that matched nothing may have them, each a `{ term, dataset, member }` pointer to a member the same answer lists. A candidate is not a match.
- A word with no match and one or more candidates is a question for the user. The client lists each candidate's label, its dataset's label and its description, picks none, treats none as a match and computes nothing until the user answers.
- One candidate is a question too: the client asks whether it is the one meant. This replaces the earlier wording, in which one near form selected nothing and went to the fallback.
- No match and no candidates for the word for a thing measured is the fallback to the object tools, with the answer saying no governed metric was used (非指标口径).
- The client's own loose-form check is removed: the two rows that had the client judge whether a word was a loose form of several listed measures, and the paragraph that defined a loose form. This supersedes the loose-form sentences in this release's earlier `objectstack-ask` and `GET /mcp/skill` entries. Against a server that returns no `candidates`, a word with no match goes to the labelled fallback, which still names a listed dataset on the same object.

The skill's eval cases cover several candidates, one candidate, and no candidates. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.

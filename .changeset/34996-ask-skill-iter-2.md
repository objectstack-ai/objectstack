---
'@objectstack/skills': patch
'@objectstack/mcp': patch
---

docs(skills): the `objectstack-ask` skill loads for every question about the app's records, asks back without a figure of its own, keeps terms whole and declines a record kind it cannot see

Clause-②: no
Metadata-protocol: none

The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, now tell a connected client:

- The skill is for every question answered from the app's records, before the first data tool call, even one that names no metric: what has been claimed, spent, sold or paid so far, as well as a number, a total, a ranking, a breakdown, a trend or a list ("how much", "so far", 「一共」 join the trigger words).
- A term sent to `list_datasets` is the user's noun phrase for the thing, kept whole ("travel budget", not "travel" and "budget") and without the verbs, time words and question words around it ("trip days", not "trip days requested").
- A reply that asks the user back states no figure of its own (no count, total or option number): each option is named by its label in a bullet, and its description is quoted as written. It asks only about matches or candidates for words the user wrote; a word with no match and no candidates goes to the object fallback instead of a question about another word's matches.
- The object fallback opens with one rule: when the question names a kind of record that no listed object or dataset is, the client says it cannot see those records here (they may be hidden from it) and stops, and never answers from a different object that merely links to them.

Two sentences in the `candidates` row of step 2 that restated step 1 and the paragraph under the table are removed. The skill's eval cases add a question about what has been claimed so far and a question about a record kind no listed object shows. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.

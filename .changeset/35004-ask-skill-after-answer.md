---
'@objectstack/skills': patch
'@objectstack/mcp': patch
---

docs(skills): the `objectstack-ask` skill says what the client does after the user answers an ask-back

Clause-②: no
Metadata-protocol: none

Step 2 of the `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, told a connected client to ask which reading the user meant and stopped there. It now carries the turn after the answer: an option is used only once the user picks it, and is then computed by its exact name as step 3 says (`query_dataset`, with the source cited from the tool's answer); a user who picks none of the options gets step 4, the object-query fallback with its label. This is ADR-0149 D3 rule 2 and rule 4 applied to the user's reply; no rule is added.

Three restatements are cut from the same file, each keeping its other home, so the skill does not grow: "and in the user's language" in step 1 (beside "Do not translate or reword a term"), the "by stage" example and "You still need a measure match" in the grouping row of step 2, and "use none of that word's candidates until the user answers" under the step 2 table, which the new sentence now states for every option. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.

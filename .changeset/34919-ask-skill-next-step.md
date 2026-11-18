---
'@objectstack/skills': patch
'@objectstack/mcp': patch
---

docs(skills): the `objectstack-ask` skill follows `list_datasets` `nextStep` and cites `query_dataset` `sourceLine` as given, before `provenance`

Clause-②: no
Metadata-protocol: none

The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, now tell a connected client two things. Under the step 2 decision table: when the `list_datasets` answer has `nextStep`, follow its `decision` and `note`. In step 3's citation bullet: cite the `query_dataset` answer's `sourceLine` as given, and build the source from `provenance` only when the answer has no `sourceLine`. Both members are answered by servers whose dataset tools fill them; a server that does not answer them leaves the skill's existing steps in force, with the `provenance` citation as before.

Two sentences that restated another line of the same skill are removed: the fallback row's "and say in the answer that no governed metric was used" (step 4 opens every fallback answer with that line) and "no figure" in the paragraph under the table (its next sentence says the same). `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.

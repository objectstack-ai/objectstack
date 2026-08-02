---
'@objectstack/spec': minor
---

A blueprint `formula` field can finally say what it computes: `BlueprintFieldSchema` and its OpenAI-strict mirror both gain `expression`.

`BlueprintFieldSchema.type` is the **full** `FieldType` enum, so the AI-build design step could always NAME a `formula` field — but neither the lenient schema nor the strict mirror the model generates against had any key for the body. There was no way, anywhere on that surface, to state what the formula computed. It materialized bare, and cloud's graph-lint then correctly reported `formula_without_expression` with the fix *"Set field expression to a CEL formula"* — a fix the agent could not write in the blueprint it was holding. Detected, but unfixable on the surface that produced it.

This is the exact hole `summaryOperations` closed for roll-ups in cloud#970 (see this file's own test: *"z.object STRIPS unknown keys, so before this slot existed a blueprint that correctly declared `{ type:'summary', summaryOperations:{…} }` lost the config at the parse waist and materialized runtime-dead"*). `formula` was simply left behind — the same defect, one field type over.

It bites hardest through `nameField`, whose own guidance tells the model to point at a formula for numbered entities (invoice/ticket) that compose `number · name`. Without an expression slot, following that advice produces a record title that is blank on every card, lookup chip and breadcrumb.

**The pin matters more than the key.** A1's root cause is not a forgotten property — it is that two schemas describe the same shape and nothing forced them to agree. The mirror is what the model may EMIT; the lenient schema is what downstream READS. Drift in either direction silently drops authored config. A new test asserts the two field schemas carry **exactly** the same keys, so the next key added to one cannot go missing from the other.

Cloud's `objectBody` carries the value through to materialization (companion change in the `cloud` repo); it reads the key via cast, as it already does for `defaultValue`, so it is inert against an older spec and live as soon as this ships.

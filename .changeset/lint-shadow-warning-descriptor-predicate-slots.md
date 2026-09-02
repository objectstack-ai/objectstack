---
"@objectstack/lint": patch
---

fix(lint): run the flattened-scope shadowing warning on the descriptor-declared predicate slots too (#14288)

The #14089 shadowing warning — a bare name that is BOTH a declared flow
variable AND a field on the bound object, where the variable silently wins at
runtime — reached exactly two expression positions: the node `condition` and
the edge `condition`. The `#4027` descriptor-declared predicate slots were
validated for dialect by the same traversal but were never passed through the
shadowing pass, so the identical mistake stayed silent on them.

The warning is about the **scope** an expression is evaluated in, not the key
it was authored under, and the engine measurement says both `predicate` slots
on the ledger share the run's one flattened variable map:

- `decision.conditions[].expression` — the decision executor evaluates against
  the very `variables` parameter the engine hands every node executor, which is
  the same `Map` object `seedRunVariables` built and a node `condition` is
  judged against. Nothing on the path clones or narrows it.
- `screen.fields[].visibleWhen` — `refuseInvalidScreenInput` evaluates against
  `run.variables` (the persisted snapshot of that same seeded map) with the
  submitted bag overlaid. A superset, so the shadow still reaches it: the
  overlay carries the screen's own collected values, never the bound record's
  field, so it can never hand back a field the variable displaced.

`loop.collection` and `map.collection` are `flow-template`, not `predicate`,
and the slot loop already skips them.

Warning-only and within the 2026-09-01 option-C ruling's letter: one more call
site reusing the `declaredVariables` set already collected once per flow, no
new rule id, no severity above `warning`, no accept set moved, and no bare
identifier judged for being bare. Nothing that linted clean before can newly
fail a build.

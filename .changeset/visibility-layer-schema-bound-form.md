---
"@objectstack/lint": patch
---

fix(lint): judge a schema-bound metadata form at its own binding layer (#7815)

At the runtime publish gate, `validateVisibilityPredicates` ran at its
`'runtime'` layer default for **every** view, including schema-bound metadata
forms (`data: { provider: 'schema', schemaId }`). Those forms bind the row under
edit as `data`, so correct metadata drew a `visibility-root-mislayered` advisory
telling its author to write `record.` — a root that surface binds nothing under —
and `visibility-bare-identifier`'s hint prescribed `record.<word>` for the same
reason. Nothing went red, which is how it survived: the gate was green, the
advisory was simply wrong, and the only symptom was authors and AI authors being
steered to the wrong root at the publish door.

The layer is now read off the metadata where the metadata states it. A form view
declaring `data: { provider: 'schema', schemaId }` is judged at `metadata`; every
other site — a plain runtime view, every page component — still takes the
caller's `opts.layer` (default `'runtime'`), so `os validate` / `compile` and any
file-aware caller are unchanged. It is derived from the same `schemaIdOf` call
that already decides the right-hand-literal-slot stand-down (#7696), so the two
verdicts cannot disagree about which surface they are on.

Three consequences on a schema-bound form, all advisory:

- a correctly `data.`-rooted predicate no longer draws the mis-layer advisory;
- a `record.`-rooted one now does, in ADR-0089 D3's other direction — that
  predicate can never match, and this door was silent about it;
- `visibility-bare-identifier` prescribes `data.<word>`, the root the surface
  actually binds.

`visibility-root-mislayered` is `warning` in both directions and no other rule's
severity or firing condition moves, so **acceptance is untouched**: the same
inputs are refused, with the same ids, at the same paths. That boundary is pinned
as a property in `runtime-gate.test.ts` rather than left as a claim.

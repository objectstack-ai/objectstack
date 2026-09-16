---
'@objectstack/plugin-sharing': patch
---

docs(plugin-sharing): the `grantsRefused` subtype comment states the NARROWING, not a spec lag (#15712)

Two comments in this package described a spec/plugin lag that #14969 ended.
`@objectstack/spec` now declares `grantsRefused?: number` on
`SharingRuleEvaluationResult` itself, so "the six declared fields are unchanged"
and "the contract lives in `@objectstack/spec` and is another lane's to move"
read as if the spec were still behind. A reader reconciling the two would
conclude the spec is missing a key it has.

No code moves. `SharingRuleReconcilePassResult extends SharingRuleEvaluationResult
{ grantsRefused: number }` is a legal covariant narrowing before and after, and
that narrowing is now what the prose says: the spec declares the key OPTIONAL on
purpose — an `ISharingRuleService` implementation that does not count refusals
leaves it ABSENT, and absent is not `0` — while this implementation always counts
them and therefore requires it. The load-bearing paragraph is kept verbatim:
`grantsRefused > 0` is NOT "the pass failed", it is the pass reporting that it met
a record it cannot grant on and CONTINUED.

What reaches a consumer: doc comments, and only through the published
`dist/index.d.ts` / `dist/index.d.mts`, where the JSDoc on the exported
`SharingRuleReconcilePassResult` ships (705,069 to 705,528 bytes). The
declaration-only projection of that file, comments stripped, is byte-identical
before and after — no exported symbol added or removed, no key changed — and the
JavaScript outputs (`dist/index.js`, `dist/index.mjs`) are untouched, because the
compiler strips comments from them.

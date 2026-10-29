---
'@object-ui/core': minor
---

fix(core): `evaluatePlainCondition` reads a bare-string predicate as CEL, the way the spec defines it and `evaluateCondition` reads it

Clause-②: no (narrowing)
Metadata-protocol: narrowed

`@objectstack/spec` defines a bare string in a predicate slot as shorthand for `{ dialect: 'cel', source }`, the server evaluates it on CEL, and `ExpressionEvaluator.evaluateCondition` reads it on CEL. The published `evaluatePlainCondition(condition, record)` export still read a bare string on the legacy JavaScript expression grammar, so a host calling it got the opposite dialect from every other predicate path: a CEL-only predicate such as `status in ['overdue', 'urgent']` or `size(tags) > 0` faulted and answered `false`.

- A bare string handed to `evaluatePlainCondition` is evaluated on the canonical `@objectstack/formula` CEL engine, the route `evaluateCondition` gives it, so a predicate that evaluates gets the same verdict from both. Record fields stay readable both bare (`status`) and under `data.` (`data.status`).
- The function's answer is unchanged in shape: `true` only when the predicate evaluates to `true`; a fault, a non-boolean result and a blank condition answer `false`, with no console line.
- Unchanged: a `${…}` template is still evaluated on the legacy engine.

**BREAKING**: a bare string passed to `evaluatePlainCondition` is read on CEL only, as the spec defines it. A predicate that relied on syntax only the legacy JavaScript grammar reads (for example `===`, `!==`, `?.`, `??`, `.includes(…)` or `.length`) now faults and the function answers `false` where it used to evaluate. Write the predicate in CEL, the one predicate language the spec and the server define (ADR-0032): equality is `==`, membership is `in`, a substring test is `.contains(…)`, a length is `size(…)`, a presence test is `has(…)`. Measured in this repository, nothing outside its own tests calls the export.

<!-- adr-0087: not-required (no-migration-prescription) the narrowed spellings were never valid under the protocol: the spec defines a bare string as CEL and the server already evaluated it on CEL and rejected them, so no stored metadata the server accepted changes meaning and there is nothing for objectstack migrate meta to rewrite -->

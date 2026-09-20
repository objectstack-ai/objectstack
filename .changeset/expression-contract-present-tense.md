---
"@objectstack/spec": patch
---

fix(spec): the Expression contract is stated in the present tense — the M9.1 / M9.2 phase language is dropped (#17849)

Clause-②: no

No accept-set change. `ExpressionSchema` still accepts `source` OR `ast`, every
evaluated slot still requires a non-blank `source`, and no key is added, renamed
or retired. What moves is the text six citation sites carried.

Those docblocks promised a two-phase roadmap — "Phase 1 (M9.1): `source` is the
canonical persisted form … Phase 2 (M9.2+): `ast` becomes required in build
output" — that no ADR ever chartered, and the refusal sentence an author reads
carried the phase id inside it. #17323 ruled the promise removed: `ast` stays an
accepted optional structured value with no promise of becoming required. The
contract is now written as it actually is:

- `source` is the canonical persisted form — it is what the engine evaluates;
- `ast` is accepted beside it as an optional opaque structured value, and
  carries no promise of becoming required;
- a slot whose value the engine RUNS requires `source`, which is what
  `EvaluatedExpressionSchema` spells out.

**The one published string that moves** is `EVALUATED_EXPRESSION_SOURCE_REQUIRED`,
the sentence an author reads when an evaluated slot refuses a non-evaluable
envelope. It loses four words and nothing else:

> … the expression engine evaluates `source` (the canonical persisted form of
> phase M9.1) and cannot evaluate `ast` alone …

now reads

> … the expression engine evaluates `source` (the canonical persisted form) and
> cannot evaluate `ast` alone …

Nothing parses that sentence for its content: every consumer imports the
constant by name, and the two pending changesets that quote it verbatim
(`flow-edge-condition-evaluated-slot`,
`blank-node-condition-refused-at-registration`) already carry the new wording,
so the quote stays a quote.

The `packages/formula` half of the same ruling — `cel-engine.ts`'s AST-only arm
and `normalize.ts`'s header — is comment-only and publishes nothing from that
package (`@objectstack/formula` ships `dist` alone), so it is not graded here.

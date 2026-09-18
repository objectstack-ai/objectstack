---
"@objectstack/spec": patch
---

**`cel` / `expression` (and the `F` / `P` aliases) now declare the `EvaluatedExpression` they have always emitted.** Both helpers always write a non-blank `source`, but both were declared as returning `Expression`, whose `source` is optional — a declaration of a shape neither function can produce. Fixed at the producer (#17778).

Clause-②: no

**Not a narrowing of anything an author can write.** No zod schema moves in this release entry: the accept set of every slot is unchanged, `api-surface/` is unchanged, and no export is added, removed or renamed. What changes is the return type in the published `.d.ts` of two existing exports, and narrowing a return type removes nothing from a caller — `EvaluatedExpression` is assignable to `Expression`, so every existing consumer still compiles and no call site needs editing.

**Why it is worth a release entry anyway.** Every slot that composes `EvaluatedExpressionInputSchema` requires a non-blank `source`, so a ``P`record.status == 'paid'` `` assigned straight into one was a TS2322 against a value the schema accepts at runtime — the recommended authoring form failing to type-check in exactly the place it is recommended. The over-wide declaration was the cause, and the producer is where it is fixed rather than at the call sites (Prime Directive #12).

**The predicate fault-semantics contract is recorded, not enforced, by this release.** ADR-0137 states what a field-rule predicate does when it cannot RUN: at SUBMIT a faulting predicate refuses the write and names the field and the rule (D2); at RENDER visibility stays fail-OPEN, so a rule that could not run never hides a control and lets the form write `null` over a column the user never saw (D3); a blank or faulting GATE predicate is diagnosed, never a silent `true` (D4); and the evaluation helper's fallback stays freely specifiable (D5), because fault-to-flag and fault-to-throw both exist only because it is a parameter. Those are consequences CONSUMERS deliver — `packages/spec` carries no business logic — and they land in the ObjectUI half. D1's authoring refusal (an `ast`-only envelope and a blank `source` are refused at authoring) is ruled by decision batch #122 item 2 and ships with the evaluated-slot narrowing that owns it, under that change's own ADR-0087 entry.

---
"@objectstack/spec": minor
---

**BREAKING (accept-set narrows)** — a predicate slot now accepts only what the expression engine can actually run. `PredicateSchema` / `PredicateInputSchema` compose the EVALUATED rule instead of the persistence contract, and the `FieldSchema` field-rule triad — `visibleWhen`, `readonlyWhen`, `requiredWhen` — binds them (#17778, ADR-0136 D1).

Clause-②: yes (narrowing)

**FROM → TO.** Two spellings stop parsing on those three slots, and on any slot composing the `Predicate*` aliases:

- `{ dialect: 'cel', ast: … }` with no `source` → **TO** `{ dialect: 'cel', source: "record.status == 'paid'" }`
- `{ dialect: 'cel', source: '   ' }`, or the bare-string shorthand `'   '` → **TO** the same non-blank envelope, or the `P` tagged template the examples use

**The one-line fix:** author the predicate's `source`, or REMOVE the key if the field was meant to carry no rule. Removal is behaviour-preserving here — all three slots resolved both refused spellings to a no-op already — so it is a safe default, but it records that the rule never ran. Authoring the `source` is the repair.

**Why this is a break worth taking.** The CEL engine evaluates `source` alone, so both spellings parsed, registered, passed `objectstack validate`, and then produced a rule that silently did nothing — by three *different* mechanisms, each measured at its own end: a field-level `visibleWhen` is never evaluated server-side at all; `isReadonlyWhenLocked` returns LOCKED only for an unbound-ROOT fault and logs `change allowed through` for every other one, which is the arm an unevaluable envelope takes, silently waiving the declared lock; `requiredWhen` logs and SKIPS the check. One unauthored predicate therefore made a form show more, lock less and demand less at once, with no state saying the rule had not run.

**`ExpressionSchema` / `ExpressionInputSchema` are NOT narrowed** — they remain the persistence contract (`source` OR `ast`), and an `ast` BESIDE a string `source` stays admitted everywhere. Absence is untouched: "no rule" was never a malformed rule.

**Declared beside the narrowing, delivered by consumers.** ADR-0136 also records the fault semantics the renderer and submit path are held to: a faulting field-rule predicate refuses the SUBMIT loudly, naming the field and the rule (D2), while visibility stays fail-OPEN at RENDER so a rule that could not run never hides a control and lets the form write `null` over a column the user never saw (D3) — a pair, neither safe alone. `packages/spec` carries no business logic, so those land in the ObjectUI half. The evaluation helper's fallback stays freely specifiable (D5): fault-to-flag and fault-to-throw both exist only because it is a parameter.

**Repo census.** Zero field-rule predicates of either refused spelling across `examples/`, `packages/`, `content/` and `skills/` at `03b7b8187`, against two live lit controls (15 files with non-blank tagged-template predicates, 14 with envelope-form ones). Nothing in this repository needed rewriting.

<!-- adr-0087: registered field-rule-predicate-evaluated-slot-source-required -->

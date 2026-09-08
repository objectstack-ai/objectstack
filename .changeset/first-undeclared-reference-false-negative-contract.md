---
"@objectstack/formula": patch
"@objectstack/lint": patch
---

`firstUndeclaredReference` now documents the side of its contract it was silent about: it can false-NEGATIVE, and a `null` is "nothing was reported", not "every reference is rooted".

The existing sentence — "Acts ONLY on cel-js's `Unknown variable: X` fault, so it cannot false-positive on arithmetic/comparison overloads" — is true, and stays. What it never said is what that narrowing costs. cel-js's checker returns exactly ONE error, so when the first one is of another class every undeclared reference behind it in the same source goes unjudged and the helper answers `null` — the same value that means the source is clean. A contract that declares only which error it cannot make reads as making neither.

No behaviour changes. This is the contract text, and it ships: the amended block is JSDoc on a published export, so it is emitted into `@objectstack/formula`'s `dist/index.d.ts` and `dist/index.d.mts` (measured — the declaration file grew 53.45 KB to 55.99 KB) and is what a consumer reads on hover.

What the amendment adds, all of it measured rather than reasoned:

- **The masking is positional, not name-keyed.** The masked name is not the one that triggered the first error, so excluding the trigger's own name does not reach it. `data == 'x' && status == 'q'` answers `null`; the same two names in the other order answer `"status"`.
- **`celEngine.compile()` is not a gate against it.** `compile` type-checks in the permissive environment, where every unlisted name is `dyn`. The strict environment here declares `SCOPE_ROOTS` as `map`, so a root — or an object field sharing one of those names (`data`, `config`, `result`, `item`, `event`, `input`, `user`, …) — used as the operand of an operator with no `map` overload faults HERE and nowhere else. A caller that only reaches the helper on a clean compile is therefore not protected by its own gate.
- **The CEL type-name class is the same shape.** `type == 'grid'` is already pinned as a blind spot in `@objectstack/lint`'s `visibility-bare-identifier` suite, but pinned per NAME; the masking it causes is source-wide.
- **What closing it would take, and why that is not this change.** Widening the regex onto the overload message is the false positive the narrowing buys off (`type(record.x) == string` is legitimate CEL). Reporting past the first error needs a re-check loop over a neutralised source, or a checker entry returning more than one error — cel-js 8.0.0 has neither; its `TypeCheckResult` carries a single `error`. Both change what every consuming rule reports, so the oracle's shape is a design decision.

`@objectstack/lint` carries a second comment-only correction, to `flow-variable-scope`'s account of the same oracle. Its "known, deliberate blind spot" note bounded the under-report to a flow variable named after a `SCOPE_ROOTS` member; measured, the bound does not hold — such a name in an operand position terminates the discovery loop on iteration 0 and every shadow in that source is lost, whatever it is named. That block sits on an internal function, so unlike the `formula` half it reaches no published declaration file; the entry is here because the package is touched and published.

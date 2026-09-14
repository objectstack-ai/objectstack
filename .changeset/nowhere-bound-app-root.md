---
'@objectstack/lint': patch
---

**Fix:** a field-level `*When` predicate reading `app` no longer tells the author the root is mounted by the renderer — decision batch #67 ruled that away, and the diagnostic now says `app` binds nowhere at all.

`FIELD_RULE_AMBIENT_ROOTS` is renamed `FIELD_RULE_NOWHERE_BOUND_ROOTS` and keeps its single member. The name and the docblock were the false part: #13935 added `app` on the premise that objectui's app-shell bound it at the renderer, so the honest verdict was "bound somewhere, just not here". Batch #67 (2026-09-07) ruled the engine's `SCOPE_ROOTS` to be the contract and ObjectUI aligned to it, so nothing binds `app` any more — and the constant's cited source of truth, the page-component schema's ambient-roots section, no longer names `app` either.

What an author reads changes; what lints clean does not. Before and after, both `app` spellings earn exactly one `error`.

- **Before:** `` `app` is NOT declared platform-wide — it is an AMBIENT root, mounted only by the renderer (…) So it resolves in a form VIEW's own field predicate and on no server path at all … `` and, at the end, an offer to *"leave the `app`-dependent decision on the view's own field predicate where `app` IS bound"* — a destination that no longer binds it.
- **After:** `` `app` is NOT declared platform-wide, and no evaluation site binds it — not this one, and not any other … The predicate therefore faults wherever it is written, and there is no surface to move it to. ``

The ``⛔ Do NOT write `record.app` `` refusal is kept verbatim, and that is the point of the repair. Emptying the constant — the obvious reading of "nothing is ambient any more" — drops the root through to `@objectstack/formula`'s generic bare-reference check, whose prescription is to rewrite the root as a member of the record; following that earns ``unknown field `app` `` one pass later. That is the exact two-step wrong correction #13935 existed to remove, so the membership stays and only its grounds move. Four pins now assert, on both the bare and the dotted spelling, that no path produces that prescription.

No published export moves: `FIELD_RULE_AMBIENT_ROOTS` was never re-exported from this package's entry (only `validateStackExpressions`, `fieldRuleRootIssue` and `FIELD_RULE_BOUND_ROOTS` are), so the rename is internal and no import breaks.

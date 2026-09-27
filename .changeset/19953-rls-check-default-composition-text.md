---
"@objectstack/spec": patch
"@objectstack/lint": patch
---

fix(spec, lint): the RLS `check` → `using` default is stated per operation across the applicable policies, as the runtime applies it, not per policy (#19953)

Clause-②: no

Text only. No schema shape, accepted value or runtime behaviour changes.

`RowLevelSecurityPolicySchema.check` said the clause "defaults to USING clause if not specified", which reads as a rule for each policy on its own. The write gate decides the default once per write operation, across every applicable policy:

- When any applicable policy for the operation declares `check`, only the declared checks decide, OR-combined. A policy with only a `using` beside them adds nothing to the check.
- Only when none declares `check` does each applicable policy's `using` stand in as its check, OR-combined.

A policy is applicable when it is not `enabled: false`, its `object` is the written object or `'*'`, its `operation` is the write's own or `'all'`, and the caller holds one of its `positions` when it lists any. A `check` on a `select` or `delete` policy is never evaluated.

The check runs on the new row of a single-record insert and of a by-id update. An array insert and a `multi: true` update are not post-image checked; those are tracked in #19964 and #19950, and the texts now say so instead of implying every insert and update is checked.

- **`@objectstack/spec`**: the `check` describe and TSDoc state this composition and that scope. The `rowLevelSecurity[].priority` refusal no longer gives "applicable policies OR-combine (most permissive wins)" as its reason, which is not true of the write check, and the file overview limits "OR-combine" to reads. The generated reference pages (`references/security/rls`, `references/security/permission`) are regenerated from the describe.
- **`@objectstack/lint`**: the `rls-predicate-*` findings on a `using` now also say what the dropped `using` does to an insert. On an `insert` or `all` policy, when no applicable policy for the insert declares a `check`, that `using` is also the single-record insert check. If nothing else in that set compiles, every single-record insert the policy governs is refused with `PermissionDeniedError`. The findings on a `check` now say the refusal is a blanket one only when no other applicable policy declares a `check` that compiles.

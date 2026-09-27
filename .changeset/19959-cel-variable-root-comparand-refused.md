---
"@objectstack/formula": minor
"@objectstack/plugin-security": minor
"@objectstack/plugin-sharing": minor
"@objectstack/lint": minor
"@objectstack/spec": patch
---

A row-level or sharing-rule predicate comparing with `!=` / `==` against the bare `current_user` root is refused at the CEL lowering instead of lowering against the whole caller context object (#19959).

**BREAKING** — an accept-set narrowing, shipped by `@objectstack/formula`, `@objectstack/plugin-security`, `@objectstack/plugin-sharing` and `@objectstack/lint` as `minor` under the repo's launch-window convention for accept-set narrowings. The hand-migration prescription is registered under protocol major 18 as `cel-predicate-variable-root-comparand-refused`.

Clause-②: no (narrowing)

**Security fix for RLS write checks.** A policy written `record.owner_id != current_user` (or `== current_user`, or `!(record.owner_id == current_user)`) named the variable root alone, which resolved to the whole caller context, and lowered to `{ owner_id: { $ne: <that object> } }` (or the bare object, or `$not` around it). A strict compare never equals an object, so a `check` so written admitted and stored every insert and by-id update it was written to refuse, a USING-only such policy admitted every insert, and explain reported the read as narrowed with the caller's membership sets echoed in its `readFilter`. A constant comparison such as `current_user != 'guest'` folded to no restriction.

- `@objectstack/formula`: `compileCelToFilter` refuses `==` / `!=` whose operand is the bare variable root (`unsupported`), in both of its modes, so the authoring shape check (`isPushdownableCel`, `isSupportedRlsExpression`) reports it before any request. A variable that resolves to an object is refused per request; a `Date` still passes.
- `@objectstack/plugin-security`: the RLS compiler drops such a policy and fails closed when no other policy applies (`RLS_DENY_FILTER`: reads return no rows, `check` writes are refused 403, explain answers `denies`).
- `@objectstack/plugin-sharing`: a declared sharing rule with such a `condition` is still skipped at bootstrap, now with reason `unsupported` instead of `unresolved-variable`.
- `@objectstack/lint`: the shape is reported as `rls-predicate-unenforceable` on either RLS clause, where it was silent, and as `sharing-rule-unlowerable-condition` on a sharing condition, where it was `sharing-rule-runtime-variable-condition`.
- `@objectstack/spec`: the migration registry carries the entry.

**What to change.** Compare against the key the predicate means: `record.owner_id != current_user` becomes `record.owner_id != current_user.id` (or `current_user.organization_id`, `current_user.email`); a membership test is `record.owner_id in current_user.org_user_ids`. Scalar keys, `in`, `null`, literals and field-to-field comparisons are unchanged.

<!-- adr-0087: registered cel-predicate-variable-root-comparand-refused -->

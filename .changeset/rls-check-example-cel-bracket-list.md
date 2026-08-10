---
'@objectstack/spec': patch
---

fix(spec): the RLS `check` clause's enumerated-values `@example` is CEL, and compiles (#6641)

`RowLevelSecurityPolicySchema.check` in `security/rls.zod.ts` documented
set membership as `status IN ('draft', 'pending')`. That predicate does not
compile, and the failure is not cosmetic — an author who copies the schema's
own example gets a policy that **denies every row**.

The runtime path is `RLSCompiler.compileExpression` → `sqlPredicateToCel` →
`compileCelToFilter`. The deprecated SQL bridge (ADR-0058 D1) rewrites the
*word* `IN` to `in` and never the parentheses, and CEL's list literal is
**bracketed**, so the bridged `status in ('draft', 'pending')` is a parse error
(`Expected RPAREN, got COMMA`). `compileExpression` then returns `null`,
`compileFilter` sees `filters.length === 0`, and a single-policy object falls to
`RLS_DENY_FILTER`. `@objectstack/lint`'s `validateRlsPredicateEnforceability`
rejects the same predicate at authoring time, so the symptom is "I followed the
schema's example, and now lint errors and every query comes back empty".

The neighbouring `IN (current_user.team_member_ids)` examples were never broken
and are unchanged: a single `(expr)` happens to be a legal CEL parenthesised
group, so that spelling survives the bridge. It collapses only once the list
holds a second element — which is why measuring one example never covered the
other.

The example now reads `status in ['draft', 'pending']`, the canonical CEL
spelling. Measured through the runtime's own path, it compiles to
`{ status: { $in: ['draft', 'pending'] } }`, and under CHECK-clause semantics it
accepts a post-image whose `status` is `draft` or `pending` while refusing
`published`, `null`, and an absent field — which is what "Only allow certain
statuses" has to mean.

Documentation only: no schema key, type, or accepted value changed, and the
deprecated bridge was deliberately **not** widened to rewrite parenthesised SQL
lists (that would add surface to a dialect being retired, and would change what
compiles). `@objectstack/formula`'s `rls-predicate.test.ts` now pins every
`@example` on `using` / `check` through the ADR-0056 D4 shape gate, so a
documentation example that stops compiling fails a test instead of an author's
first policy.

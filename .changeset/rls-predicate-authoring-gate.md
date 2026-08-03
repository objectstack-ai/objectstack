---
"@objectstack/formula": minor
"@objectstack/lint": minor
"@objectstack/plugin-security": patch
---

feat(formula,lint): wire ADR-0056 D4's RLS authoring gate, from the runtime's own predicate (#4983)

`isSupportedRlsExpression` has carried the same docblock since ADR-0056 D4:
"exposed so an authoring-time gate (`objectstack compile`) can REJECT a
predicate the runtime would silently drop … A `false` here means 'this
predicate will never enforce'." It had **no non-test consumer anywhere** — the
function written to fix declared-but-never-read was itself declared and never
read. This lands the consumer, in two steps that had to happen in this order.

**1. `sqlPredicateToCel` and `isSupportedRlsExpression` move FROM
`@objectstack/plugin-security` (`src/rls-compiler.ts`) TO `@objectstack/formula`
(`src/rls-predicate.ts`), and are exported from its root.** Executable code
unchanged — a change of address, not of behaviour; `plugin-security` now imports
them from `@objectstack/formula` and keeps no copy, so there is still exactly
one definition. No import path outside the two packages changes: neither symbol
was ever exported from `@objectstack/plugin-security`'s entry point. The move is
what makes step 2 possible at all — `@objectstack/lint` may depend on
`@objectstack/spec` and never on a runtime, so with the predicate living in a
runtime the gate's only other door was copying the SQL→CEL bridge, whose
boundary conditions (quoted literals are never rewritten; canonical CEL passes
through unchanged) *are* the gate's red/green line. A fork drifting by one
character rejects policies the runtime executes correctly — the false-positive
direction, which is worse than the gap. ADR-0058 D1 asks for a single canonical
shape gate; the bridge is part of that gate.

**2. New `@objectstack/lint` rule `validateRlsPredicateEnforceability`,
`error`, on all three authoring commands**, over
`permissions[].rowLevelSecurity[].using` and `.check`:

- **`rls-predicate-unenforceable`** — parses as CEL, outside the pushdown
  subset: a function call (`size(...)`, `has(...)`), arithmetic, a ternary, a
  cross-object path (`record.account.region`).
- **`rls-predicate-unparseable`** — does not parse as CEL even after the legacy
  SQL bridge (`=` → `==`, `IN` → `in`): SQL `AND` / `OR` / `LIKE`, a subquery.
  Its own id because the fix is different — write CEL (`&&`, `||`), not a
  different shape.

What the gate prevents, measured through `plugin-security` rather than inferred:
`RLSCompiler` drops the policy and logs one request-time WARN. On the read path,
when it is the only applicable policy, `compileFilter` returns the
`RLS_DENY_FILTER` sentinel instead, which is AND-ed onto the where clause — so
every select / update / delete on the object matches **zero rows**. On the
ADR-0058 D4 write path the post-image `check` becomes that same sentinel, which
no record satisfies, so every insert / update fails with `PermissionDeniedError`.
The runtime fails closed, which is why this was survivable: the result is not a
hole but a policy that reads as an authorization and behaves as a blanket
refusal, with nothing at authoring time pointing at the line that caused it.

Fix a flagged predicate by rewriting it inside the lowerable subset — `==` `!=`
`>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and
`startsWith` / `endsWith` / `contains` over single-column field paths (ADR-0058
D2), against a literal or a `current_user.*` value. Two specific migrations:
`has(x)` / `size(x) > 0` → `x != null` (a function call is correct in an object
*validation* rule, which is interpreted, and wrong here, where the predicate is
compiled to a filter); and a related record's field → denormalise it onto this
object (formula/rollup) and test that column, since RLS cannot join (ADR-0055).

Same construction as the sharing-rule gate (#4698): the rule does not model the
consumer or grep for it — it calls `isSupportedRlsExpression`, the exact
function `RLSCompiler.compileFilter` consults to decide whether a dropped policy
earns its warning, so the two verdicts are one boolean by construction, pinned
in both directions over a shared corpus. Measured before shipping: every RLS
predicate declared anywhere in this repo — the `plugin-security` platform seeds,
the examples, the dogfood fixtures, the authoring skill — is supported, so the
gate turns nothing red that works today. Unlike the sharing-rule gate, CEL
*syntax* is reported here rather than deferred to `expression-invalid`:
`validateStackExpressions` does not walk `rowLevelSecurity` at all, and could not
judge this field correctly if it did, because `owner_id = current_user.id` is a
CEL syntax error and a working RLS predicate at the same time.

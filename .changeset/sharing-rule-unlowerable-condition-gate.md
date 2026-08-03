---
"@objectstack/lint": minor
---

feat(lint): reject a sharing-rule condition the runtime can only skip (#4698)

#4698 reported the same failure shape three times in one app in one day: a key
that is authored, is schema-valid, reads as meaningful — and is never consumed
by the runtime. Every check verifies that what is declared is *well-formed*,
never that it is *read*. The issue's third measured instance is a sharing rule
whose CEL `condition` uses `has(...)`: the seeder cannot lower it, skips the
rule, and the only signal is one WARN line at boot. The rule exists in
metadata, is absent from `sys_sharing_rule`, and grants nothing.

**New rules, both `error`, on all three authoring commands:**

- **`sharing-rule-unlowerable-condition`** — the condition is outside the
  pushdown subset: a function call (`has(...)`, `size(...)`), arithmetic, a
  ternary, or a cross-object path (`record.account.region`).
- **`sharing-rule-runtime-variable-condition`** — the condition reads
  `current_user.*`. Criteria sharing rules are materialised (one static
  `criteria_json` per rule, from which grants are written), so there is no
  "current user" at compile time. The fix is a different mechanism, not a
  different spelling, which is why it has its own id.

Fix each by rewriting the predicate inside the lowerable subset — `==` `!=`
`>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and
`startsWith` / `endsWith` / `contains` over single-column `record.<field>`
paths (ADR-0058 D2). Two specific migrations: `has(record.x)` → `record.x !=
null` (`has()` is correct in an object *validation* rule, which is
interpreted, and wrong here, where the condition is compiled); and a related
record's field → denormalise it onto this object (formula/rollup) and test
that column, or share the related object instead. For per-user access, use an
RLS policy (`rowLevelSecurity[].using`), where `current_user.*` *is* resolved.

**Why this one surface and not "unread keys" in general.** "Is this key read?"
is only a lint question when the answer is computable from the authored
metadata alone, and usually it is not — a repo-wide grep for a reader is not
evidence of absence, and a consumer may live in another package, another repo,
or an uninstalled plugin. A sharing rule's `condition` is the case where the
predicate is exact: its one runtime consumer
(`bootstrapDeclaredSharingRules`) does exactly one thing with the key —
`compileCelToFilter(condition, { variables: {} })` — and a condition that does
not lower means the rule is skipped outright. So the lint calls that same
compiler, from the same package, with the same options, instead of modelling
the consumer; the verdict is identical to the seeder's by construction and is
pinned in both directions by a test over a shared corpus.

`error` rather than advisory, per the ADR-0078 claim `SharingRuleSchema`'s own
docblock makes ("the whole authorable surface is enforced — nothing here
validates and then silently does nothing"): there is no reading under which an
unlowerable condition does what it says. It fails closed, which is why it was
survivable, not why it was acceptable. Measured before shipping: every
sharing-rule condition declared anywhere in this repo lowers cleanly, so the
gate turns nothing red that works today.

CEL *syntax* errors are deliberately left to `expression-invalid`, which
already gates this same field with a message written about syntax.

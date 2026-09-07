---
"@objectstack/spec": patch
---

docs(spec): mark `PromptTemplate.system` / `.user` `[EXPERIMENTAL — not enforced]` (#15954, #16321)

Prose only. `Clause-②: no` — no accept-set change, no new/narrowed authorable
key, no matrix declaration. Every value that parsed before parses now, and
every value refused before is refused identically.

Under the #15954 ruling (decision batch #56, option B) the template-typed pair
is **marked, not retired**. Both `.describe()` strings on
`ai/PromptTemplateSchema` now carry the repo's existing
`[EXPERIMENTAL — not enforced]` prefix and state that no runtime renders or
executes the template today:

```ts
system: TemplateExpressionInputSchema.optional().describe('[EXPERIMENTAL — not enforced] System prompt — supports {{var}} interpolation. No runtime renders or executes the template today.'),
user:   TemplateExpressionInputSchema.describe('[EXPERIMENTAL — not enforced] User prompt template — supports {{var}} interpolation. No runtime renders or executes the template today.'),
```

**Why an author sees this.** `PromptTemplateSchema` has no consumer outside
`packages/spec`, so the `{{var}}` holes are never interpolated and the declared
`variables` are never checked against them. The ADR-0058 D7 conformance ledger
already recorded that verdict (`template-prompt`, `state: 'experimental'`,
`PARSE ONLY — NO EVALUATOR FOUND`); until now nothing said it at the
declaration, so the generated reference page advertised a capability the
runtime does not deliver.

**What does NOT change.** `.user` remains **required** and `.system` remains
optional — the schema shape is untouched. Optionalising or retiring a required
key is a parse-breaking change and is deliberately left to its own card. No
tombstone and no ADR-0087 entry is owed: nothing is renamed, retired or
re-typed.

---
"@objectstack/spec": patch
---

fix(spec): docs-gen no longer cuts a nested `{…}` / `<…>` in half (#5452)

The reference-docs generator wraps a delimited fragment of `.describe()` prose
in an inline-code span so MDX renders it literally instead of parsing it as a
JS expression or a JSX tag. It located the fragment's closing delimiter with
`indexOf` — the **first** closer, not the **matching** one — so any nested pair
was wrapped only up to its inner closer and the outer one fell outside the
span.

The published symptom: `{{var}}` in a description was emitted as
`` `{{var}` `` followed by a stray `}`. Readers saw `{{var}` plus an orphan
brace on precisely the rows that teach template-variable syntax, where the
paired double brace *is* the thing being documented. Nesting is not an exotic
input in this corpus — template interpolation and filter-map examples both
produce it.

The matcher now counts nesting depth, so the whole pair lands inside one code
span. Five rows across four regenerated reference pages change:

- `references/ai/model-registry.mdx` — `PromptTemplate.system` / `.user`,
  both `{{var}}`
- `references/automation/flow.mdx` — `flow.nodes[].outputSchema`,
  `{{nodeId.field}}`
- `references/ai/solution-blueprint.mdx` — the roll-up `filter` example,
  `{ status: { $in: [...] } }`
- `references/api/analytics.mdx` — the retired `query` envelope,
  `{ cube, query: {...} }`

The issue reported three; the last two were cut in the same place but start
with a single brace, so the `` `{{ `` grep that found the others could never
have seen them.

Unchanged: a single `{…}` pair, a `{<id>}` nest, and a lone unmatched `<` / `{`
(entity-escaped, e.g. a SemVer range `>=4.0 <5`) all escape exactly as before.
No package export or runtime behaviour changes — the fix is in
`scripts/build-docs.ts`, whose escaping moved to `scripts/lib/escape-mdx.ts` so
it can be pinned directly rather than by grepping emitted `.mdx`.

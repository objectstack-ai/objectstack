---
"@objectstack/spec": patch
---

test(spec): pin the input half of every recursive schema, so the third omission fails instead of shipping (#3786)

A recursive Zod schema cannot infer its own type, so it carries a hand-written
`z.ZodType<...>` annotation. `z.ZodType` takes **two** type parameters,
`<Output, Input>`, and `Input` defaults to `unknown`. Naming only the first
compiles, validates correctly at runtime, and silently un-types every authoring
path through the schema — `unknown` accepts everything.

This package has made that mistake twice:

1. **#4171** replaced `z.ZodType<any>` on the nav union with
   `z.ZodType<NavigationItem>`, fixing the output half. `check-exported-any.ts`
   was built to hold that fix and reads output only, so it reported green over
   the half that was still broken.
2. **#4221** found the consequence — `defineApp`, the documented authoring entry
   point, compiled `navigation: [{ totally: 'made up' }, 42, 'nonsense']` clean —
   and **#4227** then named both parameters on the six remaining recursive
   schemas.

Both fixes are correct and both are currently unpinned. #4227 considered a
`.d.ts`-level scanner and declined it for a good reason: separating a deliberate
single-parameter `z.ZodType<T>` (the generic in `contracts/llm-adapter.ts` takes
a caller-supplied schema, where the input side is nobody's business) from an
omission needs heuristics on emitted type names, and `check-exported-any.ts`'s
own rule is zero false positives so red keeps meaning broken. Its commit
nominated #4221's assertion-file pattern instead. This is that pattern, applied
to the eight schemas #4221 did not cover: `QuerySchema`, `JoinNodeSchema`,
`FieldNodeSchema`, `FilterConditionSchema`, `NormalizedFilterSchema`,
`StateNodeSchema`, `ValidationRuleSchema`, `FormFieldSchema`.

`src/recursive-schema-input-assertions.ts` gives each one a positive probe (the
authoring shape still compiles — guarding an input type drawn too tight) and a
negative probe reached **through `z.input<typeof Schema>`**, the way a consumer
gets there. The negative is load-bearing: it is a value `unknown` would accept
and the real type rejects, so dropping a type parameter turns the suppression
unused and `tsc --noEmit` fails on that line, by name.

Verified by mutation in both shapes a regression can take:

- `QuerySchema` back to one parameter → the pin fires **and** `JoinNodeSchema`
  cascades a type error, because `JoinNodeInput.subquery` is `QueryInput`.
- `StateNodeSchema` back to one parameter → **only** the pin fires. Nothing else
  in the package references its input, so without this file that regression is
  completely silent. That is the case the file exists for.

No runtime change, no new public export (`check:api-surface` reports no diff);
the module is referenced by no tsup entry and re-exported by no barrel.

Also classifies `check:strictness-ledger` in `check-generated.ts`'s ledger. It
landed in #4232 without an entry, so `check:generated` was failing on `main`
itself — the same cross-PR race the `check:variant-docs` entry above it already
documents, now on its second occurrence.

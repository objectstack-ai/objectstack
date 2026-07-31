---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

fix(spec): the remaining six recursive schemas name both type parameters, and the authoring artifacts stop spelling out defaults (#4195)

#4221 fixed `NavigationItemSchema` — the worst instance, and the one with a
reproducible "`defineApp` compiles `navigation: [42, 'nonsense']`" demo. This
finishes the sweep: **six more schemas** had the same shape, and the authoring
artifacts that #4171 had to work around can now be typed honestly.

`z.ZodType` takes `<Output, Input>` and `Input` defaults to `unknown`, so naming
only the first parameter leaves `z.input` of anything embedding that schema at
`unknown`. Measured with a type probe:

| | was | now |
|---|---|---|
| `QueryInput['joins']` | `unknown[]` | `JoinNodeInput[]` |
| `QueryInput['fields']` | `unknown[]` | `FieldNode[]` |
| `z.input<typeof FormFieldSchema>` | `unknown` | `FormFieldInput` |
| `z.input<typeof QuerySchema>` | `unknown` | `QueryInput` |
| `z.input<typeof StateNodeSchema>` | `unknown` | `StateNodeConfig` |
| `z.input<typeof ValidationRuleSchema>` | `unknown` | `BaseValidationRuleShape` |

New exported types: `FormFieldInput`, `JoinNodeInput`, `NavigationContributionInput`.
`FilterCondition`, `NormalizedFilter` and `FieldNode` carry no `.default()` or
`.transform()`, so their input is their output and the second parameter is the
first.

**The `z.ZodType<T>` single-parameter form is now absent from the codebase.**

## 26 hand-written defaults deleted

This is the half #4221 left on the table. #4171 had to spell out
`expanded: false` (×16) and `target: '_self'` (×10) across `setup.app.ts`,
`studio.app.ts` and `setup-nav.contributions.ts`, because those artifacts are
annotated with the PARSED type where a `.default()`ed key is required — and
retyping them to the input surface would have traded eight loud errors for no
checking at all.

With `NavigationItemInput` landed (#4221) and `NavigationContributionInput`
added here, they are annotated `AppInput` / `NavigationContributionInput`, the
defaults are defaults again, and the literals are checked for the first time.
Net across those four files: 21 lines added, 54 removed.

Verified live, not nominal: a literal omitting `expanded`/`target` compiles, and
one writing `defaultOpen` — the non-spec key #4171 found in `account.app.ts` —
is a compile error whose suggestion list names `expanded`.

## Two typed with a documented caveat

`StateNodeSchema` and `ValidationRuleSchema` reuse their hand-written type for
both parameters: exact on the input side, loose on the output side.
`StateNodeConfig` marks `type` optional though `.default('atomic')` makes it
always present; `BaseValidationRuleShape` carries a `[key: string]: unknown`
index signature. Both were already that loose — input went from `unknown` (types
nothing) to a real type, output is untouched. Making them exact means deriving
those types from their schemas instead of maintaining them beside one, which is
separate work; the caveat is written at each declaration rather than left for a
reader to find.

## Why there is still no CI gate for this

Worth recording, since #4195 proposed one: extend `check:exported-any` to fail on
"output precise but input `unknown`". Measured after this change — exactly two
schemas match, `TranslationItemSchema` and `InlineActionSchema`, and **both are
correct**: they are `z.preprocess(...)`, where an `unknown` input is zod's
semantics rather than a missing annotation. Separating those from a genuinely
missing parameter needs heuristics on emitted type names, and per the rule in
that script's own header — zero false positives, so red keeps meaning broken — a
gate that cannot be made reliable is worse than none. #4221's
`app.nav-type-assertions.ts` is the better pattern where it applies: pin the
contract at compile level rather than infer intent from shape.

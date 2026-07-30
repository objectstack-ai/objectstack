---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

fix(spec): the authoring side of every recursive schema was `unknown`, so nothing checked what an author wrote (#4195)

#4171 fixed what a consumer **reads** from these schemas. This is the other
half: what an author **writes** into them.

Zod 4's `ZodType` is `ZodType<out Output = unknown, out Input = unknown>`, and
every recursive schema in the spec supplied only the first argument:

```ts
export const NavigationItemSchema: z.ZodType<NavigationItem> = z.lazy(() => …);
//                                            ^ Output only — Input stayed `unknown`
```

That `unknown` propagated to every schema embedding one. Measured before the
fix:

| | was | now |
|---|---|---|
| `AppInput['navigation']` | `unknown[]` | `NavigationItemInput[]` |
| `QueryInput['joins']` / `['fields']` | `unknown[]` | `JoinNodeInput[]` / `FieldNode[]` |
| `z.input<typeof FormFieldSchema>` | `unknown` | `FormFieldInput` |

So `defineApp` accepted **any array of anything** for `navigation` — the densest
hand-authored surface on the platform, and the one #4001 made `.strict()`
precisely because an author is most likely to write a key from memory there.
The strictness was real at parse time and absent at authoring time.

**Seven schemas now carry both type arguments.** Where input and output genuinely
differ, the input shape is derived the same way #4171 derived the output —
`z.input` of the non-recursive half, with the recursive knot tied by hand:

```ts
export type NavigationItemInput =
  | (z.input<typeof ObjectNavItemSchema> & { children?: NavigationItemInput[] })
  | …
  | (z.input<typeof GroupNavItemSchema> & { children: NavigationItemInput[] });
```

New exported types: `NavigationItemInput`, `NavigationContributionInput`,
`FormFieldInput`, `JoinNodeInput`. `FilterCondition`, `NormalizedFilter` and
`FieldNode` carry no `.default()` or `.transform()`, so their input is their
output and the second argument is simply the first.

**26 hand-written defaults deleted.** #4171 had to spell out `expanded: false`
(×16), `target: '_self'` (×10) in `setup.app.ts` / `studio.app.ts` /
`setup-nav.contributions.ts`, because those artifacts are annotated with the
PARSED type where a `.default()`ed key is required — and retyping them to the
input surface would have traded eight loud errors for no checking at all. With
the input types real, they are now annotated `AppInput` /
`NavigationContributionInput`, the defaults are back to being defaults, and the
literals are checked for the first time.

Verified the check is live, not nominal: an authoring literal that omits
`expanded` / `target` compiles, and one that writes `defaultOpen` — the
non-spec key #4171 found in `account.app.ts` — is now a **compile error** that
names `expanded` in its suggestion list. Previously that key was invisible until
parse.

Two schemas are typed with a deliberate caveat, documented at each declaration:
`StateNodeSchema` and `ValidationRuleSchema` reuse their hand-written type for
both arguments. That is exact on the input side and loose on the output side —
`StateNodeConfig` marks `type` optional though `.default('atomic')` makes it
always present, and `BaseValidationRuleShape` carries a `[key: string]: unknown`
index signature. Both were already that loose before this change; making them
exact means deriving those types from their schemas instead of maintaining them
beside one, which is separate work.

Two remain `unknown` on the input side and correctly so: `TranslationItemSchema`
and `InlineActionSchema` are `z.preprocess(...)`, where an `unknown` input is
zod's semantics rather than a missing annotation. That is also why this did not
land as a CI gate — "output precise but input `unknown`" cannot be separated
from legitimate `preprocess` mechanically, and a gate with false positives is
worse than none.

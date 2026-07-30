---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
"@objectstack/metadata-protocol": patch
"@objectstack/driver-mongodb": patch
---

fix(spec): five exported symbols resolved to `any` — type the recursive schemas and gate it in CI (#4171)

A recursive Zod schema needs an explicit annotation to break its circular
inference, and five of them took the cheapest one available:

```ts
export const NavigationItemSchema: z.ZodType<any> = z.lazy(() => …);
export type NavigationItem = z.infer<typeof NavigationItemSchema>;   // → any
```

It compiles, it validates correctly at runtime, and it silently throws the type
away. `NavigationItem`, `FormField`, `JoinNode` and `NormalizedFilter` were all
`any` on the published surface, plus `FieldNodeSchema` — which had no exported
type alias yet, so `z.infer<typeof FieldNodeSchema>` was `any` and
`QueryAST['fields']` with it.

That is worse than a missing export. #4115 tells every consumer that a local
declaration under a spec export's name must be replaced by a binding to the
spec — and for these, obeying it **replaced a precise type with `any`**.
objectui's `NavigationItem` is a 118-line documented interface (`recordId`
template variables, `requiresObject` / `requiresService` capability gates,
`filters` precedence); every key of it exists in the spec's version, so by every
available signal it read as a redundant fork safe to delete. Deleting it swapped
a fully-typed interface for `any`, with no compile error anywhere to say so.

It is hard to catch by inspection because `any` is mutually assignable with
everything, so the natural "are these the same type?" check answers *yes* in both
directions and recommends precisely the wrong action. Same failure family as
#4075's `[key: string]: any` on `ActionDef`: a type that agrees with everything
reads as agreement.

**Now annotated with the real type**, using the pattern `QueryAST` already
follows in `data/query.zod.ts` — infer the non-recursive part, tie the recursive
knot in the type, so the keys stay derived from the schema instead of being
hand-maintained beside it:

```ts
const BaseXSchema = z.object({ …every non-recursive key });
export type X = z.infer<typeof BaseXSchema> & { children?: X[] };
export const XSchema: z.ZodType<X> = z.lazy(() => BaseXSchema.extend({
  children: z.array(XSchema).optional(),
}));
```

`z.infer` now resolves to the type it should always have been: `NavigationItem`
is the nine-branch discriminated union, `FormField` the 30-key form-field
contract (with `visibleOn` absent by construction — ADR-0089 D2 folds it into
`visibleWhen` at the boundary), `JoinNode` and the newly exported `FieldNode`
the query AST nodes, `NormalizedFilter` the normalized filter AST. Runtime
validation is unchanged: every schema parses exactly what it parsed before.

**What the types immediately caught**, none of it visible while they were `any`:

- `account.app.ts` set `defaultOpen` on three nav groups — a key the spec has
  never declared. It worked only because objectui's `NavigationRenderer` still
  falls back to that legacy alias. Fixed at the producer per Prime Directive
  #12: the canonical key is `expanded`.
- The MongoDB driver built its projection with `projection[field] = 1` over
  `query.fields`, so a relationship `FieldNode` would have keyed the projection
  on `"[object Object]"`. It now reads the node's field name.
- `setup.app.ts`, `studio.app.ts` and `setup-nav.contributions.ts` are annotated
  with the PARSED `App` / `NavigationContribution` types but omitted
  `.default()`ed keys (`expanded`, `target`), as did the form fields
  `metadata-protocol` synthesizes for `getUiView` (`span`). Each now states the
  default it was relying on, matching what the surrounding literals already do
  for `active` / `isDefault` / `collapsible` / `collapsed` / `columns`.

**Gated, not just fixed** (`check:exported-any`, wired into the required
`TypeScript Type Check` job). `api-surface.json` records that an export *exists*
and never what it *resolves to*, which is how these survived a whole major with
every gate green. The new scan reads the built `.d.ts` a consumer's import
actually resolves to and fails on any exported type that resolves to `any` — or
any exported schema whose output is `any`, the root cause, and the only reason
`FieldNodeSchema` was visible at all. Its `KNOWN_ANY` ledger is shrink-only and
currently empty. It self-tests against the real zod first, so if the internals it
reads are ever renamed the gate fails loudly instead of quietly passing
everything forever.

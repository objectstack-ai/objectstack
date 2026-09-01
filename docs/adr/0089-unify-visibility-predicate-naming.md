# ADR-0089: Unify the conditional-visibility predicate under one name (`visibleWhen`), alias the rest

**Status**: Accepted (2026-07-14) — D1 + D2 + codemod + docs implemented in #2642/#2900; renderer reads in objectui#2490 (#2904); D3b lint rule in #2900 + bidirectional binding-root follow-up (#2903). **D3a (`.strict()` flip) implemented (#2902)** — the monorepo + examples sweep found a single offender (a test fixture), and the strict flip ships as a major (`@objectstack/spec` 15.0.0).
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — a declared-but-unchecked visibility key is exactly this class), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently-inert metadata — a mis-layered visibility key that zod strips is inert by accident), [ADR-0085](./0085-object-semantic-roles-over-surface-hint-blocks.md) (the enforce-or-remove pass that already deleted a consumer-less `visibleOn` from `fieldGroups`), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (the AI-authoring population this ADR optimizes for), [ADR-0058](./0058-expression-and-predicate-surface.md) (the CEL predicate surface these keys all belong to), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (conversion-over-notification; this rename ships as an L1 invisible break via the alias mechanism)
**Consumers**: `@objectstack/spec` (the field / view / page zod schemas + the alias normalization), `@objectstack/objectql` (`rule-validator` — the server-side enforcer), `@objectstack/lint` (the new mis-layer / wrong-root rule), ObjectUI form + page renderers, and every AI author of `*.object.ts` / `*.view.ts` / `*.page.ts`
**Surfaced by**: the same-concept-many-names spread across the spec — a data field gates on `visibleWhen`, a view form field/section on `visibleOn`, a page component on `visibility` — combined with zod's default `.strip()` making a mis-layered key vanish silently rather than erroring. Directly parallels the resolved `conditionalRequired → requiredWhen` consolidation already in `field.zod.ts`.

---

## TL;DR

One concept — *"show this only when the CEL predicate is TRUE"* — is spelled three
different ways depending on which layer you are in:

| Layer | Key today | Location |
|---|---|---|
| Data field / field option | `visibleWhen` | `packages/spec/src/data/field.zod.ts#visibleWhen` |
| View form section / field | `visibleOn` | `packages/spec/src/ui/view.zod.ts#visibleOn` |
| Page component | `visibility` | `packages/spec/src/ui/page.zod.ts#visibility` |

Because every one is `.optional()` and the schemas run zod's default **strip** mode, a
key placed on the wrong layer — `visibleOn` on a data field, `visibleWhen` on a form
field — is **silently dropped**: no type error, no validation error, the element just
renders unconditionally forever. For an AI author that is the worst failure mode there
is: no signal to self-correct from.

**Decision:** make **`visibleWhen`** the single canonical name across all three layers;
keep `visibleOn` and `visibility` as `@deprecated` aliases normalized to `visibleWhen`
at parse time; add `.strict()` + a lint rule so a mis-layered or mis-rooted key becomes
a **loud** error instead of a silent no-op. The boolean `visible` (Tab on/off) is a
different type and concept and is explicitly **out of scope**.

This is not a new pattern — it is the exact move already made for
`conditionalRequired → requiredWhen` (`packages/spec/src/data/field.zod.ts#requiredWhen`), applied to visibility.

## Context

### The `*When` family already exists — and `visibleWhen` is in it

`packages/spec/src/data/field.zod.ts` defines a coherent conditional-rule triad on data fields:

```ts
visibleWhen:  ExpressionInputSchema.optional(),  // shown when TRUE
readonlyWhen: ExpressionInputSchema.optional(),  // read-only when TRUE
requiredWhen: ExpressionInputSchema.optional(),  // required when TRUE
```

These three are enforced together on the server by objectql's `rule-validator`
(`packages/objectql/src/validation/rule-validator.ts`). `visibleWhen` is not a
standalone choice — it is one leg of a three-legged family that shares a suffix, a
binding environment (`record` + `current_user`), and an enforcement path.

### The precedent: `conditionalRequired → requiredWhen` is already resolved this way

The repo has already run this exact consolidation once. `requiredWhen` is the canonical
name; `conditionalRequired` is retained as a `@deprecated` alias
(`packages/spec/src/data/field.zod.ts#requiredWhen`), and the enforcer resolves the pair with a coalesce:

```ts
// packages/objectql/src/validation/rule-validator.ts#requiredWhen
const pred = def?.requiredWhen ?? def?.conditionalRequired;
```

The established direction of consolidation is **toward `*When`**, with the old name kept
as a back-compat alias. This ADR follows that precedent rather than inventing a new one.

### Why the spread is specifically hostile to AI authoring

Three compounding traps:

1. **Same concept, name switches by layer.** `visibleWhen` (data) vs `visibleOn` (view)
   vs `visibility` (page). The docs already need a disambiguation paragraph
   (`objectui:content/docs/protocol/objectui/layout-dsl.mdx`) — a sign the surface, not
   the reader, is the problem.

2. **`visibleOn` has two binding roots.** In runtime forms it binds the live record
   (`visibleOn: "record.status != 'closed'"`); in the *metadata-editing* forms
   (`object.form.ts`, `field.form.ts`, `page.form.ts`) it binds the row under edit
   (`visibleOn: "data.type == 'grid'"`). Same key, different root by context.

3. **Failure is silent.** The field/view/page schemas use zod's default strip mode
   (only two `.passthrough()` sites exist in `view.zod.ts`, none relevant here), so a
   mis-layered key is discarded with no diagnostic. ADR-0085 already deleted one
   consumer-less `visibleOn` from `fieldGroups` under the enforce-or-remove rule
   (`packages/spec/src/data/object.zod.ts#visibleOn`); this ADR closes the general case.

### Why unify to `visibleWhen` and not `visibleOn`

Choosing `visibleOn` as the canonical name would strand it next to `readonlyWhen` /
`requiredWhen`, producing a broken triad (`visibleOn` + `readonlyWhen` + `requiredWhen`).
To restore symmetry you would then have to rename `readonlyWhen`/`requiredWhen` to
`*On` — a larger blast radius, against the just-established `*When` precedent, and
touching the server enforcer. Unifying to `visibleWhen` keeps the data-layer family
anchor **unchanged** and moves only the view/page spellings. Rough migration weight also
favors it: `visibleWhen` ~9 source files, `visibleOn` ~13, page `visibility` ~34.

## Decision

**D1 — `visibleWhen` is the single canonical conditional-visibility key.**
It is accepted on data fields, field options, view form sections/fields, and page
components. Its value is a CEL predicate (`ExpressionInputSchema`); the element is shown
only when the predicate is TRUE. The binding *root* remains determined by the layer
(runtime record surfaces bind `record` + `current_user`; metadata-editing forms bind
`data`) — this ADR unifies the *name*, not the environment, and the environment is
documented per layer.

**D2 — `visibleOn` and `visibility` become `@deprecated` aliases, normalized at parse.**
Both keys stay accepted by the schemas for back-compat and are normalized to
`visibleWhen` during `parse()` (a zod `.transform()` that folds `visibleOn ?? visibility`
into `visibleWhen` when the canonical key is absent). Normalizing **once at the schema
boundary** is preferred over the consumer-side `??` coalesce used for
`conditionalRequired`, so no renderer or validator re-implements the fallback — but the
consumer-side resolution stays valid as a defense-in-depth read. Emitting canonical
`visibleWhen` on build is covered by ADR-0087's conversion layer (this is an L1
invisible break: zero consumer action required).

**D3 — mis-layered / mis-rooted keys become loud errors.**
Two enforcement additions, per ADR-0049 (enforce-or-remove) and ADR-0078 (nothing
silently inert):
  - Tighten the relevant object schemas so an unknown/mis-layered visibility key
    (e.g. a raw `visibleOn` surviving after the deprecation window, or a `visibleWhen`
    on a schema that has no visibility semantics) is a `.strict()` parse error rather
    than a silent strip.
  - Add a `@objectstack/lint` rule that flags (a) a deprecated alias in freshly authored
    source (autofix → `visibleWhen`), and (b) a predicate whose binding root does not
    match its layer (`data.` in a runtime form predicate, or `record.` in a metadata
    form predicate).

**D4 — the boolean `visible` is out of scope.**
`packages/spec/src/ui/view.zod.ts` `visible: z.boolean()` (Tab on/off) is a static flag, not a predicate.
Folding it into `visibleWhen` would create a new type ambiguity (boolean vs expression).
It keeps its name and type. `hidden` (field boolean) and `visibleFields` (gallery card
array) are likewise unrelated and untouched.

## Consequences

**Positive**
- One name to learn, aligned with the existing `readonlyWhen`/`requiredWhen` family and
  the `conditionalRequired → requiredWhen` precedent — less to get wrong, for AI and
  humans alike.
- The dominant failure mode flips from **silent drop** to **loud error** (D3), giving an
  AI author the correction signal it currently lacks.
- Zero breaking change on rollout: existing `visibleOn` / `visibility` metadata keeps
  working through the alias (D2), consistent with ADR-0087's conversion contract.

**Negative / cost**
- Touch cost across ~13 `visibleOn` + ~34 `visibility` source sites (mechanical codemod)
  plus renderer reads, the deprecation registry entry, and docs.
- A deprecation window during which two spellings coexist — the same transient state
  `conditionalRequired`/`requiredWhen` already lives in; acceptable and precedented.
- `.strict()` tightening risks surfacing pre-existing mis-layered keys elsewhere; these
  are latent bugs today (silently inert) and surfacing them is the point, but the rollout
  must sweep the monorepo + example apps before flipping strict on.

## Alternatives considered

1. **Unify to `visibleOn`** — rejected: breaks the `*When` triad and inverts the
   established consolidation direction (see Context).
2. **Do nothing / document harder** — rejected: the disambiguation paragraph already
   exists and the trap persists; ADR-0049/0078 argue against leaving a silent-strip
   footgun in place.
3. **Add lint only, keep three names** — rejected as a half-measure: lint reduces the
   error rate but the three-name surface remains the root cause; the alias makes
   unification free, so there is no reason to stop at lint.
4. **Fold boolean `visible` in too** — rejected: type ambiguity (D4).

## Migration

1. Add `visibleWhen` to the view (section + field) and page component schemas; mark
   `visibleOn` / `visibility` `@deprecated`; add the parse-time normalization (D2).
2. Register the rename in the deprecation / `spec-changes.json` registry per ADR-0087 so
   downstream conversion + `migrate meta` pick it up.
3. Codemod first-party sources (`packages/`, `examples/`) `visibleOn`/`visibility` →
   `visibleWhen`; update `content/docs/**` and the `objectstack-ui` / `objectstack-data`
   skills, including the layer→binding-root table.
4. Land the lint rule (D3b) with autofix; sweep the repo; then flip `.strict()` (D3a).
5. Keep the aliases for the standard deprecation window, then remove in a future major.

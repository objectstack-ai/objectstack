---
"@objectstack/spec": patch
---

fix(spec): `object.form.ts` repeater predicates bind through `data`, like every other metadata form (#6254)

The object metadata form's field-list repeater carried 16 `visibleWhen`
predicates written as **bare identifiers**:

- FROM: `visibleWhen: "type == 'formula'"`, `visibleWhen: "type in ['lookup','master_detail']"`, …
- TO: `visibleWhen: "data.type == 'formula'"`, `visibleWhen: "data.type in ['lookup','master_detail']"`, …

Metadata-editing forms (`*.form.ts`) bind the row under edit as `data` — which
is how the sibling `field.form.ts` has always written them (`data.type == 'text'`).
The bare spelling has no binding at all: `type` is an unbound identifier, the
predicate faults, and a faulted visibility predicate resolves to its fallback,
`true`. Every constrained sub-field — `maxLength`, `min`/`max`, `precision`,
`expression`, `returnType`, `reference`, `deleteBehavior`, `autonumberFormat`,
… — was therefore offered on **every** field row regardless of its type, which
is the exact opposite of what each rule asks for.

**The repeater does rebind `data`, and that is worth writing down.** A sub-field
of a `type: 'record'` repeater is evaluated against its own row
(`evaluatePredicate(spec.visibleOn, { data: row })` in the metadata form
renderer), so `data.type` reads *this row's* type — precisely what a per-entry
rule wants. What the repeater does **not** do is introduce an implicit row
scope: the root is spelled `data` at every depth. `FormField.visibleWhen`'s
JSDoc and `describe` now state both halves, so the next author does not have to
infer either one.

`field.form.ts` is unchanged — it was already correct.

Authoring-surface fix with no schema or validation change, hence patch. Note
that these predicates are not yet *observably* restored: a separate defect
outside this package (the metadata form renderer reads the deprecated
`visibleOn` key, while the parse emits only the canonical `visibleWhen`) keeps
every metadata-form predicate inert today. That is tracked separately; this
change is a prerequisite for it, and correct on its own terms either way.

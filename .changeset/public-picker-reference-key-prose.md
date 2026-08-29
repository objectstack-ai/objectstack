---
"@objectstack/spec": patch
---

fix(spec): `FormFieldPublicPickerSchema.object` now names `reference` — the key `FieldSchema` actually accepts — instead of the rejected `referenceTo` alias (#13138)

Both sentences on the `object` key told authors the picker target resolves from
`referenceTo` on the parent object's field definition. `referenceTo` is not a
key `FieldSchema` accepts: it is a **rejected alias**, listed in the field
schema's alias map only so `strictUnknownKeyError` can offer a rename hint when
a parse fails on it. An author who followed the sentence and wrote `referenceTo`
on the parent object's field got their whole object metadata refused at parse —
a failure, not a degraded render.

Measured against the built `packages/spec/dist/data/index.mjs` with a three-level
control (a two-level one cannot separate "rejected" from "not measured"):

- `reference: 'sys_user'` (positive control) parses, `parsed.reference` is `'sys_user'`
- `zzz_not_a_key` (negative control) is refused `unrecognized_keys`, with no rename hint
- `referenceTo` is refused `unrecognized_keys`, **with** the hint ``Did you mean `referenceTo` → `reference`?``

The `.describe()` half is the load-bearing one: it is published, flowing into the
generated JSON Schema and `content/docs/references/ui/view.mdx`, so the wrong key
name reached authors who never open this file — and AI authors reading the
generated schema as ground truth. The reference docs are regenerated with the
repo's own `gen:docs` in the same change.

Prose only: no schema shape, no accept/reject movement, no new or removed keys —
every previously-valid input still parses byte-identically. This takes no
position on whether the REST route's legacy-spelling fallback chain survives:
the sentence was wrong under either outcome, because a conformant authored field
carries `reference` in both worlds, and the route already reads `reference` first.

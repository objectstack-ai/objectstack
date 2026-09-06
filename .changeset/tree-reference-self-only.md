---
"@objectstack/spec": minor
---

feat(spec)!: a `tree` field's `reference`, when present, must name the declaring object — any other target is refused at parse (#14892)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-typed: `reference` keeps its name, its type and its optionality on a `tree` field, and every self-referencing or reference-less `tree` parses byte-identically to before. What is newly refused is a `tree` whose `reference` names a different object — a shape no prose surface ever documented, that no runtime reader consumed as a cross-object link, and whose one in-repo author (the showcase field zoo) hedged in its own label. The remedy is authoring intent, not a mechanical rewrite: the author decides whether the field is this object's own hierarchy (a self-reference, or no `reference` at all) or a link to another object (a `lookup`), so `objectstack migrate meta` has nothing to rewrite and this changeset carries no rewrite instructions. -->

**BREAKING** in the accept-set sense, landing in the launch window as `minor`
(the lockstep convention). Maintainer ruling 2026-09-05 on #14892, option A.

**What changes.** `ObjectSchema` (and `ObjectExtensionSchema`, judged against
the object it extends) now refuses a field declared `type: 'tree'` whose
`reference` names any object other than the declaring one. The refusal is a
located parse issue at `fields.<field>.reference` whose message names both
objects and the three ways out: drop `reference` (it is optional on a `tree`),
name the object itself, or declare a `lookup` if a link to a different object
was meant. `FieldSchema` alone is unchanged — a field does not know which
object declares it, so the judgment lives on the object door.

**Why.** A hierarchy is parent/child within one object, and that is what every
reader of the type already assumed: the tree renderer's parent-pointer
auto-detection takes the first `tree` field as the object's own parent column,
four prose surfaces said self-reference, and `deleteBehavior` materialises on
`tree` beside `lookup` because a self-referential hierarchy is a relation whose
cascade is exactly the intended semantics. The designer's shared `reference`
input reused one "Target object name" help text for three types, and the one
shipped `tree` example pointed at another object under a hedging label — two
spellings parsed silently, and an example taught a third. The key is now
enforced with one meaning; `reference` stays optional on a `tree` as a
redundant self-annotation, which is also what makes a reference-less `tree`
being classified `relation` (and materialising `deleteBehavior`) coherent.

**Alongside.** `checkViewCompleteness`'s parent-pointer predicate reads the
same rule: a `tree` field is a detectable parent pointer only when its
`reference` is absent or the object's own name, so a `tree` view bound to an
object whose only `tree` field points elsewhere is reported `view/tree-without-
parent-field` rather than blessed. The designer help text for the shared
`reference` row now says so for `tree`, the showcase `showcase_field_zoo.f_tree`
is a self-reference, and the data-modeling docs say "optional and, if given,
must be this object".

```ts
// accepted — a self-reference, or no reference at all
parent: { type: 'tree', reference: 'category' }
parent: { type: 'tree' }
// refused at parse — `fields.parent.reference` on object `category`
parent: { type: 'tree', reference: 'department' }
```

**Not measured.** Out-of-repo cross-object trees are NOT MEASURED: no customer
application was surveyed for a `tree` field pointing at a different object.
In-repo, every other `tree` author is a self-reference or carries no
`reference`; the objectui pin's unit fixtures are outside this schema's reach
and are listed on the card.

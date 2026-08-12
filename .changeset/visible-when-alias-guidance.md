---
"@objectstack/spec": patch
---

docs(spec): alias guidance for `visible` / `showWhen` / `disabled` on the `visibleWhen` shapes (#7832)

`ui/action.zod.ts` has carried this table in the OTHER direction since #3746: on
an action, `visible` and `disabled` are the canonical keys, so the aliases run
`visibleWhen → visible`, `showWhen → visible`, `disabledWhen → disabled`. The
reverse direction — an author who learned the action vocabulary writing it on a
shape whose canonical key is `visibleWhen` — was curated on some surfaces and
bare on others, and nothing recorded which was which.

**Nothing changes about what parses.** Every key named here was rejected before
and is rejected after; only the message differs. `RowCrudActionOverrideSchema`
moves from a hand-written `.strict()` to the shared `strictObject` helper, which
is `z.object(shape, { error }).strict()` — the same door, now with a curated
error map behind it.

What each surface says now:

- **`userActions.edit` / `.delete` overrides** (`RowCrudActionOverrideSchema`)
  produced zod's own bare `Unrecognized key: "visible"` — the surface unnamed
  and no key to write instead. It now names the surface, renames `showWhen` onto
  `visibleWhen`, and answers `visible` / `disabled` in prose naming BOTH landing
  keys: `enabled: false` for the object-level switch, `visibleWhen` /
  `disabledWhen` for the per-record predicate. Prose rather than a rename
  because this shape splits into a boolean and a predicate what a custom row
  action spells with one key, so a rename would have to guess which the author
  meant.
- **Fields** rename `showWhen` onto `visibleWhen`, and answer `visible` in prose
  naming both `hidden` and `visibleWhen` — including the inversion, since
  `visible: false` is `hidden: true` and a rename would have the author ship the
  opposite of what they wrote. `disabled → readonly` was already correct here: a
  field has `readonlyWhen`, not `disabledWhen`.
- **Form fields** rename `disabled` onto `readonly`, the one shape in the
  view/page family that declares a key for it.

Three surfaces already answered `visible` / `showWhen` and gained no row: select
options rename both onto `visibleWhen`, and form sections and page components
answer them through the shared ADR-0089 conditional-visibility prescription.
Select options, form sections and page components declare no disabled-ish key at
all, so `disabled` there stays a bare rejection rather than being pointed at a
key the shape would reject next — pinned so a later sweep can tell a deliberate
gap from a missed one.

Choosing ONE canonical spelling across the two vocabularies remains open
(#7816); if that ruling ever converges them, these rows become the migration
hint.

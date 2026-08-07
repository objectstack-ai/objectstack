---
"@objectstack/lint": patch
---

fix(lint): `validateFormLayout` walks the view CONTAINER ladder, so both its rules stop reporting clean on every real app (#6251)

`form-field-unknown` and `absolute-colspan-discouraged` read a `sections` array
off the **`views[]` entry itself** and skipped everything else. But a `views[]`
entry is a view CONTAINER, not a view: `ViewSchema` declares exactly `name` /
`label` / `object` / `list` / `form` / `listViews` / `formViews`, and form
sections live one level down, under `form` and each `formViews.<key>`. So the
one shape the traversal read is the one shape strict `ViewSchema` **refuses** —
measured, `unrecognized_keys` naming `sections` — and the shapes every app
actually ships were never inspected at all.

Measured on the three shipped example apps, before and after: `app-showcase`,
`app-crm` and `app-todo` carry **0** form sites at the entry root and **14**
under `form` / `formViews.<key>`. The old traversal therefore had nothing to
read on any of them, and reported clean for that reason — the "ghost check"
shape (#4984 / #5009): a rule that is green because it never read anything is
worse than no rule, because it occupies the slot that would otherwise look
empty.

One broken form, three placements, before → after:

| placement | before | after |
| --- | --- | --- |
| `views[0].sections` (entry IS a bare form view) | reports | reports |
| `views[0].form.sections` (container default form) | silent | reports |
| `views[0].formViews.edit.sections` (named form view) | silent | reports |

What changed, precisely:

- The traversal is the one `validate-visibility-predicates.ts` landed in #6248
  for the identical hole on the sibling rule — copied, not re-derived, so two
  rules on one surface cannot drift apart about which forms exist. `list` /
  `listViews.<key>` are `ObjectListViewSchema` and carry no `sections`, so they
  are deliberately not walked; `objects[].views` stays out because
  `object.zod.ts` tombstones that key by name.
- The legacy `groups` bucket (`FormSectionSchema[]`, the documented alias of
  `sections`) is read too. Measured: it is **not** folded into `sections` at
  parse, so a `groups`-authored form was a second silent shape.
- A finding names its sub-container — `view "contact_views" · formViews.create`
  — because an artifact-emitted container carries neither `name` nor `object`,
  and without it two forms under one view were indistinguishable.
- A sub-container inherits the container's object binding when it declares no
  `data.object` of its own, resolved through the same `objectName` → `object` →
  `data.object` ladder the other view-walking rules in this package use.
- A map-shaped `views` reports at the key it sits at (`views.contact_views.…`)
  rather than a synthetic index, so a finding stays usable as an edit target.

Both rules remain advisory `warning`s and their messages, hints and severities
are unchanged. No new finding appeared on any example app, so nothing that was
green goes red on existing metadata — what changes is that a form defect in the
places apps actually put forms is now reported instead of silently passed.

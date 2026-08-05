---
"@objectstack/lint": patch
---

fix(lint): `translation-target-unknown` reads a view container's DEFAULT `form.sections` (#5415)

`validate-translation-references` derives the `_sections` names an object may
legally be translated by from a list of anchors: `fieldGroups[].key`, the named
sections on `listViews.*` / `formViews.*`, the named sections on a page's
`record:details` component, and the view record's own `sections`. The list was
missing one: the view CONTAINER's **default form** — the `form` that
`defineView({ list, form, formViews })` declares and that `ObjectForm` renders
when no named form view is asked for.

`collectViewRecord` iterated `['listViews', 'formViews']`, and `view.form` is
neither of those nor the record's own `sections`, so `view.form.sections[].name`
contributed **nothing** to the fact set. The renderer resolves those headings
through exactly the same `sectionLabel(object, section.name, …)` convention as
any named form view, so a bundle that correctly translated one of them was
reported as keyed to a section "which nothing on object X declares", with a hint
advising the author to delete a translation that renders. On the in-repo
showcase contact surface — whose object declares `field.group` and no
`fieldGroups[]`, so the default form is its **only** section anchor — all four
headings were in that state, and the hint went as far as "declares no named
section at all".

The default form now feeds the same section collector as `formViews.*`, bound
by `bindingOf(view.form) ?? listBinding` — i.e. `form.data.object` first, then
the record-level object, then the list beside it — which is the resolution the
CLI i18n walker performs for the same surface, so the rule that DEMANDS a key
and the rule that ACCEPTS one agree on which object a heading belongs to. Each
anchor is now a call into one collector rather than its own copy of the loop.

Nothing tightens: an unnamed section is still untranslatable (it has no stable
key to look up), and a `_sections` key no anchor declares is still reported —
now with the real anchors enumerated in the hint.

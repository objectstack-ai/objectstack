---
'@objectstack/lint': patch
---

lint: warn when a form section declares a `label` but no `name` — the heading no translation key can ever address

`_sections` is keyed by the section's `name`, and every renderer that draws a
section heading resolves it that way (`sectionLabel(objectName, section.name,
authored)` — `plugin-form`'s `ObjectForm`/`ModalForm`, `plugin-detail`'s
`record:details`), falling back to the authored label when there is no name.
So a section authored with a `label` and no `name` is untranslatable **by
construction**, and every gate we own was structurally blind to it:

- the reference validator reports keys a bundle carries that nothing declares —
  a nameless section produces no key, so there is no orphan to report;
- the i18n coverage walk (#5405) emits one expected key per `sections[].name` —
  a section with no name contributes nothing to demand, so the report reads
  100% while the heading renders in the source locale in every locale.

Measured on HotCRM: **70 of 70** form-view sections across all 14 view files are
in exactly that state, with four locales at full declared coverage and zero
warnings anywhere. It is also the real cause of the reported `Case / SLA /
Resolution` English strip — that object's *detail page* sections carry names and
translate, while its *form view* sections carry none.

`validateTranslatableSections` (rule id `translation-section-name-missing`) joins
the reference-integrity suite, so it runs on `os validate`, `os lint` and
`os compile` at once. It reads exactly the anchors the two landed halves already
agree on: a view container's `sections`, its **default** `form.sections`, every
`listViews.*` / `formViews.*` sub-container, the same three on views embedded in
an object, and `record:details` sections nested anywhere in a page's component
tree. `fieldGroups`-derived sections are out of range by construction — their
heading is keyed by `fieldGroups[].key`, so they always have a name.

**Warning, and opt-in.** Nothing crashes and nothing is dead — one heading stays
in the source locale — so the severity matches its sibling rules (ADR-0072 D1)
and nothing that passed before starts failing. `os validate` over
`examples/app-showcase` now reports 14 of these (6 from form views, 8 from
`record:details` pages) and still exits 0. A section warns only when the
object it renders under carries some translation of its own, which keeps the
monolingual case silent exactly as the coverage gate already does.

The fix is a diagnostic at the **producer**, deliberately not tolerance at the
consumer: deriving a lookup key by slugifying the label would fossilize a second
de-facto contract next to the declared one, and would move the day anyone edits
the heading text. The `name` the hint suggests is a suggestion for the author to
write down, never a key anything resolves.

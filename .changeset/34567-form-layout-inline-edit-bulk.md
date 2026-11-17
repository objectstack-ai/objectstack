---
'@objectstack/skills': patch
'@objectstack/lint': patch
---

docs(skills): `objectstack-ui` keeps a long form `simple`, and both skills name the `bulk` an `inlineEdit` save needs; `os lint`, `os validate` and `os build` warn when it is withheld

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ui/SKILL.md` § Form Views no longer caps `simple` at 15 fields or sends objects with many field groups to `tabbed`. `simple` (stacked sections on one scrolling page) is the default at any field count. `tabbed` is for sections read apart, and the row names its cost: a required field missed on another tab is flagged only on its tab, and the tab strip overflows on a phone. A new paragraph says how a long form stays `simple`: `collapse: 'collapsed'` on the object's `fieldGroups` entry or `collapsed: true` on a form section, `columns` as a per-row ceiling (unset, a section draws two), and `modalSize` for the New / Edit dialog (unset, `lg` or `xl` by field count). One eval case asks for a 42-field form and fails an answer with `type: 'tabbed'`.

The parent's form saves an `inlineEdit` child's rows with the parent in one `/api/v1/batch`, and that route asks every object in it for `bulk`. Master-Detail Forms in `objectstack-ui` and § Inline Editing in `objectstack-data` `rules/relationships.md` now say so: a parent or child that declares `enable.apiMethods` must list `'bulk'`, or the save is refused `405 OBJECT_API_METHOD_NOT_ALLOWED`. An undeclared `apiMethods` allows it.

A new authoring rule, `relationship/inline-edit-needs-bulk` (`lintInlineEditBulk`, exported with its id constant `RELATIONSHIP_INLINE_EDIT_NEEDS_BULK`), warns on an `inlineEdit` relationship (`true`, `'grid'` or `'form'`) whose parent or child declares `enable.apiMethods` without `'bulk'`: once per object, at that object's `enable.apiMethods`, with a fix line naming the value to add. It is registered for all three commands, so `os lint`, `os validate` and `os build` (and `objectstack dev`) report it. It is advisory and never fails a build. `references/lint-rules.md` lists it.

The skill files pay for most of this by cutting text stated elsewhere, and the `objectstack-ui/SKILL.md` token ceiling moves by the measured remainder.

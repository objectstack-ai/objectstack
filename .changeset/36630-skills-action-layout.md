---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui teaches the object's `actionLayout`

Clause-②: no
Metadata-protocol: none

`rules/actions.md` gains one section, "Button Order (`actionLayout`)": an arm per scope (`list`, `record`), `pinned` (at most 3 buttons, in drawn order, `[]` pins none) and `more` (the order of the overflow menu, unnamed actions after it), which placements each arm takes and where the `record` arm is drawn (record page, side preview, phone action bar, a row's menu order), the list page's `$import` / `$export` as pinned-only built-ins, what is refused (a fourth pin, a name given twice, and by `os validate` a name that is no action of the object or is not placed in the arm's scope), and that on an installed object only its paired `.custom` package's extension writes the key, arm by arm. Text only; one eval case exercises it.

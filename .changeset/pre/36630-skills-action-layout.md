---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui teaches the object's `actionLayout`

Clause-②: no
Metadata-protocol: none

`rules/actions.md` gains one section, "Button Order (`actionLayout`)": an arm per scope (`list`, `record`), `pinned` (at most 3 buttons, in order, `[]` pins none) and `more` (the order of the overflow menu, unnamed actions after it), which placements each arm takes and where the `record` arm is drawn (record page, side preview, phone bar, a row's menu order), the list page's `$import` / `$export` as pinned-only built-ins, that `os validate` refuses a name the arm's scope does not place, and that on an installed object only its paired `.custom` package's extension writes the key, arm by arm. Text only; one eval case exercises it.

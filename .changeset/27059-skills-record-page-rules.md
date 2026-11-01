---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui teaches the record page as the Console ships it, in one ordered rules file from the object's declarations to the reader's own choices

Clause-②: no
Metadata-protocol: none

- **Before.** `SKILL.md` described a record page with Details / Related / Timeline tabs and a shared Related tab for side cards, `rules/pages.md` and `rules/navigation.md` each carried a sentence of it, nothing taught `relatedListFilter`, the inherited row order, the six slots, `isDefault` or which record-page choices are the reader's, and an agent asked to "put the tasks first on the lead page" reached for a full page.
- **Now.** `rules/record-page.md` says, in order: the object's declarations (`nameField`, `highlightFields`, `stageField`, `fieldGroups`, `relatedLists`, `editMode`) produce the page and the surface's width lays it out (two columns from 760 px, three field columns from 1120 px, a tab row that enlarges one panel); the relationship flags shape the related column (`relatedList`, `relatedListTitle`, `relatedListColumns`, `relatedListFilter`, rows in the child's default list-view sort); a `slotted` page overrides one of six slots and has no `tabs` slot; `kind: 'full'` is the escape hatch; a record opens in the drawer unless the object's list view declares `navigation: { mode: 'page' }` (`modal` / `split` / `popover` are refused); and the reader's Open-records choice, ⊟ right column, panel order and pane width are never metadata. `SKILL.md`, `rules/pages.md` and `rules/navigation.md` keep one pointer each, and `evals/record-page.json` grades the lead-page task as `relatedList: 'primary'` and the full-page ask as the list view's declaration.
- The package's hand-authored markdown grows by 39 lines against a budget of 40, paid with the tab sentences the record-page retirements made false; the docs' "How a list opens a record" names the live modes and the reader's choices. No schema, key or behaviour changes.

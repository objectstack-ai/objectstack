---
'@objectstack/spec': patch
---

docs(spec): `actionLayout.record`'s description names the grid row menus it orders

Clause-②: no
Metadata-protocol: none

The `record` arm of an object's `actionLayout` already ordered the actions a grid row offers (its ⋮ menu, its right-click menu and, on a list page, the selection bar's actions for one selected record), but its description named only the record header (record page, side preview, a phone's bottom bar). The description now says so: on those surfaces the actions `pinned` names come first, then those `more` names, then the rest as before, and nothing is added. The selection bar's buttons, at most three, are the first of that order; a row's own inline button does not change. The guide page `content/docs/ui/actions.mdx` says the same. The spec's liveness ledger (`packages/spec/liveness/object.json`) now names the same row readers next to the record header for `actionLayout` and its `record` arm. Description and ledger text only; the shape and what it accepts are unchanged.

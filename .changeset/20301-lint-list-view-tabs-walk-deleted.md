---
"@objectstack/lint": patch
---

The list-view field-reference rule no longer walks a list view's own `tabs[].filter`

Clause-②: no

The list view's own `tabs` is a `retiredKey` tombstone on every list-view shape, and this rule judges the parsed stack, so the key could never reach the walk: the parse refuses it first, with its prescription. The dead branch is deleted. The rule still judges `filter` and `userFilters.tabs[].filter` exactly as before.

No finding changes for any stack that `os validate`, `os lint` or `os build` accepts.

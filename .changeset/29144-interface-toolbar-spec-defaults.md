---
'@object-ui/app-shell': minor
'@objectstack/spec': minor
---

fix(app-shell): an interface page's list toolbar reads the published `userActions` defaults — Filter, Row height, Group and Hide Fields are on unless the page writes `false`

Clause-②: no
Metadata-protocol: semantic

An interface page's `interfaceConfig.userActions` is the same `UserActionsConfigSchema` a list view uses, and that schema declares `filter`, `rowHeight`, `group` and `hideFields` on by default. The interface list page read those four as `=== true`, so a control appeared only when a parse had already written the default into the block. The same page drew two different toolbars depending on how it reached the console.

- **Before.** A page whose `userActions` block omitted one of the four drew that control only if the page had been parsed (a code package through `defineStack`). A page with no `userActions` block, or a stored page that was never parsed, drew none of the four.
- **Now.** The page reads `filter`, `rowHeight`, `group` and `hideFields` as on unless the block says `false`. A page with no block, an unparsed stored page and a parsed block that omits the key draw the same toolbar: Filter, Row height, Group and Hide Fields appear, beside Search and Sort, which already read this way.
- **Unchanged.** `rowColor` is off by default in the spec and stays opt-in: the page draws it only for `rowColor: true`. Export stays off on an interface page. A list view's toolbar is unchanged.
- **To keep a control closed** on a curated page, write it: `userActions: { filter: false, rowHeight: false, group: false, hideFields: false }`, or any one of them. Code-package pages that declare a `userActions` block already drew Group and Hide Fields after their parse, so they see no change.
- **Wording.** The `list-view-hide-fields-default-on` semantic entry and the default-change ledger no longer say an interface page keeps a closed-by-default toolbar.

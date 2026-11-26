---
'@objectstack/lint': patch
---

feat(lint): warn when a full record page's header title or action order differs from what the phone and the drawer draw

Clause-②: no
Metadata-protocol: none

An object's hand-written full record page (`type: 'record'`, `kind: 'full'`) is drawn on the desktop full page only; on a phone, in the side drawer, in a split pane and in an interface page's preview the record draws the standard page, built from the object. Two new advisories name a header that makes the same record read differently between the two:

- `record-page-header-title-differs`: the `page:header` declares a `title` that is not exactly the object's name field token (`{nameField}`, or the derived title field). The standard page, lists, search and lookups all title the record by that field.
- `record-page-header-actions-differ`: the header's `actions` list gives a different primary button, or a different order within the row of buttons or within the `⋯`, than the actions' own `order` / `variant: 'primary'` and their declaration order give on the standard page.

Both are warnings. They run on `os validate`, `os build` and `os lint`, and on a page publish at the metadata save door, where they come back as advisories and refuse nothing. Nothing about how a page renders changes. The fix each names: drop the header `title` (or set `nameField` on the object), give the actions an `order` and the main one `variant: 'primary'`, or move a header that should differ everywhere into a `kind: 'slotted'` page's `header` slot. `os explain` on either id prints what the check cannot see: visibility predicates and permissions, actions another package attaches, and the served declaration order, which it estimates.

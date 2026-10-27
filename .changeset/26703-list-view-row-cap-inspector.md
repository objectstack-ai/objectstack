---
'@object-ui/app-shell': patch
---

feat(app-shell): the page designer can set a list block's object, view and row cap

Clause-②: no
Metadata-protocol: none

Selecting a `list-view` block in the page designer used to open an inspector with no typed fields. Its row cap, the number of rows a list block in a wide page region draws (5 when none is stated), could be set only by editing the page's JSON, because the "Advanced" section lists only keys the block already has.

- **Three controls.** Object, View and Row limit. They write the block's `dataSource` binding (`dataSource.object`, `dataSource.view`, `dataSource.limit`), the keys the list block already reads. The Row limit box hints `5` when empty.
- **Labels in both designer locales**, English and Chinese.
- No new key is declared anywhere, and nothing an author already wrote changes. The palette still does not offer `list-view`: the controls edit list blocks a page already carries.

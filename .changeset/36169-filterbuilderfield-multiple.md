---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): the view and page-block filter editor offers a multiple: true field only Contains, Does not contain and the empty checks

Clause-②: no
Metadata-protocol: none

A `select`, `lookup` or `user` field declared `multiple: true` holds a list. Studio's filter editor for a view's filter, a page's base filter and tab presets, and a related-list block's filter built its field list without `multiple`, so it offered Equals and Is any of on such a field, and the saved filter was refused by the data door with 400 `INVALID_FILTER` for every reader of that view. Every host that builds the editor's field list now carries the field's declared `multiple` (the generic metadata editor, the list-view and view-variant inspectors, the in-app view configuration panel and the page block inspector), and the shared filter builder offers such a field Contains, Does not contain, Is empty and Is not empty, the operators the other condition editors already give it.

A single-value field of the same types keeps its operators. A stored Equals rule on a list-valued field still opens as its row, so it can be changed. No metadata key, value or default changes.

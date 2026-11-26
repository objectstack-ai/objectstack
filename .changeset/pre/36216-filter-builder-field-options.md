---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): the view and page-block filter editor offers a picklist field's options instead of a free-text value box

Clause-②: no
Metadata-protocol: none

Studio's filter editor for a view variant's filter, a page's base filter and tab presets, and a related-list block's filter built its field list without each field's declared `options`, so on a `select` (picklist) field the value was a plain text box. An author typed the label they see, the saved filter held a value no record stores, and the view or block showed no rows with no error. Every host that builds the editor's field list now carries the field's declared choices (the generic metadata editor, the view-variant inspector, the in-app view configuration panel and the page block inspector, as the list-view inspector already did), so a picklist field's value is a picker over its options and stores the option's value.

A field with no declared options keeps its text box. Stored filters are not rewritten. No metadata key, value or default changes.

---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(app-shell): Studio authors what the record page reads about related lists, highlight fields, and new record pages

Clause-②: no
Metadata-protocol: none

- **Field inspector, lookup and master-detail fields.** A "Related list on the parent record" section with a three-state control (Shown / Hidden / Primary (in body)) writes `relatedList`: Hidden writes `false`, Primary writes `'primary'`, and Shown leaves the key absent, the spec's own "true or absent = shown". Below it, `relatedListFilter` is edited with the same filter builder the dataset designer and the list toolbar use, instead of being absent from the inspector. A stored filter the builder cannot hold (nested, OR) is kept as stored and named.
- **Related-list block inspector.** The `record:related_list` block exposes `columns` (the child object's fields), `sort` (field and order rows), `filter` (the list toolbar's filter builder), `limit`, `showViewAll` (shown on when unset, the spec default) and `add`, beside the object, relationship field and title. A stored value in the other arm of a union, such as a string `sort` or `columns` given as saved-view column objects, is shown as JSON rather than as an empty or garbled list. The limit hint now reads 5, the renderer's own default.
- **Object settings.** `highlightFields` is an ordered list: drag a row or use the move buttons to reorder, add fields up to six, and see the highlight strip preview in the picked order. Removing the last field removes the key.
- **New record pages.** A record page created in the metadata editor now starts `kind: 'slotted'` with no slots, which is the synthesized default page, and it keeps following the object. The create form's kind follows the page type until the author picks one. Choosing `full` at create still copies the synthesized regions. In the page designer, a slotted record page says it is the default page and offers "Convert to full page", which copies the regions it renders, switches the kind to `full` and drops `slots`. An empty slotted page now opens on the slot editor instead of a blank regions canvas.

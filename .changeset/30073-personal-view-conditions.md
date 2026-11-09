---
'@object-ui/app-shell': patch
'@object-ui/plugin-list': patch
---

feat(app-shell,plugin-list): a personal view's own conditions are Filter panel rows, and 保存 writes the panel back into that view

Clause-②: no
Metadata-protocol: none

- **Opening one of the reader's own views (My views) shows its conditions as ordinary rows in the Filter panel**, with the active count on the Filter control. They are the list's filter while they are there: not applied under the list a second time, and not a personalization. A stored filter the panel cannot hold (an any-of group beside other conditions), or one naming a field the object no longer declares or the reader cannot read, stays applied under the list, as for any other view.
- **Editing those rows marks the list 已个性化, and the marker offers 保存 to that view** (for a reader allowed to update their views). 保存 replaces the row's `config` through the data API with the body Save as my view builds, so the stored `ListView` shape is unchanged and no key is added; the reader's temporary list state for the view is then cleared and the list opens on the saved view. Edits not saved stay the reader's temporary list state and are never written to the view. A panel the fold cannot write losslessly keeps the refusal Save as my view gives, and nothing is written.
- **Save as my view now clears the view it came from**: that view's stored list state (sort, filters, column layout, density, hidden fields) and cached search term go, and the address being left loses its `uf_*` params, so the source no longer reads filtered or 已个性化 after the save.
- Both saves read the Filter panel as the list reports it, not the address's copy, so an emptied panel saves as no filter.
- `@object-ui/plugin-list`: `ListView`'s host prop `viewDefaults` accepts `filters`, the view's own conditions for a host that shows them as panel rows; the `filters` personalization part is then judged against them.

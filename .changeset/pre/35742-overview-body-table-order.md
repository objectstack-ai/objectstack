---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record page Overview draws the record's own field groups first and its master-detail tables under them, at the list's dense row height, never with a half-cut column

Clause-②: no
Metadata-protocol: none

- **Order.** On the default record page's Overview, a master-detail (body) table now follows the field sections the page draws open, instead of leading them: stage bar and key fields (the strip across the top), then the record's field groups, then its body tables. An object with no stage bar and no key fields opens on its own fields. A field group whose `relatedList` names a body table still places it at that group's position. Sections drawn closed (a field group with `collapse: 'collapsed'`, or a `collapsible` section that is `defaultCollapsed`) that trail the last open one follow the tables; a closed section between open ones keeps its declared place. With every section closed, the tables follow them all.
- **Density.** A body table's data rows are 33px (a 32px cell over the row line) under a 32px header, the measures of a list's compact rows (`BODY_TABLE_DENSITY`).
- **Width.** A body table draws the leading columns, in their order, that fit whole in the details column, and offers the rest behind its labelled ⤢ "All columns" button; it no longer scrolls sideways with a column cut at the right edge. Only a table whose first column alone is wider than the column still scrolls, with that column pinned.

---
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

fix(plugin-grid): a grouped grid under draft preview no longer asks the data door for fields only the draft declares

Clause-②: yes — one new locale key (the visible "this grouping waits for publish" note the card's Expected names), locale-only; no spec, no new exported prop
Metadata-protocol: none

Under the console's draft preview (`?preview=draft`) the object definition marks each field only the draft adds with `_draftOnly`, while the data door still checks every requested field against the published object. A grouped grid built its own requests from that definition, so a draft-only column went into every group's row request and every group showed `INVALID_FIELD`, and a grouping on a draft-only field went out as the header query's `groupBy` and the whole grid showed "Error loading grid".

The grid now leaves a draft-only field out of its row `$select` and `$expand`, on the flat fetch and on every group's row page; the column still draws, empty, under its draft label. A grouping entry on a draft-only field is dropped the way a masked grouping key is: the grid groups by the published entries left, or draws ungrouped, and one note above the rows (`grid.grouping.draftOnly`, new in every locale pack) names the field and says grouping by it waits for publish. After Publish the marker is gone, and the grouping and the column work on the next definition read without a reload. Outside the preview no field carries the marker and nothing changes.

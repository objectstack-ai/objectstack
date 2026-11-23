---
'@object-ui/components': patch
---

feat(components): the record's close button moves to the left of the top bar's navigation row

Clause-②: yes (widening)
Metadata-protocol: none

`RecordTopBar` takes a new optional `close` slot, which holds the button that closes the record. The two-row bar draws it as the first control of the navigation row, before `leading`, the ↑ ↓ buttons and the "N of M" counter. The one-row bar (the phone face) still draws it last at the right end, after `frame`. `NavigationOverlay` hands its close button through the new slot, so on the record drawer, the split pane and the maximized pane the close button is now at the top left and the "Open as full page" button stays at the right. The close button keeps its accessible name and its handler, and Escape still closes as before. A host that still passes its close button inside `frame` gets the old far-right placement; to move it, pass it as `close` instead. No metadata key and no i18n string changes.

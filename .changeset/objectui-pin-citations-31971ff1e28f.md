---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `31971ff1e28f`.

Clause-②: no

Several records were corrected rather than moved, because objectui changed what they describe on this hop: `object-calendar` and `object-timeline` now read `navigation` with no cast, and `object-kanban`'s read compiles through a declared member, since objectui declared the key on all three blocks (objectui#8652, objectui#8654); `object-timeline` also publishes a `navigation` input (objectui#8654); and the `action:button` registration now publishes the five `size` values its row declares (objectui#11168). Two stale readings are also corrected: the `object-timeline` start/end binding anchor began one line early at the previous pin as well, and the `object-tree` optionality count now records the comment that names the gate in `plugin-map`'s shell. No key, default, enum member or export moves.

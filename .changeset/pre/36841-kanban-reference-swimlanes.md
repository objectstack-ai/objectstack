---
'@object-ui/plugin-kanban': patch
---

fix(plugin-kanban): a board swimlaned by a lookup or user field keys each swimlane by the referenced record's id and titles it by the record's name

Clause-②: no
Metadata-protocol: none

A kanban board whose `swimlaneField` is a reference field (lookup, user, master-detail) reads the field's value off records fetched with `$expand`, so the value is the referenced record. The swimlanes were built from that value stringified: every heading read `[object Object]`, and cards pointing at different records were drawn in one swimlane.

Each swimlane is now keyed the way a column lane on a reference field is keyed: by the referenced record's id. Its heading is the record's name, read through the field's `displayField` and then the shared record-title ladder, and falls back to the id when neither names the record. The swimlane order and the collapsed-swimlane memory kept in the browser use the id. A card with no value still sits in the "Uncategorized" swimlane, and a swimlane field that holds plain values is unchanged.

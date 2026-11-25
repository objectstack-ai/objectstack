---
'@object-ui/app-shell': patch
---

fix(console): re-ticking a dashboard card's "Apply" for a page filter restores the field the app binds it to, so an opt-out can be undone

Clause-②: no
Metadata-protocol: none

In the dashboard's own edit state (and in Studio's dashboard editor), unticking "Apply" under a card's "Follows the filters at the top of the page" writes the card's opt-out (`filterBindings: { NAME: false }`). Ticking it again used to drop the entry, which makes the card follow the filter's own field rather than the field the app binds it to. A dashboard save stores the whole document, so the re-target the app ships (for example `dateRange: 'signed_on'` on a card whose dataset has no `issued_on`) was lost: the save then bound the card to a field its dataset lacks, the publish was refused (`dashboard-filter-field-unknown`), and the opt-out stayed in force with no way to undo it from the editor.

Re-ticking now restores the binding the dashboard as shipped by its package gives that card (the layered read's `code` layer) when it re-targets the filter to a field; where the shipped card opts out too, or binds nothing, the entry is dropped as before. The edit state reads the shipped layer in the same layered read it opens the document from, and Studio's editor hands it to the card panel from the read it already makes. Nothing else a save writes changes, and no new strings.

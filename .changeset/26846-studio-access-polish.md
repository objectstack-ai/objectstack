---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

fix(app-shell): four small fixes to the Studio Access pillar

Clause-②: no
Metadata-protocol: none

- **A create that loses the race to a draft says so in plain words.** When a draft permission set with the same identifier appears between Studio's check and its save, the server refuses the save. Studio used to show the server's sentence about the "first-write pin" and `If-None-Match`. It now reads the refusal by its code and says that a draft with that identifier already exists. New key `engine.studio.access.createDraftTaken` in `@object-ui/i18n` (en, zh).
- **The sharing-baseline (OWD) overview drops a refusal once its edits are undone.** After a refused save, putting every row back to its loaded value ("No changes") now removes the refusal. An edit that is still unsaved keeps it.
- **The Access list follows a label change at once.** A draft save of the open permission set re-reads the list, so a renamed set shows its new label without a publish or a reload.
- **The field table under an expanded object stays readable when the matrix scrolls sideways.** The "shown / total" count sits beside the field filter instead of at the far end of the row, and the field-name column stays pinned to the left edge.

What to do: nothing. Nothing a permission set or object declares changes.

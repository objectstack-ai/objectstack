---
'@object-ui/app-shell': patch
---

fix(studio): removing a field that holds data asks before the Data pillar saves it

Clause-②: no
Metadata-protocol: none

In Studio's Data pillar, removing a stored field from a published object (or retyping or requiring one) made the draft autosave answer `409 DESTRUCTIVE_CHANGE`, and the pillar showed only its generic "changes not saved" strip, with no way to finish the change. The refusal now opens a confirmation that lists what the save would lose, in the server's own findings. **Force save** sends the same body to the same object and package again with `force`; **Cancel** puts each field the findings name back as the server holds it and sends nothing more. While the confirmation is open the autosave sends nothing. Every other refusal reads on the strip as before.

The confirmation reuses the existing `engine.edit.destructiveTitle`, `engine.edit.destructiveDesc`, `engine.edit.forceSave` and `engine.cancel` strings: no locale key, prop or export changes.

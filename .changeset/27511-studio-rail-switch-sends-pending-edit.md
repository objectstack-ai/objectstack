---
'@object-ui/app-shell': patch
---

fix(studio): switching objects in the Data pillar's rail sends an edit made inside the autosave delay instead of dropping it (#27511)

Clause-②: no
Metadata-protocol: none

The Studio autosave sends a draft 1.5 s after the last edit, and sends nothing once another object has been opened. An edit made less than 1.5 s before a click on another object in the Data pillar's rail (a field removed, a label renamed) was therefore dropped, with nothing on screen, and was gone after a reload. The switch now sends that edit to its own object first and opens the next object once the save has landed; a save already in flight is waited out the same way. An edit that cannot be sent (its save was refused, or Studio holds it as unfinished) is not dropped silently: the switch asks first, and declining keeps the open object and its edit.

---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): hooks, an installed app's added actions, flows and permission sets save with the top bar, and a Save is live at once

Clause-②: no
Metadata-protocol: none

The Studio's hooks, the actions an installed app's object gains in its `.custom` package, flows and permission sets no longer autosave a draft 1.5 s after each edit. Edits stay on the page until the author presses Save in the top bar; Cancel puts them back as the server holds them. Save writes each edited item's draft and then publishes that one item at the package it was written to, so the change is live at once. A new hook or an added action is written only by Save, and a removed added action is deleted by Save.

A flow's on/off switch needs no Save: a flip writes the stored flow with the new status and publishes it at once, leaving any unsaved canvas edit on the page for Save. A new flow is published as it is created, switched off, so switching it on makes it live straight away. The access banners, the inspector footers and the Studio landing say that Save makes a change live.

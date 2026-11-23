---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the object page saves with Cancel and Save in the top bar, and a Save is live at once

Clause-②: no
Metadata-protocol: none

Studio's object page (fields, validation rules, actions, settings and field groups) no longer autosaves a draft 1.5 s after each edit. Edits stay on the page until the author presses Save, which sits at the right of the Studio top bar where Publish was; Cancel beside it puts the page back as the server holds it. Save writes the object's draft and then publishes that one object at the package it was written to, so the change is live at once. An installed app's object takes its edits into the paired `.custom` package and publishes them there.

Changes and Publish are drawn only while drafts are pending (a copilot's, or another editor's), and a publish waits while the page holds edits Save has not sent. A Save refused by the server keeps the edits on the page with the reason, and its toast names each refused item with its reason and lists the items that were saved. Removing or retyping a published field asks first. Save waits out the expression checks of the last keystroke, so a formula or rule guard that does not parse is never sent. Leaving the page, or opening another object, with unsaved edits asks, as every departure does.

Other Studio editors (flows, hooks, list and form views, navigation, permissions) keep their draft autosave for now.

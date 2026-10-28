---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Studio's Automations, App and Data creates refuse an identifier a published or draft item of that type already holds

Clause-②: no
Metadata-protocol: none

- **Before.** "New automation", "Create app" and "New object" saved their blank skeleton as a draft under the first-write pin (`If-None-Match: *` with `?mode=draft`), which the door refuses only where a DRAFT row exists. An identifier a published flow, app or object already held therefore got the skeleton written as that item's pending draft, and publishing the package would have replaced the live item with the blank one. The Data create checked only the objects on its own rail; the other two checked nothing.
- **Now.** Before anything is written, each create reads the published items and the drafts of its type across every package, the read the Interfaces and Access creates already make (now one shared helper). An identifier one of them holds is refused in the dialog with a sentence naming the item; when the item is on the pillar's own rail (a flow or an object of this package), the dialog offers to open it instead. A fresh identifier is created as before, and the door's first-write pin still refuses a draft that lands between the check and the save.
- **Strings** (`@object-ui/i18n`). Five new rows in the `studio` namespace (`en` and `zh`) for the refusals; the Access refusal's "Open" row becomes `engine.studio.create.openExisting`, shared by every create, and the Data pillar's `engine.studio.data.idExists`, which the new refusal replaces, is removed.

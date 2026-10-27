---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Studio Access refuses a new permission set whose identifier a set already holds, and can discard a set's pending draft

Clause-②: no
Metadata-protocol: none

- **Before.** The Access pillar's "+ New" saved the blank skeleton as a draft under the first-write pin (`If-None-Match: *` with `?mode=draft`), which the door refuses only where a DRAFT row exists. A name that derived to a published set's identifier therefore wrote a blank draft over the live set: the rail kept showing the set, its matrix opened empty, and publishing the package would have replaced every grant of the set. Studio offered no way to remove that draft.
- **Now.** Before anything is written, the create reads the published and the draft permission sets across every package. A name one of them holds is refused in the dialog with a sentence naming the set; when the set is this package's, the dialog offers to open it instead. A fresh name is created as before, and the door's first-write pin still refuses a draft that lands between the check and the save.
- **Discard.** An open set with a pending draft shows "Discard draft" in its header. It confirms, then deletes the draft at this package's address (`DELETE ?state=draft&package=…`, the metadata editor's discard door): a published set goes back to its live body, and a set that was never published leaves the rail.
- **Strings** (`@object-ui/i18n`). Six new rows in the `studio` namespace, `en` and `zh`.

---
'@object-ui/app-shell': patch
---

fix(app-shell): a full-page record form opened by direct URL returns inside the app after save or cancel

Clause-②: no
Metadata-protocol: none

The full-page create and edit forms (`/new`, `/record/ID/edit`) went Back after a save or cancel whenever the browser tab had any history, including entries from before the console loaded. A form reached by a pasted URL, a new tab or a deep link therefore left the app (often for the console home), and the save toast was lost with the unloaded page. The form now goes Back only when an earlier page of this console session is behind it; otherwise it goes to the record (edit) or the object list (create), as in-app entry does when nothing is behind it, and the toast is shown there.

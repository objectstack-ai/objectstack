---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Studio no longer edits the published version over a dashboard draft it is not allowed to read, so the autosave cannot overwrite that draft

Clause-②: no
Metadata-protocol: none

- **Before.** A pending draft can carry an audience gate (`requiredPermissions`) its author does not hold, for example one written over the API or MCP. The draft read answers `403 PERMISSION_DENIED` for it, by design. Studio's draft reader (`readDraftForSave`) took every failed read for "no pending draft", so the Interfaces pillar opened the published body in its place and the next autosave sent that body as the draft, with no precondition: the draft lost the gate and every other unpublished change, and publishing it served the dashboard to everyone.
- **Now.** `readDraftForSave` hands a read refused `403` back as `refused` (with `isDraftReadRefused` to tell it apart). The Interfaces pillar installs no buffer for such a leaf: nothing is shown to edit and the autosave has nothing to send. The refusal strip says the item has an unpublished draft this author may not read, that editing the published version would overwrite it, and that someone who holds the draft's required permissions can edit or publish it; the server's own sentence is behind Details.
- **Unchanged.** A leaf with no pending draft opens the published body and its first save is still pinned to "no draft row"; a readable draft opens as served. Any other failed draft read is handled as before.

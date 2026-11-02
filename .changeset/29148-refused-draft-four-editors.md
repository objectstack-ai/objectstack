---
'@object-ui/app-shell': patch
---

fix(app-shell): the list view inspector, the email template and translation form editor, the permission matrix and the hooks panel no longer edit the published version over a draft the author is not allowed to read

Clause-②: no
Metadata-protocol: none

- **Before.** A pending draft can carry an audience gate (`requiredPermissions`) its author does not hold, for example one written over the API or MCP, and the draft read answers `403 PERMISSION_DENIED` for it by design. `readDraftForSave` hands that refusal back as `refused`, but these four editors still read it as "no pending draft": they opened the published body in its place, and their next save sent that body as the draft, dropping the gate and every other unpublished change.
- **Now.** Each of them installs no buffer for such an item: nothing is shown to edit and the autosave has nothing to send. The refusal strip says the item has an unpublished draft this author may not read and that editing the published version would overwrite it; the server's own sentence is behind Details. The hooks panel holds only the refused hook: the other hooks of the object open and save as before.
- **Unchanged.** An item with no pending draft opens the published body and its first save is still pinned to "no draft row"; a readable draft opens as served. Any other failed draft read is handled as before.

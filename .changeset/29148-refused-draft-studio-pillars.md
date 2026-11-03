---
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio app navigation, object, object extension and flow editors and the metadata item editor no longer edit the published version over a draft the author is not allowed to read

Clause-②: no
Metadata-protocol: none

- **Before.** A pending draft can carry an audience gate (`requiredPermissions`) its author does not hold, for example one written over the API or MCP, and the draft read answers `403 PERMISSION_DENIED` for it by design. `readDraftForSave` hands that refusal back as `refused`, but the Interfaces pillar's app navigation, the Data pillar's object and its extension at a base's paired package, the Automations pillar's flow and the metadata item editor still read it as "no pending draft": they opened the published body in its place, and their next save sent that body as the draft, dropping the gate and every other unpublished change. The metadata item editor did the same after a publish that left such a draft behind.
- **Now.** Each of them installs no buffer for such an item: nothing is shown to edit and no save is sent. The refusal strip says the item has an unpublished draft this author may not read and that editing the published version would overwrite it; the server's own sentence is behind Details. The metadata item editor withholds every write it offers for that item and shows the same strip in place of the editor. The strip is now its own module, `StudioRefusalStrip`, so the metadata item editor draws the one Studio uses.
- **Unchanged.** An item with no pending draft opens the published body and its first save is still pinned to "no draft row"; a readable draft opens as served. Any other failed draft read is handled as before.

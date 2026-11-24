---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/data-objectstack': patch
---

feat(studio): the generic item page's Save takes effect at once; an AI draft gets the designers' notice and discard

Clause-②: no
Metadata-protocol: none

Studio's generic item page saves the way the designers do. Save writes the item's draft and then publishes that one item (`POST /meta/:type/:name/publish`, at the same package and bundle member), so the change is live at once and there is no second Publish step. The draft save keeps its version pin and conflict dialog, and the publish is now pinned to the published version the page loaded: when another editor published the item in between, the same dialog asks to reload, overwrite or keep editing. A create publishes right after its first save. The auto-save switch is gone, and edits wait for Save, ⌘S or the destructive-change confirmation.

A refused publish shows its reason above the editor in the designers' words, with the server's text under Details. Nothing goes live, the draft the Save wrote is taken back, and the edits stay on the page, unsaved.

A pending draft written by the AI assistant (the copilot or an MCP client) is the version on screen, under the designers' line: saving makes it live too, and "Discard AI changes" drops that one item's draft, asking first when the page holds unsaved edits. A pending draft a person wrote before this change is marked "This item has unpublished changes", with its own Publish and Discard for that item. The header's Publish and discard buttons are gone.

Leaving the page with unsaved edits still asks first through ×, ‹ ›, the side menu, in-app links, reload and close. The browser's Back is not intercepted.

`@object-ui/data-objectstack`: `MetadataClient.layered()` now forwards the served `overlayVersion` (new optional `MetadataLayered.overlayVersion`). The client used to rebuild its answer field by field and drop it, so a Studio Save's publish was never pinned on a server that serves it.

Locale keys `engine.edit.unpublishedChanges` and `engine.edit.unpublishedPublishDirty` are new, and `engine.edit.autoSaveOn`, `engine.edit.autoSaveOff` and `engine.edit.autoSavingShortly` are removed (en, zh). The per-browser `metadata-admin:autosave` setting is no longer read. No metadata changes; nothing to migrate.

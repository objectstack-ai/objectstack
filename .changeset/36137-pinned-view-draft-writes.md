---
'@object-ui/app-shell': patch
---

fix(console): a view settings save is pinned to the draft it opened, so it can no longer be published by someone else's Save to this view

Clause-②: yes (widening) — `ViewConfigPanel`'s `onSave` host prop gains an optional second parameter, the panel's draft-version guard (`saveDraft`), which the panel always passes; a host that takes one argument is called as before; nothing removed or renamed
Metadata-protocol: none

**Save to this view** on a shared view writes a draft and then publishes it. A save from the view settings panel that landed between the two used to overwrite that draft unpinned, and the publish then made the settings panel's unreviewed change live for everyone.

- The view settings panel now sends its draft save pinned to the draft it opened: `If-Match` with the version its load read, or `If-None-Match: *` when the view had no draft. After a save lands, the next one is pinned to that save's receipt. A save over a draft that changed since (another admin's settings save, or a Save to this view in flight) is refused by the server, and the panel opens the Studio editors' draft conflict dialog: reload the saved version, overwrite it after a second confirmation, or keep editing. The edit stays in the panel until the author chooses.
- Creating a view (the Create View dialog, the panel's create mode, Save as view) sends the first-write pin, `If-None-Match: *`, so a create over a name that already holds a pending draft is refused instead of writing over it. A report, dashboard or page created at runtime takes the same pin.
- A host of `ViewConfigPanel` that writes through the guard it receives gets the pin and the dialog; a host that ignores it saves unpinned, as before.

No metadata key, value or default changes.

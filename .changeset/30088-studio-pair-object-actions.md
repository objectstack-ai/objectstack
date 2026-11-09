---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Studio adds an action to an installed app's object, saved in the base's customization package (#30088)

Clause-②: no
Metadata-protocol: none

On a read-only (installed or code-shipped) package that has, or can get, its paired customization package (`<base>.custom`), the Data pillar's Actions view of the base's object now offers New. Before, it listed the vendor's actions with no New, so an operations person could not add a button such as "Mark qualified" to an installed app's leads, although the platform accepts the result.

- New offers the same presets and the same action editor as on a writable package. The action is saved as its own `action` item in the pair, bound to the object by `objectName`, as a draft (the first write asks the ensure door for the pair). The base's object is never written.
- The vendor's actions stay read-only in the list. The added action is listed after them with the "added" customization mark, its edits autosave into its draft in the pair, and Delete removes its draft and its published item from the pair. An added action keeps the name it was created with: a rename is held with a line saying how to save.
- The action publishes with the pair's other drafts from Pending changes, and the Actions list's "only customizations" counts it and narrows the list to the pair's actions.

A writable package's action editing is unchanged: its actions are still written into the object draft. No spec, server or metadata-type change.

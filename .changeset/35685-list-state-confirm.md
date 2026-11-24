---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(list): confirm a state-machine move before a list cell saves it; the drawer's save bar says when the record changed elsewhere

Clause-②: yes (widening) — `GridCellSelection` in `@object-ui/components` takes an optional `confirmCommit(row, columnKey, value)` member; nothing removed or renamed
Metadata-protocol: none

In a grid that mounts `GridCellSelection` (the select-first grid every `ListView` draws):

- **A move of a state-machine field asks first.** When an active `state_machine` validation rule of the object governs the field on update, a new value committed into its cell (picked in the editor, or pasted) opens a confirm naming the field and both values and saying saving may trigger related automation. Cancel writes nothing and the cell keeps what it showed; Change saves the value as any commit is saved. Focus goes back to the cell either way.
- **The generic seam:** `GridCellSelection.confirmCommit` is asked before a value that changes what a cell shows is staged or saved. A promise holds the write until it settles (`true` writes, `false` or a rejection writes nothing); `null` or `undefined` means no question, as before.

On a record page or in a record drawer, `InlineEditSaveBar` now says so when the record is read again at another version while an inline edit session is open (a list cell beside the drawer saved it, say). The draft stays as typed, and Save writes it over the version now read, as it did before; only the note is new.

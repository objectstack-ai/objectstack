---
'@objectstack/spec': minor
'@object-ui/plugin-list': minor
---

spec(ui): a list view lets readers hide and show columns by default — `userActions.hideFields` defaults to `true`

Clause-②: yes (widening)
Metadata-protocol: semantic

A declared default moves. A list view whose `userActions` block says nothing about `hideFields` now offers the Hide Fields control, so a reader can remove a column they do not need without the app author having to turn the control on.

- **Before.** `UserActionsConfigSchema.hideFields` defaulted to `false`, and the list renderer drew the control only for an explicit `hideFields: true`. Generated apps and the CRM example never declared it, so their lists had no way to hide a column.
- **Now.** The default is `true`, and the list renderer reads `hideFields !== false`, so the spec default and the renderer agree. A view with no `userActions` block parses with none, and the renderer reads the absent key as the new default.
- **Interface pages.** A page `interfaceConfig.userActions` block that omits the key parses to `true` as well, and the interface page reads the same default: a page that omits the key, or has no `userActions` block, offers the control, and `hideFields: false` withholds it.
- **Where the choice is kept** does not change. The control only subtracts from the columns the view draws. On a view that declares `columns`, or a saved view, the choice is stored on the reader's own list state and survives a reload for that reader only. On a system view that declares no `columns`, it lasts for the session. It never writes the shared view.
- **To withhold the control**, write `userActions: { hideFields: false }`. Every authored `hideFields` parses exactly as before, and a non-boolean is still refused.
- **Compiled artifacts.** A document that serialised an earlier parse (an `os compile` artifact) carries the old written `false` and keeps withholding the control. Recompile it, or delete the key.
- **Upgrade path.** The ADR-0087 D3 semantic entry `list-view-hide-fields-default-on` carries the change to `os migrate meta` and the upgrade guide. The default change is declared in the build's default-change ledger. No key is added or removed.

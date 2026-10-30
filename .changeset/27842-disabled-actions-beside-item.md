---
'@objectstack/spec': minor
---

feat(spec): the object meta reads declare `disabledActions`, the packaged actions the activation ledger switches off, beside the item

Clause-②: yes (widening)
Metadata-protocol: added

`GetMetaItemResponseSchema` and `GetMetaItemCachedResponseSchema` gain the optional `disabledActions` (an array of action names), and `GetMetaItemsResponseSchema` gains the optional `disabledActions` keyed by object name. On an `object` read it names the actions in `item.actions` that this deployment's activation ledger switches off (an administrator turned them off under Setup › Packaged automation), so a call to any of them is refused 409 `ACTION_DISABLED`. It sits beside the item, never inside it: `item.actions` is served as declared, a switched-off action included. The key is absent when no activation ledger answered, which never means "nothing is switched off"; `[]` means a ledger answered and none of this object's actions is off. On the cached default door it is read live and kept out of the ETag, so a read that carries it is never answered 304. `IObjectQLEngine` gains the optional member `getDisabledActions()`, which the metadata read calls through the kernel's service table: it returns the switched-off names, or `undefined` when no ledger is attached.

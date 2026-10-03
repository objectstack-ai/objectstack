---
'@objectstack/metadata': minor
---

The runtime write doors' `name` judge covers every metadata type: `savedItemNameRefusal` replaces `savedViewContainerNameRefusal` on `@objectstack/metadata/view-container-name`

Clause-②: yes

- `savedItemNameRefusal(type, item, saveName, door)` is the one entry the runtime write doors of `@objectstack/metadata-protocol` call. It returns a `VALIDATION_ERROR` / 400 refusal when a body of any type carries its own `name` and that `name` differs from the name the row is written under, and `undefined` otherwise. `door` is `'save'`, `'restore'` or `'publish'`. A body with no `name` passes. A `name` the body does carry is judged whatever its value (`''`, `null` and non-strings included), with one exception: a `view` at the `'save'` door, which stamps a missing name there, is judged only on a non-empty string `name`.
- It replaces `savedViewContainerNameRefusal(container, saveName)`, which judged view containers only. That export was added to this subpath in this same release cycle and never shipped in a published version, so no published export is removed.
- The words name the type and give a remedy that works for it: "drop `name`, or set it to KEY" only for a view at the save door, "set `name` to KEY" for every other type, and at the restore and publish doors the save that fixes the stored body. For a view container at the save door the message is byte for byte the one `savedViewContainerNameRefusal` returned.
- `viewContainerNameRefusal` (the source registrars' entry), its words and the `ViewContainerNameRefusal` type are unchanged.

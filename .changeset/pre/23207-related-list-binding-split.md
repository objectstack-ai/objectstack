---
'@objectstack/lint': patch
---

fix(lint): `page-field-unknown` judges each of a `record:related_list`'s bindings against its own object, so a `dataSource`-bound list no longer reports its parent-side `relationshipValueField` as missing from the child (#23207)

Clause-②: no

- **Child refs** (`columns`, `sort`, `filter`, `relationshipField`, `add.linkField`) resolve against the node-level `dataSource.object` when the list binds its rows that way, else against `properties.objectName`. Before, they resolved only against `properties.objectName`, so a `dataSource`-bound list's child columns went unchecked.
- **The parent ref** (`relationshipValueField`) resolves against the list's `parentDataSource.object` when it declares one, else against the object the list inherits (its container's binding, else the page object). Before, a `dataSource`-bound list checked it against the child, which gave a false `field "…" is not a field on object "CHILD"` warning on a field of the parent.
- **Severity is unchanged.** These findings stay warnings, so default `os validate`, `os lint` and `os build` accept every stack they accepted before. Under `--strict`, which treats warnings as errors, a `dataSource`-bound list with a misspelled child column can now fail a stack that used to pass, because that column was not checked before. To fix it, correct the column name to a field of `dataSource.object`.
- `WalkedComponent` (from `walkPageComponents`) gains an optional `inheritedObject`: the object a component inherits before its own `dataSource.object` / `properties.object` override. `objectName` is unchanged.

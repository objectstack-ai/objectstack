---
'@objectstack/runtime': patch
---

fix(runtime): `GET /packages/:id/export` of a base no longer carries its `.custom` pair's dashboard or report override

Clause-②: no
Metadata-protocol: none

ADR-0146 D8 item 3: the base's export carries the base unchanged, and the pair's export carries the overriding item with its `overrides` block. Views already did. After a published dashboard or report override in `<base>.custom`, the base's export carried two items of the name: the base's own and the pair's override, with the edited label and the `overrides` block. The export now leaves out, from a package's own export, any item that declares it overrides that package. The pair's export is unchanged. Nothing to migrate: re-export the base to get a file without the override.

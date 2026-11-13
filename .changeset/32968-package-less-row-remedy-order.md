---
'@objectstack/spec': patch
---

docs(spec): the upgrade guide's remedy for a package-less row at a holder's exact address keeps the row's body, deletes the package-less row before saving, and saves a code package's customization in its paired `.custom` package

Clause-②: no
Metadata-protocol: none

The semantic entry `package-less-row-exact-address-by-type-class` (#32568) prescribed saving the customization, then deleting the package-less row. Measured on `main`: a delete naming no package addresses the one package the name's rows are bound to, so in that order it removed the change just saved (the draft saved under a writable holder; the declared override of a `dataset` in the holder's `.custom` package) and left the package-less row. And `?package=<holder>` refuses the save `403 NOT_OVERRIDABLE` when the holder is a code package, naming its `.custom` pair. The entry now says to read and keep the package-less row's body first (from its `sys_metadata` record through `GET /api/v1/data/sys_metadata`, since the delete hard-deletes it and a draft leaves no history copy), to clear any package-bound row of the name at that state before the package-less delete (that delete would otherwise remove the bound row instead), then delete, then save, and where each holder kind takes the save. It also says which sealed types' package-less delete answers `403 NOT_OVERRIDABLE` when a code package ships the name (`flow`, `action`, `doc`, `mapping` and every type with no override channel but `skill`): that row stays stored and served by no read, and the change is saved without the delete. Its acceptance criteria name the address the saved draft answers at. Text only: no answer moves, no key and no export is added.

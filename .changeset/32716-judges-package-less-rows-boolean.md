---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `judgesPackageLessRows` returns a plain `boolean`, not a type predicate

Clause-②: no
Metadata-protocol: none

`judgesPackageLessRows(registry, type)` was declared `type is PackageScopedType`. Its `false` answer depends on the registry (`readsByPackage`), not on the type alone, so TypeScript narrowed a package-scoped type to `never` in a caller's `false` branch, although a package-scoped type the registry does not read by package (`hook`, for one) lands there. It now returns `boolean`. Its runtime answer is unchanged. To narrow a `string` to `PackageScopedType`, call `isPackageScopedType` from `@objectstack/core`, whose answer depends on the type alone.

No read moves. A stored package-less row of a sealed type (`action`, `queue`, `tool`) of a name a package ships, read at a holder's exact address (`?package=`), gets the holder's own item before and after the boot load (`loadMetaFromDb`), around the list read's hydrator, and with a copy in the registry's bare slot. This holds with one holder and with two. The boot load is now pinned beside the other hydration states.

---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: `judgesPackageLessRows` returns a plain `boolean`, not a type predicate

Clause-②: yes (narrowing) — the exported `judgesPackageLessRows`'s return type moves from the predicate `type is PackageScopedType` to `boolean`, so a TypeScript caller that narrowed `type` through its `true` branch no longer compiles. Its runtime answer is unchanged.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is one exported function's TypeScript return type, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a TypeScript caller that narrows `type` to `PackageScopedType` through `judgesPackageLessRows(registry, type)` (for example `if (judgesPackageLessRows(r, t)) useScoped(t)`): it no longer compiles. Call `isPackageScopedType(type)` from `@objectstack/core` first, as `packageLessRowOwners` now does.

`judgesPackageLessRows(registry, type)` was declared `type is PackageScopedType`. Its `false` answer depends on the registry (`readsByPackage`), not on the type alone, so TypeScript narrowed a package-scoped type to `never` in a caller's `false` branch, although a package-scoped type the registry does not read by package (`hook`, for one) lands there. It now returns `boolean`. Its runtime answer is unchanged. To narrow a `string` to `PackageScopedType`, call `isPackageScopedType` from `@objectstack/core`, whose answer depends on the type alone.

No read moves. A stored package-less row of a sealed type (`action`, `queue`, `tool`) of a name a package ships, read at a holder's exact address (`?package=`), gets the holder's own item before and after the boot load (`loadMetaFromDb`), around the list read's hydrator, and with a copy in the registry's bare slot. This holds with one holder and with two. The boot load is now pinned beside the other hydration states.

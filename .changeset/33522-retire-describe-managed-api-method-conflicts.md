---
'@objectstack/spec': patch
---

refactor(spec)!: retire `describeManagedApiMethodConflicts`, an export of `@objectstack/spec/data` that nothing calls

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no key of any schema, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped. The one change is a removed runtime function of the `@objectstack/spec/data` subpath, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The other categories are closed on facts: `@objectstack/spec` publishes (not unpublished); no ADR-0087 id covers the function and this diff adds none (not registered or already-registered); it is a function, not an interface or a type narrowed off `any` (not runtime-interface-only or type-surface-only); and `runtime-export-retired` reads only a package's root entry at this revision, which never exported this name (it is reachable from the `./data` subpath alone), so that category cannot verify it. -->

**BREAKING** for a TypeScript caller that imports `describeManagedApiMethodConflicts` from `@objectstack/spec/data`. None is known: in this repository (`ui/` and `examples/` included), in hotcrm and in gallery the name occurs only in its own declaration, its own test and the generated surface snapshots. The lint rule `object/managed-api-method-unaffordable` and the registry's boot-time strip each word their own message from `checkManagedApiMethodAffordances`, so the helper's sentence reached no author or operator. That sentence also named `userActions` as the remedy on every `managedBy` bucket, which is wrong on a `synced` object, whose parse refuses a `userActions` override that opens a write.

**What stays.** `checkManagedApiMethodAffordances`, `ManagedApiMethodConflict` and `MANAGED_WRITE_VERB_AFFORDANCE` are unchanged, and so is every verdict the lint rule and the registry strip reach.

**For a caller.** The compiler names the import (`TS2305: Module '"@objectstack/spec/data"' has no exported member 'describeManagedApiMethodConflicts'`). Delete it, and word the message from the `verb` and `needs` of each conflict `checkManagedApiMethodAffordances` returns, for the object's own `managedBy` bucket. **No deprecation window** (startup-stage posture: a shipped capability with no consumer retires at once).

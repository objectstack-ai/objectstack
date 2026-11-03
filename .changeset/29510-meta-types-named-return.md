---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): `getMetaTypes()` declares a named return type, held equal to the type it returned before

Clause-②: no
Metadata-protocol: none

No behaviour change and no type change. `ObjectStackProtocolImplementation.getMetaTypes()` now declares `Promise<MetaTypesListing>`, composed from `@objectstack/spec`'s `MetadataTypeRegistryEntryParsed`, `Action` and `FormView`, in place of an inferred type that the published `index.d.ts` printed inline over 793 lines. A compile-time equality check in the method holds the name equal to what the body builds, so the two cannot drift. The `.d.ts` text is shorter; the type a consumer reads is the same one, checked equal against the declaration file `main` built before this change. `MetaTypesListing` is not exported from the package. Nothing to migrate.

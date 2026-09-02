---
"@objectstack/objectql": patch
---

docs(objectql): correct `MetadataFacade`'s class docblock — it is not the installed `'metadata'` kernel service (#14019)

The class docblock claimed `MetadataFacade` is "Registered as the 'metadata'
kernel service". Sixty lines down the same file, `registerObjectBothPlaces`'
header states the opposite — nothing installs a `MetadataFacade` into that
slot — and the second statement is the true one. This docblock ships to
consumers inside the package's declaration files, so the false half was
readable from an editor's hover on an imported `MetadataFacade`.

Re-measured on the current tree: the only non-test `registerService('metadata',
…)` site registers `MetadataPlugin`'s own manager; the kernel's core-fallback
pre-injection registers `createMemoryMetadata`; and `new MetadataFacade(...)`
appears nowhere outside tests.

The docblock now says what the class is — an injectable `IMetadataService` over
a `SchemaRegistry`, exported from this package's root and `core` entrypoints
for a downstream host that chooses to install it — and what it is not, in the
same voice as the header that already said so. Prose only: no registration, no
behaviour change, no API change.

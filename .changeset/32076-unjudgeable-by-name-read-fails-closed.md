---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol): a by-name `/meta` read the engine's registry cannot judge fails closed for a package-scoped type (ADR-0150 D3/D5)

Clause-②: no
Metadata-protocol: none

A by-name read of a type ADR-0150 addresses by `(package, name)` (the types in `@objectstack/core`'s `PACKAGE_SCOPED_TYPES`) is judged through the engine registry's package-scoped resolver. On an engine whose registry has no such resolver, the read used to fall back to the registry's prefer-local `getItem`, which serves the first match: a read naming package X (`?package=X`, or the qualified path `/meta/:type/:ns/:name`), a read of the environment's own item (`/meta/:type/_env/:name`) and a read naming no package could each answer another package's item. Such a read is now refused with `501 NOT_IMPLEMENTED` and a sentence naming the cause: the composition's metadata engine has no package-scoped resolver. The 501 is a declared refusal, so both transports keep its sentence, and the runtime dispatcher's `/meta` item read answers it instead of falling through to the by-name `MetadataService` read.

Every composition in this repository mounts the metadata protocol on an ObjectQL engine, whose `SchemaRegistry` carries the resolver, so no production answer changes. A host that mounts the protocol on its own engine without the resolver gets the refusal for these types; mount it on an ObjectQL engine instead. Types outside the set, and engines with the resolver, are unchanged.

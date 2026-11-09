---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/plugin-sharing': patch
---

refactor(core,objectql,plugin-sharing): one `PackageScopedNameRefusedError` class for the 409 a package-scoped by-name read refuses with

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/core`: `PackageScopedNameRefusedError`** (new export), beside `PackageScopedRefusal` and `packageScopedRefusalMessage`. It carries `code: 'RESOURCE_CONFLICT'`, `status: 409`, `httpStatus: 409` and the resolver's `refusal`, and its message is the refusal's own sentence, which names every candidate.
- **`@objectstack/objectql`** and **`@objectstack/plugin-sharing`** each declared a class of that name before, and an `instanceof` against one never matched the other. Both now re-export core's class under the same name, so every existing import keeps resolving and one `instanceof` matches a refusal from an objectql reader (`SchemaRegistry#getApp` and the other ADR-0150 by-name readers) and from a plugin-sharing door (a declared sharing rule, queue or assignment rule name) alike. objectql's copy already carried `httpStatus`; plugin-sharing's refusal now carries it too, with the same value.
- **`@objectstack/objectql/core`** (the lean entry) now exports `PackageScopedNameRefusedError` too, since the `SchemaRegistry` it exports throws it.

No door changes its answer: each still refuses `409 RESOURCE_CONFLICT` with the same sentence.

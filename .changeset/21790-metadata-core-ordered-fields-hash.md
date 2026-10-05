---
'@objectstack/metadata-core': minor
---

The content hash keeps the order of an object's `fields`, so a pure field reorder is a new version instead of "no change" (#21790).

Clause-②: yes

- **`canonicalize(value, type?)` and `hashSpec(value, type?)`** take the metadata type. For a type whose body has a map the spec declares ordered, that map keeps its insertion order in the canonical form. Today that is one map: `object.fields`, whose traversal order is the field order the platform presents. Every other map stays key-order independent, including the keys around `fields` and the keys inside each field definition. Called without a type, both functions return exactly what they returned before.
- **`orderedMapKeys(type?)`** is a new export. It returns the top-level keys of a `type` body whose map keeps its order (`['fields']` for `object`, `[]` otherwise).
- `InMemoryRepository` and the repository contract suite hash as `ref.type`. Invariant 4 now reads `item.hash === hashSpec(item.body, item.ref.type)`.
- **Stored hashes.** An object whose `fields` are already in sorted key order hashes exactly as before. Any other object hashes differently from the hash stored before this release. A stored hash is still that row's version token: `@objectstack/metadata-protocol` keeps it as written and compares content to decide whether a save changed anything.

`minor` because two exports widen: a new parameter and a new function. No metadata key, accepted value, wire payload or error code changes.

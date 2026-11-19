---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: `$expand` and a relation condition stop serving a disabled package's object through an enabled object's lookup, the answer its own data route already gives

Clause-②: yes (narrowing: `$expand` withholds a disabled package's object and a relation condition on one is refused, the answer its own data route already gives)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is what the data routes serve of a disabled package's object reached through another object's lookup. A caller that needs those records re-enables the package. -->

**BREAKING** for a caller of the data routes on an environment that disables a package. A disable takes the package's records off the data plane: `GET /api/v1/data/:object` answers `404 OBJECT_PACKAGE_DISABLED`. An enabled object's lookup into that package's object still served it: `$expand` (list, by-id `expand`, and the POST relation map) returned the disabled record's full row, and a nested-relation condition (`{ "lookup": { "field": VALUE } }`) answered yes/no on its fields.

- `$expand`: an entry whose target belongs to a disabled package is withheld, exactly as an entry whose target is not exposed (`apiEnabled: false`) already is. The lookup keeps its stored id; nothing of the target is read or named. Reference-name titles ride the same expansion and are withheld with it.
- A nested-relation condition on such a target is refused with the data route's own envelope, `404 OBJECT_PACKAGE_DISABLED`, naming the object and the query position, before the query runs.

The fix: re-enable the package to have its records expanded and filtered on again. An environment with no disabled package sees no change.

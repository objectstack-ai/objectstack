---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: global search leaves out the objects of a disabled package, the answer every data route already gives

Clause-②: yes (narrowing: global search stops returning a disabled package's records, the answer every data route already gives)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is which objects GET /api/v1/search sweeps once a package is disabled. A caller that needs those records re-enables the package. -->

**BREAKING** for a caller of `GET /api/v1/search` (and of `searchAll` in process) on an environment that disables a package. A disable takes the package's records off the data plane: `GET /api/v1/data/:object` and the by-id read answer `404 OBJECT_PACKAGE_DISABLED`. Global search did not ask that question, so the same records, with their titles and matched text, still came back as hits. The sweep now asks the registry's `isObjectPackageDisabled`, the predicate the data routes ask, and passes over such an object: it is never queried, never named and never counted in `totalObjects`. An explicit `?objects=` naming it answers as one naming no object at all; search is a sweep, not a by-name read, so there is no 404 there.

An enabled object whose title is a reference to an object of a disabled package keeps the bare id as its hit title, the answer a searcher who may not read the target already gets: the title is the disabled record's data.

The fix: re-enable the package to have its records searched again. An environment with no disabled package sees no change. Published pages were already filtered, since the page sweep reads through the `/meta/page` list, which omits a disabled package's items.

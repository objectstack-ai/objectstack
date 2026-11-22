---
'@objectstack/service-analytics': patch
'@objectstack/spec': patch
---

fix(service-analytics)!: the analytics doors refuse an object of a disabled package with the data route's `404 OBJECT_PACKAGE_DISABLED`

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no page under `skills/` teaches what analytics answers for a disabled package's object; the refusal carries the data route's own sentence, which names the fix

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row, registry key or authored value changes. What moves is the answer the analytics doors give for an object whose owning package is disabled, an answer that returns to what it was the moment the package is re-enabled; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller that queries a disabled package's object through analytics. A package disable takes the package's objects off the data plane (`GET /api/v1/data/:object` answers `404 OBJECT_PACKAGE_DISABLED`), but the analytics service asked only whether an object exists and whether it is exposed, never the registry's disabled-package predicate.

- FROM: `POST /api/v1/analytics/query` (and `/analytics/sql`, and the dataset door behind dashboards and the AI dataset tools) answered `200` for a disabled package's object: an authored or inferred cube's counts and sums, its field values as group keys, and an enabled object's relationship hop into it. `GET /api/v1/analytics/meta` still listed a cube over it, and a lookup dimension's label pass still read its records' display names.
- TO: every analytics door refuses a query whose read set (the cube's base object, a declared join, or a relationship hop) holds an object of a disabled package with `404 OBJECT_PACKAGE_DISABLED`, naming the object, in the data route's words, for every caller (system included, as on the data route). A declared join counts even when the query does not use it, the same read set the exposure and permission gates already judge. `GET /api/v1/analytics/meta` leaves such a cube out (by name it answers an empty list, as for a hidden cube), and a lookup dimension's label is withheld, so the stored id renders, as the data route's `$expand` withholds the target.

**Not moved.** An enabled object queried on its own is served while another package is disabled. A registry that cannot answer the question hides nothing. Re-enabling the package serves every read again, and nothing is cached.

The error-code ledger records the code under `@objectstack/service-analytics` too (a provenance row: the set of registered codes is unchanged).

The fix for a caller: re-enable the package, or query only objects of enabled packages.

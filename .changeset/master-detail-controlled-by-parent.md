---
"@objectstack/plugin-security": minor
"@objectstack/spec": minor
"@objectstack/verify": minor
---

Master-detail "controlled by parent" permissions (ADR-0055).

A detail object can now declare `sharingModel: 'controlled_by_parent'`: its read/write access is derived from its master record, with no authored RLS.

- `@objectstack/spec`: `controlled_by_parent` added to the authorable `object.sharingModel` enum.
- `@objectstack/plugin-security`: reads inject `masterFK IN (accessible master ids)` (resolved from the master's own RLS, reusing the existing filter machinery — zero RLS-compiler changes); by-id writes (insert/update/delete) to a detail now require edit access to its master, closing the #1994-class by-id hole for derived access.
- `@objectstack/verify`: related-record **topological synthesis** — `deriveCrudCases` no longer skips objects with required relations; it builds the object dependency graph, orders it topologically, and threads real target ids, so relationship-dense objects (and the master-detail RLS proof) are verifiable. Honest `blocked` verdicts remain for required-reference cycles and external/missing targets.

v1 limits (per ADR-0055): the accessible-master id set is unbounded (large-tenant scale is a documented future limit), and master-detail chains are single-level (not transitively traversed).

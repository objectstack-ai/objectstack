---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an orphan adoption no longer makes a draft view live; an adopted draft view is rebound in storage only (ADR-0070 D5, ADR-0048)

Clause-②: no

`reassignOrphanedMetadata`, the method `POST /api/v1/packages/:id/adopt-orphans` calls, sends each rebound view row through the registry write-through so the registry follows it at once. It admitted a view row whatever its `state`. So adopting a package-less DRAFT view registered its draft body as live, stamped with the target package, until the next restart. The boot registers active rows only, so it dropped the view again. A draft adopted beside a published row of the same view replaced the published body the runtime served.

Only an active row now reaches the registry, for a view as for an object. An adopted draft view is rebound in storage only: the registry serves nothing for it until it is published, and the next boot agrees.

What stays as before:

- Which rows the adoption rebinds, the stored `state` of each, and the response (`reassignedCount`, `reassigned`).
- An adopted active view is served at its new binding at once, and an adopted active object moves its registry owner, as before.

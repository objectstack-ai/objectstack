---
'@objectstack/runtime': patch
---

fix(runtime)!: a package export refuses when the read of a metadata type the runtime serves fails, naming the package and the type, instead of answering without that type (#29760)

Clause-②: no (narrowing) — `GET /packages/:id/export` answered `200` with a type's collection missing when that type's per-package read threw; it now refuses that request, so the door answers fewer requests with a body. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: an export whose read of one type failed is refused instead of answered thinner. Nothing a metadata author wrote is read differently, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the package export door (`@objectstack/runtime`).

- **Before.** `assemblePackageManifest` caught every per-type read failure as an unknown type and skipped it. A failed read of `dashboard` (an unreadable overlay row set, a store fault) left the export `200` with every other collection and no `dashboards` key, so a reinstall from it landed without the package's dashboards and told nobody.
- **Now.** Only a type this runtime does not serve, one its live type vocabulary (`getMetaTypes`) does not list, is skipped, as before. A failed read of a type it serves refuses the export: the message names the package and the type, and the read's own declared status and code are carried (a store fault the protocol declares `503 SERVICE_UNAVAILABLE` answers `503`; an undeclared throw answers `500`). A protocol that brings no `getMetaTypes`, or whose listing cannot be read, has not shown the type unknown, so its failed read refuses too.
- **Unchanged.** An export whose reads succeed is byte-for-byte the same; a package that is not found is still `404`. The whole-deployment bundle composes this export, so a bundle entry whose read fails refuses the bundle the same way.
- **Who sees it.** A caller exporting a package while the read of one of its types fails: it was handed a thinner export with `200`, and now gets the refusal, which it can retry once the read recovers.

**The remedy.** Retry the export once the failing read recovers; the refusal names the type to look at.

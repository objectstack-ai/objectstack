---
"@objectstack/cloud-connection": patch
---

Under an organization wall, the install-local sample-data doors now refuse a session with no active organization, and the refusal names what is missing (ADR-0123 D2 / D4). Before, they skipped quietly.

Clause-②: no

- **Reseed and purge.** `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data` and `…/purge-sample-data` answer `403 PERMISSION_DENIED`, with a message saying the session has no active organization and that one must be joined or selected. Before, the reseed answered `400 RESEED_SKIPPED` (`multi-tenant-no-active-org`); the purge, which starts deleting in this same release, refuses the same way from the start. Reseed's other declines are unchanged and still answer `400 RESEED_SKIPPED`: a package with no seed datasets, a runtime with no data engine or metadata service, and a seed run that threw.
- **Install.** `POST /api/v1/marketplace/install-local` still installs the package, which is environment-wide. Its `seeded` block now reads `{ mode: "refused", reason: "…" }`, where `reason` names the missing active organization and says to select one and then reseed. Before, it read `{ mode: "skipped", reason: "multi-tenant-no-active-org" }`.
- **No organization is guessed.** The active-organization read no longer falls back to the user's first membership. ADR-0123 D1 makes "authenticated, with no active organization" a declared state. A guess would write into an organization the caller never chose. The fallback read an object no package defines, so it never resolved anything.
- **Unchanged.** A session with an active organization seeds, reseeds and purges in that organization, as before. Without a wall (`single` posture), no organization is read, and the three doors act table-wide.

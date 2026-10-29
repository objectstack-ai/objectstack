---
'@objectstack/plugin-webhooks': patch
---

fix(plugin-webhooks)!: gate webhook redelivery on webhook-administration access

Clause-②: no (narrowing) — `POST /api/v1/webhooks/redeliver` admits only a signed-in caller entitled to administer webhooks, in an organization a current membership backs on a walled posture, where it admitted every signed-in caller. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration changes, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What narrows is the set of callers one HTTP door admits; the remedy is a permission grant an administrator makes, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this change (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** accept-set narrowing at the webhook redeliver door (`@objectstack/plugin-webhooks`), on both faces: the self-hosted mount and the `webhooks` service's `handleRedeliver`. The caller's entitlement is decided server-side by the security service before the request body is read or any delivery row is looked up.

- **The entitlement.** The security service's object-level `update` admission on `sys_webhook` (`ISecurityService.explain`), for the caller's execution context as the platform's request-context composition resolves it, the same answer the data API's write gate gives that caller. The shipped administrator permission sets carry it; a member baseline does not.
- **The organization.** That context is resolved with the deployment's tenancy posture, as the data API resolves it: on a walled posture (`isolated`, `group`) a session's active-organization claim that no current membership backs is not kept, and the door answers that caller with the same `403`. The replay is scoped to the organization the caller was admitted in.
- **An unentitled caller** is answered `403 PERMISSION_DENIED`, the same answer whatever the request names, so the refusal carries no row-specific detail and nothing is replayed.
- **Fail closed.** A deployment with no security service registered, or a check that cannot be decided (including a tenancy service that is registered and cannot answer), answers `503 SERVICE_UNAVAILABLE` and replays nothing. A kernel that serves the door with no security service says so once at boot, naming the remedy.
- **Unchanged for an entitled caller:** the auth gate, `401` for no session, the `400` body refusals, the active-organization scoping (`404` outside it), the redelivery veto's `409`s and the `200` replay. The door still admits no API key.

Migration: a deployment that relied on non-administrators pressing redeliver grants them `allowEdit` on `sys_webhook` through a permission set; a caller on a walled posture switches to an organization it belongs to.

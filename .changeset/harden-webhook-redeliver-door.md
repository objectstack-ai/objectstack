---
'@objectstack/plugin-webhooks': patch
---

fix(plugin-webhooks): gate webhook redelivery on webhook-administration access

Clause-②: no
Metadata-protocol: none

`POST /api/v1/webhooks/redeliver` (both faces: the self-hosted mount and the `webhooks` service's `handleRedeliver`) now requires the signed-in caller to be entitled to administer webhooks, decided server-side by the security service before the request body is read or any delivery row is looked up:

- **The entitlement.** The security service's object-level `update` admission on `sys_webhook` (`ISecurityService.explain`), for the caller's resolved execution context, the same answer the data API's write gate gives that caller. The shipped administrator permission sets carry it; a member baseline does not.
- **An unentitled caller** is answered `403 PERMISSION_DENIED`, the same answer whatever the request names, so the refusal carries no row-specific detail and nothing is replayed.
- **Fail closed.** A deployment with no security service registered, or a check that cannot be decided, answers `503 SERVICE_UNAVAILABLE` and replays nothing.
- **Unchanged for an entitled caller:** the auth gate, `401` for no session, the `400` body refusals, the active-organization scoping (`404` outside it), the redelivery veto's `409`s and the `200` replay. The door still admits no API key.

Migration: a deployment that relied on non-administrators pressing redeliver grants them `allowEdit` on `sys_webhook` through a permission set.

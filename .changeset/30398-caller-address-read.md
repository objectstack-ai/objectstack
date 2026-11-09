---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a platform admin can read the address the allowed IP ranges save check will judge, before saving, at `GET /api/v1/auth/admin/client-address` (#30398)

Clause-②: yes (widening) — a new authenticated HTTP read on the auth mount, ledgered `server-only` in the plugin's auth route ledger; no spec schema, SDK method or package export moves.
Metadata-protocol: none

A save of `auth.allowed_ip_ranges` (ADR-0069 D5) is refused when the list leaves out the address the saving request comes from, and the refusal names that address. Until now that refusal was the only place the address appeared, so an administrator learned which address counts by being refused. The new read answers it beforehand.

- **The answer.** `200 { success: true, data: { clientAddress, trustProxy } }` with `Cache-Control: no-store`. `clientAddress` is the caller's address exactly as the save check and the sign-in gate judge it, through the same call the save check makes: the forwarded `X-Forwarded-For` / `X-Real-IP` address only when the stack declares `server.trustProxy`, the connection's peer address otherwise, in the same text (an IPv4-mapped peer reads `::ffff:127.0.0.1`, as the refusal names it). It is `null` when the server cannot establish an address; while any list is set, such a connection is refused at sign-in and any non-empty list at the save. `trustProxy` says whether forwarded headers counted.
- **Who may read it.** A platform admin, through the gate every ObjectStack `/admin/*` auth route uses: no session answers `401 UNAUTHENTICATED`, a session held by the authentication policy (an expired password, required two-factor not set up) answers `403` with that posture's code, and any other caller `403 PERMISSION_DENIED`. It is not served to anonymous callers, and `GET /api/v1/auth/config` is unchanged.
- **Closed query set.** The route takes no query parameters; any one is refused with `400 VALIDATION_ERROR`.
- **Behind the allow-list.** Like every auth route except the sign-in page's two render reads, the read is judged by the allow-list in force: a caller already outside it gets `403 IP_NOT_ALLOWED`.

The save check, the sign-in gate and the address rule are unchanged: the save check now reaches the rule through the helper the read shares, with the same inputs.

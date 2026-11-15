---
'@objectstack/plugin-auth': patch
---

fix(auth)!: the environment-access gate on `/oauth2/authorize` judges every client the request names, from the query and the body

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` and no hand-written page under `content/docs/**` teaches `oidcAuthorizeGate` or the authorize endpoint's environment-access gate.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: the change is a runtime refusal at one auth endpoint, judged by a host callback whose signature does not change, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment that sets `oidcAuthorizeGate` (the ADR-0069 D5.1 environment-access gate; open editions and self-host leave it unset). The gate on `/oauth2/authorize` now judges every client the request names: the query's `client_id` and the body's `client_id`, each a string or an array, de-duplicated ("each a string or an array" describes what the gate collects from the parsed request, not a promise that every transport accepts both forms). If any one of them is refused, the request is refused with the existing refusal: `403 ENV_ACCESS_DENIED` for a fetch or an API client, and for a browser the redirect or the readable page it already gets. A request that names no client anywhere is unchanged, and so is an unauthenticated request, which still goes on to sign in.

Who moves: only a host whose `oidcAuthorizeGate` assumes it is called at most once per request. It can now be called once for each distinct client the request names, and the first refusal ends the request. The callback's signature, `({ userId, clientId }) => boolean | Promise<boolean>`, does not change.

Unchanged: a deployment with no `oidcAuthorizeGate`; a `GET` naming one client; the passes that resume an authorization (sign-in, `/oauth2/consent`, `/oauth2/continue`), which the gate already judged; and the refusal's code, status, message and delivery.

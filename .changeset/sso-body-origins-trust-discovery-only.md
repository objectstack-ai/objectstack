---
'@objectstack/plugin-auth': patch
---

fix(auth)!: an origin an SSO register or update body names is trusted for that provider's discovery only, never as the request's `Origin`

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches trusted origins or SSO provider registration; `content/docs/permissions/sso.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: the change is which origins one request's origin check accepts, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment with the SSO relying party wired (`OS_SSO_ENABLED` / `plugins.sso`). An origin taken from a `POST /sso/register` or `POST /sso/update-provider` body (its `issuer` and any explicit `oidcConfig` endpoint) is trusted only for the server-side discovery fetch and validation of that provider. It never becomes an accepted `Origin` for the request itself: that request's origin check reads the deployment's configured trusted origins alone, as on any other POST, and a request whose `Origin` is not one of them is refused `403 INVALID_ORIGIN` and writes nothing. The auth instance's `trustedOrigins` option is now the configured list with the SSO relying party wired too, never a per-request function.

Who moves: only a client that registers or updates an SSO provider from a browser page served on an origin the deployment does not trust. Send the request from a configured origin (the Console, or a server-side call), or add that page's origin to the deployment's trusted origins (`trustedOrigins`, `OS_CORS_ORIGIN`).

Unchanged: a registration from a configured origin still discovers and registers an identity provider whose issuer and named endpoints are on hosts the deployment does not list; Microsoft Entra ID's companion origin; the `discovery_untrusted_origin` refusal and its remedy; an update from a configured origin; and every other request.

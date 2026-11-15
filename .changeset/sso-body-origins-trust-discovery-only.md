---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: an origin an SSO register or update body names is trusted for that provider's discovery only, never as the request's `Origin`

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches trusted origins or SSO provider registration; `content/docs/permissions/sso.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: the change is which origins one request's origin check accepts, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment with the SSO relying party wired (`OS_SSO_ENABLED` / `plugins.sso`). An origin taken from a `POST /sso/register` or `POST /sso/update-provider` body (its `issuer` and any explicit `oidcConfig` endpoint) is trusted only for the server-side discovery fetch and validation of that provider. It never becomes an accepted `Origin` for the request itself: that request's origin check reads the deployment's configured trusted origins alone, as on any other POST, and a request whose `Origin` is not one of them is refused `403 INVALID_ORIGIN` and writes nothing. The auth instance's `trustedOrigins` option is now the configured list with the SSO relying party wired too, never a per-request function.

Who moves: a client that registers or updates an SSO provider from a browser page served on an origin the deployment does not trust. Send the request from a configured origin (the Console, or a server-side call), or add that page's origin to the deployment's trusted origins (`OS_TRUSTED_ORIGINS`, or the auth plugin's `trustedOrigins` option).

Who moves, too: a registration or an update that turns "sign out of the company sign-in too" on (`signOutOfIdp`) for an OpenID Connect identity provider on a private network. The origins that request names are trusted for the verdict on the provider's logout endpoint only; the discovery document read to find that endpoint is held to the deployment's configured trusted origins, so such a provider's switch is refused `400 VALIDATION_FAILED` on `signOutOfIdp` until its origin is listed there: add it to `OS_TRUSTED_ORIGINS` (or the auth plugin's `trustedOrigins` option), as `content/docs/permissions/sso.mdx` says.

Unchanged, for a request from a configured origin: a registration still discovers and registers an identity provider whose issuer and named endpoints are on hosts the deployment does not list; a registration or an update that turns "sign out of the company sign-in too" on (`signOutOfIdp`) for a publicly reachable identity provider still accepts a logout endpoint on an origin that request names; an update still validates and saves the endpoints it names. Also unchanged: Microsoft Entra ID's companion origin, the `discovery_untrusted_origin` refusal and its remedy, and every other request.

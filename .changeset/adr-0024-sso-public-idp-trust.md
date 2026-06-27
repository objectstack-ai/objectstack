---
'@objectstack/plugin-auth': patch
---

Auth: trust public-routable external-IdP origins at SSO registration (ADR-0024 / cloud#551)

`@better-auth/sso`'s discovery validation requires every IdP endpoint origin to be in `trustedOrigins` — even for a publicly-routable IdP. That broke ADR-0024's "register your OIDC IdP at runtime, no boot config" promise: registering any external IdP returned `400 discovery_untrusted_origin` unless the operator had pre-listed it.

When the external-SSO RP is enabled, `trustedOrigins` is now exposed as a per-request function that, for a `POST /sso/register` | `/sso/update-provider`, additionally trusts the **public-routable** issuer / `oidcConfig` endpoint origins declared in the request body (via `@better-auth/core`'s own `isPublicRoutableHost`). Private / internal / loopback hosts are never auto-trusted — they still require explicit `trustedOrigins` config (the documented SSRF escape hatch), and better-auth's own DNS-resolution checks still apply.

Verified: a same-origin public IdP (GitLab.com — issuer and all discovered endpoints on one origin, like Okta / Entra / Auth0 / Keycloak) now registers at runtime with no boot config (was a hard 400). The admin gate still fires first (a non-admin is rejected before discovery runs). Note: IdPs that split endpoints across multiple domains (e.g. Google's `accounts.google.com` + `oauth2.googleapis.com`) still need those extra origins in `trustedOrigins`.

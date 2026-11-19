---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: SSO discovery fetches only hosts that resolve to public addresses

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is one runtime answer of the SSO provider register door: a registration whose discovery document sits on a host that resolves to an address that is not public, on an origin the deployment's trusted origins do not list, is refused before anything is read. No stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for an SSO provider registration (`POST /api/v1/auth/sso/register`, or the Register SSO Provider bridge `POST /api/v1/auth/admin/sso/register`) whose OpenID Connect discovery document sits on a host that resolves to a private, loopback, link-local or otherwise non-public address, on an origin `OS_TRUSTED_ORIGINS` does not list: it is refused `400 VALIDATION_FAILED` on `issuer` (or on `oidcConfig.discoveryEndpoint` when the registration names one), and the bridge answers `400 SSO_REGISTER_FAILED`. It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3): no metadata author writes an SSO provider registration, so `Metadata-protocol` is `none`.

SSO discovery fetches only hosts that resolve to public addresses. Before a registration reads its discovery document, the server resolves that document's host and every address must be public (the same predicate `@better-auth/sso` applies to the endpoints it reads at sign-in). The origins a registration names stay trusted for that registration's discovery checks, as before; that trust never stands in for this one. A registration that reads no discovery document (a SAML provider, or `skipDiscovery`) resolves nothing, and a registration with no session is answered `401` before any name is resolved.

Fix for an operator whose identity provider runs on an internal network: list its origin in `OS_TRUSTED_ORIGINS`, and the registration reads its discovery document as before.

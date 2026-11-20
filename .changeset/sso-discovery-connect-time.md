---
'@objectstack/plugin-auth': patch
'@objectstack/core': patch
---

fix(plugin-auth)!: SSO discovery connects only to addresses that are public at connect time

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. What moves is runtime answers of the SSO doors: a read of an identity provider's OpenID Connect configuration is sent only to an address that is public when the connection is made, unless the deployment's trusted origins list its origin. `AuthManagerOptions` gains one optional member and the guarded fetch's init one optional member; nothing stored, no registry key and no authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for an identity provider whose OpenID Connect host resolves to a private, loopback, link-local, cloud metadata or host-platform address (`168.63.129.16` included), or to any other non-public address, on an origin `OS_TRUSTED_ORIGINS` does not list, at the moment the server reads it: a registration (`POST /api/v1/auth/sso/register`, or the Register SSO Provider bridge) is refused `400 VALIDATION_FAILED` on `issuer` (or on `oidcConfig.discoveryEndpoint` when the registration names one), an update that turns "sign out of the company sign-in too" on is refused `400 VALIDATION_FAILED` on `signOutOfIdp`, and a sign-in's callback ends on the error page with `invalid_provider`. It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3): no metadata author writes an SSO provider, so `Metadata-protocol` is `none`.

SSO discovery connects only to addresses that are public at connect time. Every read the server makes of an identity provider (a registration's discovery document, the sign-out switch's read of that document on a registration or an update, a sign-in's discovery, and the token, key-set and userinfo reads of a sign-in's callback) is sent through the platform's outbound-request guard (`@objectstack/core/egress`): the connection resolves the host, judges every address by the platform's address classes, and connects to an address it judged, so the address judged is the address connected. A host that is not public is refused and nothing is sent to it, whatever an earlier lookup of the same name answered, and so is a name that does not resolve when the read connects. Only reads at the origins the provider's configuration names are judged (the registration's body, or the provider row the sign-in reads): every other request the server makes while answering, such as a datastore or a rate-limit store reached over HTTP, is sent as before. A registration still judges its discovery host before reading it, now by the same rule and the same address classes, an address literal included; a name that does not resolve there is left to the read, which refuses it. The origins a registration names stay trusted for that registration's discovery checks only, and `OS_EGRESS_ALLOWED_TARGETS` does not open SSO discovery.

`@objectstack/core`: the guarded fetch's init takes fetch's `redirect` mode; `manual` answers a redirect response as it is and follows nothing, for a caller that refuses redirects itself.

Fix for an operator whose identity provider runs on an internal network: list its origin in `OS_TRUSTED_ORIGINS`, and its reads are sent as before.

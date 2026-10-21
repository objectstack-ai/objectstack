---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
'@objectstack/service-datasource': patch
---

fix(plugin-auth)!: lift the better-auth family from 1.7.3 to 1.7.12 for the security fixes published since

`@objectstack/plugin-auth` declares the better-auth family exactly, so a fresh install resolves what this package tested. All five declared ranges (`better-auth`, `@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/scim`, `@better-auth/sso`) move from `1.7.3` to `1.7.12`, still exact. The lift takes the fixes published in 1.7.4 to 1.7.12 for packages this plugin mounts: GHSA-965c-763c-88jm and GHSA-r4xp-prcw-77qf (1.7.7), and the oauth-provider, SSO, SCIM, JWT and password-reset fixes up to 1.7.12. Every symbol this package imports from the family is still exported. It also pulls in `better-call` 1.4.4, `@better-auth/utils` 0.5.0 and `@better-fetch/fetch` 1.3.2, the versions 1.7.12 declares.

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration of this package is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the vendor library under the auth endpoints: some requests it accepted are now refused, and some refusals change status. The remedies are operational (restart an in-flight sign-in, correct an SSO provider's issuer), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the auth endpoints refuse some requests 1.7.3 accepted, and some refusals change status), shipped as `patch` under ruling A: it changes nothing a metadata author can write, and a non-protocol breaking change ships `patch` while keeping this BREAKING banner and its ADR-0087 disposition.

- **FROM:** a Magic Link, OAuth or social sign-in, SAML or account-linking flow started before the upgrade could complete after it.
  **TO:** it fails, and the user starts it again. 1.7.7 stores Magic Link and OAuth-state verification rows under new identifier prefixes and keys the OAuth state cookie per purpose, so a link or a pending identity-provider round-trip minted by 1.7.3 is not found: a Magic Link answers `?error=INVALID_TOKEN`, an OAuth callback answers a state mismatch.
- **FROM:** an OIDC SSO provider whose configured issuer differed from its discovery document's `issuer`, for example only by a trailing slash, signed users in.
  **TO:** the provider is refused with `issuer_mismatch`. 1.7.12 also refuses an OIDC ID token that carries no `exp` or `iat`.
- **FROM:** `POST /api/v1/auth/oauth2/token` with a PKCE `code_verifier` that does not match the challenge answered `401`.
  **TO:** it answers `400` with `error: 'invalid_grant'`.
- **FROM:** `GET /api/v1/auth/get-session` answered `401 UNAUTHENTICATED` ("Sign in first") when the session store could not be read, the same answer a signed-out browser gets, and an in-process `api.getSession` resolved `null`.
  **TO:** it answers `500` with `code: 'FAILED_TO_GET_SESSION'` and keeps the session cookie, and the in-process read rejects. Callers that treat a failed read as anonymous on purpose (the request-context resolution in `@objectstack/core` and `@objectstack/runtime`) still do.
- **FROM:** `POST /api/v1/auth/sign-in/email` with a password longer than the configured maximum answered as an ordinary failed sign-in.
  **TO:** it answers `400` with `code: 'PASSWORD_TOO_LONG'` before any account is looked up. It still counts as a failed attempt for the account lockout.
- **FROM:** a DPoP proof sent to the token endpoint was checked against the URL of the request as it reached the server.
  **TO:** it is checked against the configured public base URL plus the request path. Behind a proxy that rewrites the host, a proof bound to the public URL is now accepted and a proof bound to the internal URL is refused with `invalid_dpop_proof`.
- **FROM:** `GET /api/v1/auth/get-session` with a cookie for a session that no longer exists answered `401` and left the cookie in place.
  **TO:** the same `401` also clears the stale session cookies.
- **New route:** `POST /api/v1/auth/oauth2/client/rotate-keys` (`private_key_jwt` key rotation) is now published, and refused with `403 access_denied` because this package does not enable client key rotation.
- **Unchanged:** the package's exports and configuration; sign-up, sign-in and session cookies (`HttpOnly; SameSite=Lax; Path=/`, no `Secure` on plain HTTP); the active organization stamped on a new session; implicit account linking and its unlink records; single-use reservations (a replayed DPoP proof or client assertion is still refused); and where sessions and verification values are stored with or without a host `secondaryStorage`.
- **`@objectstack/spec` and `@objectstack/cli` (patch, text only, not breaking):** the TSDoc on the organization schema's optional `updatedAt` now records that its better-auth measurement still holds on 1.7.12, and the `os migrate account-issuer` description no longer names a better-auth version. No schema, type, flag or behaviour changes in either package.
- **`@objectstack/service-datasource` (patch, text only, not breaking):** the `resolveSqliteDriver` docs now describe the error better-sqlite3 13 actually throws for an addon that was never built: its loader's `require()` of the absent `build/Release/better_sqlite3.node`, which Node answers with `MODULE_NOT_FOUND`. The docs used to name a helper package's message that 13.x no longer produces. Development still steps down to wasm SQLite on that error, as before. No code changes.
- **What to do as an operator:** tell users that a Magic Link, social, SSO or account-linking sign-in begun before the upgrade must be started again after it. Check each OIDC SSO provider's configured issuer against its discovery document and set it to the exact `issuer` string the document publishes. An OAuth client that branched on `401` for a PKCE failure should branch on `400 invalid_grant`. A browser client that read every non-`200` `/get-session` answer as "signed out" should treat a `500` as "try again".

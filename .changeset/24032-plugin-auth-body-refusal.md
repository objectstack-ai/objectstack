---
'@objectstack/plugin-auth': minor
---

Clause-②: no (narrowing)

fix(plugin-auth)!: nine of this package's own routes refuse a declared JSON body that does not parse with `400 INVALID_REQUEST`, instead of answering as if no body was sent

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, no stored row is rewritten or deleted, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of nine of this package's own routes, and of the exported bridges six of them mount, for one input: a body declared as JSON that does not parse, which used to be read as no body. The remedy is in the requests a client sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed, every signature is unchanged (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

These routes read their bodies as `try { body = await request.json() } catch { body = {} }`, so a truncated body was answered as if the client had sent none:

- `POST /api/v1/auth/admin/oauth2/toggle-disabled`, `/admin/unlock-user` and `/sys-oauth-application/register`;
- `POST /api/v1/auth/admin/import-users`;
- `POST /api/v1/auth/admin/sso/register`, `/admin/sso/register-saml`, `/admin/sso/request-domain-verification` and `/admin/sso/verify-domain`;
- `POST /api/v1/auth/send-verification-email`.

`/admin/unlock-user` answered `400 "userId is required"` for a body that carried `userId` and lacked its closing brace. `/send-verification-email` read the same input as the one-click resend, and sent the link to the caller's own address for a body that named another one.

What changes for an integrator. A body sent as `application/json` (matched case-insensitively) that is not blank and does not parse: FROM the route's answer for an empty body, TO `400` with `{ "success": false, "error": { "code": "INVALID_REQUEST", "message": "The request body could not be parsed as JSON (it was sent as application/json). It was refused rather than read as an empty body: send a well-formed JSON document, or no body at all." } }`, the answer the HTTP transports give the same body. A declared JSON body whose stream cannot be read is refused with the same code and "The request body could not be read. It was refused rather than read as an empty body." Each route refuses where it reads its body: the identity import and the four SSO bridges after their platform-admin gate, the other four before anything else runs. Nothing is looked up, written, sent or forwarded to better-auth.

The exported bridges six of these routes mount (`runAdminImportUsers`, `runRegisterSsoProviderFromForm`, `runRegisterSamlProviderFromForm`, `runRequestDomainVerification`, `runVerifyDomain` and `runResendVerificationEmail`) answer the same refusal, so a host that mounts them itself refuses it too.

**Remedy, in one line.** Send a JSON body as well-formed JSON with `Content-Type: application/json`, or send no body.

**Unchanged.** An empty body (no body at all, a zero-byte one, or whitespace only) is still no body, and every route answers it as before: `/admin/unlock-user` with `400 "userId is required"`, and `/send-verification-email` as the one-click resend to the caller's own address. A body that parses is read as before, whatever its `Content-Type`, and a body that does not declare JSON and does not parse is still read as no body.

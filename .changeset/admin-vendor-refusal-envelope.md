---
"@objectstack/plugin-auth": minor
---

fix(plugin-auth): the better-auth-native `/admin/` routes refuse an anonymous caller with the ADR-0112 envelope (#10349)

**BREAKING** response-shape change on the `/api/v1/auth/admin/` namespace,
shipped as `minor` under the repo's launch-window convention for breaking
changes.

`/api/v1/auth/admin/` is served by two implementations and answered the same
question in two shapes. ObjectStack's raw mounts (`create-user`,
`set-user-password`, `unlock-user`, `import-users`, `ban-user`, `unban-user`,
`oauth2/toggle-disabled`, `sso/*`) refuse an anonymous caller through
`judgePlatformAdmin` with the declared envelope and `code: 'UNAUTHENTICATED'`.
The routes better-auth serves itself refuse through the vendor's
`adminMiddleware` — `getAuthoritativeSessionFromCtx(ctx)` then
`APIError.fromStatus('UNAUTHORIZED')`, with no body argument at all.

Measured on the installed better-auth 1.7.1, anonymous, through
`AuthManager.handleRequest`: ten vendor-lane routes (`impersonate-user`,
`set-role`, `revoke-user-sessions`, `revoke-user-session`,
`list-user-sessions`, `update-user`, `list-users`, `get-user`,
`has-permission`, `stop-impersonating`) answered `401` with a
`content-type: application/json` header and the **empty string** as the body.
A client that believes that header and parses the body throws on the refusal
instead of branching on it, and a client that wants to branch has to know, per
route, which of the two implementations happens to serve it — an
implementation detail, not a contract.

`AuthManager.handleRequest` now gives those refusals the declared envelope at
the one seam every vendor route passes through. **Statuses are unchanged and
admission is unchanged**: nothing that was refused is now admitted, nothing
that was admitted is now refused, and no status moved. What is added is the
machine-readable `code`, derived from the status by ADR-0112's own
`standardErrorCodeForHttpStatus` map rather than spelled out again — so no new
error code is registered and the vendor lane's anonymous refusal is now
byte-identical to the ObjectStack lane's.

Scope is the `/admin/` namespace only. Three narrowings hold the rest of the
surface still, and each is pinned:

- **A refusal that already carried a body keeps it, byte for byte.** The
  signed-in non-admin's `403` with the vendor's own
  `YOU_ARE_NOT_ALLOWED_TO_*` vocabulary is untouched; this change fills in an
  empty body and never rewrites a spoken one.
- **Only the two refusal statuses are named** (`401`, `403`). A bodyless `404`
  such as `/admin/oauth2/*` with the `oidcProvider` plugin off, and any
  semantic `4xx` the vendor owns, are left exactly as they are.
- **Nothing outside `/admin/` is touched.** `POST /sign-in/email` still answers
  `401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}`,
  measured identical on both sides of the change.

Consumers that branch on the HTTP status are unaffected. Consumers that already
parse the ObjectStack `/admin/*` envelope now get the same shape everywhere in
the namespace, with no per-route knowledge required.

<!-- adr-0087: not-required (no-migration-prescription) nothing is removed, renamed or narrowed: a refusal that carried an empty body under an `application/json` header now carries the declared envelope at the same status. No consumer expression has to be rewritten — a status branch keeps working unchanged, and an envelope branch that only ever matched the ObjectStack lane now also matches the vendor lane. There is no old spelling to migrate off, so there is nothing for `os migrate meta` to rewrite and no ADR-0087 ledger entry to make. -->

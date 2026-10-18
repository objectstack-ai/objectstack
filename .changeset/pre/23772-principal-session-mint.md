---
'@objectstack/spec': minor
'@objectstack/plugin-auth': minor
---

feat(spec,plugin-auth): a short-lived principal-session mint, `IAuthService.mintPrincipalSession`, implemented by `AuthManager`

Clause-②: yes (widening)

An in-process service can now act as the requesting user through a door that only accepts a session, such as a headless browser rendering a page the user may see, under the user's own principal and never a system one. Nothing is removed and no HTTP route is added.

- **`@objectstack/spec`** (`contracts`): an optional `IAuthService` member, `mintPrincipalSession(context, options?)`, its types `PrincipalSession`, `PrincipalSessionCookie` and `PrincipalSessionMintOptions`, and the constant `PRINCIPAL_SESSION_MAX_TTL_SECONDS` (`120`). The member is optional, so every existing `IAuthService` implementation compiles unchanged.
- **`@objectstack/plugin-auth`**: `AuthManager.mintPrincipalSession(context, options?)`.

What the mint guarantees:

- **Human principals only, refused before anything is minted.** A context with no user, a system context, or a `principalKind` other than `human` gets `PERMISSION_DENIED` / `403`. So does a user row that is missing, the system user or banned. A user an authentication policy holds gets `403` with the policy's own code (`MFA_REQUIRED`, `PASSWORD_EXPIRED`, `PASSWORD_RESET_REQUIRED`), whether the posture rides on the context or is computed at the call. A `ttlSeconds` outside 1 to 120 gets `VALIDATION_ERROR` / `400`: it is refused, never clamped.
- **Short and never renewed.** The session lives at most 120 seconds. Reading it never extends it, on the cookie lane, the bearer lane or the in-process session read alike.
- **Revocable.** `revoke()` ends the session. Afterwards neither the token nor the cookie resolves one. It is bound to that session alone and safe to call twice, so call it in a `finally`.
- **The deployment's own cookie.** The cookie carries the name and attributes of the plugin's session cookie, the cookie prefix and, on a secure deployment, `__Secure-` included. The session's active organization is the context's `tenantId`.

```ts
const auth = ctx.getService<IAuthService>('auth');
const session = await auth.mintPrincipalSession?.(context, { ttlSeconds: 60 });
try {
  // send session.token as `Authorization: Bearer`, or set session.cookie in a browser
} finally {
  await session?.revoke();
}
```

---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): impersonation actually takes effect for bearer clients — rotate the caller's token, and let `stop-impersonating` recover the admin via bearer (#8243)

`POST /api/v1/auth/admin/impersonate-user` answered **HTTP 200 and did nothing**
for every bearer-authenticated client — the console after every normal sign-in,
and every deployment where cookies are blocked, which is the exact context
better-auth's `bearer()` plugin exists for.

Two correct pieces of better-auth collided. `bearer()` authenticates a request by
**overwriting the request's session cookie** with the bearer token. The admin
plugin's impersonation route does the opposite: it mints the impersonation
session and hands it over **as a cookie**, parking the admin's own session token
in a signed `admin_session` cookie for the way back. A browser composes those
two; a bearer client cannot. The client kept replaying its unchanged
`Authorization: Bearer` header, that header kept being converted back into the
**admin's** session, and the impersonation cookie was never read.

Nothing reported this. The endpoint returned success, an impersonation session
row existed, and every subsequent request — including every write, since the
framework's data routes resolve identity through the same seam — was attributed
to the **admin** rather than the impersonated user.

**Impersonation now rotates the caller's credential.** When the caller
authenticated with a bearer, the token it holds is invalidated as part of
impersonating: a rotated admin session is minted, the caller is handed it as a
recovery credential, and the original admin session is deleted. Afterwards the
only token that resolves is the impersonated one better-auth already emits on
`set-auth-token`. A client that adopts the rotation is the impersonated
principal; a client that ignores it gets a loud 401 on its next request.
"Impersonation succeeded but did not take effect" is no longer expressible.

Refusing bearer-authenticated impersonation was considered and rejected: it
would leave cookie-blocked deployments unable to impersonate at all.

**The exit path ships with it.** `POST /admin/stop-impersonating` resolved the
admin through the `admin_session` **cookie alone**, so it was dead in precisely
the deployments this fix is about. The recovery credential is now emitted on a
`set-admin-session-token` response header (exposed via
`Access-Control-Expose-Headers`, alongside `set-auth-token`) and accepted back on
an `x-admin-session-token` request header. Clients that already work through
cookies need no change: a real `admin_session` cookie still wins, and the vendor
route's own checks all still run — this adds a lane, it does not open one.

For API clients, the flow is the same one `set-auth-token` already asks for:
read both headers off the impersonation response, send `Authorization: Bearer`
with the new token, and send the recovery credential back on
`x-admin-session-token` when leaving impersonation.

Unaffected: cookie-authenticated impersonation, which is unchanged byte for
byte — a browser caller has no stale credential in hand to invalidate.

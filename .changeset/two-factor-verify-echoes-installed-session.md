---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): a 2FA verification echoes the session it INSTALLED, not the one it deleted (#10701)

`POST /api/v1/auth/two-factor/verify-totp` answered `200` with two credentials
that disagreed. The `Set-Cookie` named the caller's new session; the JSON
`token` named a session row the same request had just deleted.

The cause is upstream and mechanical. better-auth's `verifyTwoFactor` helper
resolves the caller's session once, at entry, and closes over it:

```js
valid: async (ctx) => ctx.json({ token: session.session.token, ... })
```

On the enrolment lane — a signed-in user confirming a new TOTP factor — the
route rotates that session before it answers: it mints a new session, installs
it with `setSessionCookie`, and deletes the caller's original session row. Only
then does it call `valid(ctx)`, which still holds the pre-rotation session and
echoes the token of the row that no longer exists. (Measured on the installed
better-auth 1.7.1: `dist/plugins/two-factor/verify-two-factor.mjs` and
`dist/plugins/two-factor/totp/index.mjs`.)

Every other auth response in this repo echoes `token` as the unsigned token of
a live session, and `bearer()` accepts exactly that — presented without a
signature it signs the value itself before verifying. Measured on
`/sign-up/email`, the body's `token` resolves to the user as a bearer. So a
client following that contract after enrolling in 2FA stored a revoked token.

That did not merely fail to authenticate. `bearer()`'s before-hook OVERWRITES
the request's session cookie with whatever the `Authorization` header carries,
so a request presenting the still-valid rotated cookie *and* the dead token
resolved to nobody. Measured before the fix, on one enrolment: the cookie alone
resolved to the user (`get-totp-uri` `200`); the echoed token alone resolved to
nobody (`get-session` `200` and empty, `get-totp-uri` `401`); and the two
together also resolved to nobody (`401`). Fail-closed — no privilege was
available to gain — but a legitimate user was locked out of a session they
still held, which is the point of the report.

The echoed value is now read back out of the response's own session cookie, so
the `token` names the session the response actually installed. This restores
the contract rather than changing it: the field keeps its shape (the unsigned
session token) and its meaning ("the session you now hold"), and only the value
moves, from a deleted row to the live one. Shipped as `patch` for that reason —
no consumer expression has to be rewritten, and the previous value was not a
usable credential for anything, so nothing could have depended on it.

The repair is keyed on the mechanism, not on the enrolment branch: it applies
only when the response staged a session cookie whose token differs from the one
being echoed. On the sign-in-challenge lane, where the route mints the session
it echoes, the two agree and this is a no-op — pinned, along with the cookie
lane, so that fixing the broken lane could not quietly rewrite the others.
`/two-factor/verify-otp` carries the byte-identical rotate-then-answer block and
is covered by the same guard; `/two-factor/verify-backup-code` does not rotate
and is unaffected.

Resolver precedence is deliberately untouched. Having the resolver fall back to
the cookie when a bearer is unusable was the other repair direction named in the
report, and it was ruled out of scope: it would stop an invalid credential from
failing loud. Two pins hold that line — anonymous is still refused, and a bogus
bearer still overrides a valid cookie and still fails closed — so an attempt to
loosen the resolver later reddens this suite instead of passing it.

---
"@objectstack/plugin-auth": patch
---

`POST /api/v1/auth/two-factor/enable` no longer leaves `sys_two_factor.verified`
describing the enrollment *before* the secret it stores.

better-auth's enable handler computes the row it writes as
`verified: existingTwoFactor != null && existingTwoFactor.verified === true`
(measured on the installed 1.7.1, `dist/plugins/two-factor/index.mjs`), and
`sys_two_factor` declares `user_id` unique — so a second `enable` on an account
that already has a confirmed factor rewrites that one row with a brand-new
secret while inheriting the old enrollment's flag. The flag then said
"user-confirmed" about a secret nobody had ever confirmed, and the sign-in
challenge honoured it.

The vendor already gates the challenge on that flag, in both places it matters:
`totp/index.mjs` refuses an unconfirmed factor with `TOTP_NOT_ENABLED` before
any lockout bookkeeping, and the post-sign-in hook offers `totp` among
`twoFactorMethods` only when the flag is not `false`. That gate is exactly what
a *first* enrollment relies on. Re-enrollment was the one path that slipped past
it — not because the gate was missing, but because the value handed to it was
inherited. So the fix restores the flag rather than adding a second gate:
after a successful `method: 'totp'` enable, `verified` is set to `false`, and
the freshly issued secret becomes live only once the caller proves possession of
it through `/two-factor/verify-totp`.

This is a tightening. The request body, the response shape and the status are
unchanged, a first-time enrollment is unaffected (better-auth already wrote
`false` there), and a rotation is still reachable and still completes — it now
takes the same confirmation step a first enrollment takes. What changes is that
a secret the endpoint hands out is no longer accepted at the next sign-in until
it has been confirmed. Clients that re-enroll and then rely on the new
authenticator working immediately at sign-in must call `/two-factor/verify-totp`
with the live session first, which is the flow first-time enrollment already
uses.

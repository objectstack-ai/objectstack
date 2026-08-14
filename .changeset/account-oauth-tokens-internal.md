---
"@objectstack/platform-objects": patch
"@objectstack/plugin-auth": patch
---

fix(security): `sys_account`'s OAuth access/refresh/id tokens stop serializing on the data API — `internal: true`, with better-auth's readback seam widened to cover them (#7987)

<!-- adr-0087: not-required (no-migration-prescription) Three field-level flags
added to one existing declaration, plus a rename and a widening of a
plugin-internal helper module (`session-token-readback.ts` →
`internal-field-readback.ts`, not an exported surface of the package). Nothing
authorable is renamed, retired or tombstoned, so there is no conversion to
register. The behavioural change is that three columns holding someone else's
live bearer credentials stop being returned on the generic data path, while
better-auth's own token routes keep working. -->

`sys_account.access_token`, `.refresh_token` and `.id_token` hold each user's
**live third-party OAuth credentials** — the tokens ObjectStack received from
Google, GitHub or an OIDC IdP — in cleartext (better-auth's
`account.encryptOAuthTokens` is not set, so `setTokenUtil` stores them
verbatim). They were plain `Field.textarea` on an object declaring
`apiEnabled: true, apiMethods: ['get','list']`.

**Both personas were measured leaking, on a real booted stack** (`bootStack(showcaseStack)`,
in-process HTTP + sqlite-wasm), with a planted token on a member's account row:

- **admin**, `GET /data/sys_account/{another user's account id}` — 200, that
  member's `refresh_token` verbatim, plus `access_token` and `id_token`;
- **member**, `GET /data/sys_account` (self-scoped by the `sys_account_self` RLS
  policy) — 200, their **own** `refresh_token` verbatim.

The member arm is the one this object does not share with its `sys_session`
sibling (#7823), and it is the sharper of the two: it converts a short-lived,
revocable ObjectStack session bearer into a **long-lived third-party refresh
token that this platform cannot revoke at all**. Neither collector reached these
columns — the engine's credential mask collects by field TYPE (`textarea` is
neither `secret` nor `password`) *and* exempts objects with
`managedBy: 'better-auth'`, which this object is.

**The fix is three declarations plus one widening**, inheriting #7823's shape
rather than inventing a second mechanism:

- the three columns are declared `internal: true` — the opt-in, type-independent
  flag minted by #7728 meaning *the declared value is never returned on the
  generic data path*. Storage, filtering and indexing are untouched: the strip
  runs on rows the driver has already produced.
- better-auth **reads these back off adapter result rows** — measured, and the
  risk this card was parked on: `internalAdapter.findAccounts(userId)` issues a
  `findMany` with no projection, and `/get-access-token`, `/account-info` and
  `/refresh-token` then read `account.refreshToken` / `.accessToken` /
  `.idToken` off those rows. The read strip alone would answer
  `REFRESH_TOKEN_NOT_FOUND` (400) and hand back an empty access token. So the
  existing readback seam in `@objectstack/plugin-auth` — which already recovered
  `sys_session.token` through `Engine.resolveInternalField` (#8118's privileged
  batch accessor) — is widened to cover these three columns and renamed
  accordingly. No engine carve-out, no second accessor.

**Not retyped, deliberately.** `Field.secret()` would route better-auth's own
writes through the engine's encrypt-on-write path, placing the engine between
better-auth and its own adapter. `Field.password()` is inert here for the two
reasons above.

**`password` / `previous_password_hashes` are deliberately out of scope** —
they are better-auth one-way hashes (ADR-0100's third channel), not reversible
outbound credentials, and the readback seam refuses to touch them.

The regression proof drives both directions: the fixture PLANTS real token
values and re-reads them out of storage through the privileged accessor before
asserting anything (so "absent from the response" cannot pass vacuously), then
pins that the values are still on disk, still usable as a server-side predicate,
and that password sign-in — which reads a `sys_account` row back through the
same seam on every request — still works.

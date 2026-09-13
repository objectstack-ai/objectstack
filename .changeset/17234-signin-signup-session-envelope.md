---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): `/sign-in/email` and `/sign-up/email` now attach the `session` their declared `SessionResponse` envelope requires (#17234)

Both routes answered `{ token, user }` (`/sign-in/email` also carries
`redirect`) with no `session` member anywhere in the body or the response
headers, so `SessionResponseSchema.safeParse` on `auth.login()` / `auth.register()`'s
return value always reported a `data.session` issue — the second of two
departures measured on #17234 (`success` was closed in the previous round).

**The fix is a read, never an invention.** better-auth stores sessions in the
database by default and `internalAdapter.createSession` is awaited to
completion — including the write — before either endpoint returns its
`{ token, user }` body (measured against the installed `better-auth@1.7.3`,
`dist/db/internal-adapter.mjs:247-319`). So the row the response's own `token`
names is already committed by the time this repo's global `after` hook runs.
The fix reads it back through `internalAdapter.findSession(token)` — the exact
seam `/get-session` already uses for `data.session` — and attaches it. No id or
expiry is ever fabricated; a read that fails for any reason (no
`internalAdapter`, no row, any error) leaves the response exactly as
better-auth wrote it.

```
FROM  POST /api/v1/auth/sign-in/email -> 200 { redirect, token, user }
TO    POST /api/v1/auth/sign-in/email -> 200 { redirect, token, user, session }

FROM  POST /api/v1/auth/sign-up/email -> 200 { token, user }
TO    POST /api/v1/auth/sign-up/email -> 200 { token, user, session }
```

`session` is the SAME row a following `/get-session` call reads (same `id`,
same `expiresAt`, same `userId`) — one row read twice, not two arrangements —
and `session.token` is the same UNSIGNED credential the body already carried
at `token` / `data.token`, not a second credential this fix introduces.

⛔ **No wire byte moves on any other member.** `token`, `user`, `redirect` are
byte-identical; `data.token` and the client's auto-`this.token = data.token`
are unchanged and pinned. `auth.me()` / `auth.refreshToken()` (`/get-session`,
#16760) are untouched — this change is scoped to the two credential-issuing
routes.

This is additive on an already-declared field — `SessionResponseSchema.data.session`
existed in `@objectstack/spec` before this card; the two routes simply did not
serve it. No schema changes, no new exported symbol, no new key on any
published payload.

---
"@objectstack/plugin-auth": minor
---

fix(plugin-auth)!: `GET /api/v1/auth/get-session` refuses an anonymous caller with `401 UNAUTHENTICATED` instead of `200 null` (#17238)

**Observable behaviour change on a published endpoint.** An unauthenticated
`GET /api/v1/auth/get-session` used to answer **HTTP 200 with the literal JSON
`null`**. It now answers the platform's standard ADR-0112 failure envelope:

```
before:  200  null
after:   401  {"success":false,"error":{"code":"UNAUTHENTICATED","message":"Sign in first"}}
```

A caller that branches on the `null` body will not see one any more, and a
caller that treats every 2xx as "the session read succeeded" now sees a 4xx.

## Why the code moved and not the schema

`ObjectStackClient.auth.me()` declares `Promise<SessionResponse>`, and
`SessionResponseSchema` requires `data.session` and `data.user` — so no value
of that type means "nobody is signed in", and the most ordinary call a
logged-out caller can make resolved to something outside the method's own
declared type. Ruled B by the director seat (decision batch #117 item 4):
「spec 与代码不一致默认改代码,改协议单独立卡非选项」. `SessionResponseSchema`
is untouched; the implementation is corrected to it.

⇒ Every value `auth.me()` **returns** is now inside `SessionResponse`. The
anonymous case is delivered as a rejection: the SDK's `fetch` wrapper throws on
a non-2xx, handing the caller an error with `code: 'UNAUTHENTICATED'` and
`httpStatus: 401`.

## FROM → TO for callers

| you wrote | now |
|---|---|
| `const s = await client.auth.me(); if (s === null) …` | `try { const s = await client.auth.me(); … } catch (e) { if (e.code === 'UNAUTHENTICATED') … }` |
| `if (res.status === 200 && body === null) // signed out` | `if (res.status === 401 && body.error.code === 'UNAUTHENTICATED') // signed out` |

No error code is minted: `UNAUTHENTICATED` is an existing `StandardErrorCode`
member, derived from the status through ADR-0112's own map, so
`ERROR_CODE_LEDGER` is unchanged.

⛔ Unchanged: the signed-in answer (`200 { user, session }`, byte-identical),
every other `/auth/*` route, and better-auth's JS API — `auth.api.getSession()`
still returns `null` for an anonymous caller, so every internal identity read
behaves exactly as before. Only the wire answer of this one route moves.

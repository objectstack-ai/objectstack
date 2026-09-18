---
"@objectstack/client": patch
---

fix(client): `auth.me` / `auth.refreshToken` deliver the `SessionResponse` envelope they declare, and `refreshToken` reads the token the route actually serves (#16760)

Both methods annotate their return as `SessionResponse` — ObjectStack's REST
`{ success, data }` envelope — for `GET /api/v1/auth/get-session`. better-auth
owns those bytes and answers **bare**. Measured against a real `AuthManager`
(better-auth 1.7.2, organization plugin) over a real driver:

```
GET /api/v1/auth/get-session  (signed in) -> 200 {"user":{…},"session":{…,"token":"…"}}
GET /api/v1/auth/get-session  (anonymous) -> 200 null
```

So `(await client.auth.me()).data.user` type-checked and was `undefined` at
runtime, while `.user` — the real payload — did not type-check. The annotation
pointed every caller at the wrong key.

## What changed

- The bare answer is now lifted into the declared envelope, the same lift
  `auth.login` has always carried for `/sign-in/email`. `SessionResponse` is
  **unchanged** and so is each method's published return annotation: the fix is
  in what the methods produce, not in what they promise.
- The lift fills `success` as well as `data`. `SessionResponseSchema` is
  `BaseResponseSchema.extend(…)` and that base declares `success` as a required
  boolean, so a body carrying `data` alone still would not parse as the declared
  type.
- The raw `.user` / `.session` keys are **kept** alongside `data`. They are what
  callers were pushed onto while the declared shape was unreachable; dropping
  them would trade one silent breakage for another.
- `auth.refreshToken` now reads `data.session.token`. It used to read
  `data.data?.token` — a field this route does not produce at any nesting, so
  the method returned successfully having captured nothing. A bearer-mode client
  calling it to refresh kept whatever credential it already had, silently.

## The read was not a consequence of the envelope

Worth stating because the reverse is the natural assumption: enveloping the body
does **not** put a token at `data.token`, because the route serves no top-level
`token` to lift. The only credential in the body is `session.token`, and that is
now the read. Fixing the shape alone would have left `refreshToken` exactly as
inert as it was.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `(await client.auth.me()).user` | still works — kept deliberately |
| `(await client.auth.me()).data.user` | now populated (was `undefined`) |
| `(await client.auth.refreshToken(t)).data.token` | `.data.session.token` |

`refreshToken` stores the **unsigned** session token, which is the spelling
`/get-session` serves; `bearer()` accepts it and the signed
`token.signature` form interchangeably, so a client that held the signed form
stays signed in across the call.

Three answers sat outside the declared type when this change was written and
are **not** addressed by it. Each has since been answered on its own card, so a
caller reading this entry does not have to code around any of them:

- the **anonymous** `/get-session` answer, recorded above as `200 null`. It no
  longer needs the published return annotation to widen, because the producer
  moved instead: since #17881 `plugin-auth`'s `refuseAnonymousSession` converts
  better-auth's `200` plus the literal JSON `null` into the declared ADR-0112
  refusal — HTTP `401` with `code: UNAUTHENTICATED` — before it leaves the
  process. The SDK's shared `fetch` wrapper throws on any non-2xx, so an
  anonymous `auth.me()` **rejects** rather than resolving outside its own type.
  Ruled by #17238: the producer moved and `SessionResponseSchema` is untouched.
- `SessionUser.image`, then declared `z.string().optional()` against a route
  that serves `null` (#17235). It is now declared `z.string().nullish()`, so
  the `"image": null` every `/auth/*` session body carries parses.
- the sibling `auth.login` / `auth.register`, which then normalized into `data`
  but set no `success` (#17234). They now run this entry's own lift, which
  fills `success` as well as `data`.

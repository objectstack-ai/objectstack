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

Two answers stay outside the declared type and are **not** addressed here: the
anonymous `null`, which would need the published return annotation to widen, and
`SessionUser.image`, declared `z.string().optional()` against a route that
serves `null` (#17235). The sibling `auth.login` / `auth.register`, which
normalize into `data` but set no `success`, are #17234.

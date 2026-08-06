---
"@objectstack/runtime": patch
---

fix(runtime): unknown `/auth` sub-paths answer a clean 404 instead of leaking an internal `TypeError` (#5085)

Measured on a real showcase boot:

```
POST /api/v1/auth/login
→ HTTP 500
{"success":false,"error":{"code":"INTERNAL_ERROR",
  "message":"request.headers.get is not a function","httpStatus":500}}
```

`/auth/login` is an obvious guess — it is the industry-habitual name — and any
integrator who tried it got a 500 naming an internal function call. The positive
control `POST /api/v1/auth/sign-in/email`, a real better-auth route reached
through the same forwarding layer on the same boot, answered 200 all along.

**The producer.** `createDispatcherPlugin` mounted one legacy explicit route,
`POST ${prefix}/auth/login`, and it was the only place in this repo that handed
better-auth a **non-Fetch** request. `IHttpServer` gives a handler the adapter's
internal `IHttpRequest`, whose `headers` is a plain object built from
`c.req.header()`; the `/auth` domain forwards `context.request` whole to
`IAuthService.handleRequest(request: Request)`, and better-auth's fetch-style
handler opens with `request.headers.get(…)`.

That route could not work for any caller: `/login` is not a better-auth endpoint
(it appears in neither `plugin-auth`'s route ledger nor the documented endpoint
list, which already stated "There is no `/auth/login` route"), and the domain
does not route on the sub-path at all. Its only effect over the `/auth/*`
wildcard the auth plugin mounts on the raw app was a 500 where the wildcard
yields better-auth's own clean 404. **It is deleted** — per Prime Directive #12
the fix belongs at the producer, not in a consumer-side conversion that would buy
nothing but a more expensive 404. Every unknown auth sub-path now falls to the
namespace owner exactly like every other one.

**The exit.** A **throw** out of `IAuthService.handleRequest` is unattributable
in the `/auth` domain: it never inspected the sub-path, never parsed the body,
and cannot tell a caller mistake from a handler bug. Its message used to reach
the client verbatim, because both dispatcher exits sanitise only on
`looksLikeInternalErrorLeak` — a SQL/driver-dump heuristic with nothing to say
about a `TypeError`. The message is now withheld **unconditionally**, following
the same discipline as `mapDataError`'s terminal `UNCLASSIFIED_FAULT` branch:
HTTP 500 with the catalog's `INTERNAL_ERROR` / `Internal server error`, and the
original error handed to the server log where an operator reads it.

Nothing changes for the honest paths. better-auth answers its own failures with a
`Response` rather than by throwing, so a real 401/403/404/422 is still returned
with its own body untouched, and `POST /auth/sign-in/email` still answers 200
with its `set-cookie`.

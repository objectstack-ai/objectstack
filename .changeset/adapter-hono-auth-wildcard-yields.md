---
"@objectstack/adapter-hono": patch
---

fix(adapters/hono): the auth wildcard yields paths the auth service does not own (#4117)

`app.all('${prefix}/auth/*')` claimed a whole namespace and was **terminal**: it
returned the auth service's response unconditionally, including better-auth's 404
for a path it does not implement, and the legacy `handleAuth` bridge's own
`handled: false` 404. That is the #4088 shape, found by #4116's enumeration after
manual greps had missed it.

A 404 from better-auth, or `handled: false` from the dispatcher, now means "not
this mount's path" and the handler yields. The predicate is the dispatcher's own
`handled` flag wherever one exists — an explicit ownership answer beats inferring
one from a status; only the better-auth hand-off lacks such a flag, and there the
404 is the signal, as in #4092.

**What changes on the wire.** An unowned path under `${prefix}/auth/*` used to get
a 404 built by this mount. It now continues to the `${prefix}/*` dispatcher
catch-all and gets a real, gate-carrying `dispatch()` attempt, so a domain handler
registered for such a path becomes reachable — this adapter's actual extension
mechanism. When nothing anywhere claims the path the reply is still the same
enveloped `{ success: false, error: { message: 'Not Found', code: 404 } }`. Paths
the auth service does own are untouched, and a 401/403 from it is never treated as
a disclaimer of ownership.

No configuration changes and no new routes.

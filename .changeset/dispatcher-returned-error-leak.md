---
"@objectstack/runtime": patch
"@objectstack/hono": patch
---

fix(runtime,hono): close the remaining raw-driver-message exits on the HTTP boundary (#3867 follow-up)

#3867 sanitised `dispatcher-plugin`'s `errorResponseBase`. That covers errors
**thrown** out of `dispatch()` — but not the ones it **returns**. A
`{handled: true, response}` result goes to `sendResult`, never through that
catch, and those bodies are built by `HttpDispatcher.error()`, which passed the
message through verbatim. Sweeping the boundary for the same defect class (the
follow-up #3867 called for) turned up two more live exits:

**`HttpDispatcher.error()`** — the single construction point for every returned
error response. Reachable with a raw driver message today through
`errorFromThrown` (`/meta` save, `/packages` install) and the MCP transport's
`deps.error(err?.message, 500)`. Pinned by a test that drives
`PUT /meta/:type/:name` with a throwing `protocol.saveMetaItem`: without the
guard the response body is the driver's `insert into \`sys_team\` … UNIQUE
constraint failed: sys_team.id`, naming a physical table and column.

**`@objectstack/hono`'s auth-config route** — a 500 built from a caught
error with `message: err.message`. The auth service reads from the database, so
that message can carry a driver dump.

Both apply the same `looksLikeInternalErrorLeak` predicate #3867 put in
`@objectstack/types`, and both are scoped to **5xx** for the same reason: a 4xx
message is a deliberate business/validation answer (`Path must be
/actions/:object/:action`, a hook's own `throw`, a `saveMetaItem` field error)
and must reach the caller intact. Structured `details` — the semantic `code` and
per-field `issues` the Studio maps back to inputs — is never touched, so a
sanitised 500 still carries everything a client can act on.

Diagnostics are unaffected: callers that threw still hand the original error to
`errorReporter` via `__obsRecordedError`, and every 5xx is logged server-side.

Audited in the same pass and deliberately left alone: the inline error bodies in
the `ai` / `mcp` domains (static literal strings, no interpolated error text) and
`plugin-hono-server`'s 403s (4xx, deliberate messages). With this change every
dynamic message on both dispatcher exits and the REST data routes goes through
one predicate.

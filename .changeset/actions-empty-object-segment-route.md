---
"@objectstack/runtime": patch
---

fix(actions): the object-less `POST /actions//:action` shape is actually reachable over HTTP (#3913 follow-up)

#3913 taught `handleActionsRequest` to route a single-segment path — the
object-less shape `POST /api/v1/actions//:action` — at the canonical `'global'`
key. That code was correct and unit-tested, and **unreachable**: the dispatcher
mounts its routes explicitly, `:object` does not match an empty path segment,
and no registration covered the `//` form. Over real HTTP the request fell
through to Hono's `notFound` and answered a bare `{error: 'Not found'}` with the
actions domain never running — so the exact URL #3913 was filed against still
did not dispatch.

The tests could not catch it because they call `dispatcher.handleActions()` /
`dispatcher.dispatch()` directly, bypassing the route table. This is the same
class of bug `dispatcher-plugin.routes.test.ts` was created for after `/mcp` and
`/keys` shipped the same way; the guard now covers the action routes too.

Found by dogfooding the running showcase app, not by the suite.

`POST /api/v1/actions//:action` now answers identically to
`POST /api/v1/actions/global/:action` — same envelope, same `'global'` key. The
object-scoped registrations are untouched and unshadowed (Hono matches the
literal `//` without competing with `:object/:action`).

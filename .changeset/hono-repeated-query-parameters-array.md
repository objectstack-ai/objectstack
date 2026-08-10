---
"@objectstack/plugin-hono-server": patch
"@objectstack/http-conformance": patch
---

fix(plugin-hono-server): surface a repeated query parameter as an array, matching the platform convention (#6878)

**Behaviour change, not a refactor.** On the Hono server, a repeated query
parameter — `?version=1.0.0&version=2.0.0` — used to reach your handler as the
single string `'1.0.0'`. It now reaches it as `['1.0.0', '2.0.0']`. A
single-valued key is unchanged: still a plain string.

This is the ruled intent of #6878 (route 2, cli-lane seat ruling of
2026-08-10), not an incidental cleanup.

**Why the old behaviour was a problem.** The platform ships two `IHttpServer`
implementations, and they answered the same request differently. The reference
`NodeHttpServer` reads `url.searchParams.getAll(key)` and keeps the array; the
Hono adapter read `c.req.query()`, which returns only the first value per key.
Both satisfied the declared contract — `IHttpRequest.query` is
`Record< string, string | string[] >` — so neither had a bug, yet the
platform's answer to "what is a repeated parameter?" depended on which server
had booted.

The consequence was not cosmetic. A handler cannot refuse an ambiguity it
cannot see: #6307 found `DELETE /api/v1/packages/:id` silently narrowing a
destructive operation's scope from a repeated `version`, and its fix (refuse
repetition with a `400`) was unreachable on the Hono server because the
transport had already collapsed the duplicate. Duplicates now reach the
handler on both servers, where the rest-side gates landed in #6877 (PR #7324 —
63 single-valued parameter slots) and #7321 (PR #7386) refuse them explicitly.

**Both construction sites moved.** The adapter builds `IHttpRequest.query` at
the route-handler seam *and* inside the `use()` middleware seam; both now go
through one `readQuery(c)` helper, so middleware and handlers agree.

⚠️ **If you read query parameters off the Hono server, check your assumptions.**
A read point that assumed a string will now receive an array when — and only
when — a client repeats that parameter. `String(req.query.x)` yields `"a,b"`
and `Number(req.query.x)` yields `NaN` in that case. Handle the array, or
refuse the repetition explicitly; do not reach back for the first value, which
is the silent-wrong-answer shape #6878 set out to remove. The repo's own read
points were swept and gated before this landed.

Nothing in `packages/spec` changed: the declared union already permitted
arrays. What changed is the platform's answer, from "depends on the server" to
one answer.

`@objectstack/http-conformance` gets the matching test tightening. Its
cross-adapter case, added under #6878 route 1 (PR #6941) to *record* the
divergence, is collapsed into the single expected shape exactly as that file's
own header instructed — plus a new middleware-seam case, so a half-applied
change to only one of the adapter's two construction sites cannot pass. The
single-value control case that catches an un-normalised `c.req.queries()`
(which returns an array for every key, single-valued ones included) stays.

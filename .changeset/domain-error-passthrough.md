---
"@objectstack/runtime": patch
---

fix(runtime): route every domain `catch` through `errorFromThrown` so status and `fields[]` survive (#3918 follow-up)

#3867 taught `dispatcher-plugin`'s `errorResponseBase` to read an error's
`status` (not just `statusCode`), and #3918 taught
`HttpDispatcher.errorFromThrown` the `VALIDATION_FAILED` shape. Both fixes were
invisible to a whole tier of handlers underneath them: the domain modules each
caught their own errors and called `deps.error(e.message, e.statusCode || 500)`
directly, bypassing `errorFromThrown` entirely — 13 call sites, 9 of them in
`/packages` alone.

The consequence on `/packages`, `/meta/_drafts`, `/ui`, `/security` and the
`/mcp` transport:

- **A deliberate status was downgraded to 500.** Every protocol-layer domain
  error in this codebase carries its HTTP status as `status`, not `statusCode`
  (`OBJECT_NOT_FOUND`, `RECORD_NOT_FOUND`, `CLONE_DISABLED`, plugin-sharing's
  `FORBIDDEN`, …) — the exact read #3867 fixed one tier up. So a 404 these
  routes meant to return arrived as a 500, and the message was dragged through
  the 5xx leak sanitiser on the way out.
- **A `ValidationError` still lost its `fields[]`** and its 400, re-opening
  #3918 on precisely the routes it was filed against.

Every one of those catches now calls `deps.errorFromThrown(e, …)`, so both
fixes finally reach the routes that need them. Deliberate per-route fallbacks
are preserved rather than flattened to 500: the `/meta` save fallback keeps
**501** (that branch is reached only when the protocol has no `saveMetaItem`,
so "unsupported" is the honest default) and the `/meta` two-part lookup keeps
**404** — but a validation failure on either now answers 400 with its fields
instead of being swallowed by the fallback.

`domains/keys.ts` is deliberately **not** converted: it discards the underlying
error on purpose, because the message could echo row contents. Its literal
`'Failed to create API key'` is the correct answer there and stays.

No behaviour change for errors that already carried `statusCode` — that read is
preserved, only widened.

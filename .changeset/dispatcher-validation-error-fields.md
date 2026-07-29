---
"@objectstack/runtime": patch
---

fix(runtime): dispatcher error exits serve VALIDATION_FAILED as 400 with `fields[]` (#3918)

`ValidationError` — what objectql's record and rule validators throw — carries
`.code = 'VALIDATION_FAILED'` and `.fields[]`, one entry per offending field. It
deliberately carries no `.status`, no `.statusCode`, and no `.issues`: it is a
plain domain error, and deciding it means "400" is the HTTP boundary's job.
`@objectstack/rest` has always done that (`mapDataError` → 400 with `fields[]`).
The runtime dispatcher's two error exits did not, because each read exactly the
properties this error lacks:

- **`HttpDispatcher.errorFromThrown`** (the RETURNED-error path — `/meta` save,
  `/packages` publish, …) fell back to the caller's `fallbackStatus` for want of
  a `.status`, and built its structured `details` from `.issues` alone, so
  `fields[]` was dropped.
- **`dispatcher-plugin`'s `errorResponseBase`** (the THROWN-error path — every
  route the plugin mounts: `/analytics`, `/packages`, `/i18n`, `/storage`,
  `/automation`, `/auth`, `/notifications`, `/mcp`, …) took the same 500
  fallback, and its body was only `{message, code}`. Landing on 5xx then dragged
  the message through the #3867 leak sanitiser, so a user typing a bad email
  address got back a **500 "Internal server error"** — no status a client could
  act on, no message worth showing, and nothing to attach to the input.

Both exits now recognise the shape and answer the way rest-server does: **status
400**, with the error's `fields[]` passed through verbatim in `details`
alongside `code: 'VALIDATION_FAILED'`. Any surface the dispatcher serves can
therefore highlight the specific field the user got wrong, the way a form served
by `/data` already could.

Matched by duck-typing on `code === 'VALIDATION_FAILED' || name ===
'ValidationError'` — the same both-ways predicate `mapDataError` uses — so a
hook or service that throws `{ code: 'VALIDATION_FAILED', fields }` by hand is
served identically, and the runtime takes no dependency on objectql. An explicit
`.status` / `.statusCode` on the error still wins: 400 is supplied only as the
fallback that was previously 500. Non-validation errors are untouched — same
status, same message sanitising, same `details`, and `errorResponseBase` still
emits the exact two-key body it always did.

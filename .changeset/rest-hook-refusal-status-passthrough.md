---
'@objectstack/rest': patch
---

fix(rest): a hook refusal that declares its status as `statusCode` reaches the wire with that status, not `500 INTERNAL_ERROR` (#7525)

**Observable behaviour change — read this if you alert or retry on `/api/v1/data` statuses.**
A write refused by an engine lifecycle hook that declared an explicit status used
to answer `500 INTERNAL_ERROR` with no `code`. It now answers the status the hook
declared, carrying the hook's ADR-0112 `code`. Two refusals QA reproduced 2× each
move from `500` to `409 RECORD_LOCKED` and `403 FORBIDDEN`. Monitoring that counted
these as server faults will see a 5xx disappear and a 4xx appear, and a client
retrying on 5xx will stop retrying a request that can never succeed.

## What was wrong

`mapDataError` — the error exit for the ~11 CRUD data routes, which bypass
`resolveErrorResponse` entirely — opened its explicit-status passthrough on
`typeof error.status === 'number'` and nothing else. An engine lifecycle hook
declares its status as `statusCode`:

```ts
// plugin-approvals/src/lifecycle-hooks.ts
err.code = 'RECORD_LOCKED'; err.statusCode = 409;   // a pending lockRecord approval
err.code = 'FORBIDDEN';     err.statusCode = 403;   // a delegation row the caller does not own
```

so the refusal never entered that branch at all. It fell past every structured
branch, matched no message heuristic, and left through `UNCLASSIFIED_FAULT` as
`500 INTERNAL_ERROR` — for a deliberate, well-understood business refusal, with
the correctly-shaped original sitting in the server log. The console never hit
the record-lock case (the affordance is disabled while a lock is live); a direct
API caller — script, integration, second-party client — got an unactionable 500.

**#5582 is not the fix and could not have been.** It widened this same
passthrough's *range* (4xx → 400-599) for producers that declared `status`. The
loss here is one question earlier: *whether* a status was declared at all.

## The fix, and why it is at the boundary

`status` → `statusCode` → default is what **every other HTTP exit in this repo**
already reads — `runtime`'s `HttpDispatcher.errorFromThrown` (#3867),
`dispatcher-plugin.errorResponseBase`, `endpoint-executor`, `domains/actions`,
`plugin-hono-server`'s user endpoints. `mapDataError` was the single exit that
read one spelling, which is why one thrown error came back as `403` through a
dispatcher route and as `500` through `/api/v1/data`. The gate is now a named
`declaredHttpStatus(error)` helper asking the same 400-599 band over both
spellings.

Teaching the two approvals hooks to spell it `status` would have fixed two
producers and left the boundary answering 500 for the next one — including
`runtime`'s own `action-execution.ts` (`{ statusCode: 503 | 501 | 400 }`) and
`metadata-protocol` (`{ statusCode: 404 }`). The hooks are unchanged.

## What deliberately did NOT change

- ⛔ **`declaresServerFault`'s own read is still `status`-only.** #5811 ruled that
  a *disclosure* rule must not depend on a producer's spelling, and that is
  untouched. This is *status resolution*, a different question, and the one call
  site inside the passthrough hands the predicate the status this boundary just
  resolved — otherwise a `{ statusCode: 5xx, code }` producer would take the 5xx
  arm and then be told it declared no fault, dropping its code.
- **The 5xx withhold is unconditional as before.** A `statusCode`-declared 5xx
  gets `INTERNAL_ERROR_MESSAGE` plus its code; no producer prose crosses the
  boundary, and the full text still reaches the operator.
- **A hook that declares NO status is unchanged** — still judged by the
  classifiers, still the terminal sanitised `500 INTERNAL_ERROR`. Promoting a
  bare `code` to a 4xx would be consumer-side leniency; that belongs with #7463,
  not here.
- **The structured branches keep their precedence.** `OBJECT_NOT_FOUND`,
  `DELETE_RESTRICTED`, `VALIDATION_FAILED` and the rest still sit above the
  passthrough and still win, `statusCode` or not.
- **`resolveErrorResponse` still reads `status` only.** It delegates to
  `mapDataError` for everything it does not pass through, so both doors already
  give one wire answer without a second copy of the two-spelling read.

Coverage: `rest-hook-refusal-status-passthrough.test.ts` — 26 cases, including
both reported requests walked in process on the real `PATCH /data/:object/:id`
and `POST /data/:object` routes. Run against unmodified `main` the file is 15/26
red; three further mutations cover the remaining 11, so no case is unfalsifiable.

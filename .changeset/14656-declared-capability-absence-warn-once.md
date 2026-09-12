---
"@objectstack/types": patch
"@objectstack/runtime": patch
---

A **declared capability absence** — a 5xx answered because the deployment did not install an optional service — is now reported **once per route per process at `warn`**, naming the missing service, instead of one `error` line per request. Every other 5xx keeps the per-request `error` line #14310 shipped.

Measured before the change, on a stock showcase boot: `GET /api/v1/ai/*` (the cloud-only AI service's declared `501 NOT_IMPLEMENTED`) printed one `error`-level line per request, and Studio opens it unprompted. A deployment that is working exactly as configured was training the channel built to mean "an operator must look" into noise — which is the failure mode `--log-level`-watching operators learn as "skim the errors".

- **What counts as an absence** is the envelope the door composed: a producer-declared 5xx (`declaresServerFault` — the repo's existing declared-5xx predicate) whose ADR-0112 `code` is `NOT_IMPLEMENTED` or `SERVICE_UNAVAILABLE`. Nothing is invented to recognise one; the code the producer already declared *is* the declaration.
- **The predicate is applied inside the shared funnel** (`logServerFault`, `@objectstack/types`), not at each door, so `sendError`'s nested-envelope exit and the runtime dispatcher read one answer by construction. A door cannot opt in, opt out, or drift.
- **The dedupe key is (route, process).** A restart reports again, and a second, different route reports on its own — deliberately not a global "first N", which is the shape that hides the second route. A door that supplies no route coordinates is demoted to `warn` but never suppressed: an un-keyed bucket is that same hiding shape.
- **A thrown 5xx keeps its `error` line even when it declared `501`.** The thrown exit hands the funnel the throw and no envelope `code`, so it is not recognised as an absence — fail-loud for the half that carries a stack.

⛔ **No wire byte moves.** Status, `code`, `message` and body shape are unchanged at both doors; this changes a log level and a count. The response bytes are pinned in `packages/runtime/src/declared-capability-absence-warn-once.test.ts`, and that block runs green on the pre-change tree too, which is what makes it a before/after measurement rather than a claim.

Operators who were alerting on `[5xx]` at `error` level for an uninstalled optional service will now see one `warn` line per route per process instead. The line says so in its own text: `(declared capability absence — reported once per route per process)`.

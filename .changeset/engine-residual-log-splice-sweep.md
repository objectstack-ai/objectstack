---
"@objectstack/service-automation": patch
---

fix(service-automation): the 13 residual `engine.ts` seams stop splicing uncontrolled thrown text into log messages, plus the one self-authored multi-line message; run-history persist failure is re-graded `error` (#6499)

#6299 / PR #6498 fixed three `engine.ts` seams and closed with "this file is now
clean"; #6499 is the corrective record: 13 more logger calls in the same file
still interpolated a thrown value's `.message` — a datasource driver's, a
plugin's (trigger / node-executor), or, second-hand via the
`AutomationResult.error` envelope, a failing node's — into the log MESSAGE.
`ObjectLogger.write()` adds one `<ts> <LEVEL>` head per call, so a cause
carrying newlines turned ONE record into several physical lines of which only
the first is greppable, and `serve`'s boot-quiet window drops the headless
continuations outright on the stdout (warn) path. All 13 now log a single-line
message stating the site's own consequence and hand the cause to the logger's
structured slot (`describeThrownForLog`).

A 14th site with the opposite cause is fixed alongside, argued on its own
terms: `validateFlowExpressions`' advisory schema pass authored a literal
`\n      source: …` continuation into a message we control, with the flow
author's (newline-tolerant CEL) expression as the second line. The message now
stays one line; the expression source rides the structured slot (`source`).

The level was judged per seam (#4632), not batch-copied:

- **`recordLog`'s fire-and-forget `store.recordTerminal` → RAISED to `error`.**
  The write half of the run-history claim: a TERMINAL run's history row failed
  to land while the run completed and every caller reads healthy — nothing
  retries it, nothing upstream is told. After the next restart the run is
  invisible to the Runs surfaces, `inspectStrandedRequests` (#3456) reads
  "no suspension + no terminal row" as a STRANDED approval, and
  `releasePendingForTerminalRuns` (#4469) reads "no terminal row" as
  still-alive, so a finished run's leftover pending approvals are never
  auto-released.
- **`persistSuspendedRun` stays `error`** (#4460's raise; #4420 is this exact
  seam's accident) — no re-grade, message and slot fixed only.
- **Everything else stays `warn`** (functional): `listRuns` / `getRun`
  (observability reads degrading to ring buffer / null — each record now says
  the caller cannot tell the degraded answer from a real one), the four
  plugin-supplied seams (`releaseSuspension`, `unregisterTrigger`,
  `activateFlowTrigger`, `deactivateFlowTrigger`), the grants resolver, lookup
  expansion, the screen `visibleWhen` probe, and both `bubbleToParent`
  branches. Nothing these degrade claims to be persisted.

Operator-visible: one record moves from stdout/`WARN` to stderr/`ERROR`
(run-history persist failure), and the reworded messages keep their original
lead phrases (`run-history read failed`, `durable run lookup failed`,
`Failed to bind flow`, `could not resolve grants`, …) so existing greps still
match; alert rules keyed on the trailing `: <error text>` splice need the
structured `error` / `source` / `visibleWhen` fields instead.

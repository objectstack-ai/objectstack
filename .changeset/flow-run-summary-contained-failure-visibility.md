---
'@objectstack/spec': minor
---

feat(spec): a contained per-iteration failure is visible in the flow run contract — run-level `failed`, loop iteration through `try` / `catch`, row identity on `$error` (#13681, spec half)

The ruled containment spelling for a per-iteration failure that must not end
the sweep is `loop { body: [ try_catch { try, catch } ] }` — ⛔ no
`loop.config.onIterationError` key (maintainer 2026-08-31, verbatim
「其他同意」; branch B selected by measurement: 5/5 iterations processed, the
run completes). The ruling's rider is that such a caught failure is invisible
at run level, and this change declares the three contract surfaces that close
that gap. Additive only: nothing narrows, no existing key moves, no
`BREAKING`.

- **`FlowRunSummary.failed`** — total node executions that failed, a fold of
  the existing per-node counter (`failed = Σ nodes[].failures`; that counter
  already exists and already counts a caught try-region attempt, so there is
  no second per-node key). On a run that completed, every one of them was
  contained — caught by a `try_catch` or routed down a `fault` edge — and the
  run went on. **Absent is not zero**, exactly as `unmeasured`: a run
  recorded before the field existed did not track it, and a parse leaves the
  key absent rather than defaulting it to `0`. It reads BESIDE the
  broken-sweep filter (`selected > 0 AND acted = 0 AND unmeasured = 0`), not
  inside it: `acted = 0` with `failed > 0` is a sweep whose writes were
  attempted and failed, not one that silently stopped.
- **`ExecutionStepLog.iteration` through `try` / `catch`** — a step executed
  inside a try/catch region that is itself inside a loop body carries the
  ENCLOSING LOOP's `iteration` (a try/catch region has no index of its own)
  while `regionKind` stays `try` / `catch`. The schema already declared both
  keys; the contract now states how they combine, and pins it.
- **`TryCatchErrorValueSchema`** (`@objectstack/spec/automation`, beside
  `TryCatchConfigSchema`, with `TryCatchErrorValue` /
  `TryCatchErrorValueParsed`) — the value a `try_catch` binds to
  `errorVariable` (default `$error`) was assembled by the engine and typed
  nowhere. It is now declared: `nodeId`, `message`, and — only when the
  failure happened inside a loop body — `iteration` (the enclosing loop's)
  and `item` (the loop item being processed, `unknown`). A plain object
  closed by convention: a value the engine assembles, not an authoring
  surface.

The engine half — populating `failed` in `summarizeRun`, propagating the loop
iteration through `try_catch` → `runRegion`, binding `$error.iteration` /
`$error.item`, and printing `failed=` on the run summary line when present —
is the `domain:services` card that follows this contract.

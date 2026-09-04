---
"@objectstack/service-automation": minor
---

A contained per-iteration failure is now visible at run level, attributed to its iteration, and bound to its row.

`loop { body: [ try_catch { try, catch } ] }` is the containment spelling for a per-iteration failure that must not end the sweep (there is deliberately no `loop.config.onIterationError` key). Containment already worked — the failure was caught, the loop went on and the run completed — but nothing said what it had contained: a sweep that lost two rows out of five reported `status=completed selected=5 acted=9 skipped=0` and was indistinguishable from one that lost none. The failure was in the step log and in `nodes[].failures`; no run-level number carried it, the failing step named no row, and `$error` bound no row identity.

Four changes populate the contract `@objectstack/spec` already declares:

- **`FlowRunSummary.failed`** — `summarizeRun` now folds `failed = Σ nodes[].failures` over the per-node array it publishes, so the run-level count can never disagree with the breakdown it summarizes. It counts every node execution that failed, contained or fatal; on a run that completed, all of them were contained.
- **`failed=N` on the run summary line** — `formatRunSummaryLine` prints the token whenever the count is present, `failed=0` included. That is the opposite of the `unmeasured` rule beside it and deliberate: `unmeasured` qualifies `acted`, while `failed` answers a question a completed run's line otherwise cannot be asked at all. Read `failed=0` precisely: **no node execution of this run failed**. It is the node fold and only that, so a `subflow` child's own contained failures stay on the child's summary rather than rolling up the way `acted` does — see #15617, where the declaration's two paragraphs are being reconciled.
- **Iteration through `try_catch`** — a step that ran in a `try` or `catch` region inside a loop body now carries the enclosing loop's `iteration`, with `regionKind` still `try` / `catch`. The step says which region ran it *and* which row it ran for. `parallel` branch tagging is unchanged.
- **`$error` binds the row** — the value bound to `errorVariable` (default `$error`) is the declared `TryCatchErrorValue`: `nodeId` and `message` as before, plus `iteration` and the loop's current `item` when the failure happened inside a loop body. A `subflow` / `map` child run has its own variable scope and therefore binds neither, so a parent's row identity never leaks into a child's `$error`.

**`failed` absent means "not tracked", never `0`.** Runs recorded before this change keep it absent — no migration and no default, the same convention `unmeasured` carries. Defaulting it to zero would tell an operator "nothing failed" about a run nobody measured. Absent, the summary line prints no `failed=` token at all; present-and-zero prints `failed=0`. The count rides in the persisted `summary_json`, including on a summary compacted past the size cap, where the per-node `failures` it folds are exactly what gets dropped.

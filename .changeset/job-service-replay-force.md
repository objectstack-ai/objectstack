---
"@objectstack/spec": minor
---

feat(spec): `IJobService.replay` gains an optional third argument, `options?: JobReplayOptions`, carrying `force: true` (#14766 — the contract half of the #14501 A+a2 ruling)

Additive: the argument is optional, an existing two-argument `replay(name, data?)` implementation keeps compiling and behaving as before, and omitting it is the pre-#14766 call exactly. `JobReplayOptions` is exported from `@objectstack/spec` (`contracts`), with one member, `force?: boolean`.

**What the contract now declares** (`packages/spec/src/contracts/job-service.ts`, the `replay` TSDoc), for a scheduled (cron) flow whose tick window takes a `(flow, tick-window)` dispatch claim in `sys_flow_dispatch`:

- `replay(name, data)` on a window whose claim is **absent or failed** re-runs the window — unchanged behaviour, and every job that never takes a claim is this row;
- `replay(name, data)` on a window whose claim **succeeded** is **refused loudly**: the promise rejects with an ADR-0112 envelope — `code: 'RESOURCE_CONFLICT'` (the standard-catalog member HTTP 409 derives; no new extension code) and `status: 409` — whose message names the window asked for and the claim that refused it. Never a silent no-op;
- `replay(name, data, { force: true })` sends anyway; the duplicate is the operator's, taken knowingly.

**Declared here, enforced by #14501.** This release changes the contract text and the signature only. The refusal semantics are implemented by the services half (#14501: the `(flow, tick-window)` claim through `sys_flow_dispatch`, and `DbJobAdapter.replay` reading it); until that lands, shipped adapters still accept the third argument and ignore it, re-running the window as before. A third-party `IJobService` implementation that already declares `replay` needs no change to keep compiling; one that wants the once-only guarantee implements the table above.

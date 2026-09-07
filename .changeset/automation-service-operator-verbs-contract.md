---
"@objectstack/spec": minor
---

feat(spec): declare the two operator run-lifecycle verbs on `IAutomationService` — `cancelRun` and `restoreConsumedSuspension` (#16495, the contract half of #13953)

`IAutomationService` (`contracts/automation-service.ts`) gains two OPTIONAL
members, typed as the engine already implements them rather than as the
ruling's `verb(runId)` shorthand, so a door calling through the contract can
say who asked and why:

- `cancelRun?(runId: string, reason?: string): Promise<boolean>` — end a
  suspended run (ADR-0044's run-cancel primitive): `true` only when this call
  consumed a suspension, `false` when none exists under the id (idempotent
  success — and the answer an unreadable store lands on too, which the
  implementation reports at `error`).
- `restoreConsumedSuspension?(runId: string, options?: { requestedBy?: string; reason?: string })`
  answering `{ restored: boolean; runId: string; refusal?: string; reason: string }`
  — the operator exit from a run a resume left terminally unresumable
  (`AutomationResult.status: 'stranded'`, #13909 / #13937): puts the consumed
  suspension back verbatim, replays no signal, undoes nothing, never resumes,
  never throws.

Both docblocks carry the #13953 ruling's persistent-face statement (maintainer
2026-09-05, decision batch #42): "listing and acting go through
`sys_automation_run` (the persistent face), never engine memory" — and its
permission posture: platform-operator verbs gated on the existing
`platform_admin` position, no new permission type, no per-run ownership.

Additive. Both members are optional, so every existing implementation —
including the `{ execute, listFlows }` minimum the contract's own test pins —
still conforms, and the one non-test implementor (`AutomationEngine` in
`@objectstack/service-automation`) already satisfies both under `implements`.
The result of `restoreConsumedSuspension` is a deliberately NARROWER
structural shape than the engine's `SuspensionRestoreResult`: the engine's
eight-member refusal vocabulary stays with the engine, so `refusal` is typed
`string` on the contract (route (i); a second consumer that needs the
vocabulary is a spec card). No REST route, CLI command, lister or engine
behaviour moves in this change — #13953's services half owns the doors. A
service that does not declare a verb has no operator door for it, and a door
must probe for presence and refuse fail-closed when it is absent.

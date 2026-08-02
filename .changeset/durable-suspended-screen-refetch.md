---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/runtime': minor
---

**BREAKING**: `IAutomationService.getSuspendedScreen(runId)` is now **async** — it returns `Promise<ScreenSpec | null>` instead of `ScreenSpec | null` (#4515).

FROM → TO for anyone calling or implementing it:

```ts
// caller
- const screen = automationService.getSuspendedScreen(runId);
+ const screen = await automationService.getSuspendedScreen(runId);

// implementer
- getSuspendedScreen(runId: string): ScreenSpec | null
+ async getSuspendedScreen(runId: string): Promise<ScreenSpec | null>
```

One-line fix: `await` the call (the enclosing function is almost certainly already `async`), and make any test double resolve rather than return (`mockResolvedValue`, not `mockReturnValue`).

Why it had to change: the method could only ever read the engine's in-memory hot cache, because a synchronous signature cannot consult the durable suspended-run store. `SuspendedRun.screen` *is* persisted (`sys_automation_run.screen_json`) and `resume()` cold-reads it back, so after a process restart a still-suspended screen run could be resumed (`POST …/runs/:runId/resume` → 200) while `GET …/runs/:runId/screen` returned 404 “No pending screen for run” — the refresh-safe re-fetch failing in exactly the situation it exists for (page refresh, another device), and the rendering half of ADR-0019's durable-suspend promise missing while the resuming half shipped.

`AutomationEngine.getSuspendedScreen` now takes the hot cache as its fast path and falls through to the store via the same loader `resume()` rehydrates from. A run that does not exist, is no longer suspended, or paused at a non-screen node still resolves to `null`, so `GET …/runs/:runId/screen` keeps returning 404 for genuinely absent runs. No sync variant of the method remains on the contract.

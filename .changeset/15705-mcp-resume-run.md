---
'@objectstack/mcp': minor
'@objectstack/runtime': minor
---

feat(mcp): `resume_run` continues a flow run that paused on a screen, behind the same gates as `run_action` (#15705)

Clause-②: yes

**What changed.** `run_action` on a flow action whose flow stops on a `screen` node answers `status: "paused"` with a `runId` and the `screen` to fill in. Until now nothing on the MCP surface could submit that screen, so the run stayed parked: an agent could start such an action but never finish it. The new MCP tool `resume_run({ runId, values?, confirm? })` submits the screen's field values (keyed by the names in `screen.fields`) and the run continues. It answers with `run_action`'s envelope, `{ ok, action, objectName, recordId?, result }`. A run that pauses on its next screen comes back paused again, so a multi-screen wizard is walked by calling `resume_run` once per screen.

**Which runs it continues, and no others.** The runtime's bridge admits a call only where `run_action` would admit starting the same flow on the same record for this caller now:

- **Only the caller's own run.** The run's trigger identity must be the caller. Another user's run, an unknown id and a finished run all answer the same `404 RESOURCE_NOT_FOUND`. A resumed run continues under the identity of the user who started it, so without this check one user could continue another user's run as that user.
- **`run_action`'s gates, with `run_action`'s helpers.** A `type: 'flow'` action whose `target` is the run's flow, on the run's object, must be AI-exposed (`ai.exposed`), must pass the caller's `requiredPermissions` and must not be switched off (`ACTION_DISABLED`, `409`). An action flagged `ai.requiresConfirmation` needs `confirm: true` on the resume too (`ACTION_CONFIRMATION_REQUIRED`, `428`), because the flow's writes happen after the screen. The exposure and permission refusals answer `403 PERMISSION_DENIED`. So does a run that no flow action targets.
- **The subject record is read again as the caller.** A record the caller can no longer read is refused `404 RECORD_NOT_FOUND`, which is how `run_action` refuses it.
- **Screen pauses only.** A run waiting on anything else (a timer `wait`, an approval) is refused `409 RESOURCE_CONFLICT` and left as it is.

Every refusal happens before the engine is asked, so the run stays parked. The engine's own answers (a screen submission missing a required field, a concurrent resume, a run that resumed and then failed) reach the caller with the code, status, message and `details` that `POST /api/v1/automation/:name/runs/:runId/resume` gives for the same result. The two doors now share one classification, `classifyResumeResult` in `@objectstack/runtime`. It was moved out of the REST route unchanged, and the route's answers are byte-identical.

**For hosts.** `McpActionBridge` gains an OPTIONAL member, `resumeRun(runId, { values?, confirm? })`. A bridge that implements it gets `resume_run` beside `run_action`, under the same `actions:execute` OAuth scope, on both the HTTP and the stdio transport. A bridge without it is unchanged and does not list the tool. `run_action`'s description names `resume_run` only where it is registered. `@objectstack/runtime`'s MCP bridge implements the member.

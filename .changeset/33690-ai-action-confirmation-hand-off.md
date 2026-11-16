---
'@objectstack/runtime': minor
'@objectstack/mcp': minor
---

feat(runtime,mcp)!: an action declaring `ai.requiresConfirmation: true` never runs on the MCP caller's own `confirm: true` — `run_action` and `resume_run` hand it to the person in the app

Clause-②: no (narrowing)
Metadata-protocol: semantic
Skills-docs: follow-up #34210

<!-- adr-0087: not-required (already-registered action-requires-confirmation-elicited) The semantic entry registered with the contract already carries this move to the upgrade guide and os migrate meta: no key is added, removed or re-shaped, and nothing an author wrote is rewritten. -->

**BREAKING** for an MCP client, an agent or a script that runs an action declaring `ai.requiresConfirmation: true` through the `run_action` or `resume_run` tool by sending `confirm: true` itself. Ruled by the account owner on the safety fix: the caller's own `confirm: true` never counts on such a call; the person it runs as confirms it in the app.

This release implements the hand-off and refusal steps of the amended confirmation contract (`AI_ACTION_CONFIRMATION_CAPABILITY`, `@objectstack/spec/contracts`). The MCP doors do not elicit in the client yet: every declared-gated call takes the hand-off, whatever the client advertised.

- After every admission gate, the subject load and the caller-scope subject verdict included, a declared-gated call is handed to the host's pending-confirmation service (`IActionConfirmationService`, registered under `ACTION_CONFIRMATION_SERVICE` = `'ai.actionConfirmation'`) through its `submit` member, and the call is answered with `status: 'pending_confirmation'`, the service's `pendingId`, a plain message, `actionName` and `objectName`. That answer is the tool's successful result. Nothing runs, and no `action_invocation` row is written. A `resume_run` hand-off carries its run (`run: { runId, values }`) and the run stays paused; approving it is the host's, as is what happens after.
- A host that registers no such service (the open-source build ships none) refuses the call `428 ACTION_CONFIRMATION_REQUIRED` with `details.reason: 'no_confirmation_service'`, with or without `confirm: true`. The person performs the action in the app.
- A service that answers no `pendingId` is a fault: the call fails and nothing runs.
- An AI service account acting for itself is refused whatever it sends, as before (ADR-0151 D3 rule 3). Its refusal now carries `details.reason: 'service_account'` at every action door, REST `/actions` and a host's door included.
- Unchanged: REST `/actions` stays outside the gate for a person; a host's door (`dispatchAction`) under the `ai` posture still reads `confirm`; the MCP `delete_record` and `delete_records` gates still read `confirm: true`. The `confirm` member stays accepted on `run_action` and `resume_run` and is not read.

What changes for a caller:

- FROM confirm with the person yourself, then send `confirm: true` on `run_action` / `resume_run` TO relay the pending answer's message and let the person approve it in the app; do not retry the call.
- FROM a script or agent that runs a gated action unattended with `confirm: true` TO a pending answer the person decides in the app, or the `no_confirmation_service` refusal on a host without the service. Where the action is safe unattended, its author declares `ai.requiresConfirmation: false`.
- A host that wants its people to approve these calls registers an `IActionConfirmationService` under `ACTION_CONFIRMATION_SERVICE`.

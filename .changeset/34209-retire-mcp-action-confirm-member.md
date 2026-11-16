---
'@objectstack/mcp': patch
'@objectstack/spec': patch
'@object-ui/console': patch
---

feat(mcp,spec)!: `run_action` and `resume_run` refuse the `confirm` member — confirmation happens in the app, by the person

Clause-②: yes (narrowing)
Metadata-protocol: none (the retired member belongs to an MCP tool's input, not to a key a metadata author writes; `ai.requiresConfirmation` keeps its meaning. The dev confirms against the diff.)

<!-- adr-0087: not-required (already-registered action-requires-confirmation-elicited) The semantic entry for the amended confirmation contract already covers what a caller sends to run_action and resume_run; this change rewrites its wording so the same switch names the refusal of the confirm member. No authorable key is added, removed or re-shaped. -->

**BREAKING** for an MCP client, an agent or a script that sends `confirm` to the `run_action` or `resume_run` tool. Ruled by the maintainer: the member is retired, so a stale client is refused loudly instead of silently ignored. Since the hand-off to the person in the app, the caller's `confirm: true` confirmed nothing on these two tools; now a call that carries the member at all is refused.

- `run_action` and `resume_run` no longer declare `confirm`. A call that carries it, `true` or `false`, is refused by the tool's closed input, the same refusal any undeclared argument gets. This applies on every action, whether or not it declares `ai.requiresConfirmation`. The refusal names the member and says that confirmation happens in the app, by the person. Nothing is resolved or run.
- Unchanged: a call without the member is handed to the person (`status: 'pending_confirmation'`), or refused `428 ACTION_CONFIRMATION_REQUIRED` with `details.reason: 'no_confirmation_service'` on a host with no pending-confirmation service. The MCP `delete_record` and `delete_records` tools still require `confirm: true`. A host's own door (`dispatchAction`) under the `ai` posture still reads `confirm`.
- The served MCP skill (and the console's downloadable copy of it), the `tool.requiresConfirmation` retirement guidance in `@objectstack/spec`, and the contract prose in `@objectstack/spec/contracts` stop teaching `confirm: true` on these two tools. The upgrade-guide entry `action-requires-confirmation-elicited` now keys its switch on the hand-off rather than on elicitation, and names the refusal of the member.

What changes for a caller:

- FROM `run_action({ actionName, recordId, confirm: true })` (accepted, not read) TO `run_action({ actionName, recordId })`. Relay a `pending_confirmation` answer to the person and let them approve it in the app; do not retry.
- FROM `resume_run({ runId, values, confirm: true })` TO `resume_run({ runId, values })`.
- To fix a client: stop sending `confirm` to `run_action` and `resume_run`. Keep sending it to `delete_record` and `delete_records`.

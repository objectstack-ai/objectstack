---
'@objectstack/runtime': patch
---

fix(runtime): an AI service account refused a confirmation-gated flow start now gets `details.reason: 'service_account'`, as the action door gives it

Clause-②: no
Metadata-protocol: none

When an AI service account starts a flow by name (`POST /api/v1/automation/:name/trigger` or the older `POST /api/v1/automation/trigger/:name`) and an action that targets the flow declares `ai.requiresConfirmation: true`, the route refuses it with `428 ACTION_CONFIRMATION_REQUIRED`. That refusal's `details` named the action, its object and the confirmation member, but not the reason. Every action door already gives the same account `details.reason: 'service_account'`. The flow-start refusal now carries it too, so a client that branches on the reason handles a refused flow start the same way it handles a refused action.

What does not change: the code, the status, the message and the other `details` members are the same. A person and an OAuth-delegated agent start the flow as before. No metadata key, value or default changes.

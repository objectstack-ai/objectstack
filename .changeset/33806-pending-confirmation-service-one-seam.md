---
'@objectstack/spec': patch
---

feat(spec)!: one pending-confirmation service for every AI door — the in-app assistant's pending-action queue leaves `IAIService`

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: registered ai-pending-action-queue-merged-into-confirmation-service -->

**BREAKING** contract change in `@objectstack/spec/contracts`, inside the 19 prerelease window and before 19.0.0. A confirmation rule had two seams: the in-app assistant's pending-action queue on `IAIService` (answering the model `pending_approval`) and the AI-door hand-off `IActionConfirmationService` (answering `pending_confirmation`, with only a `submit` member). They are now one: `IActionConfirmationService`, still registered under `ACTION_CONFIRMATION_SERVICE` (`'ai.actionConfirmation'`), carries the whole lifecycle, and every AI door hands its gated calls to it and answers `pending_confirmation`. No metadata changes: `ai.requiresConfirmation` and every other key an author writes mean what they meant.

| FROM | TO |
|:--|:--|
| `aiService.proposePendingAction({ objectName, actionName, toolName, toolInput, conversationId, messageId, proposedBy })`, answering `{ id }` | `confirmations.submit({ actionName, objectName, recordId, params: toolInput, door: 'assistant', toolName, conversationId, messageId }, context)`, answering `{ pendingId }` (`context` = the person the call runs as) |
| `aiService.listPendingActions(filter, context?)` | `confirmations.list(filter, context)` (context required) |
| (none) | `confirmations.get(pendingId, context)`, one item's row or `null` |
| `aiService.approvePendingAction(id, actorId)` | `confirmations.approve(id, context)` (`context` = the deciding person; still answers `executed`, `held` or `failed`) |
| `aiService.rejectPendingAction(id, actorId, reason?)` | `confirmations.reject(id, context, reason?)` |
| `ProposePendingActionInput` | `ActionConfirmationHandOff`, which gains optional `toolName`, `conversationId` and `messageId` for an in-app item |
| in-app tool answer `{ status: 'pending_approval', pendingActionId }` | `{ status: 'pending_confirmation', pendingId, message, actionName, objectName }` (`ActionConfirmationPending`) |

The one-line fix: register one `IActionConfirmationService` implementing `submit`, `list`, `get`, `approve` and `reject`, route the in-app assistant's gated tool calls through `submit` instead of `proposePendingAction`, and delete the four `IAIService` members from your implementation. A reader of stored conversations reads an old `pending_approval` answer with the same recogniser that reads `pending_confirmation`, taking `pendingActionId` as the `pendingId`; it never gets a second reader. Keep the ids of items you move from the old queue so those answers still name their item.

- **`@objectstack/spec`**: `IActionConfirmationService` gains `list`, `get`, `approve` and `reject` (all required) and states the three deciding points (only the person the call ran as decides; only on a signed-in session; the call runs as that person with every gate re-checked) for every item, whichever door handed it off. New types `ActionConfirmationListFilter` and `ActionConfirmationApproveOutcome`. `IAIService` loses `proposePendingAction`, `approvePendingAction`, `rejectPendingAction` and `listPendingActions`; `ProposePendingActionInput` is removed. `PendingActionStatus` (six states, `held` included) and `PendingActionRow` keep their shape and now describe the service's items; the service's docblock says how a hand-off from every door becomes a row (`tool_name` is the tool the call was made through, `run_action` or `resume_run` on an MCP item; `tool_input` is that call's input as JSON, record, namespace and run included; `object_name` is the empty string for an action on no object). The `/api/v1/ai/pending-actions` route schemas (`AiPendingAction*`) are unchanged. The D3 entry `ai-pending-action-queue-merged-into-confirmation-service` lists the hand work for `os migrate meta --from 18`.

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The in-app assistant's pending-action queue, declared on `IAIService` until
// 19.0.0, is merged into the pending-confirmation service
// (`IActionConfirmationService`, `ACTION_CONFIRMATION_SERVICE`,
// `contracts/ai-service.ts`): one seam and one pending literal for every AI
// door. A structured TODO, not a D2 conversion: no metadata an author wrote
// changes. What moves is host code that implements or calls the queue, and
// code that reads the in-app door's old `pending_approval` answer.
export const entry: SemanticMigration = {
  id: 'ai-pending-action-queue-merged-into-confirmation-service',
  surface:
    '`IAIService.proposePendingAction`, `approvePendingAction`, `rejectPendingAction` and `listPendingActions` '
    + '(retired) and `ProposePendingActionInput` (retired); `IActionConfirmationService` (now `submit`, `list`, '
    + '`get`, `approve`, `reject`); the in-app assistant tool answer `{ status: \'pending_approval\', '
    + 'pendingActionId }` (retired) — metadata, including `ai.requiresConfirmation`, is unchanged',
  replacement:
    'Register one pending-confirmation service under `ACTION_CONFIRMATION_SERVICE` and serve every AI door from '
    + 'it. FROM `aiService.proposePendingAction({ objectName, actionName, toolName, toolInput, conversationId, '
    + 'messageId, proposedBy })` TO `confirmations.submit({ actionName, objectName, recordId, params: toolInput, '
    + 'door: \'assistant\', toolName, conversationId, messageId }, context)`, where `context` is the person the '
    + 'call runs as. FROM `listPendingActions(filter, context)` TO `list(filter, context)`; FROM '
    + '`approvePendingAction(id, actorId)` TO `approve(id, context)`; FROM `rejectPendingAction(id, actorId, '
    + 'reason)` TO `reject(id, context, reason)`, `context` being the deciding person\'s; read one item with '
    + '`get(id, context)`. The in-app tool answers `{ status: \'pending_confirmation\', pendingId, message, '
    + 'actionName, objectName }` (`ActionConfirmationPending`) instead of `pending_approval`. A reader of stored '
    + 'conversations reads an old `pending_approval` answer with the same recogniser that reads '
    + '`pending_confirmation`, taking `pendingActionId` as the `pendingId`, never with a second reader; keep the '
    + 'ids of items you move from the old queue so those answers still name their item. `PendingActionRow`, '
    + '`PendingActionStatus` and the `/api/v1/ai/pending-actions` routes keep their shape; store an MCP hand-off '
    + 'as a row the way the service\'s contract says: `tool_name` `run_action` or `resume_run`, `tool_input` the '
    + 'call\'s input as JSON (record, namespace and run included), `object_name` the empty string for an action '
    + 'on no object',
  reason:
    'One confirmation rule had two seams: the in-app queue on `IAIService` answering `pending_approval`, and the '
    + 'AI-door hand-off answering `pending_confirmation` with only a `submit` member. Every rule change was written '
    + 'twice and a host kept two stores for one kind of item. The merge leaves one service with the whole '
    + 'lifecycle and one answer literal. No conversion applies: no metadata changes, and the work is in host code '
    + 'and in readers of stored conversation history, where the old literal stays readable because browser '
    + 'caches cannot be migrated from the server. ADR-0011 / ADR-0087.',
  acceptanceCriteria:
    'Nothing in your code calls or implements the four retired `IAIService` members or names '
    + '`ProposePendingActionInput` (TypeScript refuses them). The host registers one `IActionConfirmationService` '
    + 'implementing all five members, and the in-app assistant and the MCP doors both hand off to it. The in-app '
    + 'assistant answers `pending_confirmation`. A conversation saved before the upgrade still re-draws its pending '
    + 'card, read by the one recogniser. Only the person the call ran as approves or rejects an item, on their '
    + 'signed-in session.',
};

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ui ADR-0057 Amendment A5, row 3 — whether a conversation holds a write the
 * AI proposed that still waits for the user's approval: a tool call the
 * framework parked as a pending action (`pendingActionId`, state
 * `approval-requested`) that the user has not decided in this chat, or whose
 * decision failed and so still waits. The chat host publishes the answer to
 * the assistant bus (`publishPlanApprovalPending`), where the drawer's host
 * reads it when the drawer is opened from the entry.
 */

interface ToolCallReading {
  toolCallId: string;
  state?: string;
  pendingActionId?: string;
}

interface MessageReading {
  toolInvocations?: readonly ToolCallReading[];
}

/** The decision a chat holds for one tool call; only its `state` is read. */
interface DecisionReading {
  state: string;
}

/** How many proposed writes in `messages` still await the user's approval. */
export function countWritesAwaitingApproval(
  messages: readonly MessageReading[],
  decisions: Readonly<Record<string, DecisionReading | undefined>>,
): number {
  let count = 0;
  for (const message of messages) {
    for (const tool of message.toolInvocations ?? []) {
      if (tool.state !== 'approval-requested' || !tool.pendingActionId) continue;
      const decision = decisions[tool.toolCallId];
      if (decision === undefined || decision.state === 'error') count += 1;
    }
  }
  return count;
}

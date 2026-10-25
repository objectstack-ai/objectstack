/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * useHitlInChat — bridge between the streaming chat and the framework's
 * HITL (Human-In-The-Loop) approval REST endpoints.
 *
 * Background
 * ----------
 * When an LLM picks an action-tool that's marked dangerous on the framework
 * side (`enableActionApproval` + `confirmText` / `mode:'delete'` / `variant:
 * 'danger'`), the tool handler does NOT execute. Instead it persists a row
 * in `ai_pending_actions` and returns
 *   `{ status: 'pending_approval', pendingActionId: 'pa_…', message: '…' }`
 * inside the tool result (`@objectstack/service-ai/tools/action-tools.ts`).
 *
 * The chat client sees this as a regular tool-output text part. `mapMessages`
 * detects the envelope and lifts `pendingActionId` plus a synthetic
 * `state: 'approval-requested'` onto the `ChatToolInvocation`. This hook then
 * lets the operator approve or reject the proposal inline — without leaving
 * the chat for the standalone AI Approvals inbox.
 *
 * Wire-up
 * -------
 * ```tsx
 * const hitl = useHitlInChat({ messages, apiBase, headers });
 * <FloatingChatbot
 *   {...rest}
 *   messages={messages}
 *   onToolApprove={hitl.decide}
 *   toolDecisions={hitl.decisions}
 * />
 * ```
 */
import * as React from 'react';
import type { ChatbotEnhancedMessage as ChatMessage, ToolDecisionState } from './ChatbotEnhanced';
import type { ApproveOutcome, RejectOutcome } from './usePendingActions';

export type { ToolDecisionState };

export interface UseHitlInChatOptions {
  /**
   * Chat message list (already-mapped `ChatMessage[]` from `useObjectChat`
   * or `uiMessagesToChatMessages`). The hook scans `toolInvocations[*]`
   * looking for entries with `pendingActionId` and indexes them.
   */
  messages: ChatMessage[];
  /**
   * Framework AI base URL — for example `http://localhost:3004/api/v1/ai`.
   * Defaults to `/api/v1/ai` (same-origin) to match `usePendingActions`.
   */
  apiBase?: string;
  /** Extra headers (e.g. `X-Environment-Id`, `Authorization`). */
  headers?: Record<string, string>;
  /**
   * Optional callback fired after a decision completes (regardless of
   * success/failure). Useful for refreshing the inbox view if it is also
   * mounted on the same page.
   *
   * `outcome` is the spec decision response as the endpoint returned it, so
   * read it by side: `result` / `error` on approve, `id` on reject
   * (objectui#3783 — the previous local types promised `id` on BOTH, and the
   * approve response has never carried one). `pendingActionId` is available
   * from `ContinueContext` and from the row you decided on; do not fish it out
   * of an approve outcome.
   *
   * One honest caveat: on a transport error or non-2xx there IS no decision
   * response, and this callback is still invoked — with an envelope the hook
   * synthesizes locally (`{ status: 'failed', error }`). That case is not
   * modelled by this parameter's type; narrowing it is a public-contract
   * decision tracked in objectui#3790.
   */
  onDecided?: (toolCallId: string, outcome: ApproveOutcome | RejectOutcome) => void;
  /**
   * When set, on a *successful* decision the hook synthesizes a short
   * follow-up prompt (e.g. "Operator approved pa_xxx. Result: {...}.
   * Continue.") and invokes this callback. Wire to `useObjectChat`'s
   * `sendMessage` to close the conversation loop — the LLM then continues
   * reasoning with full awareness of the executed action's outcome.
   *
   * Failures (`status: 'failed'`, transport errors) still surface in
   * `decisions[toolCallId]` but do NOT trigger a continuation prompt — the
   * operator is expected to read the error and decide what to do next.
   */
  continueConversation?: (prompt: string, context: ContinueContext) => void;
}

/** Argument passed to {@link UseHitlInChatOptions.continueConversation}. */
export interface ContinueContext {
  toolCallId: string;
  pendingActionId: string;
  decision: 'approved' | 'rejected';
  /**
   * Raw REST payload — the spec decision response: `{ status: 'executed' |
   * 'failed', result?, error? }` on approve, `{ status: 'rejected', id }` on
   * reject (objectui#3783). Note `id` is on the REJECT side only; use
   * `pendingActionId` above, which is populated for both decisions.
   */
  outcome: ApproveOutcome | RejectOutcome;
  /** Tool name as it appeared in the message part (e.g. `action_delete_task`). */
  toolName?: string;
}

export interface UseHitlInChatReturn {
  /**
   * Map keyed by toolCallId. Pass directly to `<ChatbotEnhanced
   * toolDecisions={…}>` to render inline status under each pending tool.
   */
  decisions: Record<string, ToolDecisionState>;
  /**
   * Approve / reject handler — wire to `onToolApprove`. Looks up the
   * `pendingActionId` registered by `mapMessages` for the given toolCallId
   * and calls the matching REST endpoint.
   */
  decide: (toolCallId: string, approved: boolean, reason?: string) => Promise<void>;
  /**
   * True while at least one in-flight REST call is outstanding.
   * (Useful for disabling chat input while approvals settle, if desired.)
   */
  isDeciding: boolean;
}

function normalizeBase(base?: string): string {
  if (!base || base.length === 0) return '/api/v1/ai';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function buildHeaders(
  base: Record<string, string> | undefined,
  body: boolean,
): HeadersInit {
  const headers: Record<string, string> = { ...(base ?? {}) };
  if (body) headers['Content-Type'] = 'application/json';
  return headers;
}

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text } as Record<string, unknown>;
  }
}

export function useHitlInChat(options: UseHitlInChatOptions): UseHitlInChatReturn {
  const { messages, apiBase, headers, onDecided, continueConversation } = options;
  const base = normalizeBase(apiBase);

  // Index toolCallId → { pendingActionId, toolName } from the latest
  // messages. Memoised because messages stream tick-by-tick and we don't
  // want to rebuild the map on every keystroke.
  const idMap = React.useMemo(() => {
    const map = new Map<string, { pendingActionId: string; toolName: string }>();
    for (const msg of messages) {
      const tools = msg.toolInvocations ?? [];
      for (const tool of tools) {
        if (tool.pendingActionId && tool.toolCallId) {
          map.set(tool.toolCallId, {
            pendingActionId: tool.pendingActionId,
            toolName: tool.toolName,
          });
        }
      }
    }
    return map;
  }, [messages]);

  const [decisions, setDecisions] = React.useState<Record<string, ToolDecisionState>>({});
  const inflightRef = React.useRef(0);
  const [isDeciding, setIsDeciding] = React.useState(false);

  const setDecision = React.useCallback(
    (toolCallId: string, next: ToolDecisionState | undefined) => {
      setDecisions((prev) => {
        if (!next) {
          if (!(toolCallId in prev)) return prev;
          const { [toolCallId]: _omit, ...rest } = prev;
          return rest;
        }
        return { ...prev, [toolCallId]: next };
      });
    },
    [],
  );

  const decide = React.useCallback(
    async (toolCallId: string, approved: boolean, reason?: string) => {
      const entry = idMap.get(toolCallId);
      if (!entry) {
        setDecision(toolCallId, {
          state: 'error',
          message:
            'No pending-action id found for this tool call. The tool result may not be a HITL proposal.',
        });
        return;
      }
      const { pendingActionId: id, toolName } = entry;
      setDecision(toolCallId, {
        state: 'pending',
        message: approved ? 'Approving…' : 'Rejecting…',
      });
      inflightRef.current += 1;
      setIsDeciding(true);
      try {
        const url = `${base}/pending-actions/${encodeURIComponent(id)}/${
          approved ? 'approve' : 'reject'
        }`;
        const body = approved ? '{}' : JSON.stringify({ reason: reason ?? '' });
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: buildHeaders(headers, true),
          body,
        });
        const payload = (await parseJson(response)) ?? {};
        if (!response.ok) {
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : `Approval failed: HTTP ${response.status}`;
          setDecision(toolCallId, { state: 'error', message });
          // Not a wire response: on a non-2xx there IS no decision response, so
          // this envelope is synthesized locally to notify `onDecided`. The
          // `id` stays on it deliberately — it has been part of what consumers
          // receive on this path since the callback shipped, and objectui#3783
          // is a type-only correction (`ApproveOutcome` no longer DECLARES
          // `id`, because the approve wire never carried one). What the
          // callback SHOULD be handed on transport/HTTP failure is a public
          // contract question, filed as objectui#3790, not settled here.
          onDecided?.(toolCallId, {
            id,
            status: 'failed',
            error: message,
          } as ApproveOutcome);
          return;
        }
        const status = (payload.status as string) ?? (approved ? 'executed' : 'rejected');
        let succeeded = false;
        if (status === 'executed') {
          setDecision(toolCallId, {
            state: 'success',
            message: 'Approved — action executed.',
          });
          succeeded = true;
        } else if (status === 'rejected') {
          setDecision(toolCallId, {
            state: 'success',
            message: reason ? `Rejected: ${reason}` : 'Rejected.',
          });
          succeeded = true;
        } else if (status === 'failed') {
          const errMsg = (payload.error as string) ?? 'Action approved but execution failed.';
          setDecision(toolCallId, { state: 'error', message: errMsg });
        } else {
          setDecision(toolCallId, { state: 'success', message: `Status: ${status}` });
          succeeded = true;
        }
        onDecided?.(toolCallId, payload as ApproveOutcome | RejectOutcome);

        // Close the conversation loop. We only continue on a clean
        // success — execution failures stay visible in `decisions` so the
        // operator can react manually instead of feeding the model a
        // confusing "approved but failed" envelope.
        if (succeeded && continueConversation) {
          const prompt = buildContinuationPrompt({
            approved,
            status,
            toolName,
            pendingActionId: id,
            outcome: payload,
            reason,
          });
          if (prompt) {
            continueConversation(prompt, {
              toolCallId,
              pendingActionId: id,
              decision: approved ? 'approved' : 'rejected',
              outcome: payload as ApproveOutcome | RejectOutcome,
              toolName,
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDecision(toolCallId, { state: 'error', message });
      } finally {
        inflightRef.current -= 1;
        if (inflightRef.current <= 0) {
          inflightRef.current = 0;
          setIsDeciding(false);
        }
      }
    },
    [base, headers, idMap, onDecided, continueConversation, setDecision],
  );

  return { decisions, decide, isDeciding };
}

/**
 * Build the synthetic follow-up prompt fed back to the LLM after the
 * operator decides. Kept terse on purpose — every extra token costs the
 * caller money and most agents only need the bare facts to continue.
 */
function buildContinuationPrompt(input: {
  approved: boolean;
  status: string;
  toolName: string;
  pendingActionId: string;
  outcome: Record<string, unknown>;
  reason?: string;
}): string | undefined {
  const { approved, status, toolName, pendingActionId, outcome, reason } = input;
  const tag = `[HITL ${pendingActionId}]`;
  if (approved && status === 'executed') {
    const result = outcome.result;
    const resultText =
      result === undefined || result === null
        ? '(no payload)'
        : typeof result === 'string'
          ? result
          : truncate(JSON.stringify(result), 800);
    return (
      `${tag} The operator approved the \`${toolName}\` call. It executed successfully ` +
      `with result: ${resultText}. Acknowledge the outcome concisely and continue the user's task.`
    );
  }
  if (!approved && status === 'rejected') {
    const reasonText = reason && reason.trim().length > 0 ? ` Reason: ${reason}.` : '';
    return (
      `${tag} The operator rejected the \`${toolName}\` call.${reasonText} ` +
      `Acknowledge the rejection and ask whether to try a different approach.`
    );
  }
  if (status === 'failed') {
    const err = outcome.error;
    const errText = typeof err === 'string' ? err : truncate(JSON.stringify(err ?? {}), 400);
    return (
      `${tag} The \`${toolName}\` call was approved but execution failed: ${errText}. ` +
      `Apologize concisely and offer alternatives.`
    );
  }
  return undefined;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

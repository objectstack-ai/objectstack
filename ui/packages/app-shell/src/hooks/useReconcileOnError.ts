/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useRef, useState } from 'react';
import { fetchConversation, toUIMessages } from './useChatConversation.js';
import { isReconcilableCompletedTurn } from '../console/ai/reconcileTurn.js';

/**
 * ADR-0013 D2 — shared "reconcile a stream-transport failure instead of
 * blindly retrying" wiring, used by every chat surface (AiChatPage and the
 * console floating chatbot) so the behaviour is identical.
 *
 * The agent runtime persists the final assistant reply BEFORE it streams it
 * (framework `service-ai`), so a network drop AFTER the turn completed leaves a
 * complete reply server-side while the client only sees a stream error. On
 * error we GET the conversation and, if the turn actually finished
 * (`isReconcilableCompletedTurn`), re-hydrate the thread with the persisted
 * messages and suppress the scary "Response failed / Retry" banner — the
 * failure becomes a non-event. A genuinely-incomplete turn still surfaces
 * Retry, whose re-send is idempotent under D1 (same `turnId`).
 */
export interface ReconcileOnError {
  /** True when the last stream error was reconciled away (turn had completed). */
  errorSuppressed: boolean;
  /** Wire as `useObjectChat({ onError })`. */
  handleChatError: (err: Error) => Promise<void>;
  /**
   * Assign `ref.current = setMessages` from `useObjectChat` (API mode) so the
   * thread can be re-hydrated from the server on a reconcilable failure.
   */
  setMessagesRef: React.MutableRefObject<((m: unknown[]) => void) | undefined>;
  /** Call when a fresh turn is sent, to clear any prior suppression. */
  resetSuppression: () => void;
}

export function useReconcileOnError(opts: {
  /** The agent chat endpoint, e.g. `${apiBase}/agents/:name/chat`. */
  chatApi?: string;
  /** Active conversation id (no reconciliation possible without one). */
  conversationId?: string;
}): ReconcileOnError {
  const { chatApi, conversationId } = opts;
  const [errorSuppressed, setErrorSuppressed] = useState(false);
  const setMessagesRef = useRef<((m: unknown[]) => void) | undefined>(undefined);

  const handleChatError = useCallback(
    async (_err: Error) => {
      // A request rejected BEFORE any reply streamed (429 rate-limit, 5xx, or a
      // network failure — tagged `notSent` by sendAwareFetch) never reached the
      // server: there is no completed turn to reconcile and NOTHING to suppress.
      // Surfacing it is the whole point — the composer shows the error + restores
      // the input (useObjectChat already rolled back the optimistic user bubble).
      // Without this guard, a 429 after a few turns looked like a completed turn
      // (the thread still ends with the PREVIOUS assistant reply) and got
      // silently reconciled away — the reported "message vanished, no error".
      if ((_err as { notSent?: boolean })?.notSent) {
        setErrorSuppressed(false);
        return;
      }
      const aiBase = chatApi?.replace(/\/agents\/[^/]+\/chat$/, '');
      if (!conversationId || !aiBase) {
        setErrorSuppressed(false);
        return;
      }
      try {
        const conv = await fetchConversation(aiBase, conversationId);
        const ui = toUIMessages(conv?.messages);
        if (isReconcilableCompletedTurn(ui) && setMessagesRef.current) {
          // No assertion here: `toUIMessages` returns `HydratedUIMessage[]`, which
          // widens to the sink's `unknown[]` on its own. Asserting would erase the
          // diagnostic on this exact seam if either side is ever tightened
          // (objectui#8379; the class of objectui#4424 / #8342).
          setMessagesRef.current(ui);
          setErrorSuppressed(true);
          return;
        }
      } catch {
        /* fall through to the normal error banner */
      }
      setErrorSuppressed(false);
    },
    [conversationId, chatApi],
  );

  const resetSuppression = useCallback(() => setErrorSuppressed(false), []);

  return { errorSuppressed, handleChatError, setMessagesRef, resetSuppression };
}

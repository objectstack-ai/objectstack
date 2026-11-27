/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/**
 * The localStorage key prefix of the question-card skip marks. One key per
 * conversation, `PREFIX:CONVERSATION_ID`, whose value is the JSON list of the
 * question tool-call ids the user skipped there.
 *
 * A skip is device-local on purpose: the server keeps no question state, and
 * an answered or skipped question reads the same in the transcript. Sign-out
 * clears every key under this prefix with the rest of the chat cache.
 */
export const QUESTION_SKIP_STORAGE_PREFIX = 'objectstack:ai-chat-question-skip';

function storageKey(conversationId: string): string {
  return `${QUESTION_SKIP_STORAGE_PREFIX}:${conversationId}`;
}

/** The skipped question ids stored for a conversation; empty when storage is unreadable. */
export function readQuestionSkips(conversationId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(conversationId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Store one more skipped question id for a conversation. Storage failures are ignored. */
export function writeQuestionSkip(conversationId: string, toolCallId: string): void {
  try {
    const ids = readQuestionSkips(conversationId);
    if (ids.includes(toolCallId)) return;
    localStorage.setItem(storageKey(conversationId), JSON.stringify([...ids, toolCallId]));
  } catch {
    /* private mode, quota, disabled storage: the skip holds for this view only */
  }
}

/**
 * The skipped question ids of a conversation and a `skip` that records one.
 * Without a conversation id (a host that names none) a skip holds for the
 * mounted view only.
 */
export function useQuestionSkips(conversationId: string | undefined): {
  skipped: ReadonlySet<string>;
  skip: (toolCallId: string) => void;
} {
  const [local, setLocal] = React.useState<{ conversationId: string | undefined; ids: readonly string[] }>(
    () => ({ conversationId, ids: [] }),
  );
  const ids = local.conversationId === conversationId ? local.ids : [];
  // What earlier views stored; a skip made in this view is in `ids` as well.
  const stored = React.useMemo(
    () => (conversationId ? readQuestionSkips(conversationId) : []),
    [conversationId],
  );
  const skipped = React.useMemo(() => new Set([...stored, ...ids]), [stored, ids]);
  const skip = React.useCallback(
    (toolCallId: string) => {
      if (conversationId) writeQuestionSkip(conversationId, toolCallId);
      setLocal((prev) => {
        const prevIds = prev.conversationId === conversationId ? prev.ids : [];
        return { conversationId, ids: prevIds.includes(toolCallId) ? prevIds : [...prevIds, toolCallId] };
      });
    },
    [conversationId],
  );
  return { skipped, skip };
}

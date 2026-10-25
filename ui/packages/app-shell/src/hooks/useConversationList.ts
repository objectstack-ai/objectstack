// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Loads the signed-in user's AI conversation history.
 *
 * Backed by `GET /api/v1/ai/conversations` exposed by
 * `@objectstack/service-ai`. The endpoint already filters by
 * `req.user.userId` server-side so we just forward credentials.
 */

import { useCallback, useEffect, useState } from 'react';
import { publishPlanApprovalPending } from '../assistant/assistantBus.js';

/**
 * One row of the conversation-history list.
 *
 * Named `ConversationListItem`, not `ConversationSummary`:
 * `@objectstack/spec/ai` already exports a `ConversationSummary`, and it is a
 * different artifact entirely — the AI context-compaction record
 * (`summary`, `keyPoints`, `originalTokens`, `summaryTokens`, `tokensSaved`,
 * `messageRange`, `generatedAt`, `modelId`). The two share no key at all. This
 * is the list row `GET /api/v1/ai/conversations` returns.
 * `__tests__/spec-symbol-parity.test.ts` pins that the spec does not own this
 * name (objectstack#4115).
 */
export interface ConversationListItem {
  id: string;
  title?: string;
  agentId?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Preview text derived from the most recent message, if available. */
  preview?: string;
}

export interface UseConversationListOptions {
  userId: string | undefined;
  apiBase: string;
  limit?: number;
  /** Bump to force a refetch (e.g. after creating/deleting a conversation). */
  refreshKey?: number | string;
}

export interface UseConversationListReturn {
  conversations: ConversationListItem[];
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
}

interface ServerConversation {
  id: string;
  title?: string;
  agentId?: string;
  createdAt?: string;
  updatedAt?: string;
  preview?: unknown;
  messages?: Array<{ role: string; content: unknown }>;
}

const PLACEHOLDER_TITLES = new Set([
  'new chat',
  'new conversation',
  'untitled',
  '新对话',
]);

function isPlaceholderTitle(title: string | undefined): boolean {
  const normalized = title?.trim().toLowerCase();
  return !normalized || PLACEHOLDER_TITLES.has(normalized);
}

function extractPreview(row: ServerConversation): string | undefined {
  const messages = row.messages;
  if (!messages || messages.length === 0) return undefined;
  // Prefer the most recent user message, fall back to last message.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') {
      const text = stringifyContent(m.content);
      if (text) return text;
    }
  }
  const last = messages[messages.length - 1];
  return stringifyContent(last?.content);
}

function stringifyContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.slice(0, 140);
  if (
    content &&
    typeof content === 'object' &&
    'text' in content &&
    typeof (content as { text?: unknown }).text === 'string'
  ) {
    return (content as { text: string }).text.slice(0, 140);
  }
  if (
    content &&
    typeof content === 'object' &&
    'parts' in content &&
    Array.isArray((content as { parts?: unknown }).parts)
  ) {
    return stringifyContent((content as { parts: unknown[] }).parts);
  }
  if (Array.isArray(content)) {
    const text = content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && 'text' in p && typeof (p as { text?: unknown }).text === 'string') {
          return (p as { text: string }).text;
        }
        return '';
      })
      .join('');
    return text ? text.slice(0, 140) : undefined;
  }
  return undefined;
}

function normalize(row: ServerConversation): ConversationListItem {
  const title = row.title?.trim();
  const preview = extractPreview(row) ?? stringifyContent(row.preview);
  return {
    id: row.id,
    title: isPlaceholderTitle(title) ? undefined : title,
    agentId: row.agentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    preview,
  };
}

async function fetchConversationDetail(
  apiBase: string,
  id: string,
): Promise<ConversationListItem | undefined> {
  const res = await fetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
    credentials: 'include',
  });
  if (!res.ok) return undefined;
  const body = (await res.json()) as ServerConversation | { conversation?: ServerConversation };
  const row = 'conversation' in body && body.conversation ? body.conversation : body;
  return normalize(row as ServerConversation);
}

export function useConversationList(
  options: UseConversationListOptions,
): UseConversationListReturn {
  const { userId, apiBase, limit = 50, refreshKey } = options;
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(userId));
  const [error, setError] = useState<Error | undefined>(undefined);
  const [internalKey, setInternalKey] = useState(0);

  const refetch = useCallback(async () => {
    setInternalKey((k) => k + 1);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } finally {
        setConversations((rows) => rows.filter((r) => r.id !== id));
        // objectui#11666 — a deleted thread has no plan left to approve, so
        // its launcher-marker reading goes with the row.
        publishPlanApprovalPending({ userId, conversationId: id, pending: false });
      }
    },
    [apiBase, userId],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim();
      // Optimistic update so the sidebar reflects the new title immediately.
      setConversations((rows) =>
        rows.map((r) => (r.id === id ? { ...r, title: trimmed || undefined } : r)),
      );
      const res = await fetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        // Roll back by refetching.
        setInternalKey((k) => k + 1);
        throw new Error(`PATCH conversation failed: ${res.status}`);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (!userId) {
      setConversations([]);
      setIsLoading(false);
      setError(undefined);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);
    (async () => {
      try {
        const res = await fetch(
          `${apiBase}/conversations?limit=${encodeURIComponent(String(limit))}`,
          { credentials: 'include' },
        );
        if (!res.ok) throw new Error(`GET conversations failed: ${res.status}`);
        const body = (await res.json()) as
          | ServerConversation[]
          | { conversations?: ServerConversation[]; items?: ServerConversation[] };
        const rows: ServerConversation[] = Array.isArray(body)
          ? body
          : (body.conversations ?? body.items ?? []);
        if (cancelled) return;
        const sorted = rows
          .map(normalize)
          .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
        setConversations(sorted);
        const needsPreview = sorted
          .filter((row) => !row.title && !row.preview)
          .slice(0, 20);
        if (needsPreview.length > 0) {
          const details = await Promise.all(
            needsPreview.map((row) => fetchConversationDetail(apiBase, row.id).catch(() => undefined)),
          );
          if (cancelled) return;
          const byId = new Map(
            details
              .filter((row): row is ConversationListItem => Boolean(row?.preview || row?.title))
              .map((row) => [row.id, row]),
          );
          if (byId.size > 0) {
            setConversations((current) =>
              current.map((row) => {
                const detail = byId.get(row.id);
                if (!detail) return row;
                return {
                  ...row,
                  title: row.title ?? detail.title,
                  preview: row.preview ?? detail.preview,
                };
              }),
            );
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setConversations([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, apiBase, limit, internalKey, refreshKey]);

  return { conversations, isLoading, error, refetch, remove, rename };
}

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Loads the signed-in user's AI conversation history.
 *
 * Backed by `GET /api/v1/ai/conversations` exposed by
 * `@objectstack/service-ai`. The endpoint already filters by
 * `req.user.userId` server-side so we just forward credentials.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { publishPlanApprovalPending } from '../assistant/assistantBus.js';
import { isHitlContinuation } from '@object-ui/plugin-chatbot/core';
import { createAuthenticatedFetch } from '@object-ui/auth';

/** The console's authenticated fetch: the stored bearer token beside the session cookie. */
function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return createAuthenticatedFetch()(input, init);
}

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
  /**
   * `AiConversationSchema.metadata` (`@objectstack/spec/api`) as the list row
   * carries it; absent when the row carries none or a value that is not a record.
   */
  metadata?: Record<string, unknown>;
}

export interface UseConversationListOptions {
  userId: string | undefined;
  apiBase: string;
  limit?: number;
  /** Bump to force a refetch (e.g. after creating/deleting a conversation). */
  refreshKey?: number | string;
  /**
   * The rows the caller actually shows, picked from the sorted list page. Only
   * those rows have their missing title and preview read from each one's
   * detail route, so a caller that lists a few rows of a long page never waits
   * on detail reads for rows it does not draw. Absent: every listed row
   * qualifies. Read when the list answers, never as an effect dependency, so
   * pass `refreshKey` when what it selects by changes.
   */
  selectBackfillRows?: (rows: readonly ConversationListItem[]) => readonly ConversationListItem[];
}

/** The most detail reads one list read backfills previews with. */
export const MAX_PREVIEW_BACKFILL = 20;

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
  metadata?: unknown;
}

function readMetadata(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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
  // objectstack#30223 — a HITL continuation (the turn the chat sends the model
  // after 确认 / 取消) is stored as a user message but is not the person's
  // words, so the preview reads past it to what they actually asked.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') {
      const text = stringifyContent(m.content);
      if (text && !isHitlContinuation(text)) return text;
    }
  }
  const last = messages[messages.length - 1];
  const fallback = stringifyContent(last?.content);
  return isHitlContinuation(fallback) ? undefined : fallback;
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
  const served = stringifyContent(row.preview);
  const preview = extractPreview(row) ?? (isHitlContinuation(served) ? undefined : served);
  return {
    id: row.id,
    title: isPlaceholderTitle(title) ? undefined : title,
    agentId: row.agentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    preview,
    metadata: readMetadata(row.metadata),
  };
}

async function fetchConversationDetail(
  apiBase: string,
  id: string,
): Promise<ConversationListItem | undefined> {
  const res = await authFetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
    credentials: 'include',
  });
  if (!res.ok) return undefined;
  const body = (await res.json()) as ServerConversation | { conversation?: ServerConversation };
  const row = 'conversation' in body && body.conversation ? body.conversation : body;
  return normalize(row as ServerConversation);
}

/**
 * One conversation's history row, read by id; `null` when the server answers
 * that it is gone or not this user's (404, 403). Any other failure throws, so
 * a network blip never reads as a deleted conversation.
 */
export async function readConversationRow(apiBase: string, id: string): Promise<ConversationListItem | null> {
  const res = await authFetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
    credentials: 'include',
  });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw Object.assign(new Error(`GET conversation failed: ${res.status}`), { status: res.status });
  const body = (await res.json()) as ServerConversation | { conversation?: ServerConversation };
  const row = 'conversation' in body && body.conversation ? body.conversation : body;
  return normalize(row as ServerConversation);
}

export function useConversationList(
  options: UseConversationListOptions,
): UseConversationListReturn {
  const { userId, apiBase, limit = 50, refreshKey, selectBackfillRows } = options;
  const selectBackfillRowsRef = useRef(selectBackfillRows);
  selectBackfillRowsRef.current = selectBackfillRows;
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
        await authFetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
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
      const res = await authFetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
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
        const res = await authFetch(
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
        const shown = selectBackfillRowsRef.current?.(sorted) ?? sorted;
        const needsPreview = shown
          .filter((row) => !row.title && !row.preview)
          .slice(0, MAX_PREVIEW_BACKFILL);
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

export interface UseConversationLabelOptions {
  apiBase: string;
  /** The conversation the drawer shows; absent before the first send creates it. */
  conversationId: string | undefined;
  /** Bump to read the label again (a sent turn, the server titling the thread). */
  refreshKey?: number | string;
}

export interface ConversationLabelReading {
  /** The label the history list gives this conversation's row; absent when it has none yet. */
  label: string | undefined;
  /** False while the label of the conversation now shown has not been read yet. */
  settled: boolean;
}

/**
 * ui ADR-0057 Amendment A5 — the drawer's header names the conversation it
 * shows by the label its history row carries: the title the server gave it,
 * else the latest message the user wrote in it (`normalize`, the list's own
 * reading of one row). A read that fails settles with no label.
 */
export function useConversationLabel({
  apiBase,
  conversationId,
  refreshKey,
}: UseConversationLabelOptions): ConversationLabelReading {
  const [reading, setReading] = useState<{ id: string; label: string | undefined } | undefined>(undefined);
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    fetchConversationDetail(apiBase, conversationId).then(
      (row) => {
        if (!cancelled) setReading({ id: conversationId, label: row?.title || row?.preview || undefined });
      },
      () => {
        if (!cancelled) setReading({ id: conversationId, label: undefined });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apiBase, conversationId, refreshKey]);
  if (!conversationId) return { label: undefined, settled: true };
  return reading?.id === conversationId ? { label: reading.label, settled: true } : { label: undefined, settled: false };
}

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Left sidebar listing the signed-in user's AI conversations. Active row is
 * derived from `useParams<{ conversationId }>()`; clicking a row navigates to
 * `/ai/:id`, the "New chat" button navigates to `/ai`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Pencil, MessageSquare, Search, Check, X } from 'lucide-react';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import {
  Button,
  Input,
  ScrollArea,
  Empty,
  EmptyTitle,
  EmptyDescription,
  cn,
} from '@object-ui/components';
import { agentAliasGroup, agentRouteName } from '@object-ui/plugin-chatbot/core';
import { useConversationList, type ConversationListItem } from '../../hooks/useConversationList.js';

export interface ConversationsSidebarProps {
  userId: string | undefined;
  apiBase: string;
  /**
   * Backend name of the surface's active agent. When set, the list is scoped to
   * this agent's conversations (each `/ai/:agent` surface shows its own history)
   * and New/delete navigation stays on the surface. Alias-aware, so legacy and
   * new ids match. Omit for an unscoped, all-agents list.
   */
  activeAgent?: string;
  /**
   * cloud#1674 maker convergence — also list the built-in `ask` agent's
   * conversations alongside the active agent's. On the converged maker surface
   * the ask picker entry is gone, so this sidebar is the ONLY road back to a
   * maker's pre-convergence ask history; each row already navigates to its own
   * agent's surface (`/ai/ask/:id`), which still renders. Alias-aware.
   */
  includeAskConversations?: boolean;
  className?: string;
  refreshKey?: number | string;
  titleHints?: Record<string, string>;
  onNavigate?: () => void;
}

function formatTimestamp(
  iso: string | undefined,
  t: ReturnType<typeof useObjectTranslation>['t'],
  locale: string,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return t('console.ai.justNow');
  if (diff < hour) return t('console.ai.minutesAgo', { count: Math.floor(diff / min) });
  if (diff < day) return t('console.ai.hoursAgo', { count: Math.floor(diff / hour) });
  if (diff < 7 * day) return t('console.ai.daysAgo', { count: Math.floor(diff / day) });
  // The 7-days-and-older tail is a date, in the DISPLAY locale the row threads
  // — a bare `toLocaleDateString()` fell out of the translated buckets above
  // straight into the MACHINE's locale (objectui#9909; objectui#3441's shape).
  return d.toLocaleDateString(locale);
}

/**
 * Full, locale-aware date+time for the row's `title` tooltip. The visible
 * label is relative ("2 minutes ago") which is scannable but vague — hovering
 * reveals the exact moment, matching ChatGPT/Claude. Returns '' for a missing
 * or invalid timestamp so no empty tooltip appears.
 */
function absoluteTimestamp(iso: string | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale);
}

export type ConversationGroupKey = 'today' | 'yesterday' | 'previous7Days' | 'previous30Days' | 'older';

export interface ConversationGroup {
  key: ConversationGroupKey;
  items: ConversationListItem[];
}

const GROUP_ORDER: ConversationGroupKey[] = ['today', 'yesterday', 'previous7Days', 'previous30Days', 'older'];

/** English fallbacks for the section headers (overridable via i18n). */
export const CONVERSATION_GROUP_LABELS: Record<ConversationGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  previous7Days: 'Previous 7 days',
  previous30Days: 'Previous 30 days',
  older: 'Older',
};

/**
 * Bucket conversations into recency sections (ChatGPT/Claude-style), newest
 * first within each. Boundaries are calendar-day based off local midnight, so
 * "Today"/"Yesterday" track the actual day rather than a rolling 24h. Pure +
 * exported for tests; `nowMs` defaults to the current time (kept out of the
 * component's render path). Empty sections are omitted.
 */
export function groupConversationsByDate(
  conversations: ConversationListItem[],
  nowMs: number = Date.now(),
): ConversationGroup[] {
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const DAY = 24 * 60 * 60 * 1000;
  const stamp = (c: ConversationListItem): number => {
    const v = new Date(c.updatedAt ?? c.createdAt ?? 0).getTime();
    return Number.isNaN(v) ? 0 : v;
  };
  const buckets: Record<ConversationGroupKey, ConversationListItem[]> = {
    today: [],
    yesterday: [],
    previous7Days: [],
    previous30Days: [],
    older: [],
  };
  for (const c of [...conversations].sort((a, b) => stamp(b) - stamp(a))) {
    const v = stamp(c);
    if (v >= todayMs) buckets.today.push(c);
    else if (v >= todayMs - DAY) buckets.yesterday.push(c);
    else if (v >= todayMs - 7 * DAY) buckets.previous7Days.push(c);
    else if (v >= todayMs - 30 * DAY) buckets.previous30Days.push(c);
    else buckets.older.push(c);
  }
  return GROUP_ORDER.filter((k) => buckets[k].length > 0).map((key) => ({ key, items: buckets[key] }));
}

export function ConversationsSidebar({
  userId,
  apiBase,
  activeAgent,
  includeAskConversations,
  className,
  refreshKey,
  titleHints,
  onNavigate,
}: ConversationsSidebarProps) {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const { conversationId: activeId } = useParams<{ conversationId?: string }>();
  const { conversations, isLoading, error, remove, rename } = useConversationList({
    userId,
    apiBase,
    refreshKey,
  });

  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);

  // Friendly route segment for New/delete navigation (stays on this surface).
  const agentRoute = activeAgent ? agentRouteName(activeAgent) : undefined;
  // Names equivalent to the active agent, for scoping the list (alias-aware).
  // With `includeAskConversations` (cloud#1674) BOTH built-in groups join the
  // scope — the converged maker sees ONE merged history whether the open
  // thread is a build one or a legacy ask one (merging only ask would make the
  // build history vanish the moment an ask thread is opened; measured on the
  // first in-browser pass).
  const agentGroup = useMemo(() => {
    if (!activeAgent) return undefined;
    const names = new Set(agentAliasGroup(activeAgent));
    if (includeAskConversations) {
      for (const n of agentAliasGroup('ask')) names.add(n);
      for (const n of agentAliasGroup('build')) names.add(n);
    }
    return names;
  }, [activeAgent, includeAskConversations]);

  const decoratedConversations = useMemo(() => {
    return conversations.map((conversation) => {
      const hint = titleHints?.[conversation.id]?.trim();
      if (!hint || conversation.title?.trim() || conversation.preview?.trim()) {
        return conversation;
      }
      return { ...conversation, preview: hint };
    });
  }, [conversations, titleHints]);

  // Scope to this surface's agent. Lenient: a conversation with no agent yet
  // (freshly created, pre-first-message) and the currently-open one are always
  // kept so nothing the user is looking at can vanish from the list.
  const scoped = useMemo(() => {
    if (!agentGroup) return decoratedConversations;
    return decoratedConversations.filter(
      (c) => !c.agentId || agentGroup.has(c.agentId) || c.id === activeId,
    );
  }, [decoratedConversations, agentGroup, activeId]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((c) => {
      const hay = `${c.title ?? ''} ${c.preview ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [scoped, filter]);

  // Navigate to a conversation on its OWN agent surface (so a lenient
  // cross-agent row still opens correctly); fall back to this surface.
  const conversationHref = useCallback(
    (c: ConversationListItem) => {
      const seg = c.agentId ? agentRouteName(c.agentId) : agentRoute;
      return seg ? `/ai/${seg}/${c.id}` : `/ai/${c.id}`;
    },
    [agentRoute],
  );

  const handleNew = useCallback(() => {
    // `?new=1` is the explicit new-conversation intent — a bare surface visit
    // resumes the last cached conversation (by design), so without the flag
    // this button silently landed back on the current chat. Stays on the
    // active agent's surface.
    navigate(agentRoute ? `/ai/${agentRoute}?new=1` : '/ai?new=1');
    onNavigate?.();
  }, [navigate, agentRoute, onNavigate]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      await remove(id);
      if (id === activeId) {
        navigate(agentRoute ? `/ai/${agentRoute}` : '/ai', { replace: true });
        onNavigate?.();
      }
    },
    [remove, activeId, navigate, agentRoute, onNavigate],
  );

  const handleRenameSubmit = useCallback(
    async (id: string, title: string) => {
      setRenamingId(undefined);
      try {
        await rename(id, title);
      } catch {
        // optimistic update already rolled back via refetch in the hook
      }
    },
    [rename],
  );

  return (
    <aside
      className={cn('flex h-full min-h-0 flex-col bg-muted/30', className)}
      data-testid="ai-conversations-sidebar"
    >
      <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('console.ai.chats')}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleNew}
            data-testid="ai-new-chat"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('console.ai.newChat')}
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('console.ai.searchChats')}
            className="h-7 pl-7 text-xs"
            data-testid="ai-conversations-search"
          />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {isLoading && conversations.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">{t('common.loading')}</div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-destructive">
            {error.message}
          </div>
        ) : scoped.length === 0 ? (
          <Empty className="px-3 py-8">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
            <EmptyTitle>{t('console.ai.noChatsYet')}</EmptyTitle>
            <EmptyDescription>{t('console.ai.noChatsDescription')}</EmptyDescription>
          </Empty>
        ) : visible.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">{t('console.ai.noMatchingChats')}</div>
        ) : (
          <div className="flex flex-col py-1">
            {groupConversationsByDate(visible).map((group) => (
              <section key={group.key} data-testid={`ai-conversation-group-${group.key}`}>
                <h3 className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`console.ai.group.${group.key}`, { defaultValue: CONVERSATION_GROUP_LABELS[group.key] })}
                </h3>
                <ul className="flex flex-col">
                  {group.items.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conversation={c}
                      query={filter.trim()}
                      active={c.id === activeId}
                      renaming={c.id === renamingId}
                      onSelect={() => {
                        navigate(conversationHref(c));
                        onNavigate?.();
                      }}
                      onDelete={(e) => handleDelete(e, c.id)}
                      onStartRename={() => setRenamingId(c.id)}
                      onCancelRename={() => setRenamingId(undefined)}
                      onSubmitRename={(title) => handleRenameSubmit(c.id, title)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}

interface RowProps {
  conversation: ConversationListItem;
  /** Active search query — matched substrings are highlighted in title/preview. */
  query?: string;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: (title: string) => void;
}

/**
 * Wrap each case-insensitive occurrence of `query` inside `text` in a styled
 * <mark>, so a conversation-list search makes clear WHICH term matched a row.
 * Returns the text untouched when there is no active query (the common case),
 * so non-searching renders pay nothing.
 */
function highlightQuery(text: string | undefined | null, query: string | undefined): ReactNode {
  if (!text) return text ?? null;
  const needle = query?.trim().toLowerCase();
  if (!needle) return text;
  const haystack = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={key++} className="rounded-[2px] bg-primary/20 px-0.5 text-foreground">
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    cursor = idx + needle.length;
  }
  return parts;
}

function ConversationRow({
  conversation,
  query,
  active,
  renaming,
  onSelect,
  onDelete,
  onStartRename,
  onCancelRename,
  onSubmitRename,
}: RowProps) {
  const { t } = useObjectTranslation();
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  const title = conversation.title?.trim() || conversation.preview?.trim() || t('console.ai.newConversation');
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setDraft(conversation.title?.trim() || conversation.preview?.trim() || '');
      // Focus the input on next paint so the click that opened it doesn't blur immediately.
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [renaming, conversation.title, conversation.preview]);

  if (renaming) {
    return (
      <li>
        <div
          className={cn(
            'flex w-full items-center gap-1 border-l-2 px-3 py-2',
            active ? 'border-primary bg-accent' : 'border-transparent',
          )}
          data-testid={`ai-conversation-rename-row-${conversation.id}`}
        >
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmitRename(draft);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelRename();
              }
            }}
            className="h-7 flex-1 text-sm"
            data-testid={`ai-conversation-rename-input-${conversation.id}`}
            aria-label={t('console.ai.renameConversation')}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => onSubmitRename(draft)}
            data-testid={`ai-conversation-rename-confirm-${conversation.id}`}
            aria-label={t('console.ai.saveRename')}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onCancelRename}
            aria-label={t('console.ai.cancelRename')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li>
      <div
        className={cn(
          'group flex w-full items-start gap-2 border-l-2 border-transparent px-3 py-2 text-sm transition-colors hover:bg-accent/50',
          active && 'border-primary bg-accent',
        )}
        data-testid={`ai-conversation-row-${conversation.id}`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
          data-testid={`ai-conversation-select-${conversation.id}`}
        >
          <span className="line-clamp-1 font-medium">{highlightQuery(title, query)}</span>
          {conversation.preview && conversation.preview !== title ? (
            <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">
              {highlightQuery(conversation.preview, query)}
            </span>
          ) : null}
          <span
            className="mt-0.5 block text-[10px] text-muted-foreground"
            title={absoluteTimestamp(conversation.updatedAt ?? conversation.createdAt, displayLocale)}
          >
            {formatTimestamp(conversation.updatedAt ?? conversation.createdAt, t, displayLocale)}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:text-primary"
            onClick={onStartRename}
            data-testid={`ai-conversation-rename-${conversation.id}`}
            aria-label={t('console.ai.renameConversation')}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:text-destructive"
            onClick={onDelete}
            data-testid={`ai-conversation-delete-${conversation.id}`}
            aria-label={t('console.ai.deleteConversation')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

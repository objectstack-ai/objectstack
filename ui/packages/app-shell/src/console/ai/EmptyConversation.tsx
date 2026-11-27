// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * EmptyConversation — the one layout a conversation shows before its first
 * message (objectstack#37862, topic objectstack#37853 C7): a greeting, a
 * line on what to ask, the composer, suggested questions and 「最近会话」
 * with each conversation's title.
 *
 * One component, three places, two sizes:
 * - the AI home page (`AppAskPage`, ui ADR-0057 A4), `large`, drawing its own
 *   large question box in the `composer` slot; a recent conversation opens on
 *   that page;
 * - the drawer filling the window, `large`, and the narrow drawer (rail and
 *   phone sheet), `compact`. There the composer stays docked under the
 *   conversation (it carries the page chip, the focus row and queued sends),
 *   so the slot is empty; a recent conversation opens in the drawer.
 *
 * What a suggestion does is its `mode` (`emptyConversationModel.ts`): the host
 * sends a `send` one and puts a `fill` one in the composer.
 */

import * as React from 'react';
import { MessageSquare } from 'lucide-react';
import { useAuth } from '@object-ui/auth';
import { Button, cn } from '@object-ui/components';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { useConversationList, type ConversationListItem } from '../../hooks/useConversationList.js';
import { timeAgo } from '../../utils/relativeTime.js';
import {
  DRAWER_RECENT_COUNT,
  DRAWER_RECENT_FETCH_LIMIT,
  greetingForHour,
  greetingName,
  selectDrawerRecent,
  type EmptyConversationSize,
  type EmptySuggestion,
} from './emptyConversationModel.js';

/**
 * The time-of-day greeting with the user's name, as Home writes it: the name
 * in the primary colour, the pack's own separator and closing mark.
 */
export function EmptyConversationGreeting({ now }: { now?: Date }) {
  const { t } = useObjectTranslation();
  const { user } = useAuth();
  const hour = (now ?? new Date()).getHours();
  const { key, defaultValue } = greetingForHour(hour);
  const greeting = t(key, { defaultValue });
  const name = greetingName(user);
  return (
    <>
      <span className="text-foreground">
        {greeting}
        {name ? t('home.greetingSeparator', { defaultValue: ', ' }) : ''}
      </span>
      {name ? <span className="text-primary">{name}</span> : null}
      <span className="text-foreground/40">{t('home.greetingEnd', { defaultValue: '.' })}</span>
    </>
  );
}

export interface EmptyConversationProps {
  size: EmptyConversationSize;
  /** The heading: the greeting, or the AI home's declared title. */
  heading: React.ReactNode;
  /** The line under the heading. */
  subtitle?: string;
  /** The host's own question box (the AI home); absent where the composer is docked below. */
  composer?: React.ReactNode;
  suggestions: readonly EmptySuggestion[];
  /** A suggestion was clicked: the host sends it or fills the composer, by its `mode`. */
  onSuggestion: (suggestion: EmptySuggestion) => void;
  /** 「最近会话」, drawn last. */
  recent?: React.ReactNode;
  className?: string;
}

export function EmptyConversation({
  size,
  heading,
  subtitle,
  composer,
  suggestions,
  onSuggestion,
  recent,
  className,
}: EmptyConversationProps) {
  const { t } = useObjectTranslation();
  const large = size === 'large';
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center',
        large ? 'gap-6 px-4 py-10 sm:py-16' : 'gap-4 px-1 py-6',
        className,
      )}
      data-testid="empty-conversation"
      data-size={size}
    >
      <div className={cn('flex w-full flex-col items-center', large ? 'max-w-2xl gap-6' : 'gap-4')}>
        <div className={cn('flex flex-col items-center text-center', large ? 'gap-2' : 'gap-1')}>
          <h1
            className={cn(
              'break-words font-semibold tracking-tight text-pretty',
              large ? 'text-2xl sm:text-3xl' : 'text-lg',
            )}
            data-testid="empty-conversation-heading"
          >
            {heading}
          </h1>
          {subtitle ? (
            <p
              className={cn('break-words text-muted-foreground', large ? 'max-w-xl text-sm sm:text-base' : 'text-sm')}
              data-testid="empty-conversation-subtitle"
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {composer}
        {suggestions.length > 0 ? (
          <div
            role="group"
            aria-label={t('console.ai.suggestionsLabel', { defaultValue: 'Suggested questions' })}
            className={cn(
              'w-full',
              large
                ? cn('grid gap-2', suggestions.length > 1 && 'sm:grid-cols-2')
                : 'flex flex-wrap justify-center gap-2',
            )}
            data-testid="empty-conversation-suggestions"
          >
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion.text}
                type="button"
                variant="outline"
                className={cn(
                  'h-auto whitespace-normal break-words font-normal',
                  large
                    ? 'justify-start px-3 py-2 text-left text-sm'
                    : 'min-h-8 max-w-full rounded-full border-border/60 px-3 py-1 text-left text-xs',
                )}
                onClick={() => onSuggestion(suggestion)}
                data-testid="empty-conversation-suggestion"
                data-mode={suggestion.mode}
              >
                {suggestion.text}
              </Button>
            ))}
          </div>
        ) : null}
        {recent}
      </div>
    </div>
  );
}

export interface RecentConversationListProps {
  size: EmptyConversationSize;
  conversations: readonly ConversationListItem[];
  /** Drawn when there are none; absent, the section is not drawn at all. */
  emptyText?: string;
  onOpen: (conversation: ConversationListItem) => void;
}

/**
 * 「最近会话」: each conversation's title (the history row's label: the
 * server title, else the latest user message) and when it was last active,
 * newest first.
 */
export function RecentConversationList({ size, conversations, emptyText, onOpen }: RecentConversationListProps) {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  if (conversations.length === 0 && !emptyText) return null;
  const title = t('console.ai.askPage.recentTitle', { defaultValue: 'Recent conversations' });
  const large = size === 'large';
  return (
    <section className="flex w-full flex-col gap-2" data-testid="empty-conversation-recent" aria-label={title}>
      <h2 className={cn('px-1 font-medium text-muted-foreground', large ? 'text-sm' : 'text-xs')}>{title}</h2>
      {conversations.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground" data-testid="empty-conversation-recent-empty">
          {emptyText}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="empty-conversation-recent-list">
          {conversations.map((conversation) => {
            const label =
              conversation.title?.trim() ||
              conversation.preview?.trim() ||
              t('console.ai.newConversation', { defaultValue: 'New conversation' });
            const when = timeAgo(conversation.updatedAt ?? conversation.createdAt, displayLocale);
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
                    large ? 'px-3 py-2 text-sm' : 'px-2.5 py-1.5 text-xs',
                  )}
                  onClick={() => onOpen(conversation)}
                  data-testid="empty-conversation-recent-item"
                  data-conversation={conversation.id}
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {when ? <span className="shrink-0 text-xs text-muted-foreground">{when}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The drawer's 「最近会话」: the caller's newest list page, read through
 * `selectDrawerRecent`. A list that has not answered, or failed, draws nothing.
 */
export function DrawerRecentConversations({
  size,
  userId,
  apiBase,
  agentName,
  onOpen,
}: {
  size: EmptyConversationSize;
  userId: string;
  apiBase: string;
  agentName: string | undefined;
  onOpen: (conversation: { id: string; agentId?: string }) => void;
}) {
  const { conversations, isLoading, error } = useConversationList({ userId, apiBase, limit: DRAWER_RECENT_FETCH_LIMIT });
  const recent = React.useMemo(
    () => selectDrawerRecent(conversations, agentName, DRAWER_RECENT_COUNT[size]),
    [conversations, agentName, size],
  );
  if (isLoading || error) return null;
  return (
    <RecentConversationList
      size={size}
      conversations={recent}
      onOpen={(conversation) => onOpen({ id: conversation.id, agentId: conversation.agentId })}
    />
  );
}

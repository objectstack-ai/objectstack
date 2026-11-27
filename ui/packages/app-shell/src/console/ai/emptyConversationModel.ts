// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The empty conversation (objectstack#37862, topic objectstack#37853 C7), the
 * parts that need no React: the greeting's time of day, what kind of page the
 * drawer sits on, and the suggestions each place offers with what a click on
 * one does.
 *
 * One layout, three places: the AI home page (`AppAskPage`, ui ADR-0057 A4),
 * the drawer filling the window, and the narrow drawer (rail and phone sheet,
 * the compact form). Kept free of the chat UI so its rules are unit-tested
 * without it.
 */

import { agentAliasGroup, isAskAgent } from '@object-ui/plugin-chatbot/core';
import type { ChatSurfaceContext } from '../../layout/chatSurfaceContext.js';
import type { ConversationListItem } from '../../hooks/useConversationList.js';
import { buildAgentSuggestions } from './agentCopy.js';

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * What a click on a suggestion does. `send` sends its text as the first
 * message; `fill` puts the text in the composer for the user to finish, and
 * sends nothing. An app's own suggestions on its AI home send (as that page
 * always did); the drawer's platform suggestions about the record in view fill.
 */
export type EmptySuggestionMode = 'send' | 'fill';

export interface EmptySuggestion {
  text: string;
  mode: EmptySuggestionMode;
}

/** The two sizes: the AI home and the filled window draw `large`, the rail and the sheet `compact`. */
export type EmptyConversationSize = 'large' | 'compact';

/**
 * The time-of-day greeting's key for a local hour, the one Home greets with
 * (`home.greeting*`), so the console greets one way everywhere.
 */
export function greetingForHour(hour: number): { key: string; defaultValue: string } {
  if (hour < 5) return { key: 'home.greetingNight', defaultValue: 'Working late' };
  if (hour < 12) return { key: 'home.greetingMorning', defaultValue: 'Good morning' };
  if (hour < 18) return { key: 'home.greetingAfternoon', defaultValue: 'Good afternoon' };
  if (hour < 23) return { key: 'home.greetingEvening', defaultValue: 'Good evening' };
  return { key: 'home.greetingNight', defaultValue: 'Working late' };
}

/** The name the greeting addresses: the user's display name, else the part of their email before `@`. */
export function greetingName(user: { name?: unknown; email?: unknown } | null | undefined): string {
  const name = typeof user?.name === 'string' ? user.name.trim() : '';
  if (name) return name;
  const email = typeof user?.email === 'string' ? user.email : '';
  return (email.split('@')[0] ?? '').trim();
}

/**
 * The kind of page the drawer sits on, read off the surface the console sends
 * the agent (`consoleChatSurface`): a record (on its page or in the list's
 * record drawer), an object's list, a dashboard or a report. Any other page
 * (Home, a custom page, a component page) has no kind of its own.
 */
export type EmptyPageKind = 'record' | 'list' | 'dashboard' | 'report';

export function pageKindOfSurface(surface: ChatSurfaceContext | undefined): EmptyPageKind | undefined {
  const type = surface?.artifact?.type;
  if (type === 'object') return surface?.selection?.kind === 'record' ? 'record' : 'list';
  if (type === 'dashboard' || type === 'report') return type;
  return undefined;
}

/**
 * The platform's suggestions for a kind of page. The two about the record in
 * view fill the composer: the user names what they want from it. The rest send.
 */
function pageSuggestions(t: TranslationFn, kind: EmptyPageKind): EmptySuggestion[] {
  switch (kind) {
    case 'record':
      return [
        {
          text: t('console.ai.suggestions.page.record.summarize', { defaultValue: 'Summarize this record' }),
          mode: 'fill',
        },
        {
          text: t('console.ai.suggestions.page.record.related', { defaultValue: 'What is related to this record?' }),
          mode: 'fill',
        },
      ];
    case 'list':
      return [
        {
          text: t('console.ai.suggestions.page.list.summarize', { defaultValue: 'Summarize the records in this list' }),
          mode: 'send',
        },
        {
          text: t('console.ai.suggestions.page.list.recent', { defaultValue: 'Which records were added this week?' }),
          mode: 'send',
        },
      ];
    case 'dashboard':
      return [
        {
          text: t('console.ai.suggestions.page.dashboard.explain', { defaultValue: 'What does this dashboard show?' }),
          mode: 'send',
        },
        {
          text: t('console.ai.suggestions.page.dashboard.standOut', { defaultValue: 'What stands out on this dashboard?' }),
          mode: 'send',
        },
      ];
    case 'report':
      return [
        {
          text: t('console.ai.suggestions.page.report.summarize', { defaultValue: 'Summarize this report' }),
          mode: 'send',
        },
        {
          text: t('console.ai.suggestions.page.report.takeaways', { defaultValue: 'What are the key takeaways from this report?' }),
          mode: 'send',
        },
      ];
  }
}

/**
 * The drawer's suggestions. The `ask` agent on a page of a known kind offers
 * that page's; anything else (another agent, or a page with no kind) offers
 * the agent's starters, which send, as before.
 */
export function drawerSuggestions(
  t: TranslationFn,
  options: { agentName: string | undefined; agentLabel: string; surface: ChatSurfaceContext | undefined },
): EmptySuggestion[] {
  const kind = isAskAgent(options.agentName) ? pageKindOfSurface(options.surface) : undefined;
  if (kind) return pageSuggestions(t, kind);
  return buildAgentSuggestions(options.agentName, options.agentLabel, t).map((text) => ({ text, mode: 'send' }));
}

/** An app's own suggestions on its AI home: each sends, in the declared order. */
export function appHomeSuggestions(texts: readonly string[]): EmptySuggestion[] {
  return texts.map((text) => ({ text, mode: 'send' }));
}

/** How many recent conversations each size lists in the drawer. */
export const DRAWER_RECENT_COUNT: Record<EmptyConversationSize, number> = { large: 5, compact: 3 };

/**
 * The drawer's recent conversations: of the caller's newest list page, those
 * of the drawer's agent (alias-aware, as its history scopes them) and none the
 * AI home created for an app (`metadata.activePackageId`: that page's own
 * threads, which open there), newest first as the list gives them.
 */
export function selectDrawerRecent(
  rows: readonly ConversationListItem[],
  agentName: string | undefined,
  count: number,
): ConversationListItem[] {
  const group = agentName ? new Set(agentAliasGroup(agentName)) : undefined;
  return rows
    .filter((row) => (!group || !row.agentId || group.has(row.agentId)) && row.metadata?.activePackageId === undefined)
    .slice(0, count);
}

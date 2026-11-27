// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The AI chat's per-agent copy: the localized agent label, the empty state and
 * the starter suggestions. Split out of `AiChatPage.tsx` move-only
 * (objectstack#37730).
 */

import { agentRouteName, isAskAgent } from '@object-ui/plugin-chatbot/core';

// Keyed by the FRIENDLY agent name (alias-group head) so the new id, the legacy
// id, and the route segment all localize to the same label.
const PLATFORM_AGENT_LABEL_KEYS: Record<string, { key: string; defaultValue: string }> = {
  ask: { key: 'console.ai.agentLabels.ask', defaultValue: 'Ask' },
};

export function localizeAgentLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  agentName: string | undefined,
  fallback: string,
): string {
  const known = agentName ? PLATFORM_AGENT_LABEL_KEYS[agentRouteName(agentName)] : undefined;
  if (!known) return fallback;
  return t(known.key, { defaultValue: known.defaultValue });
}

/**
 * Per-surface empty-state branding: the Ask surface reads as data Q&A ("ask
 * about your records"). Keyed by friendly name; falls back to the generic
 * empty state for custom agents.
 */
export function agentEmptyState(
  t: (key: string, options?: Record<string, unknown>) => string,
  agentName: string | undefined,
): { title: string; description: string } {
  if (isAskAgent(agentName)) {
    return {
      title: t('console.ai.empty.ask.title', { defaultValue: 'Ask your data' }),
      description: t('console.ai.empty.ask.description', {
        defaultValue:
          'Ask questions about your records — counts, lists, and summaries across the data you can access.',
      }),
    };
  }
  return {
    title: t('console.ai.emptyTitle', { defaultValue: 'Start a conversation' }),
    description: t('console.ai.emptyDescription', {
      defaultValue: 'Ask anything — the assistant has access to your current app context.',
    }),
  };
}

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

function dataChatSuggestions(t: TranslationFn): string[] {
  return [
    t('console.ai.suggestions.dataChat.userCount', { defaultValue: 'How many users are in the system? List their emails.' }),
    t('console.ai.suggestions.dataChat.recentRecords', { defaultValue: 'List the 5 most recently created records.' }),
    t('console.ai.suggestions.dataChat.recordCounts', { defaultValue: 'Count records for each object.' }),
  ];
}

function genericSuggestions(t: TranslationFn): string[] {
  return [
    t('console.ai.suggestions.generic.help', { defaultValue: 'What can you help me with?' }),
    t('console.ai.suggestions.generic.availableObjects', { defaultValue: 'List the available data objects.' }),
    t('console.ai.suggestions.generic.recentActivity', { defaultValue: 'Summarize my recent activity.' }),
  ];
}

export function buildAgentSuggestions(
  agentName: string | undefined,
  agentLabel: string,
  t: TranslationFn,
): string[] {
  // Alias-aware: `ask`/`data_chat` → data starters. Custom agents fall back to
  // a name/label heuristic.
  if (isAskAgent(agentName)) return dataChatSuggestions(t);
  const lower = (agentName ?? agentLabel).toLowerCase();
  if (lower.includes('data')) return dataChatSuggestions(t);
  return genericSuggestions(t);
}

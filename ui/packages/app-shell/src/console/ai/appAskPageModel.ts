// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app's AI inquiry page (`ai:chat`, ui ADR-0057 Amendment A4), the parts
 * that need no React: which navigation entry is the page's own, the copy its
 * `params` declare, the conversation key, and whether a conversation named in
 * the page's address belongs to this app.
 *
 * Kept free of the chat UI so the page's rules are unit-tested without it.
 */

import { AI_CHAT_COMPONENT_REF, AiChatNavParamsSchema, type AiChatNavParamsParsed } from '@objectstack/spec/ui';
import { chatConversationScope } from '../../hooks/chatScope.js';

/**
 * The page's own query parameter: the conversation it shows (`?c=ID`). Written
 * once the first send has created the conversation, read on a reload. Page
 * state, not a console-wide reserved parameter (`urlParams.ts`).
 */
export const ASK_CONVERSATION_PARAM = 'c';

/** The highest number of suggested questions the page draws (`AiChatNavParamsSchema.suggestions`). */
export const MAX_ASK_SUGGESTIONS = 4;

/** A navigation entry as the page reads it: only the members it needs. */
export interface AiChatNavEntry {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  componentRef?: unknown;
  params?: unknown;
  children?: unknown;
}

function findIn(items: unknown): AiChatNavEntry | undefined {
  if (!Array.isArray(items)) return undefined;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as AiChatNavEntry;
    if (entry.type === 'component' && entry.componentRef === AI_CHAT_COMPONENT_REF) return entry;
    const nested = findIn(entry.children);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * The app's `ai:chat` navigation entry: the first one in its `navigation`,
 * then in each `areas[].navigation` in order, at any depth through
 * `children` (the spec allows one per app, `checkAppSingleAiChatEntry`).
 * `undefined` when the app has none.
 */
export function findAiChatNavEntry(app: unknown): AiChatNavEntry | undefined {
  if (!app || typeof app !== 'object') return undefined;
  const { navigation, areas } = app as { navigation?: unknown; areas?: unknown };
  const top = findIn(navigation);
  if (top) return top;
  if (!Array.isArray(areas)) return undefined;
  for (const area of areas) {
    if (!area || typeof area !== 'object') continue;
    const hit = findIn((area as { navigation?: unknown }).navigation);
    if (hit) return hit;
  }
  return undefined;
}

/** The page's copy as its entry declares it; a key it omits is absent here. */
export interface AiChatPageCopy {
  title?: string;
  subtitle?: string;
  placeholder?: string;
  /** In the declared order, at most {@link MAX_ASK_SUGGESTIONS}. */
  suggestions: string[];
}

/**
 * The copy the entry's `params` declare, judged by `AiChatNavParamsSchema`.
 * The spec refuses a malformed record when the app is saved, so one that
 * still arrives here (an app stored before the shape was declared) is read
 * as declaring nothing: the page draws its neutral copy, and says why once
 * on the console. ⛔ Never a key-by-key salvage of a refused record.
 */
export function readAiChatPageCopy(entry: AiChatNavEntry | undefined): AiChatPageCopy {
  const params = entry?.params;
  if (params === undefined) return { suggestions: [] };
  const verdict = AiChatNavParamsSchema.safeParse(params);
  if (!verdict.success) {
    console.warn(
      '[ai:chat] The navigation entry\'s params do not match AiChatNavParamsSchema; the page shows its default copy.',
      verdict.error.issues,
    );
    return { suggestions: [] };
  }
  const parsed: AiChatNavParamsParsed = verdict.data;
  return {
    title: parsed.title,
    subtitle: parsed.subtitle,
    placeholder: parsed.placeholder,
    suggestions: (parsed.suggestions ?? []).slice(0, MAX_ASK_SUGGESTIONS),
  };
}

/**
 * The page's conversation key: `app:PKG:ask`, bound to the app's package
 * (ui ADR-0057 Amendment A4, "Thread"). Never the drawer's `ask` key, which is
 * the product alone.
 */
export function askPageConversationScope(packageId: string): string {
  return chatConversationScope({ appId: packageId, product: 'ask' });
}

/** The `metadata` the page's conversation create carries. */
export function askPageCreateMetadata(packageId: string): { activePackageId: string } {
  return { activePackageId: packageId };
}

/**
 * Does the conversation the page's address names belong to this app? Only a
 * conversation the page itself created for this package does: its stored
 * `metadata.activePackageId` is the package. Any other one, a drawer thread or
 * another app's page included, opens the home state instead.
 */
export function conversationBelongsToAskPage(
  conversation: { metadata?: Record<string, unknown> } | null | undefined,
  packageId: string,
): boolean {
  return conversation?.metadata?.activePackageId === packageId;
}

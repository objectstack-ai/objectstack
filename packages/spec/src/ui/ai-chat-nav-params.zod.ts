// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { strictObject } from '../shared/strict-object';
import { lazySchema } from '../shared/lazy-schema';

/**
 * The `componentRef` of the app's AI inquiry home page — the built-in console
 * page an app puts on its menu as a `type: 'component'` navigation entry:
 *
 * ```ts
 * { id: 'nav_ask', type: 'component', label: 'Ask AI',
 *   componentRef: 'ai:chat', params: { title: 'Ask about our policies' } }
 * ```
 *
 * It is the ONE component entry whose `params` the spec judges
 * ({@link AiChatNavParamsSchema}); every other `componentRef` keeps the open
 * record, because those props are their component's own contract.
 */
export const AI_CHAT_COMPONENT_REF = 'ai:chat' as const;

/**
 * The `params` of an `ai:chat` navigation entry: the copy the AI inquiry home
 * page draws before the reader's first question.
 *
 * CLOSED: an unknown key is refused at its own path
 * (`navigation.<i>.params.<key>`), because the page reads only these four and
 * an unread key is a setting that silently does nothing.
 *
 * Deliberately absent in this version:
 *
 * - `agent` — the page always talks to the platform `ask` agent; the agent is
 *   not an app-level choice here (ADR-0063 §1: the platform agents are `ask`
 *   and `build`, and an inquiry page is a data surface).
 * - `scope` — answers PREFER this app's objects but are not limited to
 *   them: the active app is a ranking hint for schema retrieval only, and
 *   knowledge search has no app filter (knowledge sources carry no app
 *   ownership), so a strict
 *   "this app only" switch would advertise a limit nothing enforces.
 *
 * Plain strings, not locale maps: per-locale copy goes through the app's
 * translation bundle, not through this record.
 *
 * Its consumer is the console's AI inquiry page, which reads these keys off
 * the navigation entry rather than off the URL — so the sidebar link for an
 * `ai:chat` entry carries no querystring.
 */
export const AiChatNavParamsSchema = lazySchema(() => strictObject(
  {
    surface: "an `ai:chat` navigation entry's `params`",
    history:
      'Before this shape was declared, `params` on every component entry was an open record, so a misspelt '
      + 'key here saved cleanly and the inquiry page drew its default copy instead.',
    aliases: {
      heading: 'title',
      welcome: 'title',
      description: 'subtitle',
      intro: 'subtitle',
      prompt: 'placeholder',
      hint: 'placeholder',
      questions: 'suggestions',
      prompts: 'suggestions',
      examples: 'suggestions',
    },
    guidance: {
      agent:
        '`agent` is not configurable here: the AI inquiry page always talks to the platform `ask` agent. '
        + 'Delete the key; to give it deeper capability, author skills that attach to `ask`.',
      scope:
        '`scope` is not configurable here: answers already prefer this app\'s objects; nothing can limit them '
        + 'to this app alone yet. Delete the key.',
    },
  },
  {
    title: z.string().min(1).max(60).optional()
      .describe('Welcome heading drawn above the question box (at most 60 characters). Absent: the page\'s default heading.'),
    subtitle: z.string().min(1).max(200).optional()
      .describe('One or two lines under the heading saying what the reader can ask about (at most 200 characters).'),
    placeholder: z.string().min(1).max(100).optional()
      .describe('Placeholder text inside the empty question box (at most 100 characters).'),
    suggestions: z.array(z.string().min(1).max(100)).min(1).max(4).optional()
      .describe('Suggested questions offered as one-click starters, 1 to 4 non-empty entries of at most 100 characters each, shown in this order.'),
  },
).describe('Params of an `ai:chat` navigation entry: the copy the AI inquiry home page draws before the first question.'));

export type AiChatNavParams = z.input<typeof AiChatNavParamsSchema>;
export type AiChatNavParamsParsed = z.infer<typeof AiChatNavParamsSchema>;

/**
 * Judge an `ai:chat` component entry's `params` against
 * {@link AiChatNavParamsSchema}; every other entry is left alone.
 *
 * Mounted once, on `NavigationItemSchema` itself (beside
 * `navItemVisibleDataNeedsDataSource`), so it reaches every navigation door —
 * `app.navigation`, `app.areas[].navigation`, every `children` array at any
 * depth, and a navigation contribution's `items`. The exported per-branch
 * `ComponentNavItemSchema` does not chain it, the same posture as that rule. Each issue is re-raised with
 * `params` prefixed to its path, so the author reads
 * `navigation.<i>.params.<key>`.
 *
 * EXPORTED so a hand-written mirror of the navigation item attaches this very
 * function instead of restating the rule.
 */
export function checkAiChatNavParams(item: unknown, ctx: z.RefinementCtx): void {
  if (!item || typeof item !== 'object') return;
  const entry = item as { type?: unknown; componentRef?: unknown; params?: unknown };
  if (entry.type !== 'component' || entry.componentRef !== AI_CHAT_COMPONENT_REF) return;
  if (entry.params === undefined) return;
  const verdict = AiChatNavParamsSchema.safeParse(entry.params);
  if (verdict.success) return;
  for (const issue of verdict.error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['params', ...issue.path],
      message: issue.message,
    });
  }
}

/** Every `ai:chat` component entry under `items`, with its path, at any depth through `children`. */
function collectAiChatEntries(
  items: unknown,
  path: readonly (string | number)[],
  into: Array<{ id: unknown; path: readonly (string | number)[] }>,
): void {
  if (!Array.isArray(items)) return;
  items.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const entry = raw as { id?: unknown; type?: unknown; componentRef?: unknown; children?: unknown };
    const here = [...path, index];
    if (entry.type === 'component' && entry.componentRef === AI_CHAT_COMPONENT_REF) {
      into.push({ id: entry.id, path: here });
    }
    collectAiChatEntries(entry.children, [...here, 'children'], into);
  });
}

/**
 * An app carries at most ONE `ai:chat` navigation entry, across its own
 * `navigation` and every `areas[].navigation`, at any depth: the AI inquiry
 * page is the app's single home for asking, and its recent conversations are
 * the app's, so a second entry would be a second door onto the same page with
 * different copy. Every entry after the first is refused at its own path.
 *
 * Mounted on `AppSchema`. A package's navigation contribution is merged into
 * the app after parse, so an `ai:chat` entry a contribution adds is not counted
 * here. EXPORTED for the same mirror reason as {@link checkAiChatNavParams}.
 */
export function checkAppSingleAiChatEntry(app: unknown, ctx: z.RefinementCtx): void {
  if (!app || typeof app !== 'object') return;
  const { navigation, areas } = app as { navigation?: unknown; areas?: unknown };
  const found: Array<{ id: unknown; path: readonly (string | number)[] }> = [];
  collectAiChatEntries(navigation, ['navigation'], found);
  if (Array.isArray(areas)) {
    areas.forEach((area, index) => {
      if (area && typeof area === 'object') {
        collectAiChatEntries((area as { navigation?: unknown }).navigation, ['areas', index, 'navigation'], found);
      }
    });
  }
  if (found.length < 2) return;
  const first = found[0];
  const firstName = typeof first.id === 'string' ? `\`${first.id}\`` : `the entry at \`${first.path.join('.')}\``;
  for (const extra of found.slice(1)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...extra.path],
      message:
        `This app already has an \`ai:chat\` navigation entry (${firstName}); an app carries at most one. `
        + 'The AI inquiry page is the app\'s single place to ask: keep one entry and delete this one.',
    });
  }
}

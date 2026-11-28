// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0160 D7, seventh amendment — the one prescription a retired `ask_ai`
 * action type is answered with, in every slot that takes an action type:
 *
 * - `ActionType` itself (`action.zod.ts`), declared with
 *   `enumWithRetiredValues`, which a dashboard header action's `actionType`
 *   is (`WidgetActionTypeSchema`, `dashboard.zod.ts`);
 * - an action's own `type` key, on a declared action and an inline one
 *   (`ActionSchema`, `InlineActionSchema`), a second enum over the same
 *   members with an error of its own;
 * - a page action row's open executor string (`component.zod.ts`):
 *   `actionType` on an `action:button` / `action:icon` row, and `type` on each
 *   `action:group` / `action:menu` member.
 *
 * Kept in a module of its own, never re-exported from a barrel, so the two
 * schema modules share one sentence without adding a public export.
 */
export const ASK_AI_RETIRED =
  '`ask_ai` was removed from `ActionType` in @objectstack/spec 19.0.0 (ADR-0160 D7) — the shell\'s '
  + '「问 AI」 entry (Ask AI) in the page header is the one way into the assistant, and it already carries the '
  + 'record on the page, so an action that opens the assistant would be a second entry. Delete this action '
  + 'and its references; use the shell\'s 「问 AI」 entry. '
  + 'Run `os migrate meta --from 18` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The spellings an author reaches for when they mean an action's `target` —
 * ONE table, read by every surface that declares `target` for the action
 * runner (#21005).
 *
 * `target` is the one key the runner dispatches an executor on: the URL of a
 * `url` action, the endpoint of an `api` action, the script or flow name.
 * `url`, `endpoint`, `path` and `href` are the words borrowed from HTTP
 * clients and anchors for the same thing, so each surface renames them onto
 * `target` through its `strictObject` `aliases` and prints the same
 * prescription — "Did you mean `endpoint` → `target`?".
 *
 * Three surfaces read it:
 *
 * - `ActionSchema` (`action.zod.ts`), and `InlineActionSchema`, which derives
 *   from the same object half;
 * - the `action:button` and `action:icon` rows of `ComponentPropsMap`
 *   (`component.zod.ts`), the page blocks that hand their props to the same
 *   runner.
 *
 * Why a module of its own: the two files must read the SAME object, never two
 * copies of it. Until #21005 the rows declared `endpoint` as a key of their
 * own while `ActionSchema` refused it with this rename — one concept, two
 * verdicts in one release — and objectui's console `api` handler reads
 * `target` only, so an `endpoint` the rows accepted called nothing. The rows
 * also answered `path` with the edit-distance guess `patch`, the declarative
 * write's field values, which parses. `component.zod.ts` already imports
 * `action.zod.ts`, so the table cannot live in the rows' file; and exported
 * from `action.zod.ts` it would ride the `ui` barrel into the published API,
 * a contract for what is authoring judgement. This module is reached by
 * relative import only, like `filter-rule-array.ts`.
 *
 * A stored or authored `endpoint` on either block is rewritten to `target` by
 * the ADR-0087 D2 conversion `action-block-endpoint-to-target`.
 */
export const ACTION_TARGET_ALIASES = {
  url: 'target',
  endpoint: 'target',
  path: 'target',
  href: 'target',
} as const satisfies Readonly<Record<string, 'target'>>;

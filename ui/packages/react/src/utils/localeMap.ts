/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Each member of an inline locale map is evaluated like a plain string on the
 * same key (objectui#12936).
 *
 * ## The rule
 *
 * A node's config-bag value that is an INLINE LOCALE MAP - the second
 * authorized form of the spec's `I18nLabel`, for example
 * `title: { en: 'Published ${data.at}', 'zh-CN': '...${data.at}' }` - has
 * every member evaluated by the `SchemaRenderer` evaluation memo, with the same
 * evaluator and so against the same scope as a plain string on that key:
 * `record`, `current_user` / `user`, `page`, the host's ambient roots, and
 * `data` on a node with an API binding. The block then picks one member for
 * the viewer's language (`pickLocalized`) and draws an evaluated string.
 *
 * Before it, the map was a data object to the per-value loops, which hand a
 * data object over as authored, so the member the block picked kept its
 * `${...}` and drew it as text. A plain string with the same hole on the same
 * key was evaluated, so localizing a line was what broke it.
 *
 * ## What a locale map is: the spec's answer, not a third one
 *
 * {@link isInlineLocaleMap} asks `@objectstack/spec`'s `InlineLocaleMapSchema`,
 * the schema the contract declares the form with: every key a BCP-47 tag or
 * `default` (never `key` / `defaultValue`), every value a string. A value with
 * a non-string member, or with a key that is not a locale tag, is NOT a locale
 * map: it stays a data object and is handed over as authored, with nothing
 * inside it evaluated. No other object is walked.
 *
 * ⚠️ The boundary that follows from asking the contract: an object whose keys
 * all parse as locale tags (any two or three letters do, so `{ id, url }`
 * qualifies) and whose values are all strings IS an inline locale map to the
 * spec, and so it is one here too, and a `${...}` in its members is evaluated.
 *
 * ## Why this module exists
 *
 * Two readers must agree on one radius, as they do for `params`
 * (`paramsBag.ts`): the memo that EVALUATES the members, and the dev
 * diagnostic (`unevaluatedExpression.ts`) that REPORTS a member still carrying
 * `${...}` afterwards because its expression threw. Both import this module, so
 * a member that fails to evaluate is reported exactly as a plain string that
 * fails is.
 *
 * ## The result is still a locale map
 *
 * A member's result is spelled as a string. A member that is one whole hole,
 * `'${data.count}'`, evaluates to the number itself, as a plain string does;
 * left a number, the member would be skipped by every `pickLocalized` limb
 * (each reads string entries only) and the viewer would get another locale's
 * line, or nothing. `String(result ?? '')` is the spelling the evaluator
 * already gives an interpolated part of a plain string.
 *
 * ## Copy on write
 *
 * The map is copied only when a member changed, so a map without a hole comes
 * back as the very object that went in, and the authored map is never mutated.
 * Nothing may depend on that identity (AGENTS.md #10).
 */

import { InlineLocaleMapSchema } from '@objectstack/spec/ui';
import { isConfigBag } from './configBag.js';

/**
 * Is this value an inline locale map, in `InlineLocaleMapSchema`'s sense?
 *
 * The member loop first is a fast reject and not a second definition: the
 * schema requires every value to be a string, so the loop can only turn away
 * what the schema turns away, and it does so without the schema's per-key
 * issue reporting. Most data objects carry a non-string member.
 */
export function isInlineLocaleMap(value: unknown): value is Record<string, string> {
  if (!isConfigBag(value)) return false;
  for (const member of Object.values(value)) {
    if (typeof member !== 'string') return false;
  }
  return InlineLocaleMapSchema.safeParse(value).success;
}

/** Visit one member. `locale` is the member's key (`en`, `zh-CN`, `default`). */
export type LocaleMapMemberVisitor = (member: string, locale: string) => unknown;

/**
 * Map every member of an inline locale map through `visit` and return the
 * result, spelled as a string: the map itself when nothing changed (copy on
 * write).
 *
 * The evaluation memo passes the evaluator; the dev diagnostic passes a visitor
 * that records the member and returns it unchanged.
 */
export function mapLocaleMapMembers(
  map: Record<string, string>,
  visit: LocaleMapMemberVisitor,
): Record<string, string> {
  let copy: Record<string, string> | undefined;
  for (const locale of Object.keys(map)) {
    const member = map[locale];
    const result = visit(member, locale);
    const next = typeof result === 'string' ? result : String(result ?? '');
    if (next !== member) {
      if (!copy) copy = { ...map };
      copy[locale] = next;
    }
  }
  return copy ?? map;
}

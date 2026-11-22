// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { strictObject } from '../shared/strict-object';

/**
 * `ObjectSchema.pinnedActions` (objectstack#36366): which actions an object's
 * page header shows as buttons, per page type, in order.
 *
 * A page header draws at most {@link OBJECT_PINNED_ACTION_LIMIT} actions as
 * buttons and puts every other action it places in its 「More」 menu. Without
 * this key that choice follows each action's `order` and declaration order,
 * which is shared by every page an action is placed on. With it, an arm names
 * the buttons of one page type: `list` for the object's list page header,
 * `record` for its record page header. An arm names actions by `name`, at
 * most three, in the order they are drawn; every other action the header
 * places goes to 「More」. An object without the key (or without an arm) draws
 * that header exactly as before.
 *
 * An entry is an action `name` of the object (lowercase snake_case, the
 * action's own spelling), or one of the page's built-in buttons, spelled with
 * a leading `$` so it can never collide with an action name:
 * {@link OBJECT_PINNED_BUILTIN_ACTIONS}. The list page's built-ins are its
 * import and export buttons; the record page has none (its Edit button is
 * drawn outside the slots, and Share and Delete stay in 「More」).
 *
 * What the shape refuses here, at every door: more than three entries, an
 * entry pinned twice, an entry that is neither an action name nor a `$`
 * built-in, and a `$` built-in the page does not have. Whether an action name
 * names an action of this object placed on that page is a reference, judged
 * where the whole stack is visible (`@objectstack/lint`'s
 * `validateObjectPinnedActions`).
 *
 * Declared in its own module so the object extension (`ObjectExtensionSchema`,
 * an installed object's customization, ADR-0146 D10) carries exactly the shape
 * the object does.
 */

/** The most actions one page header draws as buttons. */
export const OBJECT_PINNED_ACTION_LIMIT = 3;

/** The page types an object's header actions are pinned on. */
export const OBJECT_PINNED_ACTION_PAGES = ['list', 'record'] as const;
export type ObjectPinnedActionPage = (typeof OBJECT_PINNED_ACTION_PAGES)[number];

/**
 * The built-in buttons a page header may pin beside the object's actions, per
 * page type. The list page's import and export are the console's own buttons,
 * not object actions; the record page has none.
 */
export const OBJECT_PINNED_BUILTIN_ACTIONS: Readonly<Record<ObjectPinnedActionPage, readonly string[]>> = {
  list: ['$import', '$export'],
  record: [],
};

/**
 * The entries one page's arm accepts: an action name (the spelling
 * `ActionSchema.name` accepts, `SnakeCaseIdentifierSchema`: lowercase snake
 * case, two characters at least) or one of the page's built-ins. A pattern,
 * so the JSON Schema states it too.
 */
function pinPattern(page: ObjectPinnedActionPage): RegExp {
  const builtins = OBJECT_PINNED_BUILTIN_ACTIONS[page].map((b) => `|\\${b}`).join('');
  return new RegExp(`^(?:[a-z][a-z0-9_]+${builtins})$`);
}

function builtinsSentence(page: ObjectPinnedActionPage): string {
  const builtins = OBJECT_PINNED_BUILTIN_ACTIONS[page];
  return builtins.length > 0
    ? `the ${page} page's built-ins are ${builtins.map((b) => `\`${b}\``).join(', ')}`
    : `the ${page} page has no built-in, pin an action name`;
}

/** Why `pin` is no entry of the `page` arm. */
function pinRefusal(page: ObjectPinnedActionPage, pin: unknown): string {
  const text = String(pin);
  return text.startsWith('$')
    ? `\`${text}\` is not a built-in of the ${page} page: ${builtinsSentence(page)}.`
    : `\`${text}\` is not an action name (lowercase snake_case, as the action's \`name\`) ` +
        `nor a built-in (${builtinsSentence(page)}).`;
}

function pinnedArm(page: ObjectPinnedActionPage) {
  return z
    .array(z.string().regex(pinPattern(page), { error: (issue) => pinRefusal(page, issue.input) }))
    .max(OBJECT_PINNED_ACTION_LIMIT, {
      error: (issue) =>
        `\`pinnedActions.${page}\` pins ${Array.isArray(issue.input) ? issue.input.length : 'more'} actions; ` +
        `a header draws at most ${OBJECT_PINNED_ACTION_LIMIT} as buttons and puts every other action in 「More」. ` +
        `Keep the first ${OBJECT_PINNED_ACTION_LIMIT}.`,
    })
    .superRefine((pins, ctx) => {
      // Uniqueness is the one rule JSON Schema is not given here.
      const seen = new Set<string>();
      pins.forEach((pin, index) => {
        if (seen.has(pin)) {
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: `\`${pin}\` is pinned twice on the ${page} page; a header draws an action once.`,
          });
        }
        seen.add(pin);
      });
    });
}

/**
 * The `pinnedActions` leaf, shared by `ObjectSchema` and `ObjectExtensionSchema`.
 * Optional with no default: absent draws every header as before.
 */
export const OBJECT_PINNED_ACTIONS_SCHEMA = strictObject(
  {
    surface: "this object's `pinnedActions`",
    // Closed from its first release (objectstack#36366).
    history: 'Closed from its first release: no key here was ever dropped silently.',
    aliases: { listPage: 'list', recordPage: 'record' },
  },
  {
    list: pinnedArm('list')
      .optional()
      .describe(
        "The list page header's buttons, in order: action names of the object placed at `list_toolbar`, " +
          'or `$import` / `$export`. At most 3; every other action goes to 「More」. Omit to draw the header as before.',
      ),
    record: pinnedArm('record')
      .optional()
      .describe(
        "The record page header's buttons, in order: action names of the object placed at `record_header` " +
          'or `record_more`. At most 3; every other action goes to 「More」. Omit to draw the header as before.',
      ),
  },
)
  .optional()
  .describe(
    'The actions each page header of the object shows as buttons, per page type (`list`, `record`), in order, ' +
      'at most 3 per page; every other action the header places goes to its 「More」 menu. Omit to keep the ' +
      "header's own choice (each action's `order`).",
  );

/** An object's pinned header actions, as authored. */
export type ObjectPinnedActions = z.input<typeof OBJECT_PINNED_ACTIONS_SCHEMA>;

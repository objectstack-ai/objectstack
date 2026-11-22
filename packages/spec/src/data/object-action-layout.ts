// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { strictObject } from '../shared/strict-object';

/**
 * `ObjectSchema.actionLayout` (objectstack#36366): the order of an object's
 * actions, and which of them are shown as buttons, per action scope.
 *
 * Without this key, a surface that draws an object's actions orders them by
 * each action's `order` and declaration order, and draws the first ones as
 * buttons and the rest in its 「More」 menu. That order is shared by every
 * surface an action is placed on. With it, an arm states the arrangement of
 * one scope:
 *
 * - `list`: the actions that act on no record, drawn on the object's list
 *   page toolbar (placed at `list_toolbar`), with the list page's built-ins
 *   `$import` and `$export`.
 * - `record`: the actions that act on one record, drawn in the record page's
 *   header (placed at `record_header` or `record_more`). The same arm orders
 *   every surface that draws that header: the record page, the side preview
 *   and a phone's bottom action bar.
 *
 * An arm is a scope, not a page (ADR-0085 §2 keeps per-page keys off the
 * object): one arm arranges one set of actions wherever that set is drawn.
 *
 * Each arm has two parts. `pinned` names the buttons, at most
 * {@link OBJECT_ACTION_LAYOUT_PINNED_LIMIT}, in the order they are drawn;
 * `pinned: []` draws none. `more` names the order of the 「More」 menu; an
 * action the scope places that neither part names goes to the end of 「More」,
 * in its default order (`order`, then declaration). A pinned action hidden by
 * its `visible` predicate or its permissions leaves its button out; no other
 * action takes its place. An object without the key, or without an arm, draws
 * that scope exactly as before.
 *
 * An entry is an action `name` of the object (lowercase snake_case, the
 * action's own spelling), or one of the scope's built-ins, spelled with a
 * leading `$` so it can never collide with an action name:
 * {@link OBJECT_ACTION_LAYOUT_BUILTINS}. The record scope has none: New, Edit
 * and Delete keep their fixed places.
 *
 * What the shape refuses here, at every door: more than three pinned, an
 * entry named twice (in one part or in both), an entry that is neither an
 * action name nor a `$` built-in, and a `$` built-in the scope does not have.
 * Whether an action name names an action of this object placed in that scope
 * is a reference, judged where the whole stack is visible
 * (`@objectstack/lint`'s `validateObjectActionLayout`).
 *
 * Declared in its own module so the object extension (`ObjectExtensionSchema`,
 * an installed object's customization, ADR-0146 D10) carries exactly the shape
 * the object does. An extension's arm replaces the object's arm whole.
 */

/** The most actions one arm pins as buttons. */
export const OBJECT_ACTION_LAYOUT_PINNED_LIMIT = 3;

/** The action scopes an object's actions are arranged in. */
export const OBJECT_ACTION_LAYOUT_SCOPES = ['list', 'record'] as const;
export type ObjectActionLayoutScope = (typeof OBJECT_ACTION_LAYOUT_SCOPES)[number];

/**
 * The built-in buttons an arm may name beside the object's actions, per scope.
 * The list page's import and export are the console's own buttons, not object
 * actions; the record scope has none.
 */
export const OBJECT_ACTION_LAYOUT_BUILTINS: Readonly<Record<ObjectActionLayoutScope, readonly string[]>> = {
  list: ['$import', '$export'],
  record: [],
};

/**
 * The entries one scope's arm accepts: an action name (the spelling
 * `ActionSchema.name` accepts, `SnakeCaseIdentifierSchema`: lowercase snake
 * case, two characters at least) or one of the scope's built-ins. A pattern,
 * so the JSON Schema states it too.
 */
function entryPattern(scope: ObjectActionLayoutScope): RegExp {
  const builtins = OBJECT_ACTION_LAYOUT_BUILTINS[scope].map((b) => `|\\${b}`).join('');
  return new RegExp(`^(?:[a-z][a-z0-9_]+${builtins})$`);
}

function builtinsSentence(scope: ObjectActionLayoutScope): string {
  const builtins = OBJECT_ACTION_LAYOUT_BUILTINS[scope];
  return builtins.length > 0
    ? `the ${scope} scope's built-ins are ${builtins.map((b) => `\`${b}\``).join(', ')}`
    : `the ${scope} scope has no built-in, name an action`;
}

/** Why `entry` is no entry of the `scope` arm. */
function entryRefusal(scope: ObjectActionLayoutScope, entry: unknown): string {
  const text = String(entry);
  return text.startsWith('$')
    ? `\`${text}\` is not a built-in of the ${scope} scope: ${builtinsSentence(scope)}.`
    : `\`${text}\` is not an action name (lowercase snake_case, as the action's \`name\`) ` +
        `nor a built-in (${builtinsSentence(scope)}).`;
}

function entries(scope: ObjectActionLayoutScope) {
  return z.array(z.string().regex(entryPattern(scope), { error: (issue) => entryRefusal(scope, issue.input) }));
}

function layoutArm(scope: ObjectActionLayoutScope) {
  return strictObject(
    {
      surface: `this object's \`actionLayout.${scope}\``,
      // Closed from its first release (objectstack#36366).
      history: 'Closed from its first release: no key here was ever dropped silently.',
      aliases: { buttons: 'pinned', inline: 'pinned', overflow: 'more', menu: 'more' },
    },
    {
      pinned: entries(scope)
        .max(OBJECT_ACTION_LAYOUT_PINNED_LIMIT, {
          error: (issue) =>
            `\`actionLayout.${scope}.pinned\` names ${Array.isArray(issue.input) ? issue.input.length : 'more'} actions; ` +
            `at most ${OBJECT_ACTION_LAYOUT_PINNED_LIMIT} are drawn as buttons, and every other action goes to 「More」. ` +
            `Keep the first ${OBJECT_ACTION_LAYOUT_PINNED_LIMIT} and move the rest to \`more\`.`,
        })
        .describe(
          `The ${scope} scope's buttons, in order, at most ${OBJECT_ACTION_LAYOUT_PINNED_LIMIT}. \`[]\` draws none.`,
        ),
      more: entries(scope)
        .optional()
        .describe(
          "The order of the scope's 「More」 menu. An action named in neither part goes to the end of 「More」, " +
            'in its default order.',
        ),
    },
  ).superRefine((arm, ctx) => {
    // Uniqueness, across both parts, is the one rule JSON Schema is not given here.
    const seen = new Map<string, 'pinned' | 'more'>();
    for (const part of ['pinned', 'more'] as const) {
      (arm[part] ?? []).forEach((entry, index) => {
        const first = seen.get(entry);
        if (first) {
          ctx.addIssue({
            code: 'custom',
            path: [part, index],
            message:
              first === part
                ? `\`${entry}\` is named twice in \`${scope}.${part}\`; an action is drawn once.`
                : `\`${entry}\` is named in both \`${scope}.pinned\` and \`${scope}.more\`; an action is either a button or in 「More」.`,
          });
          return;
        }
        seen.set(entry, part);
      });
    }
  });
}

/**
 * The `actionLayout` leaf, shared by `ObjectSchema` and `ObjectExtensionSchema`.
 * Optional with no default: absent draws every scope as before.
 */
export const OBJECT_ACTION_LAYOUT_SCHEMA = strictObject(
  {
    surface: "this object's `actionLayout`",
    // Closed from its first release (objectstack#36366).
    history: 'Closed from its first release: no key here was ever dropped silently.',
    aliases: { listPage: 'list', recordPage: 'record', detail: 'record' },
  },
  {
    list: layoutArm('list')
      .optional()
      .describe(
        "The list scope's arrangement: actions of the object placed at `list_toolbar`, and `$import` / `$export`, " +
          'as drawn on the list page toolbar. Omit to draw it as before.',
      ),
    record: layoutArm('record')
      .optional()
      .describe(
        "The record scope's arrangement: actions of the object placed at `record_header` or `record_more`, as " +
          "drawn in the record header (record page, side preview, a phone's bottom bar). Omit to draw it as before.",
      ),
  },
)
  .optional()
  .describe(
    "The order of the object's actions and which are buttons, per action scope (`list`, `record`): `pinned` " +
      '(at most 3 buttons, in order) and `more` (the 「More」 menu order; unnamed actions follow in their default ' +
      "order). Omit to keep each surface's own choice (each action's `order`).",
  );

/** An object's action layout, as authored. */
export type ObjectActionLayout = z.input<typeof OBJECT_ACTION_LAYOUT_SCHEMA>;
/** One scope's arm of an object's action layout, as authored. */
export type ObjectActionLayoutArm = NonNullable<NonNullable<ObjectActionLayout>['record']>;

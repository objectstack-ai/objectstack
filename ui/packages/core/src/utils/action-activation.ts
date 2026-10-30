/**
 * ObjectUI — served packaged-action activation (consumer side)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The consumer half of objectstack#27504 (triage 6495255628): an
 * administrator can switch a PACKAGED action off for an installation (Setup ›
 * Packaged automation, the ADR-0126 §8 activation ledger), and the action door
 * then refuses it `409 ACTION_DISABLED`. The console used to keep offering the
 * button anyway, so the user got a live button that could only fail.
 *
 * ## What the platform serves
 *
 * The object reads serve the switched-off names in their ENVELOPE, beside the
 * document and never inside it — the action entries are authored metadata, and
 * a flag written into them would be saved back by any editor that round-trips
 * a served read:
 *
 * ```jsonc
 * // GET /api/v1/meta/object/showcase_task
 * { "type": "object", "name": "showcase_task", "item": { … },
 *   "disabledActions": ["showcase_mark_done"] }
 * // GET /api/v1/meta/object
 * { "type": "object", "items": [ … ],
 *   "disabledActions": { "showcase_task": ["showcase_mark_done"] } }
 * ```
 *
 * ## How it reaches a button
 *
 * The data layer stamps each switched-off entry of the served `actions[]` with
 * {@link ACTION_SWITCHED_OFF_KEY} as it unwraps the envelope
 * ({@link markSwitchedOffActions}). The key is a SYMBOL, so it rides along when
 * a host spreads an action (localization, `objectOverride`, a promoted bulk
 * def) and is invisible to `JSON.stringify` and `Object.keys`: an action handed
 * back to a metadata write never carries it. Every action gate that hides an
 * action whose `requiredPermissions` the caller lacks asks
 * {@link isActionSwitchedOff} beside it, so the two hides are one gate.
 *
 * ⛔ No client copy of the ledger: nothing here reads `sys_metadata_activation`.
 * The served names are the platform's answer; absence of the key means no
 * answer was served (an older backend, an inline schema) and nothing is hidden.
 */

/** The symbol a switched-off action entry carries. */
export const ACTION_SWITCHED_OFF_KEY: unique symbol = Symbol.for('objectui.actionSwitchedOff');

/** The served names as a set, or `undefined` when the value is not a name list. */
function servedNames(served: unknown): ReadonlySet<string> | undefined {
  if (!Array.isArray(served)) return undefined;
  const names = served.filter((n): n is string => typeof n === 'string' && n !== '');
  return names.length > 0 ? new Set(names) : undefined;
}

/**
 * Stamp the entries of `schema.actions` the served `disabledActions` names.
 * In place, and returns `schema`. A value that is not a list of names stamps
 * nothing.
 */
export function markSwitchedOffActions<T>(schema: T, served: unknown): T {
  const names = servedNames(served);
  if (!names || !schema || typeof schema !== 'object') return schema;
  const actions = (schema as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return schema;
  for (const action of actions) {
    if (action && typeof action === 'object' && names.has((action as { name?: unknown }).name as string)) {
      (action as Record<symbol, unknown>)[ACTION_SWITCHED_OFF_KEY] = true;
    }
  }
  return schema;
}

/**
 * The list read's form: `served` is keyed by object name, and each listed
 * object's own entries are stamped.
 */
export function markSwitchedOffActionsByObject(objects: readonly unknown[], served: unknown): void {
  if (!served || typeof served !== 'object' || Array.isArray(served)) return;
  for (const object of objects) {
    const name = (object as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(served, name)) continue;
    markSwitchedOffActions(object, (served as Record<string, unknown>)[name]);
  }
}

/** Is this action switched off for this installation, as the platform served it? */
export function isActionSwitchedOff(action: unknown): boolean {
  return !!action && typeof action === 'object'
    && (action as Record<symbol, unknown>)[ACTION_SWITCHED_OFF_KEY] === true;
}

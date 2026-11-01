/**
 * ObjectUI — served delete cascade (consumer side)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The objects a delete of this object also deletes, as the platform serves
 * them (objectstack#28001, ruling B; ui half objectstack#28472).
 *
 * ## What the platform serves
 *
 * The by-name object read (`GET /api/v1/meta/object/NAME`, and the app bundle's
 * object entries) serves `cascadeDeleteObjects` in its ENVELOPE, beside `item`:
 * the object names a delete reaches through the cascade rule the engine runs,
 * each once, in the order the delete reaches it. `[]` means nothing cascades.
 * The key is ABSENT when no engine answered (a draft read, the list read, an
 * older backend), and absence never means "nothing cascades".
 *
 * ## How it reaches a confirmation
 *
 * The data layer re-attaches the list to the unwrapped schema under
 * {@link CASCADE_DELETE_OBJECTS_KEY} ({@link attachCascadeDeleteObjects}). The
 * key is a non-enumerable SYMBOL, so the list is invisible to
 * `JSON.stringify`, `Object.keys` and a spread: a schema handed back to a
 * metadata write never carries it. The delete confirmation reads it with
 * {@link readCascadeDeleteObjects}.
 *
 * ⛔ No client copy of the cascade rule: nothing here walks relationships. The
 * served list is the one answer.
 */

/** The symbol the served cascade list rides under on a client-side object schema. */
export const CASCADE_DELETE_OBJECTS_KEY: unique symbol = Symbol.for('objectui.cascadeDeleteObjects');

/**
 * Stamp the served `cascadeDeleteObjects` onto the client-side object schema.
 * In place, and returns `schema`. A value that is not a list of names stamps
 * nothing, so an envelope without the key leaves the schema as it was.
 */
export function attachCascadeDeleteObjects<T>(schema: T, served: unknown): T {
  if (!Array.isArray(served) || !schema || typeof schema !== 'object') return schema;
  const names = served.filter((n): n is string => typeof n === 'string' && n !== '');
  Object.defineProperty(schema, CASCADE_DELETE_OBJECTS_KEY, {
    value: Object.freeze(names),
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return schema;
}

/**
 * The served cascade list off a client-side object schema. `undefined` means
 * no answer was served, not that nothing cascades; `[]` means nothing cascades.
 */
export function readCascadeDeleteObjects(schema: unknown): readonly string[] | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const carried = (schema as Record<symbol, unknown>)[CASCADE_DELETE_OBJECTS_KEY];
  return Array.isArray(carried) ? (carried as readonly string[]) : undefined;
}

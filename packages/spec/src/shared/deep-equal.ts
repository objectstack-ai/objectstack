// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Structural equality for **authored declarations** — the one predicate that
 * answers "did the author write the same thing twice?".
 *
 * It exists because two independent surfaces need that exact question and must
 * not answer it differently:
 *
 *  - **compose** (#5005, `stack.zod.ts`): two stacks declaring the same key
 *    compose fine when the declarations are the SAME, and are a reported
 *    conflict when they differ;
 *  - **the ADR-0087 conversion layer** (#4923, `conversions/walk.ts`): an alias
 *    sitting next to its canonical key is redundant when the two values are the
 *    SAME (the conversion deletes it), and is genuine author ambiguity when
 *    they differ (both survive, and the strict gate refuses naming both).
 *
 * Both are the same judgement — *same declaration or not* — and neither is
 * allowed to guess how to reconcile two different ones. Keeping one definition
 * is what stops the conversion layer and the composer from disagreeing about
 * whether a given pair of values is "the same", which would be visible to
 * authors as two different verdicts on one stack.
 *
 * Deliberately strict and deliberately small:
 *
 *  - keys explicitly set to `undefined` are treated as absent, matching how the
 *    composer reads a declaration in the first place;
 *  - callables compare by reference (`Object.is`) — two distinct closures are
 *    two distinct declarations, which is the honest answer for a config value;
 *  - anything past {@link MAX_COMPARE_DEPTH} compares as NOT equal.
 *
 * @internal — not re-exported from `shared/index`; import by path.
 */

/**
 * Depth ceiling for the recursion.
 *
 * A stack handed to `defineStack` is hand-built objects rather than parsed
 * JSON, so a self-referencing value is reachable and would otherwise be an
 * unbounded recursion on the load path — the same exposure, for the same
 * reason, that `conversions/walk.ts` guards with `MAX_REGION_DEPTH`.
 *
 * Bailing out as **not equal** is the safe direction at both call sites: the
 * composer reports a conflict naming the two stacks, and the conversion layer
 * keeps both spellings so the strict gate names both keys. Neither degrades
 * toward silently dropping an author's value.
 */
const MAX_COMPARE_DEPTH = 32;

/**
 * Deep structural equality between two authored values.
 *
 * @param a - left value
 * @param b - right value
 * @param depth - current recursion depth (internal)
 */
export function deepEqualAuthored(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_COMPARE_DEPTH) return false;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqualAuthored(item, b[i], depth + 1));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).filter((k) => left[k] !== undefined);
  const rightKeys = Object.keys(right).filter((k) => right[k] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((k) => deepEqualAuthored(left[k], right[k], depth + 1));
}

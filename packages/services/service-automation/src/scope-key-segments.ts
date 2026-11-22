// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule every builder in this package follows when it turns a flat dotted
 * key (`step.result`) into a nested object path: **no key reaches a
 * prototype, and the containers the builder creates have none.**
 *
 * Two halves, both required:
 *
 *  1. **Every container the builder creates has no prototype**
 *     (`Object.create(null)`), the root included.
 *  2. **A key with a segment in {@link SCOPE_KEY_SKIPPED_SEGMENTS} is skipped**:
 *     the builder binds or writes nothing for it. Half 1 alone does not cover a
 *     walk that descends into a value the run already holds (a variable whose
 *     value is a plain object, such as `record`): that object keeps its
 *     prototype, and `__proto__` is the one segment that names it.
 *
 * What the rule does NOT say: that a key only ever lands in a container the
 * builder made. The CEL scope walk still writes a dotted key's tail into a
 * value the run holds when the key's head names that value; it never reaches a
 * prototype doing so. (`textTemplateScope` writes into fresh containers only.)
 *
 * **Why `__proto__` alone.** `constructor` and `prototype` cannot reach a
 * prototype under these two halves: in a container the builder made they are
 * ordinary own keys, and the walk only descends into a slot holding an object
 * (`typeof === 'object'`), so an inherited `constructor` (a function) is never
 * walked into, and a plain object has no `prototype` slot to walk. Both are
 * also legal flow-variable names (the spec's `assignments` key schema refuses
 * only `__proto__`), and a variable named `prototype` is read as
 * `vars["prototype"]`, the remedy the retired template dialect's refusal
 * prints (`value-slot-template-grammar.test.ts`).
 *
 * **Skipped, not refused.** A refusal (a throw) would fail every evaluation of
 * the run, including predicates and values that never read the key, so one
 * key a caller put in the run would stop it. Skipping confines the effect to
 * the readers of that exact key, and no CEL spelling reads a variable named
 * `__proto__`. The run's variable map itself is untouched: the key stays in the
 * run's state; only the scope an expression reads leaves it out.
 */
export const SCOPE_KEY_SKIPPED_SEGMENTS: ReadonlySet<string> = new Set(['__proto__']);

/** Whether any segment of a split key is one {@link SCOPE_KEY_SKIPPED_SEGMENTS} names. */
export function isSkippedScopeKey(segments: readonly string[]): boolean {
    return segments.some((segment) => SCOPE_KEY_SKIPPED_SEGMENTS.has(segment));
}

/** A scope container with no prototype — what every builder here creates. */
export function scopeContainer(): Record<string, unknown> {
    return Object.create(null) as Record<string, unknown>;
}

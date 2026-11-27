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
 * **Why `__proto__` alone here.** `constructor` and `prototype` cannot reach a
 * prototype under these two halves: in a container the builder made they are
 * ordinary own keys, and the walk only descends into a slot holding an object
 * (`typeof === 'object'`), so an inherited `constructor` (a function) is never
 * walked into, and a plain object has no `prototype` slot to walk. The scope
 * still binds them, because a run is handed keys no door judges (a trigger
 * record's own field names), and a field named `prototype` is read as
 * `record.prototype` or `vars["prototype"]`. What an author or a resume caller
 * may NAME is the doors' rule below ({@link RESERVED_VARIABLE_KEY_SEGMENTS}).
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


/**
 * The segments no flow variable key may have — as its whole name or as any
 * dot-separated part of it — at the two doors that take a key from outside the
 * engine:
 *
 *  - **the authoring door** (`registerFlow`, and the stored pass that previews
 *    it): a declared variable's `name`, an `assignment` node's targets in each
 *    of their shapes, a node's `outputVariable` / `iteratorVariable` /
 *    `indexVariable` / `errorVariable`, and a `screen` field's `name`;
 *  - **the resume door** (`resume`): each key of a signal's `output` and
 *    `variables` (a screen's submitted `inputs`), refused before anything reads
 *    the submitted values, so a refused signal folds nothing and the pause stays
 *    live.
 *
 * A superset of {@link SCOPE_KEY_SKIPPED_SEGMENTS}: the scope builder skips the
 * one segment that names a prototype; the doors refuse all three names that
 * spell one, so no key a flow names or a caller sends is one.
 */
export const RESERVED_VARIABLE_KEY_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** The sentence both doors open their refusal with. */
export const RESERVED_VARIABLE_KEY_REFUSAL =
    'A flow variable key may not use `__proto__`, `constructor` or `prototype` as its name or as any dot-separated part of it.';

/** Whether a key, split on `.`, has a segment {@link RESERVED_VARIABLE_KEY_SEGMENTS} names. */
export function hasReservedVariableKeySegment(key: string): boolean {
    return key.split('.').some((segment) => RESERVED_VARIABLE_KEY_SEGMENTS.has(segment));
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule every flow scope builder in this package follows when it turns the
 * run's flat variable keys (`step.result`) into nested object paths: **no
 * variable key can write outside the run's own scope object.**
 *
 * Two halves, both required:
 *
 *  1. **Every container the builder creates has no prototype**
 *     (`Object.create(null)`), the root included. A key is then only ever an
 *     own property of an object the builder made.
 *  2. **A key with a segment in {@link SCOPE_KEY_SKIPPED_SEGMENTS} is skipped**:
 *     the builder binds nothing for it. Half 1 alone does not cover a walk that
 *     descends into a value the run already holds (a variable whose value is a
 *     plain object, such as `record`): that object keeps its prototype, so a
 *     segment naming the prototype chain would leave the scope through it.
 *
 * **Skipped, not refused.** A refusal (a throw) would fail every evaluation of
 * the run, including predicates and values that never read the key, so one
 * unusual key, or a field of the object legally named `constructor`, would
 * stop every flow that carries it. Skipping confines the effect to the readers
 * of that exact key, and a reader still faults loudly: an unbound name answers
 * the CEL evaluator's `No such key` (or `Unknown variable`), which
 * `evaluateCondition` / `evaluateValueEnvelope` raise as an attributed flow
 * failure. The run's variable map itself is untouched: the key stays in the
 * run's state; only the scope an expression reads leaves it out.
 */
export const SCOPE_KEY_SKIPPED_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Whether any segment of a split variable key is one {@link SCOPE_KEY_SKIPPED_SEGMENTS} names. */
export function isSkippedScopeKey(segments: readonly string[]): boolean {
    return segments.some((segment) => SCOPE_KEY_SKIPPED_SEGMENTS.has(segment));
}

/** A scope container with no prototype — what every builder here creates. */
export function scopeContainer(): Record<string, unknown> {
    return Object.create(null) as Record<string, unknown>;
}

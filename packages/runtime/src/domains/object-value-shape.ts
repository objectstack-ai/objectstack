// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9416, #25821, #25976] THE value-shape check for request input that must be
 * a JSON object (a map of names to values). Every door that starts or resumes a
 * run asks it, so the doors of one engine ask the same question and answer it
 * in the same words — a second spelling of it is how they disagreed:
 *
 *  - the resume door (`domains/automation.ts`): the body itself, and its
 *    `inputs`, `variables` and `output` bags;
 *  - the trigger door (`buildAutomationContext`, shared by both trigger routes
 *    and every declared `type: 'flow'` endpoint): the body itself, and its
 *    `params` bag;
 *  - the action door (`domains/actions.ts`): its `params` bag.
 *
 * It lived inside `domains/automation.ts` while only the two flow doors asked
 * it; the action door asking too is why it lives here, in a module both domains
 * import, rather than a copy over there.
 *
 * Returns the located `fields[]` entry (ADR-0114 `invalid_type`) for a value
 * that is not an object, `undefined` otherwise. `undefined` counts as ABSENT,
 * never mis-shaped: `JSON.stringify` drops such a key, so no HTTP caller can
 * send one, and the in-process spelling `{ key: maybeUndefined }` means "not
 * sent". An explicit `null` IS refused — JSON can express it, and it is the
 * value that used to be dropped most quietly of all. A door whose bodyless
 * request is legal (a JSON `null` body included) reads the body as
 * `body ?? {}` before asking, so absence keeps its empty bag there too.
 *
 * `expected` names what the door accepts in place of the generic "an object (a
 * map of names to values)": the resume body's keys are a closed set, so it
 * names them. Only the wording varies; the judgement is this one.
 */
export function objectValueFailure(
    field: string,
    value: unknown,
    expected = 'an object (a map of names to values)',
): { field: string; code: 'invalid_type'; message: string } | undefined {
    if (value === undefined) return undefined;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return undefined;
    const received = value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`;
    return {
        field,
        code: 'invalid_type',
        message: `expected ${expected}, received ${received}`,
    };
}

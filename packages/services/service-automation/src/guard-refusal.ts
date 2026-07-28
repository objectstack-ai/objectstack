// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The "this failure is a guard refusal" marker (#3863).
 *
 * Lives in its own module because both ends need it and they already form a
 * chain: `engine.ts` imports `runtime-identity.ts`, so the guard that throws
 * cannot import the engine back without a cycle.
 *
 * ## Why a refusal is marked at all
 *
 * A `fault` edge routes a failed node to a handler instead of aborting the run.
 * That is the right primitive for the world not cooperating — a 404, a
 * rate-limit, a query that matched nothing.
 *
 * It is the wrong primitive for the refuse-to-execute family (#3810 erased a
 * filter condition, ADR-0049/#1888 a run would execute unscoped). Those report
 * that the METADATA is wrong; re-running changes nothing, and the refusal is
 * the safety property itself. If they routed, one `fault` edge on a
 * `delete_record` would disable #3810's protection against emptying the object
 * while the run still reported success — a one-edge switch for turning the
 * platform's data-safety guarantees off, which is exactly the kind of
 * suppression an AI authoring loop reaches for first.
 *
 * Returned failures carry `errorClass: 'guard'` on the node result. THROWN ones
 * carry this symbol instead, and the engine's catch path honours both.
 */
export const GUARD_REFUSAL: unique symbol = Symbol.for(
    'objectstack.automation.guardRefusal',
) as never;

/** Brand `err` as a guard refusal, so a `fault` edge will not route it. */
export function markGuardRefusal<E extends object>(err: E): E {
    Object.defineProperty(err, GUARD_REFUSAL, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return err;
}

/** True when `err` was raised by a refuse-to-execute guard. */
export function isGuardRefusal(err: unknown): boolean {
    return (
        !!err
        && typeof err === 'object'
        && (err as Record<PropertyKey, unknown>)[GUARD_REFUSAL] === true
    );
}

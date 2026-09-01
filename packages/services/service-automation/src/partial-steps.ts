// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { StepLogEntry } from './engine.js';

/**
 * The "this thrown failure carries a dead container's body steps" brand (#13803).
 *
 * ## The defect this closes
 *
 * A `loop` that dies mid-sweep used to discard its body's steps wholesale. The
 * engine splices a container's `childSteps` into the run log only after a
 * SUCCESSFUL node result, and a `loop` whose body throws never produces a
 * result at all — the throw unwinds straight past the splice, taking the
 * accumulated array with the stack frame. A sweep that genuinely performed
 * three flag writes and two notifies before dying reported
 * `{ selected: 5, acted: 0 }`, and the step log kept no record of writes that
 * were already committed to the database.
 *
 * The direction is what makes it dangerous, and it is not a counting bug. An
 * operator reading `acted: 0` on a failed sweep reasonably concludes "nothing
 * happened, safe to re-run" — but the writes DID happen. For a non-idempotent
 * body (notifications, counters, external calls) that misread invites
 * double-execution. The run summary is the platform's own honesty instrument
 * (#4354), and on this path it was wrong in the direction that causes harm.
 *
 * ## Why a brand on the error rather than a returned result
 *
 * The engine reaches a dying executor through exactly two channels: the return
 * value, or the exception. #7546 already built the out-parameter half of this
 * — `runRegion`'s `partialSteps` sink — for the ENGINE-to-executor direction,
 * and deliberately did not use the exception there because it "would either
 * change what callers catch or require a bespoke error type".
 *
 * Neither cost applies here, because this is the other direction and the
 * pattern already exists in this package: #3863's {@link markGuardRefusal}
 * carries "this failure is un-routable" out through the identical throw path,
 * as a non-enumerable symbol-keyed brand on the error object. Nothing about
 * the error changes — same identity, same `message`, same `instanceof`, same
 * guard-refusal marking — so every existing probe and `catch` keeps reading
 * exactly what it read before. The alternative (having `loop` swallow the
 * failure and RETURN `{ success: false, childSteps }`) would rewrite the run's
 * error text, change the step's error code from `EXECUTION_ERROR` to
 * `NODE_FAILURE`, set `$error` where it previously stayed unset, and — the
 * reason it was rejected outright — make a guard refusal raised inside a loop
 * body routable by a `fault` edge on the loop, which is precisely the
 * one-edge-switch that #3863 exists to prevent. A record fix must not move
 * accept/reject behaviour.
 *
 * ## Nesting
 *
 * The brand is deliberately writable: as a failure unwinds through nested
 * containers, each one re-brands the same error with its OWN accumulated
 * steps. That is correct rather than lossy, because an outer container's sink
 * has already absorbed the inner one's steps by then (the engine splices the
 * inner container's partial steps into the region array that becomes the outer
 * container's sink), so the last write is a superset of every earlier one and
 * each step object still reaches the run log exactly once.
 *
 * @see {@link markGuardRefusal} in `guard-refusal.ts` — the same idiom, for the
 * same throw path, established by #3863.
 */
export const PARTIAL_STEPS: unique symbol = Symbol.for(
    'objectstack.automation.partialSteps',
) as never;

/**
 * Brand `err` with the body steps a dying container completed before it failed,
 * so the engine's catch path can fold them into the run log.
 *
 * Copies the array: the caller's accumulator may keep changing (or be reused),
 * and a step log that mutates after the fact is not a record.
 */
export function attachPartialSteps<E extends object>(err: E, steps: readonly StepLogEntry[]): E {
    Object.defineProperty(err, PARTIAL_STEPS, {
        value: [...steps],
        enumerable: false,
        // Writable/configurable on purpose — see "Nesting" above. A
        // non-writable brand would make the SECOND container to unwind throw a
        // TypeError, turning a nested-loop failure into an engine crash.
        configurable: true,
        writable: true,
    });
    return err;
}

/** The body steps a dying container carried out, if it carried any. */
export function readPartialSteps(err: unknown): StepLogEntry[] | undefined {
    if (!err || typeof err !== 'object') return undefined;
    const steps = (err as Record<PropertyKey, unknown>)[PARTIAL_STEPS];
    return Array.isArray(steps) ? (steps as StepLogEntry[]) : undefined;
}

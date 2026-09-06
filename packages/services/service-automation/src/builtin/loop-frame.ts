// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The enclosing `loop` iteration a nested container is running for (#14456).
 *
 * `loop { body: [ try_catch { try, catch } ] }` is the ruled containment
 * spelling for a per-iteration failure that must not end the sweep (maintainer
 * ruling 2026-08-31, branch B). The catch region therefore has to know WHICH
 * ROW failed — to record it, to notify about it, to retry it later — and the
 * `try_catch` executor is handed only its own node, the shared variable scope
 * and the trigger context. None of the three names the row: `iteratorVariable`
 * is the loop's config, not the container's, and the shared scope holds the
 * item under a name only the loop knows.
 *
 * So the loop publishes the row identity for the duration of the body region
 * and a nested container reads it. Two properties make that safe:
 *
 *  - **`AsyncLocalStorage`, not a field on the engine.** A body region is
 *    `await`ed, and two `parallel` branches — or two whole loops inside one
 *    `parallel` — run their bodies CONCURRENTLY over the same engine. A stored
 *    "current iteration" would be read by whichever continuation resumed next;
 *    an ALS frame is scoped to the async subtree that established it, so each
 *    iteration reads its own. Same primitive the ObjectQL engine uses for its
 *    ambient transaction, for the same reason.
 *  - **The frame names the SCOPE it belongs to**, and a reader must present a
 *    matching one. A region runs in the ENCLOSING variable scope — the same
 *    `Map` identity — so a `try_catch` that receives the loop's map is inside
 *    that loop's body. A `subflow` / `map` child run gets a FRESH map, and its
 *    executors therefore read no frame even though the ALS context propagates
 *    into the child: a parent's row identity never leaks onto a child run's
 *    `$error`, which nothing else here would have prevented.
 *
 * Innermost wins, for free: nested loops nest their frames, so the inner
 * loop's iteration is the one a `try_catch` between them reads — which is the
 * `iteration` the run log's own "innermost container" tagging rule records.
 */
export interface LoopIterationFrame {
    /** Zero-based index of the iteration whose body is running. */
    readonly iteration: number;
    /** The value bound to the loop's `iteratorVariable` for this iteration. */
    readonly item: unknown;
    /**
     * The variable scope the loop bound the item in. A reader passes the scope
     * it was itself handed and gets the frame only when the two are the same
     * `Map` — see the class doc.
     */
    readonly scope: Map<string, unknown>;
}

const frames = new AsyncLocalStorage<LoopIterationFrame>();

/**
 * Run one loop iteration's body with `frame` published to everything it
 * `await`s. The return value and any throw pass through untouched: this wraps
 * the body region's execution, it does not participate in it.
 */
export function runInLoopIteration<T>(frame: LoopIterationFrame, body: () => Promise<T>): Promise<T> {
    return frames.run(frame, body);
}

/**
 * The enclosing loop iteration for a node executing in `scope`, or `undefined`
 * when there is none — no loop above it, or a loop whose scope this is not
 * (a `subflow` / `map` child run). "Absent" is the answer "not inside a loop
 * body", which is exactly what a `TryCatchErrorValue` without `iteration` /
 * `item` means.
 */
export function currentLoopIteration(scope: Map<string, unknown>): LoopIterationFrame | undefined {
    const frame = frames.getStore();
    return frame !== undefined && frame.scope === scope ? frame : undefined;
}

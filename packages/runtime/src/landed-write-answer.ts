// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28861] A write an author's code makes, which the engine STORED, answers its
 * own success to that code — even when a parent's roll-up summary could not be
 * recomputed after it (seat ruling 6570987196 on #28861).
 *
 * ## The case
 *
 * The engine reports it as objectql's `SummaryRecomputeError`
 * (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written"), carrying as
 * `written` the result the call returns when every roll-up recomputes. The
 * data doors and the MCP tools answer it as the write's success (#28781,
 * #28843, #28854, #28882). The write surfaces an author's code holds handed it
 * straight in: the body's next line never ran, its own result never existed,
 * and the action, hook or job reported a failure for a write that had landed,
 * so a caller that retried wrote it twice. No transaction wraps a body, so its
 * earlier writes stayed committed either way.
 *
 * ## The answer
 *
 * The `written` result, returned as the call's own answer — exactly what the
 * same write answers on a healthy recompute, nothing added — with the stale
 * column said once per field per process at `error`, in the line the doors
 * log (`staleSummaryAnswerLines`). Every other error, a refusal raised before
 * the write was stored among them, is rethrown unchanged.
 *
 * The surfaces, each built here or calling in here:
 *  - `ctx.engine` in an action handler (`buildActionEngineFacade`);
 *  - `ctx.api` in an action handler (`buildActionApi`, objectql's
 *    `createContext`), and every context it derives;
 *  - a sandboxed hook, action or job body's `ctx.api`, whatever source the
 *    sandbox builds it from (`buildSandboxApi`, `sandbox/body-runner.ts`).
 *
 * The flow record nodes answer the same refusal the same way in
 * `@objectstack/service-automation` (`builtin/crud-nodes.ts`).
 *
 * ⛔ Not in the engine, and not in objectql's `ScopedContext`: a bulk caller
 * (the seed loader, the import runner) reads the refusal as "written, with a
 * stale summary" and reports that in its own result, and platform code holding
 * a `HookContext.api` reads it as before. The ruling covers what an author's
 * code holds, so the answer is given where that surface is built.
 */

import { staleSummaryAnswerLines, staleSummaryRefusalOrThrow } from '@objectstack/types';

import { deriveThroughSeam, WRITE_RETURN_VERBS } from './stored-metadata-reader-seam.js';

/**
 * A write's `catch` on an author-visible surface: the stale-roll-up refusal
 * answers the result the write earned (its `written`), the stale column said
 * at `error` under `surface`; every other error is rethrown unchanged.
 */
export function landedWriteAnswer(e: unknown, object: string | undefined, surface: string): any {
    const stale = staleSummaryRefusalOrThrow(e);
    for (const line of staleSummaryAnswerLines(stale, object)) console.error(`[${surface}] ${line}`);
    return stale.written;
}

/** Marks a scoped API whose landed writes are already answered, so a second wrap is a no-op. */
const LANDED_WRITES_ANSWERED = Symbol.for('objectstack.runtime.landedWritesAnswered');

/** One repository, every write verb answering its landed write; every other member handed through. */
function answerRepositoryLandedWrites(objectName: string, repo: unknown, surface: string): unknown {
    if (repo === null || typeof repo !== 'object') return repo;
    return new Proxy(repo as Record<PropertyKey, unknown>, {
        get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (typeof value !== 'function') return value;
            if (!WRITE_RETURN_VERBS.has(prop)) return value.bind(target);
            return async (...args: unknown[]) => {
                try {
                    return await value.apply(target, args);
                } catch (e) {
                    return landedWriteAnswer(e, objectName, surface);
                }
            };
        },
    });
}

/**
 * The scoped data API an author's code holds (`ctx.api`), with every
 * repository's write answering a landed write's success
 * ({@link landedWriteAnswer}), on `api` and every context it derives
 * (`object(name)`, `sudo()`, `withRunAs(...)`, a `transaction(fn)` callback's
 * context, the `ctx` `beginTransaction()` returns). Everything else is the same
 * object, by delegation.
 *
 * Wrap it BENEATH the stored-metadata reader seam, so the result it answers is
 * served by that seam like any write's return. Idempotent; a value that is not
 * an object is returned as is.
 */
export function answerLandedWritesDespiteStaleSummary<T>(api: T, surface: string): T {
    return deriveThroughSeam(api, LANDED_WRITES_ANSWERED, (name, repo) => answerRepositoryLandedWrites(name, repo, surface));
}

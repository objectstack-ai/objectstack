// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared lifecycle-hook dispatchers (#5282).
 *
 * ## Why this module exists
 *
 * `ObjectKernel` does not extend `ObjectKernelBase` — it is a standalone
 * production kernel with its own `plugins`/`services`/`hooks`/`state`/`logger`
 * fields, and only `LiteKernel` extends the base. Making it inherit was
 * considered and **rejected** (#5282, option A: an inheritance refactor of a
 * 800-line production kernel, risk out of proportion to the benefit). What was
 * ruled instead is this module (option B): the two *dispatch flavours* become
 * module-level functions both kernels call, so a change to how a hook is
 * dispatched is written once and lands on both kernels.
 *
 * Before this, dispatch existed twice with no shared code path — the base's
 * `triggerHook` / `triggerHookOrThrow` / `context.trigger` on one side, and
 * `ObjectKernel`'s private `triggerShutdownHookIsolating` / `context.trigger`
 * on the other. The two isolating loops printed the same log line **because
 * someone typed it twice**. That hand-mirroring is the structural seam three
 * consecutive bugs grew on, every one of them the same shape — one hook name
 * meaning opposite things on the two kernels:
 *
 *   - #5170 — `kernel:ready`: LiteKernel swallowed a throwing handler while
 *     ObjectKernel failed the boot.
 *   - #5257 — `kernel:bootstrapped` / `kernel:listening`: same, and the ugliest
 *     specimen — `HonoServerPlugin` awaits `server.listen(port)` inside
 *     `kernel:listening`, so on LiteKernel a failed listen was swallowed and
 *     the process printed "✅ Bootstrap complete" with nothing listening.
 *   - #5274 — `kernel:shutdown`, in the opposite direction: ObjectKernel's
 *     propagating dispatch let one bad handler skip every `destroy()` and
 *     `process.exit(1)`.
 *
 * The **storage** is deliberately still two maps (out of the ruling's scope);
 * only the dispatch is shared. The paired-pin gate
 * (`scripts/check-kernel-hook-pairs.mjs`, option C of the same ruling) covers
 * the residue: every `kernel:*` hook dispatched in `packages/core/src` must
 * carry a named pin in BOTH `kernel.test.ts` and `lite-kernel.test.ts`, so a
 * fifth lifecycle hook cannot arrive paired on one kernel only.
 *
 * ## Choosing a flavour
 *
 * The choice is per hook, not per kernel, and it is a judgement recorded at
 * each dispatch site:
 *
 *   - **Boot path** (`kernel:ready`, `kernel:bootstrapped`, `kernel:listening`)
 *     ⇒ {@link dispatchHookPropagating}. Everything dispatched before
 *     "✅ Bootstrap complete" is a precondition of that claim; swallowing a
 *     throw there does not rescue the boot, it only hides the failure behind a
 *     process reporting success.
 *   - **Teardown path** (`kernel:shutdown`) ⇒ {@link dispatchHookIsolating}.
 *     There is no "refuse to proceed" left to buy: what is queued behind a
 *     failing handler is the rest of the cleanup — the other subscribers, then
 *     each plugin's `destroy()` — which is what flushes buffers, closes
 *     connections and releases locks.
 *
 * ⛔ Internal module: not exported from `packages/core/src/index.ts`. These are
 * kernel internals, not a public dispatch API.
 */

/** A registered lifecycle-hook handler, exactly as `PluginContext.hook` stores it. */
export type HookHandler = (...args: any[]) => void | Promise<void>;

/**
 * The slice of the logger contract a dispatcher uses. Structural on purpose:
 * both `ObjectLogger` (what `ObjectKernel` holds) and the spec `Logger`
 * contract (what `ObjectKernelBase` holds) satisfy it without either kernel
 * importing the other's logger type.
 */
export interface HookDispatchLogger {
    debug(message: string, meta?: Record<string, any>): void;
    error(message: string, error?: Error, meta?: Record<string, any>): void;
}

/**
 * The trace line every *logged* dispatch emits before running handlers.
 *
 * Kept in one place because it is asserted verbatim on both kernels. Note the
 * handler count is read here, before the loop — the same instant both
 * hand-written copies read it.
 */
function traceDispatch(name: string, handlers: readonly HookHandler[], logger: HookDispatchLogger): void {
    logger.debug(`Triggering hook: ${name}`, {
        hook: name,
        handlerCount: handlers.length,
    });
}

/**
 * Dispatch a hook ISOLATING failures: a handler that throws is logged as
 * `Hook handler failed: <name>` and the remaining handlers still run.
 *
 * Used by `ObjectKernelBase.triggerHook` and by `ObjectKernel`'s own
 * `kernel:shutdown` dispatch — the two sites that until #5282 were separate
 * hand-written loops printing the same line.
 *
 * ⛔ Wrong dispatcher for anything on the BOOT path — see the module docs and
 * {@link dispatchHookPropagating}.
 *
 * `handlers` is taken by reference, never copied: a handler that subscribes
 * another handler to the same hook mid-dispatch is picked up by this loop, and
 * that has always been true of both originals.
 *
 * @param name - Hook name
 * @param handlers - The hook's registered handlers, in registration order
 * @param logger - Receives the dispatch trace and one error line per failure
 * @param args - Arguments to pass to each handler
 */
export async function dispatchHookIsolating(
    name: string,
    handlers: readonly HookHandler[],
    logger: HookDispatchLogger,
    args: readonly any[] = [],
): Promise<void> {
    traceDispatch(name, handlers, logger);

    for (const handler of handlers) {
        try {
            await handler(...args);
        } catch (error) {
            logger.error(`Hook handler failed: ${name}`, error as Error);
            // Continue with other handlers even if one fails
        }
    }
}

/**
 * Dispatch a hook PROPAGATING the first failure: the remaining handlers do not
 * run and the original error reaches the caller unwrapped.
 *
 * Used by `ObjectKernelBase.triggerHookOrThrow` (the boot-path hooks on
 * `LiteKernel`) and by BOTH kernels' `PluginContext.trigger`.
 *
 * `logger` is optional, and its absence is the one behavioural difference
 * between those callers: `context.trigger` has never emitted the
 * `Triggering hook: <name>` trace, so it passes no logger. Handing it one would
 * add a debug line to a path that has never had one — a behaviour change, and
 * #5282 preserves every call path's semantics exactly.
 *
 * @param name - Hook name
 * @param handlers - The hook's registered handlers, in registration order
 * @param logger - When given, receives the dispatch trace; omit to stay silent
 * @param args - Arguments to pass to each handler
 */
export async function dispatchHookPropagating(
    name: string,
    handlers: readonly HookHandler[],
    logger: HookDispatchLogger | undefined,
    args: readonly any[] = [],
): Promise<void> {
    if (logger) traceDispatch(name, handlers, logger);

    for (const handler of handlers) {
        await handler(...args);
    }
}

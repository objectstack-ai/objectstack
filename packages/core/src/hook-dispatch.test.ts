// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
    dispatchHookIsolating,
    dispatchHookPropagating,
    type HookDispatchLogger,
    type HookHandler,
} from './hook-dispatch.js';

/**
 * Direct pins for the two shared dispatch flavours (#5282).
 *
 * These exist as well as — never instead of — the paired kernel pins in
 * `kernel.test.ts` / `lite-kernel.test.ts`. The kernel pins say what each hook
 * MEANS on each kernel; these say what each flavour DOES, once, at the single
 * place both kernels now reach. The division matters for the reverse
 * verification: mutating a function here turns both kernels' files red in one
 * edit, which is the property option B was ruled to buy.
 */

const makeLogger = () => {
    const debug = vi.fn();
    const error = vi.fn();
    const logger: HookDispatchLogger = { debug, error };
    return { logger, debug, error };
};

describe('hook dispatch (shared by ObjectKernel and ObjectKernelBase, #5282)', () => {
    describe('dispatchHookIsolating', () => {
        it('runs every remaining handler when one throws, in registration order', async () => {
            const reached: string[] = [];
            const { logger } = makeLogger();
            const handlers: HookHandler[] = [
                async () => { reached.push('first'); },
                async () => { throw new Error('boom'); },
                async () => { reached.push('third'); },
            ];

            await expect(dispatchHookIsolating('kernel:shutdown', handlers, logger)).resolves.toBeUndefined();

            expect(reached).toEqual(['first', 'third']);
        });

        it('logs each failure as `Hook handler failed: <name>` with the original error', async () => {
            const { logger, error } = makeLogger();
            const boom = new Error('boom');

            await dispatchHookIsolating('kernel:shutdown', [async () => { throw boom; }], logger);

            // The wording is contract: both kernels' pins assert this exact
            // line, and before #5282 it was typed out twice to keep them equal.
            expect(error).toHaveBeenCalledWith('Hook handler failed: kernel:shutdown', boom);
        });

        it('traces `Triggering hook: <name>` with the handler count before running any handler', async () => {
            const { logger, debug } = makeLogger();
            const order: string[] = [];
            debug.mockImplementation(() => { order.push('trace'); });

            await dispatchHookIsolating(
                'kernel:shutdown',
                [async () => { order.push('handler'); }, async () => { order.push('handler'); }],
                logger,
            );

            expect(debug).toHaveBeenCalledWith('Triggering hook: kernel:shutdown', {
                hook: 'kernel:shutdown',
                handlerCount: 2,
            });
            expect(order).toEqual(['trace', 'handler', 'handler']);
        });

        it('passes every argument through to each handler', async () => {
            const { logger } = makeLogger();
            const seen: unknown[][] = [];

            await dispatchHookIsolating(
                'data:beforeInsert',
                [(...args: unknown[]) => { seen.push(args); }, (...args: unknown[]) => { seen.push(args); }],
                logger,
                ['sys_user', { id: 'u1' }],
            );

            expect(seen).toEqual([
                ['sys_user', { id: 'u1' }],
                ['sys_user', { id: 'u1' }],
            ]);
        });

        it('takes the handler array by reference — a handler subscribing mid-dispatch still runs', async () => {
            // Both hand-written originals read the live array off the hooks map
            // and iterated it directly. Pinned so a defensive `[...handlers]`
            // copy cannot change dispatch semantics as a tidy-up.
            const { logger } = makeLogger();
            const reached: string[] = [];
            const handlers: HookHandler[] = [];
            handlers.push(async () => {
                reached.push('first');
                handlers.push(async () => { reached.push('late-subscriber'); });
            });

            await dispatchHookIsolating('kernel:shutdown', handlers, logger);

            expect(reached).toEqual(['first', 'late-subscriber']);
        });
    });

    describe('dispatchHookPropagating', () => {
        it('lets the first failure escape unwrapped and skips the handlers behind it', async () => {
            const reached: string[] = [];
            const { logger, error } = makeLogger();
            const boom = new Error('listen EACCES: permission denied 0.0.0.0:80');
            const handlers: HookHandler[] = [
                async () => { reached.push('first'); },
                async () => { throw boom; },
                async () => { reached.push('never'); },
            ];

            // Identity, not just message: the boot path re-throws the original
            // error to its caller, it does not wrap or re-create it.
            await expect(dispatchHookPropagating('kernel:listening', handlers, logger)).rejects.toBe(boom);

            expect(reached).toEqual(['first']);
            // A propagated failure is the caller's to report — the dispatcher
            // does not also log it.
            expect(error).not.toHaveBeenCalled();
        });

        it('traces `Triggering hook: <name>` with the handler count when a logger is supplied', async () => {
            const { logger, debug } = makeLogger();

            await dispatchHookPropagating('kernel:ready', [async () => {}], logger);

            expect(debug).toHaveBeenCalledWith('Triggering hook: kernel:ready', {
                hook: 'kernel:ready',
                handlerCount: 1,
            });
        });

        it('emits NO trace when no logger is supplied — the `context.trigger` shape', async () => {
            // `PluginContext.trigger` has never logged a dispatch trace on
            // either kernel. Handing it a logger would add a debug line to a
            // path that has never had one; #5282 preserves every call path's
            // semantics exactly, so the absence is pinned rather than assumed.
            const { logger, debug } = makeLogger();
            const reached: string[] = [];

            await dispatchHookPropagating('kernel:ready', [async () => { reached.push('ran'); }], undefined);

            expect(reached).toEqual(['ran']);
            expect(debug).not.toHaveBeenCalled();
            expect(logger.debug).not.toHaveBeenCalled();
        });

        it('passes every argument through to each handler', async () => {
            const seen: unknown[][] = [];

            await dispatchHookPropagating(
                'metadata:reloaded',
                [(...args: unknown[]) => { seen.push(args); }],
                undefined,
                ['sys_user'],
            );

            expect(seen).toEqual([['sys_user']]);
        });
    });

    it('dispatches nothing, and never throws, for a hook with no subscribers', async () => {
        const { logger, debug, error } = makeLogger();

        await expect(dispatchHookIsolating('kernel:shutdown', [], logger)).resolves.toBeUndefined();
        await expect(dispatchHookPropagating('kernel:ready', [], logger)).resolves.toBeUndefined();

        expect(error).not.toHaveBeenCalled();
        expect(debug).toHaveBeenCalledTimes(2);
        expect(debug.mock.calls.map((c) => c[1])).toEqual([
            { hook: 'kernel:shutdown', handlerCount: 0 },
            { hook: 'kernel:ready', handlerCount: 0 },
        ]);
    });
});

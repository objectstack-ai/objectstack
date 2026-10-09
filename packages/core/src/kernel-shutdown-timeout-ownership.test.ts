// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A kernel whose teardown times out exits the process only if it OWNS the
 * process (#22335, ruling B): `gracefulShutdown` true — the default, the kernel
 * installed the signal listeners itself — keeps the hard `exit(1)` (pinned in
 * kernel.test.ts, the #5274 timeout pin). `gracefulShutdown` false means the
 * host owns the process: the kernel logs the timeout, marks itself `stopped`,
 * and `shutdown()` returns to the host, which decides whether the process ends.
 *
 * Before this, the timeout branch called `process.exit(1)` without reading the
 * option, so a host running several `false` kernels in one process (one per
 * environment) lost every one of them when one teardown hung.
 *
 * `process.exit` is stubbed in every test here: the behaviour under test is
 * whether the kernel ends the process, and a real `exit(1)` would end the
 * vitest worker with it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectKernel } from './kernel';
import type { Plugin } from './types';

type ExitSpy = { mock: { calls: unknown[][] }; mockRestore: () => void };
type LogMethod = (message: string, ...rest: unknown[]) => void;

const SHUTDOWN_TIMEOUT_MS = 20;

describe('ObjectKernel shutdown timeout under gracefulShutdown: false', () => {
    let exitSpy: ExitSpy;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never) as unknown as ExitSpy;
    });

    afterEach(() => {
        exitSpy.mockRestore();
    });

    const hostOwnedKernel = () =>
        new ObjectKernel({
            logger: { level: 'silent' },
            gracefulShutdown: false,
            skipSystemValidation: true,
            shutdownTimeout: SHUTDOWN_TIMEOUT_MS,
        });

    const spyOnError = (kernel: ObjectKernel) =>
        vi.spyOn((kernel as unknown as { logger: { error: LogMethod } }).logger, 'error');

    /** A plugin whose `kernel:shutdown` subscriber holds teardown open until released. */
    const hungTeardown = (reached: string[]) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const plugin: Plugin = {
            name: 'hung-teardown',
            version: '1.0.0',
            init: async (ctx) => {
                ctx.hook('kernel:shutdown', async () => {
                    await gate;
                    reached.push('teardown-resumed');
                });
            },
            destroy: async () => { reached.push('destroy'); },
        };
        return { plugin, release: () => release() };
    };

    it('logs the timeout at error, ends stopped, resolves and does NOT exit the process', async () => {
        const reached: string[] = [];
        const { plugin, release } = hungTeardown(reached);
        const kernel = hostOwnedKernel();
        const errorSpy = spyOnError(kernel);
        await kernel.use(plugin);
        await kernel.bootstrap();

        try {
            await expect(kernel.shutdown()).resolves.toBeUndefined();

            expect(exitSpy.mock.calls).toEqual([]);
            expect(kernel.getState()).toBe('stopped');
            const timeoutLines = errorSpy.mock.calls.filter((c) => String(c[0]).startsWith('Shutdown timed out'));
            expect(timeoutLines).toHaveLength(1);
            expect(timeoutLines[0][1]).toBeInstanceOf(Error);
            // The `true` line says an exit is being forced; under `false` none is.
            expect(errorSpy.mock.calls.map((c) => String(c[0]))).not.toContain('Shutdown timed out — forcing exit');
            // The teardown was abandoned, not finished.
            expect(reached).toEqual([]);
        } finally {
            release();
        }

        // The hung teardown keeps running in the background. When it finishes,
        // the kernel does not act on it: still `stopped`, still no exit, and a
        // second `shutdown()` is the already-stopped no-op.
        await vi.waitFor(() => expect(reached).toEqual(['teardown-resumed', 'destroy']));
        expect(kernel.getState()).toBe('stopped');
        await expect(kernel.shutdown()).resolves.toBeUndefined();
        expect(exitSpy.mock.calls).toEqual([]);
        errorSpy.mockRestore();
    });

    it('two host-owned kernels in one process: stopping the hung one leaves the other running and the process alive', async () => {
        const reached: string[] = [];
        const { plugin, release } = hungTeardown(reached);
        const hung = hostOwnedKernel();
        const sibling = hostOwnedKernel();
        await hung.use(plugin);
        await hung.bootstrap();
        await sibling.bootstrap();

        try {
            await hung.shutdown();

            expect(hung.getState()).toBe('stopped');
            expect(sibling.getState()).toBe('running');
            expect(exitSpy.mock.calls).toEqual([]);

            // The sibling is untouched: the host can still stop it normally.
            await sibling.shutdown();
            expect(sibling.getState()).toBe('stopped');
            expect(exitSpy.mock.calls).toEqual([]);
        } finally {
            release();
        }
    });

    // Control: a teardown that FAILS rather than hangs never exited the process
    // under `false`, before this change or after it. Both shapes: a throwing
    // `destroy()` (isolated inside the teardown) and an error escaping the
    // teardown altogether (the non-timeout branch of `shutdown()`'s catch).
    it.each([
        ['a throwing destroy()', (kernel: ObjectKernel) =>
            kernel.use({
                name: 'throwing-destroy',
                version: '1.0.0',
                init: async () => {},
                destroy: async () => { throw new Error('destroy boom'); },
            })],
        ['an error escaping the teardown', async (kernel: ObjectKernel) => {
            vi.spyOn(kernel as unknown as { performShutdown: () => Promise<void> }, 'performShutdown')
                .mockRejectedValue(new Error('teardown boom'));
        }],
    ] as const)('control: %s does not exit the process and is not reported as a timeout', async (_label, arrange) => {
        const kernel = hostOwnedKernel();
        const errorSpy = spyOnError(kernel);
        await arrange(kernel);
        await kernel.bootstrap();

        await expect(kernel.shutdown()).resolves.toBeUndefined();

        expect(exitSpy.mock.calls).toEqual([]);
        expect(kernel.getState()).toBe('stopped');
        expect(errorSpy.mock.calls.some((c) => String(c[0]).startsWith('Shutdown timed out'))).toBe(false);
        errorSpy.mockRestore();
    });
});

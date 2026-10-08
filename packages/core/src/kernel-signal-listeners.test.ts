// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The process signal listeners an `ObjectKernel` installs (`gracefulShutdown`,
 * default `true`) belong to that kernel's LIFE, not to the process's.
 *
 * Before this file the constructor added one anonymous listener per signal
 * (SIGINT, SIGTERM, SIGQUIT), kept no handle, and `shutdown()` never removed
 * them. Every kernel a process built therefore left three handlers behind, and
 * each of them ran `shutdown()` (a no-op on a stopped kernel) and then
 * `process.exit(0)` on the next signal: five built-and-stopped kernels plus a
 * live one turned ONE signal into six exits, the first of them landing before
 * the live kernel had drained.
 *
 * How a signal is simulated here, and why not with `process.kill`: a real
 * signal reaches EVERY listener in the worker, the test runner's own included,
 * and its default action ends the worker. `deliver()` instead calls the
 * listeners this test's kernels added — exactly the set a delivered signal
 * would run on their behalf, in the same order — and `process.exit` is stubbed
 * throughout, so nothing here can end the run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectKernel } from './kernel';
import type { ObjectKernelConfig } from './kernel';
import type { Plugin } from './types';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGQUIT'] as const;
type ShutdownSignal = (typeof SIGNALS)[number];
type SignalListener = (signal: NodeJS.Signals) => void;

const NONE = { SIGINT: 0, SIGTERM: 0, SIGQUIT: 0 };
const ONE_EACH = { SIGINT: 1, SIGTERM: 1, SIGQUIT: 1 };

describe('ObjectKernel process signal listeners', () => {
    let baseline: Map<ShutdownSignal, SignalListener[]>;
    let exits: Array<string | number | null | undefined>;
    let exitSpy: { mockRestore: () => void };

    beforeEach(() => {
        baseline = new Map(SIGNALS.map((s) => [s, process.listeners(s) as SignalListener[]]));
        exits = [];
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
            exits.push(code);
        }) as never);
    });

    afterEach(() => {
        // Leave the worker as it was found whatever the test did: on a tree
        // without the fix, the defect under test IS a listener left behind.
        for (const s of SIGNALS) {
            for (const l of added(s)) process.removeListener(s, l);
        }
        exitSpy.mockRestore();
    });

    /** The listeners kernels built in this test hold on `signal`, oldest first. */
    const added = (signal: ShutdownSignal): SignalListener[] =>
        (process.listeners(signal) as SignalListener[]).filter((l) => !baseline.get(signal)!.includes(l));

    const growth = () => ({
        SIGINT: added('SIGINT').length,
        SIGTERM: added('SIGTERM').length,
        SIGQUIT: added('SIGQUIT').length,
    });

    /** What a delivered `signal` does to those listeners: every one runs, in order. */
    const deliver = (signal: ShutdownSignal) => {
        for (const l of added(signal)) l(signal);
    };

    /** One macrotask: every handler that was going to reach `process.exit` has reached it. */
    const quiesce = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    const newKernel = (config: ObjectKernelConfig = {}) =>
        new ObjectKernel({ logger: { level: 'silent' }, skipSystemValidation: true, ...config });

    /** A plugin whose `kernel:shutdown` subscriber holds teardown open until released. */
    const drainGate = (reached: string[] = []) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const plugin: Plugin = {
            name: 'drain-gate',
            version: '1.0.0',
            init: async (ctx) => {
                ctx.hook('kernel:shutdown', async () => {
                    await gate;
                    reached.push('drained');
                });
            },
            destroy: async () => { reached.push('destroy'); },
        };
        return { plugin, release: () => release() };
    };

    it('five kernels built and stopped leave the baseline listener count on SIGINT, SIGTERM and SIGQUIT', async () => {
        for (let i = 0; i < 5; i++) {
            const kernel = newKernel();
            // Positive control: a live kernel DOES hold one listener per
            // signal, so the zero below is a removal and not an absence.
            expect(growth()).toEqual(ONE_EACH);
            await kernel.bootstrap();
            await kernel.shutdown();
            expect(growth()).toEqual(NONE);
        }
        expect(exits).toEqual([]);
    });

    it('one signal produces one exit with five stopped kernels and one live kernel in the process', async () => {
        for (let i = 0; i < 5; i++) {
            const stopped = newKernel();
            await stopped.bootstrap();
            await stopped.shutdown();
        }
        const live = newKernel();
        await live.bootstrap();
        const listening = growth();

        deliver('SIGTERM');
        await vi.waitFor(() => expect(live.getState()).toBe('stopped'));
        await quiesce();

        expect(exits).toEqual([0]);
        // Only the live kernel was listening, and it gave its listeners back too.
        expect(listening).toEqual(ONE_EACH);
        expect(growth()).toEqual(NONE);
    });

    // Control: the defect fix must not cost the one thing these listeners are
    // for. `objectstack serve` installs no signal handler of its own and relies
    // on exactly this path to drain and exit.
    it.each(SIGNALS)('a running kernel still drains and exits once on %s', async (signal) => {
        const reached: string[] = [];
        exitSpy.mockRestore();
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
            exits.push(code);
            reached.push(`exit:${String(code)}`);
        }) as never);
        const { plugin, release } = drainGate(reached);
        const kernel = newKernel();
        await kernel.use(plugin);
        await kernel.bootstrap();

        deliver(signal);
        release();
        await vi.waitFor(() => expect(kernel.getState()).toBe('stopped'));
        await quiesce();

        // Teardown ran to the end BEFORE the process was exited, and exactly once.
        expect(reached).toEqual(['drained', 'destroy', 'exit:0']);
        expect(exits).toEqual([0]);
        expect(growth()).toEqual(NONE);
    });

    it('a repeated signal during a signal-driven drain is absorbed by the kernel and starts no second exit', async () => {
        const { plugin, release } = drainGate();
        const kernel = newKernel();
        await kernel.use(plugin);
        await kernel.bootstrap();

        deliver('SIGINT');
        await vi.waitFor(() => expect(kernel.getState()).toBe('stopping'));
        // Still installed while draining. A terminal's Ctrl-C can reach the
        // process twice (the process group, and a parent that forwards it);
        // with no listener left, Node's default action would end the process
        // in the middle of the drain this signal started.
        expect(growth()).toEqual(ONE_EACH);
        deliver('SIGINT');
        deliver('SIGTERM');
        await quiesce();
        expect(exits).toEqual([]);

        release();
        await vi.waitFor(() => expect(kernel.getState()).toBe('stopped'));
        await quiesce();

        expect(exits).toEqual([0]);
        expect(growth()).toEqual(NONE);
    });

    it('a signal that arrives while the host is stopping the kernel does not exit the process', async () => {
        const { plugin, release } = drainGate();
        const kernel = newKernel();
        await kernel.use(plugin);
        await kernel.bootstrap();

        const stopping = kernel.shutdown();
        expect(kernel.getState()).toBe('stopping');
        deliver('SIGTERM');
        await quiesce();
        // The host owns this shutdown and what follows it; the drain it
        // started is still running and must not be cut short.
        expect(exits).toEqual([]);

        release();
        await stopping;
        await quiesce();

        expect(kernel.getState()).toBe('stopped');
        expect(exits).toEqual([]);
        expect(growth()).toEqual(NONE);
    });

    it('a kernel whose bootstrap failed releases its listeners', async () => {
        const kernel = newKernel();
        await kernel.use({
            name: 'init-thrower',
            version: '1.0.0',
            init: async () => { throw new Error('init boom'); },
        });
        await expect(kernel.bootstrap()).rejects.toThrow('init boom');

        expect(kernel.getState()).toBe('stopped');
        expect(growth()).toEqual(NONE);
        expect(exits).toEqual([]);
    });

    it('gracefulShutdown: false installs no listener at all', async () => {
        const kernel = newKernel({ gracefulShutdown: false });
        expect(growth()).toEqual(NONE);
        await kernel.bootstrap();
        await kernel.shutdown();
        expect(growth()).toEqual(NONE);
    });
});

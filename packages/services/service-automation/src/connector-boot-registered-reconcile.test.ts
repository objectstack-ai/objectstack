// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28591] A provider-bound connector entry a plugin registers during
// `kernel:ready` — after the boot reconcile in `start()` — is materialized
// before the boot completes.
//
// The install-local rehydrate is the producer this covers: it re-registers every
// installed package in its own `kernel:ready` handler and announces no reload.
// Before the fix, the boot reconcile in `start()` was the only one a boot ran,
// so a rehydrated package's connector stayed absent from `GET /connectors`
// until some unrelated `metadata:reloaded`.
//
// Pinned here:
//   1. an entry registered during `kernel:ready` is listed and dispatchable once
//      `bootstrap()` resolves, and the host entry is not materialized again;
//   2. a boot that registers nothing after `start()` runs ONE reconcile (control);
//   3. a configuration fault in an entry registered during `kernel:ready` is
//      logged and that entry skipped — the boot completes and the rest of the
//      batch is materialized (reload semantics, as on install).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel, ObjectLogger } from '@objectstack/core';
import type { Connector, ConnectorProviderContext, ConnectorProviderFactory } from '@objectstack/spec/integration';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

afterEach(() => {
    vi.restoreAllMocks();
});

/** A provider-bound declarative entry, as `registerApp` stores it. */
function providerConnector(name: string, provider = 'fake') {
    return { name, label: name, type: 'api', provider, providerConfig: {} };
}

/** A factory that records each materialization and returns a one-action connector. */
function makeProvider() {
    const calls: ConnectorProviderContext[] = [];
    const factory: ConnectorProviderFactory = (ctx) => {
        calls.push(ctx);
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                authentication: { type: 'none' },
                actions: [{ key: 'ping', label: 'Ping' }],
            } as unknown as Connector,
            handlers: { ping: async () => ({ ok: true }) },
        };
    };
    return { factory, calls };
}

/**
 * Boot the automation plugin over a registry holding `atStart`, with a harness
 * that appends `atReady` to the registry in its `kernel:ready` handler — the
 * shape of the install-local rehydrate.
 */
async function boot(atStart: unknown[], atReady: unknown[], factory: ConnectorProviderFactory) {
    const declared = [...atStart];
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.rehydrate-harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', {
                registry: { listItems: (type: string) => (type === 'connector' ? declared : []) },
            });
            ctx.getService('automation').registerConnectorProvider('fake', factory);
        },
        async start(ctx: any) {
            ctx.hook('kernel:ready', async () => {
                declared.push(...atReady);
            });
        },
    } as never);
    await kernel.bootstrap();
    return { kernel, engine: kernel.getService('automation') as AutomationEngine };
}

const reconcileSpy = () =>
    vi.spyOn(AutomationServicePlugin.prototype as any, 'reconcileDeclaredConnectors');

describe('[#28591] connectors registered during kernel:ready are materialized before the boot completes', () => {
    it('lists and dispatches an entry registered during kernel:ready, without re-materializing the host entry', async () => {
        const { factory, calls } = makeProvider();
        const { kernel, engine } = await boot([providerConnector('host_conn')], [providerConnector('installed_conn')], factory);

        expect(engine.getRegisteredConnectors()).toEqual(expect.arrayContaining(['host_conn', 'installed_conn']));
        expect(engine.getConnectorOrigin('installed_conn')).toBe('declarative');
        expect(calls.map((c) => c.name)).toEqual(['host_conn', 'installed_conn']);

        engine.registerFlow('call_installed', {
            name: 'call_installed',
            label: 'Call installed',
            type: 'autolaunched',
            variables: [{ name: 'call.ok', type: 'boolean', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'Ping',
                    connectorConfig: { connectorId: 'installed_conn', actionId: 'ping', input: {} },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        } as never);
        const result = await engine.execute('call_installed');
        expect(result.success).toBe(true);
        expect(result.output).toMatchObject({ 'call.ok': true });

        await kernel.shutdown();
    });

    it('runs one reconcile on a boot that registers nothing after start() (control)', async () => {
        const spy = reconcileSpy();
        const { factory, calls } = makeProvider();
        const { kernel, engine } = await boot([providerConnector('host_conn')], [], factory);

        expect(engine.getRegisteredConnectors()).toContain('host_conn');
        expect(calls).toHaveLength(1);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]?.[1]).toEqual({ fatal: true });

        await kernel.shutdown();
    });

    it('runs a second, non-fatal reconcile when kernel:ready registered an entry', async () => {
        const spy = reconcileSpy();
        const { factory } = makeProvider();
        const { kernel } = await boot([providerConnector('host_conn')], [providerConnector('installed_conn')], factory);

        expect(spy.mock.calls.map((c) => c[1])).toEqual([{ fatal: true }, { fatal: false }]);

        await kernel.shutdown();
    });

    it('logs and skips a configuration fault in an entry registered during kernel:ready; the boot completes', async () => {
        const errors = vi.spyOn(ObjectLogger.prototype, 'error');
        const { factory } = makeProvider();
        const { kernel, engine } = await boot(
            [providerConnector('host_conn')],
            [providerConnector('broken_conn', 'no_such_provider'), providerConnector('installed_conn')],
            factory,
        );

        const registered = engine.getRegisteredConnectors();
        expect(registered).toEqual(expect.arrayContaining(['host_conn', 'installed_conn']));
        expect(registered).not.toContain('broken_conn');
        const messages = errors.mock.calls.map((c) => String(c[0]));
        expect(messages.some((m) => m.includes('broken_conn') && m.includes('no_such_provider')), messages.join('\n')).toBe(true);

        await kernel.shutdown();
    });
});

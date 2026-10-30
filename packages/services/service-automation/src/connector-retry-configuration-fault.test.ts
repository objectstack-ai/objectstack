// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #27992 — a configuration fault met on a degraded instance's backoff retry.
// The instance was degraded at boot (its upstream was unreachable, #3017);
// once the upstream answers, the provider refuses the entry's configuration —
// an `include` naming a tool (mcp) or an operation (openapi) the upstream does
// not offer. ADR-0097 does not retry a configuration fault, so the retry ends
// there: the stale "could not reach" reason is replaced by the configuration
// one, and no further retry is scheduled. A credential refusal keeps its hold
// path, and an unreachable upstream keeps degrading on the backoff.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Connector, ConnectorProviderFactory } from '@objectstack/spec/integration';
import {
    ConnectorCredentialRejectedError,
    ConnectorUpstreamUnavailableError,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin, DECLARATIVE_RETRY_BASE_MS } from './plugin.js';
import type { AutomationEngine } from './engine.js';

type Upstream = 'down' | 'refuses-include' | 'refuses-credential' | 'up';

/**
 * A provider factory shaped like connector-mcp / connector-openapi: an
 * unreachable upstream throws the unavailable marker, an `include` entry the
 * upstream does not offer throws a plain Error (the provider's configuration
 * fault), a refused credential throws the credential marker.
 */
function makeProvider(kind: 'mcp' | 'openapi', upstream: Upstream) {
    const state = { upstream, calls: 0 };
    const factory: ConnectorProviderFactory = (ctx) => {
        state.calls++;
        if (state.upstream === 'down') {
            throw new ConnectorUpstreamUnavailableError(
                kind === 'mcp'
                    ? `connector-mcp provider: connector '${ctx.name}' could not reach its MCP server: connect ECONNREFUSED`
                    : `connector-openapi provider: connector '${ctx.name}' could not reach spec URL 'https://api.example/spec.json': fetch failed`,
            );
        }
        if (state.upstream === 'refuses-credential') {
            throw new ConnectorCredentialRejectedError(
                `connector-${kind} provider: connector '${ctx.name}' was refused by its upstream (HTTP 401).`,
                401,
            );
        }
        const include = (ctx.providerConfig as { include?: string[] }).include ?? [];
        if (state.upstream === 'refuses-include' || include.includes('nope')) {
            throw new Error(
                kind === 'mcp'
                    ? `connector-mcp provider: connector '${ctx.name}' providerConfig.include names 'nope', which the MCP server does not list.`
                    : `connector-openapi provider: connector '${ctx.name}' providerConfig.include names 'nope', which the spec does not define.`,
            );
        }
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
    return { factory, state };
}

function entry(name: string, provider: string, include: string[] = ['nope']) {
    return { name, label: name, type: 'api', provider, providerConfig: { url: 'https://upstream.example', include } };
}

/** Boot under fake timers: the boot reconcile and every reload are awaited, no timer tick needed. */
async function boot(initial: unknown[], provider: string, factory: ConnectorProviderFactory) {
    const state = { declared: initial };
    let captured: any;
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            captured = ctx;
            ctx.registerService('objectql', {
                registry: { listItems: (type: string) => (type === 'connector' ? state.declared : []) },
            });
            ctx.getService('automation').registerConnectorProvider(provider, factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    const reload = async (next: unknown[]) => {
        state.declared = next;
        await captured.trigger('metadata:reloaded');
    };
    return { kernel, engine: kernel.getService('automation') as AutomationEngine, reload };
}

function descriptorOf(engine: AutomationEngine, name: string) {
    return engine.getConnectorDescriptors().find((d) => d.name === name);
}

describe('#27992 — a configuration fault met on a degraded instance\'s backoff retry ends the retry', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    for (const kind of ['mcp', 'openapi'] as const) {
        it(`${kind}: the instance takes the configuration reason and is not retried again`, async () => {
            vi.useFakeTimers();
            const { factory, state } = makeProvider(kind, 'down');
            const { kernel, engine } = await boot([entry('upstream', kind)], kind, factory);
            expect(state.calls).toBe(1);
            expect(engine.getConnectorDegradedReason('upstream')).toMatch(/could not reach/);

            // The upstream answers now, and refuses the entry's include.
            state.upstream = 'refuses-include';
            await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
            expect(state.calls).toBe(2); // the backoff retry ran and met the fault

            // GET /connectors reads these descriptors: the stale reason is gone.
            const desc = descriptorOf(engine, 'upstream');
            expect(desc?.degradedReason).toMatch(/providerConfig\.include names 'nope'/);
            expect(desc?.degradedReason).not.toMatch(/could not reach/);
            expect(desc?.actions).toEqual([]);
            expect(engine.resolveConnectorAction('upstream', 'ping')).toBeUndefined();

            // No retry is scheduled: a long wait reaches the factory no more.
            await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS * 64);
            expect(state.calls).toBe(2);

            await kernel.shutdown();
        });
    }

    it('an unchanged reload does not re-attempt it; an edit of the declaration does, and can recover it', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeProvider('mcp', 'down');
        const { kernel, engine, reload } = await boot([entry('upstream', 'mcp')], 'mcp', factory);
        state.upstream = 'up';
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(2);
        expect(engine.getConnectorDegradedReason('upstream')).toMatch(/include names 'nope'/);

        await reload([entry('upstream', 'mcp')]);
        expect(state.calls).toBe(2);

        await reload([entry('upstream', 'mcp', ['ping'])]);
        expect(state.calls).toBe(3);
        expect(descriptorOf(engine, 'upstream')?.state).toBe('ready');
        expect(engine.getConnectorDegradedReason('upstream')).toBeUndefined();

        await kernel.shutdown();
    });

    it('a changed entry pending a retry: the old connector keeps serving and the retry stops', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeProvider('mcp', 'up');
        const { kernel, engine, reload } = await boot([entry('upstream', 'mcp', ['ping'])], 'mcp', factory);
        expect(descriptorOf(engine, 'upstream')?.state).toBe('ready');

        state.upstream = 'down';
        await reload([entry('upstream', 'mcp', ['ping', 'pong'])]);
        expect(state.calls).toBe(2);

        state.upstream = 'refuses-include';
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(3);
        expect(descriptorOf(engine, 'upstream')?.state).toBe('ready');
        expect(engine.resolveConnectorAction('upstream', 'ping')).toBeDefined();

        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS * 64);
        expect(state.calls).toBe(3);

        await kernel.shutdown();
    });

    it('control: an upstream still unreachable on the retry keeps degrading and is retried again', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeProvider('mcp', 'down');
        const { kernel, engine } = await boot([entry('upstream', 'mcp')], 'mcp', factory);

        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(2);
        expect(engine.getConnectorDegradedReason('upstream')).toMatch(/could not reach/);

        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS * 2);
        expect(state.calls).toBe(3);

        await kernel.shutdown();
    });

    it('control: a credential refused on the retry keeps its hold path', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeProvider('mcp', 'down');
        const { kernel, engine } = await boot([entry('upstream', 'mcp')], 'mcp', factory);

        state.upstream = 'refuses-credential';
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(2);
        expect(engine.getConnectorDegradedReason('upstream')).toMatch(/refused by its upstream \(HTTP 401\)/);

        // Held: a credential written into the declaration waits for its next change.
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS * 64);
        expect(state.calls).toBe(2);

        await kernel.shutdown();
    });
});

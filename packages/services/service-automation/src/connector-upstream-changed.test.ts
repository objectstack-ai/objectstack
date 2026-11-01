// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27401] A provider factory whose upstream serves a definition that differs
// from the instance's pin throws the CONNECTOR_UPSTREAM_CHANGED marker
// (connector-mcp does, for a `providerConfig.toolsSnapshot` mismatch). Ruling
// 6545635244: the materializer degrades the instance through a branch of its
// own — its own wording in the materializer's ERROR record and in the engine's
// degrade WARN — on the same backoff as an upstream outage (#3017), and
// CONNECTOR_UPSTREAM_UNAVAILABLE keeps its declared meaning and wording.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Connector, ConnectorProviderFactory } from '@objectstack/spec/integration';
import {
    ConnectorUpstreamChangedError,
    ConnectorUpstreamUnavailableError,
    isConnectorUpstreamChanged,
    isConnectorUpstreamUnavailable,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin, DECLARATIVE_RETRY_BASE_MS } from './plugin.js';
import type { AutomationEngine } from './engine.js';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const CHANGED_REASON =
    "connector-mcp provider: connector 'vendor_mcp' providerConfig.toolsSnapshot does not match the tools its MCP " +
    "server serves: tool 'create_issue' changed (it now hashes to " + 'a'.repeat(64) + ').';

function providerConnector(name: string) {
    return { name, label: name, type: 'api', provider: 'fake', providerConfig: {} };
}

/**
 * A factory whose upstream is switchable: `changed` throws the pin-mismatch
 * marker, `down` the outage marker, otherwise it materializes one action.
 */
function makeUpstream(initial: 'changed' | 'down' | 'ok') {
    const state = { mode: initial, calls: 0 };
    const factory: ConnectorProviderFactory = (ctx) => {
        state.calls++;
        if (state.mode === 'changed') throw new ConnectorUpstreamChangedError(CHANGED_REASON);
        if (state.mode === 'down') {
            throw new ConnectorUpstreamUnavailableError(`connector '${ctx.name}' could not reach its MCP server`);
        }
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                authentication: { type: 'none' },
                actions: [{ key: 'create_issue', label: 'Create issue' }],
            } as unknown as Connector,
            handlers: { create_issue: async () => ({ ok: true }) },
        };
    };
    return { factory, state };
}

/** Capture the JSON records written to stdout (warn) and stderr (error). */
function captureRecords() {
    const records: Array<{ level: string; msg: string; [k: string]: unknown }> = [];
    for (const which of ['stdout', 'stderr'] as const) {
        vi.spyOn(process[which], 'write').mockImplementation(((chunk: string | Uint8Array) => {
            for (const line of String(chunk).split('\n')) {
                if (!line.startsWith('{')) continue;
                try {
                    records.push(JSON.parse(line));
                } catch {
                    /* not a record */
                }
            }
            return true;
        }) as never);
    }
    return records;
}

async function boot(factory: ConnectorProviderFactory) {
    const kernel = new LiteKernel({ logger: { level: 'warn', format: 'json' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', {
                registry: { listItems: (t: string) => (t === 'connector' ? [providerConnector('vendor_mcp')] : []) },
            });
            ctx.getService('automation').registerConnectorProvider('fake', factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    return { kernel, engine: kernel.getService('automation') as AutomationEngine };
}

describe('CONNECTOR_UPSTREAM_CHANGED — the marker', () => {
    it('carries its code, and the two structural guards tell it apart from an outage', () => {
        const changed = new ConnectorUpstreamChangedError('x');
        expect(changed.code).toBe('CONNECTOR_UPSTREAM_CHANGED');
        expect(changed.name).toBe('ConnectorUpstreamChangedError');
        expect(isConnectorUpstreamChanged(changed)).toBe(true);
        expect(isConnectorUpstreamUnavailable(changed)).toBe(false);
        expect(isConnectorUpstreamChanged(new ConnectorUpstreamUnavailableError('y'))).toBe(false);
        // Structural, not instanceof: a duplicated module's error still matches.
        expect(isConnectorUpstreamChanged({ code: 'CONNECTOR_UPSTREAM_CHANGED' })).toBe(true);
        expect(isConnectorUpstreamChanged(null)).toBe(false);
    });
});

describe('#27401 — a pin mismatch degrades through its own materializer branch', () => {
    it('boots degraded with the factory message as the reason, on the backoff (not held)', async () => {
        captureRecords();
        const { factory, state } = makeUpstream('changed');
        const { kernel, engine } = await boot(factory);
        try {
            const desc = engine.getConnectorDescriptors().find((d) => d.name === 'vendor_mcp');
            expect(desc?.state).toBe('degraded');
            expect(desc?.actions).toEqual([]);
            expect(desc?.degradedReason).toBe(CHANGED_REASON);
            expect(engine.getConnectorDegradedHold('vendor_mcp')).toBeUndefined();
            expect(state.calls).toBe(1);
        } finally {
            await kernel.shutdown();
        }
    });

    it("logs the mismatch in its own words, never the outage's", async () => {
        const records = captureRecords();
        const { factory } = makeUpstream('changed');
        const { kernel } = await boot(factory);
        await kernel.shutdown();

        const errors = records.filter((r) => r.level === 'error' && r.msg.includes("connector instance 'vendor_mcp'"));
        expect(errors).toHaveLength(1);
        expect(errors[0].msg).toBe(
            "[Automation] connector instance 'vendor_mcp' (provider 'fake') serves a tool definition that differs " +
                'from its toolsSnapshot — instance registered degraded (no actions); re-checking with backoff, attempt 1.',
        );
        expect(errors[0].error).toBe(CHANGED_REASON);

        const degradeWarn = records.filter((r) => r.level === 'warn' && r.msg.startsWith('Connector registered DEGRADED: vendor_mcp'));
        expect(degradeWarn).toHaveLength(1);
        expect(degradeWarn[0].msg).toContain('until its upstream serves the definitions its pin names again');
        expect(degradeWarn[0].msg).toContain('the materializer re-checks with backoff.');

        const all = records.map((r) => r.msg).join('\n');
        expect(all).not.toContain('upstream unavailable');
        expect(all).not.toContain('until its upstream is reachable');
    });

    it('re-checks on the same backoff and recovers once the upstream serves the pinned definition again', async () => {
        vi.useFakeTimers();
        const records = captureRecords();
        const { factory, state } = makeUpstream('changed');
        const { kernel, engine } = await boot(factory);
        try {
            await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
            expect(state.calls).toBe(2);
            expect(records.some((r) => r.level === 'error' && r.msg.endsWith('re-checking with backoff, attempt 2.'))).toBe(true);

            // The retry after that is at 2·BASE, as for an outage.
            await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
            expect(state.calls).toBe(2);
            state.mode = 'ok';
            await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
            expect(state.calls).toBe(3);

            const desc = engine.getConnectorDescriptors().find((d) => d.name === 'vendor_mcp');
            expect(desc?.state).toBe('ready');
            expect(engine.resolveConnectorAction('vendor_mcp', 'create_issue')).toBeDefined();
        } finally {
            await kernel.shutdown();
        }
    });

    it('control: an outage keeps the upstream-unavailable wording', async () => {
        const records = captureRecords();
        const { factory } = makeUpstream('down');
        const { kernel } = await boot(factory);
        await kernel.shutdown();

        const errors = records.filter((r) => r.level === 'error' && r.msg.includes("connector instance 'vendor_mcp'"));
        expect(errors).toHaveLength(1);
        expect(errors[0].msg).toContain("(provider 'fake') upstream unavailable — instance registered degraded (no actions)");
        expect(errors[0].msg).toContain('retrying with backoff, attempt 1.');
        const all = records.map((r) => r.msg).join('\n');
        expect(all).toContain('until its upstream is reachable');
        expect(all).not.toContain('toolsSnapshot');
    });
});

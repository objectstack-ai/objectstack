// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #28016 — a `connector_action` dispatch to a degraded instance says what
// recovers it. An instance on the #3017 backoff recovers by itself, so its
// refusal says the platform retries it. A HELD instance is not retried:
// a configuration fault met on a backoff retry (#27992), or a credential the
// upstream refused when only an edit of the declaration changes what it sends
// (#27237). Its refusal names the fix and never says it retries. The stored-
// credential hold (set the credential again) is pinned beside its door, in
// connector-credential-door.test.ts.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LiteKernel, ObjectLogger } from '@objectstack/core';
import type { Connector, ConnectorProviderFactory } from '@objectstack/spec/integration';
import {
    ConnectorCredentialRejectedError,
    ConnectorUpstreamUnavailableError,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin, DECLARATIVE_RETRY_BASE_MS } from './plugin.js';
import { AutomationEngine } from './engine.js';

type Upstream = 'down' | 'refuses-include' | 'refuses-credential';

/** An mcp-shaped provider: the marker errors for down / refused credential, a plain Error for a bad `include`. */
function makeProvider(upstream: Upstream) {
    const state = { upstream, calls: 0 };
    const factory: ConnectorProviderFactory = (ctx) => {
        state.calls++;
        if (state.upstream === 'down') {
            throw new ConnectorUpstreamUnavailableError(
                `connector-mcp provider: connector '${ctx.name}' could not reach its MCP server: connect ECONNREFUSED`,
            );
        }
        if (state.upstream === 'refuses-credential') {
            throw new ConnectorCredentialRejectedError(
                `connector-mcp provider: connector '${ctx.name}' was refused by its upstream (HTTP 401).`,
                401,
            );
        }
        throw new Error(
            `connector-mcp provider: connector '${ctx.name}' providerConfig.include names 'nope', which the MCP server does not list.`,
        );
    };
    return { factory, state };
}

const ENTRY = { name: 'upstream', label: 'upstream', type: 'api', provider: 'mcp', providerConfig: { url: 'https://upstream.example', include: ['nope'] } };

async function boot(factory: ConnectorProviderFactory) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', {
                registry: { listItems: (type: string) => (type === 'connector' ? [ENTRY] : []) },
            });
            ctx.getService('automation').registerConnectorProvider('mcp', factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    return { kernel, engine: kernel.getService('automation') as AutomationEngine };
}

/** Run a one-node flow dispatching to `upstream.ping` and return its refusal text. */
async function dispatchRefusal(engine: AutomationEngine): Promise<string> {
    engine.registerFlow('call_upstream', {
        name: 'call_upstream',
        label: 'Call upstream',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'call', type: 'connector_action', label: 'Ping', connectorConfig: { connectorId: 'upstream', actionId: 'ping', input: {} } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    } as never);
    const result = await engine.execute('call_upstream');
    expect(result.success).toBe(false);
    return String(result.error);
}

describe('#28016 — a dispatch to a held connector instance names its fix, not a retry', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('a configuration fault met on the backoff retry: edit the declaration; nothing retries it', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeProvider('down');
        const { kernel, engine } = await boot(factory);
        state.upstream = 'refuses-include';
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(2);

        const error = await dispatchRefusal(engine);
        expect(error).toContain("connector 'upstream' is degraded — ");
        expect(error).toContain("include names 'nope'");
        expect(error).toContain('until its declaration is edited (or the server restarts); the platform does not retry it.');
        expect(error).not.toMatch(/retries automatically/);
        expect(error).not.toContain('.. Dispatch');

        await kernel.shutdown();
    });

    it('a credential written into the declaration, refused by the upstream: edit the declaration; nothing retries it', async () => {
        const { factory } = makeProvider('refuses-credential');
        const { kernel, engine } = await boot(factory);
        expect(engine.getConnectorDegradedReason('upstream')).toMatch(/refused by its upstream \(HTTP 401\)/);

        const error = await dispatchRefusal(engine);
        expect(error).toContain('until its declaration is edited (or the server restarts); the platform does not retry it.');
        expect(error).not.toMatch(/retries automatically/);
        expect(error).not.toContain('.. Dispatch');

        await kernel.shutdown();
    });

    it('control: an unreachable upstream is on the backoff, and the refusal says the platform retries it', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeProvider('down');
        const { kernel, engine } = await boot(factory);
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(2);

        const error = await dispatchRefusal(engine);
        expect(error).toContain('could not reach its MCP server');
        expect(error).toContain('Dispatch is unavailable until that is resolved; the platform retries automatically.');
        expect(error).not.toMatch(/does not retry/);

        await kernel.shutdown();
    });
});

describe('#28016 — the degraded record carries the hold', () => {
    const husk = { name: 'billing', label: 'billing', type: 'api', authentication: { type: 'none' }, actions: [] } as unknown as Connector;

    it('a held degrade stores what re-attempts it and its warn says it is not retried; an unheld one clears it', () => {
        const logger = new ObjectLogger({ level: 'silent' });
        const warn = vi.spyOn(logger, 'warn');
        const engine = new AutomationEngine(logger);
        const lastWarn = () => String(warn.mock.calls[warn.mock.calls.length - 1]?.[0]);

        engine.registerDegradedConnector(husk, 'refused', 'declarative', undefined, { kind: 'credential', ref: 'BILLING_TOKEN' });
        expect(engine.getConnectorDegradedHold('billing')).toEqual({ kind: 'credential', ref: 'BILLING_TOKEN' });
        expect(lastWarn()).toContain(
            "the materializer does not retry it until credential 'BILLING_TOKEN' is set again (or a restart).",
        );
        expect(lastWarn()).not.toContain('retries with backoff');

        // The next degrade of the same name replaces the record: on the backoff, no hold.
        engine.registerDegradedConnector(husk, 'could not reach it', 'declarative');
        expect(engine.getConnectorDegradedHold('billing')).toBeUndefined();
        expect(lastWarn()).toContain('the materializer retries with backoff.');
        expect(engine.getConnectorDegradedHold('unregistered')).toBeUndefined();
    });
});

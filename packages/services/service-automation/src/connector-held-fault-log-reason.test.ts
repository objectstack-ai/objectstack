// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A held connector instance (a configuration fault: ADR-0097 does not retry
// it) logs one ERROR record. When the fault is the platform's own refusal
// rather than a thrown provider error (an `oauth2` instance this server cannot
// serve: an MCP server over plain http off loopback, an endpoint not over
// https), there is no thrown value to describe: the record carries the reason
// itself in its meta, never the string "undefined". The same refusal sentence
// answers the connection door's 400, and it ends its sentence once.
//
// The records are read through a REAL logger's bytes (JSON format, stderr),
// as connector-fail-cause.test.ts does, not through a spy.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { ConnectorProviderFactory } from '@objectstack/spec/integration';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { ConnectorConnectionStore } from './connector-connections.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
    vi.restoreAllMocks();
});

const ADMIN = { tenantId: 'org_a', userId: 'usr_admin' };
const MATERIALIZE_PREFIX = '[Automation] failed to materialize connector instance';

/** `provider: 'mcp'`, `authorization_code`, its transport over plain http to a non-loopback host. */
function plainHttpMcp(name = 'qa_mcp_oauth_plain') {
    return {
        name,
        label: name,
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'http', url: 'http://192.0.2.2:41520/api/v1/mcp' } },
        auth: { type: 'oauth2', grant: 'authorization_code' },
    };
}

/** An `oauth2` instance on `mcp` with every endpoint declared, its `authorizationUrl` plain http off loopback. */
function plainAuthorizationUrl(name = 'plain_endpoint') {
    return {
        name,
        label: name,
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'http', url: 'https://mcp.example.com/mcp' } },
        auth: {
            type: 'oauth2',
            grant: 'authorization_code',
            clientId: 'client',
            tokenUrl: 'https://idp.example.com/token',
            authorizationUrl: 'http://idp.example.com/authorize',
        },
    };
}

/** An `authorization_code` instance on a non-mcp provider declaring no endpoints or client. */
function missingEndpoints(name = 'no_endpoints') {
    return {
        name,
        label: name,
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'stdio', command: 'dummy' } },
        auth: { type: 'oauth2', grant: 'authorization_code' },
    };
}

/** Boot with the declared set swappable through `metadata:reloaded`, under a real JSON logger. */
async function boot(initial: unknown[], factory: ConnectorProviderFactory) {
    const state = { declared: initial };
    let captured: any;
    const kernel = new LiteKernel({ logger: { level: 'error', format: 'json' } } as never);
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
            ctx.getService('automation').registerConnectorProvider('mcp', factory, { credentialHandle: true });
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    await flush();
    return {
        kernel,
        engine: kernel.getService('automation') as AutomationEngine,
        reload: async (next: unknown[]) => {
            state.declared = next;
            await captured.trigger('metadata:reloaded');
            await flush();
        },
    };
}

/** Everything written to stderr while `fn` runs, one entry per physical line. */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((c: string | Uint8Array) => {
        chunks.push(String(c));
        return true;
    }) as never);
    let result: T;
    try {
        result = await fn();
    } finally {
        spy.mockRestore();
    }
    return { result, lines: chunks.join('').split('\n').filter((l) => l.length > 0) };
}

type LoggedRecord = { level: string; msg: string; reason?: unknown; error?: unknown };

function heldRecordsOf(lines: string[], name: string): LoggedRecord[] {
    return lines
        .map((l) => JSON.parse(l) as LoggedRecord)
        .filter((r) => r.msg.startsWith(MATERIALIZE_PREFIX) && r.msg.includes(`'${name}'`));
}

const neverCalled: ConnectorProviderFactory = () => {
    throw new Error('the factory of a held instance is never called');
};

describe('a held connector instance logs its reason, and the refusal sentence ends with one period', () => {
    it('the ERROR record of a platform-refused instance carries the reason in its meta, never "undefined"', async () => {
        const { result: booted, lines } = await captureStderr(() => boot([plainHttpMcp()], neverCalled));
        const reason = booted.engine.getConnectorDegradedReason('qa_mcp_oauth_plain');
        expect(reason).toContain('transport `url` is not over https');

        const records = heldRecordsOf(lines, 'qa_mcp_oauth_plain');
        expect(records, 'the held instance is reported exactly once').toHaveLength(1);
        expect(records[0].level).toBe('error');
        expect(records[0].reason).toBe(reason);
        expect(records[0].error, 'no thrown value, so no `error` field').toBeUndefined();
        expect(lines.join('\n')).not.toContain('"error":"undefined"');
        await booted.kernel.shutdown();
    });

    it('CONTROL: a held instance whose fault is a thrown provider error still logs that error', async () => {
        // Degraded first (its upstream is down), then the retry meets a
        // provider configuration fault: the held path with a thrown cause.
        const upstream = { down: true };
        const factory: ConnectorProviderFactory = (ctx) => {
            if (upstream.down) throw new ConnectorUpstreamUnavailableError(`connector '${ctx.name}' could not reach its MCP server`);
            throw new Error(`connector-mcp provider: connector '${ctx.name}' providerConfig.include names 'nope', which the MCP server does not list.`);
        };
        const entry = {
            name: 'refuses_include',
            label: 'refuses_include',
            type: 'api',
            provider: 'mcp',
            providerConfig: { transport: { kind: 'http', url: 'https://mcp.example.com/mcp' }, include: ['nope'] },
        };
        const { kernel, engine, reload } = await boot([entry], factory);
        expect(engine.getConnectorDegradedReason('refuses_include')).toMatch(/could not reach/);

        upstream.down = false;
        const { lines } = await captureStderr(() => reload([entry]));
        const records = heldRecordsOf(lines, 'refuses_include');
        expect(records).toHaveLength(1);
        expect(records[0].msg).toContain('a configuration fault, so the instance is no longer retried');
        expect(records[0].error).toBe(
            "connector-mcp provider: connector 'refuses_include' providerConfig.include names 'nope', which the MCP server does not list.",
        );
        await kernel.shutdown();
    });

    it('the ERROR record of a retried instance whose connections could not be read carries the reason, never "undefined"', async () => {
        // A servable `authorization_code` instance whose connection store
        // answers with a failure: degraded and retried on the backoff, with no
        // thrown provider error to describe.
        vi.spyOn(ConnectorConnectionStore.prototype, 'listFor').mockRejectedValue(new Error('dummy-store-down-28939'));
        const entry = { ...plainAuthorizationUrl('unreadable_connections') };
        entry.auth = { ...entry.auth, authorizationUrl: 'https://idp.example.com/authorize' };
        const { result: booted, lines } = await captureStderr(() => boot([entry], neverCalled));
        const reason = booted.engine.getConnectorDegradedReason('unreadable_connections');
        expect(reason).toContain('could not be read');

        const records = lines
            .map((l) => JSON.parse(l) as LoggedRecord)
            .filter((r) => r.level === 'error' && r.msg.includes("'unreadable_connections'"));
        expect(records, 'the degraded instance is reported exactly once').toHaveLength(1);
        expect(records[0].msg).toContain('retrying with backoff');
        expect(records[0].reason).toBe(reason);
        expect(records[0].error, 'no thrown value, so no `error` field').toBeUndefined();
        expect(lines.join('\n')).not.toContain('"error":"undefined"');
        await booted.kernel.shutdown();
    });

    it.each([
        ['an MCP server over plain http', plainHttpMcp()],
        ['an endpoint not over https', plainAuthorizationUrl()],
        ['no endpoints to discover', missingEndpoints()],
    ] as const)('⛔ the connection door refuses %s with a 400 whose sentence ends with one period', async (_label, entry) => {
        const { kernel, engine } = await boot([entry], neverCalled);
        // The husk stores the same sentence the door answers.
        const stored = engine.getConnectorDegradedReason(entry.name);
        expect(stored).toMatch(/[^.]\.$/);
        for (const call of [
            () => engine.beginConnectorConnection({ connector: entry.name, context: ADMIN as never }),
            () => engine.getConnectorConnection({ connector: entry.name, context: ADMIN as never }),
        ]) {
            const err = (await call().catch((e: unknown) => e)) as Error & { status?: number; code?: string };
            expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
            expect(err.message).toBe(stored);
            expect(err.message).not.toMatch(/\.\.$/);
        }
        await kernel.shutdown();
    });
});

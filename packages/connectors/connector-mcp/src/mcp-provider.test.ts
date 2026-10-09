// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0097 — the `mcp` provider factory: materialize a declarative
// `provider: 'mcp'` connector instance by connecting to the server (an injected
// fake client here), listing its tools, and mapping them to actions.

import { describe, it, expect } from 'vitest';
import type { ConnectorProviderContext } from '@objectstack/spec/integration';
import { isConnectorUpstreamUnavailable } from '@objectstack/spec/integration';
import type { McpClientLike, McpToolDescriptor, McpTransport } from './mcp-connector.js';
import { createMcpProviderFactory, MCP_PROVIDER_KEY } from './mcp-provider.js';

const TOOLS: McpToolDescriptor[] = [
    { name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object' } },
    { name: 'list_issues', description: 'List issues' },
];

/** Capture the transport the factory built, and serve fixed tools. */
function fakeClientFactory() {
    const seen: { transport?: McpTransport } = {};
    let closed = false;
    const factory = async (transport: McpTransport): Promise<McpClientLike> => {
        seen.transport = transport;
        return {
            listTools: async () => TOOLS,
            callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
            close: async () => { closed = true; },
        };
    };
    return { factory, seen, isClosed: () => closed };
}

function ctx(partial: Partial<ConnectorProviderContext> & Pick<ConnectorProviderContext, 'providerConfig'>): ConnectorProviderContext {
    return { name: 'github', label: 'GitHub', type: 'api', ...partial };
}

describe('mcp provider factory (ADR-0097)', () => {
    it('advertises the mcp provider key', () => {
        expect(MCP_PROVIDER_KEY).toBe('mcp');
    });

    it('connects, lists tools, and maps them to actions', async () => {
        const { factory: clientFactory } = fakeClientFactory();
        // stdio on a declarative instance requires the host opt-in (#3055).
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: ['my-mcp'] });
        const mat = await factory(ctx({ providerConfig: { transport: { kind: 'stdio', command: 'my-mcp' } } }));
        expect(mat.def.name).toBe('github');
        expect(Object.keys(mat.handlers).sort()).toEqual(['create_issue', 'list_issues']);
        expect(typeof mat.close).toBe('function');
    });

    it('applies the tool allowlist from providerConfig.include', async () => {
        const { factory: clientFactory } = fakeClientFactory();
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: ['my-mcp'] });
        const mat = await factory(
            ctx({ providerConfig: { transport: { kind: 'stdio', command: 'my-mcp' }, include: ['create_issue'] } }),
        );
        expect(Object.keys(mat.handlers)).toEqual(['create_issue']);
    });

    it('folds resolved bearer auth into an http transport header', async () => {
        const captured = fakeClientFactory();
        const factory = createMcpProviderFactory({ clientFactory: captured.factory });
        await factory(
            ctx({
                providerConfig: { transport: { kind: 'http', url: 'https://mcp.example.com' } },
                auth: { type: 'bearer', token: 'tok' },
            }),
        );
        const t = captured.seen.transport;
        expect(t?.kind).toBe('http');
        expect(t?.kind === 'http' && t.headers?.Authorization).toBe('Bearer tok');
    });

    it('throws when the transport is missing', async () => {
        const factory = createMcpProviderFactory();
        await expect(factory(ctx({ providerConfig: {} }))).rejects.toThrow(/providerConfig\.transport/);
    });

    it('throws for an unknown transport kind', async () => {
        const factory = createMcpProviderFactory();
        await expect(
            factory(ctx({ providerConfig: { transport: { kind: 'carrier-pigeon' } } })),
        ).rejects.toThrow(/kind must be 'stdio' or 'http'/);
    });
});

// ── #3017 — fault classification: config stays fatal, upstream degrades ─────

describe('mcp provider fault classification (#3017)', () => {
    const stdio = { transport: { kind: 'stdio', command: 'my-mcp' } };
    const allowMyMcp = { declarativeStdio: ['my-mcp'] };

    it('classifies a connect failure as upstream-unavailable (retryable), keeping the cause', async () => {
        const boom = new Error('connect ECONNREFUSED 127.0.0.1:9999');
        const clientFactory = async (): Promise<McpClientLike> => { throw boom; };
        const factory = createMcpProviderFactory({ clientFactory, ...allowMyMcp });

        const err = await factory(ctx({ providerConfig: stdio })).then(
            () => { throw new Error('expected rejection'); },
            (e: unknown) => e,
        );
        expect(isConnectorUpstreamUnavailable(err)).toBe(true);
        expect((err as Error).message).toMatch(/'github' could not reach its MCP server/);
        expect((err as Error).message).toContain('ECONNREFUSED');
        expect((err as { cause?: unknown }).cause).toBe(boom);
    });

    it('classifies a tools/list failure as upstream-unavailable and closes the client', async () => {
        let closed = false;
        const clientFactory = async (): Promise<McpClientLike> => ({
            listTools: async () => { throw new Error('request timed out'); },
            callTool: async () => ({}),
            close: async () => { closed = true; },
        });
        const factory = createMcpProviderFactory({ clientFactory, ...allowMyMcp });

        const err = await factory(ctx({ providerConfig: stdio })).then(
            () => { throw new Error('expected rejection'); },
            (e: unknown) => e,
        );
        expect(isConnectorUpstreamUnavailable(err)).toBe(true);
        expect(closed).toBe(true); // discovery failure must not leak the connection
    });

    it('keeps transport-shape faults plain — configuration errors stay fatal at boot', async () => {
        const factory = createMcpProviderFactory();
        const err = await factory(ctx({ providerConfig: {} })).then(
            () => { throw new Error('expected rejection'); },
            (e: unknown) => e,
        );
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
    });
});

// ── #3055 — declarative stdio policy: default-deny + host allowlist ─────────
//
// A declarative stdio transport spawns a local process from metadata (a Studio
// publish reaches materialization at runtime), so it is gated OFF unless the
// host opts in. Violations are CONFIGURATION faults: plain throw (fatal at
// boot, skipped on reload) — never upstream-unavailable, which would retry a
// security rejection into existence.

describe('mcp provider declarative stdio policy (#3055)', () => {
    const stdioCfg = { transport: { kind: 'stdio', command: 'my-mcp' } };

    it('DENIES a declarative stdio transport by default, as a plain (non-retryable) fault', async () => {
        const { factory: clientFactory, seen } = fakeClientFactory();
        const factory = createMcpProviderFactory({ clientFactory }); // no policy
        const err = await factory(ctx({ providerConfig: stdioCfg })).then(
            () => { throw new Error('expected rejection'); },
            (e: unknown) => e,
        );
        expect((err as Error).message).toMatch(/stdio transports are disabled by default/);
        expect((err as Error).message).toContain("declarativeStdio: ['my-mcp']"); // actionable opt-in hint
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        expect(seen.transport).toBeUndefined(); // rejected before any connection attempt
    });

    it('allowlist admits exactly the listed command and rejects others', async () => {
        const { factory: clientFactory } = fakeClientFactory();
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: ['npx', 'my-mcp'] });
        const mat = await factory(ctx({ providerConfig: stdioCfg }));
        expect(mat.def.name).toBe('github');

        const err = await factory(
            ctx({ providerConfig: { transport: { kind: 'stdio', command: 'bash' } } }),
        ).then(
            () => { throw new Error('expected rejection'); },
            (e: unknown) => e,
        );
        expect((err as Error).message).toMatch(/not in the host's declarativeStdio allowlist \[npx, my-mcp\]/);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
    });

    it('declarativeStdio: true allows any command (explicit full trust)', async () => {
        const { factory: clientFactory } = fakeClientFactory();
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: true });
        const mat = await factory(
            ctx({ providerConfig: { transport: { kind: 'stdio', command: 'anything' } } }),
        );
        expect(Object.keys(mat.handlers).length).toBeGreaterThan(0);
    });

    it('http transports are NOT subject to the policy', async () => {
        const { factory: clientFactory } = fakeClientFactory();
        const factory = createMcpProviderFactory({ clientFactory }); // default-deny policy in force
        const mat = await factory(
            ctx({ providerConfig: { transport: { kind: 'http', url: 'https://mcp.example.com' } } }),
        );
        expect(mat.def.name).toBe('github');
    });
});

// ── #22423 — a declarative stdio transport runs in the declaring app's root ──
//
// One anchor for an app's relative paths: the host's
// `ConnectorProviderContext.resolvePackagePath('.')` (the same root the
// `openapi` provider's `providerConfig.spec` is read under) becomes the stdio
// child's working directory. The anchor is the host's alone; an authored
// `providerConfig.transport.cwd` never reaches the transport. A host without
// the member gets the transport exactly as before: no `cwd` key at all.

describe('mcp provider: declarative stdio working directory (#22423)', () => {
    const ROOT = '/srv/apps/my-app';
    const stdioCfg = { transport: { kind: 'stdio', command: 'node', args: ['./scripts/server.mjs'] } };

    function recordingResolver(answer = ROOT) {
        const asked: string[] = [];
        const resolvePackagePath = async (relativePath: string) => {
            asked.push(relativePath);
            return answer;
        };
        return { resolvePackagePath, asked };
    }

    it("sets the stdio cwd to the host's resolvePackagePath('.'), leaving command and args as written", async () => {
        const { factory: clientFactory, seen } = fakeClientFactory();
        const { resolvePackagePath, asked } = recordingResolver();
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: ['node'] });

        await factory(ctx({ providerConfig: stdioCfg, resolvePackagePath }));

        expect(asked).toEqual(['.']);
        const t = seen.transport;
        expect(t?.kind).toBe('stdio');
        if (t?.kind !== 'stdio') return;
        expect(t.cwd).toBe(ROOT);
        expect(t.command).toBe('node');
        expect(t.args).toEqual(['./scripts/server.mjs']);
    });

    it('keeps the transport exactly as before when the host provides no resolvePackagePath', async () => {
        const { factory: clientFactory, seen } = fakeClientFactory();
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: ['node'] });

        await factory(ctx({ providerConfig: stdioCfg }));

        expect(seen.transport?.kind).toBe('stdio');
        expect(Object.keys(seen.transport ?? {})).not.toContain('cwd');
    });

    it('never honours an authored providerConfig.transport.cwd: the anchor is the host\'s', async () => {
        const authored = { transport: { ...stdioCfg.transport, cwd: '/somewhere/else' } };

        const withHost = fakeClientFactory();
        const { resolvePackagePath } = recordingResolver();
        await createMcpProviderFactory({ clientFactory: withHost.factory, declarativeStdio: ['node'] })(
            ctx({ providerConfig: authored, resolvePackagePath }),
        );
        expect(withHost.seen.transport?.kind === 'stdio' && withHost.seen.transport.cwd).toBe(ROOT);

        const withoutHost = fakeClientFactory();
        await createMcpProviderFactory({ clientFactory: withoutHost.factory, declarativeStdio: ['node'] })(
            ctx({ providerConfig: authored }),
        );
        expect(Object.keys(withoutHost.seen.transport ?? {})).not.toContain('cwd');
    });

    it('does not consult the resolver for an http transport', async () => {
        const { factory: clientFactory, seen } = fakeClientFactory();
        const { resolvePackagePath, asked } = recordingResolver();
        const factory = createMcpProviderFactory({ clientFactory });

        await factory(
            ctx({ providerConfig: { transport: { kind: 'http', url: 'https://mcp.example.com' } }, resolvePackagePath }),
        );

        expect(asked).toEqual([]);
        expect(Object.keys(seen.transport ?? {})).not.toContain('cwd');
    });

    it('judges the declarativeStdio policy first: a denied command never reaches the resolver', async () => {
        const { factory: clientFactory, seen } = fakeClientFactory();
        const { resolvePackagePath, asked } = recordingResolver();
        const factory = createMcpProviderFactory({ clientFactory }); // default deny

        await expect(factory(ctx({ providerConfig: stdioCfg, resolvePackagePath }))).rejects.toThrow(
            /stdio transports are disabled by default/,
        );
        expect(asked).toEqual([]);
        expect(seen.transport).toBeUndefined();
    });

    it('treats a resolver failure as a configuration fault (plain, not upstream-unavailable), before any connection', async () => {
        const { factory: clientFactory, seen } = fakeClientFactory();
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: ['node'] });
        const resolvePackagePath = async (): Promise<string> => {
            throw new Error('host cannot resolve paths here');
        };

        const err: unknown = await Promise.resolve(factory(ctx({ providerConfig: stdioCfg, resolvePackagePath }))).catch(
            (e: unknown) => e,
        );

        expect(err).toBeInstanceOf(Error);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        expect(seen.transport).toBeUndefined();
    });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #29434 — a stdio MCP server's credential, out of metadata: the instance's
// `auth.credentialRef` is resolved by the host, and the `mcp` provider hands
// the resolved secret to the child in the variable
// `providerConfig.transport.credentialEnv` names.
//
// The real-spawn cases run a dependency-free fixture through the SDK's
// `StdioClientTransport`. The fixture reports ONLY whether the variable is set
// and its length, as its one tool's description — never the value — so nothing
// here can copy the credential into a log or a snapshot. Every value below is
// an obvious placeholder.

import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import type { ConnectorCredentialHandle, ConnectorProviderContext } from '@objectstack/spec/integration';
import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';
import { ConnectorMcpPlugin } from './connector-mcp-plugin.js';
import type { McpClientLike, McpTransport } from './mcp-connector.js';
import { createMcpProviderFactory } from './mcp-provider.js';

/** The variable the server reads its credential from. Not set in this process. */
const CREDENTIAL_ENV = 'MCP_FIXTURE_TOKEN';
/** An obvious placeholder, never a realistic secret. */
const PLACEHOLDER = 'placeholder-credential-value';

/**
 * A minimal MCP stdio server: argv[2] names the variable to report on, argv[3]
 * is a file it writes when it starts (so a test can tell it never started).
 */
const FIXTURE_SERVER = `
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const [name, marker] = process.argv.slice(2);
if (marker) writeFileSync(marker, 'started');
const value = process.env[name];
const report = (typeof value === 'string' ? 'set' : 'unset') + ':' + (typeof value === 'string' ? value.length : 0);
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: msg.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'env-fixture', version: '1.0.0' },
    } });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [
      { name: 'credential_report', description: report, inputSchema: { type: 'object' } },
    ] } });
  } else {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
});
`;

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'connector-mcp-credential-env-')));
const SERVER = join(scratch, 'server.mjs');
writeFileSync(SERVER, FIXTURE_SERVER);

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

function ctx(partial: Partial<ConnectorProviderContext> & Pick<ConnectorProviderContext, 'providerConfig'>): ConnectorProviderContext {
    return { name: 'repo_tools', label: 'Repo Tools', type: 'api', ...partial };
}

function stdio(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { kind: 'stdio', command: process.execPath, args: [SERVER, CREDENTIAL_ENV], ...extra };
}

/** A client factory that records whether anything was spawned, and never spawns. */
function recordingClientFactory() {
    const seen: McpTransport[] = [];
    const clientFactory = async (transport: McpTransport): Promise<McpClientLike> => {
        seen.push(transport);
        return { listTools: async () => [], callTool: async () => ({}), close: async () => {} };
    };
    return { clientFactory, seen };
}

async function thrownBy(fn: () => unknown): Promise<Error> {
    try {
        await fn();
    } catch (err) {
        return err as Error;
    }
    throw new Error('expected a throw');
}

describe('stdio credentialEnv — real spawns through the SDK', () => {
    it('precondition: this process does not carry the variable, so only the provider can set it', () => {
        expect(process.env[CREDENTIAL_ENV]).toBeUndefined();
    });

    it.each([
        ['bearer', { type: 'bearer', token: PLACEHOLDER }],
        ['api-key', { type: 'api-key', key: PLACEHOLDER, headerName: 'X-API-Key' }],
        ['basic', { type: 'basic', username: 'service-user', password: PLACEHOLDER }],
    ] as const)('a %s credential reaches the child in the variable credentialEnv names, and nowhere else', async (_kind, auth) => {
        const factory = createMcpProviderFactory({ declarativeStdio: [process.execPath] });
        const mat = await factory(ctx({
            auth,
            providerConfig: { transport: stdio({ env: { LOG_LEVEL: 'info' }, credentialEnv: CREDENTIAL_ENV }) },
        }));
        try {
            expect(mat.def.actions?.[0]?.description).toBe(`set:${PLACEHOLDER.length}`);
            // The materialization the host keeps and serves carries no value.
            expect(JSON.stringify(mat).includes(PLACEHOLDER)).toBe(false);
            // A stdio handshake proves nothing about the credential.
            expect(mat.credentialVerified).toBeUndefined();
        } finally {
            await mat.close?.();
        }
    });

    it('control: the same instance with no credentialEnv starts the child without the variable (auth is not applied to stdio)', async () => {
        const factory = createMcpProviderFactory({ declarativeStdio: [process.execPath] });
        const mat = await factory(ctx({
            auth: { type: 'bearer', token: PLACEHOLDER },
            providerConfig: { transport: stdio({ env: { LOG_LEVEL: 'info' } }) },
        }));
        try {
            expect(mat.def.actions?.[0]?.description).toBe('unset:0');
        } finally {
            await mat.close?.();
        }
    });

    it('control: a literal in transport.env keeps reaching the child as today', async () => {
        const factory = createMcpProviderFactory({ declarativeStdio: [process.execPath] });
        const mat = await factory(ctx({ providerConfig: { transport: stdio({ env: { [CREDENTIAL_ENV]: 'literal-placeholder' } }) } }));
        try {
            expect(mat.def.actions?.[0]?.description).toBe(`set:${'literal-placeholder'.length}`);
        } finally {
            await mat.close?.();
        }
    });
});

describe('stdio credentialEnv — configuration faults, refused before anything is spawned', () => {
    const cases: Array<[string, Partial<ConnectorProviderContext>, RegExp]> = [
        [
            'a credentialEnv that is not a variable name',
            { auth: { type: 'bearer', token: PLACEHOLDER }, providerConfig: { transport: stdio({ credentialEnv: 'NOT A NAME' }) } },
            /transport\.credentialEnv must be the name of an environment variable/,
        ],
        [
            'a credentialEnv that is not a string',
            { auth: { type: 'bearer', token: PLACEHOLDER }, providerConfig: { transport: stdio({ credentialEnv: 42 }) } },
            /transport\.credentialEnv must be the name of an environment variable/,
        ],
        [
            'a credentialEnv on an http transport',
            {
                auth: { type: 'bearer', token: PLACEHOLDER },
                providerConfig: { transport: { kind: 'http', url: 'https://mcp.example.invalid/mcp', credentialEnv: CREDENTIAL_ENV } },
            },
            /credentialEnv on an http transport/,
        ],
        [
            'a credentialEnv with no auth',
            { providerConfig: { transport: stdio({ credentialEnv: CREDENTIAL_ENV }) } },
            /declares no credential to place there/,
        ],
        [
            "a credentialEnv with auth: { type: 'none' }",
            { auth: { type: 'none' }, providerConfig: { transport: stdio({ credentialEnv: CREDENTIAL_ENV }) } },
            /declares no credential to place there/,
        ],
        [
            'a credentialEnv naming a variable transport.env also sets',
            {
                auth: { type: 'bearer', token: PLACEHOLDER },
                providerConfig: { transport: stdio({ env: { [CREDENTIAL_ENV]: 'other-placeholder' }, credentialEnv: CREDENTIAL_ENV }) },
            },
            /sets environment variable 'MCP_FIXTURE_TOKEN' twice/,
        ],
    ];

    it.each(cases)('refuses %s, plain, naming no value', async (_label, partial, message) => {
        const { clientFactory, seen } = recordingClientFactory();
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: true });
        const err = await thrownBy(() => factory(ctx({ providerConfig: {}, ...partial })));
        expect(err.constructor).toBe(Error);
        expect(err.message).toMatch(message);
        expect(err.message.includes(PLACEHOLDER)).toBe(false);
        expect(err.message.includes('other-placeholder')).toBe(false);
        expect(seen).toEqual([]);
    });

    it('a grant-bearing instance on stdio meets the credential-handle refusal, which names the credentialEnv route', async () => {
        const handle: ConnectorCredentialHandle = {
            connector: 'repo_tools',
            async get() { return { auth: { type: 'bearer', token: PLACEHOLDER } }; },
            async refresh() { return { auth: { type: 'bearer', token: PLACEHOLDER } }; },
        };
        const { clientFactory, seen } = recordingClientFactory();
        const factory = createMcpProviderFactory({ clientFactory, declarativeStdio: true });
        const err = await thrownBy(() =>
            factory(ctx({ credentialHandle: handle, providerConfig: { transport: stdio({ credentialEnv: CREDENTIAL_ENV }) } })),
        );
        expect(err.message).toMatch(/only an http transport can carry/);
        expect(err.message).toContain('providerConfig.transport.credentialEnv');
        expect(seen).toEqual([]);
    });
});

describe('stdio credentialEnv — the metadata read', () => {
    it('serves the reference and the variable name, and withholds only the env map', () => {
        const redact = getMetadataTypeRedactor('connector');
        expect(redact).toBeDefined();
        const { item, redactedKeys } = redact!({
            name: 'repo_tools',
            label: 'Repo Tools',
            type: 'api',
            provider: 'mcp',
            providerConfig: {
                transport: { kind: 'stdio', command: 'repo-mcp-server', env: { LOG_LEVEL: 'info' }, credentialEnv: CREDENTIAL_ENV },
            },
            auth: { type: 'bearer', credentialRef: 'REPO_MCP_TOKEN' },
        });
        const transport = (item.providerConfig as { transport: Record<string, unknown> }).transport;
        expect(transport.credentialEnv).toBe(CREDENTIAL_ENV);
        expect((item.auth as { credentialRef?: unknown }).credentialRef).toBe('REPO_MCP_TOKEN');
        expect(redactedKeys).toEqual(['providerConfig.transport.env']);
    });
});

describe('declarative stdio instance through the automation service', () => {
    const REF = 'OS_TEST_MCP_STDIO_CREDENTIAL_REF';

    function boot(credentialResolver: ((ref: string) => string | undefined) | undefined, marker: string) {
        const declared = [
            {
                name: 'repo_tools',
                label: 'Repo Tools',
                type: 'api',
                provider: 'mcp',
                providerConfig: {
                    transport: { kind: 'stdio', command: process.execPath, args: [SERVER, CREDENTIAL_ENV, marker], credentialEnv: CREDENTIAL_ENV },
                },
                auth: { type: 'bearer', credentialRef: REF },
            },
        ];
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin(credentialResolver ? { credentialResolver } : {}));
        kernel.use({
            name: 'test.connector-metadata',
            type: 'standard',
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(c: { registerService(name: string, service: unknown): void }) {
                c.registerService('objectql', {
                    registry: { listItems: (type: string) => (type === 'connector' ? declared : []) },
                });
            },
            async start() {},
        } as never);
        kernel.use(new ConnectorMcpPlugin({ declarativeStdio: [process.execPath] }));
        return kernel;
    }

    it('precondition: the reference is not an environment variable of this process', () => {
        expect(process.env[REF]).toBeUndefined();
    });

    it('a resolved reference reaches the spawned server; the served descriptor carries no value', async () => {
        const marker = join(scratch, 'resolved.started');
        const kernel = boot((ref) => (ref === REF ? PLACEHOLDER : undefined), marker);
        try {
            await kernel.bootstrap();
            const engine = kernel.getService('automation') as AutomationEngine;
            expect(engine.getConnectorDegradedReason('repo_tools')).toBeUndefined();
            const descriptor = engine.getConnectorDescriptors().find((d) => d.name === 'repo_tools');
            expect(descriptor?.state).toBe('ready');
            expect(descriptor?.actions[0]?.description).toBe(`set:${PLACEHOLDER.length}`);
            expect(JSON.stringify(descriptor).includes(PLACEHOLDER)).toBe(false);
        } finally {
            await kernel.shutdown();
        }
    });

    it('an unresolvable reference never starts the server: the instance is degraded naming the reference', async () => {
        const marker = join(scratch, 'missing.started');
        const kernel = boot(undefined, marker);
        try {
            await kernel.bootstrap();
            const engine = kernel.getService('automation') as AutomationEngine;
            const reason = engine.getConnectorDegradedReason('repo_tools');
            expect(reason).toContain(`credential '${REF}' is not set`);
            expect(existsSync(marker)).toBe(false);
        } finally {
            await kernel.shutdown();
        }
    });
});

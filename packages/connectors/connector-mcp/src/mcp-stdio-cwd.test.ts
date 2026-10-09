// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22423 — the stdio transport's working directory, measured on REAL spawns.
//
// Nothing here injects a client: `createMcpConnector` without a `clientFactory`
// runs the SDK-backed default, which launches the child through the MCP SDK's
// `StdioClientTransport`. The server is a dependency-free fixture written into a
// fresh temp directory that is never this process's own cwd, so a relative path
// resolved against the wrong directory fails to launch. The fixture reports the
// directory it really runs in as its one tool's description, so each case reads
// the child's cwd back instead of inferring it.
//
// The last block boots the real composition seam: the automation service's
// declarative materializer (anchored at `packageRoot`) → the `mcp` provider
// factory → the stdio transport, from a process whose cwd is not the app's.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorMcpPlugin } from './connector-mcp-plugin.js';
import { createMcpConnector, type McpConnectorBundle, type McpTransport } from './mcp-connector.js';

/** A minimal MCP stdio server: newline-delimited JSON-RPC, no imports beyond node. */
const FIXTURE_SERVER = `
import { createInterface } from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // a notification
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: msg.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'cwd-fixture', version: '1.0.0' },
    } });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [
      { name: 'where_am_i', description: process.cwd(), inputSchema: { type: 'object' } },
    ] } });
  } else {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
});
`;

// realpath: the child's process.cwd() reports the resolved directory.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'connector-mcp-cwd-')));
/** The "app": holds the server script and a relative launcher. */
const APP = join(scratch, 'app');
/** A second directory that holds nothing — a cwd for the absolute-path controls. */
const ELSEWHERE = join(scratch, 'elsewhere');
mkdirSync(join(APP, 'scripts'), { recursive: true });
mkdirSync(ELSEWHERE);
writeFileSync(join(APP, 'scripts', 'server.mjs'), FIXTURE_SERVER);
// A relative COMMAND: `./bin/node-here` is this very node binary.
mkdirSync(join(APP, 'bin'));
symlinkSync(process.execPath, join(APP, 'bin', 'node-here'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/** Connect with the real SDK client, read the child's cwd, and tear down. */
async function childCwd(transport: McpTransport): Promise<string | undefined> {
    let bundle: McpConnectorBundle | undefined;
    try {
        bundle = await createMcpConnector({ name: 'cwd_probe', transport });
        expect(bundle.def.actions?.map((a) => a.key)).toEqual(['where_am_i']);
        return bundle.def.actions?.[0]?.description;
    } finally {
        await bundle?.close();
    }
}

describe('stdio transport cwd — real spawns through the SDK (#22423)', () => {
    it('the fixture directory is not this process cwd (otherwise nothing below discriminates)', () => {
        expect(realpathSync(process.cwd())).not.toBe(APP);
    });

    it('a relative script arg resolves against the given cwd', async () => {
        await expect(
            childCwd({ kind: 'stdio', command: 'node', args: ['./scripts/server.mjs'], cwd: APP }),
        ).resolves.toBe(APP);
    });

    it('the same relative arg with no cwd resolves against the host cwd: the child exits before the handshake', async () => {
        await expect(
            childCwd({ kind: 'stdio', command: 'node', args: ['./scripts/server.mjs'] }),
        ).rejects.toMatchObject({ code: ErrorCode.ConnectionClosed });
    });

    it('a relative command path resolves against the given cwd', async () => {
        await expect(
            childCwd({ kind: 'stdio', command: './bin/node-here', args: ['./scripts/server.mjs'], cwd: APP }),
        ).resolves.toBe(APP);
    });

    it('control: an absolute command and an absolute script are unaffected by cwd', async () => {
        const absolute = { kind: 'stdio' as const, command: process.execPath, args: [join(APP, 'scripts', 'server.mjs')] };
        await expect(childCwd({ ...absolute, cwd: ELSEWHERE })).resolves.toBe(ELSEWHERE);
        await expect(childCwd({ ...absolute })).resolves.toBe(realpathSync(process.cwd()));
    });

    it('control: a bare executable still resolves through PATH when a cwd is given', async () => {
        await expect(
            childCwd({ kind: 'stdio', command: 'node', args: [join(APP, 'scripts', 'server.mjs')], cwd: ELSEWHERE }),
        ).resolves.toBe(ELSEWHERE);
    });
});

describe('declarative mcp instance booted from another directory (#22423)', () => {
    it("registers its actions, the stdio child running in the automation service's packageRoot", async () => {
        const declared = [
            {
                name: 'cwd_fixture',
                label: 'Cwd Fixture',
                type: 'api',
                provider: 'mcp',
                providerConfig: {
                    transport: { kind: 'stdio', command: 'node', args: ['./scripts/server.mjs'] },
                },
            },
        ];
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin({ packageRoot: APP }));
        kernel.use({
            name: 'test.connector-metadata',
            type: 'standard',
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(ctx: { registerService(name: string, service: unknown): void }) {
                ctx.registerService('objectql', {
                    registry: { listItems: (type: string) => (type === 'connector' ? declared : []) },
                });
            },
            async start() {},
        } as never);
        kernel.use(new ConnectorMcpPlugin({ declarativeStdio: ['node'] }));
        try {
            await kernel.bootstrap();
            const engine = kernel.getService('automation') as AutomationEngine;
            expect(engine.getConnectorDegradedReason('cwd_fixture')).toBeUndefined();
            const descriptor = engine.getConnectorDescriptors().find((d) => d.name === 'cwd_fixture');
            expect(descriptor?.state).toBe('ready');
            expect(descriptor?.actions.map((a) => a.key)).toEqual(['where_am_i']);
            expect(descriptor?.actions[0]?.description).toBe(APP);
        } finally {
            await kernel.shutdown();
        }
    });
});

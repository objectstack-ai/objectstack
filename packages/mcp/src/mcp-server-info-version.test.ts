// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `serverInfo.version` — what an MCP server answers in `initialize`.
 *
 * `MCPServerPluginOptions.version` is published as "Defaults to package
 * version". Two literal `'1.0.0'` defaults (the plugin's, and
 * `MCPServerRuntime`'s) made every deployment built without the option answer
 * `1.0.0` while the package was elsewhere, so the registry listing in
 * `server.json` and every running server disagreed. Both now read the
 * package's own manifest; an explicit `version` still overrides it.
 *
 * The expected value is read from `package.json` HERE, never written down: a
 * literal in this file would rot at the next release, and would let a
 * regression that re-introduces some other constant pass on the day the two
 * happen to agree.
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LiteKernel } from '@objectstack/core';

import { MCPServerPlugin } from './plugin.js';
import { MCPServerRuntime } from './mcp-server-runtime.js';

const MANIFEST_VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

const OVERRIDE = '9.9.9-override.1';

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pin', version: '0' } },
};

/** `initialize` over the Streamable HTTP door (`POST /api/v1/mcp`). */
async function serverInfoOverHttp(runtime: MCPServerRuntime): Promise<{ name: string; version: string }> {
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(INITIALIZE),
    }),
    { parsedBody: INITIALIZE },
  );
  const json = (await res.json()) as { result: { serverInfo: { name: string; version: string } } };
  return json.result.serverInfo;
}

/** `initialize` against the long-lived server (the stdio composition), over an in-memory pair. */
async function serverVersionOnLongLivedServer(runtime: MCPServerRuntime): Promise<string | undefined> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'pin', version: '0' });
  await runtime.server.connect(serverSide);
  await client.connect(clientSide);
  try {
    return client.getServerVersion()?.version;
  } finally {
    await client.close();
  }
}

function pluginContext() {
  const services = new Map<string, unknown>();
  return {
    services,
    ctx: {
      registerService: vi.fn((name: string, service: unknown) => {
        services.set(name, service);
      }),
      getService: vi.fn((name: string) => {
        if (!services.has(name)) throw new Error(`Service "${name}" not found`);
        return services.get(name);
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    },
  };
}

async function runtimeOf(plugin: MCPServerPlugin): Promise<MCPServerRuntime> {
  const { ctx, services } = pluginContext();
  await plugin.init(ctx as never);
  return services.get('mcp') as MCPServerRuntime;
}

describe('serverInfo.version — the default is the package version', () => {
  it('MCPServerRuntime built with no config answers the package version', async () => {
    expect((await serverInfoOverHttp(new MCPServerRuntime())).version).toBe(MANIFEST_VERSION);
  });

  it('MCPServerPlugin built with no options answers the package version (the `os serve` auto-registration shape)', async () => {
    const runtime = await runtimeOf(new MCPServerPlugin());
    expect((await serverInfoOverHttp(runtime)).version).toBe(MANIFEST_VERSION);
  });

  it('the long-lived (stdio) server answers the package version too', async () => {
    expect(await serverVersionOnLongLivedServer(new MCPServerRuntime())).toBe(MANIFEST_VERSION);
    expect(await serverVersionOnLongLivedServer(await runtimeOf(new MCPServerPlugin()))).toBe(MANIFEST_VERSION);
  });

  it("the kernel plugin's own `version` is the same one value", () => {
    expect(new MCPServerPlugin().version).toBe(MANIFEST_VERSION);
  });
});

describe('serverInfo.version — an explicit override is answered as given', () => {
  it('MCPServerRuntime config.version', async () => {
    const runtime = new MCPServerRuntime({ version: OVERRIDE });
    expect((await serverInfoOverHttp(runtime)).version).toBe(OVERRIDE);
    expect(await serverVersionOnLongLivedServer(new MCPServerRuntime({ version: OVERRIDE }))).toBe(OVERRIDE);
  });

  it('MCPServerPlugin options.version', async () => {
    const runtime = await runtimeOf(new MCPServerPlugin({ version: OVERRIDE }));
    expect((await serverInfoOverHttp(runtime)).version).toBe(OVERRIDE);
  });
});

describe('an unreadable manifest degrades to an honest answer, never to a plugin the kernel refuses', () => {
  afterEach(() => {
    vi.doUnmock('node:module');
    vi.resetModules();
  });

  it("serverInfo.version says 'unknown' and the plugin still loads", async () => {
    // A bundle with no `package.json` beside it: `createRequire(...)('../package.json')` throws.
    vi.resetModules();
    vi.doMock('node:module', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:module')>();
      return {
        ...actual,
        createRequire: () => {
          throw new Error('ENOENT: no manifest beside this bundle');
        },
      };
    });
    const { MCPServerPlugin: BlindPlugin } = await import('./plugin.js');
    const plugin = new BlindPlugin();

    // The wire answer is a free string: it says it does not know.
    const { ctx, services } = pluginContext();
    await plugin.init(ctx as never);
    expect((await serverInfoOverHttp(services.get('mcp') as MCPServerRuntime)).version).toBe('unknown');

    // The kernel plugin's `version` has a grammar (SemVer 2.0.0): a placeholder string there would
    // be refused by both kernels. `use()` throws on a refused contract.
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    expect(() => kernel.use(plugin)).not.toThrow();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3167 optional extension — "the platform connecting to itself". Proves the
// full serve↔consume loop end-to-end in ONE process: the app's own MCP HTTP
// surface (`/api/v1/mcp`, ADR-0096 / #3228) is reachable by an MCP *client*
// (connector-mcp) that authenticates with an `osk_` API key (ADR-0101 —
// anonymous is denied even to itself), and that client can discover and call
// the app's own generated tools.
//
// Deliberately HAND-WIRED (connect AFTER boot), NOT the declarative
// `provider: 'mcp'` at boot: #3167 warns the dogfood gate must not become
// timing-sensitive, and a declarative self-connection races the boot order
// (automation `start()` runs before the HTTP server listens) and heals only via
// the #3049 degrade+retry. This test sidesteps that race entirely — it connects
// once the server is listening and a key exists — so it proves the capability
// without a flaky gate. The declarative-at-boot form (with #3049 heal) remains a
// separate, carefully-gated follow-up.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { createMcpConnector } from '@objectstack/connector-mcp';

describe('showcase: the platform connects to its OWN MCP endpoint (#3167 self-connection)', () => {
  let stack: VerifyStack;
  let selfUrl: string;
  let apiKey: string;

  beforeAll(async () => {
    // Serve side up (isMcpServerEnabled default-on; the lean harness injects the
    // plugin the way `os dev`/`serve` auto-load it).
    stack = await bootStack(showcaseStack, { extraPlugins: [new MCPServerPlugin()] });
    const adminToken = await stack.signIn();

    // Mint an osk_ key — the self-connection's identity (acts AS the admin caller).
    const keyRes = await stack.apiAs(adminToken, 'POST', '/keys', { name: 'self-mcp' });
    expect(keyRes.status, `mint key: ${keyRes.status} ${await keyRes.clone().text()}`).toBe(201);
    apiKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? '';
    expect(apiKey, 'raw osk_ key returned once').toMatch(/^osk_/);

    // The app really listens on an ephemeral port (HonoServerPlugin({ port: 0 })),
    // so the connector reaches it over real HTTP exactly like an external client.
    const httpServer = await stack.kernel.getServiceAsync<{ getPort(): number }>('http-server');
    const port = httpServer.getPort();
    expect(port, 'app bound a real port').toBeGreaterThan(0);
    selfUrl = `http://127.0.0.1:${port}/api/v1/mcp`;
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('refuses an UNAUTHENTICATED self-connection (identity admission holds even to itself)', async () => {
    await expect(
      createMcpConnector({ name: 'self_anon', transport: { kind: 'http', url: selfUrl } }),
    ).rejects.toThrow();
  });

  it('connects to itself with an osk_ key and discovers its own generated tools', async () => {
    const bundle = await createMcpConnector({
      name: 'self_mcp',
      transport: { kind: 'http', url: selfUrl, headers: { 'x-api-key': apiKey } },
    });
    try {
      const toolKeys = bundle.def.actions?.map((a) => a.key) ?? [];
      // The app's own generated CRUD spine, discovered over the self-connection.
      expect(toolKeys, `self tools: ${JSON.stringify(toolKeys)}`).toContain('list_objects');
      expect(toolKeys).toContain('query_records');
      expect(toolKeys).toContain('describe_object');
    } finally {
      await bundle.close();
    }
  });

  it('operates itself end-to-end — a self tools/call round-trips the app\'s own schema', async () => {
    const bundle = await createMcpConnector({
      name: 'self_mcp_call',
      transport: { kind: 'http', url: selfUrl, headers: { 'x-api-key': apiKey } },
    });
    try {
      const handler = bundle.handlers['list_objects'];
      expect(handler, 'list_objects handler present').toBeDefined();
      // Two args, as the engine itself dispatches them (connector-nodes.ts calls
      // `handler(input, handlerCtx)`); the connector's own tests call it the same
      // way. The one-arg call here only ever worked because this MCP handler
      // happens to ignore `ctx` — it was not the declared contract.
      const result = await handler!({}, {});
      // The app's own object list, round-tripped back through its own MCP surface.
      expect(JSON.stringify(result), `self list_objects result: ${JSON.stringify(result)}`).toContain('showcase_');
    } finally {
      await bundle.close();
    }
  });
});

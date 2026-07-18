// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0096 / #3167 — the MCP HTTP surface (/api/v1/mcp) is an identity-admitted
// execution surface, proven END-TO-END through the real showcase + security +
// MCP stack. This is the e2e proof the `mcp-http-identity` matrix row deferred
// (#3202): the dispatcher unit tests prove handleMcp passes the caller EC to the
// bridge; THIS proves the whole chain — an MCP `tools/call` runs under the
// caller's RLS, so a member sees only their own rows, and an anonymous caller is
// denied before any tool executes.
//
// The target object is `showcase_private_note` (OWD `private`, owner-only) — the
// same object the declarative-OWD proof uses. Owner isolation is enforced by the
// engine, so if the MCP tool ran unscoped (the stdio posture, mcp-stdio-authority)
// this test would see cross-owner rows and FAIL.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';

const OBJ = '/data/showcase_private_note';
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

/** A JSON-RPC MCP request over Streamable-HTTP (JSON response mode). */
function mcpBody(method: string, params?: unknown, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
}

describe('showcase: MCP HTTP surface is identity-admitted (ADR-0096 / #3167)', () => {
  let stack: VerifyStack;
  let aliceToken: string;
  let bobToken: string;

  /** POST /api/v1/mcp with the Streamable-HTTP Accept header; `token` null = anonymous. */
  const mcp = (token: string | null, body: unknown) =>
    stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The transport requires the client to accept both content types.
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /** Call an MCP tool and return the parsed JSON its text-content carries. */
  async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<any> {
    const res = await mcp(token, mcpBody('tools/call', { name, arguments: args }));
    expect(res.status, `tools/call ${name}: ${res.status} ${await res.clone().text()}`).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, `tools/call ${name} JSON-RPC error: ${JSON.stringify(rpc.error)}`).toBeUndefined();
    const text = rpc.result?.content?.[0]?.text;
    expect(typeof text, 'tool result carries text content').toBe('string');
    return JSON.parse(text);
  }

  const titlesOf = (queryResult: any): string[] =>
    (queryResult.records ?? queryResult.data ?? queryResult.rows ?? []).map((r: any) => r.title);

  beforeAll(async () => {
    // The MCP plugin registers the `'mcp'` service the dispatcher's /mcp route
    // needs (in production `os serve`/`dev` auto-load it via isMcpServerEnabled;
    // bootStack's lean harness injects it explicitly). isMcpServerEnabled() is
    // default-on, so the route is live.
    stack = await bootStack(showcaseStack, { extraPlugins: [new MCPServerPlugin()] });
    await stack.signIn(); // seed dev admin (first user)
    aliceToken = await stack.signUp('mcp-alice@verify.test');
    bobToken = await stack.signUp('mcp-bob@verify.test');

    const a = await stack.apiAs(aliceToken, 'POST', OBJ, { title: 'Alice MCP note' });
    expect(a.status, 'alice creates note').toBeLessThan(300);
    expect(idOf(await a.json()), 'alice note id').toBeTruthy();
    const b = await stack.apiAs(bobToken, 'POST', OBJ, { title: 'Bob MCP note' });
    expect(b.status, 'bob creates note').toBeLessThan(300);
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('denies an anonymous MCP request before any tool runs (fail-closed, 401)', async () => {
    const res = await mcp(null, mcpBody('tools/call', { name: 'query_records', arguments: { objectName: 'showcase_private_note' } }));
    expect(res.status).toBe(401);
  });

  it('runs a tools/call under the CALLER identity — a member sees only their own rows (RLS through MCP)', async () => {
    const result = await callTool(aliceToken, 'query_records', { objectName: 'showcase_private_note' });
    const titles = titlesOf(result);
    expect(titles, `alice via MCP saw: ${JSON.stringify(titles)}`).toContain('Alice MCP note');
    // The load-bearing assertion: if the tool ran unscoped/system (the stdio
    // posture), Bob's note would be here. Owner-RLS through the MCP bridge hides it.
    expect(titles).not.toContain('Bob MCP note');
  });

  it('is symmetric — the other member sees only their own row', async () => {
    const result = await callTool(bobToken, 'query_records', { objectName: 'showcase_private_note' });
    const titles = titlesOf(result);
    expect(titles).toContain('Bob MCP note');
    expect(titles).not.toContain('Alice MCP note');
  });

  it('the caller identity also gates tool discovery — an authed member gets a tool list', async () => {
    const res = await mcp(aliceToken, mcpBody('tools/list'));
    expect(res.status).toBe(200);
    const rpc: any = await res.json();
    const names: string[] = (rpc.result?.tools ?? []).map((t: any) => t.name);
    expect(names).toContain('query_records');
    expect(names).toContain('describe_object');
  });
});

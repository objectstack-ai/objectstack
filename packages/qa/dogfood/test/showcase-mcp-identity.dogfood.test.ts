// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3167 / ADR-0096 D4 / ADR-0100 — the serve-side MCP tool-execution surface
// (@objectstack/mcp) is DEFAULT-ON and agent/external-reachable, so its identity
// posture is a checked property (the `mcp-tool-exec-identity` authz-conformance
// row), not incidental prose. The matrix row + source probes pin the code; this
// proof pins the runtime BEHAVIOUR on a real showcase boot: the /api/v1/mcp
// surface is served by default, yet tool execution is FAIL-CLOSED on identity —
// a principal-less caller gets 401, never a fall-open. The MCPServerPlugin is
// registered via `extraPlugins` because the verify harness boots the plugin set
// directly (it does not run the CLI capability push at serve.ts that wires MCP
// in `os dev`/`serve`); registering it here reproduces the default-on surface.
//
// The authenticated principal-bound execution path (tools run AS the caller's
// ExecutionContext through buildMcpBridge, RLS/FLS-bounded, with the ai.exposed
// + ADR-0066 D4 capability action gates) is exercised end-to-end against the
// real bridge in examples/app-todo/test/mcp-actions.e2e.ts; here we assert the
// complementary property a real HTTP boot uniquely shows — the fail-closed gate
// and the default-on service resolution.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';

const MCP = '/mcp';
const TOOLS_LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' } as const;
const MCP_HEADERS = {
  'content-type': 'application/json',
  // The Streamable-HTTP transport advertises both JSON and SSE responses.
  accept: 'application/json, text/event-stream',
} as const;

describe('showcase: serve-side MCP tool execution is default-on and fail-closed on identity (#3167 / ADR-0100)', () => {
  let stack: VerifyStack;
  let memberToken: string;

  beforeAll(async () => {
    // Platform default (deny anonymous) + the default-on MCP surface registered
    // exactly as `os dev`/`serve` would via the isMcpServerEnabled() capability push.
    stack = await bootStack(showcaseStack, { extraPlugins: [new MCPServerPlugin()] });
    await stack.signIn(); // seed the dev admin (first user)
    memberToken = await stack.signUp('mcp-identity-member@verify.test');
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // ── The gate: no principal → no tool execution (fail-closed, not fall-open) ──
  it('anonymous POST /mcp (tools/list) is denied 401 — no dev-admin fallback, no fall-open', async () => {
    const r = await stack.api(MCP, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify(TOOLS_LIST),
    });
    // 401 (not 404/501): the surface IS served and the service IS registered —
    // the denial is the identity gate, exactly what mcp-tool-exec-identity pins.
    expect(r.status, 'a principal-less MCP tool call must be 401').toBe(401);
  });

  it('an authenticated member clears the MCP identity gate (not 401)', async () => {
    // Past the gate the transport may 200/400/406 depending on the exact MCP
    // handshake — the point is it is NOT the anonymous 401. Mirrors the #2567
    // GraphQL "authenticated clears the gate" assertion.
    const r = await stack.api(MCP, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify(TOOLS_LIST),
    });
    expect(r.status, 'an authenticated MCP caller must clear the 401 identity gate').not.toBe(401);
  });

  // ── Default-on: the public SKILL.md download proves the surface is advertised
  // even though tool execution is gated (isMcpServerEnabled() default true). ──
  it('GET /mcp/skill is served publicly (surface is default-on)', async () => {
    const r = await stack.api(`${MCP}/skill`, { method: 'GET' });
    expect(r.status, 'the public MCP SKILL.md must be served (default-on surface)').toBe(200);
    const body = await r.text();
    expect(body.length, 'SKILL.md must have content').toBeGreaterThan(0);
  });
});

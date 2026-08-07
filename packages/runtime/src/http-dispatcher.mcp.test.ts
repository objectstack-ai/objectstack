// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';

/**
 * These tests drive `handleMcp` directly to verify the gate + auth + bridge
 * wiring without standing up a full kernel. The MCP transport itself is tested
 * in @objectstack/mcp; here we assert:
 *  - default-on gate (OS_MCP_SERVER_ENABLED=false opts out)
 *  - fail-closed auth (anonymous → 401)
 *  - the injected bridge runs through callData bound to the request's
 *    ExecutionContext (RLS/permissions), proving principal binding.
 */

function makeContext(overrides: any = {}) {
  return {
    request: new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    }),
    response: {},
    environmentId: undefined,
    executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [] },
    ...overrides,
  };
}

/** A fake kernel exposing only the services handleMcp / callData need. */
function makeKernel(opts: { withMcp?: boolean; recordedContexts?: any[] } = {}) {
  const recorded = opts.recordedContexts ?? [];
  const ql = {
    insert: async (_o: string, data: any, o: any) => {
      recorded.push(o?.context);
      return { id: 'new1', ...data };
    },
    find: async () => [],
    update: async () => ({}),
    delete: async () => ({}),
  };
  const metadata = {
    listObjects: async () => [{ name: 'task', fields: { title: {} } }],
    getObject: async (n: string) => (n === 'task' ? { name: 'task', fields: {} } : null),
    list: async (type: string) =>
      type === 'skill'
        ? [{ name: 'case_triage', label: 'Case Triage', instructions: 'Triage first.' }]
        : [],
  };
  // The fake MCP service exercises the bridge so we can assert principal binding.
  const mcpService: any = {
    lastOpts: undefined,
    lastReq: undefined,
    renderSkill: (o: any) => `---\nname: objectstack\n---\n\n# ObjectStack\n\nMCP: ${o?.mcpUrl ?? '<YOUR_ENV_MCP_URL>'}\n`,
    handleHttpRequest: async (_req: Request, o: any) => {
      mcpService.lastOpts = o;
      mcpService.lastReq = _req;
      const created = await o.bridge.create('task', { title: 'x' });
      return new Response(JSON.stringify({ ok: true, created }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const services: Record<string, any> = { metadata, objectql: ql };
  if (opts.withMcp) services.mcp = mcpService;
  const kernel: any = {
    getService: (n: string) => services[n],
    getServiceAsync: async (n: string) => services[n],
  };
  return { kernel, mcpService, recorded };
}

describe('HttpDispatcher.handleMcp', () => {
  const prev = process.env.OS_MCP_SERVER_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prev;
  });

  it('returns 404 when MCP is explicitly disabled (opt-out gate)', async () => {
    process.env.OS_MCP_SERVER_ENABLED = 'false';
    const { kernel } = makeKernel({ withMcp: true });
    const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await d.handleMcp({}, makeContext());
    expect(res.response.status).toBe(404);
  });

  it('serves MCP by default — unset env means enabled (core capability)', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    // No `mcp` service registered: an open gate reaches the 501 branch,
    // a closed gate would have short-circuited to 404 before the lookup.
    const { kernel } = makeKernel({ withMcp: false });
    const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await d.handleMcp({}, makeContext());
    expect(res.response.status).toBe(501);
  });

  describe('when enabled', () => {
    beforeEach(() => {
      process.env.OS_MCP_SERVER_ENABLED = 'true';
    });

    it('returns 501 when no MCP service is registered', async () => {
      const { kernel } = makeKernel({ withMcp: false });
      const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
      const res = await d.handleMcp({}, makeContext());
      expect(res.response.status).toBe(501);
    });

    it('normalises a node/Hono-style req into a Web Request for the transport', async () => {
      // Regression: production hands the dispatcher a node/Hono req (plain
      // headers object, path-only url) — NOT a Web Request. handleMcp must
      // reconstruct one so the transport's headers.get()/new URL(url) work.
      const { kernel, mcpService } = makeKernel({ withMcp: true });
      const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
      const nodeReq = {
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          host: 'env.objectos.app',
          'x-api-key': 'osk_demo',
        },
      };
      const res = await d.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, makeContext({ request: nodeReq }));
      expect(res.response.status).toBe(200);
      const req = mcpService.lastReq as Request;
      expect(typeof req.headers.get).toBe('function');
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://env.objectos.app/api/v1/mcp');
      expect(req.headers.get('x-api-key')).toBe('osk_demo');
      expect(req.headers.get('accept')).toContain('text/event-stream');
    });

    it('normalises a GET node req without a body', async () => {
      const { kernel, mcpService } = makeKernel({ withMcp: true });
      const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
      const nodeReq = { method: 'GET', url: '/api/v1/mcp', headers: { host: 'env.objectos.app', accept: 'text/event-stream' } };
      await d.handleMcp(undefined, makeContext({ request: nodeReq }));
      const req = mcpService.lastReq as Request;
      expect(req.method).toBe('GET');
      expect(req.url).toBe('https://env.objectos.app/api/v1/mcp');
    });

    it('returns 401 for an anonymous request (fail-closed auth)', async () => {
      const { kernel } = makeKernel({ withMcp: true });
      const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
      const res = await d.handleMcp({}, makeContext({ executionContext: undefined }));
      expect(res.response.status).toBe(401);
    });

    it('delegates to the MCP runtime with a bridge + parsedBody when authed', async () => {
      const { kernel, mcpService } = makeKernel({ withMcp: true });
      const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
      const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
      const res = await d.handleMcp(body, makeContext());
      expect(res.response.status).toBe(200);
      expect(res.response.body.ok).toBe(true);
      expect(mcpService.lastOpts.parsedBody).toEqual(body);
      expect(typeof mcpService.lastOpts.bridge.query).toBe('function');
    });

    // [#3905] The MCP runtime projects `skill` metadata onto the `prompts`
    // primitive, and it reads that metadata through the SAME per-request bridge
    // as the object tools — never through server-held state, so a multi-tenant
    // host cannot serve one environment's skills to another. Without this seam
    // the prompt surface has no producer in the open distribution and the
    // capability is never declared at all.
    it('hands the MCP runtime a skill reader bound to the request environment (#3905)', async () => {
      const { kernel, mcpService } = makeKernel({ withMcp: true });
      const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
      await d.handleMcp({ jsonrpc: '2.0', id: 1, method: 'prompts/list' }, makeContext());
      expect(typeof mcpService.lastOpts.bridge.listSkills).toBe('function');
      expect(await mcpService.lastOpts.bridge.listSkills()).toEqual([
        { name: 'case_triage', label: 'Case Triage', instructions: 'Triage first.' },
      ]);
    });

    it('binds the bridge to the request ExecutionContext (RLS/permissions)', async () => {
      const recorded: any[] = [];
      const { kernel } = makeKernel({ withMcp: true, recordedContexts: recorded });
      const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
      await d.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, makeContext());
      // The fake MCP service called bridge.create → callData → ql.insert with
      // { context }. That context MUST be the caller's principal, not system.
      expect(recorded.length).toBe(1);
      expect(recorded[0]?.userId).toBe('u1');
      expect(recorded[0]?.isSystem).toBe(false);
    });
  });
});

describe('HttpDispatcher.handleMcpSkill (GET /mcp/skill)', () => {
  const prev = process.env.OS_MCP_SERVER_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prev;
  });

  const ctx = (overrides: any = {}) =>
    makeContext({
      request: new Request('http://acme.example.com/api/v1/mcp/skill', {
        method: 'GET',
        headers: { host: 'acme.example.com', 'x-forwarded-proto': 'https' },
      }),
      // Anonymous on purpose: the skill is public like /discovery.
      executionContext: undefined,
      ...overrides,
    });

  /** Drain the single-chunk markdown "stream" the endpoint returns. */
  async function drainSkill(res: any): Promise<{ status: number; headers: any; text: string }> {
    const r = res.result;
    expect(r?.type).toBe('stream');
    let text = '';
    for await (const chunk of r.events) text += chunk;
    return { status: r.status, headers: r.headers, text };
  }

  it('serves the env-customized SKILL.md as text/markdown, anonymously', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    const { kernel } = makeKernel({ withMcp: true });
    const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const { status, headers, text } = await drainSkill(await d.handleMcpSkill('GET', ctx()));
    expect(status).toBe(200);
    expect(headers?.['content-type']).toContain('text/markdown');
    expect(headers?.['cache-control']).toBe('no-store');
    // No auth service in the fake kernel → URL derived from the request host.
    expect(text).toContain('https://acme.example.com/api/v1/mcp');
  });

  it('404s when the MCP surface is opted out (nothing advertised)', async () => {
    process.env.OS_MCP_SERVER_ENABLED = 'false';
    const { kernel } = makeKernel({ withMcp: true });
    const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await d.handleMcpSkill('GET', ctx());
    expect(res.response.status).toBe(404);
  });

  it('501s when the MCP service is not loaded', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    const { kernel } = makeKernel({ withMcp: false });
    const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await d.handleMcpSkill('GET', ctx());
    expect(res.response.status).toBe(501);
  });

  it('405s non-GET with an Allow header', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    const { kernel } = makeKernel({ withMcp: true });
    const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await d.handleMcpSkill('POST', ctx());
    expect(res.response.status).toBe(405);
    expect(res.response.headers?.Allow).toBe('GET');
  });

  it('prefers the auth service canonical URL over host derivation', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    const { kernel } = makeKernel({ withMcp: true });
    const services = (kernel as any).__services ?? null;
    // makeKernel exposes getService via closure; extend by wrapping.
    const origGet = kernel.getServiceAsync;
    (kernel as any).getServiceAsync = async (n: string) =>
      n === 'auth'
        ? { getMcpResourceUrl: () => 'https://canonical.example.com/api/v1/mcp' }
        : origGet(n);
    const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const { status, text } = await drainSkill(await d.handleMcpSkill('GET', ctx()));
    expect(status).toBe(200);
    expect(text).toContain('https://canonical.example.com/api/v1/mcp');
    expect(text).not.toContain('acme.example.com');
    void services;
  });
});

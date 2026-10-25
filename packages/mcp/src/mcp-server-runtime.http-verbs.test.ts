// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25759] The stateless Streamable HTTP surface serves POST alone: GET and
 * DELETE (and every other verb) answer `405` with `Allow: POST`.
 *
 * ## The defect
 *
 * `handleHttpRequest` builds a stateless transport (`sessionIdGenerator:
 * undefined`, `enableJsonResponse: true`) and closes the per-request server in
 * `finally`. Before this change a GET went on to the SDK's `handleGetRequest`,
 * which answered `200 text/event-stream`, and the stream closed with the
 * server. Measured on `5874d25302`: `200`, empty body, ~13 ms. The SDK client
 * reads a GET stream that ends as a dropped connection and opens another one;
 * production saw ~183 `GET /api/v1/mcp` a minute from one machine with Claude
 * Code sessions open (cloud#3103). A DELETE answered `200` and ended nothing,
 * because no session exists.
 *
 * ## What is pinned
 *
 *  1. GET, DELETE and the other verbs answer `405`, `Allow: POST`, with the
 *     SDK transport's own JSON-RPC 405 body, and no bridge member is read.
 *  2. POST is unchanged: `initialize` and `tools/list` round trips answer
 *     `200` with no session id.
 *  3. The SDK's own client, connected over this surface, opens the GET stream
 *     once and never again, and its tool calls still work. This is the
 *     reconnect loop itself: with the 200 stream, the same client re-opens the
 *     GET every time it closes.
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

const URL_ = 'http://localhost/api/v1/mcp';

/** A bridge that records every member read, so a refused verb can be shown to read none. */
function makeBridge(): McpDataBridge & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listObjects() {
      calls.push('listObjects');
      return [{ name: 'task', label: 'Task', fieldCount: 1 }];
    },
    async describeObject() {
      calls.push('describeObject');
      return { name: 'task', fields: [{ name: 'title', type: 'text' }] };
    },
    async query(object: string) {
      calls.push('query');
      return { object, records: [], total: 0 };
    },
    async get(_object: string, id: string) {
      calls.push('get');
      return { id };
    },
    async create(object: string, data: any) {
      calls.push('create');
      return { object, id: 'n1', record: data };
    },
    async update(object: string, id: string, data: any) {
      calls.push('update');
      return { object, id, record: data };
    },
    async remove(object: string, id: string) {
      calls.push('remove');
      return { object, id, success: true };
    },
  };
}

/** The headers a claude-code client sends on its GET (cloud#3103's reading). */
const CLIENT_GET_HEADERS = {
  accept: 'text/event-stream',
  'mcp-protocol-version': '2025-06-18',
  'x-api-key': 'osk_test',
};

const INIT = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};

async function post(runtime: MCPServerRuntime, body: unknown, bridge?: McpDataBridge): Promise<Response> {
  return runtime.handleHttpRequest(
    new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body },
  );
}

async function expectMethodNotAllowed(res: Response): Promise<void> {
  expect(res.status).toBe(405);
  expect(res.headers.get('allow')).toBe('POST');
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(res.headers.get('mcp-session-id')).toBeNull();
  expect(await res.json()).toEqual({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
}

describe('[#25759] the stateless /api/v1/mcp surface answers every verb but POST with 405', () => {
  it('GET answers 405 with Allow: POST, not an SSE stream that ends at once', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const bridge = makeBridge();
    const res = await runtime.handleHttpRequest(new Request(URL_, { method: 'GET', headers: CLIENT_GET_HEADERS }), {
      bridge,
    });

    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    await expectMethodNotAllowed(res);
    expect(bridge.calls, 'a refused verb reads no bridge member').toEqual([]);
  });

  it('DELETE answers 405 with Allow: POST: there is no session to end', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    for (const headers of [{}, { 'mcp-session-id': 'never-issued', 'mcp-protocol-version': '2025-06-18' }]) {
      const res = await runtime.handleHttpRequest(new Request(URL_, { method: 'DELETE', headers }), {
        bridge: makeBridge(),
      });
      await expectMethodNotAllowed(res);
    }
  });

  it('every other verb answers 405 with Allow: POST (the SDK used to name GET and DELETE in Allow)', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    for (const method of ['PUT', 'PATCH', 'OPTIONS']) {
      const res = await runtime.handleHttpRequest(new Request(URL_, { method }), { bridge: makeBridge() });
      await expectMethodNotAllowed(res);
    }
    const head = await runtime.handleHttpRequest(new Request(URL_, { method: 'HEAD' }), { bridge: makeBridge() });
    expect(head.status).toBe(405);
    expect(head.headers.get('allow')).toBe('POST');
  });

  it('POST is unchanged: initialize and tools/list round trips answer 200 with no session id', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const bridge = makeBridge();

    const init = await post(runtime, INIT, bridge);
    expect(init.status).toBe(200);
    expect(init.headers.get('mcp-session-id')).toBeNull();
    const initJson: any = await init.json();
    expect(initJson.result.serverInfo).toEqual({ name: 'objectstack-test', version: '9.9.9' });
    expect(initJson.result.capabilities.tools).toBeDefined();

    const initialized = await post(runtime, { jsonrpc: '2.0', method: 'notifications/initialized' }, bridge);
    expect(initialized.status).toBe(202);

    const list = await post(runtime, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, bridge);
    expect(list.status).toBe(200);
    const names = ((await list.json()) as any).result.tools.map((t: any) => t.name);
    expect(names).toContain('query_records');
    expect(names).toContain('list_objects');
  });

  it('the SDK client opens the GET stream once and never again, and its calls still work', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const bridge = makeBridge();
    const seen: string[] = [];

    // Route the client's fetch straight into the surface, as a host's dispatcher does.
    const fetchIntoSurface = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      seen.push(request.method);
      const text = request.method === 'POST' ? await request.text() : '';
      return runtime.handleHttpRequest(request, { bridge, parsedBody: text ? JSON.parse(text) : undefined });
    };

    const transport = new StreamableHTTPClientTransport(new URL(URL_), {
      fetch: fetchIntoSurface as typeof fetch,
      // A reconnect as fast as the loop can go, so a dropped GET stream shows
      // up as many GETs inside the window below rather than one per second.
      reconnectionOptions: {
        initialReconnectionDelay: 5,
        maxReconnectionDelay: 5,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 1000,
      },
    });
    const client = new Client({ name: 'verb-test', version: '1.0.0' });
    const errors: unknown[] = [];
    client.onerror = (err) => errors.push(err);

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('query_records');

      await new Promise((resolve) => setTimeout(resolve, 250));

      const gets = seen.filter((m) => m === 'GET').length;
      expect(gets, `the client opened the GET stream ${gets} times: ${seen.join(' ')}`).toBe(1);
      expect(errors, 'a 405 on GET is the "no stream offered" answer, not a client error').toEqual([]);
    } finally {
      await client.close();
    }
  });
});

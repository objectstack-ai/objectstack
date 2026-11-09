// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The runner's own MCP call (`HttpApp.callTool`, the validation probe's door):
 * against a loopback stand-in for `POST /api/v1/mcp`, in the shapes the MCP
 * HTTP door answers (`packages/mcp/src/mcp-http-tools.ts`; the request shape is
 * the one `showcase-mcp-http-identity.dogfood.test.ts` proves against the real
 * stack). No model, and no network beyond 127.0.0.1.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HttpApp, readJsonRpc, toolAnswerOf } from '../../src/runner/app.js';

describe('readJsonRpc / toolAnswerOf', () => {
  it('reads the JSON response mode and the SSE mode alike, and a tool result as its text', () => {
    const rpc = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"id":"n1"}' }] } };
    expect(readJsonRpc(JSON.stringify(rpc))).toEqual(rpc);
    expect(readJsonRpc(`event: message\ndata: ${JSON.stringify(rpc)}\n\n`)).toEqual(rpc);
    expect(readJsonRpc('<html>bad gateway</html>')).toBeUndefined();
    expect(toolAnswerOf(rpc.result)).toEqual({ output: '{"id":"n1"}', isError: false });
    expect(toolAnswerOf({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], isError: true })).toEqual({ output: 'a\nb', isError: true });
  });
});

describe('HttpApp.callTool — one tools/call as the key owner, through the agent’s MCP door', () => {
  const seen: Array<{ path?: string; headers: IncomingMessage['headers']; body: unknown }> = [];
  let server: Server;
  let app: HttpApp;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw) as { id: number; params: { name: string; arguments: { data?: Record<string, unknown> } } };
        seen.push({ path: req.url, headers: req.headers, body });
        if (req.headers.authorization !== 'Bearer key-ok') {
          res.writeHead(401).end();
          return;
        }
        if (body.params.name === 'nope') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Tool nope not found' } }));
          return;
        }
        // The door's refusal: a coded envelope as the tool's text, flagged isError, inside a JSON-RPC 200 (SSE framing).
        const refused = { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'VALIDATION_FAILED', status: 400 } }, null, 2) }], isError: true };
        res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: refused })}\n\n`);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    app = new HttpApp({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, adminEmail: 'a', adminPassword: 'b' });
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('posts a JSON-RPC tools/call to /api/v1/mcp with the Bearer key and both accepted types, and reads the refusal', async () => {
    const answer = await app.callTool('key-ok', 'create_record', { objectName: 'democrm_contact', data: { email: 'gil at acme' } });
    expect(answer.isError).toBe(true);
    expect(JSON.parse(answer.output as string)).toEqual({ error: { code: 'VALIDATION_FAILED', status: 400 } });
    const req = seen[seen.length - 1]!;
    expect(req.path).toBe('/api/v1/mcp');
    expect(req.headers.accept).toBe('application/json, text/event-stream');
    expect(req.body).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_record', arguments: { objectName: 'democrm_contact', data: { email: 'gil at acme' } } } });
  });

  it('throws on a refused key and on a JSON-RPC error, so the probe is never read as an answer', async () => {
    await expect(app.callTool('key-bad', 'create_record', {})).rejects.toThrow(/^tools\/call create_record: 401/);
    await expect(app.callTool('key-ok', 'nope', {})).rejects.toThrow('tools/call nope: JSON-RPC -32602 Tool nope not found');
  });
});

describe('HttpApp.updateRow — the seed’s second pass, through the data door', () => {
  const seen: Array<{ method?: string; path?: string; body: unknown }> = [];
  let server: Server;
  let app: HttpApp;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined });
        if (req.url?.endsWith('/dep_fin')) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Manager: no demopurchase_employee record has id "e99"', code: 'VALIDATION_FAILED' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'dep_sales' }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    app = new HttpApp({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, adminEmail: 'a', adminPassword: 'b' });
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('sends PATCH /api/v1/data/OBJECT/ID with the bare field patch, and reads a refusal’s code and message', async () => {
    expect(await app.updateRow('demopurchase_department', 'dep_sales', { manager: 'e13' })).toMatchObject({ ok: true, status: 200 });
    expect(seen[0]).toEqual({ method: 'PATCH', path: '/api/v1/data/demopurchase_department/dep_sales', body: { manager: 'e13' } });
    expect(await app.updateRow('demopurchase_department', 'dep_fin', { manager: 'e99' })).toMatchObject({
      ok: false,
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Manager: no demopurchase_employee record has id "e99"',
    });
  });
});

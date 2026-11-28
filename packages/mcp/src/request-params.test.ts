// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import { createPlatformMcpServer } from './request-params.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import type { McpSkillBridge } from './skill-prompts.js';

/**
 * A request whose params fail the method's request schema is the CALLER's
 * mistake: JSON-RPC -32602 Invalid params with a sentence naming the param,
 * never -32603 Internal error carrying the serialised Zod issue list. Driven
 * over both real transports, because both build their server through the one
 * seam in `request-params.ts`.
 */

const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function makeBridge(): McpDataBridge & McpSkillBridge {
  return {
    async listObjects() {
      return [{ name: 'crm_opportunity', label: 'Opportunity', fieldCount: 1 }];
    },
    async describeObject(name: string) {
      return name === 'crm_opportunity'
        ? { name, label: 'Opportunity', fields: [{ name: 'amount', type: 'currency', label: 'Amount', required: false }] }
        : null;
    },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listSkills() { return []; },
  };
}

async function overHttp(method: string, params: unknown): Promise<any> {
  const runtime = new MCPServerRuntime({ name: 'request-params', version: '0.0.0' });
  const body = { jsonrpc: '2.0', id: 1, method, params };
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge: makeBridge(), parsedBody: body } as never,
  );
  return res.json();
}

/** The refusal shape every malformed request must get: the code, the named param, no JSON dump. */
function expectInvalidParams(frame: any, sentence: string): void {
  expect(frame.error, JSON.stringify(frame)).toBeDefined();
  expect(frame.error.code).toBe(INVALID_PARAMS);
  expect(frame.error.message).toBe(`MCP error -32602: ${sentence}`);
}

describe('malformed request params answer -32602 Invalid params (HTTP transport)', () => {
  it('prompts/get with no name', async () => {
    expectInvalidParams(await overHttp('prompts/get', {}), 'params.name is required');
  });

  it('tools/call with {}', async () => {
    expectInvalidParams(await overHttp('tools/call', {}), 'params.name is required');
  });

  it('prompts/get with a non-string name', async () => {
    expectInvalidParams(await overHttp('prompts/get', { name: 42 }), 'params.name must be a string');
  });

  it('initialize, a handler the SDK installs in its own constructor, takes the same answer', async () => {
    const frame = await overHttp('initialize', { capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expectInvalidParams(frame, 'params.protocolVersion is required');
  });

  it("control: a tool's own argument check stays a tool error, not a JSON-RPC error", async () => {
    const frame = await overHttp('tools/call', {
      name: 'validate_expression',
      arguments: { objectName: 'crm_opportunity', expression: 'record.amount > 1', site: 'nope' },
    });
    expect(frame.error).toBeUndefined();
    expect(frame.result.isError).toBe(true);
    expect(JSON.parse(frame.result.content[0].text).error.message).toMatch(
      /^Invalid arguments for tool validate_expression: /,
    );
  });
});

describe('malformed request params answer -32602 Invalid params (stdio transport)', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  it('tools/call with {} on the long-lived server', async () => {
    const runtime = new MCPServerRuntime({ name: 'request-params', version: '0.0.0' });
    runtime.bridgeDataTools(makeBridge());
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = new StdioServerTransport(stdin, stdout);
    await runtime.server.connect(transport);
    closers.push(() => transport.close().catch(() => {}));

    const frame = await new Promise<any>((resolve) => {
      stdout.on('data', (chunk) => {
        for (const line of String(chunk).split('\n')) {
          if (line.trim()) resolve(JSON.parse(line));
        }
      });
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} })}\n`);
    });
    expect(frame.id).toBe(7);
    expectInvalidParams(frame, 'params.name is required');
  });
});

describe('only the request-schema parse is mapped', () => {
  it('a ZodError thrown inside a handler keeps the -32603 answer', async () => {
    const server = createPlatformMcpServer({ name: 'request-params', version: '0.0.0' }, { capabilities: { prompts: {} } });
    server.server.setRequestHandler(GetPromptRequestSchema, async () => {
      z.object({ inner: z.string() }).parse({});
      return { messages: [] };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const body = { jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'any' } };
    try {
      const res = await transport.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify(body),
        }),
        { parsedBody: body },
      );
      const frame = (await res.json()) as { error: { code: number } };
      expect(frame.error.code).toBe(INTERNAL_ERROR);
    } finally {
      await server.close();
    }
  });
});

/**
 * [#37411] A `tools/call` whose ARGUMENTS fail the tool's published JSON
 * Schema is refused with the platform's coded refusal on both doors, not the
 * SDK's bare `MCP error -32602: Input validation error` text, and the unknown
 * keys it names are the caller's own text echoed bounded and sanitised: a
 * capped count, each key cut, every control character written as its escape.
 */
describe('a tool argument that fails the published schema answers the coded refusal', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  /** A wrong type, plus nine unknown keys that each carry a newline, a NUL and a long tail. */
  function failingArguments(): Record<string, unknown> {
    const args: Record<string, unknown> = { objectName: 42, expression: 'record.amount > 1' };
    for (let i = 0; i < 9; i++) args[`junk_${i}\n\u0000${'x'.repeat(60)}`] = i;
    return args;
  }

  function expectCodedArgumentRefusal(result: any): void {
    expect(result.isError, JSON.stringify(result)).toBe(true);
    expect(result.content).toHaveLength(1);
    const text: string = result.content[0].text;
    expect(text).not.toContain('MCP error -32602');
    const { error } = JSON.parse(text);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.status).toBe(400);
    const message: string = error.message;
    expect(message).toMatch(/^Invalid arguments for tool validate_expression: /);
    // The wrong type is named at its path.
    expect(message).toMatch(/expected string, received number at objectName/);
    // A capped count: five keys named, the other four counted.
    expect(message.match(/junk_\d/g)).toEqual(['junk_0', 'junk_1', 'junk_2', 'junk_3', 'junk_4']);
    expect(message).toContain('4 more unrecognized key(s) not shown.');
    // Sanitised and cut: the newline and the NUL are escapes, and the key stops at 64 characters.
    expect(message).toContain(`\`junk_0\\u000a\\u0000${'x'.repeat(46)}…\``);
    expect(message).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
  }

  it('over HTTP', async () => {
    const frame = await overHttp('tools/call', { name: 'validate_expression', arguments: failingArguments() });
    expect(frame.error).toBeUndefined();
    expectCodedArgumentRefusal(frame.result);
  });

  it('over stdio, on the long-lived server', async () => {
    const runtime = new MCPServerRuntime({ name: 'request-params', version: '0.0.0' });
    runtime.bridgeDataTools(makeBridge());
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = new StdioServerTransport(stdin, stdout);
    await runtime.server.connect(transport);
    closers.push(() => transport.close().catch(() => {}));

    const frame = await new Promise<any>((resolve) => {
      let buffered = '';
      stdout.on('data', (chunk) => {
        buffered += String(chunk);
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) resolve(JSON.parse(line));
      });
      const call = { name: 'validate_expression', arguments: failingArguments() };
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: call })}\n`);
    });
    expect(frame.id).toBe(8);
    expect(frame.error).toBeUndefined();
    expectCodedArgumentRefusal(frame.result);
  });

  it('a plain misspelling is still echoed as written, with its rename advice', async () => {
    const frame = await overHttp('tools/call', {
      name: 'query_records',
      arguments: { objectName: 'crm_opportunity', sort: [{ field: 'amount', order: 'desc' }] },
    });
    const { error } = JSON.parse(frame.result.content[0].text);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('`sort` → `orderBy`');
    expect(error.message).not.toContain('not shown');
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37666] The MCP doors write their 5xx fault line (`logServerFault`,
 * `@objectstack/types`) through the runtime's logger, which the plugin builds
 * from the kernel's (`ctx.logger`).
 *
 * The doors used to call `logServerFault` with no logger, so the line took the
 * console fallback: not the host's sink, and only the default redact words.
 * A host that configured its own redact word (here `dsn`) got a fault line that
 * printed that member of a cause in full.
 *
 * Pinned on both doors, each through the runtime's own composition:
 *  - `/mcp`: `handleHttpRequest`, the per-request server the runtime domain
 *    calls (`packages/runtime/src/domains/mcp.ts`);
 *  - stdio: the long-lived server, its tools from `bridgeDataTools` and its
 *    record resource from `bridgeResources`, over an in-process transport.
 *
 * On each: the line reaches the host's `ObjectLogger` and not the console, the
 * host's redact word is applied to the cause, and the answer is the same bytes
 * a runtime with no logger gives. CONTROL: with no logger the line still falls
 * back to the console, where the host's word is not applied.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLogger, type ObjectLogger } from '@objectstack/core';
import type { IMetadataService, Logger } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

type Bridge = McpDataBridge & McpActionBridge;

/** The host's redact word: not one of the default four (`password`, `token`, `secret`, `key`). */
const HOST_REDACT_WORD = 'dsn';
const DSN = 'postgres://ops:pw@db.internal/prod';

/** A fault wrapping the driver's state, whose `dsn` member only the host's word redacts. */
function fault(): Error {
  return new Error('connection pool exhausted', { cause: { dsn: DSN, pool: 'primary' } });
}

function hostLogger(): ObjectLogger {
  return createLogger({ level: 'error', format: 'json', redact: [HOST_REDACT_WORD] });
}

function bridgeThrowing(member: keyof Bridge): Bridge {
  const bridge: Bridge = {
    async listObjects() { return [{ name: 'task', label: 'Task', fieldCount: 1 }]; },
    async describeObject() { return { name: 'task', fields: [{ name: 'title', type: 'text' }] }; },
    async query(object) { return { object, records: [], total: 0 }; },
    async get(_object, id) { return { id }; },
    async create(object, data) { return { object, id: 'n1', record: data }; },
    async update(object, id, data) { return { object, id, record: data }; },
    async remove(object, id) { return { object, id, success: true }; },
    async listActions() { return []; },
    async runAction(name) { return { ok: true, action: name }; },
  };
  (bridge as unknown as Record<string, unknown>)[member] = async () => {
    throw fault();
  };
  return bridge;
}

interface Site {
  tool: string;
  args: Record<string, unknown>;
  member: keyof Bridge;
  /** What the fault line names as the request. */
  path: string;
}

/** One tool per rendering helper: the record read, the record write, the metadata read and `list_actions`. */
const SITES: readonly Site[] = [
  { tool: 'get_record', args: { objectName: 'task', recordId: 't1' }, member: 'get', path: 'get_record task' },
  { tool: 'create_record', args: { objectName: 'task', data: { title: 'x' } }, member: 'create', path: 'create_record task' },
  { tool: 'list_objects', args: {}, member: 'listObjects', path: 'list_objects' },
  { tool: 'list_actions', args: {}, member: 'listActions', path: 'list_actions' },
];

const FAULT_BODY = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 } };

/** The fault lines a host `ObjectLogger` wrote, parsed from its stderr records. */
interface Captured {
  lines: Array<{ level: string; msg: string; error?: { causes?: Array<{ message: string }> } }>;
  console: ReturnType<typeof vi.spyOn>;
}

function capture(): Captured {
  const lines: Captured['lines'] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    const text = String(chunk).trim();
    if (text.startsWith('{')) {
      const record = JSON.parse(text);
      if (String(record.msg).startsWith('[5xx]')) lines.push(record);
    }
    return true;
  }) as typeof process.stderr.write);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { lines, console: vi.spyOn(console, 'error').mockImplementation(() => {}) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

let nextId = 1;
async function callOverHttp(logger: Logger | undefined, site: Site): Promise<{ isError: boolean; text: string }> {
  const body = { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: site.tool, arguments: site.args } };
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0', ...(logger ? { logger } : {}) });
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge: bridgeThrowing(site.member), parsedBody: body },
  );
  expect(res.status).toBe(200);
  const result = ((await res.json()) as { result: { isError: boolean; content: Array<{ text: string }> } }).result;
  return { isError: result.isError, text: result.content[0]!.text };
}

/** A connected client on the runtime's long-lived (stdio) server. */
async function stdioClient(runtime: MCPServerRuntime): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverSide);
  const client = new Client({ name: 'pin', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

async function callOverStdio(logger: Logger | undefined, site: Site): Promise<{ isError: boolean; text: string }> {
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0', ...(logger ? { logger } : {}) });
  runtime.bridgeDataTools(bridgeThrowing(site.member));
  const client = await stdioClient(runtime);
  try {
    const result = (await client.callTool({ name: site.tool, arguments: site.args })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    return { isError: result.isError, text: result.content[0]!.text };
  } finally {
    await client.close();
  }
}

const RECORD_URI = 'objectstack://objects/task/records/t1';

async function readRecordOverStdio(logger: Logger | undefined): Promise<string> {
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0', ...(logger ? { logger } : {}) });
  const metadata = {
    listObjects: vi.fn(async () => []),
    getObject: vi.fn(async () => null),
  } as unknown as IMetadataService;
  runtime.bridgeResources(metadata, async () => {
    throw fault();
  });
  const client = await stdioClient(runtime);
  try {
    const read = await client.readResource({ uri: RECORD_URI });
    return String((read.contents[0] as { text?: unknown }).text);
  } finally {
    await client.close();
  }
}

/** The line went to the host's logger, once, with the host's word applied to the cause. */
function expectHostLine(captured: Captured, path: string, method = 'tools/call'): void {
  expect(captured.console).not.toHaveBeenCalled();
  expect(captured.lines).toHaveLength(1);
  const [line] = captured.lines;
  expect(line!.level).toBe('error');
  expect(line!.msg).toBe(`[5xx] 500 ${method} ${path} — connection pool exhausted`);
  const cause = line!.error?.causes?.[0]?.message;
  expect(cause).toBe(JSON.stringify({ dsn: '***REDACTED***', pool: 'primary' }));
  expect(JSON.stringify(line)).not.toContain(DSN);
}

describe.each([
  ['/mcp (handleHttpRequest)', callOverHttp],
  ['stdio (bridgeDataTools)', callOverStdio],
] as const)('[#37666] the %s door writes a tool fault line through the host logger', (_door, call) => {
  for (const site of SITES) {
    it(`${site.tool}: the line reaches the host logger with its redact word applied, the answer unchanged`, async () => {
      const captured = capture();
      const answer = await call(hostLogger(), site);
      expectHostLine(captured, site.path);

      expect(answer.isError).toBe(true);
      expect(JSON.parse(answer.text)).toEqual(FAULT_BODY);
      for (const word of ['pool', 'dsn', 'postgres', 'causes']) expect(answer.text).not.toContain(word);
      // Byte for byte what a runtime with no logger answers.
      vi.restoreAllMocks();
      capture();
      expect(await call(undefined, site)).toEqual(answer);
    });
  }

  it('CONTROL: with no logger the line falls back to the console, where the host word does not apply', async () => {
    const captured = capture();
    await call(undefined, SITES[0]!);
    expect(captured.lines).toEqual([]);
    expect(captured.console).toHaveBeenCalledTimes(1);
    const [message, meta] = captured.console.mock.calls[0]! as [string, { causes?: Array<{ message: string }> }];
    expect(message).toBe('[5xx] 500 tools/call get_record task — connection pool exhausted');
    expect(meta.causes?.[0]?.message).toContain(DSN);
  });
});

describe('[#37666] the stdio record resource writes its fault line through the host logger', () => {
  it('the line reaches the host logger with its redact word applied, the answer unchanged', async () => {
    const captured = capture();
    const text = await readRecordOverStdio(hostLogger());
    expectHostLine(captured, RECORD_URI, 'resources/read');

    expect(text).toBe(JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR', status: 500 }));
    vi.restoreAllMocks();
    capture();
    expect(await readRecordOverStdio(undefined)).toBe(text);
  });

  it('CONTROL: with no logger the line falls back to the console', async () => {
    const captured = capture();
    await readRecordOverStdio(undefined);
    expect(captured.lines).toEqual([]);
    expect(captured.console).toHaveBeenCalledTimes(1);
    expect(String(captured.console.mock.calls[0]![0])).toBe(`[5xx] 500 resources/read ${RECORD_URI} — connection pool exhausted`);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `bridgeTools` surface must forward what an `AIToolDefinition` declares.
 *
 * THE DEFECT. `registerToolFromDefinition` passed `description` and three
 * annotation hints to `McpServer.registerTool` and never read
 * `tool.parameters`. Two prose sites said otherwise — `bridgeTools`' own
 * docblock ("Each registered tool becomes an MCP tool with the same name,
 * description, and JSON Schema parameters") and the comment on the call
 * ("pass the JSON Schema as annotations metadata") — so a reader checking
 * whether `parameters` was handled found a sentence saying yes.
 *
 * WHY THESE CASES DRIVE A REAL `StdioServerTransport`. The pins that were
 * green through the whole defect asserted the bridge's *log line*
 * ("Bridged N tools from ToolRegistry"), which stays true of a bridge that
 * forwards nothing. What a client receives is only visible on the wire, so
 * every case below speaks newline-delimited JSON-RPC down a real transport
 * attached to the real long-lived server and reads `tools/list` /
 * `tools/call` results, exactly as a desktop MCP host does. The transport is
 * fed `PassThrough` pipes instead of `process.stdin`/`stdout` (its
 * constructor takes both), the same technique the #8034 stdio pins use.
 *
 * WHAT THE CONTROLS ARE FOR. `name + description reach the client` and
 * `a tool that declares no parameters` were GREEN before the fix and stay
 * green after, so a red from the two schema/argument pins is a statement
 * about the bridge rather than about the harness.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AIToolDefinition, ToolCallPart } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { ToolRegistry, ToolExecutionResult } from './types.js';

// ---------------------------------------------------------------------------
// A real stdio client: newline-delimited JSON-RPC over the transport's pipes
// ---------------------------------------------------------------------------

interface JsonRpcFrame {
  jsonrpc: string;
  id?: number;
  result?: any;
  error?: { code: number; message: string };
}

interface StdioSession {
  rpc(method: string, params?: unknown): Promise<JsonRpcFrame>;
  notify(method: string, params?: unknown): void;
  close(): Promise<void>;
}

async function openStdio(server: McpServer): Promise<StdioSession> {
  const serverStdin = new PassThrough();
  const serverStdout = new PassThrough();
  const transport = new StdioServerTransport(serverStdin, serverStdout);
  await server.connect(transport);

  let nextId = 1;
  let buffered = '';
  const waiting = new Map<number, (frame: JsonRpcFrame) => void>();

  serverStdout.on('data', (chunk: Buffer | string) => {
    buffered += String(chunk);
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line) continue;
      let frame: JsonRpcFrame;
      try {
        frame = JSON.parse(line) as JsonRpcFrame;
      } catch {
        continue;
      }
      const resolve = typeof frame.id === 'number' ? waiting.get(frame.id) : undefined;
      if (resolve && typeof frame.id === 'number') {
        waiting.delete(frame.id);
        resolve(frame);
      }
    }
  });

  return {
    rpc(method, params) {
      const id = nextId++;
      return new Promise<JsonRpcFrame>((resolve, reject) => {
        const giveUp = setTimeout(
          () => reject(new Error(`stdio: no answer to "${method}" (id ${id}) within 5s`)),
          5_000,
        );
        waiting.set(id, (frame) => {
          clearTimeout(giveUp);
          resolve(frame);
        });
        serverStdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`,
        );
      });
    },
    notify(method, params) {
      serverStdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`);
    },
    async close() {
      await transport.close().catch(() => {});
    },
  };
}

async function handshake(session: StdioSession): Promise<void> {
  await session.rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'tool-bridge-pin', version: '0.0.0' },
  });
  session.notify('notifications/initialized');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A tool whose `parameters` declares a real argument shape. */
const QUERY_RECORDS: AIToolDefinition = {
  name: 'query_records',
  description: 'Query records of an object',
  parameters: {
    type: 'object',
    properties: {
      objectName: { type: 'string', description: 'The object/table name' },
      limit: { type: 'number', description: 'Max rows' },
    },
    required: ['objectName'],
  },
};

/** Control: a tool that genuinely declares no parameters. */
const LIST_OBJECTS: AIToolDefinition = {
  name: 'list_objects',
  description: 'List all objects',
  parameters: { type: 'object', properties: {} },
};

interface RecordingRegistry extends ToolRegistry {
  calls: ToolCallPart[];
}

function makeRegistry(tools: AIToolDefinition[]): RecordingRegistry {
  const calls: ToolCallPart[] = [];
  return {
    calls,
    getAll: () => tools,
    async execute(toolCall: ToolCallPart): Promise<ToolExecutionResult> {
      calls.push(toolCall);
      return {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: 'text', value: `executed ${toolCall.toolName}` },
      } as ToolExecutionResult;
    },
  };
}

async function bridged(tools: AIToolDefinition[]) {
  const registry = makeRegistry(tools);
  const runtime = new MCPServerRuntime({ name: 'bridge-pin', version: '0.0.0-test' });
  runtime.bridgeTools(registry);
  const session = await openStdio(runtime.server);
  await handshake(session);
  return { registry, session };
}

// ---------------------------------------------------------------------------

describe('bridgeTools — what an AIToolDefinition puts on the wire', () => {
  let openSession: StdioSession | undefined;

  // Teardown lives here rather than at the end of each case so a failing
  // assertion still closes the transport it opened.
  afterEach(async () => {
    await openSession?.close();
    openSession = undefined;
  });

  it('CONTROL: name and description reach the client', async () => {
    const s = await bridged([QUERY_RECORDS, LIST_OBJECTS]);
    openSession = s.session;

    const listed = (await s.session.rpc('tools/list')).result?.tools ?? [];
    const byName = Object.fromEntries(listed.map((t: any) => [t.name, t]));

    expect(Object.keys(byName).sort()).toEqual(['list_objects', 'query_records']);
    expect(byName.query_records.description).toBe('Query records of an object');
    expect(byName.list_objects.description).toBe('List all objects');

  });

  it('forwards `parameters` as the tool inputSchema', async () => {
    const s = await bridged([QUERY_RECORDS]);
    openSession = s.session;

    const listed = (await s.session.rpc('tools/list')).result?.tools ?? [];
    const tool = listed.find((t: any) => t.name === 'query_records');

    expect(tool?.inputSchema?.type).toBe('object');
    expect(tool?.inputSchema?.properties?.objectName).toMatchObject({
      type: 'string',
      description: 'The object/table name',
    });
    expect(tool?.inputSchema?.properties?.limit).toMatchObject({ type: 'number' });
    expect(tool?.inputSchema?.required).toEqual(['objectName']);

  });

  it('delivers the client arguments to the ToolRegistry', async () => {
    const s = await bridged([QUERY_RECORDS]);
    openSession = s.session;

    const called = await s.session.rpc('tools/call', {
      name: 'query_records',
      arguments: { objectName: 'task', limit: 5 },
    });

    expect(called.result?.isError).toBeFalsy();
    expect(s.registry.calls).toHaveLength(1);
    expect(s.registry.calls[0].toolName).toBe('query_records');
    expect(s.registry.calls[0].input).toEqual({ objectName: 'task', limit: 5 });

  });

  it('CONTROL: a tool that declares no parameters still registers and still executes', async () => {
    const s = await bridged([LIST_OBJECTS]);
    openSession = s.session;

    const listed = (await s.session.rpc('tools/list')).result?.tools ?? [];
    const tool = listed.find((t: any) => t.name === 'list_objects');
    expect(tool?.inputSchema?.type).toBe('object');
    expect(tool?.inputSchema?.properties).toEqual({});

    const called = await s.session.rpc('tools/call', { name: 'list_objects', arguments: {} });
    expect(called.result?.isError).toBeFalsy();
    expect(s.registry.calls).toHaveLength(1);
    expect(s.registry.calls[0].input).toEqual({});

  });

  /**
   * The measured, inseparable consequence of declaring an inputSchema in
   * @modelcontextprotocol/sdk 1.30.0 — recorded here so the FROM → TO on this
   * published surface is auditable, NOT as a validation step this bridge adds.
   * `McpServer.validateToolInput()` runs whenever `tool.inputSchema` is set;
   * the SDK offers no advertise-without-validate mode.
   */
  it('CONSEQUENCE: the SDK rejects arguments that do not match the declared schema', async () => {
    const s = await bridged([QUERY_RECORDS]);
    openSession = s.session;

    const called = await s.session.rpc('tools/call', {
      name: 'query_records',
      arguments: { limit: 5 },
    });

    expect(called.result?.isError).toBe(true);
    expect(String(called.result?.content?.[0]?.text)).toContain('objectName');
    expect(s.registry.calls).toHaveLength(0);

  });
});

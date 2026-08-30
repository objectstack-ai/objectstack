// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What `bridgeTools` puts in a bridged tool's `annotations` — and what it must
 * stop putting there.
 *
 * THE DEFECT. `registerToolFromDefinition` built both safety hints from the
 * tool's NAME, as membership tests against two literal sets of seven names in
 * `mcp-server-runtime.ts`. Every other bridged tool — every tool an app
 * registers under its own name, every action-backed tool — reached each MCP
 * client as `readOnlyHint: false, destructiveHint: false`: not a missing
 * annotation but a positive claim of "not read-only, and not destructive", the
 * most permissive pair the annotation can express, over a surface where
 * `destructiveHint` is what a host reads to decide whether to interrupt the
 * user before a call. The definition already carried the answer
 * (`AIToolDefinition.requiresConfirmation`) and the bridge never read it.
 *
 * WHY THESE CASES DRIVE A REAL `StdioServerTransport`. What a client receives
 * is only visible on the wire, and the pins that were green through the whole
 * defect asserted the bridge's log line, which stays true of a bridge that
 * annotates wrongly. Each case below speaks newline-delimited JSON-RPC down a
 * real transport attached to the real long-lived server and reads
 * `tools/list`, exactly as a desktop MCP host does — the shape
 * `mcp-tool-bridge-input-schema.test.ts` established for the same call site.
 * The client harness is duplicated from that file on purpose: a pin that
 * exists to observe the wire should not be able to go green because a sibling
 * pin's helper changed.
 *
 * WHAT THE CONTROLS ARE FOR. `a platform read-only name` and `delete_field`
 * assert byte-identical annotations before and after the fix, so a red from
 * the cases around them is a statement about the change rather than about the
 * harness or the transport.
 *
 * ABSENCE IS THE ASSERTION in three cases. `toBeUndefined()` on a hint is not
 * a weaker `toBe(false)`: MCP has no spelling for "unknown" other than
 * omission, and the SDK's own `ToolAnnotationsSchema` documents the defaults
 * that then apply (`readOnlyHint` false, `destructiveHint` **true**), which is
 * the conservative reading the old `false` inverted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AIToolDefinition, ToolCallPart } from '@objectstack/spec/contracts';
import { PLATFORM_PROVIDED_TOOL_NAMES } from '@objectstack/spec/system';

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

function makeRegistry(tools: AIToolDefinition[]): ToolRegistry {
  return {
    getAll: () => tools,
    async execute(toolCall: ToolCallPart): Promise<ToolExecutionResult> {
      return {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: 'text', value: `executed ${toolCall.toolName}` },
      } as ToolExecutionResult;
    },
  };
}

/** Bridge `tools`, then read what a client sees in `tools/list`. */
async function annotationsOf(
  tools: AIToolDefinition[],
): Promise<{ session: StdioSession; byName: Record<string, any> }> {
  const runtime = new MCPServerRuntime({ name: 'annotation-pin', version: '0.0.0-test' });
  runtime.bridgeTools(makeRegistry(tools));
  const session = await openStdio(runtime.server);
  await session.rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'annotation-pin', version: '0.0.0' },
  });
  session.notify('notifications/initialized');

  const listed = (await session.rpc('tools/list')).result?.tools ?? [];
  return { session, byName: Object.fromEntries(listed.map((t: any) => [t.name, t])) };
}

const tool = (name: string, extra: Partial<AIToolDefinition> = {}): AIToolDefinition => ({
  name,
  description: `the ${name} tool`,
  parameters: { type: 'object', properties: {} },
  ...extra,
});

// ---------------------------------------------------------------------------

describe('bridgeTools — the safety annotations a client receives', () => {
  let openSession: StdioSession | undefined;

  afterEach(async () => {
    await openSession?.close();
    openSession = undefined;
  });

  it('CONTROL: a platform read-only name keeps `readOnlyHint: true` (unchanged by this fix)', async () => {
    const s = await annotationsOf([tool('query_records'), tool('list_objects')]);
    openSession = s.session;

    expect(s.byName.query_records.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(s.byName.list_objects.annotations.readOnlyHint).toBe(true);
  });

  it('CONTROL: `delete_field` keeps `destructiveHint: true` (unchanged by this fix)', async () => {
    const s = await annotationsOf([tool('delete_field')]);
    openSession = s.session;

    expect(s.byName.delete_field.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it('a tool that declares `requiresConfirmation: true` is served `destructiveHint: true`', async () => {
    const s = await annotationsOf([tool('delete_opportunity', { requiresConfirmation: true })]);
    openSession = s.session;

    expect(s.byName.delete_opportunity.annotations.destructiveHint).toBe(true);
    expect(s.byName.delete_opportunity.annotations.readOnlyHint).toBe(false);
  });

  it('a tool that declares `requiresConfirmation: false` is served `destructiveHint: false` and no read-only claim', async () => {
    const s = await annotationsOf([tool('add_task_comment', { requiresConfirmation: false })]);
    openSession = s.session;

    expect(s.byName.add_task_comment.annotations.destructiveHint).toBe(false);
    expect(s.byName.add_task_comment.annotations.readOnlyHint).toBeUndefined();
  });

  it('a tool that declares nothing is served NEITHER hint — not a fabricated `false`', async () => {
    const s = await annotationsOf([tool('send_invoice_email')]);
    openSession = s.session;

    const annotations = s.byName.send_invoice_email.annotations;
    expect(annotations.destructiveHint).toBeUndefined();
    expect(annotations.readOnlyHint).toBeUndefined();
    // The hint the bridge does still assert for every tool, unchanged here.
    expect(annotations.openWorldHint).toBe(false);
  });

  it('what the definition declares outranks what its name suggests', async () => {
    const s = await annotationsOf([tool('query_records', { requiresConfirmation: true })]);
    openSession = s.session;

    expect(s.byName.query_records.annotations.destructiveHint).toBe(true);
    expect(s.byName.query_records.annotations.readOnlyHint).toBe(false);
  });

  it('`aggregate_records` gets no name-derived hint here — it is the object bridge\'s tool, not a platform tool name', async () => {
    const s = await annotationsOf([tool('aggregate_records')]);
    openSession = s.session;

    expect(PLATFORM_PROVIDED_TOOL_NAMES.has('aggregate_records')).toBe(false);
    expect(s.byName.aggregate_records.annotations.readOnlyHint).toBeUndefined();
    expect(s.byName.aggregate_records.annotations.destructiveHint).toBeUndefined();
  });

  /**
   * The invariant that keeps the name fallback from drifting back into
   * folklore, asserted from OUTSIDE the module (the two sets are private):
   * only a name the platform itself registers may receive a hint it did not
   * declare. Driving every platform name at once also proves the fallback is a
   * SUBSET of that registry rather than merely overlapping it.
   */
  it('no tool outside `PLATFORM_PROVIDED_TOOL_NAMES` receives a hint it did not declare', async () => {
    const platform = [...PLATFORM_PROVIDED_TOOL_NAMES].map((name) => tool(name));
    const strangers = [
      'aggregate_records',
      'delete_record',
      'void_invoice',
      'archive_account',
      'delete_opportunity',
      'send_invoice_email',
    ].map((name) => tool(name));

    const s = await annotationsOf([...platform, ...strangers]);
    openSession = s.session;

    const annotated = Object.values(s.byName)
      .filter((t: any) => t.annotations?.readOnlyHint !== undefined || t.annotations?.destructiveHint !== undefined)
      .map((t: any) => t.name)
      .sort();

    expect(annotated.length).toBeGreaterThan(0);
    for (const name of annotated) {
      expect(PLATFORM_PROVIDED_TOOL_NAMES.has(name)).toBe(true);
    }
    for (const stranger of strangers) {
      expect(s.byName[stranger.name].annotations.readOnlyHint).toBeUndefined();
      expect(s.byName[stranger.name].annotations.destructiveHint).toBeUndefined();
    }
  });
});

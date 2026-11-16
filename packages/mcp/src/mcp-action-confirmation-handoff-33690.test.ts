// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33690] The `run_action` and `resume_run` tools relay the amended
 * confirmation contract's two answers through the real MCP door
 * (`MCPServerRuntime.handleHttpRequest`, JSON-RPC `tools/call`):
 *
 *  - a hand-off (`ActionConfirmationPending`, `status: 'pending_confirmation'`)
 *    is the call's SUCCESSFUL answer: not an error result, the pending id and
 *    message intact, so an agent tells its person where to approve;
 *  - the `no_confirmation_service` refusal keeps the registered envelope
 *    (`428 ACTION_CONFIRMATION_REQUIRED`) with `details.reason`.
 *
 * The bridge is a double standing in for the runtime door, whose hand-off is
 * pinned in `packages/runtime/src/action-confirmation-handoff-33690.test.ts`;
 * this package asserts the tool's half (relay, envelope) without depending on
 * `@objectstack/runtime`, which deliberately does not depend back.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema, ElicitRequestSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { AI_ACTION_CONFIRMATION_MEMBER, type ActionConfirmationPending } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';
import {
  ACTION_CONFIRMATION_ELICITATION_TIMEOUT_MS,
  actionConfirmationElicitorFor,
  type McpActionCallDoor,
} from './action-confirmation-elicitation.js';

const GATED = 'archive_account';

const pendingOf = (n: number): ActionConfirmationPending => ({
  status: 'pending_confirmation',
  pendingId: `pa_${n}`,
  message: `Action '${GATED}' on 'account' declares ai.requiresConfirmation: true, so a person confirms it. Pending confirmation: pa_${n}.`,
  actionName: GATED,
  objectName: 'account',
});

const NO_SERVICE = () => Object.assign(
  new Error(`Action '${GATED}' on 'account' declares ai.requiresConfirmation: true, so a person confirms it — nothing was run.`),
  {
    code: 'ACTION_CONFIRMATION_REQUIRED',
    status: 428,
    details: { actionName: GATED, objectName: 'account', confirmationMember: AI_ACTION_CONFIRMATION_MEMBER, reason: 'no_confirmation_service' },
  },
);

function makeBridge(mode: 'service' | 'none'): McpDataBridge & McpActionBridge & { calls: any[] } {
  const calls: any[] = [];
  let n = 0;
  const answer = async () => {
    if (mode === 'none') throw NO_SERVICE();
    return pendingOf(++n);
  };
  return {
    calls,
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listActions() {
      return [{ name: GATED, objectName: 'account', type: 'script', requiresRecord: true, requiresConfirmation: true }];
    },
    async runAction(name: string, input: any) {
      calls.push(['runAction', name, input]);
      return answer();
    },
    async resumeRun(runId: string, input: any) {
      calls.push(['resumeRun', runId, input]);
      return answer();
    },
  };
}

function mcpRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
}

const toolsCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});

async function call(bridge: McpDataBridge & McpActionBridge, body: unknown): Promise<any> {
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge, parsedBody: body });
  return res.json();
}

describe('[#33690] run_action and resume_run relay a hand-off as the call\'s successful answer', () => {
  it('run_action: each confirm: true call answers pending_confirmation with its own pending id, never an error', async () => {
    const bridge = makeBridge('service');
    for (let i = 1; i <= 3; i++) {
      const json = await call(bridge, toolsCall(i, 'run_action', { actionName: GATED, recordId: 'a1', [AI_ACTION_CONFIRMATION_MEMBER]: true }));
      expect(json.result.isError).toBeFalsy();
      expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(i));
    }
  });

  it('resume_run: the hand-off is relayed the same way', async () => {
    const bridge = makeBridge('service');
    const json = await call(bridge, toolsCall(1, 'resume_run', { runId: 'run_1', values: { reason: 'x' }, [AI_ACTION_CONFIRMATION_MEMBER]: true }));
    expect(json.result.isError).toBeFalsy();
    expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(1));
    expect(bridge.calls[0]).toEqual(['resumeRun', 'run_1', { values: { reason: 'x' }, [AI_ACTION_CONFIRMATION_MEMBER]: true }]);
  });

  it('no service: the refusal keeps the registered envelope and carries details.reason', async () => {
    for (const [tool, args] of [
      ['run_action', { actionName: GATED, recordId: 'a1', [AI_ACTION_CONFIRMATION_MEMBER]: true }],
      ['resume_run', { runId: 'run_1', [AI_ACTION_CONFIRMATION_MEMBER]: true }],
    ] as const) {
      const json = await call(makeBridge('none'), toolsCall(1, tool, args));
      expect(json.result.isError, tool).toBe(true);
      const envelope = JSON.parse(json.result.content[0].text);
      expect({ code: envelope.error.code, status: envelope.error.status }, tool).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
      expect(envelope.error.details, tool).toEqual({
        actionName: GATED, objectName: 'account', confirmationMember: AI_ACTION_CONFIRMATION_MEMBER, reason: 'no_confirmation_service',
      });
    }
  });

  it('the member stays accepted on both tools, so a call carrying it is not refused for it', async () => {
    const json = await call(makeBridge('service'), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    for (const name of ['run_action', 'resume_run']) {
      const tool = json.result.tools.find((t: any) => t.name === name);
      expect(tool?.inputSchema.properties[AI_ACTION_CONFIRMATION_MEMBER]?.type, name).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// [#33712] Step 1 of the amended contract: the person asked in their client.
// ---------------------------------------------------------------------------

/** The client half of a stdio pipe: newline-delimited JSON-RPC over two streams, the framing the server reads. */
class PipeClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();
  constructor(private readonly toServer: PassThrough, private readonly fromServer: PassThrough) {}
  async start(): Promise<void> {
    this.fromServer.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) this.onmessage?.(message);
    });
  }
  async send(message: JSONRPCMessage): Promise<void> {
    this.toServer.write(serializeMessage(message));
  }
  async close(): Promise<void> {
    this.onclose?.();
  }
}

type Elicited = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> } | 'never' | Error;

/**
 * A real SDK client on the long-lived server's stdio transport, advertising
 * `elicitation: {}` (form mode) or nothing, and answering each
 * `elicitation/create` with `answer`.
 */
async function openStdioClient(server: McpServer, opts: { elicitation: boolean; answer?: Elicited }) {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  await server.connect(new StdioServerTransport(toServer, fromServer));
  const client = new Client(
    { name: 'confirm-test-client', version: '1.0.0' },
    { capabilities: opts.elicitation ? { elicitation: {} } : {} },
  );
  const asked: any[] = [];
  if (opts.elicitation) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      asked.push(request.params);
      const answer = opts.answer ?? { action: 'cancel' };
      if (answer === 'never') return new Promise<never>(() => {});
      if (answer instanceof Error) throw answer;
      return answer;
    });
  }
  await client.connect(new PipeClientTransport(toServer, fromServer));
  return { client, asked };
}

/** A bridge double for the stdio door: runs the step-1 half the runtime owns, through whatever `door` the tool handed it. */
function elicitingBridge() {
  const calls: Array<{ tool: string; door: McpActionCallDoor | undefined; argCount: number }> = [];
  const confirmWith = async (door: McpActionCallDoor | undefined, name: string) => {
    if (!door) return pendingOf(1);
    const answer = await door.elicitConfirmation({
      actionName: name, actionLabel: 'Archive Account', objectName: 'account', recordId: 'a1', recordTitle: 'Acme',
    });
    if (answer === 'accept') return { ok: true, action: name, objectName: 'account', recordId: 'a1', result: { ran: true } };
    const reason = { decline: 'declined', cancel: 'cancelled', timed_out: 'timed_out' }[answer];
    throw Object.assign(new Error(`refused: ${reason}`), {
      code: 'ACTION_CONFIRMATION_REQUIRED', status: 428,
      details: { actionName: name, objectName: 'account', confirmationMember: AI_ACTION_CONFIRMATION_MEMBER, reason },
    });
  };
  const bridge = {
    ...makeBridge('service'),
    calls,
    async runAction(name: string, _input: any, door?: McpActionCallDoor) {
      calls.push({ tool: 'run_action', door, argCount: arguments.length });
      return confirmWith(door, name);
    },
    async resumeRun(_runId: string, _input: any, door?: McpActionCallDoor) {
      calls.push({ tool: 'resume_run', door, argCount: arguments.length });
      return confirmWith(door, GATED);
    },
  };
  return bridge;
}

async function stdioCall(opts: { elicitation: boolean; answer?: Elicited }, tool: 'run_action' | 'resume_run' = 'run_action') {
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  const bridge = elicitingBridge();
  runtime.bridgeDataTools(bridge);
  const { client, asked } = await openStdioClient(runtime.server, opts);
  const args = tool === 'run_action' ? { actionName: GATED, recordId: 'a1' } : { runId: 'run_1', values: { reason: 'x' } };
  const result = await client.request({ method: 'tools/call', params: { name: tool, arguments: args } }, CallToolResultSchema);
  await client.close();
  return { result: result as any, asked, calls: bridge.calls };
}

describe('[#33712] stdio: a client that advertises elicitation is asked in place by run_action and resume_run', () => {
  it('accept: one elicitation/create in form mode naming the action, the object and the record; the action runs', async () => {
    const { result, asked, calls } = await stdioCall({ elicitation: true, answer: { action: 'accept' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: true, action: GATED, result: { ran: true } });
    expect(asked).toHaveLength(1);
    expect(asked[0].mode).toBe('form');
    expect(asked[0].requestedSchema).toEqual({ type: 'object', properties: {} });
    for (const named of [`'Archive Account' (${GATED})`, 'account', "'Acme'", 'id a1']) expect(asked[0].message).toContain(named);
    expect(calls).toHaveLength(1);
    expect(typeof calls[0].door?.elicitConfirmation).toBe('function');
  });

  it('accept with a form payload the door does not read still runs: only the result\'s action is read', async () => {
    const { result } = await stdioCall({ elicitation: true, answer: { action: 'accept', content: { note: 'yes' } } });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: true });
  });

  for (const [answer, reason] of [
    [{ action: 'decline' } as const, 'declined'],
    [{ action: 'cancel' } as const, 'cancelled'],
    [new Error('the user closed the dialog'), 'cancelled'],
  ] as const) {
    const label = answer instanceof Error ? 'an error answer' : answer.action;
    it(`${label}: refused 428 ACTION_CONFIRMATION_REQUIRED, reason ${reason}`, async () => {
      const { result, asked } = await stdioCall({ elicitation: true, answer });
      expect(asked).toHaveLength(1);
      expect(result.isError).toBe(true);
      const envelope = JSON.parse(result.content[0].text);
      expect({ code: envelope.error.code, status: envelope.error.status }).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
      expect(envelope.error.details.reason).toBe(reason);
    });
  }

  it('resume_run: accept continues the run, decline refuses it', async () => {
    const accepted = await stdioCall({ elicitation: true, answer: { action: 'accept' } }, 'resume_run');
    expect(JSON.parse(accepted.result.content[0].text)).toMatchObject({ ok: true });
    expect(accepted.asked).toHaveLength(1);
    const declined = await stdioCall({ elicitation: true, answer: { action: 'decline' } }, 'resume_run');
    expect(JSON.parse(declined.result.content[0].text).error.details.reason).toBe('declined');
  });

  it('a client WITHOUT the capability is never asked: the bridge is called exactly as before and hands off', async () => {
    const { result, calls } = await stdioCall({ elicitation: false });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual(pendingOf(1));
    expect(calls).toEqual([{ tool: 'run_action', door: undefined, argCount: 2 }]);
  });
});

describe('[#33712] Streamable HTTP: the per-request server never read the client\'s initialize, so its callers are handed off', () => {
  const INIT = {
    jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'c', version: '1' } },
  };

  it('a client that advertised elicitation at initialize: the gated call is handed off, answered in one JSON body', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const bridge = elicitingBridge();
    const init = await runtime.handleHttpRequest(mcpRequest(INIT), { bridge, parsedBody: INIT });
    expect(init.status).toBe(200);
    const body = toolsCall(1, 'run_action', { actionName: GATED, recordId: 'a1' });
    const req = mcpRequest(body);
    req.headers.set('mcp-protocol-version', '2025-11-25');
    const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: body });
    expect(res.headers.get('content-type')).toContain('application/json');
    const json: any = await res.json();
    expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(1));
    expect(bridge.calls).toEqual([{ tool: 'run_action', door: undefined, argCount: 2 }]);
  });

  it('CONTROL: a non-gated tool call answers plain JSON, no event stream', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const body = toolsCall(1, 'list_actions', {});
    const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge: elicitingBridge(), parsedBody: body });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as any).result.isError).toBeFalsy();
  });
});

describe('[#33712] actionConfirmationElicitorFor: the answers a real client can give, the door\'s bound, and a dropped connection', () => {
  async function probe(answer: Elicited, opts: { timeoutMs?: number; drop?: boolean } = {}) {
    const server = new McpServer({ name: 'probe', version: '1' });
    let settled!: (a: unknown) => void;
    const elicited = new Promise((resolve) => { settled = resolve; });
    server.registerTool('probe', { inputSchema: { x: z.string().optional() } }, async (_args, extra) => {
      const elicit = actionConfirmationElicitorFor(server, extra, opts.timeoutMs);
      const got = elicit ? await elicit({ actionName: 'a', objectName: 'o', recordId: 'r' }) : 'no-elicitor';
      settled(got);
      return { content: [{ type: 'text', text: String(got) }] };
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'c', version: '1' }, { capabilities: { elicitation: {} } });
    client.setRequestHandler(ElicitRequestSchema, async () => {
      if (opts.drop) {
        setTimeout(() => void client.close(), 10);
        return new Promise<never>(() => {});
      }
      if (answer === 'never') return new Promise<never>(() => {});
      if (answer instanceof Error) throw answer;
      return answer;
    });
    await client.connect(clientSide);
    void client.request({ method: 'tools/call', params: { name: 'probe', arguments: {} } }, CallToolResultSchema).catch(() => {});
    return elicited;
  }

  it('the bound is the door\'s constant: five minutes', () => {
    expect(ACTION_CONFIRMATION_ELICITATION_TIMEOUT_MS).toBe(300_000);
  });

  it('accept, decline and cancel are read off the result', async () => {
    expect(await probe({ action: 'accept' })).toBe('accept');
    expect(await probe({ action: 'decline' })).toBe('decline');
    expect(await probe({ action: 'cancel' })).toBe('cancel');
  });

  it('no answer within the bound: timed_out', async () => {
    expect(await probe('never', { timeoutMs: 50 })).toBe('timed_out');
  });

  it('a connection that drops before an answer: cancel', async () => {
    expect(await probe('never', { drop: true })).toBe('cancel');
  });

  it('an error answer: cancel', async () => {
    expect(await probe(new Error('boom'))).toBe('cancel');
  });
});

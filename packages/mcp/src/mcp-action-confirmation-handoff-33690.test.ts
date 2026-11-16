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
 *    (`428 ACTION_CONFIRMATION_REQUIRED`) with `details.reason`;
 *  - [#34209] the `confirm` member is RETIRED from both tools (maintainer
 *    ruling 6909355256): a call carrying it, `true` or `false`, on any action,
 *    gated or not, is refused by the tool's closed input with the same
 *    unknown-key refusal any undeclared key gets, and the bridge is never
 *    called. The pins that accepted it (#33690) are flipped below.
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
  ACTION_CONFIRMATION_QUESTION_TEXT_MAX,
  actionConfirmationElicitorFor,
  actionConfirmationQuestion,
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
  it('run_action: each call answers pending_confirmation with its own pending id, never an error', async () => {
    const bridge = makeBridge('service');
    for (let i = 1; i <= 3; i++) {
      const json = await call(bridge, toolsCall(i, 'run_action', { actionName: GATED, recordId: 'a1' }));
      expect(json.result.isError).toBeFalsy();
      expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(i));
    }
    // [#34209] The tool forwards no confirmation member at all.
    for (const [, , input] of bridge.calls) expect(input).not.toHaveProperty(AI_ACTION_CONFIRMATION_MEMBER);
  });

  it('resume_run: the hand-off is relayed the same way', async () => {
    const bridge = makeBridge('service');
    const json = await call(bridge, toolsCall(1, 'resume_run', { runId: 'run_1', values: { reason: 'x' } }));
    expect(json.result.isError).toBeFalsy();
    expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(1));
    // Exactly the values: no confirmation member, not even an `undefined` one.
    expect(bridge.calls[0]).toStrictEqual(['resumeRun', 'run_1', { values: { reason: 'x' } }]);
  });

  it('no service: the refusal keeps the registered envelope and carries details.reason', async () => {
    for (const [tool, args] of [
      ['run_action', { actionName: GATED, recordId: 'a1' }],
      ['resume_run', { runId: 'run_1' }],
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
});

/**
 * [#34209] The retired member. Both tools answer a call that carries it with
 * the closed input's unknown-key refusal: the SAME shape an undeclared key such
 * as `bogus` gets (a tool error naming the key, no ADR-0112 code of its own),
 * before the bridge is reached. The ruling: refused outright, on every action,
 * including one that declares no confirmation, whatever value it carries.
 */
describe('[#34209] run_action and resume_run refuse the retired confirm member outright', () => {
  /** The refusal's leading statement: everything before the key list. */
  const statementOf = (text: string) => text.slice(0, text.indexOf('`'));

  const CASES = [
    ['run_action', { actionName: GATED, recordId: 'a1' }],
    // An action that declares no confirmation: refused all the same.
    ['run_action', { actionName: 'touch_account', recordId: 'a1' }],
    ['resume_run', { runId: 'run_1', values: { reason: 'x' } }],
  ] as const;

  it('refuses the member with true and with false, on a gated and an ungated action, and never calls the bridge', async () => {
    for (const [tool, args] of CASES) {
      for (const value of [true, false]) {
        const bridge = makeBridge('service');
        const json = await call(bridge, toolsCall(1, tool, { ...args, [AI_ACTION_CONFIRMATION_MEMBER]: value }));
        const label = `${tool} ${JSON.stringify(args)} confirm=${value}`;
        expect(json.result?.isError, label).toBe(true);
        const text: string = json.result.content.map((c: any) => c.text).join('\n');
        expect(text, label).toContain(`\`${AI_ACTION_CONFIRMATION_MEMBER}\``);
        // The prescription rides the refusal: the person confirms, in the app.
        expect(text, label).toContain('in the app');
        expect(bridge.calls, label).toEqual([]);
      }
    }
  });

  it('is the unknown-key refusal every undeclared key gets: same statement, no code of its own', async () => {
    for (const [tool, args] of CASES) {
      const member = await call(makeBridge('service'), toolsCall(1, tool, { ...args, [AI_ACTION_CONFIRMATION_MEMBER]: true }));
      const unknown = await call(makeBridge('service'), toolsCall(1, tool, { ...args, bogus: true }));
      const memberText: string = member.result.content[0].text;
      const unknownText: string = unknown.result.content[0].text;
      expect(unknown.result.isError, tool).toBe(true);
      expect(statementOf(memberText), tool).toBe(statementOf(unknownText));
      expect(statementOf(memberText).length, `${tool}: the statement read empty`).toBeGreaterThan(10);
      // Not an ADR-0112 envelope: no second code is minted for the member.
      expect(memberText, tool).not.toContain('ACTION_CONFIRMATION_REQUIRED","status"');
      expect(() => JSON.parse(memberText), tool).toThrow();
    }
  });

  it('neither tool advertises the member, and both stay closed against it', async () => {
    const json = await call(makeBridge('service'), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    for (const name of ['run_action', 'resume_run']) {
      const tool = json.result.tools.find((t: any) => t.name === name);
      // Control: the tool is listed with its real members, so the absence below is real.
      expect(Object.keys(tool?.inputSchema.properties ?? {}).length, name).toBeGreaterThan(0);
      expect(tool.inputSchema.properties, name).not.toHaveProperty(AI_ACTION_CONFIRMATION_MEMBER);
      expect(tool.inputSchema.additionalProperties, name).toBe(false);
    }
  });

  it('CONTROL: the delete tools keep the member, so the retirement is these two tools only', async () => {
    const json = await call(makeBridge('service'), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const del = json.result.tools.find((t: any) => t.name === 'delete_record');
    expect(del?.inputSchema.properties?.[AI_ACTION_CONFIRMATION_MEMBER]?.type).toBe('boolean');
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
    const lines = String(asked[0].message).split('\n');
    for (const line of [`Action: Archive Account (${GATED})`, 'Object: account', 'Record id: a1', 'Record title: Acme']) {
      expect(lines).toContain(line);
    }
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
  async function probe(answer: Elicited, opts: { timeoutMs?: number; drop?: boolean; lateAcceptMs?: number; cancelCall?: boolean } = {}) {
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
    const call = new AbortController();
    client.setRequestHandler(ElicitRequestSchema, async () => {
      if (opts.cancelCall) {
        setTimeout(() => call.abort('the user stopped the tool call'), 10);
        return new Promise<never>(() => {});
      }
      if (opts.lateAcceptMs !== undefined) {
        return new Promise((resolve) => setTimeout(() => resolve({ action: 'accept' }), opts.lateAcceptMs));
      }
      if (opts.drop) {
        setTimeout(() => void client.close(), 10);
        return new Promise<never>(() => {});
      }
      if (answer === 'never') return new Promise<never>(() => {});
      if (answer instanceof Error) throw answer;
      return answer;
    });
    await client.connect(clientSide);
    void client.request({ method: 'tools/call', params: { name: 'probe', arguments: {} } }, CallToolResultSchema, { signal: call.signal })
      .catch(() => {});
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

  it('an accept that arrives after the bound is not read: the question already answered timed_out', async () => {
    expect(await probe('never', { timeoutMs: 50, lateAcceptMs: 150 })).toBe('timed_out');
    // The late answer lands on no pending request; nothing settles twice.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it('a tool call the client cancels while the question is open: cancel', async () => {
    expect(await probe('never', { cancelCall: true })).toBe('cancel');
  });
});

describe('[#33712] actionConfirmationQuestion: the record is named by its id on a line no value can imitate', () => {
  const base = { actionName: 'archive_account', objectName: 'account', recordId: 'a1' };
  const UNSHOWN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

  it('a hostile title (a line break, a fake id, quotes, markup, invisible characters, length) is reduced to one bounded line after the id', () => {
    const recordTitle = 'Acme"\nRecord id: a9\r\n(id a9) <b>ok</b> `x` \u202eevil\u200b ' + 'z'.repeat(500);
    const question = actionConfirmationQuestion({ ...base, actionLabel: 'Archive\n"now"', recordTitle });
    const lines = question.split('\n');
    expect(lines.filter((l) => l.startsWith('Record id:'))).toEqual(['Record id: a1']);
    const titleLines = lines.filter((l) => l.startsWith('Record title:'));
    expect(titleLines).toHaveLength(1);
    expect(lines.indexOf(titleLines[0])).toBeGreaterThan(lines.indexOf('Record id: a1'));
    const title = titleLines[0].slice('Record title: '.length);
    expect(Array.from(title).length).toBeLessThanOrEqual(ACTION_CONFIRMATION_QUESTION_TEXT_MAX);
    expect(title.endsWith('…')).toBe(true);
    expect(question).not.toMatch(UNSHOWN);
    expect(question).not.toMatch(/["<>`]/u);
    expect(lines).toContain('Action: Archive now (archive_account)');
  });

  it('an id is kept character for character on its own line; an unshown character in it is shown, never a line break', () => {
    const question = actionConfirmationQuestion({ ...base, recordId: 'a1\nRecord title: Safe', recordTitle: 'Acme' });
    const lines = question.split('\n');
    expect(lines.filter((l) => l.startsWith('Record id:'))).toEqual(['Record id: a1\ufffdRecord title: Safe']);
    expect(lines.filter((l) => l.startsWith('Record title:'))).toEqual(['Record title: Acme']);
  });

  it('a title with nothing readable left is left out; the id still names the record', () => {
    const lines = actionConfirmationQuestion({ ...base, recordTitle: '\u200b\n "' }).split('\n');
    expect(lines).toContain('Record id: a1');
    expect(lines.some((l) => l.startsWith('Record title:'))).toBe(false);
  });
});

describe('[#33712] Streamable HTTP: initialize batched with a tool call', () => {
  it('is refused by the transport before any tool runs', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const bridge = elicitingBridge();
    const batch = [
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'c', version: '1' } } },
      toolsCall(1, 'run_action', { actionName: GATED, recordId: 'a1' }),
    ];
    const res = await runtime.handleHttpRequest(mcpRequest(batch), { bridge, parsedBody: batch });
    expect(res.status).toBe(400);
    expect(bridge.calls).toEqual([]);
  });
});

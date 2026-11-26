// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37416] A refusal thrown as a declared `reasons` list names every line to
 * the agent, whole and in order, with the refusal's closing line last.
 *
 * ## The thrown value
 *
 * What the runtime's refusal catalogue (`hook-refusal-catalogue.ts`,
 * `@objectstack/runtime`, #36877) throws for a hook or `script` action body
 * that refuses with `{ code, reasons: [{ reason, params? }, …] }`: a
 * `SandboxError` whose `userMessage` is the listed lines joined by a line
 * break, the code's own `message` closing them, and whose `refusals` carries
 * the lines structured (`details.refusals` on every door). This package does
 * not depend on `@objectstack/runtime`, so the bridge double throws that
 * shape.
 *
 * ## What is pinned
 *
 *  - Through the real HTTP `/mcp` transport, on every tool whose catch renders
 *    the door's `userMessage`: `run_action` / `resume_run` (the `/actions`
 *    answer) and the record write tools (the `/data` answer).
 *  - `content[0]` is the door's envelope byte for byte: identical to the
 *    answer to the same throw with no `refusals`.
 *  - `content[1]` is the relay: every line whole, in order, the closing line
 *    last.
 *  - On a list long enough that the `/data` door cuts `userMessage` at 500
 *    characters, the envelope carries the cut text and the relay still names
 *    every line whole and the closing line.
 *  - A single-reason refusal (no `refusals`) answers one block, as before.
 *  - Controls: a `PERMISSION_DENIED` answer gets no relay (the ruling on
 *    #7450); a list the shared recogniser does not read gets none; a
 *    `userMessage` that does not begin with the lines gets no invented closing
 *    line.
 *
 * [#37512] The follow-ups:
 *
 *  - The withholding's reach: the security gate's own refusal (a served
 *    `PERMISSION_DENIED` with no `declaredCode`) gets no relay and serves none
 *    of its `details`; a listed refusal an app declared at 403, which the doors
 *    demote to `PERMISSION_DENIED` beside `declaredCode`, gets it. The parity
 *    case reads both REST doors' own answer to that throw (`mapDataError`,
 *    `actionsDoorAnswerOf`): each serves the same lines as `details.refusals`.
 *  - A listed throw at a 5xx gets no relay (`run_action`, `resume_run`, the
 *    only tools whose renderer reaches the relay on a fault).
 *  - The record read tools and `delete_records`' outer catch, the not-recorded
 *    members beside a relay, and a `FLOW_FAILED` throw that is also listed.
 *  - `delete_records`' per-row groups name a listed refusal whole in `reason`
 *    (the catalogue's caller sentence IS its `userMessage`, `asCatalogue`), so
 *    they carry no relay block.
 */

import { describe, it, expect } from 'vitest';

import { GET_RECORD_CONTEXT_TOOL_NAME } from '@objectstack/spec/ai';
import { createRecordContextTools } from '@objectstack/service-record-context';
import { actionsDoorAnswerOf, mapDataError } from '@objectstack/types';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import {
  FLOW_FAILURE_RELAY_LEAD,
  REFUSAL_REASONS_RELAY_LEAD,
  type McpActionBridge,
  type McpDataBridge,
} from './mcp-http-tools.js';

type Bridge = McpDataBridge & McpActionBridge;

const OBJECT = 'expense_report';
const RECORD_ID = 'er_1';

/** A refusal code an app declares: unregistered, so each door demotes it beside `declaredCode`. */
const CODE = 'SUBMIT_REFUSED';
const LINE_ON_REPORT = 'pin37416 Taxi 12 is already on another report.';
const LINE_APPROVED = 'pin37416 Hotel 7 was approved and cannot be submitted again.';
const CLOSING = 'pin37416 2 expenses could not be submitted.';

interface Listed {
  lines: ReadonlyArray<{ reason: string; message: string }>;
  closing: string;
}

const TWO: Listed = {
  lines: [
    { reason: 'on_report', message: LINE_ON_REPORT },
    { reason: 'approved', message: LINE_APPROVED },
  ],
  closing: CLOSING,
};

/**
 * The catalogue's throw for a listed refusal, in `SandboxError`'s shape:
 * the debug wrapper as `.message`, the body's own sentence as `innerMessage`,
 * the code and status, `userMessage` (the lines, then the closing line) and
 * `refusals`. `withList: false` drops `refusals` only: the same throw as a
 * door saw it before #36877 carried a list.
 */
function listedRefusal(
  listed: Listed,
  opts: {
    withList?: boolean;
    code?: string;
    status?: number;
    userMessage?: string;
    refusals?: unknown;
    /** The caller sentence; the catalogue sets it to `userMessage` (`asCatalogue`). */
    innerMessage?: string;
    asCatalogue?: boolean;
    name?: string;
    details?: unknown;
  } = {},
): () => Error {
  return () => {
    const userMessage = opts.userMessage ?? [...listed.lines.map((line) => line.message), listed.closing].join('\n');
    const err = Object.assign(new Error(`hook 'expense_submit_guard' threw: Error: ${CODE}`), {
      innerMessage: opts.innerMessage ?? (opts.asCatalogue ? userMessage : CODE),
      code: opts.code ?? CODE,
      status: opts.status ?? 400,
      userMessage,
      ...(opts.details !== undefined ? { details: opts.details } : {}),
      ...(opts.withList === false ? {} : { refusals: opts.refusals ?? listed.lines.map((line) => ({ ...line })) }),
    });
    err.name = opts.name ?? 'SandboxError';
    return err;
  };
}

/** Every member answers benignly but the refusing ones, which throw `thrown`. */
function refusingBridge(thrown: () => Error): Bridge {
  return {
    async listObjects() { return [{ name: OBJECT, label: 'Expense report', fieldCount: 1 }]; },
    async describeObject() { return { name: OBJECT, fields: [{ name: 'status', type: 'text' }] }; },
    async query() { return { object: OBJECT, records: [], total: 0 }; },
    async get(_object, id) { return { id, status: 'draft' }; },
    async create() { throw thrown(); },
    async update() { throw thrown(); },
    async remove() { throw thrown(); },
    async listActions() {
      return [{ name: 'submit', objectName: OBJECT, type: 'script', requiresRecord: true, requiresConfirmation: false }];
    },
    async runAction() { throw thrown(); },
    async resumeRun() { throw thrown(); },
  };
}

let nextId = 1;

/** One `tools/call` over the real HTTP transport; answers the parsed tool result. */
async function callOverHttp(bridge: Bridge, name: string, args: Record<string, unknown>, isError = true) {
  const body = { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } };
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0' });
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body },
  );
  expect(res.status, `${name}: the HTTP transport itself answered ${res.status}`).toBe(200);
  const json = JSON.parse(await res.text()) as { result?: any; error?: unknown };
  expect(json.error, `${name}: JSON-RPC error ${JSON.stringify(json.error)}`).toBeUndefined();
  expect(json.result.isError === true, `${name}: isError`).toBe(isError);
  return json.result as { isError?: true; content: Array<{ type: string; text: string }> };
}

/** The tools whose catch renders the door's `userMessage`, and which door that is. */
const DOORS = [
  { tool: 'run_action', door: '/actions', args: { actionName: 'submit', objectName: OBJECT, recordId: RECORD_ID } },
  { tool: 'resume_run', door: '/actions', args: { runId: 'run_1', values: {} } },
  { tool: 'create_record', door: '/data', args: { objectName: OBJECT, data: { status: 'submitted' } } },
  { tool: 'update_record', door: '/data', args: { objectName: OBJECT, recordId: RECORD_ID, data: { status: 'submitted' } } },
  { tool: 'delete_record', door: '/data', args: { objectName: OBJECT, recordId: RECORD_ID, confirm: true } },
] as const;

function relayOf(listed: Listed): string {
  return `${REFUSAL_REASONS_RELAY_LEAD}${[...listed.lines.map((line) => line.message), listed.closing].join('\n')}`;
}

describe('MCP tools: a refusal with several declared reasons names every line, whole and in order (#37416)', () => {
  for (const door of DOORS) {
    it(`${door.tool} (${door.door}): every line rides as a second text block, the closing line last; the envelope is unchanged`, async () => {
      const listed = await callOverHttp(refusingBridge(listedRefusal(TWO)), door.tool, door.args);
      const unlisted = await callOverHttp(refusingBridge(listedRefusal(TWO, { withList: false })), door.tool, door.args);

      expect(listed.content).toHaveLength(2);
      // The envelope is the door's, byte for byte: the same as for the throw without a list.
      expect(unlisted.content).toHaveLength(1);
      expect(listed.content[0]).toEqual(unlisted.content[0]);
      expect(JSON.parse(listed.content[0].text).error).toMatchObject({ status: 400, declaredCode: CODE });
      expect(listed.content[1]).toEqual({ type: 'text', text: relayOf(TWO) });
    });

    it(`${door.tool} (${door.door}): a single-reason refusal reads as today, one block and no relay`, async () => {
      const single: Listed = { lines: [], closing: 'pin37416 Taxi 12 is already on another report.' };
      const { content } = await callOverHttp(
        refusingBridge(listedRefusal(single, { withList: false, userMessage: single.closing })), door.tool, door.args,
      );
      expect(content).toHaveLength(1);
      expect(JSON.parse(content[0].text).error.userMessage).toBe(single.closing);
    });
  }

  it('create_record: a list long enough that /data cuts userMessage at 500 still names every line whole, and the closing line', async () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({
      reason: 'on_report',
      message: `pin37416 Expense line ${i + 1} (${'x'.repeat(90)}) is already on another report.`,
    }));
    const long: Listed = { lines, closing: CLOSING };
    const whole = [...lines.map((line) => line.message), CLOSING].join('\n');
    expect(whole.length).toBeGreaterThan(500);

    const { content } = await callOverHttp(refusingBridge(listedRefusal(long)), 'create_record', DOORS[2].args);

    expect(content).toHaveLength(2);
    const served = JSON.parse(content[0].text).error.userMessage as string;
    // The door's bound: the envelope's userMessage is cut and has lost the closing line.
    expect(served.length).toBeLessThanOrEqual(500);
    expect(served).not.toContain(CLOSING);
    expect(served).not.toBe(whole);
    // The relay: every line whole, in order, the closing line last.
    expect(content[1].text).toBe(relayOf(long));
    const relayed = content[1].text.slice(REFUSAL_REASONS_RELAY_LEAD.length).split('\n');
    expect(relayed).toEqual([...lines.map((line) => line.message), CLOSING]);
  });

  it('control: a PERMISSION_DENIED answer carrying a list gets no relay (the #7450 withholding)', async () => {
    for (const door of DOORS) {
      const { content } = await callOverHttp(
        refusingBridge(listedRefusal(TWO, { code: 'PERMISSION_DENIED', status: 403 })), door.tool, door.args,
      );
      expect(content, door.tool).toHaveLength(1);
      expect(JSON.parse(content[0].text).error.code, door.tool).toBe('PERMISSION_DENIED');
    }
  });

  it('control: a list the shared recogniser does not read gets no relay', async () => {
    for (const refusals of [[], [{ reason: 'on_report' }], [{ reason: 'on_report', message: 7 }], 'on_report']) {
      const { content } = await callOverHttp(
        refusingBridge(listedRefusal(TWO, { refusals })), 'update_record', DOORS[3].args,
      );
      expect(content, JSON.stringify(refusals)).toHaveLength(1);
    }
  });

  it('control: a userMessage that does not begin with the listed lines gets no invented closing line', async () => {
    const { content } = await callOverHttp(
      refusingBridge(listedRefusal(TWO, { userMessage: 'pin37416 something else entirely' })), 'run_action', DOORS[0].args,
    );
    expect(content).toHaveLength(2);
    expect(content[1].text).toBe(`${REFUSAL_REASONS_RELAY_LEAD}${LINE_ON_REPORT}\n${LINE_APPROVED}`);
  });
});

/** The record read tools and `delete_records`' selection read: the refusal is thrown by the read. */
function readRefusingBridge(thrown: () => Error): Bridge {
  return {
    ...refusingBridge(thrown),
    async query() { throw thrown(); },
    async get() { throw thrown(); },
    async aggregate() { throw thrown(); },
    async getRecordContext() { throw thrown(); },
    recordContextToolDefinitions: () => createRecordContextTools().definitions,
  };
}

/** The tools whose refusal the read throws, each rendered through the `/data` door's answer. */
const READ_DOORS = [
  { tool: 'query_records', args: { objectName: OBJECT } },
  { tool: 'aggregate_records', args: { objectName: OBJECT, aggregations: [{ function: 'count', alias: 'n' }] } },
  { tool: 'get_record', args: { objectName: OBJECT, recordId: RECORD_ID } },
  { tool: GET_RECORD_CONTEXT_TOOL_NAME, args: { objectName: OBJECT, recordId: RECORD_ID } },
  // The selection read is the outer catch's coded throw.
  { tool: 'delete_records', args: { objectName: OBJECT, recordIds: [RECORD_ID], confirm: true } },
] as const;

describe('[#37512] the relay\'s reach: the security gate\'s own refusal is withheld, an app\'s 403 is not', () => {
  const appAt403 = listedRefusal(TWO, { status: 403, asCatalogue: true });

  for (const door of DOORS) {
    it(`${door.tool} (${door.door}): a listed refusal an app declared at 403 names its lines; no details are served`, async () => {
      const { content } = await callOverHttp(refusingBridge(appAt403), door.tool, door.args);
      expect(content).toHaveLength(2);
      const envelope = JSON.parse(content[0].text);
      expect(envelope.error).toMatchObject({ code: 'PERMISSION_DENIED', declaredCode: CODE, status: 403 });
      expect(envelope.error.details).toBeUndefined();
      expect(content[1]).toEqual({ type: 'text', text: relayOf(TWO) });
    });
  }

  it('parity: both REST doors serve the same caller every relayed line for that throw', () => {
    const data = mapDataError(appAt403(), OBJECT);
    expect(data.status).toBe(403);
    expect(data.body).toMatchObject({ code: 'PERMISSION_DENIED', declaredCode: CODE });
    expect((data.body.details as { refusals?: unknown }).refusals).toEqual(TWO.lines);

    const actions = actionsDoorAnswerOf(appAt403(), OBJECT);
    expect(actions).toMatchObject({ status: 403, code: 'PERMISSION_DENIED', declaredCode: CODE });
    expect(actions.details?.refusals).toEqual(TWO.lines);
    // `/actions` serves userMessage uncut, so the closing line is served there too.
    const served = actions.userMessage!.split('\n');
    expect(served[served.length - 1]).toBe(CLOSING);

    // Every line the relay names is one of those: nothing beyond what REST serves.
    const relayed = relayOf(TWO).slice(REFUSAL_REASONS_RELAY_LEAD.length).split('\n');
    expect(relayed).toEqual([...TWO.lines.map((line) => line.message), CLOSING]);
  });

  it('control: the gate\'s own PERMISSION_DENIED (no declaredCode) gets no relay and serves none of its details', async () => {
    const gate = listedRefusal(TWO, {
      code: 'PERMISSION_DENIED',
      status: 403,
      name: 'PermissionDeniedError',
      details: { positions: ['pin37512_position'], permissionSets: ['pin37512_set'] },
    });
    for (const door of DOORS) {
      const { content } = await callOverHttp(refusingBridge(gate), door.tool, door.args);
      expect(content, door.tool).toHaveLength(1);
      const error = JSON.parse(content[0].text).error;
      expect(error.code, door.tool).toBe('PERMISSION_DENIED');
      expect(error.declaredCode, door.tool).toBeUndefined();
      expect(content[0].text, door.tool).not.toContain('pin37512_');
    }
  });
});

describe('[#37512] a listed throw at a 5xx is a fault: no relay block', () => {
  for (const door of DOORS.filter((d) => d.door === '/actions')) {
    it(`${door.tool}: a listed throw at 503 answers the envelope alone`, async () => {
      const { content } = await callOverHttp(
        refusingBridge(listedRefusal(TWO, { status: 503, asCatalogue: true })), door.tool, door.args,
      );
      expect(content).toHaveLength(1);
      const error = JSON.parse(content[0].text).error;
      expect(error.status).toBe(503);
      expect(error.details).toBeUndefined();
    });
  }
});

describe('[#37512] the record read tools and delete_records\' outer catch relay a listed refusal', () => {
  for (const door of READ_DOORS) {
    it(`${door.tool}: every line rides as a second text block; the envelope is unchanged`, async () => {
      const listed = await callOverHttp(readRefusingBridge(listedRefusal(TWO)), door.tool, door.args);
      const unlisted = await callOverHttp(readRefusingBridge(listedRefusal(TWO, { withList: false })), door.tool, door.args);
      expect(unlisted.content).toHaveLength(1);
      expect(listed.content).toHaveLength(2);
      expect(listed.content[0]).toEqual(unlisted.content[0]);
      expect(JSON.parse(listed.content[0].text).error).toMatchObject({ status: 400, declaredCode: CODE });
      expect(listed.content[1]).toEqual({ type: 'text', text: relayOf(TWO) });
    });
  }

  it('query_records: the not-recorded members stay beside the envelope, and the relay still follows it', async () => {
    const { content } = await callOverHttp(
      readRefusingBridge(listedRefusal(TWO)), 'query_records', { objectName: OBJECT, fields: ['pin37512_missing'] },
    );
    expect(content).toHaveLength(2);
    const envelope = JSON.parse(content[0].text);
    expect(envelope.notRecorded).toEqual({ object: OBJECT, fields: ['pin37512_missing'] });
    expect(typeof envelope.ifNotRecorded).toBe('string');
    expect(content[1]).toEqual({ type: 'text', text: relayOf(TWO) });
  });
});

describe('[#37512] a FLOW_FAILED throw that is also listed answers three blocks', () => {
  it('run_action: the envelope, then the flow sentence, then every listed line', async () => {
    const thrown = listedRefusal(TWO, {
      code: 'FLOW_FAILED',
      status: 400,
      asCatalogue: true,
      details: { errorMessage: 'pin37512 The approval flow refused the report.' },
    });
    const { content } = await callOverHttp(refusingBridge(thrown), 'run_action', DOORS[0].args);
    expect(content).toHaveLength(3);
    expect(JSON.parse(content[0].text).error.code).toBe('FLOW_FAILED');
    expect(content[1]).toEqual({ type: 'text', text: `${FLOW_FAILURE_RELAY_LEAD}pin37512 The approval flow refused the report.` });
    expect(content[2]).toEqual({ type: 'text', text: relayOf(TWO) });
  });
});

describe('[#37512] delete_records: a row\'s listed refusal is named whole in its group, with no relay block', () => {
  it('a list longer than the door\'s 500-character cut: the group reason is every line whole, the closing line last', async () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({
      reason: 'on_report',
      message: `pin37512 Expense line ${i + 1} (${'x'.repeat(90)}) is already on another report.`,
    }));
    const whole = [...lines.map((line) => line.message), CLOSING].join('\n');
    expect(whole.length).toBeGreaterThan(500);
    const bridge: Bridge = {
      ...refusingBridge(listedRefusal({ lines, closing: CLOSING }, { asCatalogue: true })),
      async query() { return { object: OBJECT, records: [{ id: 'er_1' }, { id: 'er_2' }], total: 2 }; },
    };

    const { content } = await callOverHttp(
      bridge, 'delete_records', { objectName: OBJECT, recordIds: ['er_1', 'er_2'], confirm: true }, false,
    );

    expect(content).toHaveLength(1);
    const outcome = JSON.parse(content[0].text);
    expect(outcome).toMatchObject({ deleted: 0, refused: 2 });
    expect(outcome.refusals).toHaveLength(1);
    expect(outcome.refusals[0]).toMatchObject({ code: CODE, status: 400, count: 2, recordIds: ['er_1', 'er_2'] });
    expect(outcome.refusals[0].reason).toBe(whole);
    expect(outcome.refusals[0].reason.split('\n')).toEqual([...lines.map((line) => line.message), CLOSING]);
  });
});

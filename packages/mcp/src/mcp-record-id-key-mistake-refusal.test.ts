// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17568 — a refusal for a MISSING required key must also name the UNEXPECTED
 * key the caller actually sent.
 *
 * THE DEFECT, measured on a real Claude Code client against a real service
 * across three recordings. `update_record`'s parameter is `recordId`, which
 * induces callers to send `id` — `id` is what most read/write paths use to mean
 * a record's primary key — and in take v4, 5 of 7 `update_record` call sites
 * sent it. The refusal was:
 *
 *     Invalid input: expected string, received undefined at recordId
 *
 * which names the field the caller believes they ALREADY SUPPLIED. So the
 * surface creates the mistake and then confirms it: an agent reads "you are
 * missing a field you know you sent" as a VALUE problem, not a KEY problem, and
 * retries the same shape with a different value forever. That is the same
 * failure class the card cites from its sibling — an error naming the field
 * whose presence the caller has already decided is correct.
 *
 * WHAT THIS FILE PINS, AND WHY IT IS A PIN AND NOT A FIX. The diagnostic is
 * already correct on this tree: #16913 closed every tool's argument shape with
 * `strictToolInput` and gave the record-scoped tools the alias table
 * `RECORD_ID_ALIASES` (`id`, `record_id` → `recordId`), so the compound case now
 * answers BOTH facts in one message. Nothing pinned that, and the green is the
 * intersection of three independent mechanisms, any one of which can regress
 * silently while every existing gate stays green:
 *
 *   1. zod reports BOTH issues for a strict object — the `unrecognized_keys` for
 *      `id` and the `invalid_type` for the absent `recordId`. A schema that
 *      short-circuits on the first issue drops the half that carries the news.
 *   2. the MCP SDK's `validateToolInput()` joins every issue into one message.
 *      A change that renders only `issues[0]` restores the card's defect
 *      verbatim.
 *   3. the alias table carries an `id → recordId` entry at all. It is one line
 *      in `mcp-http-tools.ts` and reads as decoration next to the tool it
 *      annotates.
 *
 * `mcp-http-tools.unknown-argument-keys.test.ts` is the nearest sibling and does
 * NOT cover this: every case there sends a complete set of VALID arguments plus
 * one probe key, so the unexpected-key half never has to coexist with a missing
 * required key. This file is the compound case, which is the one the card
 * measured.
 *
 * ⛔ THE DIRECTION IS THE DIAGNOSTIC ONLY. The ruling on this card refused
 * accepting `id` as an alias for `recordId` — an alias is consumer-side
 * tolerance, it makes the wrong key silently work so the caller never learns the
 * parameter's name, and it widens the accepted set of a published MCP surface
 * permanently. It also refused renaming `recordId` to `id` (a breaking change to
 * a published tool parameter). So the accept set must stay exactly where it is,
 * and the pin has to be able to SEE that: `the accept set is unchanged` below
 * asserts that the `id` spelling never reaches the bridge and that the declared
 * spelling still arrives with the exact arguments sent. A test that only looked
 * for the new sentence would pass just as well against an implementation that
 * had added the alias.
 *
 * MINIMUM ASSERTIONS ON A REFUSAL. There is no ADR-0112 envelope on this wire —
 * MCP answers a rejected `tools/call` as a TOOL ERROR, so the `code` + `status`
 * pair is asserted in this surface's own vocabulary: the protocol code
 * `-32602` (invalid params) carried in the message, and `result.isError: true`
 * with `error` ABSENT, which is this transport's promise that a refusal is
 * returned rather than thrown across the wire. The HTTP status stays `200`
 * because JSON-RPC carries its own outcome; that is pinned too, so a later
 * change cannot turn a tool error into a transport error unnoticed.
 *
 * ⚠️ WHY EVERY KEY ASSERTION USES THE BACKTICK FORM. A bare
 * `expect(text).toContain('id')` is satisfied by the word **Invalid** in
 * `Invalid input` — it passes against the exact defect this file exists to
 * catch. The refusal quotes an offending key as `` `id` ``, so the quoted form
 * is what is asserted, and the ordinary missing-key refusal (nothing offending
 * to quote) is asserted to carry NO backticks at all rather than to lack some
 * particular sentence.
 *
 * ⛔ The prose is deliberately not pinned — only the named subjects: which keys
 * the message names, and in which quoting position.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

/** The protocol code for invalid params — the `code` half of the refusal pin. */
const INVALID_PARAMS = '-32602';

/** The record id from the card's recording, kept so the repro reads as itself. */
const RECORD_ID = '_IFp-Bf8yQcrfV8o';

interface StubBridge extends McpDataBridge, McpActionBridge {
  calls: unknown[][];
}

function makeBridge(): StubBridge {
  const calls: unknown[][] = [];
  return {
    calls,
    async listObjects() { calls.push(['listObjects']); return [{ name: 'crm_lead', label: 'Lead' }]; },
    async describeObject(name: string) { calls.push(['describeObject', name]); return { name, fields: [] }; },
    async query(object: string, opts: unknown) { calls.push(['query', object, opts]); return { object, records: [] }; },
    async get(object: string, id: string) { calls.push(['get', object, id]); return { id }; },
    async aggregate(object: string, opts: unknown) { calls.push(['aggregate', object, opts]); return []; },
    async create(object: string, data: unknown) { calls.push(['create', object, data]); return { object, id: 'n1' }; },
    async update(object: string, id: string, data: unknown) { calls.push(['update', object, id, data]); return { object, id }; },
    async remove(object: string, id: string) { calls.push(['remove', object, id]); return { object, id, success: true }; },
    async listActions() { calls.push(['listActions']); return [{ name: 'complete_task', objectName: 'crm_lead' }]; },
    async runAction(name: string, input: unknown) { calls.push(['runAction', name, input]); return { ok: true }; },
  };
}

interface ToolOutcome {
  /** `true` when the call was refused as a tool error. */
  refused: boolean;
  /** The refusal (or success) text the client actually reads. */
  text: string;
  /** The HTTP status the JSON-RPC envelope arrived under. */
  status: number;
  /** A protocol-level error, which this transport promises never to throw. */
  protocolError: unknown;
}

let nextId = 1;

async function callTool(
  runtime: MCPServerRuntime,
  bridge: StubBridge,
  name: string,
  args: unknown,
): Promise<ToolOutcome> {
  const body = { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } };
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: body });
  const json = (await res.json()) as {
    result?: { isError?: boolean; content?: { text?: string }[] };
    error?: unknown;
  };
  return {
    refused: json.result?.isError === true || Boolean(json.error),
    text: String(json.result?.content?.map((c) => c.text).join('\n') ?? ''),
    status: res.status,
    protocolError: json.error ?? undefined,
  };
}

describe('#17568 a missing required key names the unexpected key that was sent', () => {
  let runtime: MCPServerRuntime;
  let bridge: StubBridge;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    bridge = makeBridge();
  });

  // ── The card's repro, and the named acceptance criterion ──────────────────

  it('the reported `id` call is refused naming BOTH the missing `recordId` and the `id` it received', async () => {
    const { refused, text, status, protocolError } = await callTool(runtime, bridge, 'update_record', {
      objectName: 'crm_lead',
      id: RECORD_ID,
      data: { status: 'qualified' },
    });

    // The refusal pin's `code` + `status` half, in this surface's vocabulary.
    expect(refused).toBe(true);
    expect(text).toContain(INVALID_PARAMS);
    expect(protocolError).toBeUndefined();
    expect(status).toBe(200);

    // Fact one: the declared key that is missing is located.
    expect(text).toContain('recordId');
    // Fact two — the whole card. The key the caller BELIEVES they supplied is
    // named back to them as a key, so the mistake reads as a KEY mistake and
    // not as a value the caller should vary. Backticked: the bare substring
    // `id` is present in the word "Invalid" even in the defective message.
    expect(text).toContain('`id`');
    // And the canonical spelling is prescribed as a key, not merely mentioned
    // as the zod path of the missing-key complaint.
    expect(text).toContain('`recordId`');

    // Nothing ran. The refusal is the whole answer.
    expect(bridge.calls).toEqual([]);
  });

  // ── Negative one: the accept set is unchanged ─────────────────────────────

  it('the accept set is unchanged — the declared spelling still succeeds with the exact arguments sent', async () => {
    const { refused, status } = await callTool(runtime, bridge, 'update_record', {
      objectName: 'crm_lead',
      recordId: RECORD_ID,
      data: { status: 'qualified' },
    });
    expect(refused).toBe(false);
    expect(status).toBe(200);
    // Not "it did not refuse" — the bridge received precisely the call.
    expect(bridge.calls).toEqual([['update', 'crm_lead', RECORD_ID, { status: 'qualified' }]]);
  });

  it('the accept set is unchanged — `id` is never accepted as a spelling of `recordId`', async () => {
    // The counterpart of the case above, and the reason a message-only assertion
    // is not enough: had the refused direction been "fixed" by accepting `id` as
    // an alias, the call would have reached the bridge with the record id. The
    // ruling on this card refused that direction, so the bridge stays untouched.
    await callTool(runtime, bridge, 'update_record', {
      objectName: 'crm_lead',
      id: RECORD_ID,
      data: { status: 'qualified' },
    });
    expect(bridge.calls.find((c) => c[0] === 'update')).toBeUndefined();
  });

  // ── Negative two: no invented unexpected-key clause ───────────────────────

  it('with NEITHER key the ordinary missing-`recordId` refusal quotes no key at all', async () => {
    const { refused, text } = await callTool(runtime, bridge, 'update_record', {
      objectName: 'crm_lead',
      data: { status: 'qualified' },
    });
    expect(refused).toBe(true);
    expect(text).toContain(INVALID_PARAMS);
    expect(text).toContain('recordId');
    // There is no offending key, so nothing is quoted as one. Asserted as the
    // ABSENCE OF ANY quoted key rather than of one particular sentence: an
    // unexpected-key clause invented for a payload that carried no unexpected
    // key would have to quote something, whatever the wording.
    expect(text).not.toContain('`');
    expect(bridge.calls).toEqual([]);
  });

  // ── The class, not the literal `id`/`recordId` pair ───────────────────────

  it('`record_id` — the other induced spelling — is answered the same way', async () => {
    // The defect class is "the error names the field the caller believes they
    // sent", not one pair of spellings. This case shares no literal with the one
    // above, so it goes red if the seam is ever narrowed to a hard-coded `id`.
    const { refused, text } = await callTool(runtime, bridge, 'update_record', {
      objectName: 'crm_lead',
      record_id: RECORD_ID,
      data: { status: 'qualified' },
    });
    expect(refused).toBe(true);
    expect(text).toContain('`record_id`');
    expect(text).toContain('`recordId`');
    expect(bridge.calls).toEqual([]);
  });

  // ── Reach: the sibling record-scoped tools, measured rather than assumed ──

  it.each(['get_record', 'delete_record'])(
    '%s inherits the same compound refusal',
    async (tool) => {
      const { refused, text } = await callTool(runtime, bridge, tool, {
        objectName: 'crm_lead',
        id: RECORD_ID,
      });
      expect(refused).toBe(true);
      expect(text).toContain(INVALID_PARAMS);
      expect(text).toContain('recordId');
      expect(text).toContain('`id`');
      expect(text).toContain('`recordId`');
      expect(bridge.calls).toEqual([]);
    },
  );

  it('`run_action`, where `recordId` is OPTIONAL, names the sent `id` and claims nothing is missing', async () => {
    // The asymmetry is the point, and it is why the reach is pinned per tool
    // rather than swept: `run_action` declares `recordId` optional, so no
    // required key is absent and there is no missing-key half to report. The
    // key mistake is still named, which is what breaks the retry loop.
    const { refused, text } = await callTool(runtime, bridge, 'run_action', {
      actionName: 'complete_task',
      objectName: 'crm_lead',
      id: RECORD_ID,
    });
    expect(refused).toBe(true);
    expect(text).toContain('`id`');
    expect(text).toContain('`recordId`');
    // No invented missing-key complaint: nothing was required and absent.
    expect(text).not.toContain('received undefined');
    expect(bridge.calls).toEqual([]);
  });

  it('`create_record`, which declares no `recordId`, names `id` and prescribes nothing', async () => {
    // The control on the prescription channel: `recordId` is not a key on this
    // tool, so suggesting it would be wrong. The offending key is still echoed.
    const { refused, text } = await callTool(runtime, bridge, 'create_record', {
      objectName: 'crm_lead',
      id: RECORD_ID,
      data: { status: 'qualified' },
    });
    expect(refused).toBe(true);
    expect(text).toContain('`id`');
    expect(text).not.toContain('recordId');
    expect(bridge.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The same repro over the wire a desktop MCP host actually uses
// ---------------------------------------------------------------------------

/**
 * WHY THE STDIO HALF IS HERE. The card was measured on a real client, and this
 * package has already shipped one outage in which the two transports served
 * DIFFERENT surfaces while every per-surface pin stayed green (#8034: `tools/call`
 * answered `-32601` over stdio while HTTP served the full set). The tools are
 * wired by one composition, so the diagnostic should be identical — "should be"
 * is exactly the claim that outage falsified, so it is asserted on the wire.
 */
describe('#17568 the same refusal arrives over the stdio transport', () => {
  it('names both facts on a real StdioServerTransport', async () => {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    const bridge = makeBridge();
    await runtime.bridgeDataTools(bridge);

    const serverStdin = new PassThrough();
    const serverStdout = new PassThrough();
    const transport = new StdioServerTransport(serverStdin, serverStdout);
    await (runtime as unknown as { mcpServer: { connect(t: unknown): Promise<void> } }).mcpServer.connect(transport);

    let buffered = '';
    const waiting = new Map<number, (frame: Record<string, any>) => void>();
    serverStdout.on('data', (chunk: Buffer | string) => {
      buffered += String(chunk);
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
        if (!line) continue;
        try {
          const frame = JSON.parse(line) as { id?: number };
          // Not a frame? A host printing to stdout is someone else's defect —
          // skipped rather than failed, as `mcp-stdio-tools.test.ts` does.
          const resolve = typeof frame.id === 'number' ? waiting.get(frame.id) : undefined;
          if (resolve && typeof frame.id === 'number') {
            waiting.delete(frame.id);
            resolve(frame as Record<string, any>);
          }
        } catch { /* not JSON — ignore */ }
      }
    });

    let id = 1;
    const rpc = (method: string, params?: unknown) =>
      new Promise<Record<string, any>>((resolve, reject) => {
        const myId = id++;
        const giveUp = setTimeout(
          () => reject(new Error(`stdio: no answer to "${method}" (id ${myId}) within 5s`)),
          5_000,
        );
        waiting.set(myId, (frame) => {
          clearTimeout(giveUp);
          resolve(frame);
        });
        serverStdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: myId, method, ...(params ? { params } : {}) })}\n`,
        );
      });

    try {
      await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'issue-17568-pin', version: '0.0.0' },
      });
      serverStdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

      const frame = await rpc('tools/call', {
        name: 'update_record',
        arguments: { objectName: 'crm_lead', id: RECORD_ID, data: { status: 'qualified' } },
      });

      const text = String(frame.result?.content?.map((c: { text?: string }) => c.text).join('\n') ?? '');
      expect(frame.result?.isError).toBe(true);
      expect(frame.error).toBeUndefined();
      expect(text).toContain(INVALID_PARAMS);
      expect(text).toContain('recordId');
      expect(text).toContain('`id`');
      expect(text).toContain('`recordId`');
      expect(bridge.calls.find((c) => c[0] === 'update')).toBeUndefined();
    } finally {
      await transport.close().catch(() => {});
    }
  });
});

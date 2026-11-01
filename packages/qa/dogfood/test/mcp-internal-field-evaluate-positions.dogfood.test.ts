// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The MCP data tools refuse to EVALUATE a field declared `internal: true` the
 * way the REST data door does, on both transports, for an administrator's
 * principal and a member's: a filter (`$eq`, `$startsWith`), a sort, an
 * aggregate's `where`, a group key, an aggregation operand and an
 * aggregation's own `filter` each answer the door's `400 INVALID_FIELD` with
 * the door's own sentence.
 *
 * ## What is pinned
 *
 * The data door refuses those positions for every caller
 * (`assertNoInternalFieldEvaluated`, `@objectstack/metadata-protocol`), before
 * the engine is asked: the engine omits such a field from every row, but it
 * still evaluates one named in a predicate or an order. Three MCP mouths hand a
 * caller's query to the engine without passing through `findData`, where the
 * door asks its gate — the stdio transport's `query_records` and
 * `aggregate_records`, and the HTTP bridge's `aggregate_records` — and each now
 * asks that same gate of the `protocol` service. The HTTP bridge's
 * `query_records` reaches `findData` itself; it is driven here too, as the
 * parity row the other three are held to.
 *
 * Every refusal is compared with what REST answers for the same body —
 * `code`, `status` and `message`, read from REST in this run, never a sentence
 * typed into this file — so a door that refused with another message (the
 * engine's own aggregation refusal, which a group key or an operand met before)
 * is told apart from the door's.
 *
 * ## Controls
 *
 * The same principals filter, sort, aggregate and group on an ORDINARY field
 * of the same object through every mouth, and are served — with a filter that
 * narrows (one row of two), so "served" is not "served everything" — and the
 * flagged column is still absent from every served row. A door that refused
 * every query would fail these.
 *
 * ## What is real
 *
 * The showcase stack with its security and `MCPServerPlugin` (the HTTP bridge
 * at `/api/v1/mcp`), a runtime object authored through `PUT /meta/object`, and
 * one stdio `MCPServerPlugin` per principal started with `autoStart` over the
 * same kernel's services, its `OS_MCP_STDIO_API_KEY` a key minted through
 * `POST /keys` by that principal. The session is the plugin's own server over
 * an in-process transport speaking the JSON-RPC a stdio client speaks (a
 * process cannot give a test its stdin), and `start()`'s claim of the real
 * stdin/stdout is the one call stubbed.
 *
 * The negative control — every stdio row and the HTTP aggregate rows served,
 * or answered in the engine's words, with the two MCP-side gate calls removed —
 * is a one-time ablation cited in the PR, not a permanent case.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin, MCPServerRuntime } from '@objectstack/mcp';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const OBJECT = 'mcpif_vault';
const FLAGGED = 'pin';
const ORDINARY = 'tier';
const SYS = { context: { isSystem: true } } as const;
const MEMBER_EMAIL = 'mcp-internal-field@verify.test';

/** The runtime object: one ordinary column to control with, one flagged `internal: true`. */
const DEFINITION = {
  name: OBJECT,
  label: 'MCP Internal Field Vault',
  sharingModel: 'public_read_write',
  fields: {
    name: { type: 'text', label: 'Name' },
    [ORDINARY]: { type: 'text', label: 'Tier' },
    [FLAGGED]: { type: 'text', label: 'Pin', internal: true },
  },
};
const ROWS = [
  { name: 'alpha', [ORDINARY]: 'gold', [FLAGGED]: 'fixture-a' },
  { name: 'beta', [ORDINARY]: 'silver', [FLAGGED]: 'fixture-b' },
];

const COUNT = { function: 'count', alias: 'n' };

/**
 * Each evaluate position: the MCP tool and its arguments, and the REST
 * `POST /data/:object/query` body that asks the door the same question.
 */
const POSITIONS: Array<{ label: string; tool: 'query_records' | 'aggregate_records'; args: Record<string, unknown>; rest: Record<string, unknown> }> = [
  {
    label: 'filter ($eq)',
    tool: 'query_records',
    args: { where: { [FLAGGED]: { $eq: 'fixture-a' } } },
    rest: { where: { [FLAGGED]: { $eq: 'fixture-a' } } },
  },
  {
    label: 'filter ($startsWith)',
    tool: 'query_records',
    args: { where: { [FLAGGED]: { $startsWith: 'fixture' } } },
    rest: { where: { [FLAGGED]: { $startsWith: 'fixture' } } },
  },
  {
    label: 'sort',
    tool: 'query_records',
    args: { orderBy: [{ field: FLAGGED, order: 'asc' }] },
    rest: { orderBy: [{ field: FLAGGED, order: 'asc' }] },
  },
  {
    label: 'aggregate where',
    tool: 'aggregate_records',
    args: { where: { [FLAGGED]: 'fixture-a' }, aggregations: [COUNT] },
    rest: { where: { [FLAGGED]: 'fixture-a' }, aggregations: [COUNT] },
  },
  {
    label: 'aggregate group key',
    tool: 'aggregate_records',
    args: { groupBy: [FLAGGED], aggregations: [COUNT] },
    rest: { groupBy: [FLAGGED], aggregations: [COUNT] },
  },
  {
    label: 'aggregation operand',
    tool: 'aggregate_records',
    args: { aggregations: [{ function: 'max', field: FLAGGED, alias: 'm' }] },
    rest: { aggregations: [{ function: 'max', field: FLAGGED, alias: 'm' }] },
  },
  {
    label: "aggregation's own filter",
    tool: 'aggregate_records',
    args: { aggregations: [{ ...COUNT, filter: { [FLAGGED]: 'fixture-a' } }] },
    rest: { aggregations: [{ ...COUNT, filter: { [FLAGGED]: 'fixture-a' } }] },
  },
];

/** What a tool call answered: `isError`, the JSON it returned (or its bare text). */
interface ToolAnswer {
  isError: boolean;
  text: string;
  payload: any;
}

type Call = (tool: string, args: Record<string, unknown>) => Promise<ToolAnswer>;

function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** An in-process MCP transport: the server's replies are matched back to the request that asked. */
function inProcessTransport() {
  const waiting = new Map<number, (frame: any) => void>();
  let nextId = 1;
  const transport: any = {
    onmessage: undefined,
    onclose: undefined,
    onerror: undefined,
    async start() {},
    async close() { transport.onclose?.(); },
    async send(message: any) {
      const resolve = typeof message?.id === 'number' ? waiting.get(message.id) : undefined;
      if (resolve) { waiting.delete(message.id); resolve(message); }
    },
  };
  const rpc = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const id = nextId++;
    const giveUp = setTimeout(() => reject(new Error(`no answer to "${method}" (id ${id}) within 10s`)), 10_000);
    waiting.set(id, (frame) => { clearTimeout(giveUp); resolve(frame); });
    transport.onmessage?.({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
  });
  return { transport, rpc, notify: (method: string) => transport.onmessage?.({ jsonrpc: '2.0', method }) };
}

describe('MCP data tools refuse an internal field in every evaluate position, as the data door does', () => {
  let stack: VerifyStack;
  const sessionTokens: Record<string, string> = {};
  const stdio: Record<string, Call> = {};
  const started: MCPServerPlugin[] = [];
  const originalKey = process.env.OS_MCP_STDIO_API_KEY;

  /** HTTP `/mcp` tools/call under a session token. */
  const httpCall = (token: string): Call => async (tool, args) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { objectName: OBJECT, ...args } } }),
    });
    expect(res.status, `MCP transport: ${await res.clone().text()}`).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, `JSON-RPC error: ${JSON.stringify(rpc.error)}`).toBeUndefined();
    const text: string = rpc.result?.content?.[0]?.text ?? '';
    return { isError: rpc.result?.isError === true, text, payload: parse(text) };
  };

  /**
   * A stdio session bound to `apiKey`: a fresh `MCPServerPlugin` started with
   * `autoStart` over this kernel's own services. Registrations stay local, so
   * the showcase's own MCP plugin is untouched.
   */
  async function stdioSession(apiKey: string): Promise<Call> {
    const local = new Map<string, unknown>();
    const ctx: any = {
      registerService: (name: string, service: unknown) => { local.set(name, service); },
      getService: (name: string) => (local.has(name) ? local.get(name) : stack.kernel.getService(name)),
      replaceService: (name: string, service: unknown) => { local.set(name, service); },
      hook: () => {},
      trigger: async () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getKernel: () => stack.kernel,
    };
    process.env.OS_MCP_STDIO_API_KEY = apiKey;
    const plugin = new MCPServerPlugin({ autoStart: true });
    try {
      await plugin.init(ctx);
      const runtime = local.get('mcp') as MCPServerRuntime;
      // `start()` would claim this process's real stdin/stdout.
      vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
      await plugin.start(ctx);
      started.push(plugin);
      const session = inProcessTransport();
      await runtime.server.connect(session.transport as never);
      await session.rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'mcp-internal-field-evaluate-positions', version: '0.0.0' },
      });
      session.notify('notifications/initialized');
      return async (tool, args) => {
        const frame = await session.rpc('tools/call', { name: tool, arguments: { objectName: OBJECT, ...args } });
        expect(frame.error, `tools/call ${tool} failed at the protocol level`).toBeUndefined();
        const text = frame.result.content[0].text as string;
        return { isError: frame.result.isError === true, text, payload: parse(text) };
      };
    } finally {
      // The key is read once, in `start()`.
      if (originalKey === undefined) delete process.env.OS_MCP_STDIO_API_KEY;
      else process.env.OS_MCP_STDIO_API_KEY = originalKey;
    }
  }

  /** `POST /keys` as `token`: the one door a key is minted through. */
  async function mintKey(token: string, name: string): Promise<string> {
    const res = await stack.apiAs(token, 'POST', '/keys', { name });
    expect(res.status, await res.clone().text()).toBe(201);
    const key = (await res.json())?.data?.key;
    expect(typeof key).toBe('string');
    return String(key);
  }

  async function rest(persona: string, body: Record<string, unknown>) {
    const res = await stack.apiAs(sessionTokens[persona]!, 'POST', `/data/${OBJECT}/query`, body);
    return { status: res.status, body: (await res.json()) as any };
  }

  beforeAll(async () => {
    stack = await bootShowcase({
      extraPlugins: [new MCPServerPlugin()],
      security: showcaseAppDefaultSecurity(),
    });
    sessionTokens.admin = await stack.signIn();
    sessionTokens.member = await stack.signUp(MEMBER_EMAIL);

    const saved = await stack.apiAs(sessionTokens.admin, 'PUT', `/meta/object/${OBJECT}`, DEFINITION);
    expect(saved.status, `runtime object authored: ${await saved.clone().text()}`).toBe(200);
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    for (const row of ROWS) await ql.insert(OBJECT, row, SYS);

    for (const persona of ['admin', 'member'] as const) {
      stdio[persona] = await stdioSession(await mintKey(sessionTokens[persona]!, `mcp-internal-field-${persona}`));
    }
  }, 240_000);

  afterAll(async () => {
    for (const plugin of started) await plugin.destroy().catch(() => {});
    if (originalKey === undefined) delete process.env.OS_MCP_STDIO_API_KEY;
    else process.env.OS_MCP_STDIO_API_KEY = originalKey;
    vi.restoreAllMocks();
    await stack?.stop?.();
  });

  const transports = {
    stdio: (persona: string) => stdio[persona]!,
    http: (persona: string) => httpCall(sessionTokens[persona]!),
  } as const;

  for (const position of POSITIONS) {
    for (const persona of ['admin', 'member'] as const) {
      for (const [transport, callFor] of Object.entries(transports)) {
        it(`${position.tool} ${position.label} — ${transport}, ${persona}: the door's 400 INVALID_FIELD, word for word`, async () => {
          const door = await rest(persona, position.rest);
          expect(door.status, `REST: ${JSON.stringify(door.body)}`).toBe(400);
          expect(door.body?.error?.code).toBe('INVALID_FIELD');

          const answer = await callFor(persona)(position.tool, position.args);
          expect(answer.isError, `${transport} served the position: ${answer.text}`).toBe(true);
          expect({
            code: answer.payload?.error?.code,
            status: answer.payload?.error?.status,
            message: answer.payload?.error?.message,
          }).toEqual({ code: 'INVALID_FIELD', status: 400, message: door.body.error.message });
        });
      }
    }
  }

  for (const persona of ['admin', 'member'] as const) {
    for (const [transport, callFor] of Object.entries(transports)) {
      it(`CONTROL ${transport}, ${persona}: an ordinary field filters, sorts, aggregates and groups; the flagged column stays off every row`, async () => {
        const call = callFor(persona);

        const filtered = await call('query_records', { where: { [ORDINARY]: 'gold' }, orderBy: [{ field: ORDINARY, order: 'desc' }] });
        expect(filtered.isError, filtered.text).toBe(false);
        expect(filtered.payload.records.map((r: any) => r.name)).toEqual(['alpha']);

        const sorted = await call('query_records', { orderBy: [{ field: ORDINARY, order: 'asc' }] });
        expect(sorted.isError, sorted.text).toBe(false);
        expect(sorted.payload.records.map((r: any) => r.name)).toEqual(['alpha', 'beta']);
        for (const row of [...filtered.payload.records, ...sorted.payload.records]) expect(row).not.toHaveProperty(FLAGGED);

        const counted = await call('aggregate_records', { where: { [ORDINARY]: 'gold' }, aggregations: [COUNT, { ...COUNT, alias: 'all', filter: { [ORDINARY]: { $ne: 'none' } } }] });
        expect(counted.isError, counted.text).toBe(false);
        expect(counted.payload.rows.map((r: any) => ({ n: Number(r.n), all: Number(r.all) }))).toEqual([{ n: 1, all: 1 }]);

        const grouped = await call('aggregate_records', { groupBy: [ORDINARY], aggregations: [COUNT] });
        expect(grouped.isError, grouped.text).toBe(false);
        const groups = grouped.payload.rows
          .map((r: any) => ({ [ORDINARY]: r[ORDINARY], n: Number(r.n) }))
          .sort((a: any, b: any) => String(a[ORDINARY]).localeCompare(String(b[ORDINARY])));
        expect(groups).toEqual([{ [ORDINARY]: 'gold', n: 1 }, { [ORDINARY]: 'silver', n: 1 }]);
      });
    }
  }
});

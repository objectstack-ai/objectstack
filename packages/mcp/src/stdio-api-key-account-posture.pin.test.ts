// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23456 — ruling C′ items 1 and 4] The MCP stdio face asks the key OWNER's
 * posture on EVERY call of a live session, and refuses a held owner's call
 * with the envelope REST answers the same key with.
 *
 * ## What was open
 *
 * `resolveStdioExecutionContext` resolved `OS_MCP_STDIO_API_KEY` through
 * `resolveAuthzContext` with no owner-posture source and assembled
 * `authGate: undefined`, so a key whose owner owes MFA enrolment started the
 * transport and was served on every call, while REST and every face ruling C′
 * built refuse the same key with `403 MFA_REQUIRED`.
 *
 * ## Why per call, and why the transport still starts
 *
 * Item 4: the refusal is not a revocation, and the key resumes the moment the
 * owner remediates. A start-only refusal could neither see a posture that
 * appears mid-session nor let the key resume without a restart. So a held
 * identity STARTS (it is a valid key; a warning names the hold once), and each
 * principal-bound call re-asks the owner's posture — the schedule ADR-0101 D1
 * already gives revocation on this door.
 *
 * ## What is pinned
 *
 *  - a key whose owner holds `MFA_REQUIRED` (scope `account`) → every
 *    principal-bound call (the data tools' bridge and the record resource)
 *    rejects with `code` `MFA_REQUIRED`, `status` 403 and the session's
 *    message, before any read or write; over the real stdio wire a
 *    `tools/call` answers a tool error carrying that remediation message;
 *  - a key whose owner holds only `PASSWORD_RESET_REQUIRED` (scope
 *    `credential`) → served;
 *  - the same session: a posture that APPEARS refuses the next call, and a
 *    posture that CLEARS serves the next call, with no restart.
 *
 * A REAL `ObjectKernel` holds the services and `@objectstack/core` is not
 * mocked: the real verify → authorize chain runs. The engine double carries
 * only `find` and `insert`, the two verbs this door's calls reach here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import { MCPServerPlugin } from './plugin.js';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

const OBJECT = 'crm_note';
const RAW_KEY = 'osk_23456_stdio_account_posture';
const OWNER = 'u_key_owner';

const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_RESET_REQUIRED = { code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' };

type Posture = { code: string; message: string };

/** Equality and `$in` — the two shapes the shared resolver issues — and nothing else, loudly. */
function matchesWhere(row: Record<string, unknown>, where: unknown): boolean {
  for (const [field, cond] of Object.entries((where ?? {}) as Record<string, unknown>)) {
    if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as { $in?: unknown }).$in)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!(cond as { $in: unknown[] }).$in.includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

function makeFixture() {
  const notes: Array<Record<string, unknown>> = [{ id: 'n1', title: 'first note' }];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_api_key: [{ id: 'key_owner', key: hashApiKey(RAW_KEY), user_id: OWNER, revoked: false, scopes: '[]' }],
    sys_user: [{ id: OWNER, email: 'owner@example.com' }],
    sys_member: [],
    sys_user_permission_set: [{ user_id: OWNER, permission_set_id: 'ps_shared' }],
    sys_permission_set: [{ id: 'ps_shared', name: 'shared_access', system_permissions: ['studio.access'] }],
  };
  const keyRowBefore = JSON.stringify(tables.sys_api_key);
  let seq = 0;
  const engine = {
    async find(object: string, query: any = {}) {
      if (object === OBJECT) return notes.filter((row) => matchesWhere(row, query?.where)).map((row) => ({ ...row }));
      const matched = (tables[object] ?? []).filter((row) => matchesWhere(row, query?.where));
      return typeof query?.limit === 'number' ? matched.slice(0, query.limit) : matched;
    },
    async insert(object: string, data: any) {
      if (object !== OBJECT) throw new Error(`fixture: no write table for '${object}'`);
      const row = { id: `n${++seq + 1}`, ...data };
      notes.push(row);
      return { ...row };
    },
  };
  return { engine, notes, keyRowUnchanged: () => JSON.stringify(tables.sys_api_key) === keyRowBefore };
}

/** A REAL kernel holding the engine, a metadata double and an auth service whose posture the test moves. */
function makeHost(postures: Record<string, Posture[]>) {
  const fixture = makeFixture();
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
  kernel.registerService('objectql', fixture.engine);
  kernel.registerService('metadata', {
    listObjects: vi.fn(async () => []),
    // No declaration ⇒ the ADR-0049 exposure gate falls open, the state a bare
    // kernel is in; what is measured here is the posture, nothing else.
    getObject: vi.fn(async () => null),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  });
  kernel.registerService('auth', {
    // The computation plugin-auth's `AuthManager` exposes, read on every ask.
    resolveUserAuthGates: async (userId: string) => postures[userId] ?? [],
  });
  let runtime: MCPServerRuntime | undefined;
  const ctx = {
    registerService: vi.fn((name: string, service: unknown) => {
      if (name === 'mcp') runtime = service as MCPServerRuntime;
      kernel.registerService(name, service);
    }),
    getService: vi.fn(<T>(name: string): T => kernel.getService<T>(name)),
    replaceService: vi.fn(),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(() => kernel),
  };
  return { fixture, ctx, runtime: () => runtime };
}

interface Started {
  bridge: McpDataBridge;
  getRecord: (object: string, id: string) => Promise<Record<string, unknown> | null>;
  runtime: MCPServerRuntime;
}

/**
 * Boot the plugin on the stdio path. The data tools are registered for real on
 * the long-lived server (`bridgeDataTools` is spied, not replaced); only the
 * transport's own `start()` is stubbed, since it would claim this process's
 * stdin/stdout, and the prompt bridge, which reads skill metadata this file
 * does not exercise.
 */
async function startStdio(host: ReturnType<typeof makeHost>): Promise<Started> {
  process.env.OS_MCP_STDIO_API_KEY = RAW_KEY;
  let getRecord: Started['getRecord'] | undefined;
  const realBridgeResources = MCPServerRuntime.prototype.bridgeResources;
  const dataTools = vi.spyOn(MCPServerRuntime.prototype, 'bridgeDataTools');
  const spies = [
    vi.spyOn(MCPServerRuntime.prototype, 'bridgeResources').mockImplementation(function (this: MCPServerRuntime, meta, reader) {
      getRecord = reader as Started['getRecord'];
      return realBridgeResources.call(this, meta, reader);
    }),
    vi.spyOn(MCPServerRuntime.prototype, 'bridgePrompts').mockImplementation(async () => {}),
    vi.spyOn(MCPServerRuntime.prototype, 'start').mockImplementation(async () => {}),
  ];
  try {
    const plugin = new MCPServerPlugin({ autoStart: true });
    await plugin.init(host.ctx as never);
    await plugin.start(host.ctx as never);
  } finally {
    for (const s of spies) s.mockRestore();
  }
  const bridge = dataTools.mock.calls[0]?.[0] as McpDataBridge | undefined;
  dataTools.mockRestore();
  const runtime = host.runtime();
  if (!bridge || !getRecord || !runtime) throw new Error('stdio start registered no principal-bound surface');
  return { bridge, getRecord, runtime };
}

/** The envelope a refused call rejects with, read off the thrown value. */
async function refusalOf(call: Promise<unknown>): Promise<{ code?: unknown; status?: unknown; message?: unknown }> {
  const err = await call.then(() => undefined, (e: unknown) => e);
  expect(err, 'the call was served').toBeInstanceOf(Error);
  const e = err as { code?: unknown; status?: unknown; message?: unknown };
  return { code: e.code, status: e.status, message: e.message };
}

const HELD_ENVELOPE = { code: 'MFA_REQUIRED', status: 403, message: MFA_REQUIRED.message };

/** One `tools/call` over a real `StdioServerTransport` attached to the long-lived server. */
async function callToolOverStdio(runtime: MCPServerRuntime, name: string, args: Record<string, unknown>) {
  const serverStdin = new PassThrough();
  const serverStdout = new PassThrough();
  const transport = new StdioServerTransport(serverStdin, serverStdout);
  await runtime.server.connect(transport);
  const frames: Array<{ id?: number; result?: any; error?: any }> = [];
  let buffered = '';
  serverStdout.on('data', (chunk: Buffer | string) => {
    buffered += String(chunk);
    let nl = buffered.indexOf('\n');
    while (nl >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      nl = buffered.indexOf('\n');
      if (!line) continue;
      try { frames.push(JSON.parse(line)); } catch { /* not a frame */ }
    }
  });
  const answer = (id: number) => new Promise<{ result?: any; error?: any }>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const frame = frames.find((f) => f.id === id);
      if (frame) return resolve(frame);
      if (Date.now() - started > 5_000) return reject(new Error(`stdio: no answer to id ${id} within 5s`));
      setTimeout(poll, 5);
    };
    poll();
  });
  const send = (frame: Record<string, unknown>) => serverStdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
  try {
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pin', version: '0.0.0' } } });
    await answer(1);
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/call', params: { name, arguments: args } });
    return await answer(2);
  } finally {
    await transport.close().catch(() => {});
  }
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
afterEach(() => { process.env = { ...ORIGINAL_ENV }; vi.restoreAllMocks(); });

describe('MCP stdio — a key answers as its owner\'s session does, on every call (#23456, ruling C′)', () => {
  it('REFUSES every principal-bound call of a held owner\'s key with 403 MFA_REQUIRED and the session\'s message, before any read or write', async () => {
    const host = makeHost({ [OWNER]: [MFA_REQUIRED] });
    // A valid key whose owner is held still STARTS, and says so once.
    const { bridge, getRecord, runtime } = await startStdio(host);
    const warned = host.ctx.logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('held by an authentication policy'));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('MFA_REQUIRED');

    expect(await refusalOf(bridge.query(OBJECT, {}))).toEqual(HELD_ENVELOPE);
    expect(await refusalOf(bridge.get(OBJECT, 'n1'))).toEqual(HELD_ENVELOPE);
    expect(await refusalOf(bridge.create(OBJECT, { title: 'held write' }))).toEqual(HELD_ENVELOPE);
    expect(await refusalOf(getRecord(OBJECT, 'n1'))).toEqual(HELD_ENVELOPE);
    expect(host.fixture.notes.filter((n) => n.title === 'held write'), 'a held owner\'s write landed').toHaveLength(0);

    // What a stdio client sees: a tool error carrying the remediation message.
    const answered = await callToolOverStdio(runtime, 'query_records', { objectName: OBJECT });
    expect(answered.error).toBeUndefined();
    expect(answered.result?.isError).toBe(true);
    expect(answered.result?.content?.[0]?.text).toBe(MFA_REQUIRED.message);
  });

  it('SERVES a key whose owner holds only a credential-scope posture', async () => {
    const host = makeHost({ [OWNER]: [PASSWORD_RESET_REQUIRED] });
    const { bridge, getRecord } = await startStdio(host);
    expect(host.ctx.logger.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('held by an authentication policy'))).toBe(false);
    const read = (await bridge.query(OBJECT, {})) as { records: Array<Record<string, unknown>> };
    expect(read.records.map((r) => r.id)).toEqual(['n1']);
    expect(await getRecord(OBJECT, 'n1')).toMatchObject({ id: 'n1' });
    await bridge.create(OBJECT, { title: 'served write' });
    expect(host.fixture.notes.filter((n) => n.title === 'served write')).toHaveLength(1);
  });

  it('the same live session: a posture that APPEARS refuses the next call, and one that CLEARS serves the next call — no restart, nothing revoked', async () => {
    const postures: Record<string, Posture[]> = {};
    const host = makeHost(postures);
    const { bridge, getRecord } = await startStdio(host);
    expect(((await bridge.query(OBJECT, {})) as { records: unknown[] }).records).toHaveLength(1);

    // The deployment starts enforcing MFA and the owner has not enrolled.
    postures[OWNER] = [MFA_REQUIRED];
    expect(await refusalOf(bridge.query(OBJECT, {}))).toEqual(HELD_ENVELOPE);
    expect(await refusalOf(getRecord(OBJECT, 'n1'))).toEqual(HELD_ENVELOPE);

    // The owner enrols; nothing about the key is rewritten or reissued.
    postures[OWNER] = [];
    expect(((await bridge.query(OBJECT, {})) as { records: unknown[] }).records).toHaveLength(1);
    expect(await getRecord(OBJECT, 'n1')).toMatchObject({ id: 'n1' });
    expect(host.fixture.keyRowUnchanged(), 'the hold wrote to the key row').toBe(true);
  });
});

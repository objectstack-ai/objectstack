// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The MCP stdio door follows a runtime-authored object's CURRENT definition:
 * an object whose API exposure is switched off after boot is refused by every
 * data verb, an object created after boot honours its own declaration from the
 * first call, and a deleted one is neither listed nor described.
 *
 * ## The defect
 *
 * The stdio door gates every data verb on the `metadata` service's copy of the
 * object (`enforceApiExposure`: `getObject(name).enable.apiEnabled`) and lists
 * and describes from the same service. On a kernel whose `ObjectQLPlugin` has no
 * `environmentId`, that copy was made once at boot (`bridgeObjectsToMetadataService`)
 * and no authoring door ever wrote to it again. Measured on this file's kernel
 * before the fix:
 *
 *  - an object saved with `apiEnabled: false` AFTER boot has no copy, and an
 *    absent copy reads as "no declaration" (the gate falls open by design, as
 *    the HTTP gate does), so `query_records` and `create_record` were SERVED
 *    — the create wrote a row;
 *  - a boot-hydrated object re-saved with `apiEnabled: false` kept its boot
 *    copy (`apiEnabled: true`), with the same result;
 *  - a deleted object stayed in `list_objects` and `describe_object` (the engine
 *    refused its data verbs, which is the registry's own answer).
 *
 * The producer is the boot bridge's copy, kept current now by
 * `ObjectQLPlugin.followRuntimeObjectCopy`; its own pins, over the service's
 * answers, are `packages/objectql/src/plugin-runtime-object-metadata-copy.test.ts`.
 * This file pins the door.
 *
 * ## What is real, and the one seam that is not
 *
 * The kernel is real (`ObjectKernel` with `MetadataPlugin` and an
 * `ObjectQLPlugin` with no `environmentId`), and so are the `metadata` service,
 * the engine and its registry, the protocol's `saveMetaItem` / `deleteMetaItem`,
 * and the `MCPServerPlugin` whose `start()` builds the stdio data bridge. The
 * session is the plugin's own server over an in-process transport speaking the
 * JSON-RPC a stdio client speaks (a process cannot give a test its stdin).
 *
 * The one seam faked is the key row the stdio principal resolves from: the
 * engine is wrapped so `sys_api_key` answers one non-revoked key (and takes its
 * use stamp), and any other platform table the principal chain reads that this
 * kernel does not register answers empty. Every other call goes to the real
 * engine.
 *
 * The negative control (red with the producer's follow removed) is a one-time
 * ablation, cited in the PR, not a permanent case.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { MCPServerPlugin, MCPServerRuntime } from '@objectstack/mcp';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from the objectql suite's real-kernel pins; equality-only WHERE. */
function makeMemoryDriver(stores: Stores) {
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((w: any) => matchesWhere(row, w))) return false;
        continue;
      }
      if (k === '$or' && Array.isArray(v)) {
        if (!v.some((w: any) => matchesWhere(row, w))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const rowVal = row[k];
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      const a = rowVal === undefined ? null : rowVal;
      const b = expected === undefined ? null : expected;
      if (a !== b) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
      // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${randomUUID()}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
    async dropTable(object: string) { stores.delete(object); },
  };
  return driver;
}

const GATED = 'qa_gated_gadget';
const OPEN = 'qa_open_gadget';
const SYSTEM = { context: { isSystem: true } } as never;

/** A runtime object body; `enable` is the exposure under test. */
const objectBody = (name: string, label: string, enable: Record<string, unknown>) => ({
  name,
  label,
  // [#8310] The runtime object door requires an authored OWD.
  sharingModel: 'private',
  fields: { name: { name: 'name', type: 'text', label: 'Name' } },
  enable,
});

/** What a tool call answered: `isError`, and the JSON the tool returned (or its bare error text). */
interface ToolAnswer {
  isError: boolean;
  text: string;
  json?: any;
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

describe('the MCP stdio door follows a runtime-authored object\'s current definition', () => {
  const live: ObjectKernel[] = [];
  const roots: string[] = [];
  const originalKey = process.env.OS_MCP_STDIO_API_KEY;

  beforeEach(() => {
    process.env.OS_MCP_STDIO_API_KEY = 'osk_mcp_stdio_runtime_object_exposure';
  });
  afterEach(async () => {
    if (originalKey === undefined) delete process.env.OS_MCP_STDIO_API_KEY;
    else process.env.OS_MCP_STDIO_API_KEY = originalKey;
    vi.restoreAllMocks();
    while (live.length) {
      const kernel = live.pop()!;
      if (kernel.getState() === 'running') await kernel.shutdown();
    }
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
    protocol: any;
    call(name: string, args: Record<string, unknown>): Promise<ToolAnswer>;
  }

  /**
   * One boot over `stores`, then a stdio session over it: `MetadataPlugin` provides
   * the `metadata` service, `ObjectQLPlugin` with no `environmentId` hydrates
   * `sys_metadata` and runs the boot bridge, and `MCPServerPlugin` builds the
   * stdio data bridge over this kernel's own services.
   */
  async function boot(stores: Stores): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    live.push(kernel);
    const root = mkdtempSync(join(tmpdir(), 'os-mcp-stdio-exposure-'));
    roots.push(root);
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores), true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    await kernel.bootstrap();

    // The faked seam, and only it: the key row the stdio principal resolves from.
    const ql = new Proxy(engine as any, {
      get(target, prop, receiver) {
        // The use stamp a resolved key takes (`last_used_at`) has no table here.
        if (prop === 'update') {
          return async (object: string, data: unknown, options?: unknown) =>
            object === 'sys_api_key' ? {} : target.update(object, data, options);
        }
        if (prop === 'find') {
          return async (object: string, query?: unknown, options?: unknown) => {
            if (object === 'sys_api_key') return [{ id: 'k1', user_id: 'usr_stdio', revoked: false }];
            if (object.startsWith('sys_') && object !== 'sys_metadata' && !target.registry.getObject(object)) return [];
            return target.find(object, query, options);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const services = new Map<string, unknown>([
      ['metadata', kernel.getService('metadata')],
      ['protocol', kernel.getService('protocol')],
      ['objectql', ql],
    ]);
    const ctx: any = {
      registerService: vi.fn((name: string, service: unknown) => services.set(name, service)),
      getService: vi.fn((name: string) => {
        if (!services.has(name)) throw new Error(`Service "${name}" not found`);
        return services.get(name);
      }),
      replaceService: vi.fn(),
      getServices: vi.fn(() => services),
      hook: vi.fn(),
      trigger: vi.fn(async () => {}),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(() => ({})),
    };
    const plugin = new MCPServerPlugin({ autoStart: true });
    await plugin.init(ctx);
    const runtime = services.get('mcp') as MCPServerRuntime;
    // `start()` would claim this process's real stdin/stdout.
    vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
    await plugin.start(ctx);

    const session = inProcessTransport();
    await runtime.server.connect(session.transport as never);
    await session.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcp-stdio-runtime-object-exposure', version: '0.0.0' },
    });
    session.notify('notifications/initialized');

    return {
      kernel,
      engine,
      protocol: kernel.getService('protocol'),
      async call(name, args) {
        const frame = await session.rpc('tools/call', { name, arguments: args });
        expect(frame.error, `tools/call ${name} failed at the protocol level`).toBeUndefined();
        const text = frame.result.content[0].text as string;
        let json: any;
        try { json = JSON.parse(text); } catch { /* a bare error sentence */ }
        return { isError: frame.result.isError === true, text, json };
      },
    };
  }

  const save = (k: Booted, name: string, label: string, enable: Record<string, unknown>) =>
    k.protocol.saveMetaItem({ type: 'object', name, item: objectBody(name, label, enable) });

  /** The coded envelope a refused tool call carries. */
  const refusal = (answer: ToolAnswer) => (answer.isError ? { code: answer.json?.error?.code, status: answer.json?.error?.status } : undefined);

  /** Both objects saved exposed, two records each, then a second boot: the objects are hydrated and bridged. */
  async function bootHydrated(stores: Stores): Promise<Booted> {
    const k1 = await boot(stores);
    expect((await save(k1, GATED, 'Gated', { apiEnabled: true })).success).toBe(true);
    expect((await save(k1, OPEN, 'Open', { apiEnabled: true })).success).toBe(true);
    for (const name of [GATED, OPEN]) {
      await k1.engine.insert(name, { name: 'rec-1' }, SYSTEM);
      await k1.engine.insert(name, { name: 'rec-2' }, SYSTEM);
    }
    await k1.kernel.shutdown();
    return boot(stores);
  }

  const names = (answer: ToolAnswer) => (answer.json?.objects as Array<{ name: string }> | undefined)?.map((o) => o.name) ?? [];

  it('CONTROL: an exposed runtime object is listed, described, queried and written through the door', async () => {
    const stores: Stores = new Map();
    const k = await bootHydrated(stores);

    const listed = await k.call('list_objects', {});
    expect(names(listed)).toEqual(expect.arrayContaining([GATED, OPEN]));
    const described = await k.call('describe_object', { objectName: OPEN });
    expect(described.isError).toBe(false);
    expect(described.json).toMatchObject({ name: OPEN, enableFeatures: { apiEnabled: true } });
    const queried = await k.call('query_records', { objectName: OPEN });
    expect(queried.isError).toBe(false);
    expect(queried.json.records).toHaveLength(2);
    const created = await k.call('create_record', { objectName: OPEN, data: { name: 'rec-3' } });
    expect(created.isError).toBe(false);
    expect(stores.get(OPEN)?.size).toBe(3);
  });

  it('toggled off after boot: every data verb is refused, nothing is read or written, and the exposed neighbour keeps being served', async () => {
    const stores: Stores = new Map();
    const k = await bootHydrated(stores);
    expect((await k.call('query_records', { objectName: GATED })).isError).toBe(false);

    expect((await save(k, GATED, 'Gated', { apiEnabled: false })).success).toBe(true);

    const refused = { code: 'OBJECT_API_DISABLED', status: 404 };
    expect(refusal(await k.call('query_records', { objectName: GATED }))).toEqual(refused);
    expect(refusal(await k.call('get_record', { objectName: GATED, recordId: 'any' }))).toEqual(refused);
    expect(refusal(await k.call('create_record', { objectName: GATED, data: { name: 'leak-probe' } }))).toEqual(refused);
    expect(refusal(await k.call('update_record', { objectName: GATED, recordId: 'any', data: { name: 'x' } }))).toEqual(refused);
    expect(refusal(await k.call('delete_record', { objectName: GATED, recordId: 'any' }))).toEqual(refused);
    // Refused before dispatch: the table holds exactly what it held.
    expect(stores.get(GATED)?.size).toBe(2);

    // The neighbour nobody touched is still served, and still described as exposed.
    const neighbour = await k.call('query_records', { objectName: OPEN });
    expect(neighbour.isError).toBe(false);
    expect(neighbour.json.records).toHaveLength(2);
  });

  it('created after boot with exposure off: refused from the first call (it had no copy, so it was served)', async () => {
    const stores: Stores = new Map();
    const k = await boot(stores);
    expect((await save(k, GATED, 'Gated', { apiEnabled: false })).success).toBe(true);
    await k.engine.insert(GATED, { name: 'rec-1' }, SYSTEM);

    expect(refusal(await k.call('query_records', { objectName: GATED }))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    expect(refusal(await k.call('create_record', { objectName: GATED, data: { name: 'leak-probe' } })))
      .toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    expect(stores.get(GATED)?.size).toBe(1);
  });

  it('deleted: it is neither listed nor described, and its data verbs are refused', async () => {
    const stores: Stores = new Map();
    const k = await bootHydrated(stores);
    expect(names(await k.call('list_objects', {}))).toContain(GATED);

    expect((await k.protocol.deleteMetaItem({ type: 'object', name: GATED })).success).toBe(true);

    // The removal awaits the metadata service, so it settles after the delete answers.
    await vi.waitFor(async () => expect(names(await k.call('list_objects', {}))).not.toContain(GATED));
    const described = await k.call('describe_object', { objectName: GATED });
    expect(described).toMatchObject({ isError: true, text: expect.stringContaining('not found') });
    expect(refusal(await k.call('query_records', { objectName: GATED }))).toEqual({ code: 'OBJECT_NOT_FOUND', status: 404 });
    // The object nobody deleted is still listed.
    expect(names(await k.call('list_objects', {}))).toContain(OPEN);
  });
});

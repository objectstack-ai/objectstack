// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21207] Exit two at the MCP stdio transport's engine-only reader: the two
 * stored content-hash columns of `sys_metadata` / `sys_metadata_history`
 * (`checksum`, and the history table's `previous_checksum`).
 *
 * The engine returns them as stored — a hash over the WHOLE stored body,
 * withheld credential material included — so an administrator's key read them
 * raw beside the projected body: an offline verifier for a guess at the
 * withheld material. Per the maintainer's ruling, this transport now serves
 * each as the crypto provider's keyed digest of the stored value (omitted when
 * no provider is registered), on every read path — the bridge's query and get
 * and the ADR-0101 record resource — and refuses a filter, sort or grouping on
 * either column before the engine is asked (`INVALID_FIELD` / 400, the shape
 * its body-column refusal already answers). A member stays refused by the
 * engine, unchanged.
 */

import { createHmac } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SysMetadataObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import type { MCPServerRuntime } from './mcp-server-runtime.js';
import { MCPServerPlugin } from './plugin.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';

const keyedDigest = async (plain: string): Promise<string> =>
  `hmac-sha256:${createHmac('sha256', 'mcp-test-key').update(plain, 'utf8').digest('hex')}`;
const KEYED = /^hmac-sha256:[0-9a-f]{64}$/;

const HASH_M = `sha256:${'1'.repeat(64)}`;
const HASH_H = `sha256:${'2'.repeat(64)}`;
const PARENT_H = `sha256:${'3'.repeat(64)}`;
const STORED = [HASH_M, HASH_H, PARENT_H];

const TABLES: Record<string, Array<Record<string, unknown>>> = {
  sys_metadata: [{ id: 'm1', type: 'view', name: 'v', metadata: '{"name":"v"}', checksum: HASH_M, state: 'active' }],
  sys_metadata_history: [
    { id: 'h1', type: 'view', name: 'v', metadata: '{"name":"v"}', checksum: HASH_H, previous_checksum: PARENT_H },
    { id: 'h0', type: 'view', name: 'v', metadata: '{"name":"v"}', checksum: PARENT_H, previous_checksum: null },
  ],
  file_blob: [{ id: 'f1', name: 'blob', checksum: HASH_M }],
};

const ADMIN = 'usr_admin';
const MEMBER = 'usr_member';

function matches(row: Record<string, unknown>, where: unknown): boolean {
  for (const [key, cond] of Object.entries((where ?? {}) as Record<string, unknown>)) {
    if (key.startsWith('$') || (cond !== null && typeof cond === 'object')) {
      throw new Error(`fixture where-matcher: unsupported shape on '${key}'`);
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

function fakeEngine(opts: { owner?: string; provider?: boolean } = {}) {
  const owner = opts.owner ?? ADMIN;
  const engine: Record<string, unknown> = {
    find: vi.fn(async (object: string, query?: any, options?: any) => {
      const context = options?.context ?? query?.context;
      if (object === 'sys_api_key') return [{ id: 'k1', user_id: owner, revoked: false }];
      if (object.startsWith('sys_metadata') && context?.userId !== ADMIN) {
        throw Object.assign(new Error(`Permission denied: cannot read '${object}'`), { code: 'PERMISSION_DENIED', status: 403 });
      }
      const rows = (TABLES[object] ?? []).filter((row) => matches(row, query?.where));
      return typeof query?.limit === 'number' ? rows.slice(0, query.limit).map((r) => ({ ...r })) : rows.map((r) => ({ ...r }));
    }),
    aggregate: vi.fn(async () => [] as unknown[]),
  };
  if (opts.provider !== false) engine.getKeyedDigest = () => keyedDigest;
  return engine;
}

const DEFS: Record<string, unknown> = {
  sys_metadata: SysMetadataObject,
  sys_metadata_history: SysMetadataHistoryObject,
  file_blob: { name: 'file_blob', fields: { name: { type: 'text' }, checksum: { type: 'text' } } },
};

function fakeMetadata() {
  return {
    listObjects: vi.fn(async () => Object.values(DEFS)),
    getObject: vi.fn(async (name: string) => DEFS[name] ?? null),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => true),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

function bridgeAs(userId: string, opts: { provider?: boolean } = {}) {
  const engine = fakeEngine(opts);
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: fakeMetadata() as unknown as IMetadataService,
    resolvePrincipal: async () => ({ userId, isSystem: false }) as unknown as ExecutionContext,
    keyedDigest: () => (engine as { getKeyedDigest?: () => typeof keyedDigest }).getKeyedDigest?.(),
  });
  return { bridge, engine: engine as any };
}

const noStoredHash = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const s of STORED) expect(text).not.toContain(s);
};

describe('[#21207] stdio reader: an administrator is served the keyed hash, never the stored one', () => {
  it('query: both columns keyed on both tables, stable across reads, a null parent stays null', async () => {
    const { bridge } = bridgeAs(ADMIN);
    const m1 = (await bridge.query('sys_metadata', {})) as { records: Array<Record<string, unknown>> };
    const m2 = (await bridge.query('sys_metadata', {})) as { records: Array<Record<string, unknown>> };
    expect(m1.records[0]!.checksum).toMatch(KEYED);
    expect(m1.records[0]!.checksum).toBe(await keyedDigest(HASH_M));
    expect(m2.records[0]!.checksum).toBe(m1.records[0]!.checksum);
    noStoredHash(m1);

    const h = (await bridge.query('sys_metadata_history', {})) as { records: Array<Record<string, unknown>> };
    const h1 = h.records.find((r) => r.id === 'h1')!;
    expect(h1.checksum).toMatch(KEYED);
    expect(h1.previous_checksum).toMatch(KEYED);
    expect(h.records.find((r) => r.id === 'h0')!.previous_checksum).toBeNull();
    noStoredHash(h);
  });

  it('get: keyed, equal to the query', async () => {
    const { bridge } = bridgeAs(ADMIN);
    const row = (await bridge.get('sys_metadata', 'm1')) as Record<string, unknown>;
    expect(row.checksum).toBe(await keyedDigest(HASH_M));
    noStoredHash(row);
  });

  it('no provider: both columns are omitted', async () => {
    const { bridge } = bridgeAs(ADMIN, { provider: false });
    const h = (await bridge.query('sys_metadata_history', {})) as { records: Array<Record<string, unknown>> };
    for (const r of h.records) {
      expect('checksum' in r).toBe(false);
      expect('previous_checksum' in r).toBe(false);
      expect(r.name).toBe('v');
    }
    const row = (await bridge.get('sys_metadata', 'm1')) as Record<string, unknown>;
    expect('checksum' in row).toBe(false);
  });

  it('control: another object keeps its own checksum column, raw', async () => {
    const { bridge } = bridgeAs(ADMIN);
    const res = (await bridge.query('file_blob', {})) as { records: Array<Record<string, unknown>> };
    expect(res.records[0]!.checksum).toBe(HASH_M);
  });
});

describe('[#21207] stdio reader: evaluating a content-hash column is refused (INVALID_FIELD / 400)', () => {
  const CASES: Array<[string, string, (b: ReturnType<typeof bridgeAs>['bridge']) => Promise<unknown>, string]> = [
    ['query: filter', 'filter', (b) => b.query('sys_metadata', { where: { checksum: HASH_M } }), 'checksum'],
    ['query: filter on the parent hash', 'filter', (b) => b.query('sys_metadata_history', { where: { previous_checksum: PARENT_H } }), 'previous_checksum'],
    ['query: sort', 'sort', (b) => b.query('sys_metadata', { orderBy: [{ field: 'checksum', order: 'asc' }] }), 'checksum'],
    ['aggregate: group', 'groupBy', (b) => b.aggregate!('sys_metadata', { groupBy: ['checksum'], aggregations: [{ function: 'count', alias: 'n' }] }), 'checksum'],
    ['aggregate: group (object form)', 'groupBy', (b) => b.aggregate!('sys_metadata_history', { groupBy: [{ field: 'previous_checksum' }] as any, aggregations: [{ function: 'count', alias: 'n' }] }), 'previous_checksum'],
    ['aggregate: filter', 'filter', (b) => b.aggregate!('sys_metadata', { where: { checksum: HASH_M }, aggregations: [{ function: 'count', alias: 'n' }] }), 'checksum'],
  ];
  for (const [label, param, run, field] of CASES) {
    it(`${label} → INVALID_FIELD / 400, the engine never asked`, async () => {
      const { bridge, engine } = bridgeAs(ADMIN);
      let caught: any;
      try {
        await run(bridge);
      } catch (err) {
        caught = err;
      }
      expect(caught, 'the call was refused').toBeInstanceOf(Error);
      expect(caught.code).toBe('INVALID_FIELD');
      expect(caught.status).toBe(400);
      expect(caught.param).toBe(param);
      expect(caught.field).toBe(field);
      expect(engine.find).not.toHaveBeenCalled();
      expect(engine.aggregate).not.toHaveBeenCalled();
    });
  }

  it('control: the same shapes on another object\'s checksum column are run', async () => {
    const { bridge, engine } = bridgeAs(ADMIN);
    await bridge.query('file_blob', { where: { checksum: HASH_M }, orderBy: [{ field: 'checksum', order: 'asc' }] });
    await bridge.aggregate!('file_blob', { groupBy: ['checksum'], aggregations: [{ function: 'count', alias: 'n' }] });
    expect(engine.find).toHaveBeenCalledTimes(1);
    expect(engine.aggregate).toHaveBeenCalledTimes(1);
  });
});

describe('[#21207] stdio reader: a member stays refused', () => {
  it('query and get answer the engine\'s PERMISSION_DENIED', async () => {
    const { bridge } = bridgeAs(MEMBER);
    await expect(bridge.query('sys_metadata', {})).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    await expect(bridge.get('sys_metadata_history', 'h1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });
});

// ---------------------------------------------------------------------------
// The ADR-0101 record resource, over the transport — the plugin's own wiring
// ---------------------------------------------------------------------------

async function openStdio(server: any) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const transport = new StdioServerTransport(stdin, stdout);
  await server.connect(transport);
  let nextId = 1;
  let buffered = '';
  const waiting = new Map<number, (frame: any) => void>();
  stdout.on('data', (chunk: Buffer | string) => {
    buffered += String(chunk);
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line) continue;
      const frame = JSON.parse(line);
      if (typeof frame.id === 'number') waiting.get(frame.id)?.(frame);
    }
  });
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const giveUp = setTimeout(() => reject(new Error(`stdio: no answer to ${method}`)), 5_000);
      waiting.set(id, (frame) => {
        clearTimeout(giveUp);
        resolve(frame);
      });
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
    });
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'content-hash-pin', version: '0.0.0' } });
  stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return { rpc, close: () => transport.close().catch(() => {}) };
}

async function readResource(engine: Record<string, unknown>, uri: string): Promise<Record<string, unknown>> {
  const registry = new Map<string, unknown>([['metadata', fakeMetadata()], ['objectql', engine]]);
  const ctx = {
    registerService: vi.fn((name: string, service: unknown) => registry.set(name, service)),
    getService: vi.fn((name: string) => {
      if (!registry.has(name)) throw new Error(`Service "${name}" not found`);
      return registry.get(name);
    }),
    replaceService: vi.fn(),
    getServices: vi.fn(() => registry),
    hook: vi.fn(),
    trigger: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(() => ({})),
  };
  const plugin = new MCPServerPlugin({ autoStart: true });
  await plugin.init(ctx as any);
  const runtime = registry.get('mcp') as MCPServerRuntime;
  vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
  await plugin.start(ctx as any);
  const session = await openStdio(runtime.server);
  try {
    const frame = await session.rpc('resources/read', { uri });
    expect(frame.error, `resources/read ${uri} failed at the protocol level`).toBeUndefined();
    return JSON.parse(frame.result.contents[0].text);
  } finally {
    await session.close();
  }
}

describe('[#21207] stdio record resource: the keyed hash, over the transport', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OS_MCP_SERVER_TRANSPORT;
    delete process.env.OS_MCP_STDIO_ENABLED;
    process.env.OS_MCP_STDIO_API_KEY = 'osk_stored_content_hash_pin';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('administrator: both tables serve keyed values, no stored hash', async () => {
    const m = await readResource(fakeEngine(), 'objectstack://objects/sys_metadata/records/m1');
    expect(m.checksum).toBe(await keyedDigest(HASH_M));
    const h = await readResource(fakeEngine(), 'objectstack://objects/sys_metadata_history/records/h1');
    expect(h.checksum).toMatch(KEYED);
    expect(h.previous_checksum).toMatch(KEYED);
    noStoredHash([m, h]);
  });

  it('no provider: the resource omits both columns', async () => {
    const h = await readResource(fakeEngine({ provider: false }), 'objectstack://objects/sys_metadata_history/records/h1');
    expect('checksum' in h).toBe(false);
    expect('previous_checksum' in h).toBe(false);
    expect(h.name).toBe('v');
  });
});

describe('[#21207] stdio reader: the history change note that quotes a stored hash', () => {
  const QUOTED = `sha256:${'4'.repeat(64)}`;
  const NOTE_ROW = { id: 'h_note', type: 'view', name: 'v', metadata: '{"name":"v"}', checksum: QUOTED, previous_checksum: null, change_note: `publish draft (hash ${QUOTED})` };

  it('is served with the quote keyed, and withheld with no provider', async () => {
    TABLES.sys_metadata_history!.push(NOTE_ROW);
    try {
      const keyed = (await bridgeAs(ADMIN).bridge.get('sys_metadata_history', 'h_note')) as Record<string, unknown>;
      expect(keyed.change_note).toBe(`publish draft (hash ${await keyedDigest(QUOTED)})`);
      const bare = (await bridgeAs(ADMIN, { provider: false }).bridge.get('sys_metadata_history', 'h_note')) as Record<string, unknown>;
      expect(bare.change_note).toBe('publish draft (hash (withheld))');
    } finally {
      TABLES.sys_metadata_history!.pop();
    }
  });

  it('a filter or sort on the change note is refused (INVALID_FIELD / 400)', async () => {
    const { bridge, engine } = bridgeAs(ADMIN);
    for (const run of [
      () => bridge.query('sys_metadata_history', { where: { change_note: 'x' } }),
      () => bridge.query('sys_metadata_history', { orderBy: [{ field: 'change_note', order: 'asc' }] }),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'change_note' });
    }
    expect(engine.find).not.toHaveBeenCalled();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21207] The stored-metadata-body family at the MCP stdio transport.
 *
 * `sys_metadata` / `sys_metadata_history` store one serialized metadata body per
 * row, credential material included. Every surface of the family either serves
 * that body through the ONE projection (`redactStoredMetadataRow`,
 * `@objectstack/spec/kernel`) or refuses — the enumeration is
 * `packages/metadata-protocol/src/stored-metadata-body-family.pin.test.ts`, and
 * this file is the per-package pin its MCP rows name.
 *
 * The stdio transport reads through the engine only — the bridge's verbs and
 * the ADR-0101 record resource both — and the engine returns the stored body as
 * stored. So the projection is applied at this transport, and the shapes that
 * would EVALUATE the body (group, filter, sort, aggregate over it) are refused
 * in the data door's envelope. What is pinned here, by role:
 *
 *  - administrator: no credential material is served by any read verb or by the
 *    record resource, from either table; a credential-free body is served
 *    byte-identical (the control);
 *  - administrator: every evaluate shape on the body column is refused with
 *    `INVALID_FIELD` / 400 and the engine is never asked;
 *  - member: the engine's own refusal reaches the caller unchanged.
 *
 * And the teeth that make a FUTURE reader on this transport fail instead of
 * joining silently: every bridge member is classified, and every engine read
 * call site in this package's sources is enumerated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import ts from 'typescript';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SysMetadataObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import {
  registerMetadataTypeRedactor,
  STORED_METADATA_BODY_OBJECTS,
  type ExecutionContext,
} from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import type { MCPServerRuntime } from './mcp-server-runtime.js';
import { MCPServerPlugin } from './plugin.js';
import {
  createStdioDataBridge,
  serveStoredMetadataRow,
  storedMetadataBodyRefusal,
  type McpStoredMetadataBodyRefusal,
} from './stdio-data-bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The stored rows — credential-bearing bodies, and credential-free controls
// ---------------------------------------------------------------------------

const URL_CRED = 'pin-url-cred-4be1';
const TURSO_CRED = 'pin-turso-cred-77c0';
const EXTRA_CRED = 'pin-extra-cred-0d93';
const CREDENTIALS = [URL_CRED, TURSO_CRED, EXTRA_CRED];

/** A type whose redactor is registered at runtime — the flow / SSO shape, not a built-in. */
const EXTRA_TYPE = 'pin_secretful_type';
registerMetadataTypeRedactor(EXTRA_TYPE, (item) => {
  if (!('token' in item)) return { item, redactedKeys: [] };
  const { token: _token, ...rest } = item;
  return { item: rest, redactedKeys: ['token'] };
});

const BODIES: Record<string, { type: string; body: Record<string, unknown> }> = {
  ds_url: {
    type: 'datasource',
    body: { name: 'ds_url', driver: 'postgres', config: { url: `postgres://u:${URL_CRED}@db.example.invalid:5432/x` } },
  },
  ds_turso: {
    type: 'datasource',
    body: { name: 'ds_turso', driver: 'turso', config: { url: 'libsql://db.example.invalid', encryptionKey: TURSO_CRED } },
  },
  extra: { type: EXTRA_TYPE, body: { name: 'extra', label: 'Extra', token: EXTRA_CRED } },
  // Controls: a redactor-bearing type with nothing to withhold, and a type with no redactor.
  ds_clean: { type: 'datasource', body: { name: 'ds_clean', driver: 'postgres', config: { url: 'postgres://db.example.invalid:5432/x' } } },
  view_clean: { type: 'view', body: { name: 'view_clean', label: 'A view', object: 'task' } },
};
const CONTROLS = ['ds_clean', 'view_clean'];
const CREDENTIAL_BEARING = ['ds_url', 'ds_turso', 'extra'];

function storedRows(prefix: string): Array<Record<string, unknown>> {
  return Object.entries(BODIES).map(([name, { type, body }]) => ({
    id: `${prefix}_${name}`,
    type,
    name,
    metadata: JSON.stringify(body),
    state: 'active',
  }));
}

const TABLES: Record<string, Array<Record<string, unknown>>> = {
  sys_metadata: [
    ...storedRows('m'),
    // A body the redactor cannot judge (its type has a redactor, it does not parse).
    { id: 'm_unparseable', type: 'datasource', name: 'unparseable', metadata: `{"config":{"password":"${URL_CRED}"`, state: 'active' },
  ],
  sys_metadata_history: storedRows('h'),
  task: [{ id: 't1', title: 'an ordinary row', metadata: 'not a stored body' }],
};

// ---------------------------------------------------------------------------
// Doubles — read verbs only (this file never reaches a write)
// ---------------------------------------------------------------------------

const ADMIN = 'usr_admin';
const MEMBER = 'usr_member';

/** The engine's own refusal of a member's read of these tables (its RBAC, not this transport's). */
function permissionDenied(object: string): Error {
  const err = new Error(`Permission denied: cannot read '${object}'`) as Error & { code: string; status: number };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  return err;
}

/** The fixture's ONE where-matcher: scalar equality only; any other shape is refused loudly. */
function matches(row: Record<string, unknown>, where: unknown): boolean {
  for (const [key, cond] of Object.entries((where ?? {}) as Record<string, unknown>)) {
    if (key.startsWith('$') || (cond !== null && typeof cond === 'object')) {
      throw new Error(`fixture where-matcher: unsupported shape on '${key}'`);
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

function fakeEngine(apiKeyOwner = ADMIN) {
  return {
    find: vi.fn(async (object: string, query?: any, options?: any) => {
      // The bridge passes `(obj, query, { context })`; the plugin's resource
      // reader passes `(obj, { where, limit, context })`.
      const context = options?.context ?? query?.context;
      if (object === 'sys_api_key') return [{ id: 'k1', user_id: apiKeyOwner, revoked: false }];
      if (STORED_METADATA_BODY_OBJECTS.has(object) && context?.userId !== ADMIN) throw permissionDenied(object);
      const rows = (TABLES[object] ?? []).filter((row) => matches(row, query?.where));
      const limited = typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
      const fields: string[] | undefined = Array.isArray(query?.fields) ? query.fields : undefined;
      return limited.map((row) =>
        fields ? Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]])) : { ...row },
      );
    }),
    aggregate: vi.fn(async () => [] as unknown[]),
  };
}

const DEFS: Record<string, unknown> = {
  sys_metadata: SysMetadataObject,
  sys_metadata_history: SysMetadataHistoryObject,
  task: { name: 'task', fields: { title: { type: 'text' } } },
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

function bridgeAs(userId: string) {
  const engine = fakeEngine();
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: fakeMetadata() as unknown as IMetadataService,
    resolvePrincipal: async () => ({ userId, isSystem: false }) as unknown as ExecutionContext,
  });
  return { bridge, engine };
}

const credentialsIn = (value: unknown): string[] => {
  const text = JSON.stringify(value);
  return CREDENTIALS.filter((c) => text.includes(c));
};

const storedBodyOf = (table: string, id: string) => TABLES[table]!.find((r) => r.id === id)!.metadata;

// ---------------------------------------------------------------------------
// Administrator: the body is served as its projection
// ---------------------------------------------------------------------------

describe('[#21207] stdio engine-only reader: an administrator is served the projection, never the stored body', () => {
  it('query serves no credential material from either stored-body table, and keeps the rest of each body', async () => {
    const { bridge } = bridgeAs(ADMIN);
    for (const table of STORED_METADATA_BODY_OBJECTS) {
      const res = (await bridge.query(table, {})) as { records: Array<Record<string, unknown>> };
      expect(res.records.length, `${table}: rows reach the caller`).toBeGreaterThan(0);
      expect(credentialsIn(res.records), `${table}: credential material served`).toEqual([]);
      // Projected, not deleted: every credential-bearing body still arrives, minus the withheld material.
      for (const name of CREDENTIAL_BEARING) {
        const row = res.records.find((r) => r.name === name)!;
        const body = JSON.parse(row.metadata as string);
        expect(body.name).toBe(name);
      }
    }
  });

  it('get serves no credential material from either stored-body table', async () => {
    const { bridge } = bridgeAs(ADMIN);
    for (const [table, prefix] of [['sys_metadata', 'm'], ['sys_metadata_history', 'h']] as const) {
      for (const name of CREDENTIAL_BEARING) {
        const row = (await bridge.get(table, `${prefix}_${name}`)) as Record<string, unknown>;
        expect(row, `${table}/${name}: the row is served`).toBeTruthy();
        expect(credentialsIn(row), `${table}/${name}: credential material served`).toEqual([]);
      }
    }
  });

  it('control: a credential-free body is served byte-identical on query and get', async () => {
    const { bridge } = bridgeAs(ADMIN);
    for (const [table, prefix] of [['sys_metadata', 'm'], ['sys_metadata_history', 'h']] as const) {
      const res = (await bridge.query(table, {})) as { records: Array<Record<string, unknown>> };
      for (const name of CONTROLS) {
        const id = `${prefix}_${name}`;
        expect(res.records.find((r) => r.id === id)!.metadata).toBe(storedBodyOf(table, id));
        expect(((await bridge.get(table, id)) as Record<string, unknown>).metadata).toBe(storedBodyOf(table, id));
      }
    }
  });

  it('a body that cannot be judged is withheld, not served (fail-closed)', async () => {
    const { bridge } = bridgeAs(ADMIN);
    const row = (await bridge.get('sys_metadata', 'm_unparseable')) as Record<string, unknown>;
    expect(row.id).toBe('m_unparseable');
    expect('metadata' in row).toBe(false);
    expect(credentialsIn(row)).toEqual([]);
  });

  it('a body-only projection is served projected, with exactly the columns the caller named', async () => {
    const { bridge, engine } = bridgeAs(ADMIN);
    const res = (await bridge.query('sys_metadata', { fields: ['metadata'] })) as {
      records: Array<Record<string, unknown>>;
    };
    expect(credentialsIn(res.records)).toEqual([]);
    // Only the named column comes back — and on every row but the unjudgeable
    // one (withheld, fail-closed), it is there.
    for (const record of res.records) expect(Object.keys(record).filter((k) => k !== 'metadata')).toEqual([]);
    expect(res.records.filter((r) => 'metadata' in r)).toHaveLength(TABLES.sys_metadata!.length - 1);
    // The type column was read so the redactor could be chosen, then taken back off.
    expect(engine.find.mock.calls[0]![1].fields).toEqual(['metadata', 'type']);
  });

  it('rows of every other object pass through as the engine returned them', async () => {
    const { bridge } = bridgeAs(ADMIN);
    const res = (await bridge.query('task', {})) as { records: Array<Record<string, unknown>> };
    expect(res.records).toEqual(TABLES.task);
    expect(serveStoredMetadataRow('task', TABLES.task![0])).toBe(TABLES.task![0]);
  });
});

// ---------------------------------------------------------------------------
// Administrator: the evaluate shapes are refused
// ---------------------------------------------------------------------------

describe('[#21207] stdio engine-only reader: evaluating the body column is refused (INVALID_FIELD / 400)', () => {
  type Case = {
    label: string;
    param: McpStoredMetadataBodyRefusal['param'];
    run: (b: ReturnType<typeof bridgeAs>['bridge']) => Promise<unknown>;
  };
  const CASES: Case[] = [
    { label: 'query: filter', param: 'filter', run: (b) => b.query('sys_metadata', { where: { metadata: 'x' } }) },
    { label: 'query: filter under a combinator', param: 'filter', run: (b) => b.query('sys_metadata_history', { where: { $or: [{ name: 'a' }, { metadata: 'x' }] } }) },
    { label: 'query: filter on a path into the body', param: 'filter', run: (b) => b.query('sys_metadata', { where: { 'metadata.config': 'x' } }) },
    { label: 'query: sort', param: 'sort', run: (b) => b.query('sys_metadata', { orderBy: [{ field: 'metadata', order: 'asc' }] }) },
    { label: 'aggregate: group', param: 'groupBy', run: (b) => b.aggregate!('sys_metadata', { groupBy: ['metadata'], aggregations: [{ function: 'count', alias: 'n' }] }) },
    { label: 'aggregate: group (object form)', param: 'groupBy', run: (b) => b.aggregate!('sys_metadata_history', { groupBy: [{ field: 'metadata' }] as any, aggregations: [{ function: 'count', alias: 'n' }] }) },
    { label: 'aggregate: filter', param: 'filter', run: (b) => b.aggregate!('sys_metadata', { where: { metadata: 'x' }, aggregations: [{ function: 'count', alias: 'n' }] }) },
    { label: 'aggregate: a member\'s own filter', param: 'filter', run: (b) => b.aggregate!('sys_metadata', { aggregations: [{ function: 'count', alias: 'n', filter: { metadata: 'x' } } as any] }) },
    { label: 'aggregate: member over the body', param: 'aggregations', run: (b) => b.aggregate!('sys_metadata', { aggregations: [{ function: 'max', field: 'metadata', alias: 'm' }] }) },
  ];

  for (const c of CASES) {
    it(`${c.label} → INVALID_FIELD / 400, the engine never asked`, async () => {
      const { bridge, engine } = bridgeAs(ADMIN);
      let caught: unknown;
      try {
        await c.run(bridge);
      } catch (err) {
        caught = err;
      }
      expect(caught, 'the call was refused').toBeInstanceOf(Error);
      const err = caught as McpStoredMetadataBodyRefusal;
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.param).toBe(c.param);
      expect(err.field).toBe('metadata');
      expect(engine.find).not.toHaveBeenCalled();
      expect(engine.aggregate).not.toHaveBeenCalled();
    });
  }

  it('control: the same shapes on a scalar column, and on any other object, are run', async () => {
    const { bridge, engine } = bridgeAs(ADMIN);
    await bridge.query('sys_metadata', { where: { type: 'datasource' }, orderBy: [{ field: 'name', order: 'asc' }] });
    await bridge.aggregate!('sys_metadata', { groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n' }] });
    expect(engine.find).toHaveBeenCalledTimes(1);
    expect(engine.aggregate).toHaveBeenCalledTimes(1);
    expect(storedMetadataBodyRefusal('task', { where: { metadata: 'x' }, groupBy: ['metadata'] })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Member: still refused
// ---------------------------------------------------------------------------

describe('[#21207] stdio engine-only reader: a member stays refused', () => {
  it('query and get answer the engine\'s PERMISSION_DENIED and serve nothing', async () => {
    const { bridge } = bridgeAs(MEMBER);
    for (const table of STORED_METADATA_BODY_OBJECTS) {
      await expect(bridge.query(table, {})).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      await expect(bridge.get(table, 'm_ds_url')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    }
  });
});

// ---------------------------------------------------------------------------
// The ADR-0101 record resource — the transport's other engine read, over stdio
// ---------------------------------------------------------------------------

interface Frame {
  id?: number;
  result?: any;
  error?: { code: number; message: string };
}

async function openStdio(server: McpServer) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const transport = new StdioServerTransport(stdin, stdout);
  await server.connect(transport);
  let nextId = 1;
  let buffered = '';
  const waiting = new Map<number, (frame: Frame) => void>();
  stdout.on('data', (chunk: Buffer | string) => {
    buffered += String(chunk);
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line) continue;
      const frame = JSON.parse(line) as Frame;
      if (typeof frame.id === 'number') waiting.get(frame.id)?.(frame);
    }
  });
  const rpc = (method: string, params?: unknown) =>
    new Promise<Frame>((resolve, reject) => {
      const id = nextId++;
      const giveUp = setTimeout(() => reject(new Error(`stdio: no answer to ${method}`)), 5_000);
      waiting.set(id, (frame) => {
        clearTimeout(giveUp);
        resolve(frame);
      });
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
    });
  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'stored-metadata-body-pin', version: '0.0.0' },
  });
  stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return { rpc, close: () => transport.close().catch(() => {}) };
}

/** Boot the real plugin under a key owned by `owner`, and read records through the resource door. */
async function readResources(owner: string, uris: string[]): Promise<Array<Record<string, unknown>>> {
  const registry = new Map<string, unknown>([['metadata', fakeMetadata()], ['objectql', fakeEngine(owner)]]);
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
    const out: Array<Record<string, unknown>> = [];
    for (const uri of uris) {
      const frame = await session.rpc('resources/read', { uri });
      expect(frame.error, `resources/read ${uri} failed at the protocol level`).toBeUndefined();
      out.push(JSON.parse(frame.result.contents[0].text));
    }
    return out;
  } finally {
    await session.close();
  }
}

const recordUri = (table: string, id: string) => `objectstack://objects/${table}/records/${id}`;

describe('[#21207] stdio record resource: the same projection, over the transport', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OS_MCP_SERVER_TRANSPORT;
    delete process.env.OS_MCP_STDIO_ENABLED;
    process.env.OS_MCP_STDIO_API_KEY = 'osk_stored_metadata_body_pin';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('administrator: no credential material from either table; a credential-free body is byte-identical', async () => {
    const [mUrl, hTurso, mExtra, mClean, hView] = await readResources(ADMIN, [
      recordUri('sys_metadata', 'm_ds_url'),
      recordUri('sys_metadata_history', 'h_ds_turso'),
      recordUri('sys_metadata', 'm_extra'),
      recordUri('sys_metadata', 'm_ds_clean'),
      recordUri('sys_metadata_history', 'h_view_clean'),
    ]);
    for (const served of [mUrl, hTurso, mExtra]) {
      expect(served!.error, 'the record is served').toBeUndefined();
      expect(credentialsIn(served)).toEqual([]);
    }
    expect(mClean!.metadata).toBe(storedBodyOf('sys_metadata', 'm_ds_clean'));
    expect(hView!.metadata).toBe(storedBodyOf('sys_metadata_history', 'h_view_clean'));
  });

  it('member: the resource answers the engine\'s refusal and serves no row', async () => {
    const [served] = await readResources(MEMBER, [recordUri('sys_metadata', 'm_ds_url')]);
    expect(typeof served!.error).toBe('string');
    expect(served!.metadata).toBeUndefined();
    expect(credentialsIn(served)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The teeth: a future reader on this transport fails here
// ---------------------------------------------------------------------------

/**
 * Every member of the stdio bridge, and what it does with a stored body. A new
 * member fails the first test below until it is classified — routed through the
 * projection, refused, or shown to serve no row body.
 */
const BRIDGE_MEMBERS: Record<string, string> = {
  listObjects: 'no row body — object definitions from the metadata service',
  listObjectsDiagnosed: 'no row body — object definitions from the metadata service',
  describeObject: 'no row body — one object definition from the metadata service',
  query: 'seam — serveStoredMetadataRows; filter / sort on the body column refused',
  get: 'seam — serveStoredMetadataRow',
  aggregate: 'refuses — group / filter / aggregate member on the body column',
  create: 'refused by the exposure gate — the stored-body tables admit no write verb (family pin)',
  update: 'refused by the exposure gate — the stored-body tables admit no write verb (family pin)',
  remove: 'refused by the exposure gate — the stored-body tables admit no write verb (family pin)',
};

/**
 * Every engine read call site in this package's non-test sources, by file, keyed
 * `verb(first argument)`. The reader each one belongs to is named; a new call
 * site fails the second test below until it is routed through the projection or
 * refuses, and listed here.
 *
 * Found on the syntax tree by the CALL, not by the receiver's name: an engine
 * read's first argument is an object name, while an array's `find` takes a
 * callback — so any receiver (a renamed variable, a cast) is caught, a
 * callback-taking `find` is not, and a call spelled inside a comment is not a
 * call at all.
 */
const ENGINE_READ_SITES: Record<string, Record<string, number>> = {
  // findById (get, and the update / remove existence probes) and query; aggregate.
  'stdio-data-bridge.ts': { 'find(object)': 2, 'aggregate(object)': 1 },
  // The ADR-0101 record resource reader.
  'plugin.ts': { 'find(objectName)': 1 },
};

const ENGINE_READ_VERBS: ReadonlySet<string> = new Set(['find', 'findOne', 'aggregate', 'count']);

/** Every `verb(first argument)` engine-read-shaped call in one source file, counted. */
function engineReadSites(file: string, text: string): Record<string, number> {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: Record<string, number> = {};
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ENGINE_READ_VERBS.has(node.expression.name.text)
    ) {
      const first = node.arguments[0];
      if (first && !ts.isArrowFunction(first) && !ts.isFunctionExpression(first)) {
        const site = `${node.expression.name.text}(${first.getText(sf)})`;
        sites[site] = (sites[site] ?? 0) + 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

describe('[#21207] stdio transport: every reader is classified (a new one fails here, not silently)', () => {
  it('every stdio bridge member is classified', () => {
    const { bridge } = bridgeAs(ADMIN);
    expect(Object.keys(bridge).sort()).toEqual(Object.keys(BRIDGE_MEMBERS).sort());
  });

  it('every engine read call site in this package is enumerated', () => {
    const found: Record<string, Record<string, number>> = {};
    for (const file of readdirSync(HERE)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.d.ts')) continue;
      const sites = engineReadSites(file, readFileSync(join(HERE, file), 'utf8'));
      if (Object.keys(sites).length > 0) found[file] = sites;
    }
    expect(found).toEqual(ENGINE_READ_SITES);
  });

  it('the stored-body tables declare no write verb, which is what refuses create / update / remove here', () => {
    for (const def of [SysMetadataObject, SysMetadataHistoryObject] as any[]) {
      const methods: string[] = def.enable?.apiMethods ?? [];
      for (const write of ['create', 'update', 'delete']) expect(methods).not.toContain(write);
    }
  });
});

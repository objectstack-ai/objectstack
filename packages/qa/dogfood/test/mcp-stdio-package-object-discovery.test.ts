// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25138] The MCP stdio door sees the objects a PACKAGE contributes: listed,
 * described, and refused by every data verb when the package declares their
 * API exposure off, on every kernel shape, the `environmentId` kernel
 * included. The stdio twin of the `/mcp` HTTP bridge's pins
 * (`packages/runtime/src/domains/mcp-package-object-discovery.test.ts`).
 *
 * ## The defect
 *
 * The stdio data bridge (`packages/mcp/src/stdio-data-bridge.ts`) answered
 * `list_objects` / `describe_object` from the `metadata` service
 * (`listObjects()` / `getObject()`), and its exposure gate read the same
 * service. That service holds a copy of an object only where something put one
 * there. On a kernel with an `environmentId` (`createStandaloneStack`'s
 * composition: `os dev` as `env_local`, `os serve`, `os start`, and the cloud
 * single-environment runtime) the full boot bridge is off, so an object a
 * package registers in the `SchemaRegistry` during the boot has no copy.
 * Measured on this file's kernel at the base tree, through the real
 * `MCPServerPlugin` stdio session, for a package registered during the boot of
 * the `env_local` shape: `list_objects` answered `{ objects: [], totalCount: 0 }`,
 * `describe_object` answered `Object "qa_pkg_open" not found`, and
 * `query_records` on the package's object declared `apiEnabled: false` was
 * served. The other three rows (no `environmentId`, and a marketplace install
 * on either shape) copy the package's objects, so they were right and must
 * stay right.
 *
 * A disabled package's objects: the protocol omits them from its listing and
 * refuses them by name `404 OBJECT_PACKAGE_DISABLED`, and its data plane
 * refuses them on every REST route. Every verb of the stdio bridge asks the
 * ENGINE, never the protocol, and the engine serves them; on the shape that
 * copies, the copy outlives the disable, so the bridge listed and described
 * them too.
 *
 * ## The fix, and where these pins sit
 *
 * The bridge reads the protocol: discovery from its merged listing
 * (`getMetaItems`), the read `GET /api/v1/meta/object` serves, and the gate
 * from its by-name read, the one `RestServer`'s gate makes; a disabled
 * package's object is refused with the protocol's own error. The pins drive
 * the plugin's own stdio server over an in-process transport speaking the
 * JSON-RPC a stdio client speaks.
 *
 * [#25245] The `objectstack://objects` resources read the same view. They read
 * the `metadata` service until then: measured on the `env_local` boot row at
 * the base tree, `resources/read` of `objectstack://objects` answered
 * `{ objects: [], totalCount: 0 }` and of `objectstack://objects/qa_pkg_open`
 * `404 RESOURCE_NOT_FOUND`, while the tools listed and described both; and on
 * the shape that copies, they still listed and described a disabled package's
 * objects. Their pins sit beside the tools' and assert the two answer alike.
 *
 * ## What is real, and the one seam that is not
 *
 * As in `mcp-stdio-runtime-object-exposure.test.ts`: the kernel is real
 * (`ObjectKernel`, `MetadataPlugin`, `ObjectQLPlugin` in the two shapes), and
 * so are the `metadata` and `protocol` services, the engine and its registry,
 * the `manifest` service the package registers through (from a plugin's
 * `init()`, during the boot, the way capability plugins register their objects;
 * or after the boot with `source: 'marketplace'`, the way marketplace install
 * registers a package), and the `MCPServerPlugin` whose `start()` builds the
 * stdio data bridge. The one seam faked is the key row the stdio principal
 * resolves from.
 *
 * The negative control (red with the fix ablated) is a one-time ablation,
 * cited in the PR, not a permanent case.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MCPServerPlugin, MCPServerRuntime } from '@objectstack/mcp';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import type { IMetadataService } from '@objectstack/spec/contracts';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `mcp-stdio-runtime-object-exposure.test.ts`; equality-only WHERE. */
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

/** The `manifest` service door a package registers through (`ObjectQLPlugin`'s `register`). */
interface ManifestDoor {
  register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> | void;
}

/** A package of two objects, one of them declared off the API; the other carries an `internal: true` field. */
function packageOf(prefix: string) {
  const open = `${prefix}_open`;
  const gated = `${prefix}_gated`;
  return {
    id: `com.qa.${prefix}`,
    open,
    gated,
    artifact: () => ({
      id: `com.qa.${prefix}`,
      name: `${prefix} package`,
      version: '1.0.0',
      type: 'app',
      objects: [
        {
          name: open,
          label: 'Open',
          fields: {
            name: { name: 'name', type: 'text', label: 'Name' },
            vault_secret: { name: 'vault_secret', type: 'text', label: 'Vault secret', internal: true },
          },
        },
        {
          name: gated,
          label: 'Gated',
          enable: { apiEnabled: false },
          fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        },
      ],
    }),
  };
}

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

interface Booted {
  kernel: ObjectKernel;
  engine: ObjectQL;
  stores: Stores;
  root: string;
  call(name: string, args: Record<string, unknown>): Promise<ToolAnswer>;
  /** What `resources/read` on a record URI answered, parsed. */
  readRecord(object: string, id: string): Promise<any>;
  /** [#25245] What `resources/read` on `uri` answered, parsed. */
  readResource(uri: string): Promise<any>;
}

/**
 * One kernel in the shape under test, with `pkg` registered through the
 * `manifest` service `when` asked, then a stdio session over it. `beforeStart`
 * runs after the boot and before the stdio plugin starts (a package disable).
 */
async function boot(
  environmentId: string | undefined,
  when: 'boot' | 'install',
  pkg: ReturnType<typeof packageOf>,
  beforeStart?: (kernel: ObjectKernel, engine: ObjectQL) => Promise<void>,
): Promise<Booted> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  const root = mkdtempSync(join(tmpdir(), 'os-mcp-stdio-package-objects-'));
  const stores: Stores = new Map();
  const engine = new ObjectQL();
  engine.registerDriver(makeMemoryDriver(stores), true);
  if (environmentId === undefined) {
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
  } else {
    const artifact = join(root, 'objectstack.json');
    writeFileSync(artifact, JSON.stringify({
      manifest: { id: 'com.qa.empty', name: 'empty', version: '0.0.0', type: 'app' },
      objects: [], views: [], apps: [], flows: [], requires: [],
    }));
    await kernel.use(new MetadataPlugin({
      watch: false, artifactWatch: false, environmentId,
      artifactSource: { mode: 'local-file', path: artifact }, rootDir: root,
    }));
    await kernel.use(new ObjectQLPlugin({ ql: engine, environmentId, hydrateMetadataFromDb: true }));
  }
  const host: Plugin = {
    name: 'qa.package-host',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      if (when === 'boot') await ctx.getService<ManifestDoor>('manifest').register(pkg.artifact());
    },
  };
  await kernel.use(host);
  await kernel.bootstrap();
  if (when === 'install') {
    await kernel.getService<ManifestDoor>('manifest').register(pkg.artifact(), { source: 'marketplace' });
  }
  await beforeStart?.(kernel, engine);

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
    clientInfo: { name: 'mcp-stdio-package-object-discovery', version: '0.0.0' },
  });
  session.notify('notifications/initialized');

  return {
    kernel,
    engine,
    stores,
    root,
    async call(name, args) {
      const frame = await session.rpc('tools/call', { name, arguments: args });
      expect(frame.error, `tools/call ${name} failed at the protocol level`).toBeUndefined();
      const text = frame.result.content[0].text as string;
      let json: any;
      try { json = JSON.parse(text); } catch { /* a bare error sentence */ }
      return { isError: frame.result.isError === true, text, json };
    },
    async readRecord(object, id) {
      return this.readResource(`objectstack://objects/${object}/records/${id}`);
    },
    async readResource(uri) {
      const frame = await session.rpc('resources/read', { uri });
      expect(frame.error, `resources/read ${uri} failed at the protocol level`).toBeUndefined();
      return JSON.parse(frame.result.contents[0].text as string);
    },
  };
}

async function shutdown(booted: Booted | undefined): Promise<void> {
  if (!booted) return;
  if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
  rmSync(booted.root, { recursive: true, force: true });
}

/** The coded envelope a refused tool call carries, or `'SERVED'`. */
const outcome = (answer: ToolAnswer) =>
  (answer.isError ? { code: answer.json?.error?.code, status: answer.json?.error?.status } : 'SERVED');

/** The non-system names of an `{ objects }` listing. */
const nonSystemNames = (listing: { objects?: Array<{ name: string }> } | undefined) =>
  (listing?.objects ?? []).map((o) => o.name).filter((n) => !/^sys_/i.test(n));

const nonSystem = (answer: ToolAnswer) => nonSystemNames(answer.json);

/** [#25245] The two object resources' URIs. */
const OBJECT_LIST_URI = 'objectstack://objects';
const objectUri = (name: string) => `objectstack://objects/${name}`;

/** The six MCP data tools, each called on `object`. */
const DATA_TOOLS: ReadonlyArray<readonly [string, (object: string) => Record<string, unknown>]> = [
  ['query_records', (o) => ({ objectName: o })],
  ['get_record', (o) => ({ objectName: o, recordId: 'r_any' })],
  ['aggregate_records', (o) => ({ objectName: o, aggregations: [{ function: 'count', alias: 'n' }] })],
  ['create_record', (o) => ({ objectName: o, data: { name: 'written' } })],
  ['update_record', (o) => ({ objectName: o, recordId: 'r_any', data: { name: 'written' } })],
  ['delete_record', (o) => ({ objectName: o, recordId: 'r_any' })],
];

/** Every engine call a data tool could reach `object`'s store through. */
function storeSpies(engine: ObjectQL, object: string) {
  const spies = (['find', 'findOne', 'insert', 'update', 'delete', 'count', 'aggregate'] as const)
    .map((m) => vi.spyOn(engine as any, m));
  return {
    reached: () => spies.flatMap((s) => s.mock.calls).filter((args) => args[0] === object).length,
    restore: () => { for (const s of spies) s.mockRestore(); },
  };
}

const SHAPES = [
  { shape: 'environmentId env_local (createStandaloneStack)', environmentId: 'env_local' },
  { shape: 'no environmentId', environmentId: undefined },
] as const;
const REGISTRATIONS = [
  { label: 'registered during the boot', when: 'boot' },
  { label: 'installed after the boot, as marketplace install registers it', when: 'install' },
] as const;

const ORIGINAL_KEY = process.env.OS_MCP_STDIO_API_KEY;
beforeAll(() => {
  process.env.OS_MCP_STDIO_API_KEY = 'osk_mcp_stdio_package_object_discovery';
});
afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OS_MCP_STDIO_API_KEY;
  else process.env.OS_MCP_STDIO_API_KEY = ORIGINAL_KEY;
});

for (const { shape, environmentId } of SHAPES) {
  for (const { label, when } of REGISTRATIONS) {
    describe(`[#25138] the MCP stdio door and a package's objects — ${shape}, ${label}`, () => {
      const pkg = packageOf('qa_pkg');
      let k: Booted | undefined;

      beforeAll(async () => {
        k = await boot(environmentId, when, pkg);
      }, 60_000);
      afterAll(async () => {
        vi.restoreAllMocks();
        await shutdown(k);
      }, 60_000);

      it('list_objects lists both package objects, with a complete totalCount', async () => {
        const listed = await k!.call('list_objects', {});
        expect(listed.isError).toBe(false);
        expect(nonSystem(listed)).toEqual(expect.arrayContaining([pkg.open, pkg.gated]));
        expect(listed.json.totalCount).toBe(nonSystem(listed).length);
      });

      it('describe_object answers both package objects, the declared exposure included', async () => {
        const open = await k!.call('describe_object', { objectName: pkg.open });
        const gated = await k!.call('describe_object', { objectName: pkg.gated });

        expect(open.isError).toBe(false);
        expect(open.json.name).toBe(pkg.open);
        expect(open.json.fields.map((f: any) => f.name)).toContain('name');
        expect(gated.isError).toBe(false);
        expect(gated.json).toMatchObject({ name: pkg.gated, enableFeatures: { apiEnabled: false } });
        // The control: a name nothing serves is still "not found".
        expect(await k!.call('describe_object', { objectName: 'qa_pkg_nowhere' }))
          .toMatchObject({ isError: true, text: expect.stringContaining('not found') });
      });

      it('[#25245] resources/read objectstack://objects lists both package objects, with a complete totalCount — the listing list_objects serves', async () => {
        const listed = await k!.readResource(OBJECT_LIST_URI);
        expect(nonSystemNames(listed)).toEqual(expect.arrayContaining([pkg.open, pkg.gated]));
        expect(listed).not.toHaveProperty('partial');
        expect(listed.totalCount).toBe(listed.objects.length);
        expect(nonSystemNames(listed).sort()).toEqual(nonSystem(await k!.call('list_objects', {})).sort());
      });

      it('[#25245] resources/read objectstack://objects/NAME answers both package objects as describe_object does, the declared exposure included', async () => {
        const open = await k!.readResource(objectUri(pkg.open));
        const gated = await k!.readResource(objectUri(pkg.gated));

        expect(open.name).toBe(pkg.open);
        expect(open.fields.map((f: any) => f.name)).toContain('name');
        expect(gated).toMatchObject({ name: pkg.gated, enableFeatures: { apiEnabled: false } });
        expect(open).toEqual((await k!.call('describe_object', { objectName: pkg.open })).json);
        expect(gated).toEqual((await k!.call('describe_object', { objectName: pkg.gated })).json);
        // The control: a name nothing serves is still the coded miss.
        expect(await k!.readResource(objectUri('qa_pkg_nowhere'))).toEqual({
          error: 'Object "qa_pkg_nowhere" not found',
          code: 'RESOURCE_NOT_FOUND',
          status: 404,
        });
      });

      for (const [tool, args] of DATA_TOOLS) {
        it(`${tool} refuses the object the package declared apiEnabled: false — 404 OBJECT_API_DISABLED, the store never asked`, async () => {
          const store = storeSpies(k!.engine, pkg.gated);
          try {
            expect(outcome(await k!.call(tool, args(pkg.gated)))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
            expect(store.reached(), `${tool} reached the store`).toBe(0);
          } finally {
            store.restore();
          }
        });
      }

      it('the record resource refuses it too — 404 OBJECT_API_DISABLED', async () => {
        expect(await k!.readRecord(pkg.gated, 'r_any')).toMatchObject({ code: 'OBJECT_API_DISABLED', status: 404 });
      });

      it('the package\'s exposed object is queried and written, and create_record does not echo its internal: true field', async () => {
        expect(outcome(await k!.call('query_records', { objectName: pkg.open }))).toBe('SERVED');
        const created = await k!.call('create_record', { objectName: pkg.open, data: { name: 'rec-1', vault_secret: 'v' } });
        expect(created.isError, created.text).toBe(false);
        expect(created.json.record).toMatchObject({ name: 'rec-1' });
        expect(created.json.record).not.toHaveProperty('vault_secret');
      });
    });
  }
}

for (const { shape, environmentId } of SHAPES) {
  describe(`[#25138] a DISABLED package's objects on the MCP stdio door — ${shape}: omitted as GET /meta/object omits them, refused as REST refuses them`, () => {
    const pkg = packageOf('qa_off');
    let k: Booted | undefined;

    beforeAll(async () => {
      k = await boot(environmentId, 'boot', pkg, async (kernel, engine) => {
        expect((engine as any).registry.disablePackage(pkg.id), 'precondition: disabled').toBeTruthy();
        if (environmentId === undefined) {
          // No `environmentId`, so the boot bridge HAS copied both objects
          // into the `metadata` service, and the copy outlives the disable.
          for (const name of [pkg.open, pkg.gated]) {
            expect(
              await kernel.getService<IMetadataService>('metadata').getObject(name),
              `precondition: the metadata service still holds ${name}'s copy`,
            ).toBeTruthy();
          }
        }
      });
    }, 60_000);
    afterAll(async () => {
      vi.restoreAllMocks();
      await shutdown(k);
    }, 60_000);

    it('neither listed nor described', async () => {
      const listed = nonSystem(await k!.call('list_objects', {}));
      expect(listed).not.toContain(pkg.open);
      expect(listed).not.toContain(pkg.gated);
      for (const name of [pkg.open, pkg.gated]) {
        expect(await k!.call('describe_object', { objectName: name }))
          .toMatchObject({ isError: true, text: expect.stringContaining('not found') });
      }
    });

    it('[#25245] neither listed nor described by the objectstack://objects resources — the coded miss, as describe_object answers', async () => {
      const listed = nonSystemNames(await k!.readResource(OBJECT_LIST_URI));
      expect(listed).not.toContain(pkg.open);
      expect(listed).not.toContain(pkg.gated);
      for (const name of [pkg.open, pkg.gated]) {
        expect(await k!.readResource(objectUri(name))).toEqual({
          error: `Object "${name}" not found`,
          code: 'RESOURCE_NOT_FOUND',
          status: 404,
        });
      }
    });

    for (const object of ['open', 'gated'] as const) {
      for (const [tool, args] of DATA_TOOLS) {
        it(`${tool} refuses its ${object} object — 404 OBJECT_PACKAGE_DISABLED, the store never asked`, async () => {
          const name = pkg[object];
          const store = storeSpies(k!.engine, name);
          try {
            expect(outcome(await k!.call(tool, args(name)))).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404 });
            expect(store.reached(), `${tool} reached the store`).toBe(0);
          } finally {
            store.restore();
          }
        });
      }

      it(`the record resource refuses its ${object} object — 404 OBJECT_PACKAGE_DISABLED`, async () => {
        expect(await k!.readRecord(pkg[object], 'r_any')).toMatchObject({ code: 'OBJECT_PACKAGE_DISABLED', status: 404 });
      });
    }
  });
}

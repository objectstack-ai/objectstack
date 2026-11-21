// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Verify writes only to stores it creates: a declared MANAGED datasource runs
 * on an ephemeral stand-in, never on the database it names, on every engine
 * the platform ships, `mongodb` included; one on a driver id a plugin supplies
 * cannot be stood in, and the boot is refused.
 *
 * The fixture declares two managed secondary datasources, each with a
 * recording medium behind it:
 *
 *  - one on a real, file-backed SQLite database, the kind `objectstack dev`
 *    opens and writes: whatever reaches it lands in that file;
 *  - one on `mongodb`, pointed at a local TCP listener that counts every
 *    connection made to it. The app seeds an object on it, and a hook on
 *    another object writes into it.
 *
 * The derived write families run over objects bound to both on one boot (the
 * CRUD round trip, reference shapes, delete behaviours and unique scopes),
 * plus a REST create. The pins:
 *
 *  - nothing reached either real store: the file was never created, and the
 *    listener saw no connection;
 *  - coverage is kept: both objects' CRUD cases ran and were verified against
 *    the stand-ins, the REST create answered and read back, and the app's seed
 *    and hook rows for the mongodb object are in the stand-in;
 *  - CONTROL: the factory `objectstack dev` builds declared datasources with
 *    opens that very file and writes a row into it, and connects to that very
 *    listener, for the same declarations, so the silence above is verify's
 *    stand-in and not an unreachable store.
 *
 * A second describe pins the refusal: a managed datasource on a plugin's
 * driver id refuses the boot before anything is composed, naming the
 * datasource and the driver id, and the plugin's recording driver is never
 * called; its CONTROL is the same plugin driver behind an external datasource
 * in the boot above, which a REST write reaches. A third and fourth pin the
 * factory and the refusal reader without a boot.
 *
 * ⚠️ This suite resolves `@objectstack/runtime` and the service packages
 * through their BUILT `dist/`. Rebuild them before trusting a run of this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineStack } from '@objectstack/spec';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataDriver } from '@objectstack/spec/contracts';
import {
  createDefaultDatasourceDriverFactory,
  type DatasourceConnectionSpec,
  type IDatasourceDriverFactory,
} from '@objectstack/service-datasource';

import { bootStack, type VerifyStack } from './harness.js';
import { runCrudVerification, formatReport, type VerifyReport } from './verify.js';
import { runReferenceShapeProofs, formatReferenceShapeReport } from './reference-shape.js';
import { runDeleteBehaviorProofs, formatDeleteBehaviorReport } from './delete-behavior.js';
import { runUniqueScopeProofs, formatUniqueScopeReport } from './unique-scope.js';
import {
  createVerifyDatasourceDriverFactory,
  unstandableManagedDatasources,
  unstandableManagedDatasourceRefusal,
} from './managed-datasource-stand-in.js';
import { deriveCrudCases } from './derive.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Paid at collection: the harness's boot loads these lazily (check:test-source-alias).
import '@objectstack/service-automation';

await warmUpBoot();

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const SIDE_DS = 'vms_side_ds';
const SIDE = 'vms_side';
const LOCAL = 'vms_local';
const DOCS_DS = 'vms_docs_ds';
const DOC = 'vms_doc';
const PLUG_DS = 'vms_plug_ds';
const PLUG_DRIVER = 'vms_plug_driver';
const PLUG = 'vms_plug';

const dir = mkdtempSync(join(tmpdir(), 'verify-managed-ds-'));
const realDatabase = join(dir, 'side.db');

const sideDatasource = {
  name: SIDE_DS,
  label: 'Managed side store (real file)',
  driver: 'sqlite-wasm',
  schemaMode: 'managed',
  config: { filename: realDatabase },
} as const;

// ── The mongodb datasource's recording medium: a listener counting connections ──

let mongoConnections = 0;
const mongoListener = net.createServer((socket) => {
  mongoConnections += 1;
  socket.destroy();
});
await new Promise<void>((resolve) => mongoListener.listen(0, '127.0.0.1', () => resolve()));
const mongoPort = (mongoListener.address() as net.AddressInfo).port;

const docsDatasource = {
  name: DOCS_DS,
  label: 'Managed document store (real mongodb address)',
  driver: 'mongodb',
  schemaMode: 'managed',
  config: { url: `mongodb://127.0.0.1:${mongoPort}/vms?serverSelectionTimeoutMS=2000&connectTimeoutMS=2000` },
} as const;

// ── A plugin-supplied driver that records every call it receives ──

type Call = { method: string; object?: string };

/** A driver this suite owns, registered by a plugin as `driver.NAME`. Every call is recorded. */
function recordingDriverPlugin(datasource: string, calls: Call[]): Plugin {
  const record = (method: string, answer: (n: number) => unknown = () => null) => async (object?: string) => {
    calls.push({ method, object });
    return answer(calls.length);
  };
  const driver = {
    name: datasource,
    version: '0.0.1',
    supports: { transactionsUnsupported: true },
    connect: record('connect'),
    disconnect: record('disconnect'),
    checkHealth: record('checkHealth', () => true),
    find: record('find', () => []),
    findOne: record('findOne'),
    count: record('count', () => 0),
    execute: record('execute'),
    create: record('create', (n) => ({ id: `plug_${n}` })),
    update: record('update'),
    delete: record('delete'),
    upsert: record('upsert'),
    bulkCreate: record('bulkCreate'),
    bulkUpdate: record('bulkUpdate'),
    bulkDelete: record('bulkDelete'),
    updateMany: record('updateMany'),
    deleteMany: record('deleteMany'),
    beginTransaction: record('beginTransaction', () => ({})),
    commit: record('commit'),
    rollback: record('rollback'),
    syncSchema: record('syncSchema'),
    dropTable: record('dropTable'),
  } as unknown as IDataDriver;
  return {
    name: `com.objectstack.verify.managed-stand-in.${datasource}`,
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
      calls.push({ method: 'plugin.init' });
      ctx.registerService(`driver.${datasource}`, driver);
    },
  };
}

/** The plugin driver as the control reaches it: behind an EXTERNAL datasource, which verify does not refuse. */
const controlPlugCalls: Call[] = [];

const hookErrors: string[] = [];

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.managed-stand-in',
    namespace: 'vms',
    version: '0.0.0',
    type: 'app',
    name: 'Managed Stand-in Fixture',
    description: 'An app declaring managed secondary datasources on a real database file and a real mongodb address.',
  },
  datasources: [
    sideDatasource,
    docsDatasource,
    {
      name: PLUG_DS,
      label: 'Plugin store (external, the control)',
      driver: PLUG_DRIVER,
      schemaMode: 'external',
      config: {},
      external: { allowWrites: true, validation: { onMismatch: 'fail', checkOnBoot: false } },
    },
  ],
  objects: [
    {
      name: LOCAL,
      label: 'Local',
      pluralLabel: 'Locals',
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    },
    {
      name: SIDE,
      label: 'Side',
      pluralLabel: 'Sides',
      datasource: SIDE_DS,
      sharingModel: 'public_read_write',
      fields: {
        // In each family's population: a unique field, and a reference with a delete behaviour.
        serial: { type: 'text', label: 'Serial', unique: true },
        local_ref: { type: 'lookup', reference: LOCAL, label: 'Local', deleteBehavior: 'set_null' },
      },
    },
    {
      name: DOC,
      label: 'Doc',
      pluralLabel: 'Docs',
      datasource: DOCS_DS,
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        local_ref: { type: 'lookup', reference: LOCAL, label: 'Local', deleteBehavior: 'set_null' },
      },
    },
    {
      name: PLUG,
      label: 'Plug',
      pluralLabel: 'Plugs',
      datasource: PLUG_DS,
      external: { remoteName: PLUG, writable: true },
      sharingModel: 'public_read_write',
      tenancy: { enabled: false },
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
  hooks: [
    {
      // The app's own write into the mongodb datasource, fired by any insert of a local.
      name: 'vms_local_writes_doc',
      object: LOCAL,
      events: ['afterInsert'],
      async: true,
      handler: async (ctx: { input?: { data?: Record<string, unknown> }; api: any }) => {
        try {
          await ctx.api.object(DOC).insert({ name: `HOOK-${String(ctx.input?.data?.name ?? '')}` });
        } catch (e) {
          hookErrors.push(String((e as Error)?.message ?? e));
        }
      },
    },
  ],
  data: [
    {
      object: DOC,
      mode: 'upsert',
      records: [{ name: 'SEED-1' }, { name: 'SEED-2' }],
    },
  ],
  plugins: [recordingDriverPlugin(PLUG_DS, controlPlugCalls)],
} as never);

const CONTROL_TABLE = 'vms_control';

/** Rows of `table` in the real database file, read through the factory `objectstack dev` uses. */
async function rowsIn(table: string): Promise<number> {
  const handle = await createDefaultDatasourceDriverFactory().create({
    ...sideDatasource,
    config: { ...sideDatasource.config },
  } as DatasourceConnectionSpec);
  await handle.connect?.();
  try {
    return ((await (handle.driver as any).find(table, {})) as unknown[]).length;
  } catch {
    return 0; // no such table
  } finally {
    await handle.disconnect?.();
  }
}

/** Whether the real database file exists, and how many fixture rows it holds. */
async function realDatabaseState(): Promise<{ exists: boolean; rows: number }> {
  if (!existsSync(realDatabase)) return { exists: false, rows: 0 };
  return { exists: true, rows: await rowsIn(SIDE) };
}

/** The mongodb object's rows, as the stand-in answers them through the REST door. */
async function docNames(stack: VerifyStack, token: string): Promise<string[]> {
  const res = await stack.apiAs(token, 'GET', `/data/${DOC}?$top=200`);
  const body = JSON.parse(await res.text()) as { data?: unknown; records?: unknown };
  const data = body.data as { records?: unknown } | unknown[] | undefined;
  const rows = (Array.isArray(data) ? data : (data as { records?: unknown })?.records ?? body.records ?? []) as Array<{
    name?: unknown;
  }>;
  return rows.map((row) => String(row.name));
}

describe('os verify runs a declared managed datasource on an ephemeral stand-in, never on its real database', () => {
  let stack: VerifyStack | undefined;
  let crud: VerifyReport;
  const reports: Record<string, string> = {};
  let restCreate: { status: number; readBack: number; body: string };
  let docRows: string[] = [];
  let connectionsDuringRun = -1;
  const plugCallsDuringRest: Call[] = [];

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as never, {});
    const token = await stack.signIn();
    crud = await runCrudVerification(stack, token, fixtureStack);
    reports.crud = formatReport(crud);
    reports.referenceShapes = formatReferenceShapeReport(await runReferenceShapeProofs(stack, token, fixtureStack));
    reports.deleteBehaviors = formatDeleteBehaviorReport(await runDeleteBehaviorProofs(stack, token, fixtureStack));
    reports.uniqueScopes = formatUniqueScopeReport(await runUniqueScopeProofs(stack, token, fixtureStack));
    // A write outside verify's derived families reaches the same datasource.
    const created = await stack.apiAs(token, 'POST', `/data/${SIDE}`, { serial: 'rest-create' });
    const body = await created.text();
    const id = (JSON.parse(body) as { data?: { id?: string }; id?: string }).data?.id
      ?? (JSON.parse(body) as { id?: string }).id;
    const read = await stack.apiAs(token, 'GET', `/data/${SIDE}/${id}`);
    restCreate = { status: created.status, readBack: read.status, body };
    // The hook is async: read the mongodb object's rows once one hook row has landed.
    const deadline = Date.now() + 15_000;
    do {
      docRows = await docNames(stack, token);
      if (docRows.some((name) => name.startsWith('HOOK-'))) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    // CONTROL for the refusal below: the plugin's driver behind an external
    // datasource, which verify boots, takes a REST write.
    const mark = controlPlugCalls.length;
    await stack.apiAs(token, 'POST', `/data/${PLUG}`, { name: 'control' });
    plugCallsDuringRest.push(...controlPlugCalls.slice(mark));
    await stack.stop();
    stack = undefined;
    connectionsDuringRun = mongoConnections;
  }, BOOT_TIMEOUT * 2);

  afterAll(async () => {
    await stack?.stop().catch(() => undefined);
    await new Promise<void>((resolve) => mongoListener.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('nothing reached the real database: its file was never created', async () => {
    expect(await realDatabaseState(), Object.values(reports).join('\n')).toEqual({ exists: false, rows: 0 });
  });

  it('nothing reached the real mongodb address: no connection was ever made to it', () => {
    expect(connectionsDuringRun, Object.values(reports).join('\n')).toBe(0);
  });

  it("both objects' CRUD cases still ran, and passed against the stand-ins", () => {
    expect(crud.results.find((r) => r.object === SIDE)?.status, reports.crud).toBe('verified');
    expect(crud.results.find((r) => r.object === DOC)?.status, reports.crud).toBe('verified');
  });

  it("the app's seed and its hook wrote the mongodb object's rows into the stand-in", () => {
    expect(docRows, JSON.stringify(docRows)).toEqual(expect.arrayContaining(['SEED-1', 'SEED-2']));
    expect(docRows.filter((name) => name.startsWith('HOOK-')).length, JSON.stringify(docRows)).toBeGreaterThan(0);
    expect(hookErrors).toEqual([]);
  });

  it('a REST create to the object answers and reads back, from the stand-in', () => {
    expect(restCreate.status, restCreate.body).toBe(201);
    expect(restCreate.readBack, restCreate.body).toBe(200);
  });

  it("CONTROL: the factory `objectstack dev` uses connects to that mongodb address for the same declaration", async () => {
    const before = mongoConnections;
    const handle = await createDefaultDatasourceDriverFactory().create({
      ...docsDatasource,
      config: { ...docsDatasource.config },
    } as DatasourceConnectionSpec);
    // The listener closes every connection, so the connect fails; what counts is that it was made.
    await Promise.resolve(handle.connect?.()).catch(() => undefined);
    await Promise.resolve(handle.disconnect?.()).catch(() => undefined);
    expect(mongoConnections).toBeGreaterThan(before);
  }, BOOT_TIMEOUT);

  it("CONTROL for the refusal: the plugin's driver, behind an external datasource verify boots, takes a REST write", () => {
    expect(controlPlugCalls[0]).toEqual({ method: 'plugin.init' });
    expect(plugCallsDuringRest).toContainEqual({ method: 'create', object: PLUG });
  });

  it("CONTROL: the factory `objectstack dev` uses opens that file for the same declaration and writes into it", async () => {
    const handle = await createDefaultDatasourceDriverFactory().create({
      ...sideDatasource,
      config: { ...sideDatasource.config },
    } as DatasourceConnectionSpec);
    const driver = handle.driver as any;
    await handle.connect?.();
    // A table of the control's own, so this write does not depend on what the
    // run before it left in the file.
    await driver.syncSchema(CONTROL_TABLE, { name: CONTROL_TABLE, fields: { serial: { type: 'text' } } });
    await driver.create(CONTROL_TABLE, { id: 'control_1', serial: 'control' });
    await handle.disconnect?.();
    expect(existsSync(realDatabase)).toBe(true);
    expect(await rowsIn(CONTROL_TABLE)).toBe(1);
  });
});

describe('createVerifyDatasourceDriverFactory — which declarations get a stand-in', () => {
  const built: DatasourceConnectionSpec[] = [];
  const real: IDatasourceDriverFactory = {
    supports: () => true,
    create(spec) {
      built.push(spec);
      return { driver: {} } as never;
    },
  };
  const factory = createVerifyDatasourceDriverFactory({ real, defaultStore: 'sqlite-wasm' });
  const buildOne = async (spec: DatasourceConnectionSpec) => {
    built.length = 0;
    await factory.create(spec);
    return built[0];
  };

  it('a managed SQL datasource is built as an in-memory store of the default store engine', async () => {
    const spec = await buildOne({
      name: 'pg', driver: 'postgres', schemaMode: 'managed', config: { host: 'db.internal' }, secret: 's3cret',
    });
    expect(spec).toEqual({ name: 'pg', driver: 'sqlite-wasm', schemaMode: 'managed', config: { filename: ':memory:' } });
  });

  it('a datasource that declares no schemaMode counts as managed', async () => {
    const spec = await buildOne({ name: 'lite', driver: 'sqlite', config: { filename: './data/app.db' } });
    expect(spec).toEqual({ name: 'lite', driver: 'sqlite-wasm', schemaMode: 'managed', config: { filename: ':memory:' } });
  });

  it('a managed memory datasource gets a fresh memory store without its persistence', async () => {
    const spec = await buildOne({
      name: 'mem', driver: 'memory', schemaMode: 'managed', config: { persistence: { type: 'file', path: './m.json' } },
    });
    expect(spec).toEqual({ name: 'mem', driver: 'memory', schemaMode: 'managed', config: {} });
  });

  it('an external datasource keeps its real driver', async () => {
    const declared: DatasourceConnectionSpec = {
      name: 'wh', driver: 'postgres', schemaMode: 'external', config: { host: 'wh.internal' }, external: {},
    };
    expect(await buildOne(declared)).toBe(declared);
  });

  it('a datasource that spells schemaMode only inside config keeps its real driver, and derive withholds its objects', async () => {
    const declared: DatasourceConnectionSpec = {
      name: 'wh', driver: 'postgres', config: { host: 'wh.internal', schemaMode: 'external' },
    };
    expect(await buildOne(declared)).toBe(declared);
    // The same reader decides derive's side: what the factory keeps real is withheld.
    const c = deriveCrudCases({
      datasources: [declared],
      objects: [{ name: 'wh_order', datasource: 'wh', fields: { amount: { type: 'number' } } }],
    }).find((x) => x.object === 'wh_order');
    expect(c?.blocked).toContain('external datasource "wh" (read-only): not exercised');
  });

  it.each([
    ['mongodb', { url: 'mongodb://docs.internal' }],
    ['turso', { url: 'libsql://edge.turso.io' }],
    ['pg', { host: 'db.internal' }],
  ])('a managed %s datasource is built as an in-memory store of the default store engine', async (driver, config) => {
    const spec = await buildOne({ name: 'docs', driver, schemaMode: 'managed', config });
    expect(spec).toEqual({ name: 'docs', driver: 'sqlite-wasm', schemaMode: 'managed', config: { filename: ':memory:' } });
  });

  it('on a memory default store, a managed mongodb datasource is built as a fresh memory store', async () => {
    built.length = 0;
    await createVerifyDatasourceDriverFactory({ real, defaultStore: 'memory' }).create({
      name: 'docs', driver: 'mongodb', schemaMode: 'managed', config: { url: 'mongodb://docs.internal' },
    });
    expect(built).toEqual([{ name: 'docs', driver: 'memory', schemaMode: 'managed', config: {} }]);
  });

  it("a managed datasource on a plugin's driver id is refused, and the real factory is never asked", async () => {
    built.length = 0;
    expect(() =>
      factory.create({ name: 'plug', driver: 'acme-plugin-driver', schemaMode: 'managed', config: {} }),
    ).toThrow(/datasource "plug" \(driver "acme-plugin-driver"\)/);
    expect(built).toEqual([]);
  });
});

describe("os verify refuses to boot while a managed datasource on a plugin's driver id is declared", () => {
  const refusedCalls: Call[] = [];
  const refusedStack = defineStack({
    manifest: {
      id: 'com.objectstack.verify.managed-stand-in-refused',
      namespace: 'vmr',
      version: '0.0.0',
      type: 'app',
      name: 'Managed Plugin Driver Fixture',
      description: "An app declaring a managed datasource on a plugin's driver id.",
    },
    datasources: [{ name: PLUG_DS, label: 'Plugin store (managed)', driver: PLUG_DRIVER, schemaMode: 'managed', config: {} }],
    objects: [
      {
        name: 'vmr_item',
        label: 'Item',
        pluralLabel: 'Items',
        datasource: PLUG_DS,
        sharingModel: 'public_read_write',
        fields: { name: { type: 'text', label: 'Name' } },
      },
    ],
    data: [{ object: 'vmr_item', mode: 'insert', records: [{ name: 'SEED' }] }],
    plugins: [recordingDriverPlugin(PLUG_DS, refusedCalls)],
  } as never);

  it('the boot is refused, naming the datasource and the driver id, and the recording driver is never called', async () => {
    const refusal = await bootStack(refusedStack as never, {}).then(
      async (stack) => {
        await stack.stop();
        return undefined;
      },
      (e: unknown) => e as Error,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal?.message).toContain(`datasource "${PLUG_DS}" (driver "${PLUG_DRIVER}")`);
    // Nothing was composed: the plugin never initialised, so its driver was never registered or called.
    expect(refusedCalls).toEqual([]);
  });
});

describe('unstandableManagedDatasources — which declarations refuse the boot', () => {
  const judged = (datasources: unknown) => unstandableManagedDatasources({ datasources });

  it("names a managed datasource on a plugin's driver id, with or without a declared schemaMode", () => {
    expect(
      judged([
        { name: 'a', driver: 'acme-plugin-driver', schemaMode: 'managed' },
        { name: 'b', driver: 'acme-plugin-driver' },
      ]),
    ).toEqual([
      { name: 'a', driver: 'acme-plugin-driver' },
      { name: 'b', driver: 'acme-plugin-driver' },
    ]);
  });

  it("CONTROL: every shipped engine, an external plugin datasource and `default` are not refused", () => {
    expect(
      judged([
        { name: 'pg', driver: 'pg', schemaMode: 'managed' },
        { name: 'docs', driver: 'mongodb' },
        { name: 'edge', driver: 'libsql' },
        { name: 'lite', driver: 'sqlite' },
        { name: 'wasm', driver: 'sqlite-wasm' },
        { name: 'my', driver: 'mysql' },
        { name: 'mem', driver: 'memory' },
        { name: 'wh', driver: 'acme-plugin-driver', schemaMode: 'external' },
        { name: 'wh2', driver: 'acme-plugin-driver', config: { schemaMode: 'validate-only' } },
        { name: 'default', driver: 'acme-plugin-driver' },
      ]),
    ).toEqual([]);
  });

  it('reads a name-keyed map the way the harness does', () => {
    expect(judged({ plug: { driver: 'acme-plugin-driver' } })).toEqual([{ name: 'plug', driver: 'acme-plugin-driver' }]);
  });

  it('the refusal names every one of them', () => {
    const sentence = unstandableManagedDatasourceRefusal([
      { name: 'a', driver: 'x-driver' },
      { name: 'b', driver: 'y-driver' },
    ]);
    expect(sentence).toContain('datasource "a" (driver "x-driver")');
    expect(sentence).toContain('datasource "b" (driver "y-driver")');
  });
});

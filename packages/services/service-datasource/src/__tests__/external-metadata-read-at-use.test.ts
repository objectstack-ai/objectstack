// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21876] The federation service reads the `'metadata'` service when it is
 * used, never at `init()`.
 *
 * ## The defect this pins closed
 *
 * `ExternalDatasourceServicePlugin.init()` read `ctx.getService('metadata')`
 * once and kept the answer. On `objectstack start` no metadata plugin is
 * composed: the `'metadata'` service is the kernel's in-memory fallback, which
 * the kernel registers after every plugin's `init()`, just before the start
 * phase. So the plugin kept "no metadata service" for the life of the process,
 * and every read behind it answered as if the deployment had nothing:
 * `POST /api/v1/datasources/:name/external/validate` answered `ok: true` with
 * no rows, and the boot gate's sweep (`validateAll()`) checked zero federated
 * objects, so `external.validation.onMismatch: 'fail'` could never fire there.
 * The draft's namespace prefix, the import's name check and the catalog write
 * were blind the same way (AGENTS.md, "Startup registry reads").
 *
 * ## What each case pins
 *
 * A `'metadata'` service registered AFTER `init()` (the `start` ordering) is
 * the one every reader asks:
 *  - validate compares each federated object, and a drifted column is reported;
 *  - the boot gate's sweep lists every federated object;
 *  - the draft's name carries the namespace of the datasource's package;
 *  - the import's explicit name is held to that namespace, and refused when
 *    it breaks it;
 *  - the refreshed catalog is persisted;
 *  - the remote-table list honours the datasource's `allowedSchemas`.
 * The service is asked again at each use, never remembered from the first
 * one. A service registered BEFORE `init()` (the `objectstack dev` ordering)
 * gets the same answers. With no `'metadata'` service at all, every reader
 * keeps its documented fallback.
 *
 * The plugin is imported through a RELATIVE specifier, so these cases measure
 * `src/` and need no build. The booted-stack half (the showcase on a
 * composition with no metadata plugin) is the dogfood pin's.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type {
  IntrospectedSchema,
  IExternalDatasourceService,
  SchemaValidationReport,
} from '@objectstack/spec/contracts';
import { ExternalDatasourceServicePlugin } from '../plugin.js';

/** The per-datasource sweep `POST /datasources/:name/external/validate` calls (not on the spec contract). */
interface ScopedValidation {
  validateDatasource(datasource: string): Promise<SchemaValidationReport>;
}

/** The remote: `customers` has lost its `email` column; `orders` matches. */
const remoteSchema = (): IntrospectedSchema =>
  ({
    dialect: 'sqlite',
    tables: {
      customers: {
        name: 'customers',
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: true },
          { name: 'name', type: 'text', nullable: true, primaryKey: false },
        ],
      },
      orders: {
        name: 'orders',
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: true },
          { name: 'amount', type: 'real', nullable: true, primaryKey: false },
        ],
      },
    },
  }) as unknown as IntrospectedSchema;

const CUSTOMER = {
  name: 'wh_customer',
  datasource: 'warehouse',
  external: { remoteName: 'customers' },
  fields: { name: { type: 'text' }, email: { type: 'text' } },
};
const ORDER = {
  name: 'wh_order',
  datasource: 'warehouse',
  external: { remoteName: 'orders' },
  fields: { amount: { type: 'number' } },
};

type Register = (type: string, name: string, data: unknown) => Promise<void>;

interface MetadataFake {
  service: {
    get: (type: string, name: string) => Promise<unknown>;
    list: (type: string) => Promise<unknown[]>;
    getObject: (name: string) => Promise<unknown>;
    listObjects: () => Promise<unknown[]>;
    register: Register;
  };
  register: Mock<Register>;
}

/**
 * A metadata service shaped like the kernel's in-memory fallback: documents
 * by type and name, `getObject` / `listObjects`, and a `register` that stores.
 */
function metadataFake(
  datasource: Record<string, unknown> = { name: 'warehouse', schemaMode: 'external' },
): MetadataFake {
  const store = new Map<string, Map<string, unknown>>([
    ['datasource', new Map([['warehouse', datasource]])],
    ['object', new Map<string, unknown>([[CUSTOMER.name, CUSTOMER], [ORDER.name, ORDER]])],
    ['package', new Map([['com.acme.warehouse', { manifest: { id: 'com.acme.warehouse', namespace: 'wh' } }]])],
  ]);
  const typeMap = (type: string) => {
    let map = store.get(type);
    if (!map) store.set(type, (map = new Map()));
    return map;
  };
  const register = vi.fn<Register>(async (type, name, data) => {
    typeMap(type).set(name, data);
  });
  const service = {
    get: async (type: string, name: string) => typeMap(type).get(name),
    list: async (type: string) => [...typeMap(type).values()],
    getObject: async (name: string) => typeMap('object').get(name),
    listObjects: async () => [...typeMap('object').values()],
    register,
  };
  return { service, register };
}

interface Harness {
  ctx: PluginContext;
  services: Map<string, unknown>;
}

/**
 * A kernel context whose `getService` throws on an unregistered name, as the kernel's does.
 *
 * [#21842] The federated objects live in the engine's object registry on the
 * `objectql` service, which is where the federation service reads objects
 * (the registry a runtime save writes through to). The `metadata` fake still
 * holds its own copy, as the kernel's fallback does after the startup bridge;
 * the readers this file pins are the ones that stay on the metadata service.
 */
function harness(opts: { registry?: boolean } = {}): Harness {
  const services = new Map<string, unknown>();
  services.set('data', { introspectDatasource: vi.fn(async () => remoteSchema()) });
  if (opts.registry !== false) {
    const objects = new Map<string, unknown>([[CUSTOMER.name, CUSTOMER], [ORDER.name, ORDER]]);
    services.set('objectql', {
      registry: { getObject: (n: string) => objects.get(n), getAllObjects: () => [...objects.values()] },
    });
  }
  const ctx = {
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`Service '${name}' not found`);
      return services.get(name);
    },
    registerService: (name: string, service: unknown) => {
      services.set(name, service);
    },
    trigger: async () => undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  } as unknown as PluginContext;
  return { ctx, services };
}

async function federation(h: Harness): Promise<IExternalDatasourceService> {
  await new ExternalDatasourceServicePlugin().init(h.ctx);
  return h.services.get('external-datasource') as IExternalDatasourceService;
}

/** The `objectstack start` ordering: the plugin inits, then the kernel registers its fallback. */
async function startOrdering(metadata: MetadataFake = metadataFake()) {
  const h = harness();
  const service = await federation(h);
  h.services.set('metadata', metadata.service);
  return { h, service, metadata };
}

const objectsOf = (report: { results: Array<{ object: string }> }) =>
  report.results.map((r) => r.object).sort();

describe('the federation service reads a metadata service registered after init (the start ordering)', () => {
  it('validate compares each federated object, and reports the drifted column', async () => {
    const { service } = await startOrdering();

    const report = await (service as unknown as ScopedValidation).validateDatasource('warehouse');

    expect(objectsOf(report)).toEqual(['wh_customer', 'wh_order']);
    const customer = report.results.find((r) => r.object === 'wh_customer');
    expect(customer?.ok).toBe(false);
    expect(customer?.diffs).toEqual([
      expect.objectContaining({ kind: 'missing_column', remoteName: 'customers', column: 'email', severity: 'error' }),
    ]);
    const order = report.results.find((r) => r.object === 'wh_order');
    expect(order?.diffs.filter((d) => d.severity === 'error')).toEqual([]);
    expect(report.ok).toBe(false);
  });

  it('the boot gate\'s sweep (validateAll) lists every federated object', async () => {
    const { service } = await startOrdering();

    const report = await service.validateAll();

    expect(objectsOf(report)).toEqual(['wh_customer', 'wh_order']);
    expect(report.results.find((r) => r.object === 'wh_customer')?.diffs).toEqual([
      expect.objectContaining({ kind: 'missing_column', column: 'email' }),
    ]);
  });

  it('the draft\'s name carries the namespace of the datasource\'s package', async () => {
    const { service } = await startOrdering(
      metadataFake({ name: 'warehouse', schemaMode: 'external', _packageId: 'com.acme.warehouse' }),
    );

    const draft = await service.generateObjectDraft('warehouse', 'customers');

    expect(draft.name).toBe('wh_customers');
  });

  it('the import\'s explicit name is held to that namespace, and refused when it breaks it', async () => {
    const { h, service } = await startOrdering(
      metadataFake({ name: 'warehouse', schemaMode: 'external', _packageId: 'com.acme.warehouse' }),
    );
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    h.services.set('protocol', { saveMetaItem });

    const outcome = await service
      .importObject('warehouse', 'customers', { name: 'ext_customers' })
      .catch((e: unknown) => e);

    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).toMatchObject({ code: 'EXTERNAL_IMPORT_ERROR', status: 400 });
    expect(saveMetaItem).not.toHaveBeenCalled();
  });

  it('the refreshed catalog is persisted', async () => {
    const { service, metadata } = await startOrdering();

    const catalog = await service.refreshCatalog('warehouse');

    expect(metadata.register).toHaveBeenCalledTimes(1);
    expect(metadata.register).toHaveBeenCalledWith('external_catalog', 'warehouse_catalog', catalog);
  });

  it('the remote-table list honours the datasource\'s allowedSchemas', async () => {
    const h = harness();
    h.services.set('data', {
      introspectDatasource: vi.fn(async () => ({
        dialect: 'postgres',
        tables: {
          'public.customers': { name: 'public.customers', columns: [] },
          'audit.events': { name: 'audit.events', columns: [] },
        },
      })),
    });
    const service = await federation(h);
    h.services.set(
      'metadata',
      metadataFake({ name: 'warehouse', schemaMode: 'external', external: { allowedSchemas: ['public'] } }).service,
    );

    const tables = await service.listRemoteTables('warehouse');

    expect(tables.map((t) => `${t.schema}.${t.name}`)).toEqual(['public.customers']);
  });

  it('asks for the service again at each use, never remembering the first answer', async () => {
    const { h, service } = await startOrdering();
    const customerDiffs = async () =>
      (await service.validateAll()).results.find((r) => r.object === 'wh_customer')?.diffs;
    expect(await customerDiffs()).toEqual([expect.objectContaining({ kind: 'missing_column', column: 'email' })]);

    // [#21842] Objects come from the engine registry, so the replacement is
    // told apart by the datasource definition it answers: a `managed`
    // datasource is not compared against its remote at all.
    h.services.set('metadata', metadataFake({ name: 'warehouse', schemaMode: 'managed' }).service);

    expect(await customerDiffs()).toEqual([]);
  });
});

describe('control: a metadata service registered before init (the dev ordering) gives the same answers', () => {
  it('validate, the sweep, the draft and the catalog write answer as under the start ordering', async () => {
    const h = harness();
    const metadata = metadataFake({ name: 'warehouse', schemaMode: 'external', _packageId: 'com.acme.warehouse' });
    h.services.set('metadata', metadata.service);
    const service = await federation(h);

    const report = await service.validateAll();
    expect(objectsOf(report)).toEqual(['wh_customer', 'wh_order']);
    expect(report.results.find((r) => r.object === 'wh_customer')?.diffs).toEqual([
      expect.objectContaining({ kind: 'missing_column', column: 'email' }),
    ]);
    expect((await service.generateObjectDraft('warehouse', 'customers')).name).toBe('wh_customers');
    await service.refreshCatalog('warehouse');
    expect(metadata.register).toHaveBeenCalledWith('external_catalog', 'warehouse_catalog', expect.anything());
  });
});

describe('with no metadata service at all, every reader keeps its fallback', () => {
  it('validate and the sweep answer an empty report, the draft a bare name, the catalog an unpersisted snapshot', async () => {
    // [#21842] No engine registry either: that is where validate's objects
    // come from, so with neither service the report has nothing to list.
    const service = await federation(harness({ registry: false }));

    expect(await service.validateAll()).toEqual({ ok: true, results: [] });
    expect((await service.generateObjectDraft('warehouse', 'customers')).name).toBe('customers');
    const catalog = await service.refreshCatalog('warehouse');
    expect(catalog.name).toBe('warehouse_catalog');
    expect((await service.listRemoteTables('warehouse')).map((t) => t.name).sort()).toEqual(['customers', 'orders']);
  });

  it('a metadata service with no register leaves the catalog unpersisted, without failing the refresh', async () => {
    const { h, service } = await startOrdering();
    const { register: _register, ...readOnly } = metadataFake().service;
    h.services.set('metadata', readOnly);

    const catalog = await service.refreshCatalog('warehouse');

    expect(catalog.name).toBe('warehouse_catalog');
  });
});

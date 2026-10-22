// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24837] Sync refuses a MANAGED datasource (ADR-0015 §1, §4.2).
 *
 * ADR-0015 puts federation on "the datasource it points to
 * (`schemaMode !== 'managed'`)" and allows `object.external` only there. The
 * Sync doors behind Setup → Datasources (list remote tables, draft an object,
 * import one, refresh the catalog) refused only the primary datasource
 * (#24772). Every other managed datasource answered: the HotCRM tester's
 * runtime `qa_mem` listed its tables `200`, and an import over a managed one
 * would have bound a platform-owned table as a federated object that no write
 * gate stands behind (the engine's ADR-0015 §5.3 gate exempts managed
 * datasources).
 *
 * What these pins hold:
 *
 *  - every Sync door refuses a managed datasource, declared `managed` or
 *    managed by default (no `schemaMode`), and a name with no definition, with
 *    the existing `400` and the code its door already serves
 *    (`EXTERNAL_DATASOURCE_ERROR`; the import's `EXTERNAL_IMPORT_ERROR`), and
 *    never introspects it;
 *  - an `external` and a `validate-only` datasource still list, draft, import
 *    and refresh;
 *  - the primary datasource's refusal is unchanged;
 *  - the refusal and the Setup list read ONE fact: every row the list shows
 *    with `schemaMode: 'managed'` is refused, and no other row is.
 *
 * The composition is the real one, as in `primary-datasource-test-and-sync`:
 * a real `ObjectQL` engine (its source, through this package's vitest alias),
 * the real connection service and driver factory, the real
 * `ExternalDatasourceServicePlugin` wiring and the real admin routes over a
 * Hono server. The datasource records live in one `'metadata'` service that
 * both the admin list and the federation service read, as in production
 * (`datasource-admin-plugin.ts` and `plugin.ts` both read
 * `metadata.get('datasource', name)`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { DatasourceConnectionService } from '../datasource-connection-service.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';
import { ExternalDatasourceServicePlugin } from '../plugin.js';
import type { ExternalDatasourceService } from '../external-datasource-service.js';
import { DatasourceAdminService, type StoredDatasource } from '../datasource-admin-service.js';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { ENTITLED_CREDENTIAL, createSessionAuthService, createGrantsEngine } from './entitled-caller.fixture.js';

const teardowns: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const t of teardowns.splice(0)) await t();
});

type Knex = { schema: { createTable(n: string, cb: (t: never) => void): Promise<void> } };
type Table = { string(n: string): { primary(): void } };

const FEDERATION = { validation: { onMismatch: 'warn' as const } };

/**
 * The datasources on the page. `warehouse` is the shape the tester created:
 * a runtime SQLite datasource saved with no `schemaMode`, so the spec's
 * default, `managed`. `qa_mem` is the tester's own runtime `memory` one.
 */
const RECORDS: StoredDatasource[] = [
  { name: 'default', driver: 'sqlite', origin: 'code', config: { filename: ':memory:' } },
  { name: 'warehouse', driver: 'sqlite', origin: 'runtime', config: { filename: ':memory:' } },
  { name: 'ledger', driver: 'sqlite', origin: 'runtime', schemaMode: 'managed', config: { filename: ':memory:' } },
  { name: 'qa_mem', driver: 'memory', origin: 'runtime', config: {} },
  { name: 'lake', driver: 'sqlite', origin: 'runtime', schemaMode: 'external', external: FEDERATION, config: { filename: ':memory:' } },
  { name: 'mirror', driver: 'sqlite', origin: 'runtime', schemaMode: 'validate-only', external: FEDERATION, config: { filename: ':memory:' } },
];

/** The managed datasources, each with a live driver: none may be introspected. */
const MANAGED = ['warehouse', 'ledger', 'qa_mem'] as const;
/** The federation sources: everything must still work on them. */
const FEDERATED = ['lake', 'mirror'] as const;

async function boot() {
  const ql = new ObjectQL();
  const connection = new DatasourceConnectionService({
    factory: () => createDefaultDatasourceDriverFactory({}),
    engine: () => ql as never,
  });
  teardowns.push(() => connection.disconnectAll());

  for (const record of RECORDS) {
    const isDefault = record.name === 'default';
    await connection.connect(
      { ...record, ...(isDefault ? { label: 'Default', bootCritical: true } : {}) } as never,
      {
        ...(isDefault ? { asDefault: true } : {}),
        context: isDefault
          ? { origin: 'code', trigger: 'declared-auto' }
          : { origin: 'runtime', trigger: 'runtime-admin' },
      },
    );
  }

  // One remote table on every SQLite datasource, so a managed one has
  // something a 200 could have listed, and a federated one has something to
  // list, draft and import.
  for (const name of ['warehouse', 'ledger', ...FEDERATED]) {
    const driver = ql.getDriverByName(name) as IDataDriver & { getKnex(): Knex };
    await driver.getKnex().schema.createTable('orders', (t) => (t as unknown as Table).string('id').primary());
  }

  const saves: Array<{ type: string; name: string }> = [];
  const metadata = {
    get: async (type: string, name: string) =>
      type === 'datasource' ? RECORDS.find((r) => r.name === name) : undefined,
    list: async (type: string) => (type === 'datasource' ? RECORDS : []),
    register: async () => {},
  };
  const protocol = {
    saveMetaItem: async (req: { type: string; name: string }) => void saves.push({ type: req.type, name: req.name }),
  };

  const services = new Map<string, unknown>([
    ['data', ql],
    ['metadata', metadata],
    ['protocol', protocol],
  ]);
  await new ExternalDatasourceServicePlugin().init({
    getService: (n: string) => {
      if (!services.has(n)) throw new Error(`no service: ${n}`);
      return services.get(n);
    },
    registerService: (n: string, s: unknown) => void services.set(n, s),
  } as never);
  const external = services.get('external-datasource') as ExternalDatasourceService;

  const admin = new DatasourceAdminService({
    listDatasourceRecords: async () => (await metadata.list('datasource')) as StoredDatasource[],
    connectionStates: () => connection.listConnectionStates(),
  } as never);

  const server = new HonoHttpServer(0);
  const authService = createSessionAuthService();
  const grantsEngine = createGrantsEngine();
  registerDatasourceAdminRoutes(
    server,
    {
      getService: (n: string) => {
        if (n === 'auth') return authService;
        if (n === 'objectql' || n === 'data') return grantsEngine;
        if (n === 'external-datasource') return external;
        if (n === 'datasource-admin') return admin;
        throw new Error(`no service: ${n}`);
      },
    } as never,
    '/api/v1',
  );
  const app = server.getRawApp();
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`http://local/api/v1/datasources${path}`, {
        method,
        headers: { authorization: ENTITLED_CREDENTIAL, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      }),
    );
    return { status: res.status, body: (await res.json()) as any };
  };

  /** Spy on every live driver's introspection, so a refusal can be shown to read nothing. */
  const introspections = () =>
    [...MANAGED, 'default'].map((name) => {
      const driverName = name === 'default' ? ql.getDefaultDriverName()! : name;
      const driver = ql.getDriverByName(driverName) as unknown as Record<string, unknown>;
      return typeof driver.introspectSchema === 'function' ? vi.spyOn(driver as never, 'introspectSchema' as never) : undefined;
    });

  return { external, call, saves, introspections };
}

/** The refusal a service method threw: its envelope fields (ADR-0112). */
async function thrown(answer: Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  const outcome = await answer.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  expect(outcome).not.toHaveProperty('value');
  return (outcome as { error: Error & { code?: string; status?: number } }).error;
}

const REMEDY = "schemaMode 'external' or 'validate-only'";

describe('Setup lists the tester\'s runtime datasources as managed', () => {
  it('a runtime datasource saved with no schemaMode is listed with schemaMode "managed"', async () => {
    const { call } = await boot();
    const list = await call('GET', '');
    expect(list.status).toBe(200);
    const modes = Object.fromEntries(
      list.body.data.datasources.map((d: { name: string; schemaMode: string }) => [d.name, d.schemaMode]),
    );
    expect(modes).toEqual({
      default: 'managed',
      warehouse: 'managed',
      ledger: 'managed',
      qa_mem: 'managed',
      lake: 'external',
      mirror: 'validate-only',
    });
  });
});

describe('every Sync door refuses a managed datasource', () => {
  it.each(MANAGED)('%s: remote-tables and object-draft answer 400 EXTERNAL_DATASOURCE_ERROR', async (name) => {
    const { call } = await boot();

    const tables = await call('GET', `/${name}/remote-tables`);
    expect(tables.status).toBe(400);
    expect(tables.body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');
    expect(tables.body.error.message).toContain(`Datasource '${name}' is managed`);
    expect(tables.body.error.message).toContain(REMEDY);

    const draft = await call('POST', `/${name}/object-draft`, { table: 'orders' });
    expect(draft.status).toBe(400);
    expect(draft.body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');
    expect(draft.body.error.message).toContain(`Datasource '${name}' is managed`);
  });

  it.each(MANAGED)('%s: the import and the catalog refresh refuse it with the code their doors serve, and save nothing', async (name) => {
    const { external, saves } = await boot();

    expect(await thrown(external.listRemoteTables(name))).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(await thrown(external.generateObjectDraft(name, 'orders'))).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(await thrown(external.refreshCatalog(name))).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    const imported = await thrown(external.importObject(name, 'orders'));
    expect(imported).toMatchObject({ code: 'EXTERNAL_IMPORT_ERROR', status: 400 });
    expect(imported.message).toContain(REMEDY);
    expect(saves).toEqual([]);
  });

  it('the refusal says why: a declared managed mode, or the default one', async () => {
    const { external } = await boot();

    expect((await thrown(external.listRemoteTables('ledger'))).message).toContain(
      "Datasource 'ledger' is managed (schemaMode 'managed'), not a federation source",
    );
    expect((await thrown(external.listRemoteTables('warehouse'))).message).toContain(
      "Datasource 'warehouse' is managed (it declares no schemaMode, and 'managed' is the default), not a federation source",
    );
  });

  it('a name with no datasource definition is refused too: nothing declares it a federation source', async () => {
    const { call } = await boot();

    const tables = await call('GET', '/ghost/remote-tables');
    expect(tables.status).toBe(400);
    expect(tables.body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');
    expect(tables.body.error.message).toContain("Datasource 'ghost' has no datasource definition");
  });

  it('no refused datasource is introspected, the primary one included', async () => {
    const { external, introspections } = await boot();
    const spies = introspections();

    for (const name of [...MANAGED, 'default']) {
      await thrown(external.listRemoteTables(name));
      await thrown(external.generateObjectDraft(name, 'orders'));
      await thrown(external.importObject(name, 'orders'));
      await thrown(external.refreshCatalog(name));
    }
    for (const spy of spies) if (spy) expect(spy).not.toHaveBeenCalled();
  });
});

describe('a federation source still syncs', () => {
  it.each(FEDERATED)('%s: lists, drafts, imports and refreshes', async (name) => {
    const { call, external, saves } = await boot();

    const tables = await call('GET', `/${name}/remote-tables`);
    expect(tables.status).toBe(200);
    expect(tables.body.data.tables.map((t: { name: string }) => t.name)).toEqual(['orders']);

    const draft = await call('POST', `/${name}/object-draft`, { table: 'orders' });
    expect(draft.status).toBe(200);
    expect(draft.body.data.draft.definition).toMatchObject({ datasource: name, external: { remoteName: 'orders' } });

    const imported = await external.importObject(name, 'orders');
    expect(imported.definition).toMatchObject({ datasource: name, external: { remoteName: 'orders' } });
    expect(saves).toEqual([{ type: 'object', name: imported.name }]);

    const catalog = await external.refreshCatalog(name);
    expect(catalog.tables.map((t) => t.remoteName)).toEqual(['orders']);
  });
});

describe('the primary datasource keeps its own refusal', () => {
  it('remote-tables on default answers as #24772 left it', async () => {
    const { call } = await boot();

    const tables = await call('GET', '/default/remote-tables');
    expect(tables.status).toBe(400);
    expect(tables.body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');
    expect(tables.body.error.message).toContain(
      "Datasource 'default' is the platform's managed primary datasource, not a federation source",
    );
  });
});

describe('the refusal and the Setup list read one fact', () => {
  it('Sync refuses exactly the rows the list shows as managed', async () => {
    const { call } = await boot();
    const list = await call('GET', '');
    const rows = list.body.data.datasources as Array<{ name: string; schemaMode: string }>;
    expect(rows.length).toBe(RECORDS.length);

    for (const row of rows) {
      const tables = await call('GET', `/${row.name}/remote-tables`);
      expect({ name: row.name, refused: tables.status === 400 }).toEqual({
        name: row.name,
        refused: row.schemaMode === 'managed',
      });
    }
  });
});

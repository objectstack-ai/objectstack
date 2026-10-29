// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  callWithBorrowedCredential,
  connectorCredentialRefusal,
  type BorrowedConnectorAuth,
  type BorrowedConnectorCredential,
  type ConnectorCredentialHandle,
  type IConnectorCredentialSource,
} from '@objectstack/types';
import {
  DatasourceConnectionService,
  type ConnectableDatasource,
  type ConnectionEngineLike,
} from '../datasource-connection-service.js';
import type { DatasourceConnectionSpec, IDatasourceDriverFactory } from '../contracts/datasource-driver-factory.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import { borrowConnectorCredential } from '../datasource-connector-credential.js';
import type { IDataDriver } from '@objectstack/spec/contracts';

/**
 * [ADR-0015 amendment D7] A datasource that names a declared connector
 * instance in `external.connector` borrows that instance's credential at
 * connect, and its driver presents it per request.
 *
 * The lender here is a double of the automation service's source (its own
 * suite, `service-automation/src/connector-credential-source.test.ts`, runs
 * the real one), and the driver is a test double over a vendor API that
 * presents through `callWithBorrowedCredential`, the way the OData driver
 * will. The pins:
 *
 *  - a borrowed static credential reaches the upstream;
 *  - an `oauth2`-shaped credential is refreshed after it expires, and once on
 *    a `401` (the grant-bearing kinds answer through the same handle);
 *  - an undeclared instance — and a host with no lender at all — is refused
 *    at connect, fail-closed: no driver built, nothing registered;
 *  - the admin door refuses to save (and to probe) a draft naming an
 *    instance that cannot lend, and probes a lendable one with its credential.
 */

/** The engine double: records registrations, as the connection service's own suite does. */
function fakeEngine() {
  const drivers = new Map<string, IDataDriver>();
  const engine: ConnectionEngineLike & { drivers: typeof drivers } = {
    drivers,
    registerDriver: (driver: IDataDriver) => {
      if (!drivers.has(driver.name)) drivers.set(driver.name, driver);
    },
    registerDatasourceDef: () => {},
    getDriverByName: (name) => drivers.get(name),
    syncObjectSchema: async () => {},
    markDatasourceUnavailable: () => {},
    clearDatasourceUnavailable: () => {},
    unregisterDriver: (name) => drivers.delete(name),
  };
  return engine;
}

/** A vendor API that accepts only the tokens in `valid`. */
function upstream() {
  const valid = new Set<string>();
  const seen: string[] = [];
  const presented = (auth: BorrowedConnectorAuth): string =>
    auth.type === 'bearer' ? auth.token : auth.type === 'api-key' ? auth.key : `${auth.username}:${auth.password}`;
  return {
    valid,
    seen,
    async get(auth: BorrowedConnectorAuth): Promise<{ status: number; rows?: unknown[] }> {
      const token = presented(auth);
      seen.push(token);
      return valid.has(token) ? { status: 200, rows: [{ id: 'order_1' }] } : { status: 401 };
    },
  };
}

/** The driver double: one `find`, presented through the borrowed handle. */
function apiDriverFactory(api: ReturnType<typeof upstream>) {
  const specs: DatasourceConnectionSpec[] = [];
  const factory: IDatasourceDriverFactory = {
    supports: (id) => id === 'odata',
    create: vi.fn(async (spec: DatasourceConnectionSpec) => {
      specs.push(spec);
      const handle = spec.credential;
      const driver = {
        name: 'odata',
        async find() {
          if (!handle) throw Object.assign(new Error('no credential'), { status: 401 });
          const res = await callWithBorrowedCredential(handle, (auth) => api.get(auth));
          return res.rows ?? [];
        },
      };
      return { driver, connect: async () => {} };
    }),
  };
  return { factory, specs };
}

/** A lender double: `static` answers one token; `oauth2` mints `tok-N`, each valid for `ttlMs`. */
function lender(opts: {
  declared?: string[];
  kind?: 'static' | 'oauth2';
  now?: () => number;
  ttlMs?: number;
  onMint?: (token: string) => void;
}) {
  const declared = new Set(opts.declared ?? ['sap_s4']);
  const borrowed: string[] = [];
  let issued = 0;
  const mint = (): BorrowedConnectorCredential => {
    issued += 1;
    const token = `tok-${issued}`;
    opts.onMint?.(token);
    return { auth: { type: 'bearer', token }, expiresAt: (opts.now ?? Date.now)() + (opts.ttlMs ?? 3_600_000) };
  };
  const source: IConnectorCredentialSource = {
    async borrow(connector) {
      borrowed.push(connector);
      if (!declared.has(connector)) {
        throw connectorCredentialRefusal(
          `connector instance '${connector}' (named by this datasource's external.connector) is not declared in this stack's connectors.`,
          'VALIDATION_ERROR',
          422,
        );
      }
      if (opts.kind !== 'oauth2') {
        const fixed: BorrowedConnectorCredential = { auth: { type: 'bearer', token: 'static-key' } };
        return { connector, get: async () => fixed, refresh: async () => fixed };
      }
      let current = mint();
      const handle: ConnectorCredentialHandle = {
        connector,
        get: async () => current,
        refresh: async () => (current = mint()),
      };
      return handle;
    },
  };
  return { source, borrowed, issued: () => issued };
}

const sapOrders: ConnectableDatasource = {
  name: 'sap_orders',
  driver: 'odata',
  schemaMode: 'external',
  config: { serviceUrl: 'https://sap.example.test/odata/v4/' },
  external: { connector: 'sap_s4' },
};

function service(factory: IDatasourceDriverFactory, source: IConnectorCredentialSource | undefined) {
  const engine = fakeEngine();
  const svc = new DatasourceConnectionService({
    factory: () => factory,
    engine: () => engine,
    connectorCredentials: () => source,
  });
  return { svc, engine };
}

describe('[ADR-0015 D7] a datasource borrows its connector instance\'s credential at connect', () => {
  it('hands the driver the borrowed handle, and a static credential reaches the upstream', async () => {
    const api = upstream();
    api.valid.add('static-key');
    const { factory, specs } = apiDriverFactory(api);
    const { source, borrowed } = lender({});
    const { svc, engine } = service(factory, source);

    const result = await svc.connect(sapOrders, { context: { trigger: 'runtime-admin' } });
    expect(result.status).toBe('connected');
    expect(borrowed).toEqual(['sap_s4']);
    expect(specs[0].credential?.connector).toBe('sap_s4');
    expect(specs[0].secret).toBeUndefined();

    const rows = await (engine.drivers.get('sap_orders') as unknown as { find(): Promise<unknown[]> }).find();
    expect(rows).toEqual([{ id: 'order_1' }]);
    expect(api.seen).toEqual(['static-key']);
  });

  it('refreshes an oauth2 credential after it expires — no reconnect', async () => {
    let clock = 0;
    const api = upstream();
    const { factory } = apiDriverFactory(api);
    const { source, issued } = lender({ kind: 'oauth2', now: () => clock, ttlMs: 60_000, onMint: (t) => api.valid.add(t) });
    const { svc, engine } = service(factory, source);
    await svc.connect(sapOrders, { context: { trigger: 'runtime-admin' } });
    const driver = engine.drivers.get('sap_orders') as unknown as { find(): Promise<unknown[]> };

    const realNow = Date.now;
    Date.now = () => clock;
    try {
      await driver.find();
      expect(api.seen).toEqual(['tok-1']);
      clock = 120_000; // tok-1 has expired
      api.valid.delete('tok-1');
      await driver.find();
      expect(api.seen).toEqual(['tok-1', 'tok-2']);
      expect(issued()).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('refreshes once on a 401 and retries; a second 401 is a 503 naming the instance', async () => {
    const api = upstream();
    const { factory } = apiDriverFactory(api);
    let revoke = false;
    const { source } = lender({ kind: 'oauth2', onMint: (t) => { if (t !== 'tok-1' && !revoke) api.valid.add(t); } });
    const { svc, engine } = service(factory, source);
    await svc.connect(sapOrders, { context: { trigger: 'runtime-admin' } });
    const driver = engine.drivers.get('sap_orders') as unknown as { find(): Promise<unknown[]> };

    // tok-1 was revoked upstream: refreshed once, retried with tok-2.
    await expect(driver.find()).resolves.toEqual([{ id: 'order_1' }]);
    expect(api.seen).toEqual(['tok-1', 'tok-2']);

    // The grant is gone: tok-2 refused, tok-3 refused too.
    revoke = true;
    api.valid.clear();
    await expect(driver.find()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(api.seen).toEqual(['tok-1', 'tok-2', 'tok-2', 'tok-3']);
  });

  it('refuses an undeclared instance at connect, fail-closed: no driver built, nothing registered', async () => {
    const { factory } = apiDriverFactory(upstream());
    const { source } = lender({ declared: [] });
    const { svc, engine } = service(factory, source);
    const result = await svc.connect(sapOrders, { context: { trigger: 'runtime-admin' } });
    expect(result.status).toBe('failed-credentials');
    expect(result.reason).toContain("connector instance 'sap_s4'");
    expect(result.reason).toContain('is not declared');
    expect(factory.create).not.toHaveBeenCalled();
    expect(engine.drivers.size).toBe(0);
    expect(svc.getConnectionState('sap_orders')?.availability).toBe('failed');
  });

  it('refuses at connect when no lender is registered, naming the plugin that lends', async () => {
    const { factory } = apiDriverFactory(upstream());
    const { svc, engine } = service(factory, undefined);
    const result = await svc.connect(sapOrders, { context: { trigger: 'runtime-admin' } });
    expect(result.status).toBe('failed-credentials');
    expect(result.reason).toContain('no connector credential source is registered');
    expect(result.reason).toContain('@objectstack/service-automation');
    expect(factory.create).not.toHaveBeenCalled();
    expect(engine.drivers.size).toBe(0);
  });

  it('fails the boot for a datasource objects bind to, when its instance cannot lend', async () => {
    const { factory } = apiDriverFactory(upstream());
    const { source } = lender({ declared: [] });
    const { svc } = service(factory, source);
    await expect(svc.connectDeclared({
      datasources: [sapOrders],
      objects: [{ name: 'sap_order', datasource: 'sap_orders' }],
    })).rejects.toThrow(/connector instance 'sap_s4'/);
  });

  it('borrows nothing for a datasource that names no connector', async () => {
    const { factory, specs } = apiDriverFactory(upstream());
    const { source, borrowed } = lender({});
    const { svc } = service(factory, source);
    const result = await svc.connect({ ...sapOrders, external: { allowWrites: false } }, { context: { trigger: 'runtime-admin' } });
    expect(result.status).toBe('connected');
    expect(borrowed).toEqual([]);
    expect(specs[0].credential).toBeUndefined();
  });
});

describe('[ADR-0015 D7] borrowConnectorCredential', () => {
  it('never throws: a source that throws a non-Error comes back as a reason', async () => {
    const source = { borrow: async () => { throw 'boom'; } } as unknown as IConnectorCredentialSource;
    await expect(borrowConnectorCredential(source, 'sap_s4')).resolves.toEqual({ ok: false, reason: 'boom', cause: 'boom' });
  });
});

/** An in-memory admin door, with a lender asked through `connectorRefusal` the way the plugin wires it. */
function adminDoor(source: IConnectorCredentialSource | undefined, opts: { seed?: StoredDatasource[] } = {}) {
  const records = new Map<string, StoredDatasource>((opts.seed ?? []).map((r) => [r.name, structuredClone(r)]));
  const ops: string[] = [];
  const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }));
  const config: DatasourceAdminServiceConfig = {
    probe,
    listDatasourceRecords: async () => [...records.values()],
    getDatasourceRecord: async (name) => records.get(name),
    putDatasourceRecord: async (record) => { ops.push(`put:${record.name}`); records.set(record.name, structuredClone(record)); },
    deleteDatasourceRecord: async (name) => { records.delete(name); },
    writeSecret: async () => { ops.push('writeSecret'); return 'sys_secret:1'; },
    countBoundObjects: async () => 0,
    listObjectsBoundTo: async () => [],
    registerPool: () => { ops.push('registerPool'); },
    connectorRefusal: async (connector) => {
      const borrow = await borrowConnectorCredential(source, connector);
      return borrow.ok ? undefined : borrow.reason;
    },
  };
  return { service: new DatasourceAdminService(config), records, ops, probe };
}

const draft = {
  name: 'sap_orders',
  label: 'SAP orders',
  driver: 'odata',
  schemaMode: 'external' as const,
  config: { serviceUrl: 'https://sap.example.test/odata/v4/' },
  external: { connector: 'sap_s4' },
};

describe('[ADR-0015 D7] the admin door judges external.connector at save and probe', () => {
  it('saves a draft whose instance can lend', async () => {
    const { service, ops } = adminDoor(lender({}).source);
    await service.createDatasource(draft);
    expect(ops).toEqual(['put:sap_orders', 'registerPool']);
  });

  it('refuses to create a draft naming an undeclared instance, leaving nothing behind', async () => {
    const { service, ops, records } = adminDoor(lender({ declared: [] }).source);
    await expect(service.createDatasource(draft)).rejects.toThrow(/external\.connector: connector instance 'sap_s4'.*is not declared/s);
    expect(ops).toEqual([]);
    expect(records.size).toBe(0);
  });

  it('refuses to create one when no lender is registered', async () => {
    const { service, ops } = adminDoor(undefined);
    await expect(service.createDatasource(draft)).rejects.toThrow(/no connector credential source is registered/);
    expect(ops).toEqual([]);
  });

  it('refuses an update that points external at an undeclared instance, and lets a label-only one through', async () => {
    const seed: StoredDatasource = { ...draft, origin: 'runtime' } as StoredDatasource;
    const { service, ops } = adminDoor(lender({ declared: [] }).source, { seed: [seed] });
    await expect(service.updateDatasource('sap_orders', { external: { connector: 'sap_s4' } })).rejects.toThrow(/is not declared/);
    expect(ops).toEqual([]);
    await service.updateDatasource('sap_orders', { label: 'SAP orders (renamed)' });
    expect(ops).toContain('put:sap_orders');
  });

  it('answers a probe of an unlendable draft with the reason, without probing', async () => {
    const { service, probe } = adminDoor(lender({ declared: [] }).source);
    const result = await service.testConnection(draft);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("connector instance 'sap_s4'");
    expect(probe).not.toHaveBeenCalled();
  });
});

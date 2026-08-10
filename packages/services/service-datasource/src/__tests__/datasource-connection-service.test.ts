// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DatasourceConnectionService,
  isDatasourceAddressed,
  type ConnectableDatasource,
  type ConnectionEngineLike,
} from '../datasource-connection-service.js';
import type { IDatasourceDriverFactory } from '../contracts/datasource-driver-factory.js';
import type { DatasourceConnectPolicy } from '../contracts/connect-policy.js';
import {
  GENERIC_CONNECT_FAILURE_REMEDY,
  isUnbuiltWorkspaceFailure,
} from '../connect-failure-remedy.js';
import { missingSqliteWasmDriverMessage } from '../default-datasource-driver-factory.js';

/** One `markDatasourceUnavailable` call, as the engine would receive it. */
type UnavailableCall = { name: string; kind: 'blocked' | 'failed'; publicDetail?: string };

/** A fake engine recording driver registration, schema syncs + availability records. */
function fakeEngine() {
  const drivers = new Map<string, { name?: string }>();
  const defs: Array<{ name: string; schemaMode?: string }> = [];
  const synced: string[] = [];
  const unavailable = new Map<string, UnavailableCall>();
  const cleared: string[] = [];
  const engine: ConnectionEngineLike & {
    drivers: typeof drivers;
    defs: typeof defs;
    synced: string[];
    unavailable: typeof unavailable;
    cleared: string[];
  } = {
    drivers,
    defs,
    synced,
    unavailable,
    cleared,
    registerDriver: (driver: any) => {
      if (drivers.has(driver.name)) return; // mirror engine's skip-if-present
      drivers.set(driver.name, driver);
    },
    registerDatasourceDef: (def) => {
      defs.push(def);
    },
    getDriverByName: (name) => drivers.get(name),
    syncObjectSchema: async (name) => {
      synced.push(name);
    },
    markDatasourceUnavailable: (info) => {
      unavailable.set(info.name, info);
    },
    clearDatasourceUnavailable: (name) => {
      unavailable.delete(name);
      cleared.push(name);
    },
  };
  return engine;
}

/** A fake factory that builds a trivial connectable handle. */
function fakeFactory(opts: { supports?: (id: string) => boolean; connectThrows?: boolean } = {}): IDatasourceDriverFactory {
  return {
    supports: opts.supports ?? (() => true),
    create: vi.fn(async () => {
      const driver: any = { name: 'com.fake.driver' };
      return {
        driver,
        connect: opts.connectThrows
          ? async () => {
              throw new Error('connection refused');
            }
          : async () => {
              driver.connected = true;
            },
      };
    }),
  };
}

function svc(over: {
  factory?: IDatasourceDriverFactory | undefined;
  engine?: ConnectionEngineLike | undefined;
  policy?: DatasourceConnectPolicy;
  secrets?: { resolve?: (ref: string) => Promise<string | undefined> };
} = {}) {
  const engine = over.engine === undefined ? fakeEngine() : over.engine;
  const factory = over.factory === undefined ? fakeFactory() : over.factory;
  const warnings: string[] = [];
  const service = new DatasourceConnectionService({
    factory: () => factory ?? undefined,
    engine: () => engine ?? undefined,
    policy: over.policy,
    secrets: over.secrets,
    logger: { warn: (msg: string) => { warnings.push(msg); } },
  });
  return { service, engine: engine as ReturnType<typeof fakeEngine> | undefined, factory, warnings };
}

const externalDs: ConnectableDatasource = {
  name: 'warehouse',
  driver: 'sqlite',
  schemaMode: 'external',
  config: { filename: '/tmp/w.db' },
  external: { allowWrites: false, validation: { onMismatch: 'warn' } },
};

describe('isDatasourceAddressed (ADR-0062 D2 gate)', () => {
  it('connects external datasources (a)', () => {
    expect(isDatasourceAddressed({ name: 'x', schemaMode: 'external' }, { objects: [] })).toBe(true);
    expect(isDatasourceAddressed({ name: 'x', schemaMode: 'validate-only' }, { objects: [] })).toBe(true);
  });

  it('connects when an object explicitly binds via object.datasource (b)', () => {
    expect(
      isDatasourceAddressed({ name: 'reporting', schemaMode: 'managed' }, { objects: [{ name: 'o', datasource: 'reporting' }] }),
    ).toBe(true);
  });

  it('connects when autoConnect:true (c)', () => {
    expect(isDatasourceAddressed({ name: 'x', schemaMode: 'managed', autoConnect: true }, { objects: [] })).toBe(true);
  });

  it('connects when a datasourceMapping rule routes objects to it (d) — #4462', () => {
    // The gate D2 originally excluded, to keep a mapped-but-unconnected
    // datasource falling through to `default`. That fall-through is exactly how
    // an object's rows ended up in a database nobody declared, so routing no
    // longer performs it — and once a mapped object has no fallback, connecting
    // its datasource at boot is the same call gate (b) already makes.
    expect(
      isDatasourceAddressed(
        { name: 'broken', schemaMode: 'managed' },
        { objects: [], mappedObjects: { broken: ['rc1_audit'] } },
      ),
    ).toBe(true);
  });

  it('does NOT connect a managed datasource nothing routes to', () => {
    // No object binding, no mapping rule that matches anything.
    expect(isDatasourceAddressed({ name: 'crm_analytics', schemaMode: 'managed' }, { objects: [] })).toBe(false);
    // An object bound to a DIFFERENT datasource must not flip the gate.
    expect(
      isDatasourceAddressed({ name: 'crm_primary', schemaMode: 'managed' }, { objects: [{ name: 'acct', datasource: 'default' }] }),
    ).toBe(false);
    // Nor may a mapping that routes objects SOMEWHERE ELSE, or one that
    // matches no object at all (an empty list is not a route).
    expect(
      isDatasourceAddressed(
        { name: 'crm_primary', schemaMode: 'managed' },
        { objects: [], mappedObjects: { other_ds: ['task'], crm_primary: [] } },
      ),
    ).toBe(false);
    // A host that supplies no mapping information at all keeps the pre-#4462
    // behavior rather than guessing.
    expect(isDatasourceAddressed({ name: 'crm_primary', schemaMode: 'managed' }, {})).toBe(false);
  });
});

describe('DatasourceConnectionService.connect', () => {
  it('builds, connects, stamps the datasource name, and registers the driver + def', async () => {
    const { service, engine, factory } = svc();
    const result = await service.connect(externalDs, { objects: ['ext_customer'] });
    expect(result.status).toBe('connected');
    expect(factory.create).toHaveBeenCalledOnce();
    // Driver registered under the DATASOURCE name (engine routes by driver.name).
    expect(engine!.drivers.has('warehouse')).toBe(true);
    expect(engine!.drivers.get('warehouse')!.name).toBe('warehouse');
    // Datasource definition recorded for the write gate.
    expect(engine!.defs).toEqual([{ name: 'warehouse', schemaMode: 'external', external: externalDs.external }]);
    // Bound external objects got read metadata synced (DDL-free).
    expect(engine!.synced).toEqual(['ext_customer']);
  });

  it('is idempotent — an already-registered driver is skipped (onEnable escape hatch)', async () => {
    const { service, engine, factory } = svc();
    engine!.drivers.set('warehouse', { name: 'warehouse' }); // pretend onEnable registered it
    const result = await service.connect(externalDs, { objects: ['ext_customer'] });
    expect(result.status).toBe('already-registered');
    expect(factory.create).not.toHaveBeenCalled();
    expect(engine!.synced).toEqual([]); // no double sync
  });

  it('resolves external.credentialsRef via the secret resolver before building', async () => {
    const resolve = vi.fn(async () => 's3cr3t');
    const create = vi.fn(async () => ({ driver: { name: 'd' }, connect: async () => {} }));
    const factory: IDatasourceDriverFactory = { supports: () => true, create };
    const { service } = svc({ factory, secrets: { resolve } });
    await service.connect({ ...externalDs, external: { ...externalDs.external, credentialsRef: 'secret:wh/pw' } });
    expect(resolve).toHaveBeenCalledWith('secret:wh/pw');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ secret: 's3cr3t' }));
  });

  it('respects a deny policy — left unconnected, metadata-only', async () => {
    const policy: DatasourceConnectPolicy = { canConnect: () => ({ allow: false, reason: 'egress blocked' }) };
    const { service, engine, factory } = svc({ policy });
    const result = await service.connect(externalDs);
    expect(result.status).toBe('skipped-policy');
    expect(result.reason).toBe('egress blocked');
    expect(factory.create).not.toHaveBeenCalled();
    expect(engine!.drivers.size).toBe(0);
  });

  it('treats a throwing policy as a denial (fail-closed)', async () => {
    const policy: DatasourceConnectPolicy = {
      canConnect: () => {
        throw new Error('policy backend down');
      },
    };
    const { service, engine } = svc({ policy });
    const result = await service.connect(externalDs);
    expect(result.status).toBe('skipped-policy');
    expect(engine!.drivers.size).toBe(0);
  });

  it('degrades (no throw) when there is no factory / engine', async () => {
    const noFactory = new DatasourceConnectionService({ factory: () => undefined, engine: () => fakeEngine() });
    expect((await noFactory.connect(externalDs)).status).toBe('skipped-no-infra');
    const noEngine = new DatasourceConnectionService({ factory: () => fakeFactory(), engine: () => undefined });
    expect((await noEngine.connect(externalDs)).status).toBe('skipped-no-infra');
  });

  describe('D5 connect-failure policy', () => {
    const failExternal: ConnectableDatasource = {
      ...externalDs,
      external: { allowWrites: false, validation: { onMismatch: 'fail' } },
    };

    it('fail-fast: a declared-auto external + onMismatch:fail re-throws (bricks boot)', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      await expect(
        service.connect(failExternal, { context: { trigger: 'declared-auto' } }),
      ).rejects.toThrow(/fail-fast/);
    });

    it('degrade: the SAME datasource connected via runtime-admin never bricks the server', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const result = await service.connect(failExternal, { context: { trigger: 'runtime-admin' } });
      expect(result.status).toBe('failed-degraded');
    });

    it('degrade: external + onMismatch:warn degrades even at boot (nothing binds to it)', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const result = await service.connect(externalDs, { context: { trigger: 'declared-auto' } });
      expect(result.status).toBe('failed-degraded');
    });
  });

  // framework#3758: a datasource that objects bind to explicitly has NO fallback
  // — `engine.getDriver` throws for them rather than resolving `default` — so a
  // boot-time connect failure used to leave a clean-looking server whose bound
  // objects all 500 at query time with "Datasource 'x' is not registered".
  describe('D5 fail-fast for explicitly-bound datasources (framework#3758)', () => {
    const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
    let saved: string | undefined;
    beforeEach(() => { saved = process.env[ENV]; delete process.env[ENV]; });
    afterEach(() => {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    });

    /** A plain managed datasource — no `onMismatch:'fail'` to lean on. */
    const analytics: ConnectableDatasource = {
      name: 'analytics',
      driver: 'sqlite',
      schemaMode: 'managed',
      config: {},
    };

    it('fail-fast: bound objects at boot brick the boot, even for a managed datasource', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      await expect(
        service.connect(analytics, { objects: ['visit', 'session'], context: { trigger: 'declared-auto' } }),
      ).rejects.toThrow(/fail-fast/);
    });

    it('names the bound objects and the real cause — not just the datasource', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const err = await service
        .connect(analytics, { objects: ['visit', 'session'], context: { trigger: 'declared-auto' } })
        .then(
          () => { throw new Error('connect() resolved but should have thrown'); },
          (e: unknown) => e as Error,
        );
      expect(err.message).toContain("datasource 'analytics'");
      expect(err.message).toContain('connection refused'); // the underlying cause
      expect(err.message).toContain('2 object(s) bind to it explicitly');
      expect(err.message).toContain('visit, session');
      expect(err.message).toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE=1');
    });

    it('truncates a long binding list to 10 names + a count', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const objects = Array.from({ length: 20 }, (_, i) => `obj_${i}`);
      const err = await service
        .connect(analytics, { objects, context: { trigger: 'declared-auto' } })
        .then(() => undefined, (e: Error) => e);
      expect(err!.message).toContain('20 object(s) bind to it explicitly');
      expect(err!.message).toContain('obj_0, obj_1');
      expect(err!.message).toContain('+10 more');
      expect(err!.message).not.toContain('obj_15');
    });

    it('a credential failure on a bound datasource is fatal too (D3 ∩ D5)', async () => {
      const { service } = svc({ secrets: { resolve: async () => undefined } });
      await expect(
        service.connect(
          { ...analytics, external: { credentialsRef: 'sys_secret:abc' } },
          { objects: ['visit'], context: { trigger: 'declared-auto' } },
        ),
      ).rejects.toThrow(/fail-fast/);
    });

    it('an unsupported driver on a bound datasource is fatal too — the objects are just as dead', async () => {
      const { service } = svc({ factory: fakeFactory({ supports: () => false }) });
      await expect(
        service.connect(analytics, { objects: ['visit'], context: { trigger: 'declared-auto' } }),
      ).rejects.toThrow(/no driver factory supports/);
    });

    it('degrade: autoConnect:true with nothing bound stays lenient ("connect it if you can")', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const result = await service.connect(
        { ...analytics, autoConnect: true },
        { context: { trigger: 'declared-auto' } },
      );
      expect(result.status).toBe('failed-degraded');
    });

    it('degrade: the SAME bound datasource via runtime-admin never bricks the running server', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const result = await service.connect(analytics, {
        objects: ['visit', 'session'],
        context: { trigger: 'runtime-admin' },
      });
      expect(result.status).toBe('failed-degraded');
    });

    it('boots degraded when OS_ALLOW_DRIVER_CONNECT_FAILURE opts in, and says so loudly', async () => {
      process.env[ENV] = '1';
      const { service, warnings } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const result = await service.connect(analytics, {
        objects: ['visit'],
        context: { trigger: 'declared-auto' },
      });
      expect(result.status).toBe('failed-degraded');
      const warned = warnings.join('\n');
      expect(warned).toContain('DEGRADED BOOT');
      expect(warned).toContain('visit');
    });

    // The stderr copy survives the operator's LOG LEVEL — `warn` is dropped
    // outright at `error`/`fatal`/`silent` — not `os serve`'s boot-quiet
    // window, which swallowed it at every level until framework#4012 fixed
    // that. Same pin as the engine-side and runtime-side parity tests.
    it('repeats the degraded banner on stderr, which the operator log level cannot filter away', async () => {
      process.env[ENV] = '1';
      const written: string[] = [];
      const realWrite = process.stderr.write;
      (process.stderr as { write: unknown }).write = (chunk: any) => {
        written.push(String(chunk));
        return true;
      };
      try {
        const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
        await service.connect(analytics, { objects: ['visit'], context: { trigger: 'declared-auto' } });
      } finally {
        (process.stderr as { write: unknown }).write = realWrite;
      }
      expect(written.join('')).toContain('DEGRADED BOOT');
    });

    it('treats a falsy opt-in value as off — still fail-fast', async () => {
      process.env[ENV] = 'false';
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      await expect(
        service.connect(analytics, { objects: ['visit'], context: { trigger: 'declared-auto' } }),
      ).rejects.toThrow(/fail-fast/);
    });

    it('the shared flag also unblocks the (a) external + onMismatch:fail path', async () => {
      process.env[ENV] = '1';
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const result = await service.connect(
        { ...externalDs, external: { validation: { onMismatch: 'fail' } } },
        { context: { trigger: 'declared-auto' } },
      );
      expect(result.status).toBe('failed-degraded');
    });
  });
});

// #5794: the fail-fast throw used to end on ONE sentence for every cause —
// "Fix the datasource configuration, or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1".
// For a driver package whose `dist/` was never built, BOTH halves are harmful:
// the configuration is already correct, and the flag boots a half-built
// workspace that then fails every request. The one fix that works (`pnpm build`)
// was never named. These pin the split — and pin that nothing else moved.
describe('fail-fast remedy is chosen by CAUSE (#5794)', () => {
  const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[ENV]; delete process.env[ENV]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  /** A bound, managed datasource — the plainest route to a D5 fail-fast verdict. */
  const analytics: ConnectableDatasource = {
    name: 'analytics',
    driver: 'sqlite',
    schemaMode: 'managed',
    config: {},
  };

  /**
   * A factory whose `create()` throws exactly what the real one does when the
   * driver package cannot be resolved. `create()` is the true failure site:
   * every arm of `DefaultDatasourceDriverFactory.create()` reaches its driver
   * through `await import('@objectstack/driver-…')`, so an unbuilt `dist/`
   * rejects there, before any connection is attempted.
   */
  function factoryThrowing(err: unknown): IDatasourceDriverFactory {
    return {
      supports: () => true,
      create: vi.fn(async () => {
        throw err;
      }),
    };
  }

  /** Attach a Node error `code` without widening the declared Error type. */
  function withCode(err: Error, code: string): Error {
    (err as Error & { code?: string }).code = code;
    return err;
  }

  /** Boot `analytics` with one bound object and return the thrown error. */
  async function failFast(factory: IDatasourceDriverFactory): Promise<Error> {
    const { service } = svc({ factory });
    return service
      .connect(analytics, { objects: ['visit'], context: { trigger: 'declared-auto' } })
      .then(
        () => { throw new Error('connect() resolved but should have thrown'); },
        (e: unknown) => e as Error,
      );
  }

  /** The two sentences that must never be said about an unbuilt workspace. */
  function expectNoHarmfulAdvice(message: string): void {
    expect(message).not.toContain('Fix the datasource configuration');
    expect(message).not.toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE');
  }

  describe('the unbuilt-workspace cause is recognised on BOTH criteria', () => {
    // Criterion 1 — the STRUCTURED signal, which is what the classifier reads
    // first. The message here says nothing a substring match could find, so
    // only `err.code` can classify it.
    it('by err.code alone: ERR_MODULE_NOT_FOUND with an unrecognisable message', async () => {
      const err = await failFast(
        factoryThrowing(withCode(new Error('the driver entry point is not on disk'), 'ERR_MODULE_NOT_FOUND')),
      );
      expect(err.message).toContain('pnpm install && pnpm build');
      expectNoHarmfulAdvice(err.message);
    });

    it('by err.code alone: CJS require() reports MODULE_NOT_FOUND', async () => {
      const err = await failFast(
        factoryThrowing(withCode(new Error('the driver entry point is not on disk'), 'MODULE_NOT_FOUND')),
      );
      expect(err.message).toContain('pnpm install && pnpm build');
      expectNoHarmfulAdvice(err.message);
    });

    // Criterion 2 — the MESSAGE text, with no `code` to read. Not a hypothetical
    // fallback on this path: the factory's `sqlite-wasm` and `mongo` arms catch
    // the import failure and re-throw a `new Error(...)` that interpolates the
    // original message and drops its `code`.
    it("by message alone: ESM's `Cannot find package`, no code", async () => {
      const err = await failFast(
        factoryThrowing(new Error("Cannot find package '@objectstack/driver-sql' imported from /w/factory.js")),
      );
      expect(err.message).toContain('pnpm install && pnpm build');
      expectNoHarmfulAdvice(err.message);
    });

    it('by message alone: the factory-wrapped optional-driver form, no code', async () => {
      // Built from the factory's OWN message rather than a copy of its wording
      // (#7385): this fixture used to spell the pre-#7385 sentence by hand, so
      // it would have gone on asserting a shape the factory no longer emits.
      // The property under test is unchanged — the wrapper drops the `code`, so
      // the classifier has only the interpolated `Cannot find module` text to
      // work with — and it is now pinned against the real wrapper.
      const err = await failFast(
        factoryThrowing(
          new Error(
            missingSqliteWasmDriverMessage({
              datasource: 'default',
              cause: new Error(
                "Cannot find module '/w/node_modules/@objectstack/driver-sqlite-wasm/dist/index.mjs'",
              ),
            }),
          ),
        ),
      );
      expect(err.message).toContain('pnpm install && pnpm build');
      expectNoHarmfulAdvice(err.message);
    });

    // The measured shape from an actually-unbuilt worktree: both signals present.
    it('the real unbuilt-worktree shape names the build fix and nothing else', async () => {
      const err = await failFast(
        factoryThrowing(
          withCode(
            new Error(
              "Cannot find module '/w/node_modules/@objectstack/driver-sql/dist/index.mjs' " +
              'imported from /w/packages/services/service-datasource/dist/index.js',
            ),
            'ERR_MODULE_NOT_FOUND',
          ),
        ),
      );
      expect(err.message).toContain('pnpm install && pnpm build');
      expectNoHarmfulAdvice(err.message);
      // ONE fix, stated once — the same discipline check:dev-prereqs pins.
      expect(err.message.match(/pnpm build/g)).toHaveLength(1);
    });
  });

  it('keeps everything ABOVE the remedy — only the closing sentence differs', async () => {
    const err = await failFast(
      factoryThrowing(withCode(new Error("Cannot find package '@objectstack/driver-sql'"), 'ERR_MODULE_NOT_FOUND')),
    );
    expect(err.message).toContain("datasource 'analytics'");
    expect(err.message).toContain('connect failed');
    expect(err.message).toContain("Cannot find package '@objectstack/driver-sql'"); // the underlying cause
    expect(err.message).toContain('1 object(s) bind to it explicitly');
    expect(err.message).toContain('visit');
    expect(err.message).toContain('fail-fast per ADR-0062 D5');
  });

  describe('every OTHER cause keeps its message, verbatim', () => {
    // The exact sentence this error has always ended on. Spelled out here as a
    // literal rather than as `GENERIC_CONNECT_FAILURE_REMEDY` so that renaming
    // or "improving" the constant cannot quietly rewrite the pin with itself.
    const GENERIC =
      'Fix the datasource configuration, or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway ' +
      'and serve errors until it is reachable.';

    it('the exported constant IS that sentence (no drift between pin and source)', () => {
      expect(GENERIC_CONNECT_FAILURE_REMEDY).toBe(GENERIC);
    });

    it('a genuine connection refusal still ends on it, byte for byte', async () => {
      const err = await failFast(factoryThrowing(new Error('connection refused')));
      expect(err.message.endsWith(GENERIC)).toBe(true);
      expect(err.message).not.toContain('pnpm build');
    });

    it('a driver the factory cannot build still ends on it (no thrown value to read)', async () => {
      const { service } = svc({ factory: fakeFactory({ supports: () => false }) });
      const err = await service
        .connect(analytics, { objects: ['visit'], context: { trigger: 'declared-auto' } })
        .then(() => undefined, (e: Error) => e);
      expect(err!.message).toContain('no driver factory supports');
      expect(err!.message.endsWith(GENERIC)).toBe(true);
    });

    it('an unresolvable credential still ends on it', async () => {
      const { service } = svc({ secrets: { resolve: async () => undefined } });
      const err = await service
        .connect(
          { ...analytics, external: { credentialsRef: 'sys_secret:abc' } },
          { objects: ['visit'], context: { trigger: 'declared-auto' } },
        )
        .then(() => undefined, (e: Error) => e);
      expect(err!.message.endsWith(GENERIC)).toBe(true);
    });
  });

  // "Diagnostic classification, zero behaviour change" is the whole claim of
  // #5794 — so the things that did NOT move are pinned next to the thing that did.
  describe('zero behaviour change', () => {
    const unbuilt = () =>
      factoryThrowing(withCode(new Error("Cannot find package '@objectstack/driver-sql'"), 'ERR_MODULE_NOT_FOUND'));

    it('still fails fast, and still with a plain Error — not a new type', async () => {
      const err = await failFast(unbuilt());
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('Error');
    });

    it('still degrades (no throw) when nothing binds to the datasource', async () => {
      const { service } = svc({ factory: unbuilt() });
      const result = await service.connect(
        { ...analytics, autoConnect: true },
        { context: { trigger: 'declared-auto' } },
      );
      expect(result.status).toBe('failed-degraded');
    });

    it('still degrades for a runtime-admin connect, never bricking a running server', async () => {
      const { service } = svc({ factory: unbuilt() });
      const result = await service.connect(analytics, {
        objects: ['visit'],
        context: { trigger: 'runtime-admin' },
      });
      expect(result.status).toBe('failed-degraded');
    });

    it('still boots degraded under the escape hatch, with the banner unchanged', async () => {
      process.env[ENV] = '1';
      const { service, warnings } = svc({ factory: unbuilt() });
      const result = await service.connect(analytics, {
        objects: ['visit'],
        context: { trigger: 'declared-auto' },
      });
      expect(result.status).toBe('failed-degraded');
      const warned = warnings.join('\n');
      expect(warned).toContain('DEGRADED BOOT');
      expect(warned).toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE is set');
    });

    it('still retains the verdict for the admin surface', async () => {
      const { service, engine } = svc({ factory: unbuilt() });
      await service
        .connect(analytics, { objects: ['visit'], context: { trigger: 'declared-auto' } })
        .catch(() => undefined);
      const state = service.getConnectionState('analytics');
      expect(state?.status).toBe('failed-degraded');
      expect(state?.availability).toBe('failed');
      expect(engine!.unavailable.get('analytics')?.kind).toBe('failed');
    });
  });
});

// The classifier on its own, at the boundary it is responsible for.
describe('isUnbuiltWorkspaceFailure (#5794)', () => {
  it('reads the structured code first, in both module systems', () => {
    const esm = Object.assign(new Error('nothing recognisable here'), { code: 'ERR_MODULE_NOT_FOUND' });
    const cjs = Object.assign(new Error('nothing recognisable here'), { code: 'MODULE_NOT_FOUND' });
    expect(isUnbuiltWorkspaceFailure(esm)).toBe(true);
    expect(isUnbuiltWorkspaceFailure(cjs)).toBe(true);
  });

  it('falls back to the message when the code was dropped by a re-throw', () => {
    expect(isUnbuiltWorkspaceFailure(new Error("Cannot find package '@objectstack/driver-sql'"))).toBe(true);
    expect(isUnbuiltWorkspaceFailure(new Error("Cannot find module '/w/dist/index.mjs'"))).toBe(true);
  });

  it('leaves a real connect failure alone', () => {
    expect(isUnbuiltWorkspaceFailure(new Error('connection refused'))).toBe(false);
    expect(
      isUnbuiltWorkspaceFailure(Object.assign(new Error('password authentication failed'), { code: '28P01' })),
    ).toBe(false);
  });

  it('leaves a native-addon ABI mismatch alone — a rebuild, not an unbuilt workspace', () => {
    const abi = Object.assign(
      new Error('better_sqlite3.node was compiled against a different Node.js version'),
      { code: 'ERR_DLOPEN_FAILED' },
    );
    expect(isUnbuiltWorkspaceFailure(abi)).toBe(false);
  });

  it('classifies nothing when there was no thrown value to read', () => {
    expect(isUnbuiltWorkspaceFailure(undefined)).toBe(false);
  });
});

describe('D3 credential resolution — fail-closed', () => {
  const credExternal: ConnectableDatasource = {
    name: 'warehouse',
    driver: 'sqlite',
    schemaMode: 'external',
    config: {},
    external: { allowWrites: false, credentialsRef: 'sys_secret:abc', validation: { onMismatch: 'warn' } },
  };

  it('fails closed when a credentialsRef is declared but NO secret store is configured', async () => {
    const factory = fakeFactory();
    const { service, engine } = svc({ factory }); // no `secrets`
    const result = await service.connect(credExternal, { context: { trigger: 'runtime-admin' } });
    expect(result.status).toBe('failed-credentials');
    expect(result.reason).toMatch(/no secret store/);
    expect(factory.create).not.toHaveBeenCalled(); // never built without the secret
    expect(engine!.drivers.size).toBe(0);
  });

  it('fails closed when the credentialsRef cannot be resolved/decrypted (undefined)', async () => {
    const factory = fakeFactory();
    const { service } = svc({ factory, secrets: { resolve: async () => undefined } });
    const result = await service.connect(credExternal, { context: { trigger: 'runtime-admin' } });
    expect(result.status).toBe('failed-credentials');
    expect(result.reason).toMatch(/could not be resolved or decrypted/);
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('fails closed when the resolver throws', async () => {
    const factory = fakeFactory();
    const { service } = svc({
      factory,
      secrets: {
        resolve: async () => {
          throw new Error('kms unreachable');
        },
      },
    });
    const result = await service.connect(credExternal, { context: { trigger: 'runtime-admin' } });
    expect(result.status).toBe('failed-credentials');
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('fail-fast: a declared-auto external + onMismatch:fail with an unresolvable credential re-throws', async () => {
    const failCred: ConnectableDatasource = {
      ...credExternal,
      external: { allowWrites: false, credentialsRef: 'sys_secret:abc', validation: { onMismatch: 'fail' } },
    };
    const { service } = svc({ secrets: { resolve: async () => undefined } });
    await expect(service.connect(failCred, { context: { trigger: 'declared-auto' } })).rejects.toThrow(/fail-fast/);
  });

  it('connects when the credential resolves to a secret', async () => {
    const create = vi.fn(async () => ({ driver: { name: 'd' }, connect: async () => {} }));
    const factory: IDatasourceDriverFactory = { supports: () => true, create };
    const { service } = svc({ factory, secrets: { resolve: async () => 's3cr3t' } });
    const result = await service.connect(credExternal);
    expect(result.status).toBe('connected');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ secret: 's3cr3t' }));
  });
});

describe('DatasourceConnectionService.connectDeclared', () => {
  it('connects only the gated datasources and syncs each one’s bound objects', async () => {
    const { service, engine, factory } = svc();
    const datasources: ConnectableDatasource[] = [
      externalDs, // external → connect
      { name: 'crm_primary', driver: 'sqlite', schemaMode: 'managed', config: { filename: ':memory:' } }, // managed+unrouted → skip
      { name: 'reporting', driver: 'sqlite', schemaMode: 'managed', config: {} }, // managed but object-bound → connect
    ];
    const objects = [
      { name: 'ext_customer', datasource: 'warehouse' },
      { name: 'report_row', datasource: 'reporting' },
      { name: 'account', datasource: 'default' }, // routes to default → no effect
    ];
    const results = await service.connectDeclared({ datasources, objects });
    const byName = Object.fromEntries(results.map((r) => [r.name, r.status]));
    expect(byName).toEqual({ warehouse: 'connected', reporting: 'connected' });
    expect(engine!.drivers.has('crm_primary')).toBe(false); // unchanged
    expect(engine!.drivers.has('warehouse')).toBe(true);
    expect(engine!.drivers.has('reporting')).toBe(true);
    expect(engine!.synced.sort()).toEqual(['ext_customer', 'report_row']);
    expect(factory.create).toHaveBeenCalledTimes(2);
  });

  it('skips inactive datasources', async () => {
    const { service, engine } = svc();
    const results = await service.connectDeclared({
      datasources: [{ ...externalDs, active: false }],
      objects: [],
    });
    expect(results).toEqual([]);
    expect(engine!.drivers.size).toBe(0);
  });

  // framework#3758 — the operator should not have to reboot once per broken
  // datasource to discover them, so every gated datasource is attempted before
  // the aggregate throw (same shape as ObjectQL.init()'s DriverConnectError).
  it('attempts every gated datasource, then reports ALL fatal failures in one error', async () => {
    const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
    const saved = process.env[ENV];
    delete process.env[ENV];
    try {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const err = await service
        .connectDeclared({
          datasources: [
            { name: 'analytics', driver: 'sqlite', schemaMode: 'managed', config: {} },
            { name: 'billing', driver: 'sqlite', schemaMode: 'managed', config: {} },
          ],
          objects: [
            { name: 'visit', datasource: 'analytics' },
            { name: 'invoice', datasource: 'billing' },
          ],
        })
        .then(
          () => { throw new Error('connectDeclared() resolved but should have thrown'); },
          (e: unknown) => e as Error,
        );
      expect(err.message).toContain('2 declared datasource(s) failed to connect');
      expect(err.message).toContain("datasource 'analytics'");
      expect(err.message).toContain("datasource 'billing'"); // not stopped at the first
      expect(err.message).toContain('visit');
      expect(err.message).toContain('invoice');
    } finally {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    }
  });

  // #4462 — the boot half of the pair. Before this, an object mapped to an
  // unreachable datasource produced NO connect attempt at all: the D2 gate left
  // it metadata-only, so the name never appeared in the log, `/ready` stayed
  // 200, and the write went to the default store with a 201.
  it('a mapping-routed datasource is attempted at boot, and its failure is fatal', async () => {
    const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
    const saved = process.env[ENV];
    delete process.env[ENV];
    try {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const err = await service
        .connectDeclared({
          datasources: [{ name: 'broken', driver: 'sqlite', schemaMode: 'managed', config: {} }],
          objects: [{ name: 'rc1_audit' }], // no explicit binding — routed by the rule
          mappedObjects: { broken: ['rc1_audit'] },
        })
        .then(
          () => { throw new Error('connectDeclared() resolved but should have thrown'); },
          (e: unknown) => e as Error,
        );
      expect(err.message).toMatch(/^datasource 'broken': connect failed/);
      expect(err.message).toContain('datasourceMapping rule');
      expect(err.message).toContain('rc1_audit');
      // The sentence an operator has to be able to act on: their data is NOT
      // quietly going somewhere else.
      expect(err.message).toContain('DIFFERENT database');
    } finally {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    }
  });

  it('a single fatal failure propagates as-is (no aggregate wrapper to read past)', async () => {
    const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
    const saved = process.env[ENV];
    delete process.env[ENV];
    try {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      await expect(
        service.connectDeclared({
          datasources: [{ name: 'analytics', driver: 'sqlite', schemaMode: 'managed', config: {} }],
          objects: [{ name: 'visit', datasource: 'analytics' }],
        }),
      ).rejects.toThrow(/^datasource 'analytics': connect failed/);
    } finally {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    }
  });
});

// framework#3827 / #3828 — every connect already produced a verdict and every
// caller threw it away, so a datasource that died at boot was invisible for the
// rest of the process and a query against it could only say "is not registered".
describe('retained connection state (framework#3827)', () => {
  const analytics: ConnectableDatasource = {
    name: 'analytics',
    driver: 'sqlite',
    schemaMode: 'managed',
    config: {},
  };

  it('records `available` on a successful connect and clears any stale unavailability', async () => {
    const { service, engine } = svc();
    await service.connect(externalDs);
    expect(service.getConnectionState('warehouse')).toMatchObject({
      name: 'warehouse',
      status: 'connected',
      availability: 'available',
    });
    // A previously-failed datasource that later connects must stop explaining
    // itself as broken.
    expect(engine!.cleared).toContain('warehouse');
    expect(engine!.unavailable.has('warehouse')).toBe(false);
  });

  it('records `available` for the onEnable escape hatch (already-registered counts as usable)', async () => {
    const { service, engine } = svc();
    engine!.drivers.set('warehouse', { name: 'warehouse' });
    await service.connect(externalDs);
    expect(service.getConnectionState('warehouse')?.availability).toBe('available');
  });

  it('records `failed` with the cause, and tells the engine — without leaking the cause to it', async () => {
    const { service, engine } = svc({ factory: fakeFactory({ connectThrows: true }) });
    await service.connect(analytics, { context: { trigger: 'runtime-admin' } });

    const state = service.getConnectionState('analytics');
    expect(state).toMatchObject({ status: 'failed-degraded', availability: 'failed' });
    expect(state!.reason).toContain('connection refused'); // operator-facing, retained

    // The engine gets the CLASS, never the raw cause: its copy is what reaches
    // an end user, and a connect error routinely names hosts/ports/DSNs.
    expect(engine!.unavailable.get('analytics')).toEqual({ name: 'analytics', kind: 'failed' });
  });

  it('records `blocked` for a policy denial and passes ONLY the opt-in publicReason on', async () => {
    const policy: DatasourceConnectPolicy = {
      canConnect: () => ({
        allow: false,
        reason: 'tenant plan=free; egress allow-list miss for warehouse.internal:5432',
        publicReason: 'External datasources require the Scale plan.',
      }),
    };
    const { service, engine } = svc({ policy });
    await service.connect(externalDs);

    const state = service.getConnectionState('warehouse');
    expect(state).toMatchObject({ status: 'skipped-policy', availability: 'blocked' });
    // The privileged reason is retained for the admin list…
    expect(state!.reason).toContain('warehouse.internal:5432');
    // …but only the tenant-safe string crosses into the engine.
    expect(engine!.unavailable.get('warehouse')).toEqual({
      name: 'warehouse',
      kind: 'blocked',
      publicDetail: 'External datasources require the Scale plan.',
    });
  });

  it('omits publicDetail entirely when the policy did not opt in', async () => {
    const policy: DatasourceConnectPolicy = {
      canConnect: () => ({ allow: false, reason: 'internal: quota exceeded for org_42' }),
    };
    const { service, engine } = svc({ policy });
    await service.connect(externalDs);
    expect(engine!.unavailable.get('warehouse')).toEqual({ name: 'warehouse', kind: 'blocked' });
  });

  it('does not carry a publicReason from one connect into the next', async () => {
    let first = true;
    const policy: DatasourceConnectPolicy = {
      canConnect: () => {
        const decision = first
          ? { allow: false, reason: 'r1', publicReason: 'Only for the first one.' }
          : { allow: false, reason: 'r2' };
        first = false;
        return decision;
      },
    };
    const { service, engine } = svc({ policy });
    await service.connect({ ...externalDs, name: 'ds_a' });
    await service.connect({ ...externalDs, name: 'ds_b' });
    expect(engine!.unavailable.get('ds_a')?.publicDetail).toBe('Only for the first one.');
    expect(engine!.unavailable.get('ds_b')?.publicDetail).toBeUndefined();
  });

  it('records the verdict even when the D5 fail-fast throws', async () => {
    const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
    const saved = process.env[ENV];
    delete process.env[ENV];
    try {
      const { service, engine } = svc({ factory: fakeFactory({ connectThrows: true }) });
      await expect(
        service.connect(analytics, { objects: ['visit'], context: { trigger: 'declared-auto' } }),
      ).rejects.toThrow(/fail-fast/);
      // The boot is aborting, but a host that catches the throw must not be left
      // with a datasource whose state claims it was never attempted.
      expect(service.getConnectionState('analytics')?.availability).toBe('failed');
      expect(engine!.unavailable.get('analytics')?.kind).toBe('failed');
    } finally {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    }
  });

  it('leaves `unattempted` (not "broken") when there is no factory/engine to try with', async () => {
    const service = new DatasourceConnectionService({
      factory: () => undefined,
      engine: () => fakeEngine(),
    });
    await service.connect(externalDs);
    expect(service.getConnectionState('warehouse')).toMatchObject({
      status: 'skipped-no-infra',
      availability: 'unattempted',
    });
  });

  it('drops the verdict on disconnect — a removed pool must not keep explaining itself', async () => {
    const { service, engine } = svc({ factory: fakeFactory({ connectThrows: true }) });
    await service.connect(analytics, { context: { trigger: 'runtime-admin' } });
    expect(service.getConnectionState('analytics')).toBeDefined();

    await service.disconnect('analytics');
    expect(service.getConnectionState('analytics')).toBeUndefined();
    expect(engine!.unavailable.has('analytics')).toBe(false);
  });

  it('lists every retained verdict for the admin surface', async () => {
    const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
    await service.connect({ ...analytics, name: 'a' }, { context: { trigger: 'runtime-admin' } });
    await service.connect({ ...analytics, name: 'b' }, { context: { trigger: 'runtime-admin' } });
    expect(service.listConnectionStates().map((s) => [s.name, s.availability])).toEqual([
      ['a', 'failed'],
      ['b', 'failed'],
    ]);
  });
});

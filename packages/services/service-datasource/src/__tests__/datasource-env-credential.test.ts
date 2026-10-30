// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27687 (maintainer ruling: option 5) — a datasource defined in code reads
 * its credential at connect from `OS_DATASOURCE_<NAME>_PASSWORD`.
 *
 * Each guard the ruling names is pinned at the connection service, the one
 * door every connect goes through:
 *   - the slot fills `secret` for a code-defined name on a `declared-auto`
 *     connect — the boot artifact's and an install-local package's alike;
 *   - a `runtime-admin` connect of the same name, a name outside the
 *     provenance set, the `default` datasource, and a host that did not opt in
 *     never read it — and a caller-set `origin: 'code'` is not provenance;
 *   - a declared `credentialsRef` / `external.connector` wins, and a failing
 *     one stays fail-closed rather than falling back;
 *   - an unset variable keeps the verdict, and its reason names the variable;
 *   - two names deriving one variable are refused;
 *   - the value reaches no log line and no answer.
 * The kernel-level wiring (the admin plugin's switch, the provenance set the
 * runtime fills) is pinned in `@objectstack/runtime`'s
 * `datasource-env-credential.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { CODE_DEFINED_CREDENTIAL_ROUTE } from '@objectstack/spec/data';
import {
  DatasourceConnectionService,
  type ConnectableDatasource,
  type ConnectionEngineLike,
} from '../datasource-connection-service.js';
import {
  DATASOURCE_ENV_CREDENTIALS_SWITCH,
  datasourceEnvCredentialVar,
  resolveDatasourceEnvCredentialsSwitch,
} from '../datasource-env-credential.js';
import type { IDatasourceDriverFactory } from '../contracts/datasource-driver-factory.js';

const VALUE = 'Env-Cred-Value-7f3a91';

/** A minimal engine double: registration and the availability records only. */
function engine(): ConnectionEngineLike {
  const drivers = new Map<string, unknown>();
  return {
    registerDriver: (driver: any) => { if (!drivers.has(driver.name)) drivers.set(driver.name, driver); },
    registerDatasourceDef: () => {},
    getDriverByName: (name) => drivers.get(name) as never,
    syncObjectSchema: async () => {},
    markDatasourceUnavailable: () => {},
    clearDatasourceUnavailable: () => {},
    unregisterDriver: (name) => drivers.delete(name),
  };
}

/**
 * A factory that records the `secret` each build received. `connectFails`
 * makes the connect throw the way a database refusing an unauthenticated
 * login does.
 */
function recordingFactory(opts: { connectFails?: boolean } = {}) {
  const seen: Array<{ name?: string; secret?: string }> = [];
  const factory: IDatasourceDriverFactory = {
    supports: () => true,
    create: vi.fn(async (spec) => {
      seen.push({ name: spec.name, secret: spec.secret });
      const driver: any = { name: 'com.fake.driver' };
      return {
        driver,
        connect: async () => {
          if (opts.connectFails) throw new Error('password authentication failed for user "svc"');
        },
      };
    }),
  };
  return { factory, seen };
}

/** Every line any logger level received, flattened with its meta. */
function capturingLogger() {
  const lines: string[] = [];
  const at = (level: string) => (msg: string, meta?: unknown) => {
    lines.push(`${level} ${msg} ${meta === undefined ? '' : JSON.stringify(meta, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v))}`);
  };
  return { logger: { warn: at('warn'), info: at('info'), error: at('error'), debug: at('debug') }, lines };
}

function service(opts: {
  codeNames?: string[];
  env?: Record<string, string | undefined>;
  slot?: boolean;
  connectFails?: boolean;
  secrets?: { resolve?: (ref: string) => Promise<string | undefined> };
} = {}) {
  const codeNames = new Set(opts.codeNames ?? ['warehouse']);
  const env = opts.env ?? { [datasourceEnvCredentialVar('warehouse')]: VALUE };
  const read = vi.fn((variable: string) => env[variable]);
  const { factory, seen } = recordingFactory({ connectFails: opts.connectFails });
  const { logger, lines } = capturingLogger();
  const svc = new DatasourceConnectionService({
    factory: () => factory,
    engine: () => engine(),
    secrets: opts.secrets,
    ...(opts.slot === false ? {} : { envCredentials: { isCodeDatasource: (n: string) => codeNames.has(n), read } }),
    logger,
  });
  return { svc, read, seen, lines, codeNames, factory };
}

const warehouse: ConnectableDatasource = {
  name: 'warehouse',
  driver: 'postgres',
  schemaMode: 'external',
  config: { host: 'db.internal', database: 'warehouse', username: 'svc' },
  external: { allowWrites: false, validation: { onMismatch: 'warn' } },
};
const BOOT = { context: { origin: 'code' as const, trigger: 'declared-auto' as const } };

describe('datasourceEnvCredentialVar — the derived name', () => {
  it('upper-cases the name and turns every character outside [A-Z0-9] into `_`', () => {
    expect(datasourceEnvCredentialVar('warehouse')).toBe('OS_DATASOURCE_WAREHOUSE_PASSWORD');
    expect(datasourceEnvCredentialVar('crm_replica2')).toBe('OS_DATASOURCE_CRM_REPLICA2_PASSWORD');
    expect(datasourceEnvCredentialVar('my-ds.eu')).toBe('OS_DATASOURCE_MY_DS_EU_PASSWORD');
  });

  it("is the variable the spec refusals' worked example names, and the switch they name is this one", () => {
    const m = /`(OS_DATASOURCE_[A-Z0-9_]+_PASSWORD)` for a datasource named `([a-z0-9_]+)`/.exec(CODE_DEFINED_CREDENTIAL_ROUTE);
    expect(m).not.toBeNull();
    expect(datasourceEnvCredentialVar(m![2])).toBe(m![1]);
    expect(CODE_DEFINED_CREDENTIAL_ROUTE).toContain(`\`${DATASOURCE_ENV_CREDENTIALS_SWITCH}=on\``);
  });
});

describe('resolveDatasourceEnvCredentialsSwitch — `on` / `off`, nothing else', () => {
  it('unset or empty is off; `on` / `off` read in any case', () => {
    expect(resolveDatasourceEnvCredentialsSwitch({})).toBe(false);
    expect(resolveDatasourceEnvCredentialsSwitch({ [DATASOURCE_ENV_CREDENTIALS_SWITCH]: '  ' })).toBe(false);
    expect(resolveDatasourceEnvCredentialsSwitch({ [DATASOURCE_ENV_CREDENTIALS_SWITCH]: 'on' })).toBe(true);
    expect(resolveDatasourceEnvCredentialsSwitch({ [DATASOURCE_ENV_CREDENTIALS_SWITCH]: 'ON' })).toBe(true);
    expect(resolveDatasourceEnvCredentialsSwitch({ [DATASOURCE_ENV_CREDENTIALS_SWITCH]: 'off' })).toBe(false);
  });

  it.each(['true', '1', 'yes', 'false', 'enabled'])('refuses %j with a sentence naming the switch and both values', (raw) => {
    expect(() => resolveDatasourceEnvCredentialsSwitch({ [DATASOURCE_ENV_CREDENTIALS_SWITCH]: raw })).toThrow(
      new RegExp(`^${DATASOURCE_ENV_CREDENTIALS_SWITCH} must be 'on' or 'off', got '${raw}'\\.`),
    );
  });
});

describe('the slot — read only for a code-defined name on the declared connect', () => {
  it('a code datasource connects with the variable set: the value is the build secret', async () => {
    const { svc, read, seen } = service();
    const result = await svc.connect(warehouse, BOOT);
    expect(result.status).toBe('connected');
    expect(read).toHaveBeenCalledWith('OS_DATASOURCE_WAREHOUSE_PASSWORD');
    expect(seen).toEqual([{ name: 'warehouse', secret: VALUE }]);
  });

  it('through `connectDeclared`, the door the boot and an install-local package both use', async () => {
    const { svc, seen } = service();
    await svc.connectDeclared({ datasources: [warehouse] });
    expect(seen).toEqual([{ name: 'warehouse', secret: VALUE }]);
  });

  it('a name the host registers after construction (an install-local package) is read at its connect', async () => {
    const { svc, seen, codeNames } = service({ codeNames: [], env: { OS_DATASOURCE_PKG_STORE_PASSWORD: VALUE } });
    codeNames.add('pkg_store');
    await svc.connectDeclared({ datasources: [{ ...warehouse, name: 'pkg_store' }] });
    expect(seen).toEqual([{ name: 'pkg_store', secret: VALUE }]);
  });

  it('the same name created through the admin door (`registerPool`, runtime-admin) never reads it', async () => {
    const { svc, read, seen } = service();
    await svc.connect({ ...warehouse, origin: 'runtime' }, { context: { origin: 'runtime', trigger: 'runtime-admin' } });
    expect(read).not.toHaveBeenCalled();
    expect(seen).toEqual([{ name: 'warehouse', secret: undefined }]);
  });

  it("a caller-set `origin: 'code'` is not provenance: a name outside the code set never reads it", async () => {
    const { svc, read, seen } = service({ codeNames: [] });
    await svc.connect({ ...warehouse, origin: 'code' }, BOOT);
    expect(read).not.toHaveBeenCalled();
    expect(seen[0]?.secret).toBeUndefined();
  });

  it('a host that did not opt in (no slot) never reads the environment', async () => {
    const { svc, read, seen } = service({ slot: false });
    await svc.connect(warehouse, BOOT);
    expect(read).not.toHaveBeenCalled();
    expect(seen[0]?.secret).toBeUndefined();
  });

  it('the `default` datasource keeps its own channel: an `asDefault` connect never reads the slot', async () => {
    const { svc, read } = service({ codeNames: ['default'] });
    await svc.connect({ name: 'default', driver: 'sqlite', config: { filename: ':memory:' } }, { ...BOOT, asDefault: true });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('a declared credential wins, and stays fail-closed', () => {
  const withRef = { ...warehouse, external: { ...warehouse.external, credentialsRef: 'sys_secret:abc' } };

  it('a resolving `credentialsRef` is the secret; the variable is not consulted', async () => {
    const { svc, read, seen } = service({ secrets: { resolve: async () => 'bound-secret' } });
    await svc.connect(withRef, BOOT);
    expect(read).not.toHaveBeenCalled();
    expect(seen).toEqual([{ name: 'warehouse', secret: 'bound-secret' }]);
  });

  it('an unresolvable `credentialsRef` refuses the connect and does NOT fall back to the variable', async () => {
    const { svc, read, factory } = service({ secrets: { resolve: async () => undefined } });
    const result = await svc.connect(withRef, BOOT).catch((err: Error) => ({ status: 'threw', reason: err.message }));
    expect(['failed-credentials', 'threw']).toContain(result.status);
    expect(read).not.toHaveBeenCalled();
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('a declared `external.connector` borrows (or refuses) on its own channel; the variable is not consulted', async () => {
    const { svc, read } = service();
    await svc
      .connect({ ...warehouse, driver: 'odata', external: { ...warehouse.external, connector: 'erp_api' } }, BOOT)
      .catch(() => undefined);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('an unset variable keeps the verdict, and the reason names the variable', () => {
  it('the database refusing the login answers the variable to set', async () => {
    const { svc, seen } = service({ env: {}, connectFails: true });
    const result = await svc.connect(warehouse, BOOT).catch((err: Error) => ({ status: 'threw', reason: err.message }));
    expect(seen).toEqual([{ name: 'warehouse', secret: undefined }]);
    expect(result.status).not.toBe('connected');
    expect(result.reason).toContain('password authentication failed');
    expect(result.reason).toContain('OS_DATASOURCE_WAREHOUSE_PASSWORD');
  });

  it('an EMPTY variable is unset, not a password of length zero', async () => {
    const { svc, seen } = service({ env: { OS_DATASOURCE_WAREHOUSE_PASSWORD: '' }, connectFails: true });
    const result = await svc.connect(warehouse, BOOT).catch((err: Error) => ({ status: 'threw', reason: err.message }));
    expect(seen[0]?.secret).toBeUndefined();
    expect(result.reason).toContain('OS_DATASOURCE_WAREHOUSE_PASSWORD');
  });

  it('a failure on a connect the slot did not apply to keeps its reason unchanged', async () => {
    const { svc } = service({ env: {}, connectFails: true });
    const result = await svc.connect(warehouse, { context: { origin: 'runtime', trigger: 'runtime-admin' } });
    expect(result.reason).not.toContain('OS_DATASOURCE_');
  });
});

describe('two datasources that derive one variable are refused', () => {
  it('the second name is refused with both names and the variable, and its variable is never read', async () => {
    const { svc, read, seen } = service({
      codeNames: ['eu-sales', 'eu_sales'],
      env: { OS_DATASOURCE_EU_SALES_PASSWORD: VALUE },
    });
    const first = await svc.connect({ ...warehouse, name: 'eu-sales' }, BOOT);
    expect(first.status).toBe('connected');
    const second = await svc
      .connect({ ...warehouse, name: 'eu_sales' }, BOOT)
      .catch((err: Error) => ({ status: 'threw', reason: err.message }));
    expect(second.status).not.toBe('connected');
    expect(second.reason).toContain("datasource 'eu_sales' and datasource 'eu-sales' both derive");
    expect(second.reason).toContain('OS_DATASOURCE_EU_SALES_PASSWORD');
    expect(read).toHaveBeenCalledTimes(1);
    expect(seen.map((s) => s.name)).toEqual(['eu-sales']);
  });

  it('a reconnect of the same name is not a collision, and a disconnect releases the variable', async () => {
    const { svc, seen } = service({ codeNames: ['eu-sales', 'eu_sales'], env: { OS_DATASOURCE_EU_SALES_PASSWORD: VALUE } });
    await svc.connect({ ...warehouse, name: 'eu-sales' }, BOOT);
    await svc.disconnect('eu-sales');
    await svc.connect({ ...warehouse, name: 'eu-sales' }, BOOT);
    await svc.disconnect('eu-sales');
    const other = await svc.connect({ ...warehouse, name: 'eu_sales' }, BOOT);
    expect(other.status).toBe('connected');
    expect(seen.map((s) => s.secret)).toEqual([VALUE, VALUE, VALUE]);
  });
});

describe('the value goes nowhere but the driver', () => {
  it('no log line, connect answer or connection state carries it — connected or failed', async () => {
    for (const connectFails of [false, true]) {
      const { svc, lines, seen } = service({ connectFails });
      const result = await svc.connect(warehouse, BOOT).catch((err: Error) => ({ status: 'threw', reason: err.message }));
      expect(seen[0]?.secret).toBe(VALUE); // it did reach the driver
      const answers = JSON.stringify({ result, states: svc.listConnectionStates(), state: svc.getConnectionState('warehouse') });
      expect(answers).not.toContain(VALUE);
      expect(lines.join('\n')).not.toContain(VALUE);
    }
  });
});

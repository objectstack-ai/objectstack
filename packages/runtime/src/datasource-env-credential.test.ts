// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27687] The env-credential slot, wired the way a host boots it: the
// datasource admin plugin reads `OS_DATASOURCE_ENV_CREDENTIALS` at `init()`
// and answers "is this name code-defined" from the code-datasource set the
// runtime fills. Pinned at that level because the two halves live in two
// packages — the unit pins of each guard are in `@objectstack/service-datasource`
// (`datasource-env-credential.test.ts`).
//
//   - a declared datasource of the boot artifact reads its variable;
//   - a package installed into the running kernel (install-local,
//     `connectPackageDatasources` with `installed: true`) reads its own too —
//     the trust consequence the docs state: a package can declare a datasource
//     of any free name and so read the matching variable;
//   - with the switch unset (every composition but the CLI host) nothing is read;
//   - a value other than `on` / `off` refuses the boot with the sentence.
//
// The recording factory wraps the real one (`createDefaultDatasourceDriverFactory`,
// sqlite `:memory:`), so the connect is the production path; it only notes the
// `secret` each build received.

import { describe, it, expect, afterEach } from 'vitest';
import { Runtime } from './runtime.js';
import { DriverPlugin } from './driver-plugin.js';
import { AppPlugin } from './app-plugin.js';
import { connectPackageDatasources } from './declared-datasources.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// module load (see `datasource-autoconnect.test.ts`).
import '@objectstack/driver-sql';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 60_000;
const SWITCH = 'OS_DATASOURCE_ENV_CREDENTIALS';
const TOUCHED = [SWITCH, 'OS_DATASOURCE_WAREHOUSE_PASSWORD', 'OS_DATASOURCE_PKG_STORE_PASSWORD'];

const external = (name: string) => ({
  name,
  driver: 'sqlite',
  schemaMode: 'external',
  config: { filename: ':memory:' },
  external: { allowWrites: false, validation: { onMismatch: 'warn', checkOnBoot: false } },
  active: true,
});

function artifact() {
  return {
    manifest: { id: 'com.test.ds-env-credential', name: 'DS Env Credential', version: '1.0.0' },
    objects: [{ name: 'note', label: 'Note', fields: { title: { type: 'text' } } }],
    datasources: [external('warehouse')],
  };
}

async function boot() {
  const { SqlDriver } = await import('@objectstack/driver-sql');
  const { ObjectQLPlugin } = await import('@objectstack/objectql');
  const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
    '@objectstack/service-datasource'
  );
  const real = createDefaultDatasourceDriverFactory();
  const seen: Array<{ name?: string; secret?: string }> = [];
  const factory = {
    supports: (id: string) => real.supports(id),
    create: async (spec: any) => {
      seen.push({ name: spec.name, secret: spec.secret });
      return real.create(spec);
    },
  };
  let ctx: any;
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  await kernel.use(new DriverPlugin(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })));
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AppPlugin(artifact()));
  await kernel.use(new DatasourceAdminServicePlugin({ driverFactory: factory as never }));
  await kernel.use({ name: 'test.capture-ctx', init: async (c: any) => { ctx = c; } } as never);
  await kernel.bootstrap();
  return { kernel, seen, ctx: () => ctx };
}

describe('[#27687] env-credential slot — kernel wiring', () => {
  const saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  let kernel: any;

  afterEach(async () => {
    try { await kernel?.stop?.(); } catch { /* noop */ }
    kernel = undefined;
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('switch on: the boot artifact\'s datasource and an install-local package\'s both read their variable', async () => {
    process.env[SWITCH] = 'on';
    process.env.OS_DATASOURCE_WAREHOUSE_PASSWORD = 'boot-artifact-secret';
    process.env.OS_DATASOURCE_PKG_STORE_PASSWORD = 'installed-package-secret';
    const booted = await boot();
    kernel = booted.kernel;
    expect(booted.seen.find((s) => s.name === 'warehouse')?.secret).toBe('boot-artifact-secret');

    const verdicts = await connectPackageDatasources(booted.ctx(), {
      appId: 'com.example.pkg',
      source: 'MarketplaceInstallLocal',
      datasources: [external('pkg_store')],
      installed: true,
    });
    expect(verdicts).toEqual([{ name: 'pkg_store', status: 'connected' }]);
    expect(booted.seen.find((s) => s.name === 'pkg_store')?.secret).toBe('installed-package-secret');
  }, BOOT_TIMEOUT);

  it('switch unset (every composition but the CLI host): nothing is read', async () => {
    delete process.env[SWITCH];
    process.env.OS_DATASOURCE_WAREHOUSE_PASSWORD = 'boot-artifact-secret';
    const booted = await boot();
    kernel = booted.kernel;
    const warehouse = booted.seen.find((s) => s.name === 'warehouse');
    expect(warehouse).toBeDefined();
    expect(warehouse?.secret).toBeUndefined();
  }, BOOT_TIMEOUT);

  it('a value other than `on` / `off` refuses the boot with the sentence', async () => {
    process.env[SWITCH] = 'true';
    await expect(boot()).rejects.toThrow(/OS_DATASOURCE_ENV_CREDENTIALS must be 'on' or 'off', got 'true'/);
  }, BOOT_TIMEOUT);
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os serve` seals every `sys_secret` row with ONE crypto provider: the one a
 * plugin registered as the kernel service `crypto-provider` during its init, or
 * the host's own `LocalCryptoProvider` when none did.
 *
 * ## The gap
 *
 * `serve.ts` built `LocalCryptoProvider` itself after `runtime.start()` and
 * always handed it to `setCryptoProvider`, and the datasource binder and the
 * default settings service each held a local provider too. A provider a plugin
 * supplied — a KMS/Vault one, for customer-managed keys — was overwritten, so
 * no host could mount one.
 *
 * ## What this file pins
 *
 * Each case runs a REAL `ObjectKernel` with the host plugin
 * `createHostCryptoProvider` returns, composed the way `run()` composes it, and
 * a REAL `ObjectQL` engine / datasource binder / settings service over
 * `host.provider`:
 *
 *   1. a provider a plugin registers during init seals secret-field writes,
 *      datasource credentials and encrypted settings — the binder's and the
 *      settings service's writes through the same `host.provider` the engine
 *      holds — and the local fallback is never built;
 *   2. with no registration the provider is the `LocalCryptoProvider` serve
 *      always built, from the same key source: what it seals, a provider built
 *      the original way (`new LocalCryptoProvider()`, the settings service's
 *      own default) opens, and the other way round;
 *   3. two registrations refuse at boot — two declaring plugins named before
 *      either initializes, an undeclared second one by the kernel;
 *   4. the deferred path: a credential written before the post-start wiring is
 *      sealed by the registered provider; a seal attempted during plugin init
 *      refuses and records nothing; a registration after init, or a replaced
 *      one, refuses the boot;
 *   5. the wiring inside `run()`: the one host provider reaches the binder, the
 *      default settings service and the data engine, and the declaration check
 *      runs before the boot.
 *
 * ⛔ No key material reaches a refusal: every refusal is checked against the
 * test keys' bytes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { createDatasourceSecretBinder } from '@objectstack/service-datasource';
import { deferredLocalCryptoProvider, LocalCryptoProvider, SettingsService } from '@objectstack/service-settings';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import type { SettingsManifest } from '@objectstack/spec/system';
import { CRYPTO_PROVIDER_SERVICE } from '@objectstack/types';

// The repo's ONE code/prose separator: a comment naming a call must not answer
// for code that does not make it.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

import {
  createHostCryptoProvider,
  cryptoProviderPlugins,
  HostCryptoProviderRefusal,
  refuseTwoCryptoProviderPlugins,
  refuseUnloadedCryptoProviderPlugins,
  refuseSetAsideCryptoProviderPlugins,
} from './serve.js';

// [#10126] Pay the first load of what `serve.ts` reaches through dynamic
// `import()`s at MODULE LOAD, outside any clocked case.
import '@objectstack/metadata-protocol';
import '@objectstack/metadata';
import '@objectstack/plugin-hono-server';
import '@objectstack/rest';
import '@objectstack/driver-turso';
import '@objectstack/driver-sql';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-security';

/** …/packages/cli/src/commands — seeded from `import.meta.url`. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `serve.ts`'s CODE, with every comment span blanked. */
const SERVE = maskComments(readFileSync(resolve(HERE, 'serve.ts'), 'utf8'));

/** The local key the no-registration cases read from `OS_SECRET_KEY`. */
const LOCAL_KEY_HEX = '606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f';
/** The key behind the registered ("KMS") provider. Never the local one. */
const KMS_KEY = Buffer.from('404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f', 'hex');

/** A refusal carries no byte of either key, in any spelling a log would print. */
function expectNoKeyMaterial(text: string): void {
  for (const spelling of [LOCAL_KEY_HEX, KMS_KEY.toString('hex'), KMS_KEY.toString('base64')]) {
    expect(text).not.toContain(spelling);
  }
}

/**
 * The provider a test plugin registers: AES-GCM under {@link KMS_KEY}, every
 * handle stamped with its own `kmsKeyId`, every seal recorded by scope.
 */
function kmsProvider() {
  const inner = new LocalCryptoProvider({ key: KMS_KEY });
  const sealed: string[] = [];
  const provider: ICryptoProvider = {
    async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
      sealed.push(ctx.scope);
      return { ...(await inner.encrypt(plain, ctx)), kmsKeyId: 'test-kms' };
    },
    decrypt: (handle, ctx) => inner.decrypt(handle, ctx),
    rotateKey: (handle, ctx) => inner.rotateKey(handle, ctx),
    digest: (plain) => inner.digest(plain),
    keyedDigest: (plain) => inner.keyedDigest(plain),
  };
  return { provider, sealed };
}

/** A plugin that registers `provider` as the host's crypto provider during init. */
function providerPlugin(name: string, provider: unknown, opts: { declare?: boolean } = {}) {
  return {
    name,
    version: '1.0.0',
    ...(opts.declare === false ? {} : { providesServices: [CRYPTO_PROVIDER_SERVICE] }),
    init: async (ctx: { registerService(name: string, service: unknown): void }) => {
      ctx.registerService(CRYPTO_PROVIDER_SERVICE, provider);
    },
  };
}

/** The one service a kernel refuses to start without. Nothing here reads data. */
const DATA_STUB = {
  name: 'com.example.host-crypto-provider.data-stub',
  version: '1.0.0',
  init: async (ctx: { registerService(name: string, service: unknown): void }) => { ctx.registerService('data', {}); },
};

/** Throws if called: the local fallback must not be built when a provider is registered. */
const NO_LOCAL = (): ICryptoProvider => {
  throw new Error('the local fallback was built although a provider is registered');
};

// ---------------------------------------------------------------------------
// A real ObjectQL engine over an in-memory driver, with one secret field.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function memoryDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (object: string) => {
    let s = stores.get(object);
    if (!s) { s = new Map(); stores.set(object, s); }
    return s;
  };
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Row)) {
      if (k.startsWith('$')) continue;
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const copy = (r: Row): Row => ({ ...r });
  let n = 0;
  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast?: Row) {
      const matched = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The caller's bound, held by presence after the filter and before the
      // copy (`check:objectql-double-limit`).
      const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      return page.map(copy);
    },
    async create(object: string, data: Row) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async count(object: string, ast?: Row) {
      return (await this.find(object, ast)).length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return { driver, rowsOf: (object: string) => Array.from(storeFor(object).values()).map(copy) };
}

const TEST_PACKAGE_ID = 'com.objectstack.test.host-crypto-provider';
const textField = (name: string) => ({ name, label: name, type: 'text' as const });

async function secretFieldEngine() {
  const store = memoryDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'sys_secret',
    label: 'Secret',
    fields: {
      ...Object.fromEntries(
        ['id', 'namespace', 'key', 'kms_key_id', 'alg', 'ciphertext', 'created_at', 'rotated_at']
          .map((f) => [f, textField(f)]),
      ),
      version: { name: 'version', label: 'version', type: 'number' as const },
    },
  } as never, TEST_PACKAGE_ID);
  engine.registry.registerObject({
    name: 'vault_item',
    label: 'Vault item',
    fields: { id: textField('id'), token: { name: 'token', label: 'token', type: 'secret' as const } },
  } as never, TEST_PACKAGE_ID);
  return { engine, store };
}

/** The `sys_secret` row behind a secret-field write, as a handle the providers open. */
function sealedHandle(store: ReturnType<typeof memoryDriver>, ref: unknown): CryptoHandle {
  const id = String(ref).slice('secret:'.length);
  const row = store.rowsOf('sys_secret').find((r) => r.id === id)!;
  return {
    id,
    kmsKeyId: String(row.kms_key_id),
    alg: String(row.alg),
    version: Number(row.version),
    ciphertext: String(row.ciphertext),
  };
}

/** An in-memory `sys_secret` table with the surface the binder's `bind` / `resolve` call. */
function secretRows() {
  const rows = new Map<string, Row>();
  return {
    rows,
    async insert(_object: string, data: Row) { rows.set(String(data.id), data); return data; },
    async find(_object: string, query: { where?: Row; limit?: number }) {
      const hits = [...rows.values()].filter((row) =>
        Object.entries(query.where ?? {}).every(([k, v]) => {
          // Scalar equality only: a combinator or operator is refused, never read as a field name.
          if (k.startsWith('$')) throw new Error(`secretRows double: no '${k}' support`);
          return row[k] === v;
        }));
      return typeof query.limit === 'number' ? hits.slice(0, query.limit) : hits;
    },
  };
}

/** One encrypted settings key — minimal, as in service-settings' crypto tests. */
const SETTINGS_MANIFEST: SettingsManifest = {
  namespace: 'crypto_ns',
  version: 1,
  label: 'Crypto',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [{ type: 'password', key: 'api_key', label: 'API key', required: false }],
} as SettingsManifest;

/** An in-memory `sys_secret` store with the surface `SettingsService` writes through. */
function settingsSecretStore() {
  const rows = new Map<string, CryptoHandle & { namespace: string; key: string }>();
  return {
    rows,
    async insert(row: { id: string; namespace: string; key: string; kms_key_id: string; alg: string; version: number; ciphertext: string }) {
      rows.set(row.id, { id: row.id, namespace: row.namespace, key: row.key, kmsKeyId: row.kms_key_id, alg: row.alg, version: row.version, ciphertext: row.ciphertext });
      return { id: row.id };
    },
    async get(id: string) {
      const r = rows.get(id);
      return r ? { id: r.id, namespace: r.namespace, key: r.key, kms_key_id: r.kmsKeyId, alg: r.alg, version: r.version, ciphertext: r.ciphertext } : null;
    },
    async update() {},
  };
}

/**
 * Boot a kernel with `plugins` and the host plugin. `run()` mounts the stack's
 * plugins before the host plugin and the capability providers after it, so
 * both orders occur; `hostFirst` puts the host plugin ahead of `plugins`.
 */
async function bootIn(
  order: { hostFirst: boolean },
  host: ReturnType<typeof createHostCryptoProvider>,
  ...plugins: object[]
) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(DATA_STUB);
  if (order.hostFirst) await kernel.use(host.plugin as never);
  for (const plugin of plugins) await kernel.use(plugin as never);
  if (!order.hostFirst) await kernel.use(host.plugin as never);
  await kernel.bootstrap();
  return kernel;
}

const boot = (host: ReturnType<typeof createHostCryptoProvider>, ...plugins: object[]) =>
  bootIn({ hostFirst: false }, host, ...plugins);

describe('a provider a plugin registers during init seals every secret', () => {
  it('seals secret-field writes, datasource credentials and encrypted settings, and never builds the local one', async () => {
    const kms = kmsProvider();
    const host = createHostCryptoProvider(NO_LOCAL);
    // Both composed BEFORE the boot, as `run()` composes them.
    const binderRows = secretRows();
    const binder = createDatasourceSecretBinder({ engine: binderRows as never, cryptoProvider: host.provider });
    const settingsStore = settingsSecretStore();
    const settings = new SettingsService({ env: {}, cryptoProvider: host.provider, secretStore: settingsStore } as never);
    settings.registerManifest(SETTINGS_MANIFEST);

    const kernel = await boot(host, providerPlugin('com.example.kms-crypto-provider', kms.provider));
    try {
      expect(host.provider.source).toBe('registered');
      expect(host.provider.resolve()).toBe(kms.provider);

      // The post-start wiring, as `run()` does it.
      const { engine, store } = await secretFieldEngine();
      engine.setCryptoProvider(host.provider);
      host.provider.confirm();

      await engine.insert('vault_item', { id: 'v1', token: 'hunter2' });
      const ref = store.rowsOf('vault_item')[0].token;
      expect(String(ref)).toMatch(/^secret:/);
      const handle = sealedHandle(store, ref);
      expect(handle.kmsKeyId).toBe('test-kms');
      expect(await kms.provider.decrypt(handle, { scope: 'object_secret_field', namespace: 'vault_item', key: 'token' }))
        .toBe('hunter2');

      const credentialsRef = await binder.bind({ value: 'pg-password' }, { name: 'warehouse' });
      expect(credentialsRef).toMatch(/^sys_secret:/);
      expect(await binder.resolve(credentialsRef)).toBe('pg-password');

      await settings.set('crypto_ns', 'api_key', 'smtp-app-password');
      expect([...settingsStore.rows.values()].map((r) => r.kmsKeyId)).toEqual(['test-kms']);

      // One provider sealed all three producers' secrets.
      expect(kms.sealed).toEqual(['object_secret_field', 'datasource_credential', 'settings']);
    } finally {
      await kernel.shutdown();
    }
  });
});

describe('with no registration, the provider is the LocalCryptoProvider serve always built', () => {
  beforeEach(() => { vi.stubEnv('OS_SECRET_KEY', LOCAL_KEY_HEX); });
  afterEach(() => { vi.unstubAllEnvs(); });

  /** The host as `run()` composes it: the deferred local provider as its fallback. */
  const serveHost = () => {
    const local = deferredLocalCryptoProvider();
    return createHostCryptoProvider(() => local.resolve());
  };

  it('chooses the local provider at kernel:ready, from the same key source as before', async () => {
    const host = serveHost();
    expect(host.provider.source).toBeUndefined();
    const kernel = await boot(host);
    try {
      expect(host.provider.source).toBe('local');
      const chosen = host.provider.resolve();
      expect(chosen).toBeInstanceOf(LocalCryptoProvider);
      expect((chosen as LocalCryptoProvider).keySource).toBe(new LocalCryptoProvider().keySource);
      expect(host.provider.confirm()).toBe(chosen);
    } finally {
      await kernel.shutdown();
    }
  });

  it('an encrypted setting written through it still opens the original way, and the other way round', async () => {
    const host = serveHost();
    const store = settingsSecretStore();
    const settings = new SettingsService({ env: {}, cryptoProvider: host.provider, secretStore: store } as never);
    settings.registerManifest(SETTINGS_MANIFEST);
    const kernel = await boot(host);
    try {
      await settings.set('crypto_ns', 'api_key', 'smtp-app-password');
      const [row] = [...store.rows.values()];
      // The original way: the provider the settings service built for itself
      // when it was handed none (`new LocalCryptoProvider()`).
      const original = new LocalCryptoProvider();
      expect(await original.decrypt(row, { scope: 'settings', namespace: 'crypto_ns', key: 'api_key' }))
        .toBe('smtp-app-password');
      expect((await settings.get('crypto_ns', 'api_key')).value).toBe('smtp-app-password');

      // And a value the original provider sealed opens through the shared one.
      const before = await original.encrypt('sealed-before-upgrade', { scope: 'settings', namespace: 'crypto_ns', key: 'api_key' });
      expect(await host.provider.decrypt(before, { scope: 'settings', namespace: 'crypto_ns', key: 'api_key' }))
        .toBe('sealed-before-upgrade');
    } finally {
      await kernel.shutdown();
    }
  });

  it('a secret field sealed by it opens under a LocalCryptoProvider built the original way', async () => {
    const host = serveHost();
    const kernel = await boot(host);
    try {
      const { engine, store } = await secretFieldEngine();
      host.provider.confirm();
      engine.setCryptoProvider(host.provider);
      await engine.insert('vault_item', { id: 'v1', token: 'hunter2' });
      const handle = sealedHandle(store, store.rowsOf('vault_item')[0].token);
      expect(await new LocalCryptoProvider().decrypt(handle, { scope: 'object_secret_field', namespace: 'vault_item', key: 'token' }))
        .toBe('hunter2');
    } finally {
      await kernel.shutdown();
    }
  });
});

describe('two registrations refuse at boot', () => {
  it('two declaring plugins are refused before either initializes, both named', () => {
    const a = providerPlugin('com.example.aws-kms-crypto', kmsProvider().provider);
    const b = providerPlugin('com.example.vault-crypto', kmsProvider().provider);
    const refusal = (() => {
      try { refuseTwoCryptoProviderPlugins([a, { name: 'com.example.unrelated', init: async () => {} }, b]); }
      catch (err) { return err as Error; }
      return undefined;
    })();
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(refusal!.message).toContain("'com.example.aws-kms-crypto' and 'com.example.vault-crypto'");
    expect(refusal!.message).toContain(`'${CRYPTO_PROVIDER_SERVICE}'`);
    expectNoKeyMaterial(refusal!.message);
  });

  it('one declaring plugin, or one plugin composed twice under its name, is not refused', () => {
    const a = providerPlugin('com.example.aws-kms-crypto', kmsProvider().provider);
    expect(() => refuseTwoCryptoProviderPlugins([a])).not.toThrow();
    expect(() => refuseTwoCryptoProviderPlugins([a, providerPlugin('com.example.aws-kms-crypto', kmsProvider().provider)]))
      .not.toThrow();
    expect(() => refuseTwoCryptoProviderPlugins([])).not.toThrow();
  });

  it('an undeclared second registration is refused by the kernel at boot', async () => {
    const host = createHostCryptoProvider(NO_LOCAL);
    await expect(boot(
      host,
      providerPlugin('com.example.first-crypto', kmsProvider().provider, { declare: false }),
      providerPlugin('com.example.second-crypto', kmsProvider().provider, { declare: false }),
    )).rejects.toThrow(`Service '${CRYPTO_PROVIDER_SERVICE}' already registered`);
    expect(host.provider.source).toBeUndefined();
  });
});

describe('a plugins entry that did not load refuses the boot unless it is ruled out as the crypto provider', () => {
  const refusalOf = (unloaded: Parameters<typeof refuseUnloadedCryptoProviderPlugins>[0]): Error | undefined => {
    try { refuseUnloadedCryptoProviderPlugins(unloaded); }
    catch (err) { return err as Error; }
    return undefined;
  };

  it('an entry that never materialized says nothing it provides, and is refused, named by its specifier', () => {
    const refusal = refusalOf([{ index: 2, entry: '@acme/kms-crypto', error: new Error("Failed to import plugin '@acme/kms-crypto': not found") }]);
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(refusal!.message).toContain("plugins[2] ('@acme/kms-crypto') did not load");
    expect(refusal!.message).toContain(`'${CRYPTO_PROVIDER_SERVICE}'`);
  });

  it('an entry that materialized and declares the provider is refused, named by its plugin name', () => {
    const plugin = providerPlugin('com.example.aws-kms-crypto', kmsProvider().provider);
    const refusal = refusalOf([
      { index: 0, entry: '@acme/aws-kms-crypto', materialized: plugin, error: new Error('Invalid semantic version') },
    ]);
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(refusal!.message).toContain("plugins[0] ('@acme/aws-kms-crypto')");
    const inline = refusalOf([{ index: 1, entry: plugin, materialized: plugin, error: new Error('boom') }]);
    expect(inline!.message).toContain("plugins[1] ('com.example.aws-kms-crypto') did not load (boom)");
    expectNoKeyMaterial(inline!.message);
  });

  it('an object entry that failed before it materialized is judged by what the entry itself declares', () => {
    const plugin = providerPlugin('com.example.vault-crypto', kmsProvider().provider);
    expect(refusalOf([{ index: 0, entry: plugin, error: new Error('boom') }])).toBeInstanceOf(HostCryptoProviderRefusal);
  });

  it('CONTROL: an entry that declares other services, or none, is ruled out; nothing unloaded is not refused', () => {
    expect(refusalOf([
      { index: 0, entry: { name: 'com.example.widgets', providesServices: ['widgets'], init: async () => {} }, error: new Error('x') },
      { index: 1, entry: '@acme/widgets', materialized: { name: 'com.example.plain', init: async () => {} }, error: new Error('y') },
    ])).toBeUndefined();
    expect(refusalOf([])).toBeUndefined();
  });

  it('a devPlugins entry is named by the list it was written in', () => {
    const refusal = refusalOf([
      { list: 'devPlugins', index: 0, entry: '@acme/dev-kms', error: new Error('a') },
      { index: 1, entry: '@acme/kms', error: new Error('b') },
    ]);
    expect(refusal!.message).toContain("devPlugins[0] ('@acme/dev-kms') did not load (a)");
    expect(refusal!.message).toContain("plugins[1] ('@acme/kms') did not load (b)");
  });

  it('reads a declaration as cryptoProviderPlugins does: an entry it counts as the provider is refused, one it does not is ruled out', () => {
    const declaring = providerPlugin('com.example.kms-crypto', kmsProvider().provider);
    const other = { name: 'com.example.widgets', providesServices: ['widgets'], init: async () => {} };
    const none = { name: 'com.example.plain', init: async () => {} };
    for (const candidate of [declaring, other, none]) {
      const counted = cryptoProviderPlugins([candidate]).length > 0;
      const refused = refusalOf([{ index: 0, entry: candidate, error: new Error('x') }]) !== undefined;
      expect(refused, (candidate as { name: string }).name).toBe(counted);
    }
  });

  it('every refused entry is named, and the ruled-out ones are not', () => {
    const refusal = refusalOf([
      { index: 0, entry: '@acme/one', error: new Error('a') },
      { index: 1, entry: { name: 'com.example.widgets', providesServices: ['widgets'], init: async () => {} }, error: new Error('b') },
      { index: 2, entry: '@acme/two', error: new Error('c') },
    ]);
    expect(refusal!.message).toContain("plugins[0] ('@acme/one')");
    expect(refusal!.message).toContain("plugins[2] ('@acme/two')");
    expect(refusal!.message).not.toContain('com.example.widgets');
  });
});

describe('a plugins entry the standalone boot sets aside refuses the boot unless it is ruled out as the crypto provider', () => {
  const refusalOf = async (authored: unknown, importSpecifier: (specifier: string) => Promise<unknown>): Promise<Error | undefined> => {
    try { await refuseSetAsideCryptoProviderPlugins(authored, importSpecifier); }
    catch (err) { return err as Error; }
    return undefined;
  };
  const notInstalled = async (specifier: string): Promise<unknown> => {
    throw new Error(`Failed to import plugin '${specifier}': not found`);
  };

  it('a specifier that does not import declares nothing, and is refused, named by its specifier', async () => {
    const refusal = await refusalOf(['@acme/kms-crypto'], notInstalled);
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(refusal!.message).toContain("plugins[0] ('@acme/kms-crypto') did not load");
    expect(refusal!.message).toContain(`'${CRYPTO_PROVIDER_SERVICE}'`);
  });

  it('a specifier that imports a plugin declaring the provider is refused, named by its specifier', async () => {
    const plugin = providerPlugin('com.example.aws-kms-crypto', kmsProvider().provider);
    const refusal = await refusalOf(['@acme/aws-kms-crypto'], async () => ({ default: plugin }));
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(refusal!.message).toContain("plugins[0] ('@acme/aws-kms-crypto') provides the crypto provider");
    expectNoKeyMaterial(refusal!.message);
  });

  it('an object entry declaring the provider is read as it is, never booted, and refused by its name', async () => {
    let initialized = false;
    const entry = { name: 'com.example.vault-crypto', providesServices: [CRYPTO_PROVIDER_SERVICE], init: async () => { initialized = true; } };
    const refusal = await refusalOf([entry], notInstalled);
    expect(refusal!.message).toContain("plugins[0] ('com.example.vault-crypto') provides the crypto provider");
    expect(initialized).toBe(false);
  });

  it('CONTROL: entries that declare other services, or none, and a missing list, are ruled out', async () => {
    expect(await refusalOf([
      { name: 'com.example.widgets', providesServices: ['widgets'] },
      { name: 'com.example.bundle', objects: [] },
      '@acme/widgets',
      null,
    ], async () => ({ default: { name: 'com.example.plain', providesServices: ['plain'] } }))).toBeUndefined();
    expect(await refusalOf(undefined, notInstalled)).toBeUndefined();
    expect(await refusalOf([], notInstalled)).toBeUndefined();
  });
});

describe('the deferred path: nothing is sealed by a provider the boot did not choose', () => {
  it('a credential bound before the post-start wiring is sealed by the registered provider', async () => {
    const kms = kmsProvider();
    const host = createHostCryptoProvider(NO_LOCAL);
    const binder = createDatasourceSecretBinder({ engine: secretRows() as never, cryptoProvider: host.provider });
    // A plugin that binds a credential from its own kernel:ready hook — the
    // datasource admin's rehydration window, before serve's post-start wiring.
    let boundAtReady: string | undefined;
    const early = {
      name: 'com.example.binds-at-ready',
      version: '1.0.0',
      init: async (ctx: { hook(name: string, fn: () => Promise<void>): void }) => {
        ctx.hook('kernel:ready', async () => { boundAtReady = await binder.bind({ value: 'early-secret' }, { name: 'early' }); });
      },
    };
    const kernel = await boot(host, early, providerPlugin('com.example.kms-crypto-provider', kms.provider));
    try {
      expect(boundAtReady).toMatch(/^sys_secret:/);
      expect(kms.sealed).toEqual(['datasource_credential']);
      expect(host.provider.source).toBe('registered');
    } finally {
      await kernel.shutdown();
    }
  });

  it.each([
    { hostFirst: false, when: 'before the host plugin initializes' },
    { hostFirst: true, when: 'after the host plugin, while plugin init is still running' },
  ])('a seal attempted during plugin init ($when) refuses, records nothing, and the boot still chooses the registered one', async ({ hostFirst }) => {
    const kms = kmsProvider();
    const host = createHostCryptoProvider(NO_LOCAL);
    let duringInit: unknown;
    const tooEarly = {
      name: 'com.example.seals-in-init',
      version: '1.0.0',
      init: async () => {
        duringInit = await host.provider.encrypt('x', { scope: 'settings', namespace: 'n', key: 'k' }).catch((e) => e);
        // Nothing was chosen: the provider below has not registered yet.
        expect(host.provider.source).toBeUndefined();
      },
    };
    const kernel = await bootIn(
      { hostFirst }, host, tooEarly, providerPlugin('com.example.kms-crypto-provider', kms.provider),
    );
    try {
      expect(duringInit).toBeInstanceOf(HostCryptoProviderRefusal);
      expectNoKeyMaterial((duringInit as Error).message);
      expect(host.provider.source).toBe('registered');
      expect(kms.sealed).toEqual([]);
    } finally {
      await kernel.shutdown();
    }
  });

  it('a provider registered after init refuses the boot', async () => {
    const host = createHostCryptoProvider(() => new LocalCryptoProvider({ key: KMS_KEY }));
    const late = {
      name: 'com.example.registers-in-start',
      version: '1.0.0',
      init: async () => {},
      start: async (ctx: { hook(name: string, fn: () => void): void; registerService(name: string, s: unknown): void }) => {
        ctx.hook('kernel:bootstrapped', () => { ctx.registerService(CRYPTO_PROVIDER_SERVICE, kmsProvider().provider); });
      },
    };
    const kernel = await boot(host, late);
    try {
      expect(host.provider.source).toBe('local');
      expect(() => host.provider.confirm()).toThrow(HostCryptoProviderRefusal);
      expect(() => host.provider.confirm()).toThrow(/after every plugin had initialized/);
    } finally {
      await kernel.shutdown();
    }
  });

  it('a registered provider replaced after the choice refuses the boot', async () => {
    const host = createHostCryptoProvider(NO_LOCAL);
    const replacer = {
      name: 'com.example.replaces-provider',
      version: '1.0.0',
      init: async () => {},
      start: async (ctx: { hook(name: string, fn: () => void): void; replaceService(name: string, s: unknown): void }) => {
        ctx.hook('kernel:bootstrapped', () => { ctx.replaceService(CRYPTO_PROVIDER_SERVICE, kmsProvider().provider); });
      },
    };
    const kernel = await boot(host, replacer, providerPlugin('com.example.kms-crypto-provider', kmsProvider().provider));
    try {
      expect(host.provider.source).toBe('registered');
      expect(() => host.provider.confirm()).toThrow(/was replaced after this boot chose it/);
    } finally {
      await kernel.shutdown();
    }
  });

  it('a registered value that is not a crypto provider refuses the boot, naming what it lacks and nothing it holds', async () => {
    const host = createHostCryptoProvider(NO_LOCAL);
    const notAProvider = { encrypt: async () => null, keyMaterial: KMS_KEY.toString('hex') };
    const refusal = await boot(host, providerPlugin('com.example.bad-crypto', notAProvider)).then(() => undefined, (e) => e as Error);
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(refusal!.message).toContain('decrypt(), rotateKey(), digest(), keyedDigest()');
    expectNoKeyMaterial(refusal!.message);
  });
});

describe('the wiring inside run()', () => {
  it('builds one host provider over the deferred local one, and mounts its plugin', () => {
    expect(SERVE.match(/createHostCryptoProvider\(/g)).toHaveLength(2); // the definition and the one call
    expect(SERVE).toContain('hostCrypto = createHostCryptoProvider(() => localCryptoProvider.resolve());');
    expect(SERVE).toContain('await kernel.use(hostCrypto.plugin);');
  });

  it('hands that one provider to the binder, the default settings service and the data engine', () => {
    expect(SERVE).toMatch(/createDatasourceSecretBinder\(\{\s*engine: lazySecretEngine,\s*cryptoProvider: hostCrypto\.provider,\s*\}\)/);
    expect(SERVE).toMatch(/cap === 'settings' && hostCrypto\s*\?\s*\{ \.\.\.\(arg \?\? \{\}\), cryptoProvider: hostCrypto\.provider \}/);
    expect(SERVE).toMatch(/hostCrypto\.provider\.confirm\(\);\s*dataEngine\.setCryptoProvider\(hostCrypto\.provider\);/);
    // No consumer is handed a provider of its own any more.
    expect(SERVE).not.toMatch(/new LocalCryptoProvider\(/);
    expect(SERVE.match(/setCryptoProvider\(/g)).toHaveLength(1);
  });

  it('refuses an unloaded entry that may provide the crypto provider right after the plugins loop, before the host provider is built', () => {
    const record = SERVE.indexOf('unloadedStackPlugins.push(');
    const check = SERVE.indexOf('refuseUnloadedCryptoProviderPlugins(unloadedStackPlugins);');
    const host = SERVE.indexOf('hostCrypto = createHostCryptoProvider(() => localCryptoProvider.resolve());');
    expect(record).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(record);
    expect(host).toBeGreaterThan(check);
  });

  it('refuses a set-aside entry that may provide the crypto provider before the standalone stack replaces the authored plugins', () => {
    const branch = SERVE.indexOf('if (useArtifactFallback || shouldBootWithLibrary(config)) {');
    const check = SERVE.indexOf('await refuseSetAsideCryptoProviderPlugins(');
    const replaced = SERVE.indexOf('config = mergeBootConfig(originalConfig as any, bootResult as any) as any;');
    expect(branch).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(branch);
    expect(replaced).toBeGreaterThan(check);
  });

  it('checks the declared providers before the boot', () => {
    const check = SERVE.indexOf('refuseTwoCryptoProviderPlugins([...stackMountedPlugins, ...resolverMounted]);');
    const start = SERVE.indexOf('await runtime.start();');
    expect(check).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(check);
  });
});

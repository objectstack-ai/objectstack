// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A one-shot command reads the plugins `os plugin install` installed when it
 * chooses the crypto provider, by `os serve`'s rule for them.
 *
 * `os serve` registers the installed plugins of this project and environment
 * beside its config's `plugins` (`registerInstalledPlugins`), so one of them
 * can be the plugin that registers the crypto provider. A one-shot run
 * ({@link oneShotCrypto}: `os secret rewrap`, `os secret orphans`, the data
 * migrations' settings arm) chooses the same provider, so it reads them too,
 * through the loader `serve` reads them with (`loadHostInstalledPlugins`,
 * stood in for here: its verification is pinned in `@objectstack/runtime` and
 * end to end in `test/serve-installed-plugins.integration.test.ts`).
 *
 * Pinned, each composition booted in a REAL `ObjectKernel`:
 *
 *   1. an installed plugin that loads and declares the provider is the one the
 *      run seals and opens with, and the local key is never resolved — signed
 *      too, with the verdict its host recorded; a refusal of it says it is
 *      installed, never that the host config declares it;
 *   2. a refused installed plugin that may provide it refuses the run, named,
 *      before anything boots — ⛔ never the local key;
 *   3. CONTROL: a refusal `serve` rules out, and no installations file, leave
 *      the local provider over the key that already exists;
 *   4. a config plugin and an installed one both declaring it are refused,
 *      both named; an installed declaring plugin whose name the config, or an
 *      installed plugin read before it, takes is refused as `serve` refuses it;
 *   5. the read leaves a pending uninstall as it is.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ObjectKernel, recordPluginArtifactVerdict } from '@objectstack/core';
import { LocalCryptoProvider } from '@objectstack/service-settings';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import type { InstalledPluginsLoad } from '@objectstack/runtime';
import { CRYPTO_PROVIDER_SERVICE } from '@objectstack/types';

const stub = vi.hoisted(() => ({
  load: null as null | (() => Promise<unknown>),
  calls: [] as unknown[],
}));

vi.mock('./installed-plugins-boot.js', () => ({
  loadHostInstalledPlugins: async (opts: unknown) => {
    stub.calls.push(opts);
    return stub.load ? stub.load() : null;
  },
  registerInstalledPlugins: async () => null,
}));

import { HostCryptoProviderRefusal } from '../commands/serve.js';
import { oneShotCrypto, type OneShotCrypto } from './one-shot-settings.js';

// Paid at collection, not inside a clocked case: what the one-shot crypto
// composition reaches through dynamic `import()`s (`check:test-source-alias`).
import '@objectstack/driver-sql';
import '@objectstack/driver-turso';
import '@objectstack/metadata';
import '@objectstack/metadata-protocol';
import '@objectstack/objectql';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-hono-server';
import '@objectstack/plugin-security';
import '@objectstack/rest';
import '@objectstack/service-datasource';

const LOCAL_KEY_HEX = '606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f';
const KMS_KEY = Buffer.from('404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f', 'hex');
const CTX: CryptoContext = { scope: 'settings', namespace: 'crypto_ns', key: 'api_key' };

/** The provider a test plugin registers: AES-GCM under {@link KMS_KEY}. */
function kmsProvider(): ICryptoProvider {
  const inner = new LocalCryptoProvider({ key: KMS_KEY });
  return {
    async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
      return { ...(await inner.encrypt(plain, ctx)), kmsKeyId: 'test-kms' };
    },
    decrypt: (handle, ctx) => inner.decrypt(handle, ctx),
    rotateKey: (handle, ctx) => inner.rotateKey(handle, ctx),
    digest: (plain) => inner.digest(plain),
    keyedDigest: (plain) => inner.keyedDigest(plain),
  };
}

/** A plugin that registers `provider` as the crypto provider during init. */
function providerPlugin(name: string, provider: unknown, inits: string[] = []) {
  return {
    name,
    version: '1.0.0',
    providesServices: [CRYPTO_PROVIDER_SERVICE],
    init: async (ctx: { registerService(name: string, service: unknown): void }) => {
      inits.push(name);
      if (provider !== undefined) ctx.registerService(CRYPTO_PROVIDER_SERVICE, provider);
    },
  };
}

const DATA_STUB = {
  name: 'com.example.one-shot-installed.data-stub',
  version: '1.0.0',
  init: async (ctx: { registerService(name: string, service: unknown): void }) => { ctx.registerService('data', {}); },
};

const FIXTURE_KEY = '__os_one_shot_installed_fixture';
const dirs: string[] = [];

beforeEach(() => {
  stub.load = null;
  stub.calls = [];
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[FIXTURE_KEY];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project directory; with `plugins`, an `objectstack.config.mjs` exporting them. */
function project(plugins: unknown[] | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-one-shot-installed-'));
  dirs.push(dir);
  if (plugins === null) return dir;
  (globalThis as Record<string, unknown>)[FIXTURE_KEY] = plugins;
  writeFileSync(
    join(dir, 'objectstack.config.mjs'),
    `export default { name: 'one_shot_installed_fixture', plugins: globalThis.${FIXTURE_KEY} };\n`,
  );
  return dir;
}

function envWith(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'os-one-shot-installed-home-'));
  dirs.push(home);
  return { OS_HOME: home, ...extra };
}

const record = (id: string) => ({ id, version: '1.0.0' }) as InstalledPluginsLoad['loaded'][number]['record'];

/** What the stand-in loader answers for the case. */
function installed(answer: Partial<InstalledPluginsLoad>): void {
  stub.load = async () => ({ loaded: [], refused: [], disabled: [], removed: [], ...answer });
}

async function boot(crypto: OneShotCrypto) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(DATA_STUB);
  for (const plugin of crypto.plugins) {
    if ((plugin as { opts?: { cryptoProvider?: unknown } }).opts?.cryptoProvider !== undefined) continue;
    await kernel.use(plugin as never);
  }
  await kernel.bootstrap();
  return kernel;
}

const refusalOf = (run: Promise<unknown>): Promise<unknown> => run.then(() => null, (error: unknown) => error);

describe('an installed plugin that declares the crypto provider is the one the run seals with', () => {
  it('the run uses its provider, and the local key is never resolved', async () => {
    const kms = providerPlugin('com.acme.kms', kmsProvider());
    installed({ loaded: [{ record: record('com.acme.kms'), plugin: kms, declaredServices: [CRYPTO_PROVIDER_SERVICE] }] });
    const crypto = await oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });

    expect(crypto.declaredBy).toBe('com.acme.kms');
    expect(crypto.key).toBeNull();
    await boot(crypto);
    expect(crypto.provider.source).toBe('registered');
    const handle = await crypto.provider.encrypt('kms-sealed', CTX);
    expect(handle.kmsKeyId).toBe('test-kms');
    expect(await crypto.provider.decrypt(handle, CTX)).toBe('kms-sealed');
    await expect(new LocalCryptoProvider({ key: Buffer.from(LOCAL_KEY_HEX, 'hex') }).decrypt(handle, CTX)).rejects.toThrow();
  }, 60_000);

  it('a signed one boots with the verdict its host recorded', async () => {
    const signature = `ed25519:acme-kid:${Buffer.from('a detached signature').toString('base64url')}`;
    const kms = { ...providerPlugin('com.acme.kms', kmsProvider()), signature };
    recordPluginArtifactVerdict(kms, { signature, keyId: 'acme-kid', fingerprint: null, artifactSha256: '00'.repeat(32) });
    installed({ loaded: [{ record: record('com.acme.kms'), plugin: kms, declaredServices: [CRYPTO_PROVIDER_SERVICE] }] });
    const crypto = await oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });

    await boot(crypto);
    expect(crypto.provider.source).toBe('registered');
    const handle = await crypto.provider.encrypt('kms-sealed', CTX);
    expect(handle.kmsKeyId).toBe('test-kms');
  }, 60_000);

  it('a refusal of it says it is installed, never that the host config declares it', async () => {
    installed({ loaded: [{ record: record('com.acme.kms'), plugin: providerPlugin('com.acme.kms', undefined), declaredServices: [CRYPTO_PROVIDER_SERVICE] }] });
    const silent = await oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });
    const none = await refusalOf(boot(silent));
    expect(none).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(String((none as Error).message)).toContain("'com.acme.kms' declares the crypto provider ('crypto-provider') as a plugin installed by `os plugin install`");
    expect(String((none as Error).message)).not.toContain('host config');

    const failing = { ...providerPlugin('com.acme.kms', undefined), init: async () => { throw new Error('kms unreachable'); } };
    installed({ loaded: [{ record: record('com.acme.kms'), plugin: failing, declaredServices: [CRYPTO_PROVIDER_SERVICE] }] });
    const broken = await oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });
    const failed = await refusalOf(boot(broken));
    expect(String((failed as Error).message)).toContain("'com.acme.kms', which declares the crypto provider ('crypto-provider') as a plugin installed by `os plugin install`, could not boot");
    expect(String((failed as Error).message)).toContain('kms unreachable');
    expect(String((failed as Error).message)).not.toContain('host config');
  }, 60_000);

  it('beside a host config whose plugins declare none', async () => {
    const kms = providerPlugin('com.acme.kms', kmsProvider());
    installed({ loaded: [{ record: record('com.acme.kms'), plugin: kms, declaredServices: [CRYPTO_PROVIDER_SERVICE] }] });
    const dir = project([{ name: 'com.example.unrelated', version: '1.0.0', init: async () => {} }]);
    const crypto = await oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });
    expect(crypto.declaredBy).toBe('com.acme.kms');
  }, 60_000);
});

describe('a refused installed plugin that may provide it refuses the run, never the local key', () => {
  it('a refusal before its import is refused, naming the plugin and its code', async () => {
    installed({ refused: [{ id: 'com.acme.kms', version: '1.0.0', error: 'tree_changed', message: 'x' }] });
    const refusal = await refusalOf(oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) }));
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(String((refusal as Error).message)).toContain('installed plugin com.acme.kms@1.0.0 was refused (tree_changed)');
    expect(String((refusal as Error).message)).toContain('os plugin disable com.acme.kms');
    expect(String((refusal as Error).message)).not.toContain(LOCAL_KEY_HEX);
  }, 60_000);

  it('an imported refused plugin that declares it is refused; the loader failing outright is refused', async () => {
    installed({ refused: [{ id: 'com.acme.kms', version: '1.0.0', error: 'signature_conflict', message: 'x', declaredServices: [CRYPTO_PROVIDER_SERVICE] }] });
    expect(await refusalOf(oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) }))).toBeInstanceOf(HostCryptoProviderRefusal);
    installed({ refused: [{ id: '*', version: '*', error: 'loader_failed', message: 'x' }] });
    expect(await refusalOf(oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) }))).toBeInstanceOf(HostCryptoProviderRefusal);
  }, 60_000);

  it('CONTROL: a refusal serve rules out, and no installations file, leave the local provider over the existing key', async () => {
    installed({
      refused: [
        { id: 'com.acme.sandboxed', version: '1.0.0', error: 'runtime_not_dispatched', message: 'x' },
        { id: 'com.acme.widgets', version: '1.0.0', error: 'kernel_refused', message: 'x', declaredServices: ['widgets'] },
      ],
      loaded: [{ record: record('com.acme.plain'), plugin: { name: 'com.acme.plain', init: async () => {} }, declaredServices: [] }],
    });
    const ruledOut = await oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });
    expect(ruledOut.declaredBy).toBeNull();
    expect(ruledOut.key?.provider?.keySource).toBe('env:OS_SECRET_KEY');

    stub.load = null;
    const none = await oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });
    expect(none.declaredBy).toBeNull();
    await boot(none);
    expect(none.provider.source).toBe('local');
  }, 60_000);
});

describe('with the host config, serve\'s rules for both lists hold', () => {
  it('a config plugin and an installed plugin both declaring it are refused, both named, before either initializes', async () => {
    const inits: string[] = [];
    installed({ loaded: [{ record: record('com.acme.kms'), plugin: providerPlugin('com.acme.kms', kmsProvider(), inits), declaredServices: [CRYPTO_PROVIDER_SERVICE] }] });
    const dir = project([providerPlugin('com.example.vault', kmsProvider(), inits)]);
    const refusal = await refusalOf(oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) }));
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(String((refusal as Error).message)).toContain("'com.example.vault' and 'com.acme.kms'");
    expect(inits).toEqual([]);
  }, 60_000);

  it('an installed declaring plugin whose name a config plugin takes is refused, as serve refuses it', async () => {
    installed({ loaded: [{ record: record('com.acme.kms'), plugin: providerPlugin('com.example.taken', kmsProvider()), declaredServices: [CRYPTO_PROVIDER_SERVICE] }] });
    const dir = project([{ name: 'com.example.taken', version: '1.0.0', init: async () => {} }]);
    const refusal = await refusalOf(oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) }));
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(String((refusal as Error).message)).toContain('installed plugin com.acme.kms@1.0.0 was refused (plugin_name_taken)');
  }, 60_000);

  it('an installed declaring plugin whose name an installed plugin read before it takes is refused, as serve refuses it', async () => {
    installed({
      loaded: [
        { record: record('com.acme.first'), plugin: { name: 'com.example.shared', version: '1.0.0', init: async () => {} }, declaredServices: [] },
        { record: record('com.acme.kms'), plugin: providerPlugin('com.example.shared', kmsProvider()), declaredServices: [CRYPTO_PROVIDER_SERVICE] },
      ],
    });
    const refusal = await refusalOf(oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) }));
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(String((refusal as Error).message)).toContain('installed plugin com.acme.kms@1.0.0 was refused (plugin_name_taken)');
    expect(String((refusal as Error).message)).not.toContain('com.acme.first@');
  }, 60_000);
});

describe('the read registers and removes nothing', () => {
  it('asks the loader to leave a pending uninstall as it is', async () => {
    installed({});
    await oneShotCrypto({ cwd: project(null), env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });
    expect(stub.calls).toEqual([{ leaveUninstallsPending: true }]);
  }, 60_000);
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A one-shot command seals and opens secrets with the provider `os serve`
 * seals with on the same host, chosen by `serve`'s own function.
 *
 * ## The gap
 *
 * `os serve` seals every `sys_secret` row with the crypto provider a plugin of
 * its stack registers as the kernel service `crypto-provider` (a KMS/Vault
 * one, for customer-managed keys), else its own `LocalCryptoProvider`
 * (`createHostCryptoProvider`, `commands/serve.ts`). The one-shot composition
 * (`utils/one-shot-settings.ts`: `os secret rewrap`, `os secret orphans`, the
 * data migrations' settings arm) always built the local provider, so on such a
 * deployment it could open nothing `serve` sealed, and a re-wrap would have
 * re-sealed under the local key.
 *
 * ## What this file pins
 *
 * Each case writes a host config into a fresh directory, composes
 * {@link oneShotCrypto} over it, and boots the composition's plugins in a REAL
 * `ObjectKernel`, the way `serve`'s own pins boot its host plugin:
 *
 *   1. one plugin declares and registers the provider: the run seals and opens
 *      with it, and the local key is never resolved;
 *   2. no plugin declares one: the local provider over the key that already
 *      exists, which opens what a provider built the original way sealed and
 *      the other way round; with no key, a provider that refuses every call;
 *   3. two declaring plugins: refused before either initializes, both named;
 *   4. fail closed: a declared provider that cannot boot, or boots and
 *      registers none, refuses the boot naming it, and a host config or entry
 *      that cannot be read refuses before any boot — ⛔ never the local key.
 *
 * The command-level refusal, with the stored rows read back byte-equal, is in
 * `commands/secret/rewrap.driver-contract.test.ts`.
 *
 * ⛔ No key material reaches a refusal: every refusal is checked against the
 * test keys' bytes.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ObjectKernel } from '@objectstack/core';
import { LocalCryptoProvider } from '@objectstack/service-settings';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import { CRYPTO_PROVIDER_SERVICE } from '@objectstack/types';

import { HostCryptoProviderRefusal } from '../commands/serve.js';
import { oneShotCrypto, type OneShotCrypto } from './one-shot-settings.js';

/** The local key, when a case gives the run one. */
const LOCAL_KEY_HEX = '606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f';
/** The key behind the registered ("KMS") provider. Never the local one. */
const KMS_KEY = Buffer.from('404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f', 'hex');
const CTX: CryptoContext = { scope: 'settings', namespace: 'crypto_ns', key: 'api_key' };

/** A refusal carries no byte of either key, in any spelling a log would print. */
function expectNoKeyMaterial(text: string): void {
  for (const spelling of [LOCAL_KEY_HEX, KMS_KEY.toString('hex'), KMS_KEY.toString('base64')]) {
    expect(text).not.toContain(spelling);
  }
}

/** The provider a test plugin registers: AES-GCM under {@link KMS_KEY}, every seal recorded. */
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

/** What a case's host config hands its `plugins`, read by the config module at load. */
type Fixture = { plugins: unknown[] };
const FIXTURE_KEY = '__os_one_shot_crypto_fixture';

/** A plugin that registers `provider` as the crypto provider during init, recording that it ran. */
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

/** The one service a kernel refuses to start without. Nothing here reads data. */
const DATA_STUB = {
  name: 'com.example.one-shot-crypto.data-stub',
  version: '1.0.0',
  init: async (ctx: { registerService(name: string, service: unknown): void }) => { ctx.registerService('data', {}); },
};

const dirs: string[] = [];
afterEach(() => {
  delete (globalThis as Record<string, unknown>)[FIXTURE_KEY];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A project directory whose `objectstack.config.mjs` exports `plugins` — the
 * case's {@link Fixture}, or `source` verbatim. `null` writes no config.
 */
function project(config: Fixture | string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-one-shot-crypto-'));
  dirs.push(dir);
  if (config === null) return dir;
  if (typeof config === 'string') {
    writeFileSync(join(dir, 'objectstack.config.mjs'), config);
    return dir;
  }
  (globalThis as Record<string, unknown>)[FIXTURE_KEY] = config;
  writeFileSync(
    join(dir, 'objectstack.config.mjs'),
    `export default { name: 'one_shot_crypto_fixture', plugins: globalThis.${FIXTURE_KEY}.plugins };\n`,
  );
  return dir;
}

/** The env a case runs in: an empty key home, plus what the case adds. */
function envWith(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'os-one-shot-crypto-home-'));
  dirs.push(home);
  return { OS_HOME: home, ...extra };
}

/**
 * Boot the composition in a real kernel. The settings service is left out: it
 * needs a data engine, and it holds `crypto.provider`, which is what is read.
 */
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

/** The settings service the composition hands the boot, and the provider it holds. */
function settingsProviderOf(crypto: OneShotCrypto): unknown {
  const settings = crypto.plugins.find(
    (p) => (p as { opts?: { cryptoProvider?: unknown } }).opts?.cryptoProvider !== undefined,
  ) as { opts: { cryptoProvider: unknown } };
  return settings.opts.cryptoProvider;
}

describe('one declared and registered provider seals and opens every secret of the run', () => {
  it('the run uses the registered provider, the settings service holds it, and the local key is never resolved', async () => {
    const kms = kmsProvider();
    const dir = project({ plugins: [providerPlugin('com.example.kms', kms.provider)] });
    const crypto = await oneShotCrypto({ cwd: dir, env: envWith() });

    expect(crypto.declaredBy).toBe('com.example.kms');
    expect(crypto.key).toBeNull();
    expect(settingsProviderOf(crypto)).toBe(crypto.provider);

    await boot(crypto);
    expect(crypto.provider.source).toBe('registered');
    expect(crypto.provider.confirm()).toBe(kms.provider);

    const handle = await crypto.provider.encrypt('kms-sealed', CTX);
    expect(handle.kmsKeyId).toBe('test-kms');
    expect(kms.sealed).toEqual(['settings']);
    expect(await crypto.provider.decrypt(handle, CTX)).toBe('kms-sealed');
    // Sealed under the KMS key, not the local one.
    await expect(new LocalCryptoProvider({ key: Buffer.from(LOCAL_KEY_HEX, 'hex') }).decrypt(handle, CTX)).rejects.toThrow();
  }, 60_000);
});

describe('with no declaration, the provider is the local one over the key that already exists', () => {
  it('an existing key: what it seals opens under a LocalCryptoProvider built the original way, and the other way round', async () => {
    for (const dir of [project(null), project({ plugins: [{ name: 'com.example.unrelated', version: '1.0.0', init: async () => {} }] })]) {
      const crypto = await oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });
      expect(crypto.declaredBy).toBeNull();
      expect(crypto.key?.provider?.keySource).toBe('env:OS_SECRET_KEY');

      await boot(crypto);
      expect(crypto.provider.source).toBe('local');
      const original = new LocalCryptoProvider({ key: Buffer.from(LOCAL_KEY_HEX, 'hex') });
      expect(await original.decrypt(await crypto.provider.encrypt('local-sealed', CTX), CTX)).toBe('local-sealed');
      expect(await crypto.provider.decrypt(await original.encrypt('original-sealed', CTX), CTX)).toBe('original-sealed');
    }
  }, 60_000);

  it('no key: the chosen provider refuses every call, naming why, and nothing is minted', async () => {
    const env = envWith({ NODE_ENV: 'production' });
    const crypto = await oneShotCrypto({ cwd: project(null), env });
    expect(crypto.key?.provider).toBeNull();

    await boot(crypto);
    expect(crypto.provider.source).toBe('local');
    await expect(crypto.provider.encrypt('x', CTX)).rejects.toThrow(crypto.key!.unavailable!);
  }, 60_000);
});

describe('two declaring plugins are refused before either initializes', () => {
  it('both are named, and neither init() ran', async () => {
    const inits: string[] = [];
    const dir = project({
      plugins: [
        providerPlugin('com.example.kms-a', kmsProvider().provider, inits),
        providerPlugin('com.example.kms-b', kmsProvider().provider, inits),
      ],
    });
    const refusal = await oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) })
      .then(() => null, (error: unknown) => error);

    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(String((refusal as Error).message)).toContain("'com.example.kms-a' and 'com.example.kms-b'");
    expect(inits).toEqual([]);
    expectNoKeyMaterial(String((refusal as Error).message));
  }, 60_000);
});

describe('fail closed: a declared provider this run cannot boot is refused by name, never replaced by the local key', () => {
  it('a declaring plugin whose init() throws refuses the boot, naming it', async () => {
    const dir = project({
      plugins: [{
        ...providerPlugin('com.example.kms-offline', undefined),
        init: async () => { throw new Error('KMS endpoint unreachable'); },
      }],
    });
    // A usable local key is present: the refusal must not fall back to it.
    const crypto = await oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });
    expect(crypto.key).toBeNull();

    const refusal = await boot(crypto).then(() => null, (error: unknown) => error);
    const message = String((refusal as Error | null)?.message);
    expect(message).toContain("'com.example.kms-offline'");
    expect(message).toContain('KMS endpoint unreachable');
    expectNoKeyMaterial(message);
    expect(crypto.provider.source).toBeUndefined();
  }, 60_000);

  it('a declaring plugin that boots and registers no provider refuses at kernel:ready, naming it', async () => {
    const dir = project({ plugins: [providerPlugin('com.example.kms-silent', undefined)] });
    const crypto = await oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) });

    const refusal = await boot(crypto).then(() => null, (error: unknown) => error);
    const message = String((refusal as Error | null)?.message);
    expect(message).toContain("'com.example.kms-silent'");
    expect(message).toContain('registered none');
    expectNoKeyMaterial(message);
    await expect(crypto.provider.encrypt('x', CTX)).rejects.toThrow("'com.example.kms-silent'");
  }, 60_000);

  it('a host config that does not load is refused, naming it, before any boot', async () => {
    const dir = project("throw new Error('config exploded');\n");
    const refusal = await oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) })
      .then(() => null, (error: unknown) => error);
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(String((refusal as Error).message)).toContain('objectstack.config.mjs');
    expect(String((refusal as Error).message)).toContain("crypto provider ('crypto-provider')");
  }, 60_000);

  it('a plugins entry that does not resolve is refused, naming the entry, before any boot', async () => {
    const dir = project("export default { name: 'one_shot_crypto_fixture', plugins: ['@objectstack-fixture/absent-kms-plugin'] };\n");
    const refusal = await oneShotCrypto({ cwd: dir, env: envWith({ OS_SECRET_KEY: LOCAL_KEY_HEX }) })
      .then(() => null, (error: unknown) => error);
    expect(refusal).toBeInstanceOf(HostCryptoProviderRefusal);
    expect(String((refusal as Error).message)).toContain("plugins[0] ('@objectstack-fixture/absent-kms-plugin')");
  }, 60_000);
});

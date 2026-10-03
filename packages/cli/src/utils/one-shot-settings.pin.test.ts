// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21471] The settings service is composed in ONE place in this package, and
 * that place never mints a data key.
 *
 * ## The enumeration
 *
 * `SettingsServicePlugin` handed no `cryptoProvider` builds a
 * `LocalCryptoProvider` of its own, and in a development posture with no key
 * that provider writes a key file into the key home. `os secret orphans` (a
 * report that "writes nothing") and the storage arm of the data-migration
 * plugins (`os storage orphans`, `os migrate files-to-references`) composed it
 * that way, one call site at a time. So the family here is not a list someone
 * remembered: it is every non-test module under `src/` whose CODE names the
 * plugin or the provider, by any spelling the code can use — the constructor,
 * a destructured or renamed import, a property read, the capability table's
 * string. A new composer fails the first case below, by file name.
 *
 * Allowed: `utils/one-shot-settings.ts`, which composes it for every one-shot
 * command, and the hosts in {@link HOSTS}, each with the reason it may take
 * the default. Comments are masked by the repo's one code/prose separator, so
 * a docblock that mentions the plugin is not a composer.
 *
 * ⚠️ Out of reach, stated: a composition inside ANOTHER package that a command
 * calls into (a library's own boot harness) names nothing here. That residue
 * is the census's to list, not this pin's to see.
 *
 * ## The helper's contract
 *
 * Read directly, in a development posture with an empty key home, against the
 * control that the default provider mints there. The command-level pin — every
 * `bootSchemaStack` caller, every mode, booted for real — is
 * `schema-migrate.one-shot-family.integration.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalCryptoProvider } from '@objectstack/service-settings';
// The one code/prose separator, typed by the hand-written `.d.mts` beside it.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import { oneShotSettingsPlugin, refusingCryptoProvider, resolveExistingDataKey } from './one-shot-settings.js';

/** …/packages/cli/src/utils */
const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** …/packages/cli/src — the whole CLI source tree, this package's own. */
const SRC = resolve(HERE, '..');

/** The one module that composes the settings service for a one-shot command. */
const HELPER = 'utils/one-shot-settings.ts';

/** Modules that may take the default composition, and why each may. */
const HOSTS: Record<string, string> = {
  'commands/serve.ts':
    'the long-lived host (`os serve`, and `os dev` / `os start`, which spawn it): a key persisted in a '
    + 'development posture so that restarts reuse it is that host\'s documented behaviour, and a '
    + 'production posture refuses to boot without a stable key',
};

/** Every spelling under which code can reach the plugin or the provider. */
const COMPOSER = /\b(?:SettingsServicePlugin|LocalCryptoProvider|InMemoryCryptoProvider)\b/;

/** Every non-test source module under `src/`, as a path relative to it. */
function sourceModules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceModules(abs));
    else if (
      /\.[cm]?[jt]s$/.test(entry.name)
      && !/\.(?:test|spec)\.[cm]?[jt]s$/.test(entry.name)
      && !/\.d\.[cm]?ts$/.test(entry.name)
    ) {
      out.push(relative(SRC, abs).split('\\').join('/'));
    }
  }
  return out;
}

describe('[#21471] the settings service is composed in one place in this package', () => {
  it('every module whose code names the settings plugin or the local provider is the helper or a declared host', () => {
    const found = sourceModules(SRC)
      .filter((rel) => COMPOSER.test(maskComments(readFileSync(join(SRC, rel), 'utf8'))))
      .sort();
    // Non-vacuity: the detector sees the host's capability-table string.
    expect(found).toContain('commands/serve.ts');
    expect(found, 'a module composes the settings service or a crypto provider outside the one-shot helper')
      .toEqual([HELPER, ...Object.keys(HOSTS)].sort());
  });

  it('the detector reads code, not prose', () => {
    expect(COMPOSER.test(maskComments('// a docblock naming SettingsServicePlugin\nconst x = 1;\n'))).toBe(false);
    expect(COMPOSER.test(maskComments("const { SettingsServicePlugin: S } = await import('x');\n"))).toBe(true);
    expect(COMPOSER.test(maskComments("const spec = { export: 'SettingsServicePlugin' };\n"))).toBe(true);
    expect(COMPOSER.test(maskComments('new mod.InMemoryCryptoProvider();\n'))).toBe(true);
  });
});

// ── The helper, in a development posture with an empty key home ────────────

const KEY_ENV = [
  'NODE_ENV', 'OS_SECRET_KEY', 'OS_DEV_CRYPTO_KEY', 'OBJECTSTACK_DEV_CRYPTO_KEY',
  'OS_HOME', 'OBJECTSTACK_HOME', 'OS_CRYPTO_AUTOKEY',
] as const;
const KEY_HEX = '606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f';
const savedEnv: Record<string, string | undefined> = {};
let home: string;

beforeEach(() => {
  for (const k of KEY_ENV) savedEnv[k] = process.env[k];
  for (const k of KEY_ENV) delete process.env[k];
  process.env.NODE_ENV = 'development';
  home = mkdtempSync(join(tmpdir(), 'os-21471-key-home-'));
  process.env.OS_HOME = home;
});

afterEach(() => {
  for (const k of KEY_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(home, { recursive: true, force: true });
});

/**
 * The provider the plugin was handed, read off its options: the field the
 * plugin reads when it binds the engine (`this.opts.cryptoProvider ?? …`).
 * Private to TypeScript, read on purpose — it IS the composition under test.
 */
function providerOf(plugin: unknown): { encrypt: (...a: unknown[]) => Promise<unknown> } & Record<string, unknown> {
  return (plugin as { opts: { cryptoProvider: never } }).opts.cryptoProvider;
}

describe('[#21471] the one-shot helper never mints a data key', () => {
  it('the control: the default provider mints a key file in this posture and this home', () => {
    const minted = new LocalCryptoProvider();
    expect(minted.keySource).toBe('generated-file');
    expect(readdirSync(home)).toEqual(['dev-crypto-key']);
  });

  it('no key: the helper resolves none, mints none, and hands the service a provider that refuses', async () => {
    const key = await resolveExistingDataKey();
    expect(key.provider).toBeNull();
    expect(typeof key.unavailable).toBe('string');
    expect(key.unavailable).not.toBe('');

    const plugin = await oneShotSettingsPlugin();
    const provider = providerOf(plugin);
    expect(provider).toBeDefined();
    expect(provider).not.toBeInstanceOf(LocalCryptoProvider);
    // The refusal carries why there is no key, so an operator reading it is told.
    await expect(provider.encrypt('x', { scope: 'settings', namespace: 'n', key: 'k' }))
      .rejects.toThrow(key.unavailable!);
    expect(readdirSync(home)).toEqual([]);

    // Even with the auto-key opt-in present in the environment.
    process.env.OS_CRYPTO_AUTOKEY = '1';
    expect((await resolveExistingDataKey()).provider).toBeNull();
    await oneShotSettingsPlugin();
    expect(readdirSync(home)).toEqual([]);
  });

  it('a key file that exists is read, never rewritten, and is the one the service is handed', async () => {
    const file = join(home, 'dev-crypto-key');
    writeFileSync(file, Buffer.from(KEY_HEX, 'hex').toString('base64'), { mode: 0o600 });
    const before = readFileSync(file, 'utf8');

    const key = await resolveExistingDataKey();
    expect(key.provider?.keySource).toBe('file');
    const plugin = await oneShotSettingsPlugin(key);
    expect(providerOf(plugin)).toBe(key.provider);
    expect(readdirSync(home)).toEqual(['dev-crypto-key']);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('an env key is used, and the key home is never touched', async () => {
    process.env.OS_SECRET_KEY = KEY_HEX;
    const key = await resolveExistingDataKey();
    expect(key.provider?.keySource).toBe('env:OS_SECRET_KEY');
    expect(existsSync(join(home, 'dev-crypto-key'))).toBe(false);
  });

  it('a key that is set but unusable is an answer, not a throw, and nothing is minted in its place', async () => {
    process.env.OS_DEV_CRYPTO_KEY = 'not-a-key';
    const key = await resolveExistingDataKey();
    expect(key.provider).toBeNull();
    expect(key.unavailable).toContain('OS_DEV_CRYPTO_KEY');
    expect(readdirSync(home)).toEqual([]);
  });

  it('the refusing provider refuses every member of the contract, naming the reason', async () => {
    const provider = refusingCryptoProvider('the reason');
    const ctx = { scope: 'settings', namespace: 'n', key: 'k' } as const;
    const handle = { id: 'sec_x', kmsKeyId: 'local:v1', alg: 'aes-256-gcm', version: 1, ciphertext: 'c' };
    await expect(provider.encrypt('x', ctx)).rejects.toThrow(/the reason/);
    await expect(provider.decrypt(handle, ctx)).rejects.toThrow(/the reason/);
    await expect(provider.rotateKey(handle, ctx)).rejects.toThrow(/the reason/);
    expect(() => provider.digest('x')).toThrow(/the reason/);
    await expect(provider.keyedDigest('x')).rejects.toThrow(/the reason/);
  });
});

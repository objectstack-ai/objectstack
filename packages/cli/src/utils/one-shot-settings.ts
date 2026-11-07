// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ICryptoProvider } from '@objectstack/spec/contracts';
import type { HostCryptoProvider } from '../commands/serve.js';
import { resolveStartHome } from './start-home.js';

/**
 * [#21471] The settings service a ONE-SHOT command composes, and the one place
 * in this package that composes it.
 *
 * ## Why a one-shot command never takes the settings service's default
 *
 * `SettingsServicePlugin` handed no `cryptoProvider` builds its own
 * `LocalCryptoProvider` when it binds the engine, and that provider resolves
 * its data key the way a SERVER does: in a development posture with no env key
 * and no key file, it mints a key file in the key home so the next restart
 * reuses it. That is right for `os serve`, the host it was written for. For a
 * command that runs once and exits it is an undeclared side effect on key
 * custody, and the worst kind:
 *
 *  - a minted key can open nothing that is stored, so the run gains nothing;
 *  - the key file outlives the run, so the next process in a development
 *    posture on that host adopts it and seals under it;
 *  - commands whose contract is "writes nothing" (`os secret orphans`,
 *    `os storage orphans`, every dry run) leave key material behind.
 *
 * ## What it composes instead
 *
 * The provider over a data key that ALREADY exists — `OS_SECRET_KEY`,
 * `OS_DEV_CRYPTO_KEY`, or the persisted key file, resolved the way every host
 * resolves it — constructed in the strict posture with the auto-key opt-in
 * withheld, whatever `NODE_ENV` says, so it never mints. With no key it hands
 * the service a provider that refuses every call, naming why. A stored value
 * then reads as the settings service reads any value it cannot open (`null`,
 * with a warning), which is what a minted key would have produced too.
 *
 * `os secret rewrap` composes the crypto FIRST ({@link oneShotCrypto}) and
 * hands the same provider to the service and to its own re-wrap, so no
 * provider in that run mints a key. Every other caller lets
 * {@link oneShotSettingsPlugins} compose it.
 *
 * ## Which provider: the one `os serve` seals with (#31007)
 *
 * `os serve` seals every `sys_secret` row with the provider a plugin of its
 * stack registers as the kernel service `crypto-provider`, else its own local
 * one (`createHostCryptoProvider`, `commands/serve.ts`). A one-shot run opens
 * and re-seals those same rows, so it chooses through that SAME function, over
 * the plugins that DECLARE the provider in the host config's `plugins` —
 * read by `serve`'s own rules (`stackBootPlugins`, `materializeStackPlugin`,
 * `Serve.importConfigPlugin`, `cryptoProviderPlugins`):
 *
 *  - one declaring plugin: it is composed into this run's boot, its `init()`
 *    registers the provider, and the run seals and opens with it. If it does
 *    not boot, or boots and registers none, the run refuses, naming it — ⛔ it
 *    never falls back to the local key, under which nothing that deployment
 *    sealed opens and under which a re-seal would be a downgrade;
 *  - two: refused, both named (`refuseTwoCryptoProviderPlugins`, `serve`'s);
 *  - none: the local provider over the key that already exists, as above;
 *  - a host config that does not load, or a `plugins` entry that does not
 *    materialize: refused, because whether a provider is declared cannot be
 *    read, and guessing "none" is the fallback the line above forbids.
 *
 * Only `plugins` is read, never `devPlugins`: the list `os serve` boots
 * without `--dev`, and `os start`.
 *
 * ⛔ Nothing else in `src/` names `SettingsServicePlugin` or
 * `LocalCryptoProvider`, except `commands/serve.ts`, the long-lived host:
 * `one-shot-settings.pin.test.ts` reads every module and fails by file name.
 * The behaviour is pinned across the whole `bootSchemaStack` family in
 * `schema-migrate.one-shot-family.integration.test.ts`: a development posture
 * with an empty key home leaves the key home empty, and the default
 * composition minting there is the control.
 */

/** A data key that existed before this run, or the reason there is none. */
export interface ExistingDataKey {
  /** The provider over that key, or `null` when no key exists. */
  provider: (ICryptoProvider & { keySource: string }) | null;
  /** Why no key was resolved, or `null` when one was. */
  unavailable: string | null;
}

/**
 * Resolve the data key this host already has, never minting one. A key that
 * is missing, or set but unusable, is an answer here, not a throw.
 *
 * ⚠ It writes the key-file channels (`KEY_FILE_CHANNEL_ENV`,
 * `KEY_FILE_CANDIDATE_CHANNEL_ENV`) on `opts.env`, which defaults to the real
 * `process.env`: it sets or deletes both, so this process and every child it
 * spawns afterwards read the file this call resolved. Pass an env map of your
 * own to keep `process.env` untouched (the tests do).
 */
export async function resolveExistingDataKey(
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ExistingDataKey> {
  // Loaded at the point of use, never at module load: oclif imports every
  // command module on every invocation while building its table.
  const {
    LocalCryptoProvider,
    deferredLocalCryptoProvider,
    resolvePersistedKeyFile,
    KEY_FILE_CHANNEL_ENV,
    KEY_FILE_CANDIDATE_CHANNEL_ENV,
  } = await import('@objectstack/service-settings');
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  // [#30042] The SAME file a `serve` child of `os dev` / `os start` reads for
  // this project, chosen by the same resolution: the canonical file, the
  // project's legacy file when it alone holds a key, and — when the two hold
  // different keys — whichever opens more of the newest stored secrets, ruled
  // by the settings service in this run's own boot (`settleKeyFileChannel`).
  // This process opens the database itself, so it is its own parent: it sets
  // both channels on its own env, exactly as `applyCryptoKeyFileChannel` sets
  // them on a child's.
  const startHome = resolveStartHome(undefined, {
    hasProjectConfig: existsSync(path.resolve(cwd, 'objectstack.config.ts')),
    cwd,
    env,
  });
  const answer = resolvePersistedKeyFile({ env, legacyKeyFile: path.join(startHome, 'dev-crypto-key') });
  // The canonical file is the one the provider reads with no channel at all.
  delete env[KEY_FILE_CANDIDATE_CHANNEL_ENV];
  if (answer && answer.kind !== 'canonical') env[KEY_FILE_CHANNEL_ENV] = answer.path;
  else delete env[KEY_FILE_CHANNEL_ENV];
  const strict = () => ({ mode: 'production' as const, env: { ...env, OS_CRYPTO_AUTOKEY: undefined } });
  try {
    // Built now, over the file this answer names: it proves a key exists
    // before the boot, and is the provider itself whenever one file is named.
    const provider = new LocalCryptoProvider(strict());
    if (answer?.kind !== 'both-differ' || !answer.legacy) return { provider, unavailable: null };
    // Two candidate keys: the provider this run uses is built at its first
    // use, after the boot's settings service ruled between them (every reader
    // of a stored secret in a one-shot runs at `kernel:ready` or after it).
    env[KEY_FILE_CANDIDATE_CHANNEL_ENV] = answer.legacy;
    return { provider: deferredLocalCryptoProvider(strict), unavailable: null };
  } catch (error) {
    return { provider: null, unavailable: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The provider handed to the settings service when no data key exists: every
 * call refuses with the reason. Composed so the service never builds a default
 * provider of its own.
 */
export function refusingCryptoProvider(reason: string): ICryptoProvider {
  const refuse = (): never => {
    throw new Error(`No data key is available to this run, so nothing may be sealed or opened: ${reason}`);
  };
  return {
    encrypt: async () => refuse(),
    decrypt: async () => refuse(),
    rotateKey: async () => refuse(),
    digest: () => refuse(),
    keyedDigest: async () => refuse(),
  };
}

/**
 * What a one-shot boot composes for its secrets, and the provider it seals and
 * opens them with.
 */
export interface OneShotCrypto {
  /**
   * Composed into the boot, in this order: the plugin that declares the crypto
   * provider (when the host config has one), the host's crypto-provider seam
   * (`createHostCryptoProvider`, `os serve`'s), and the settings service over
   * that seam's provider. ⛔ Never the settings service's default provider.
   */
  plugins: unknown[];
  /**
   * The provider the boot chose, at `kernel:ready` — `os serve`'s one host
   * provider. Read it once the boot is up: before that it refuses.
   */
  provider: HostCryptoProvider;
  /** The plugin that declares the crypto provider, or `null` when none does. */
  declaredBy: string | null;
  /** The local key, resolved when no plugin declares a provider; else `null`. */
  key: ExistingDataKey | null;
}

/**
 * Compose the crypto for a one-shot boot: the provider `os serve` would seal
 * with on this host, chosen by `serve`'s own function. Throws a
 * `HostCryptoProviderRefusal` — before anything boots — when two plugins
 * declare the provider, or when the host config or one of its `plugins`
 * cannot be read. See the module header.
 */
export async function oneShotCrypto(
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<OneShotCrypto> {
  const cwd = opts.cwd ?? process.cwd();
  const { createHostCryptoProvider, HostCryptoProviderRefusal } = await import('../commands/serve.js');
  const declared = await readDeclaredCryptoProvider(cwd);
  const { SettingsServicePlugin } = await import('@objectstack/service-settings');
  const settingsOver = (provider: ICryptoProvider) => new SettingsServicePlugin({ registerRoutes: false, cryptoProvider: provider });

  if (declared) {
    // The local fallback of a deployment that declares its provider is a
    // refusal: the declaring plugin booted and registered nothing.
    const host = createHostCryptoProvider(() => {
      throw new HostCryptoProviderRefusal(
        `Refusing to seal or open a secret: the plugin '${declared.name}' declares the crypto provider `
        + `('crypto-provider') in the host config, and registered none in this run. Every secret this `
        + 'deployment holds is sealed by that provider, so this run uses no other key. Nothing was opened or written.',
      );
    });
    return {
      plugins: [refusingNamedOnFailure(declared.plugin, declared.name, HostCryptoProviderRefusal), host.plugin, settingsOver(host.provider)],
      provider: host.provider,
      declaredBy: declared.name,
      key: null,
    };
  }

  const key = await resolveExistingDataKey(opts);
  const host = createHostCryptoProvider(
    () => key.provider ?? refusingCryptoProvider(key.unavailable ?? 'no data key'),
  );
  return { plugins: [host.plugin, settingsOver(host.provider)], provider: host.provider, declaredBy: null, key };
}

/**
 * The settings service for a one-shot boot, with the crypto it seals and opens
 * through: no routes, `os serve`'s provider choice ({@link oneShotCrypto},
 * composed here when the caller has none of its own). Spread into the boot's
 * plugin list. ⛔ Never the service's default provider.
 */
export async function oneShotSettingsPlugins(crypto?: OneShotCrypto): Promise<unknown[]> {
  return (crypto ?? await oneShotCrypto()).plugins;
}

/**
 * The one plugin of the host config that declares the crypto provider, or
 * `null` when none does. Two are refused, both named. Read by `serve`'s rules
 * for the same list (module header); ⛔ never guessed: an unreadable config or
 * entry is refused, not read as "none".
 */
async function readDeclaredCryptoProvider(cwd: string): Promise<{ name: string; plugin: object } | null> {
  const { findHostConfig } = await import('./schema-migration-plugins.js');
  const configPath = findHostConfig(cwd);
  if (!configPath) return null;
  const { default: Serve, cryptoProviderPlugins, refuseTwoCryptoProviderPlugins, HostCryptoProviderRefusal } =
    await import('../commands/serve.js');
  const refuse = (what: string, error: unknown): never => {
    throw new HostCryptoProviderRefusal(
      `Refusing to seal or open a secret: ${what} could not be read (${error instanceof Error ? error.message : String(error)}), `
      + `so this run cannot tell whether a plugin provides the crypto provider ('crypto-provider') that \`os serve\` `
      + 'seals with, and it uses no key it cannot confirm. Nothing was opened or written.',
    );
  };
  const configName = path.basename(configPath);
  let config: unknown;
  try {
    const { loadConfig } = await import('./config.js');
    ({ config } = await loadConfig(configPath));
  } catch (error) {
    return refuse(configName, error);
  }
  const { stackBootPlugins } = await import('./stack-collections.js');
  const { materializeStackPlugin } = await import('@objectstack/core');
  const hostRoot = path.dirname(configPath);
  const composed: unknown[] = [];
  for (const [index, entry] of stackBootPlugins(config, false).entries()) {
    if (entry === undefined || entry === null || entry === false) continue;
    try {
      composed.push(await materializeStackPlugin(entry, {
        importSpecifier: async (specifier) => Serve.importConfigPlugin(specifier, hostRoot),
        // A bundle is app metadata `serve` wraps into an AppPlugin, which
        // provides no crypto: read as it is, never wrapped or booted here.
        wrapBundle: async (bundle) => bundle,
      }));
    } catch (error) {
      return refuse(`${configName} plugins[${index}]${typeof entry === 'string' ? ` ('${entry}')` : ''}`, error);
    }
  }
  refuseTwoCryptoProviderPlugins(composed);
  return cryptoProviderPlugins(composed)[0] ?? null;
}

/**
 * `plugin`, with an `init()` that refuses naming it when it throws: the
 * one-shot run boots the deployment's crypto provider plugin, and a failure
 * there must say whose provider could not boot. Every other member is
 * forwarded, `constructor` unbound so a class-name presence test still reads
 * the plugin's own class.
 */
function refusingNamedOnFailure<T extends object>(
  plugin: T,
  name: string,
  Refusal: new (message: string) => Error,
): T {
  return new Proxy(plugin, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (prop === 'init' && typeof value === 'function') {
        return async (...args: unknown[]): Promise<unknown> => {
          try {
            return await Reflect.apply(value as (...a: unknown[]) => unknown, target, args);
          } catch (error) {
            throw new Refusal(
              `Refusing to seal or open a secret: the plugin '${name}', which declares the crypto provider `
              + `('crypto-provider') in the host config, could not boot in this run `
              + `(${error instanceof Error ? error.message : String(error)}). Every secret this deployment holds is `
              + 'sealed by that provider, so this run uses no other key. Nothing was opened or written.',
            );
          }
        };
      }
      if (typeof value === 'function' && prop !== 'constructor') {
        return (value as (...a: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  }) as T;
}

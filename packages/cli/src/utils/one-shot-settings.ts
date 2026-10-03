// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ICryptoProvider } from '@objectstack/spec/contracts';

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
 * `os secret rewrap` resolves the key FIRST and hands the same instance to the
 * service and to its own re-wrap, so no provider in that run mints a key.
 * Every other caller lets {@link oneShotSettingsPlugin} resolve it.
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
 */
export async function resolveExistingDataKey(): Promise<ExistingDataKey> {
  // Loaded at the point of use, never at module load: oclif imports every
  // command module on every invocation while building its table.
  const { LocalCryptoProvider } = await import('@objectstack/service-settings');
  try {
    const provider = new LocalCryptoProvider({
      mode: 'production',
      env: { ...process.env, OS_CRYPTO_AUTOKEY: undefined },
    });
    return { provider, unavailable: null };
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
 * The settings service for a one-shot boot: no routes, and the provider over
 * `key` (resolved here when the caller has none of its own), or one that
 * refuses every call. ⛔ Never the service's default provider.
 */
export async function oneShotSettingsPlugin(key?: ExistingDataKey): Promise<unknown> {
  const resolved = key ?? await resolveExistingDataKey();
  const { SettingsServicePlugin } = await import('@objectstack/service-settings');
  return new SettingsServicePlugin({
    registerRoutes: false,
    cryptoProvider: resolved.provider ?? refusingCryptoProvider(resolved.unavailable ?? 'no data key'),
  });
}

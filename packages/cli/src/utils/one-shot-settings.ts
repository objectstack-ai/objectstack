// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ICryptoProvider } from '@objectstack/spec/contracts';
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

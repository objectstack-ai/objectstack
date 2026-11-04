// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'path';
import { resolveStartHome } from './start-home.js';

/**
 * The ONE data-key file `os dev` and `os start` hand their `serve` child
 * (#29934), on the CLI's internal channel `OS_INTERNAL_CRYPTO_KEY_FILE`.
 *
 * ## The defect
 *
 * Both commands open the same project database (`<project>/.objectstack/data/
 * objectstack.db`), but each child resolved its persisted data key from its
 * own `OS_HOME`: `os dev` leaves `OS_HOME` alone, so its key lived at
 * `$HOME/.objectstack/dev-crypto-key`; `os start` sets `OS_HOME` to its home
 * (`<project>/.objectstack` in project mode), so it minted a second key there.
 * A secret saved under `npm run dev` then read back as unset under `os start`.
 *
 * ## The answer
 *
 * One resolution for both commands: the settings package's
 * `resolvePersistedKeyFile` over the env the child sees, with `OS_HOME` as dev
 * reads it (`--home` counts as `OS_HOME`, being start's spelling of it). The
 * file `os start` used before — `<start home>/dev-crypto-key` — is the legacy
 * file: read when it alone holds a key, and never chosen silently. When it and
 * the canonical file hold different keys, the parent cannot rule between them:
 * it names the canonical file on the channel and the legacy file on the
 * second channel `OS_INTERNAL_CRYPTO_KEY_FILE_CANDIDATE`, and the child, which
 * opens the database, takes the file whose key opens a stored secret (or
 * refuses in production when neither does; `settleKeyFileChannel`).
 *
 * An env key (`OS_SECRET_KEY`, a usable `OS_DEV_CRYPTO_KEY`) still answers
 * first, unchanged: no file is named and the channel is removed. The parent
 * OWNS the variable in the child env, so an inherited copy never speaks for a
 * file this run did not choose — the same rule as `OS_INTERNAL_ARTIFACT_PATH`
 * and `OS_INTERNAL_AUTH_SECRET_FILE`, and like them it is not an operator
 * setting (not listed in `environment-variables.mdx`).
 *
 * The settings package loads at the point of use: oclif imports every command
 * module on every invocation while building its table.
 */
export async function applyCryptoKeyFileChannel(
  childEnv: NodeJS.ProcessEnv,
  opts: {
    /** The env the child reads its key from, `OS_HOME` as the child sees it. */
    env: NodeJS.ProcessEnv;
    cwd: string;
    hasProjectConfig: boolean;
    /** `os start --home`; `os dev` has none. */
    homeFlag?: string;
  },
): Promise<string | undefined> {
  const { resolvePersistedKeyFile, KEY_FILE_CHANNEL_ENV, KEY_FILE_CANDIDATE_CHANNEL_ENV } = await import(
    '@objectstack/service-settings'
  );
  const startHome = resolveStartHome(opts.homeFlag, {
    hasProjectConfig: opts.hasProjectConfig,
    cwd: opts.cwd,
    env: opts.env,
  });
  const keyEnv = opts.homeFlag ? { ...opts.env, OS_HOME: startHome } : opts.env;
  const answer = resolvePersistedKeyFile({
    env: keyEnv,
    legacyKeyFile: path.join(startHome, 'dev-crypto-key'),
  });
  // Both channels are the parent's: an inherited copy never speaks for a file
  // this run did not choose.
  delete childEnv[KEY_FILE_CANDIDATE_CHANNEL_ENV];
  if (!answer) {
    delete childEnv[KEY_FILE_CHANNEL_ENV];
    return undefined;
  }
  childEnv[KEY_FILE_CHANNEL_ENV] = answer.path;
  if (answer.kind === 'legacy-only') {
    return (
      `Data key: reading ${answer.legacy}, the key file an earlier \`os start\` kept for this project. ` +
      `\`os dev\` and \`os start\` now share ${answer.canonical}; move the file there to converge.`
    );
  }
  if (answer.kind === 'both-differ' && answer.legacy) {
    // Only the child opens the database, so only the child can tell which key
    // opens its stored secrets: it rules between the two files at boot
    // (`settleKeyFileChannel` in the settings service), names the one it
    // took, and refuses in production when neither opens them.
    childEnv[KEY_FILE_CANDIDATE_CHANNEL_ENV] = answer.legacy;
    return (
      `Data key: two different key files exist, ${answer.canonical} and ${answer.legacy}. ` +
      `The server uses the one that opens this project's stored secrets, and says which.`
    );
  }
  return undefined;
}

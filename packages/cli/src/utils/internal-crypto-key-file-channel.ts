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
 * file: read when it alone holds a key, named in a warning when it and the
 * canonical file both hold different keys, never chosen silently.
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
  const { resolvePersistedKeyFile, KEY_FILE_CHANNEL_ENV } = await import('@objectstack/service-settings');
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
  if (answer.kind === 'both-differ') {
    return (
      `Data key: two different key files exist, ${answer.canonical} (used) and ${answer.legacy} (NOT used). ` +
      `Secrets saved under the unused key will not decrypt. If this project's secrets were saved under ` +
      `\`os start\`, keep a copy of both files and move ${answer.legacy} over ${answer.canonical}.`
    );
  }
  return undefined;
}

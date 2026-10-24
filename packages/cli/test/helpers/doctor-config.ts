// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The oclif `Config` the in-process `os doctor` suites hand `Doctor.run()`.
 *
 * `Doctor.run(argv, { root })` makes oclif load a Config from the package root,
 * and this package ships no `oclif.manifest.json`, so that load builds the
 * command manifest by importing every compiled command under `dist/commands`:
 * 6.6 s of each file's first test, measured locally (#23181). `os doctor`
 * reads none of it — `doctor.ts` never touches `this.config` — so this Config
 * is the package's own `package.json` with only `oclif.commands` dropped. The
 * hooks (the `preparse` separator strip) and everything else still load from
 * the same manifest, and it loads in tens of milliseconds.
 *
 * ⛔ Not for a suite that asks the Config for a command (`findCommand`,
 * `config.commands`, `runCommand`): this one has none.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@oclif/core';

/** `packages/cli` — the root a `Doctor.run()` loads its Config from. */
const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

let loaded: Promise<Config> | undefined;

/** One Config per test file, loaded on first use. */
export function doctorConfig(): Promise<Config> {
  loaded ??= (async () => {
    const pjson = JSON.parse(readFileSync(resolve(CLI_ROOT, 'package.json'), 'utf8'));
    return Config.load({ root: CLI_ROOT, pjson: { ...pjson, oclif: { ...pjson.oclif, commands: undefined } } });
  })();
  return loaded;
}

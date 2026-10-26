// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The vitest `globalSetup` that writes `packages/cli/oclif.manifest.json` once
 * per run, from source, and removes it at teardown. Test infrastructure only:
 * the file is gitignored and `files[]` (`dist`, `README.md`, `CHANGELOG.md`)
 * never names it, so nothing published changes.
 *
 * ## Why (#23181, seat ruling A on report 6418998910)
 *
 * This package ships no oclif manifest, so every CLI process builds its command
 * table by importing all 72 command modules. Through `tsx bin/run-dev.js` that
 * is a floor of 8.2-8.5 s per spawn, `--version` included, and the files that
 * spawn the CLI held 89.4% of this package's file wall. With a manifest beside
 * `package.json` oclif reads the table from it and imports only the command it
 * runs: the same spawn takes 2.0-2.3 s.
 *
 * ## What is written, and why it is transparent
 *
 * The manifest is the object oclif's own root plugin builds in memory when no
 * manifest exists — `new Plugin({ isRoot: true, root })`, loaded in a `tsx`
 * child under `NODE_ENV=development`, which is what `bin/run-dev.js` runs — with
 * two keys removed from every command: `isESM` and `relativePath`.
 *
 * ⛔ Those two keys are not optional to remove. When a cached command carries
 * both, `Plugin.findCommand` imports `root + relativePath` VERBATIM
 * (`cachedCommandCanBeUsed` in @oclif/core 5.1.2), and a manifest generated from
 * source records `src/commands/<id>.ts`. The built entry (`bin/run.js`, which
 * the published-entry suites spawn with `NODE_ENV` unset) would then run the
 * SOURCE, and those suites would test something other than the build. Without
 * the two keys oclif falls back to the path it takes with no manifest at all —
 * the commands directory `tsPath` resolves, `src/` under `run-dev.js` and
 * `dist/` under `run.js` — so the manifest supplies the command TABLE and
 * nothing about where a command's code comes from.
 *
 * What still differs from a run without the file: `Config.load()` no longer
 * imports every command module, so a module that fails to load is reported when
 * it is run rather than as a load-time warning on every spawn. The suites that
 * pin that load-time behaviour are `*.e2e.test.ts` files, and the e2e tier runs
 * only in the nightly population, which `vitest.config.ts` leaves without this
 * setup. A command module that fails to load here fails the GENERATION instead
 * (`errorOnManifestCreate`), naming the module, before any test runs.
 *
 * ## Ownership, nesting and cleanup
 *
 * - Written to a temporary sibling and renamed over the target, so a spawn
 *   reads either a whole manifest or none (oclif then builds its table as
 *   before). Every run regenerates, so a manifest left by a killed run is never
 *   what a later integration run uses.
 * - `writtenBy.pid` records the vitest process that owns the file. Teardown, and
 *   an `exit` listener for a run that ends without teardown, remove it only
 *   while that pid is still this process's: two runs on one checkout each
 *   remove their own file, and the run that is left continues without a
 *   manifest, at the old floor and with the same output.
 * - A vitest started INSIDE a run (`test/vitest-tiers-partition.test.ts` spawns
 *   `vitest list`) inherits {@link OWNER_ENV} through `childEnv()` and does
 *   nothing, so it neither pays a second generation nor removes the file under
 *   the run that wrote it.
 * - A `unit`-only run generates nothing (no unit file spawns the CLI) and only
 *   removes a manifest whose writer is no longer alive, so an in-process
 *   `Config.load()` there never trusts a file a killed run left behind.
 */

import { execFile } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TestProject } from 'vitest/node';
import { childEnv, TSX } from './serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** `packages/cli` — the root oclif reads `oclif.manifest.json` from. */
const CLI_ROOT = resolve(HERE, '../..');

export const MANIFEST = resolve(CLI_ROOT, 'oclif.manifest.json');

/** Set in the owning run's process, and so in every worker and child below it. */
export const OWNER_ENV = 'OS_TEST_OCLIF_MANIFEST_OWNER';

/** The argv flag that makes this module the generator, inside the `tsx` child. */
const WRITE_FLAG = '--write-oclif-manifest';

const THIS_FILE = fileURLToPath(import.meta.url);

/** The pid recorded in the manifest at `path`, or `undefined` for none or not ours. */
function writerOf(path: string): number | undefined {
  try {
    const pid = JSON.parse(readFileSync(path, 'utf8'))?.writtenBy?.pid;
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function removeIfOurs(): void {
  if (writerOf(MANIFEST) === process.pid) rmSync(MANIFEST, { force: true });
}

/** Runs in the `tsx` child: build the table the way an unmanifested run does. */
async function writeManifest(out: string, ownerPid: number): Promise<void> {
  const { Plugin } = await import('@oclif/core');
  const plugin = new Plugin({ isRoot: true, root: CLI_ROOT, ignoreManifest: true, errorOnManifestCreate: true });
  await plugin.load();
  const commands = Object.fromEntries(
    Object.entries(plugin.manifest.commands).map(([id, { isESM: _isESM, relativePath: _relativePath, ...cached }]) => [
      id,
      cached,
    ]),
  );
  writeFileSync(out, JSON.stringify({ ...plugin.manifest, commands, writtenBy: { pid: ownerPid, by: 'packages/cli/test/helpers/oclif-manifest.global-setup.ts' } }));
}

export default async function setup(project: TestProject): Promise<(() => void) | void> {
  if (process.env[OWNER_ENV]) return;

  if (project.name !== 'integration') {
    const writer = writerOf(MANIFEST);
    if (writer !== undefined && !isAlive(writer)) rmSync(MANIFEST, { force: true });
    return;
  }

  const tmp = `${MANIFEST}.${process.pid}.tmp`;
  try {
    await promisify(execFile)(TSX, [THIS_FILE, WRITE_FLAG, tmp, String(process.pid)], {
      cwd: CLI_ROOT,
      env: childEnv({ NODE_ENV: 'development' }),
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    rmSync(tmp, { force: true });
    const { stderr } = error as { stderr?: string };
    throw new Error(`could not write ${MANIFEST} from source:\n${stderr || String(error)}`);
  }
  renameSync(tmp, MANIFEST);
  process.env[OWNER_ENV] = String(process.pid);
  process.once('exit', removeIfOurs);
  return () => {
    process.off('exit', removeIfOurs);
    removeIfOurs();
  };
}

if (process.argv[1] === THIS_FILE && process.argv[2] === WRITE_FLAG) {
  await writeManifest(process.argv[3], Number(process.argv[4]));
}

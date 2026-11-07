// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack-scenarios` — the published command line (`npx @objectstack/scenarios run …`).
 *
 * A thin dispatcher over the runner's own CLI (`runner/cli.ts`): `run` hands
 * every argument after it to the same `main` that
 * `pnpm --filter @objectstack/scenarios run-scenarios` runs, so the flags, the
 * defaults and the refusals are that CLI's (no API-billed login, the published
 * packages by default). Not an `os` subcommand, and it carries no scoring of
 * a customer's own app: the cards it runs are the open library the package
 * ships (`runner/library.ts`), or a `--cards` directory loaded as the overlay.
 *
 * `bin/objectstack-scenarios.js` imports the BUILT form of this file
 * (`dist/bin.js`), so npm runs JavaScript, never a `.ts` source.
 *
 * The runner is imported only for `run`, and the build keeps it out of this
 * file (`tsup.config.ts` turns the import into one of the built `dist/cli.js`):
 * its graph (the scorer's objectql and plugin-sharing among it) takes about a
 * second warm and several cold, which `help` and `version` must not pay.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const USAGE = `Usage: objectstack-scenarios <command> [flags]

Commands:
  run [flags]   run the scenario cards end to end and write one run record per card
                (the flags of run-scenarios: --only, --modes, --driver, --cards, --out, …;
                see the package README, "Running from npm")
  help          print this text
  version       print the package version

Runs on your own Claude Code login: it refuses to start when an API key is configured.`;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const consoleIo: CliIo = { out: (l) => console.log(l), err: (l) => console.error(l) };

function packageVersion(): string {
  // `src/bin.ts` and `dist/bin.js` both sit one directory below the package root.
  const manifest = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

/** Run one command line; answers the process exit code. */
export async function runCli(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'run') return (await import('./runner/cli.js')).main(rest);
  if (command === 'help' || command === '--help' || command === '-h') {
    io.out(USAGE);
    return 0;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    io.out(packageVersion());
    return 0;
  }
  io.err(command === undefined ? 'objectstack-scenarios: name a command' : `objectstack-scenarios: unknown command \`${command}\``);
  io.err(USAGE);
  return 2;
}

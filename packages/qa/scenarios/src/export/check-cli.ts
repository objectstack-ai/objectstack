// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `export-gallery --check DIR` — the command line of the gallery check
 * (`check.ts`). Two doors reach it with the same arguments:
 *
 *   pnpm --filter @objectstack/scenarios export-gallery --check DIR   (a checkout; `cli.ts` hands it here)
 *   npx @objectstack/scenarios export-gallery --check DIR             (the published bin, `bin.ts`)
 *
 * It prints one line per finding (`CODE PATH: MESSAGE`) and a closing count,
 * and answers 1 when there is any finding, 0 on a clean tree, 2 on a usage
 * error. The published versions of `@objectstack/cli` come from npm unless a
 * test hands a list.
 *
 * Kept apart from `cli.ts` on purpose: that file loads the runner and the
 * browser for the export, which a check pays nothing for.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkGallery, npmPublishedVersions, renderFinding } from './check.js';

export const CHECK_USAGE = 'Usage: export-gallery --check DIR   check a gallery tree (index.json, apps/) before it is merged';

export interface CheckCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface CheckCliDeps {
  io?: CheckCliIo;
  /** Every published `@objectstack/cli` version; default `npm view`. */
  publishedVersions?: () => readonly string[];
}

const consoleIo: CheckCliIo = { out: (l) => console.log(l), err: (l) => console.error(l) };

/** True when this argument list asks for the check (`--check` anywhere in it). */
export const asksForCheck = (argv: readonly string[]): boolean => argv.includes('--check');

export function mainCheck(argv: readonly string[], deps: CheckCliDeps = {}): number {
  const io = deps.io ?? consoleIo;
  if (argv.length !== 2 || argv[0] !== '--check') {
    io.err(argv[0] === '--check' && argv.length < 2 ? '--check needs a value: the gallery directory' : '--check DIR takes no other flag: the export itself runs from a checkout (pnpm --filter @objectstack/scenarios export-gallery)');
    io.err(CHECK_USAGE);
    return 2;
  }
  const dir = resolve(argv[1]!);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    io.err(`--check ${argv[1]} is not a directory`);
    return 2;
  }
  const findings = checkGallery(dir, { publishedVersions: deps.publishedVersions ?? (() => npmPublishedVersions()) });
  for (const f of findings) io.out(renderFinding(f));
  io.out(findings.length === 0 ? `gallery check: clean · ${dir}` : `gallery check: ${findings.length} finding(s) · ${dir}`);
  return findings.length === 0 ? 0 : 1;
}

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui check`'s ignore list matches `glob`'s `ignore` patterns against
 * the path RELATIVE TO `cwd` (objectui#6320). An unanchored ignore pattern
 * (root-level "dist" or "node_modules" only) therefore excludes only a
 * directory of that name AT THE SCAN ROOT — every nested build-output or
 * dependency directory one level or more down (a package's own "dist",
 * an example's own "node_modules", and so on) was still scanned, so a built
 * workspace re-read the author's own schemas a second time, from build
 * output. Measured on this repository: every reported count roughly doubles
 * once packages are built.
 *
 * This file pins two things at once, because widening a pattern is exactly
 * where an exclusion can accidentally stop covering the case it already
 * handled:
 * - a NESTED `dist/` / `node_modules/` is now excluded (the fix);
 * - a ROOT-level `dist/` / `node_modules/` is STILL excluded (the regression
 *   guard for the fix itself).
 *
 * Fixtures live under `os.tmpdir()`, never in the repo tree: `check()` globs
 * every JSON file under the directory it is handed, so a fixture committed
 * inside this workspace would be scanned by every other run of the command as
 * well — including the repo's own `pnpm check` (see `check-schema-marker.test.ts`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { check } from '../commands/check.js';

let cwd: string;
let lines: string[];
let restoreLog: () => void;

/**
 * The CSI sequences chalk may add. The escape byte is built with
 * `String.fromCharCode` rather than spelled into the source, so this file
 * holds no raw control character (objectui AGENTS.md byte discipline).
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function plainLines(): string[] {
  return lines.map((l) => l.replace(ANSI, ''));
}

function unknownTypeWarnings(): string[] {
  return plainLines().filter((l) => l.includes('Unknown schema type'));
}

/** Was a file whose basename is `name` warned about? A file the scan never
 * globbed prints nothing at all, so absence here means "not scanned". */
function warnedAbout(name: string): boolean {
  return unknownTypeWarnings().some((l) => l.includes(name));
}

/**
 * Write a fixture that is unmistakable if — and only if — `check()` globs it:
 * it positively reads as an ObjectUI schema (the structural key `children`),
 * and its `type` is deliberately unregistered, so a scanned copy prints an
 * "Unknown schema type" warning naming its own path. Directories are created
 * as needed, so `relPath` may nest arbitrarily deep.
 */
function writeProbe(relPath: string): void {
  const abs = join(cwd, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify({ type: 'totally-made-up-xyz', children: [] }));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-nested-ignore-'));
  lines = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  // `check()` calls `process.exit(1)` itself; none of these fixtures are
  // malformed JSON, but mock it anyway so a surprise does not tear the
  // Vitest worker down (same convention as check-schema-marker.test.ts).
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  restoreLog = () => {
    console.log = original;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restoreLog();
  rmSync(cwd, { recursive: true, force: true });
});

describe('objectui check — the ignore list is anchored at every depth (objectui#6320)', () => {
  it('does not scan a NESTED dist/ directory', async () => {
    writeProbe('packages/x/dist/nested-dist-file.json');
    // Counter-probe, outside dist/: without it, silence above would be
    // indistinguishable from a scan that read nothing at all.
    writeProbe('packages/x/src/sibling-file.json');
    await check(cwd);
    expect(warnedAbout('nested-dist-file.json')).toBe(false);
    expect(warnedAbout('sibling-file.json')).toBe(true);
  });

  it('does not scan a NESTED node_modules/ directory', async () => {
    writeProbe('packages/y/node_modules/some-dep/nested-node-modules-file.json');
    writeProbe('packages/y/src/sibling-file.json');
    await check(cwd);
    expect(warnedAbout('nested-node-modules-file.json')).toBe(false);
    expect(warnedAbout('sibling-file.json')).toBe(true);
  });

  it('still excludes a ROOT-level dist/ — widening must not stop covering the case it already handled', async () => {
    writeProbe('dist/root-dist-file.json');
    writeProbe('src/sibling-file.json');
    await check(cwd);
    expect(warnedAbout('root-dist-file.json')).toBe(false);
    expect(warnedAbout('sibling-file.json')).toBe(true);
  });

  it('still excludes a ROOT-level node_modules/ — same regression guard', async () => {
    writeProbe('node_modules/some-dep/root-node-modules-file.json');
    writeProbe('src/sibling-file.json');
    await check(cwd);
    expect(warnedAbout('root-node-modules-file.json')).toBe(false);
    expect(warnedAbout('sibling-file.json')).toBe(true);
  });
});

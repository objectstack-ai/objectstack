// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where the runner reads the open library from (`runner/library.ts`), and the
 * published command line's dispatch (`bin.ts`). The packed tarball itself is
 * read in `test/build/packed-tarball.test.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { runCli, USAGE } from '../../src/bin.js';
// `runCli` imports the runner CLI lazily (only `run` pays for its graph); loading it here
// keeps that transform in the file's import phase, not inside a case's 5 s default.
import '../../src/runner/cli.js';
import { locateLibraryRoot, PACKED_LIBRARY_DIR } from '../../src/runner/library.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../..');
const tmp = mkdtempSync(join(tmpdir(), 'scenarios-library-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A project with the package installed at `node_modules/@objectstack/scenarios`; `library` adds the packed copy. */
function installedPackage(project: string, library: boolean): string {
  const pkg = join(project, 'node_modules/@objectstack/scenarios');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@objectstack/scenarios', version: '0.0.0' }));
  if (library) mkdirSync(join(pkg, PACKED_LIBRARY_DIR, 'docs/qa/scenarios'), { recursive: true });
  return pkg;
}

describe('locateLibraryRoot', () => {
  it('reads the checkout from the package sources', () => {
    expect(locateLibraryRoot(join(REPO, 'packages/qa/scenarios/src/runner'))).toEqual({ root: REPO, checkout: true });
  });

  it('reads the packed copy from an installed package', () => {
    const pkg = installedPackage(join(tmp, 'plain'), true);
    expect(locateLibraryRoot(join(pkg, 'dist'))).toEqual({ root: join(pkg, PACKED_LIBRARY_DIR), checkout: false });
  });

  it('never reads another pnpm workspace holding a docs/qa/scenarios as the checkout', () => {
    const project = join(tmp, 'lookalike');
    const pkg = installedPackage(project, true);
    writeFileSync(join(project, 'pnpm-workspace.yaml'), 'packages: []\n');
    mkdirSync(join(project, 'docs/qa/scenarios'), { recursive: true });
    // The package's grandparent's grandparent is `project` itself under npm's flat layout.
    mkdirSync(join(project, 'packages/qa/scenarios'), { recursive: true });
    expect(locateLibraryRoot(join(pkg, 'dist'))).toEqual({ root: join(pkg, PACKED_LIBRARY_DIR), checkout: false });
  });

  it('refuses an installed package that carries no library', () => {
    const pkg = installedPackage(join(tmp, 'bare'), false);
    expect(() => locateLibraryRoot(join(pkg, 'dist'))).toThrow(/carries no card library/);
  });
});

describe('the objectstack-scenarios command line', () => {
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
  };

  it('prints its usage on help, and refuses no command or an unknown one with it', async () => {
    const help = capture();
    expect(await runCli(['help'], help.io)).toBe(0);
    expect(help.out).toEqual([USAGE]);
    for (const argv of [[], ['score']]) {
      const c = capture();
      expect(await runCli(argv, c.io)).toBe(2);
      expect(c.err[1]).toBe(USAGE);
    }
  });

  it('hands every argument after `run` to the runner CLI unchanged', async () => {
    await expect(runCli(['run', '--bogus'], capture().io)).rejects.toThrow('unknown flag `--bogus`');
    await expect(runCli(['run', '--modes', 'nightly'], capture().io)).rejects.toThrow('unknown mode `nightly`');
  });
});

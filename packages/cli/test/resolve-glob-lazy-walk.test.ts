// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#7363) — `os test`'s glob resolver walks LAZILY and prunes.
 *
 * `resolveGlob` documents `**` in its own header, and used to implement it as
 * `fs.readdirSync(baseDir, { recursive: true })`: every path under the base
 * materialised as one array *before any filtering ran*. For a leading `**` the
 * static base degenerates to `.`, so the array was the whole repository —
 * `node_modules` included, and `readdirSync(recursive)` follows symlinked
 * directories, which in a pnpm store makes the path set combinatorial rather
 * than merely large. Measured on this monorepo before the fix: exit 134 after
 * ~7 minutes of GC thrash, before a single suite loaded.
 *
 * Two smaller consequences of the same shape are pinned here too:
 *   - no ignore list, so a suite vendored in `node_modules`/`dist` was a match
 *     the command would happily load and RUN against a live server;
 *   - a second full `statSync` pass over every surviving match.
 *
 * The repository contains no Quality Protocol suites at all (the only
 * `*.test.json` files in the tree are three `tsconfig.test.json`), so these
 * tests build their own fixture — including decoy suites inside `node_modules`,
 * `dist`, `build` and `.git` — rather than expecting to discover real ones. A
 * test that passed by finding nothing would prove nothing.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveGlob } from '../src/commands/test';

const root = mkdtempSync(path.join(tmpdir(), 'os-resolve-glob-'));

/** Every suite file the fixture contains, keyed by its path relative to `root`. */
const SUITE = 'suite.test.json';

function file(rel: string): string {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, '{}', 'utf-8');
  return full;
}

/** Absolute pattern under the fixture root. */
function pattern(rel: string): string {
  return path.join(root, rel);
}

beforeAll(() => {
  // Source suites — what a `**` glob is supposed to find.
  file(`qa/${SUITE}`);
  file(`qa/nested/deep.test.json`);
  file(`packages/a/qa/a.test.json`);

  // Decoys. Each lives in a directory the prune list names, and each is a
  // perfectly valid match for `**/*.test.json`.
  file(`node_modules/vendor/qa/vendored.test.json`);
  file(`packages/a/node_modules/dep/nested.test.json`);
  file(`packages/a/dist/stale.test.json`);
  file(`build/out.test.json`);
  file(`.git/hooked.test.json`);

  // A directory that NAMES like a suite: it matches the pattern but is not a
  // file, and `os test` would `readFileSync` it (EISDIR) if it were returned.
  mkdirSync(path.join(root, 'qa/decoy.test.json'), { recursive: true });

  // A regex metacharacter in a real filename. The old translation escaped only
  // dots, so `+` reached the RegExp as a quantifier.
  file(`meta/a+b.test.json`);

  // A symlinked directory pointing back up the tree. `readdirSync(recursive)`
  // follows these; the lazy walk must not, or this fixture alone is unbounded.
  symlinkSync(path.join(root, 'qa'), path.join(root, 'qa/nested/loop'), 'dir');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fixture-relative, forward-slashed, for readable assertions. */
function rel(paths: string[]): string[] {
  return paths.map((p) => path.relative(root, p).replace(/\\/g, '/')).sort();
}

describe('resolveGlob — lazy walk (#7363)', () => {
  it('a `**` glob finds every source suite and no vendored or generated one', () => {
    expect(rel(resolveGlob(pattern('**/*.test.json')))).toEqual([
      'meta/a+b.test.json',
      'packages/a/qa/a.test.json',
      'qa/nested/deep.test.json',
      'qa/suite.test.json',
    ]);
  });

  it('never reads a pruned directory at all — the prune is a walk decision, not a filter', () => {
    const readdirSync = vi.spyOn(fs, 'readdirSync');
    resolveGlob(pattern('**/*.test.json'));

    const visited = readdirSync.mock.calls.map((call) => String(call[0]));
    expect(visited.length).toBeGreaterThan(0);
    for (const dir of visited) {
      expect(dir.split(path.sep)).not.toContain('node_modules');
      expect(dir.split(path.sep)).not.toContain('dist');
      expect(dir.split(path.sep)).not.toContain('build');
      expect(dir.split(path.sep)).not.toContain('.git');
    }
  });

  it('never asks for a recursive readdir — that call is what exhausted the heap', () => {
    const readdirSync = vi.spyOn(fs, 'readdirSync');
    resolveGlob(pattern('**/*.test.json'));

    expect(readdirSync).toHaveBeenCalled();
    for (const call of readdirSync.mock.calls) {
      expect((call[1] as { recursive?: boolean } | undefined)?.recursive).toBeFalsy();
    }
  });

  it('does not stat the survivors a second time — `Dirent` already answered', () => {
    const statSync = vi.spyOn(fs, 'statSync');
    const matches = resolveGlob(pattern('qa/*.test.json'));

    expect(matches).toHaveLength(1);
    // The one candidate that is not a plain file is the `qa/decoy.test.json`
    // DIRECTORY, and `Dirent` settles that without a syscall.
    expect(statSync).not.toHaveBeenCalled();
  });

  it('does not follow a symlinked directory back up the tree', () => {
    const matches = rel(resolveGlob(pattern('**/*.test.json')));
    expect(matches.some((p) => p.includes('loop'))).toBe(false);
  });

  it('returns files only — a directory named like a suite is not a match', () => {
    expect(rel(resolveGlob(pattern('qa/*.test.json')))).toEqual(['qa/suite.test.json']);
  });

  it('treats every character but `*` literally', () => {
    expect(rel(resolveGlob(pattern('meta/a+b.*.json')))).toEqual(['meta/a+b.test.json']);
  });

  it('sorts, so suites run in the same order on every filesystem', () => {
    const matches = resolveGlob(pattern('**/*.test.json'));
    expect(matches).toEqual([...matches].sort());
  });
});

describe('resolveGlob — behaviour the prune must not take away (#7363)', () => {
  // Each pattern here reaches the pruned name through a LITERAL segment that
  // the walk itself matched — not through the static base, which is peeled off
  // before the walk starts and so never consults the prune list at all.
  it('walks a pruned directory when the pattern spells it out', () => {
    expect(rel(resolveGlob(pattern('packages/*/dist/*.test.json')))).toEqual([
      'packages/a/dist/stale.test.json',
    ]);
    expect(rel(resolveGlob(pattern('packages/*/node_modules/*/*.test.json')))).toEqual([
      'packages/a/node_modules/dep/nested.test.json',
    ]);
    expect(rel(resolveGlob(pattern('**/node_modules/*/qa/*.test.json')))).toEqual([
      'node_modules/vendor/qa/vendored.test.json',
    ]);
  });

  it('resolves a single-segment `*` against a static base, as the default pattern does', () => {
    expect(rel(resolveGlob(pattern('qa/nested/*.test.json')))).toEqual(['qa/nested/deep.test.json']);
  });

  it('`**` matches zero segments as well as many', () => {
    expect(rel(resolveGlob(pattern('qa/**/*.test.json')))).toEqual([
      'qa/nested/deep.test.json',
      'qa/suite.test.json',
    ]);
  });

  it('a trailing `**` matches every file below, once each', () => {
    expect(rel(resolveGlob(pattern('meta/**')))).toEqual(['meta/a+b.test.json']);
  });

  it('adjacent `**` segments do not duplicate a match', () => {
    expect(rel(resolveGlob(pattern('qa/**/**/*.test.json')))).toEqual([
      'qa/nested/deep.test.json',
      'qa/suite.test.json',
    ]);
  });

  it('a pattern with no wildcard is still a direct file path', () => {
    const suite = path.join(root, 'qa', SUITE);
    expect(resolveGlob(suite)).toEqual([suite]);
    expect(resolveGlob(path.join(root, 'qa', 'absent.test.json'))).toEqual([]);
  });

  it('a missing base directory resolves to nothing rather than throwing', () => {
    expect(resolveGlob(pattern('no-such-dir/*.test.json'))).toEqual([]);
  });
});

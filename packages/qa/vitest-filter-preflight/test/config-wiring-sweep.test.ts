// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ⛔ A preflight nobody invoked is a phantom check — it evaluates never, and
 * deleting it leaves every assertion in `filter-preflight.test.ts` just as green
 * (#17853, #17978).
 *
 * ## Why this is a DERIVED sweep and not a list of eight packages
 *
 * The population is every package-root vitest config whose comment-masked source
 * declares `projects:` — because `projects` IS the narrowing a positional filter
 * can fall outside of, and the silent drop is available in exactly those
 * packages and nowhere else. Deriving it means the NINTH package to declare
 * `projects` is caught on the PR that adds it, instead of joining the population
 * silently the way the original seven did. A hand-written list would have had to
 * be right about a set that had already grown from one to eight.
 *
 * Measured at `a26a114d7`: 82 package roots scanned, **8** declaring `projects`
 * — `cli`, `core`, `objectql`, `qa/dogfood`, `rest`, `runtime`, `spec`, `types`
 * — which reproduces the #17978 census exactly. The count is asserted as a
 * FLOOR, not an equality: a new package joining the population must fail on its
 * own missing wiring, not on this number.
 *
 * ## What is asserted per config, and why each half fails separately
 *
 *  1. **It imports this module by a RELATIVE path.** Not by the package's bare
 *     name: `../src/index.ts`'s header carries the measurement — the bare form
 *     resolves to a `.ts` file that Node only loads via ≥ 22.18 type-stripping,
 *     and with that off the config does not load at all, which is every test in
 *     that package rather than a degraded diagnostic.
 *  2. **It invokes `runFilterPreflight` in CODE position**, with vitest's own
 *     `parseCLI` as the parser and a `packageName`. A config that imports it and
 *     never calls it is the phantom this file exists to refuse.
 *  3. **⛔ It does NOT name `test.reporters`.** The measured regression the
 *     preflight's shape avoids: naming that option replaces vitest's reporter
 *     defaulting instead of extending it — it pins `default` where an agent
 *     terminal gets `agent`, and it drops the `github-actions` reporter in CI,
 *     which no local control run can observe.
 *  4. **Each exact-list project's `include` really is on disk**, and the walk
 *     finds every member of it. That is what makes `exactAndGlobPopulations`'
 *     `minus L` a real subtraction in each package rather than an argument: a
 *     stale entry in a `vitest.repo-tests.json` would silently widen the glob
 *     population instead of narrowing it.
 *
 * `packageName` is asserted to be the package's OWN manifest name, read from its
 * `package.json` — the #17978 finding was a notice hardcoded to another
 * package's name, and a sweep that accepted any string would not have caught it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import { testFilesUnder } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Walk up to the workspace root — the directory holding pnpm-workspace.yaml. */
function findUp(predicate: (dir: string) => boolean): string {
  let dir = HERE;
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root not found from ' + HERE);
    dir = parent;
  }
}
const REPO = findUp((dir) => existsSync(join(dir, 'pnpm-workspace.yaml')));

/** The config spellings `scripts/check-console-intercept-disarm.mjs` accepts. */
const CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
];

/** Every directory in the tree holding a `package.json`. */
function packageRoots(from: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue;
      }
      const abs = join(dir, entry.name);
      if (existsSync(join(abs, 'package.json'))) found.push(abs);
      walk(abs);
    }
  };
  walk(from);
  return found.sort();
}

interface Subject {
  readonly dir: string;
  readonly rel: string;
  readonly config: string;
  readonly source: string;
  readonly name: string;
}

const SUBJECTS: Subject[] = packageRoots(REPO).flatMap((dir) => {
  const config = CONFIG_NAMES.map((n) => join(dir, n)).find(existsSync);
  if (!config) return [];
  const source = maskComments(readFileSync(config, 'utf8'));
  if (!/\bprojects\s*:/.test(source)) return [];
  const name: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name;
  return [
    {
      dir,
      rel: config.slice(REPO.length + 1),
      config,
      source,
      name: String(name),
    },
  ];
});

describe('the derived population', () => {
  it('finds the eight packages #17978 measured, at least', () => {
    // ⛔ A floor, not an equality: a ninth package joining this population must
    // fail on its own wiring below, never on this assertion.
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(8);
    expect(SUBJECTS.map((s) => s.rel)).toEqual(
      expect.arrayContaining([
        'packages/cli/vitest.config.ts',
        'packages/core/vitest.config.ts',
        'packages/objectql/vitest.config.ts',
        'packages/qa/dogfood/vitest.config.ts',
        'packages/rest/vitest.config.ts',
        'packages/runtime/vitest.config.ts',
        'packages/spec/vitest.config.ts',
        'packages/types/vitest.config.ts',
      ]),
    );
  });

  it('⛔ is not empty — a sweep that measured nothing is not a pass', () => {
    // The failure direction this whole card is about: a verifier that silently
    // degrades reports success (AGENTS.md, Route & surface ownership §3).
    expect(SUBJECTS.length).toBeGreaterThan(0);
  });
});

describe.each(SUBJECTS.map((s) => [s.rel, s] as const))('%s', (_rel, subject) => {
  it('imports the ONE shared preflight, by relative path', () => {
    expect(subject.source).toMatch(
      /from '(?:\.\.\/)+(?:qa\/)?vitest-filter-preflight\/src\/index\.js'/,
    );
    // ⛔ The bare specifier is the form that crashes config load on a Node
    // without default type-stripping. Never accept it here.
    expect(subject.source).not.toContain("'@objectstack/vitest-filter-preflight'");
  });

  it('imports vitest’s own argv parser rather than hand-rolling one', () => {
    expect(subject.source).toContain("from 'vitest/node'");
  });

  it('invokes it in code position, with the parser and its own package name', () => {
    expect(subject.source).toMatch(/runFilterPreflight\(\{/);
    expect(subject.source).toMatch(/parse:\s*parseCLI/);
    expect(subject.source).toContain(`packageName: '${subject.name}'`);
  });

  it('⛔ does NOT name `test.reporters` — the measured regression this avoids', () => {
    expect(subject.source).not.toMatch(/\breporters\s*:/);
  });
});

describe('every exact-`include` list a config hands the preflight is real on disk', () => {
  // The only exact lists in the population are the `vitest.repo-tests.json`
  // files and `packages/qa/dogfood`'s inline `SHARED_SHOWCASE`; `packages/cli`
  // derives both of its projects and has no list to read. A stale entry here
  // would make `minus L` subtract a path that is not in the walk, silently
  // WIDENING the glob population instead of narrowing it.
  const withLedger = SUBJECTS.filter((s) => existsSync(join(s.dir, 'vitest.repo-tests.json')));

  it('finds a repo-tests ledger in the six packages that declare one', () => {
    expect(withLedger.map((s) => s.rel).sort()).toEqual([
      'packages/core/vitest.config.ts',
      'packages/objectql/vitest.config.ts',
      'packages/rest/vitest.config.ts',
      'packages/runtime/vitest.config.ts',
      'packages/spec/vitest.config.ts',
      'packages/types/vitest.config.ts',
    ]);
  });

  it.each(withLedger.map((s) => [s.rel, s] as const))('%s', (_rel, subject) => {
    const ledger: string[] = JSON.parse(
      readFileSync(join(subject.dir, 'vitest.repo-tests.json'), 'utf8'),
    );
    expect(ledger.length).toBeGreaterThan(0);
    const walked = new Set(testFilesUnder(subject.dir));
    expect(ledger.filter((rel) => !walked.has(rel))).toEqual([]);
  });
});

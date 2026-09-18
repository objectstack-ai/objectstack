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
 * Measured at `a26a114d7`: 82 package roots under `packages/`, **8** declaring `projects`
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
 *
 * ## The SECOND preflight, and why this sweep grew a spawning leg (#18788)
 *
 * `runProjectCliOverridePreflight` closes the other defect the same `projects`
 * narrowing produces: a CLI TIMEOUT OVERRIDE vitest will not carry into a
 * project config, which today returns a GREEN HAVING MEASURED NOTHING. Its
 * population is the same eight packages, derived the same way, so it is swept
 * here rather than listed anywhere — a ninth package declaring `projects` is
 * caught on the PR that adds it, for both preflights at once.
 *
 * ⭐ BUT A SOURCE ASSERTION IS THE WRONG INSTRUMENT FOR A REFUSAL, and this card
 * is precisely about instruments that cannot fail. `runFilterPreflight`'s four
 * assertions above are about a config that must WRITE something in one case; a
 * refusal is about a config that must ABORT, and a config can contain the call
 * in code position and still abort nowhere — a swallowed throw, a wrong argv
 * source, a re-export that resolves to a stub. So every subject additionally
 * gets a real `vitest` child, and both directions are asked of it:
 *
 *   - `list --filesOnly --hookTimeout=1` must exit NON-ZERO and print the
 *     refusal NAMING THAT SUBJECT'S OWN manifest name. The name is what makes
 *     the non-zero a reading: a spawn failure, an unresolvable config or a
 *     missing build all exit non-zero too, and none of them prints this text.
 *   - `list --filesOnly` with no override must exit ZERO and print no refusal.
 *     ⛔ Without this leg every assertion above is satisfied by a config that
 *     refuses EVERYTHING — which would be a far worse defect than the one being
 *     fixed, and it would take the whole package's suite with it.
 *
 * `--filesOnly` globs test paths and never imports them, so neither leg depends
 * on build state; the refusing leg aborts at config load before even the glob.
 * Measured on this tree: 16 children, ~9s wall for the eight packages.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
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

const require = createRequire(import.meta.url);

/** The `vitest` CLI entry of the INSTALLED runner — found, never spelled. */
const VITEST_ENTRY = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

/** The refusal's headline, exactly as `renderInertOverrideNotice` prints it. */
const REFUSAL = 'TIMEOUT OVERRIDE CANNOT REACH THIS PACKAGE';

interface ChildRun {
  readonly status: number;
  readonly output: string;
}

/**
 * The environment a nested `vitest` child gets.
 *
 * ⛔ `VITEST`-prefixed variables and `TEST` are the RUNNER'S OWN state — pool
 * id, worker id, the "we are inside vitest" bit. Inheriting them into a child
 * vitest makes the child's behaviour a function of which worker spawned it,
 * which is a flake this file cannot afford: its whole job is to tell a refusal
 * apart from every other way a child can exit non-zero. Everything else is kept
 * on purpose — `PATH` and `HOME` are what let the child resolve and run at all.
 */
function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== 'TEST' && key !== 'VITEST' && !key.startsWith('VITEST_'),
    ),
  );
}

/**
 * `vitest list --filesOnly [flags]` inside one swept package, never throwing.
 *
 * ⛔ `execFileSync` throws on a non-zero exit and the non-zero exit is half of
 * what this measures, so the status is read off the thrown error. `stdout` and
 * `stderr` are joined: the refusal is written to stderr at config load while
 * vitest's own report of the failed load lands separately.
 */
function runVitestList(cwd: string, ...flags: string[]): ChildRun {
  const args = [VITEST_ENTRY, 'list', '--filesOnly', ...flags];
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd,
      env: childEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string };
    // ⛔ A child that never ran (spawn failure) has a NULL status. Reading that
    // as a refusal would be this card's own defect in a new place.
    expect(typeof e.status).toBe('number');
    return { status: e.status ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** The config spellings `scripts/check-console-intercept-disarm.mjs` accepts. */
const CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
];

/**
 * Every directory under `packages/` holding a `package.json`.
 *
 * ⚠️ SCOPED TO `packages/`, deliberately and with a named cost. Every one of the
 * eight is there, and it is where a library harness goes; scoping keeps this
 * suite's declared input radius (`scripts/cross-package-test-inputs.mjs`) to
 * three globs under one root instead of opening `examples/` and `apps/` roots in
 * `ci.yml`'s `crosspkg` filter as well. What it costs: a config OUTSIDE
 * `packages/` that grew `projects` would not be swept. That is an
 * UNDER-report — the direction this whole card resolves uncertainty in — and the
 * app-showcase demo's own package-root config, the only other one of any size,
 * declares no `projects` today. (⛔ That path is described rather than spelled:
 * `scripts/cross-package-test-inputs.mjs` collects quoted paths out of comments
 * too, and spelling it would open an `examples/` root in ci.yml's `crosspkg`
 * filter for a file this suite does not read.)
 */
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

const SUBJECTS: Subject[] = packageRoots(join(REPO, 'packages')).flatMap((dir) => {
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

  it('invokes the timeout-override preflight too, with the parser and its own name (#18788)', () => {
    // Same anti-phantom assertion as `runFilterPreflight` above, for the second
    // preflight this package owns. The behavioural legs below are what make it
    // more than a spelling.
    expect(subject.source).toMatch(/runProjectCliOverridePreflight\(\{/);
    expect(subject.source).toMatch(
      /runProjectCliOverridePreflight\(\{[\s\S]*?parse:\s*parseCLI[\s\S]*?\}\)/,
    );
    expect(subject.source).toMatch(
      new RegExp(
        `runProjectCliOverridePreflight\\(\\{[\\s\\S]*?packageName: '${subject.name}'`,
      ),
    );
  });

  it('⭐ REALLY refuses `--hookTimeout` — asked of a real vitest child (#18788)', () => {
    const run = runVitestList(subject.dir, '--hookTimeout=1');

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(REFUSAL);
    // The name is what makes the non-zero a READING: every other way a child
    // exits non-zero here prints something else. It is also the #17978 finding
    // held for the second preflight — a notice carrying another package's name
    // sends the reader to a command that runs the wrong suite.
    expect(run.output).toContain(subject.name);
  });

  it('⭐ CONTROL — refuses NOTHING when no override is named', () => {
    // ⛔ Without this leg, every assertion in this file is satisfied by a config
    // that refuses every run — a worse defect than the one being fixed, and one
    // that would take this package's entire suite down with it.
    const run = runVitestList(subject.dir);

    expect(run.status).toBe(0);
    expect(run.output).not.toContain(REFUSAL);
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

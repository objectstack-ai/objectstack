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
 *
 * ## ⭐ WHY BOTH CHILDREN ARE SPAWNED AT MODULE TOP AND NOT INSIDE THE `it()`
 *
 * The CONTROL leg used to spawn its child inside its own clocked `it()` window,
 * and it reddened `Test Core (1/6)` on pull requests that changed no file under
 * `packages/qa/` at all, with `Test timed out in 5000ms.` — vitest's DEFAULT
 * budget, never a number chosen for a leg whose body is a child process.
 * ⛔ The budget was not too small. It was judging something it cannot act on,
 * and two measurements on this tree say so:
 *
 *  1. **A `testTimeout` cannot interrupt a SYNCHRONOUS body**, so on this leg it
 *     was a post-hoc wall-clock assertion and nothing else. `execFileSync`
 *     blocks the worker's event loop, so vitest's timer cannot fire until the
 *     call has already returned — with the right answer. Probed on vitest
 *     4.1.11: a 1200 ms synchronous spin under an explicit 300 ms budget runs to
 *     completion (reported duration 1210 ms) and is THEN failed with `Test timed
 *     out in 300ms.` ⇒ the budget protected nothing — a child that truly HANGS
 *     blocks that same timer forever — and its only reachable effect was to fail
 *     a leg that had already produced the correct verdict.
 *  2. **What it measured was runner load, not the property.** Eight subjects x
 *     five runs, this container, under the shared verify lock: the CONTROL leg
 *     is 432-704 ms for seven subjects and 1521-1942 ms (median 1663) for
 *     `packages/cli`, whose config walks the tier files to derive its two
 *     projects. 1663 ms is 33% of the 5000 ms budget — the band #18982 names as
 *     the crossing condition — and the card's own CI readings of this leg on
 *     sibling subjects (2098 ms and 1442 ms, where this container reads
 *     432-704 ms) put the loaded-runner factor near 3x, which lands
 *     `packages/cli` on 5 s exactly.
 *
 * ⇒ ⛔ Raising the number would have bought tolerance for a reading that was
 * never about the property. The clock is removed from the VERDICT instead: both
 * children are spawned once at MODULE TOP — outside every clocked window, which
 * is where AGENTS.md puts loading ("Clocked windows measure behaviour, never
 * loading") — and each `it()` below asserts on the recorded `status` and
 * `output` in microseconds. ⛔ Nothing is skipped, retried or quarantined, and
 * no budget anywhere is raised or disabled: the two legs assert exactly what
 * they asserted before, minus the wall clock.
 *
 * ⭐ The liveness bound moves onto the thing that can actually hang —
 * `CHILD_LIVENESS_TIMEOUT_MS` on the child itself, which `spawnSync` enforces by
 * KILLING it. That is protection this file did not have, and `expectChildRan`
 * below is what stops a killed or unspawnable child reading as a refusal, which
 * a bare `status !== 0` would have done.
 *
 * ⚠️ The named cost: a `-t`-filtered run inside this file now pays all sixteen
 * children even when it selects one `it()`. One pass, medians, is 16 children
 * and ~9.0 s wall for the eight packages — the same total as before, moved.
 *
 * ⛔ Answering the CONTROL in-process instead — importing each config with a
 * clean `process.argv` and watching stderr — was measured (10-55 ms for seven
 * subjects, ~1.0 s for `packages/cli`) and REJECTED: it executes the config
 * MODULE but never vitest's project resolution or its glob, so it cannot see a
 * config that refuses nothing and still resolves no runnable project, which
 * `expect(run.status).toBe(0)` does see.
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

/**
 * How long a swept package's `vitest list` child may take before it is KILLED.
 *
 * ⛔ Not a performance budget — this file's verdict no longer has a wall-clock
 * component at all (see the header). Its only job is to turn "never exits" into
 * "this leg failed, and here is why", so it sits far above any plausible load
 * multiple: measured p100 over 80 children on this container is 1942 ms, and the
 * card's loaded-runner factor of ~3x projects that to ~5.8 s, so 60 s is ~31x
 * the measured p100 and ~10x the projected one. CI already wraps the whole job
 * in a stall guard that reds after ten minutes of silence (⛔ that script is
 * DESCRIBED rather than spelled, the way `packageRoots` above describes its own
 * excluded path: the cross-package-input scanner collects quoted paths out of
 * comments, and this file does not read that script); the bound here sits far
 * inside it, and what it adds is a failure NAMED at the leg that owns it.
 */
const CHILD_LIVENESS_TIMEOUT_MS = 60_000;

interface ChildRun {
  /** The child's own exit code, or `null` when it never exited on its own. */
  readonly status: number | null;
  readonly output: string;
  /**
   * Why the child produced no exit code of its own — `ETIMEDOUT` for the
   * liveness kill above, `ENOENT` for a spawn failure — or `null` when it did
   * exit and `status` is therefore a reading.
   */
  readonly failure: string | null;
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
 * `vitest list --filesOnly [flags]` inside one swept package, never throwing and
 * ⛔ never asserting — it runs at MODULE TOP, where a failed `expect` would be
 * a collection error that takes every assertion in this file down with it. Each
 * leg judges the record it returns.
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
      timeout: CHILD_LIVENESS_TIMEOUT_MS,
    });
    return { status: 0, output: stdout, failure: null };
  } catch (error) {
    const e = error as {
      status?: number | null;
      signal?: string | null;
      code?: string;
      stdout?: string;
      stderr?: string;
    };
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    if (typeof e.status === 'number') return { status: e.status, output, failure: null };
    // The child never exited on its own: killed by the liveness bound, or never
    // spawned at all. Both carry a NULL status, which is why the reason is
    // recorded rather than folded into a number.
    const reason = e.code ?? 'UNKNOWN';
    return { status: null, output, failure: e.signal ? `${reason} (${e.signal})` : reason };
  }
}

/**
 * ⛔ A child that never exited on its own has a NULL status, and `not.toBe(0)`
 * is SATISFIED by null — reading that as a refusal would be this card's own
 * defect in a new place. Both legs ask this FIRST, so a spawn failure, an
 * unresolvable config or the liveness kill fails by NAME instead of arriving at
 * the refusal assertion wearing a pass.
 */
function expectChildRan(run: ChildRun, rel: string): void {
  expect(run.failure, `the vitest child for ${rel} never exited on its own`).toBeNull();
  expect(typeof run.status).toBe('number');
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

interface SubjectReadings {
  readonly refusal: ChildRun;
  readonly control: ChildRun;
}

/**
 * Both children for every subject, spawned ONCE here at module top — outside
 * every clocked window. The header carries the two measurements that moved them
 * out of the `it()` bodies; what stays in those bodies is the judgement, which
 * costs microseconds and can no longer be decided by how loaded the runner was.
 */
const READINGS: ReadonlyMap<string, SubjectReadings> = new Map(
  SUBJECTS.map((subject): [string, SubjectReadings] => [
    subject.rel,
    {
      refusal: runVitestList(subject.dir, '--hookTimeout=1'),
      control: runVitestList(subject.dir),
    },
  ]),
);

/** The recorded pair for one subject — absent is a defect, never an empty pass. */
function readingsFor(rel: string): SubjectReadings {
  const readings = READINGS.get(rel);
  if (!readings) throw new Error(`no child readings were recorded for ${rel}`);
  return readings;
}

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
    const run = readingsFor(subject.rel).refusal;
    expectChildRan(run, subject.rel);

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
    //
    // ⭐ The reading is the same real vitest child it always was (#18982 moved
    // only WHEN it is taken, never WHAT it observes): a clean `vitest list`
    // must exit ZERO, which is also the one assertion in this file that
    // witnesses a healthy run of the real harness still working end to end.
    // `not.toContain(REFUSAL)` is a NEGATIVE assertion and is lit by the leg
    // above, which requires the same constant to appear on the same output
    // channel of the same child — a `REFUSAL` that drifted from what
    // `renderInertOverrideNotice` prints reddens there before it can make this
    // line vacuous.
    const run = readingsFor(subject.rel).control;
    expectChildRan(run, subject.rel);

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

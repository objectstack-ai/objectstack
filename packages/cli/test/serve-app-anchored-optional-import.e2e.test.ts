// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11185 — `os serve` resolves an app-declared OPTIONAL service package from the
 * app it is serving, even when that app is not the process CWD.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The config is an ARGUMENT (`objectstack serve /srv/app/objectstack.config.ts`),
 * so the app being served is whatever directory that config was read from. Every
 * host-anchored load nevertheless took `process.cwd()` as its resolution base, so
 * with that invocation the CLI consulted the WRONG `package.json`: a package the
 * app really does declare and really does carry in its own `node_modules` came
 * back `undeclared`, fell through to the framework-side fallback, and boot died —
 *
 *     Cannot find package '@objectstack/service-cluster': the host app does not
 *     declare it.
 *       host app: <the cwd, which is not the app>
 *       (fallback resolution also failed: Cannot find package
 *        '@objectstack/service-cluster' imported from …/packages/types/dist/node.mjs)
 *
 * Measured on the released EE 4.1.0 image as `OS_CLUSTER_DRIVER=redis` ⇒ migrate
 * exits 1 ⇒ the whole stack cannot start. #10645/#10769 fixed the IMPORTER at
 * these load sites (bare `import()` → `importFromHost`); this card fixes the BASE
 * that importer is handed.
 *
 * ── Why this file spawns the real CLI ────────────────────────────────────
 *
 * The base is computed by `run()` from its own argument. Nothing below `run()`
 * can observe it, so an in-process test of `createHostImporter` — which is what
 * `src/commands/serve-cluster-host-resolution.test.ts` pins — is green either
 * way: it hands the importer a root the test itself chose, which is precisely
 * the value that was wrong. Only a real `serve` process, given a real app
 * directory and a real CWD that is NOT that directory, exercises it.
 *
 * The spawn is written out here rather than taken from `test/helpers/
 * serve-process.ts` on purpose: that helper always runs the child WITH `cwd` set
 * to the app, which is the one shape this file must not use. What IS borrowed
 * from it is everything orthogonal to the directory the child starts in:
 * `childEnv()` (#11267) — this file boots the real stack, better-auth included,
 * which reads `TEST` directly — plus `randomPort()`, `portContentionError()`
 * (#12441) and `portDriftError()` (#12525, wired here by #12548), because a port
 * draw is not a property of the CWD either and this file used to carry its own
 * second, overlapping one.
 *
 * ── ⚠️ What this file MEASURES: the resolution, and now the BOOT behind it ──
 *
 * Until #12567 the two happy-path cases stopped at the two marker lines. They
 * proved `serve` RESOLVES both app-local packages; the fixture driver then
 * registered nothing, so `serve` walked on to `Cluster driver "redis" is not
 * registered` and the child exited 1 having never called `listen()` — 9.6s in
 * when #12567 re-measured it on `527e0505d`, 5.6s when the card was filed.
 * Nothing here proved `serve` BOOTS with an app-local cluster driver — while
 * the test names and the `Press Ctrl+C to stop` settle alternative both read as
 * though a boot were in scope.
 *
 * ⭐ #12567's ruling was to sweep the repo for something that DID prove it
 * before changing anything here, because if something did, this file should
 * have been renamed to say `resolves` instead. The answer was NOTHING — not
 * "nothing better", nothing at all:
 *
 *   - `serve.ts`'s entire cluster block sits behind `if (__clusterDriver &&
 *     __clusterDriver !== 'memory')`, and THIS FILE is the only test in the
 *     workspace that sets `OS_CLUSTER_DRIVER` on a child. The one other test
 *     that names the variable, `serve-cluster-host-resolution.test.ts`, names it
 *     in prose and spawns nothing. So no other banner-reaching test loads a
 *     cluster package at all.
 *   - `registerClusterDriver` occurs in ZERO of the 2823 test files in the
 *     workspace — reverse-checked against `checkMultiNodeAllowed` (5 files) and
 *     `defineCluster` (2), both present in that same population.
 *   - `packages/qa/**` — dogfood plus every conformance suite — holds ZERO
 *     occurrences of `cluster`, reverse-checked against `dogfood` (86 files of
 *     190) and `serve` (74).
 *
 * ⇒ the boot coverage had to be built HERE or it would not exist anywhere. That
 * is a decision being recorded, not a repair being described: this file measures
 * strictly more than it did, on purpose.
 *
 * ── ⚠️ ONE claim of #12567's that this file does NOT repeat ───────────────
 *
 * The card read the old happy path as a CLOSED LOOP that "cannot fail", on the
 * ground that `toContain(DRIVER_MARK)` was also one of `SETTLED`'s alternatives.
 * Measured on this tree the "cannot fail" half does not hold, and the record is
 * kept here so nobody re-derives it: `finish()` has FOUR call sites and only ONE
 * is gated on `waitFor` — the others are the child's `exit`, its `error` and the
 * timeout — so a run reaches the assertions whether or not `waitFor` ever
 * matched. A `serve` that re-anchored at the CWD prints `does not declare it`
 * for the DECLARED app, settles on THAT alternative, and the marker assertions
 * go red. Verified by replaying this harness's settle structure against a child
 * that prints nothing matching: it resolves via `exit`, and the assertion is
 * RED.
 *
 * ⭐ What WAS true is narrower and is the defect actually repaired here: both
 * markers are printed MID-BOOT, so waking on one handed the assertions a process
 * that had not finished — and, before the driver registered, one that was about
 * to die. ⛔ So the mechanical rule this file now keeps is: `SETTLED` may match
 * only TERMINAL outcomes, never mid-boot progress. Each alternative it carries
 * is an outcome one test asserts and another test is turned RED by, which is
 * what makes waiting on them a discriminator rather than a restatement.
 *
 * ── ⚠️ The port apparatus: one LIVE instrument, one insurance ─────────────
 *
 * #12548 wired the drift read-back into this file as the sibling of
 * `serve-process-child-env.e2e.test.ts`, and #12565 recorded HERE that it was
 * SILENT on every run this file made. That was true of the tree it was written
 * on and is not true of this one, so the note is UPDATED rather than deleted: a
 * reader who meets a live instrument described as silent misreads its greens
 * exactly as badly as the reverse.
 *
 *   `portDriftError()`      ⭐ LIVE since #12567 on the two happy-path runs.
 *                           They print a complete banner, so
 *                           `boundPortFromBanner()` answers `bound` and the port
 *                           this harness asked for is really compared against
 *                           the one the child bound. Still `null` on the
 *                           undeclared leg, which dies before `listen()` — the
 *                           helper's own stated contract, not a gap.
 *
 *   `portContentionError()` STILL INSURANCE — and ⛔ not for the reason the old
 *                           note gave. Its silence never depended on the banner:
 *                           these children spawn through `bin/run-dev.js`, which
 *                           pins `NODE_ENV=development` before argv is parsed,
 *                           so `serve`'s auto-shift branch is open and a taken
 *                           port is a hop to the next free one, never the bind
 *                           failure that helper reads for. That is a property of
 *                           the SPAWN POSTURE, so booting to a banner cannot
 *                           make it fire. It stays because the helper is the
 *                           shared shape and a spawn posture can change;
 *                           ⛔ do not read its green as a look.
 *
 * ⇒ this file's exposure is still narrower than the security file's — it issues
 * no HTTP request — but its happy-path children now DO bind a port there is
 * something to drift off, which is the half that used to be nil.
 *
 * ── The anti-vacuity floor ───────────────────────────────────────────────
 *
 * The fixture packages exist ONLY in the app's `node_modules`. Nothing in this
 * workspace can supply `@objectstack/service-cluster` to `packages/cli` — the
 * CLI does not declare it (that is what makes it app-declarable at all), and the
 * fixtures are written to a temp directory with a fake `index.js` no build
 * produces. A pass therefore cannot come from the CLI's own resolution by
 * accident: the marker line these fixtures print is reachable only across the
 * boundary the card is about. Re-measured for #12567 from this very directory:
 * `createRequire('packages/cli/test/…').resolve('@objectstack/service-cluster')`
 * answers `MODULE_NOT_FOUND`.
 *
 * ⚠️ #12567 hands the DRIVER fixture the ONE thing it cannot get from the app:
 * the ESM entry of the framework's OWN `@objectstack/service-cluster`, so its
 * `registerClusterDriver()` writes to the Map that `@objectstack/runtime`
 * actually reads. The registry is module-scope state, and registering into this
 * app's fixture COPY of that package would write to a Map nothing ever reads —
 * a fixture that looks right, boots nothing, and blames `serve`. A real
 * deployment gets the single-instance property for free, because the app
 * declares the cluster packages and the runtime out of one `node_modules`; a
 * fixture app in `os.tmpdir()` has to be handed it.
 *
 * ⛔ It does not lower the floor, which is about who can PRINT the marker lines:
 * nothing in the workspace prints them, and the framework's cluster package has
 * no idea these fixtures exist. ⛔ And do not "simplify" it by pointing the
 * app's `@objectstack/service-cluster` fixture at the real package instead —
 * THAT substitutes workspace resolution for app resolution and is exactly the
 * vacuous shape this floor refuses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { childEnv, portContentionError, portDriftError, randomPort } from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `bin/run-dev.js` — this package's own entrypoint, run from TS source. */
const CLI = resolve(HERE, '../bin/run-dev.js');
/** The workspace `tsx` binary (an installed dependency, not a repo source input). */
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.anchoredimport',
    namespace: 'anchoredimport',
    version: '1.0.0',
    type: 'app',
    name: 'App-Anchored Optional Import Fixture',
  },
};
`;

/** How either refusal names this file's child — it spawns directly, so no helper can. */
const WHAT = 'os serve (bin/run-dev.js \u21d2 NODE_ENV=development)';

/** The gate package `serve` loads first when OS_CLUSTER_DRIVER is set. */
const CLUSTER = '@objectstack/service-cluster';
/**
 * What `OS_CLUSTER_DRIVER` is set to below — ONE spelling, because it names
 * three things that have to agree: the env var, the driver package `serve`
 * derives from it, and the registry key the fixture driver registers under. A
 * boot reaches its banner only when all three match, so three literals would buy
 * a failure mode with no upside.
 */
const DRIVER_NAME = 'redis';
/** The driver it loads next, named from the env var. */
const DRIVER = `@objectstack/service-cluster-${DRIVER_NAME}`;

const CLUSTER_MARK = '[fixture] app-local @objectstack/service-cluster loaded';
const DRIVER_MARK = '[fixture] app-local @objectstack/service-cluster-redis loaded';

/**
 * Stand-in for the distribution cluster gate. `checkMultiNodeAllowed` is the one
 * export `serve` destructures; returning `allowed` keeps the boot walking on to
 * the driver load, so one run exercises both host-anchored sites.
 */
const FAKE_CLUSTER = `
console.error(${JSON.stringify(CLUSTER_MARK)});
export function checkMultiNodeAllowed() { return { allowed: true }; }
`;

/**
 * Stand-in for a shipped remote driver — and, since #12567, a REGISTERING one.
 *
 * Before #12567 this printed its marker and stopped, so `serve` walked on to
 * `Cluster driver "redis" is not registered` and the child died without ever
 * calling `listen()`. Registering makes the runtime's own
 * `defineCluster({ driver: DRIVER_NAME })` resolve, so the boot completes and
 * this file measures the BOOT as well as the two resolutions.
 *
 * `frameworkClusterEsm` is the framework's own `@objectstack/service-cluster`,
 * found by `frameworkClusterEsmEntry()` below — see the anti-vacuity note in
 * this file's header for why the registry has to be THAT module's, and why
 * handing it over does not weaken the floor.
 *
 * The factory delegates to the `memory` driver rather than standing anything
 * remote up: this file measures WHERE `serve` resolved a driver from and that
 * the boot completed with it, never the driver's transport. A real Redis would
 * add a service dependency and measure nothing extra. The composed service
 * therefore reports `driver: 'memory'`, which is the honest answer — ⛔ do not
 * relabel it `redis` to make a boot log read better: the split-brain guard
 * (ADR-0010) keys off exactly that string, and a fixture that lies about it is a
 * fixture that can walk past the guard.
 */
function fakeDriver(frameworkClusterEsm: string): string {
  return `
console.error(${JSON.stringify(DRIVER_MARK)});

const { defineCluster, registerClusterDriver } = await import(${JSON.stringify(frameworkClusterEsm)});
registerClusterDriver(${JSON.stringify(DRIVER_NAME)}, (config) => defineCluster({
  driver: 'memory',
  nodeId: config.nodeId,
}));
`;
}

/**
 * The framework's OWN `@objectstack/service-cluster`, as the ESM entry the
 * runtime's graph really loads — reached by SPECIFIER, with ⛔ no assumption
 * about where this workspace keeps its packages.
 *
 * Three steps, and none is interchangeable with the obvious shorter spelling:
 *
 *   1. `packages/cli` cannot resolve `@objectstack/service-cluster` at all — it
 *      deliberately does not declare it, which is what makes the package
 *      app-declarable in the first place, and `serve-host-fallback-base.e2e.
 *      test.ts` carries that measurement (`MODULE_NOT_FOUND`, re-measured from
 *      this directory for #12567). `@objectstack/runtime` IS declared here and
 *      DOES declare the cluster package, and runtime is the module whose
 *      registry decides this boot — so runtime is the vantage to resolve from.
 *
 *   2. `createRequire().resolve()` answers with the `require` condition, so it
 *      hands back `dist/index.cjs`. ⚠️ The CJS twin is a DIFFERENT module
 *      instance with a DIFFERENT registry Map: a driver registered into it is
 *      registered where the ESM runtime never looks, and the boot then dies
 *      blaming `serve`. So that answer is used only to FIND the package, and
 *      the package's own manifest is asked which file `import` selects.
 *
 *   3. The climb to that manifest is verified by `name` rather than counted in
 *      directory levels, so it cannot quietly answer with a neighbour's
 *      `package.json` the day the layout moves.
 *
 * ⛔ Deliberately NOT a child process asking `import.meta.resolve`. That answer
 * would be authoritative too, but every spawn under `packages/cli/test` owes a
 * declared environment (`check:cli-test-child-env`), and this needs no process
 * of its own: a package's manifest is the authority on its own entry points.
 */
function frameworkClusterEsmEntry(): string {
  const runtimeEntry = createRequire(import.meta.url).resolve('@objectstack/runtime');
  const clusterEntry = createRequire(runtimeEntry).resolve(CLUSTER);
  let dir = dirname(clusterEntry);
  for (;;) {
    let manifest: { name?: string; exports?: Record<string, { import?: string }> } | undefined;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch { /* not a package root, or unreadable — keep climbing */ }
    if (manifest?.name === CLUSTER) {
      const entry = manifest.exports?.['.']?.import;
      if (typeof entry !== 'string') {
        throw new Error(
          `${CLUSTER} at ${dir} declares no \`exports["."].import\` — there is no ESM entry to `
          + 'hand the fixture driver, and registering into the CJS twin would be silent.',
        );
      }
      return pathToFileURL(realpathSync(resolve(dir, entry))).href;
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`no ${CLUSTER} package.json above ${clusterEntry}`);
    dir = up;
  }
}

function writeAppLocalPackage(nodeModules: string, name: string, body: string): void {
  const dir = join(nodeModules, ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0-fixture', type: 'module', main: 'index.js' }),
    'utf8',
  );
  writeFileSync(join(dir, 'index.js'), body, 'utf8');
}

/**
 * An app whose optional service packages live in its OWN `node_modules`.
 *
 * `declare` splits the two halves of the contract: declared is the repair,
 * undeclared must still be refused (#4719 — reachability is not a declaration,
 * and moving the resolution base must not quietly widen what `serve` accepts).
 */
function writeApp(prefix: string, declare: boolean, frameworkClusterEsm: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'anchored-import-fixture',
        private: true,
        type: 'module',
        ...(declare ? { dependencies: { [CLUSTER]: '*', [DRIVER]: '*' } } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );
  const nodeModules = join(dir, 'node_modules');
  writeAppLocalPackage(nodeModules, CLUSTER, FAKE_CLUSTER);
  writeAppLocalPackage(nodeModules, DRIVER, fakeDriver(frameworkClusterEsm));
  return dir;
}

/**
 * How a run ENDED — a fact about the harness, not a string in the child's
 * buffer.
 *
 * ⭐ This is what lets a happy-path case assert that the boot COMPLETED without
 * asserting the banner text that woke it (#12567). `matched` means a terminal
 * outcome named by `SETTLED` was observed; `exited` means the child was gone
 * first; `timeout` means neither happened inside the budget. That last one is
 * the case no string assertion below can reach: a child that printed both
 * markers and then HUNG short of `listen()` satisfies every one of them.
 */
type RunOutcome = 'matched' | 'exited' | 'timeout';

interface Run { stdout: string; stderr: string; both: string; outcome: RunOutcome }

/**
 * Boot `serve` with an explicit `cwd` and an explicit config argument, collect
 * output until `waitFor` matches or the child exits, then stop it.
 *
 * An early exit resolves rather than rejects: a boot that DIES still has to have
 * said why, and the refusal case below reads exactly that.
 *
 * ⭐ TWO exceptions, both about the port and both about the same mis-signalling.
 * A boot that DIED because it could not BIND rejects, naming the port (#12441):
 * resolving it would hand the caller an output buffer with no marker in it, and
 * the assertions would then fail with "the cluster gate was not loaded from the
 * app" — a sentence about resolution bases, for a failure that is entirely about
 * a port. That is the whole cost the card measured, and it is more expensive
 * than the lost run. A boot that SUCCEEDED on a port other than the one it was
 * asked for rejects too (#12525, wired by #12548) — ⚠️ silent on this tree for
 * the measured reason in this file's header, and kept for the tree where it is
 * not.
 */
function runServeFrom(
  cwd: string,
  configArg: string,
  waitFor: RegExp,
  timeoutMs = 240_000,
): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    // ⛔ Was an inline `String(40000 + Math.random() * 20000)`, a SECOND blind
    // draw whose range overlapped the one in
    // `serve-node-env-production-default.e2e.test.ts` (41000-60000) — so under
    // `--maxWorkers > 1` the two files could collide with EACH OTHER, not only
    // with a neighbouring agent's dev server. One bind-probed draw now, in the
    // helper; its docblock is the authority on what that does and does not
    // guarantee.
    const port = randomPort();
    const child = spawn(TSX, [CLI, 'serve', configArg, '--port', port], {
      cwd,
      env: childEnv({
        NO_COLOR: '1',
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        // The trigger: without a non-memory driver the cluster block is skipped
        // entirely and this file would measure nothing.
        OS_CLUSTER_DRIVER: 'redis',
      }),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      const contended = portContentionError(stdout + stderr, WHAT, port);
      if (contended) {
        rejectRun(contended);
        return;
      }
      // ⭐ The read-back half (#12548), LIVE here since #12567: the happy-path
      // children print a complete banner, so this really compares the port the
      // harness asked for against the one the child bound. ⛔ Still not a look
      // on the undeclared leg, which dies before `listen()` — this file's
      // header carries both halves of that measurement.
      const drifted = portDriftError(stdout + stderr, WHAT, port);
      if (drifted) {
        rejectRun(drifted);
        return;
      }
      resolveRun({ stdout, stderr, both: stdout + stderr, outcome });
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    const onData = (chunk: unknown, stream: 'out' | 'err') => {
      if (stream === 'out') stdout += String(chunk); else stderr += String(chunk);
      if (waitFor.test(stdout + stderr)) finish('matched');
    };
    child.stdout.on('data', (d) => onData(d, 'out'));
    child.stderr.on('data', (d) => onData(d, 'err'));
    child.on('exit', () => finish('exited'));
    // A spawn that never ran is `exited` for this purpose: the child is gone
    // without having reached a terminal outcome, which is what the caller has
    // to be able to tell apart from a boot that finished.
    child.on('error', () => finish('exited'));
  });
}

/**
 * The TERMINAL outcomes, so a run never waits out its timeout — and ⛔ nothing
 * else.
 *
 * ⭐ Since #12567 neither marker is in here. Both are printed MID-BOOT, so
 * waking on one handed the assertions a process that had not finished — and,
 * before the fixture driver registered, one that was about to die. The banner
 * tail is the honest wake for a file that measures a boot, and it is now a thing
 * that HAPPENS rather than an alternative advertising a boot that never did.
 * ⛔ Do not put a marker back in to make a run finish sooner: those seconds are
 * the boot, and the boot is what this file exists to measure.
 *
 * The two alternatives are the two outcomes the cases below discriminate
 * between — each is asserted by one case and turns another case RED — which is
 * what keeps waiting on them from being a restatement of the assertion. A child
 * that dies printing neither still resolves through the `exit` handler above and
 * is judged by the same assertions.
 */
const SETTLED = /Press Ctrl\+C to stop|does not declare it/;

let declaredApp: string;
let undeclaredApp: string;
/** A CWD that is not any app: no config, no manifest, nothing to resolve from. */
let neutralCwd: string;

beforeAll(() => {
  // Resolved ONCE and handed to both apps: the fixture driver registers into the
  // framework's registry, and this is the only thing that can find it.
  const frameworkClusterEsm = frameworkClusterEsmEntry();
  declaredApp = writeApp('os-anchored-declared-', true, frameworkClusterEsm);
  undeclaredApp = writeApp('os-anchored-undeclared-', false, frameworkClusterEsm);
  neutralCwd = mkdtempSync(join(tmpdir(), 'os-anchored-neutral-cwd-'));
});

afterAll(() => {
  for (const dir of [declaredApp, undeclaredApp, neutralCwd]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('os serve → optional service resolution is anchored at the app (#11185)', () => {
  it(
    'BOOTS on an app-local-only optional package when the CWD is NOT the app',
    async () => {
      const run = await runServeFrom(neutralCwd, join(declaredApp, 'objectstack.config.ts'), SETTLED);
      const seen = `\n--- stdout ---\n${run.stdout.slice(-4000)}\n--- stderr ---\n${run.stderr.slice(-4000)}`;

      // The load-bearing assertion. Before the fix the base was `process.cwd()`
      // — the neutral directory — so the app's declaration was never read and
      // the boot died before either marker was printed.
      expect(run.both, `the cluster gate was not loaded from the app${seen}`).toContain(CLUSTER_MARK);
      expect(run.both, `the cluster driver was not loaded from the app${seen}`).toContain(DRIVER_MARK);
      expect(run.both, `serve refused a package the app DOES declare${seen}`).not.toContain(
        'does not declare it',
      );

      // ⭐ The boot half (#12567). Both markers print mid-boot, so on their own
      // they cannot tell a completed boot from the child that printed them and
      // then died on an unregistered driver — these two can, and neither is the
      // text that woke the run.
      expect(run.both, `serve never registered the app's cluster driver${seen}`).not.toContain(
        'is not registered',
      );
      expect(run.outcome, `serve never reached a ready banner${seen}`).toBe('matched');
    },
    300_000,
  );

  it(
    'still BOOTS on it when the CWD IS the app (the shape #10645 fixed stays fixed)',
    async () => {
      // Passes on both trees: it is the control that proves the fixture and the
      // boot path are real, so a failure in the test above is the BASE and not a
      // broken fixture.
      const run = await runServeFrom(declaredApp, 'objectstack.config.ts', SETTLED);
      const seen = `\n--- stdout ---\n${run.stdout.slice(-4000)}\n--- stderr ---\n${run.stderr.slice(-4000)}`;
      expect(run.both, `the cluster gate was not loaded from the app${seen}`).toContain(CLUSTER_MARK);
      expect(run.both, `the cluster driver was not loaded from the app${seen}`).toContain(DRIVER_MARK);
      expect(run.both, `serve refused a package the app DOES declare${seen}`).not.toContain(
        'does not declare it',
      );
      expect(run.both, `serve never registered the app's cluster driver${seen}`).not.toContain(
        'is not registered',
      );
      expect(run.outcome, `serve never reached a ready banner${seen}`).toBe('matched');
    },
    300_000,
  );

  it(
    'still refuses a package the app does not declare, and names the APP',
    async () => {
      // The other half: moving the base must not turn the #4719 declaration gate
      // into "whatever is reachable". The package IS in this app's node_modules
      // and is still refused — and the remedy now points at the app, which is
      // where the declaration has to go. Before the fix it named the CWD, an
      // unrelated directory the operator was merely standing in.
      const run = await runServeFrom(
        neutralCwd,
        join(undeclaredApp, 'objectstack.config.ts'),
        SETTLED,
      );
      const seen = `\n--- stdout ---\n${run.stdout.slice(-4000)}\n--- stderr ---\n${run.stderr.slice(-4000)}`;

      expect(run.both, `the declaration gate did not fire${seen}`).toContain('does not declare it');
      expect(run.both, `the remedy does not name the app being served${seen}`).toContain(
        `host app: ${undeclaredApp}`,
      );
      expect(run.both, `the remedy still names the CWD${seen}`).not.toContain(
        `host app: ${neutralCwd}`,
      );
      expect(run.both, `reachability substituted for declaration${seen}`).not.toContain(CLUSTER_MARK);
    },
    300_000,
  );
});

describe('os serve → the anchor is wired where it cannot be forgotten', () => {
  const SERVE_SOURCE = readFileSync(resolve(HERE, '../src/commands/serve.ts'), 'utf8');

  it('resolves the config path and the app root in ONE call', () => {
    // If `run()` ever computes the config path itself again, the anchor becomes
    // a separate statement someone can write too late — or not at all — and the
    // behavioural tests above would be the only thing standing between that and
    // a silent return to CWD-based resolution.
    expect(SERVE_SOURCE).toContain(
      'const { configPath: absolutePath, configExists } = anchorServedApp(args.config!);',
    );
    expect(SERVE_SOURCE).not.toMatch(
      /const absolutePath = path\.resolve\(process\.cwd\(\), args\.config!\)/,
    );
  });

  it('defaults every host-anchored load to the served app, not the CWD', () => {
    expect(SERVE_SOURCE).toContain(
      'function importFromHost(specifier: string, hostRoot: string = servedAppRootOrCwd())',
    );
    expect(SERVE_SOURCE).toContain('const hostRoot = servedAppRootOrCwd();');
    expect(SERVE_SOURCE).toContain('const root = hostRoot ?? servedAppRootOrCwd();');
  });

  it('reads the app root through a function, never a module-scope copy', () => {
    // A `const` captured at module-evaluation time would freeze the pre-boot
    // answer (`process.cwd()`) into every call site, which is the defect wearing
    // a different hat.
    expect(SERVE_SOURCE).toMatch(/^function servedAppRootOrCwd\(\): string \{$/m);
    expect(SERVE_SOURCE).not.toMatch(/\b(?:const|let|var)\s+servedAppRootOrCwd\b/);
  });
});

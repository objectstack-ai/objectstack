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
 * to the app, which is the one shape this file must not use. Only its
 * `childEnv()` choke point is borrowed (#11267) — what the child INHERITS is
 * orthogonal to which directory it is started in, and this file boots the real
 * stack, better-auth included, which reads `TEST` directly.
 *
 * ── The anti-vacuity floor ───────────────────────────────────────────────
 *
 * The fixture packages exist ONLY in the app's `node_modules`. Nothing in this
 * workspace can supply `@objectstack/service-cluster` to `packages/cli` — the
 * CLI does not declare it (that is what makes it app-declarable at all), and the
 * fixtures are written to a temp directory with a fake `index.js` no build
 * produces. A pass therefore cannot come from the CLI's own resolution by
 * accident: the marker line these fixtures print is reachable only across the
 * boundary the card is about.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

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

/** The gate package `serve` loads first when OS_CLUSTER_DRIVER is set. */
const CLUSTER = '@objectstack/service-cluster';
/** The driver it loads next, named from the env var. */
const DRIVER = '@objectstack/service-cluster-redis';

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

const FAKE_DRIVER = `
console.error(${JSON.stringify(DRIVER_MARK)});
`;

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
function writeApp(prefix: string, declare: boolean): string {
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
  writeAppLocalPackage(nodeModules, DRIVER, FAKE_DRIVER);
  return dir;
}

interface Run { stdout: string; stderr: string; both: string }

/**
 * Boot `serve` with an explicit `cwd` and an explicit config argument, collect
 * output until `waitFor` matches or the child exits, then stop it.
 *
 * An early exit resolves rather than rejects: a boot that DIES still has to have
 * said why, and the refusal case below reads exactly that.
 */
function runServeFrom(
  cwd: string,
  configArg: string,
  waitFor: RegExp,
  timeoutMs = 240_000,
): Promise<Run> {
  return new Promise((resolveRun) => {
    const port = String(40000 + Math.floor(Math.random() * 20000));
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
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      resolveRun({ stdout, stderr, both: stdout + stderr });
    };
    const timer = setTimeout(finish, timeoutMs);
    const onData = (chunk: unknown, stream: 'out' | 'err') => {
      if (stream === 'out') stdout += String(chunk); else stderr += String(chunk);
      if (waitFor.test(stdout + stderr)) finish();
    };
    child.stdout.on('data', (d) => onData(d, 'out'));
    child.stderr.on('data', (d) => onData(d, 'err'));
    child.on('exit', finish);
    child.on('error', finish);
  });
}

/** Matches either outcome, so a run never waits out its timeout. */
const SETTLED = new RegExp(
  `${DRIVER_MARK.replace(/[[\]]/g, '\\$&')}|does not declare it|Press Ctrl\\+C to stop`,
);

let declaredApp: string;
let undeclaredApp: string;
/** A CWD that is not any app: no config, no manifest, nothing to resolve from. */
let neutralCwd: string;

beforeAll(() => {
  declaredApp = writeApp('os-anchored-declared-', true);
  undeclaredApp = writeApp('os-anchored-undeclared-', false);
  neutralCwd = mkdtempSync(join(tmpdir(), 'os-anchored-neutral-cwd-'));
});

afterAll(() => {
  for (const dir of [declaredApp, undeclaredApp, neutralCwd]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('os serve → optional service resolution is anchored at the app (#11185)', () => {
  it(
    'loads an app-local-only optional package when the CWD is NOT the app',
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
    },
    300_000,
  );

  it(
    'still loads it when the CWD IS the app (the shape #10645 fixed stays fixed)',
    async () => {
      // Passes on both trees: it is the control that proves the fixture and the
      // boot path are real, so a failure in the test above is the BASE and not a
      // broken fixture.
      const run = await runServeFrom(declaredApp, 'objectstack.config.ts', SETTLED);
      const seen = `\n--- stdout ---\n${run.stdout.slice(-4000)}\n--- stderr ---\n${run.stderr.slice(-4000)}`;
      expect(run.both, `the cluster gate was not loaded from the app${seen}`).toContain(CLUSTER_MARK);
      expect(run.both, `the cluster driver was not loaded from the app${seen}`).toContain(DRIVER_MARK);
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

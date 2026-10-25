import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here — adding one
// would itself be an error (TS2578). See objectui#3494.
import { evaluateVitestInvocation, parseVitestArgv } from '../vitest-invocation-guard.mjs';

/**
 * objectui#3746 — `pnpm --filter @object-ui/runner test` was 4 red on a clean
 * `main` while the very same 13 tests were green from the repo root.
 *
 * Mechanism, measured at 6402e253f: `packages/runner` declared
 * `"test": "vitest run"` and has NO vitest config of its own, so vitest —
 * launched by pnpm with the package as its cwd, hence as its root — adopted the
 * `vite.config.ts` sitting in that directory. That file is runner's config as a
 * Vite APPLICATION: `resolve.alias` plus `build`, with no `test` block, so no DOM
 * environment and no setup files. The four `App.navigation.test.tsx` cases then
 * ran in the node environment and died on `ReferenceError: window is not
 * defined` — the run's own summary said `setup 0ms ... environment 0ms`.
 *
 * The fix routes that entry back to the ROOT config rather than giving runner a
 * local one, and that choice is the part worth pinning:
 *
 *  - a package-local vitest config would be an 18th of exactly the kind
 *    objectui#3240's maintainer ruling (option A, 2026-08-06) is to DELETE, and
 *    it would resolve `@object-ui/*` through runner's own 15-entry alias table
 *    (Node resolution, i.e. `dist`, for everything else) while the root config
 *    maps ~40 of them to `src` — the "one file, two verdicts" divergence #3240
 *    exists to remove;
 *  - it would also lift the run out from under
 *    `scripts/vitest-invocation-guard.mjs`, which is reachable only through the
 *    root config: the objectui#3288 `--`-forwarding trap would silently stop
 *    being refused for this package.
 *
 * So the script now spells the invocation AGENTS.md (§怎么跑测试) and the guard's
 * own error message both prescribe for a package directory:
 * `vitest run --root ../.. packages/runner/`. Both entries are then literally the
 * same config, and the counts agree (13 tests in 3 files, either way).
 *
 * Reverse verification: restore `"test": "vitest run"` and this file goes red
 * naming runner, while the repo-root entry stays green — the package entry is the
 * only thing the change moves.
 *
 * Scope: this pins RUNNER. Seven sibling packages carry the same hijackable shape
 * and are deliberately left alone — see BARE_ENTRY_BASELINE.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const RUNNER_DIR = 'packages/runner';

/** Workspace groups from the root `package.json` that can hold a `test` script. */
const WORKSPACE_GROUPS = ['packages', 'apps', 'examples'];

const VITE_CONFIG = /^vite\.config\.[cm]?[jt]s$/;
const VITEST_CONFIG = /^vitest\.config\.[cm]?[jt]s$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * Packages whose `test` script still hands vitest a package-level root while the
 * directory holds a `vite.config.*` and no vitest config, so vitest adopts the
 * app-facing Vite config. Whether each is actually RED depends on whether its
 * tests touch the DOM (runner's did) — the shape is what is measured here, which
 * is all a static check can honestly claim.
 *
 * Recorded as a CEILING, not an inventory: the list may shrink and must not grow.
 * The repo-wide redefinition of the package-level `test` scripts belongs to
 * objectui#3240 (maintainer ruling A), which is to run as its own batch; this
 * file must not become a reason to touch these packages out of band.
 */
const BARE_ENTRY_BASELINE = [
  'packages/plugin-ai',
  'packages/plugin-chatbot',
  'packages/plugin-designer',
  'packages/plugin-editor',
  'packages/plugin-markdown',
  'packages/plugin-report',
  'packages/plugin-tree',
];

type PackageEntry = {
  /** Repo-relative directory, e.g. `packages/runner`. */
  dir: string;
  testScript: string;
  hasViteConfig: boolean;
  hasVitestConfig: boolean;
};

function readEntriesWithTestScript(): PackageEntry[] {
  const entries: PackageEntry[] = [];
  for (const group of WORKSPACE_GROUPS) {
    const groupDir = path.join(repoRoot, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const name of fs.readdirSync(groupDir)) {
      const dir = path.join(groupDir, name);
      const manifest = path.join(dir, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      const testScript = pkg.scripts?.test;
      if (!testScript) continue;
      const files = fs.readdirSync(dir);
      entries.push({
        dir: `${group}/${name}`,
        testScript,
        hasViteConfig: files.some((f) => VITE_CONFIG.test(f)),
        hasVitestConfig: files.some((f) => VITEST_CONFIG.test(f)),
      });
    }
  }
  return entries;
}

/** `process.argv` as pnpm would hand it to a package `test` script. */
function argvForScript(script: string): string[] {
  const tokens = script.trim().split(/\s+/);
  // tokens[0] is the binary (`vitest`); in process.argv that slot is argv[1].
  return ['/usr/bin/node', '/bin/vitest', ...tokens.slice(1)];
}

/**
 * The directory this script makes vitest's ROOT — the cwd it is launched from,
 * unless it points `--root` somewhere else. That root is what decides which
 * config file vitest loads and what the projects' `include` globs resolve
 * against (objectui#3378).
 */
function vitestRootOf(entry: PackageEntry): string {
  const { flags } = parseVitestArgv(argvForScript(entry.testScript));
  const raw = flags['--root'] ?? flags['-r'];
  const cwd = path.join(repoRoot, entry.dir);
  return typeof raw === 'string' ? path.resolve(cwd, raw) : cwd;
}

function collectTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(abs));
    else if (TEST_FILE.test(entry.name)) out.push(abs);
  }
  return out;
}

const entries = readEntriesWithTestScript();

function requireRunner(): PackageEntry {
  const found = entries.find((e) => e.dir === RUNNER_DIR);
  if (!found) {
    throw new Error(
      `${RUNNER_DIR} declares no "test" script. objectui#3746 pinned the SHAPE of that ` +
        'entry; if the entry itself is being removed, retire this pin with it.'
    );
  }
  return found;
}

const runner = requireRunner();

describe('objectui#3746 — the runner package-level test entry', () => {
  it('still has the hijackable shape: a vite.config with no `test` block, and no vitest config', () => {
    // If either of these flips, the assertions below stop protecting what they
    // were written for and this pin needs re-reading rather than re-spelling.
    expect(runner.hasViteConfig).toBe(true);
    expect(runner.hasVitestConfig).toBe(false);

    const viteConfig = fs.readFileSync(path.join(repoRoot, RUNNER_DIR, 'vite.config.ts'), 'utf8');
    expect(viteConfig).not.toMatch(/^\s*test\s*:/m);
  });

  it('routes vitest root back to the repo root instead of running under the app vite config', () => {
    expect(runner.testScript).not.toBe('vitest run');
    expect(vitestRootOf(runner)).toBe(repoRoot);
  });

  it('is accepted by the invocation guard that the root config wires up', () => {
    // Root == repo root, and no `--` forwarding: the two refusals of
    // objectui#3378 / #3288 both stay live for this entry, and it passes them.
    const verdict = evaluateVitestInvocation({
      argv: argvForScript(runner.testScript),
      cwd: path.join(repoRoot, RUNNER_DIR),
      repoRoot,
    });

    expect(verdict).toBeNull();
  });

  it("filters onto runner's own test files, all of them", () => {
    const { positionals } = parseVitestArgv(argvForScript(runner.testScript));

    // No filter would mean the package entry runs the WHOLE repo suite; a filter
    // pointing outside runner would mean it runs somebody else's tests and calls
    // them green — objectui#3378's original shape.
    expect(positionals.length).toBeGreaterThan(0);
    for (const positional of positionals) {
      const abs = path.resolve(repoRoot, positional);
      expect(fs.existsSync(abs), `${positional} does not exist relative to the repo root`).toBe(
        true
      );
      expect(abs.startsWith(path.join(repoRoot, RUNNER_DIR))).toBe(true);
    }

    // Vitest matches a positional as a substring of each test file's path, so
    // every one of runner's test files has to sit under one of them; otherwise the
    // package entry would quietly run a subset of the package.
    const testFiles = collectTestFiles(path.join(repoRoot, RUNNER_DIR));
    expect(testFiles.length).toBeGreaterThan(0);
    for (const file of testFiles) {
      const rel = path.relative(repoRoot, file);
      expect(
        positionals.some((positional) => rel.startsWith(positional)),
        `${rel} is not covered by the test script's filters (${positionals.join(' ')})`
      ).toBe(true);
    }
  });

  it('a bare `vitest run` from the package directory is the invocation this repo refuses', () => {
    // Note what this does and does not claim. For runner the bare form never
    // REACHED the guard: with no vitest config, vitest loaded `vite.config.ts` and
    // the root config — the only place the guard is called from — was never
    // evaluated, so the run proceeded in the node environment and produced four
    // `window is not defined` failures instead of a refusal. This is the verdict
    // the same invocation gets once the root config is in play, i.e. the reason
    // the fix belongs in the script and not in a new package-local config.
    const verdict = evaluateVitestInvocation({
      argv: argvForScript('vitest run'),
      cwd: path.join(repoRoot, RUNNER_DIR),
      repoRoot,
    });

    expect(verdict?.code).toBe('package-cwd');
  });
});

describe('objectui#3746 — the hijackable-entry population must not grow', () => {
  const bareEntries = entries
    .filter((e) => e.hasViteConfig && !e.hasVitestConfig && vitestRootOf(e) !== repoRoot)
    .map((e) => e.dir)
    .sort();

  it('no longer counts runner', () => {
    expect(bareEntries).not.toContain(RUNNER_DIR);
  });

  it('admits no package beyond the recorded baseline', () => {
    // Subset, not equality: objectui#3240 fixing these must keep this green.
    expect(bareEntries.filter((dir) => !BARE_ENTRY_BASELINE.includes(dir))).toEqual([]);
  });
});

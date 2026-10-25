import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; its types are INFERRED by `tsconfig.scripts.json`
// (`allowJs`), so no `@ts-expect-error` here — see objectui#3494.
import { cliHasTestFilters, evaluateVitestInvocation, parseVitestArgv } from '../vitest-invocation-guard.mjs';

/**
 * objectui#8240 — `pnpm --filter @object-ui/console test` collected ZERO test
 * files and exited 1, while the same 89 files were green from the repo root.
 *
 * ## The mechanism, measured at 0fa7a9c83
 *
 * The entry was `vitest run --root ../.. apps/console/`, i.e. the spelling
 * objectui#3240 gave every `packages/*` entry, transplanted to an app. It works
 * for packages and cannot work for an app, and the reason is NOT the `apps/**`
 * line in the root config's `sharedExclude` (the card that reported this said it
 * was; that is wrong, and the control below pins the refutation).
 *
 * Vitest matches a positional filter per project, against each test file's path
 * RELATIVE TO THAT PROJECT'S OWN `dir`, and resolves a relative filter against
 * `process.cwd()` — not against `--root`:
 *
 *     const testFile = relative(dir, t);
 *     const relativePath = f.endsWith('/') ? join(relative(dir, f), '/') : relative(dir, f);
 *     return testFile.includes(f) || testFile.includes(relativePath);
 *
 * For `packages/*` the files are collected by the ROOT-level projects, whose
 * `dir` is the repo root, so `testFile` reads `packages/<pkg>/src/x.test.ts` and
 * the literal `packages/<pkg>/` matches — cwd never enters into it.
 *
 * An app is different: it comes back through the root config's `projects` array
 * as its OWN project rooted at the app directory, so `testFile` reads
 * `src/x.test.tsx` and can never contain `apps/<app>/`. The only branch left is
 * `relative(dir, f)`, and pnpm launches the script with the app directory as
 * cwd, so `apps/console/` resolved to `apps/console/apps/console` — no match,
 * zero files, exit 1.
 *
 * Measured, same head, same vitest root (`RUN v4.1.10 <repo root>` in both), the
 * only variable being cwd:
 *
 *   cwd = apps/console  `vitest run --root ../.. apps/console/`  0 files, exit 1
 *   cwd = repo root     `vitest run apps/console/`              89 files, exit 0
 *   cwd = repo root     `vitest run --project @object-ui/console`
 *                                              89 files, 1069 tests, exit 0
 *
 * ## Why the entry names a PROJECT and why it must also disable passWithNoTests
 *
 * There is no positional that is both cwd-stable and precise for an app, so the
 * entry names the project instead. That trades one hazard for another, and the
 * trade is only safe because both ends are closed:
 *
 *  - a project name that resolves to nothing is loud: vitest throws
 *    `No projects matched the filter "..."` (measured: exit 1);
 *  - but a project that resolves and then globs zero files is SILENT, because
 *    the root config sets `passWithNoTests: !cliHasTestFilters(process.argv)`
 *    and `--project` is a flag, not a positional — so an app entry gets
 *    `passWithNoTests: true`. Measured in a sandbox on the same vitest 4.1.10:
 *    with `passWithNoTests: true` in the config, `--project <empty project>`
 *    exits **0**; adding `--no-passWithNoTests` makes the same run exit **1**.
 *
 * A script that exits 0 having run nothing is strictly worse than the loud
 * exit 1 this card started from, so the negation is load-bearing, not decoration.
 *
 * Reverse verification: restore `"test": "vitest run --root ../.. apps/console/"`
 * and the shape assertions here go red naming `apps/console`; drop just the
 * `--no-passWithNoTests` and the false-green assertion goes red on its own.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APPS_DIR = path.join(repoRoot, 'apps');
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

type AppEntry = {
  /** Repo-relative directory, e.g. `apps/console`. */
  dir: string;
  /** The app's package name, which is also its vitest project name. */
  pkgName: string;
  testScript: string;
};

function readAppEntriesWithTestScript(): AppEntry[] {
  const entries: AppEntry[] = [];
  for (const name of fs.readdirSync(APPS_DIR).sort()) {
    const manifest = path.join(APPS_DIR, name, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    const testScript = pkg.scripts?.test;
    if (!testScript || !pkg.name) continue;
    entries.push({ dir: `apps/${name}`, pkgName: pkg.name, testScript });
  }
  return entries;
}

/** `process.argv` as pnpm hands it to a package script. */
function argvForScript(script: string): string[] {
  const tokens = script.trim().split(/\s+/);
  return ['/usr/bin/node', '/bin/vitest', ...tokens.slice(1)];
}

/** The directory this script makes vitest's ROOT (cwd unless `--root` moves it). */
function vitestRootOf(entry: AppEntry): string {
  const { flags } = parseVitestArgv(argvForScript(entry.testScript));
  const raw = flags['--root'] ?? flags['-r'];
  const cwd = path.join(repoRoot, entry.dir);
  return typeof raw === 'string' ? path.resolve(cwd, raw) : cwd;
}

/** Either accepted spelling of "do not go green on an empty collection". */
function disablesPassWithNoTests(script: string): boolean {
  const { flags } = parseVitestArgv(argvForScript(script));
  return flags['--no-passWithNoTests'] === true || flags['--passWithNoTests'] === 'false';
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

const appEntries = readAppEntriesWithTestScript();
const rootConfig = fs.readFileSync(path.join(repoRoot, 'vitest.config.mts'), 'utf8');

describe('objectui#8240 — apps/* test entries reach their project by NAME, never by path filter', () => {
  it('finds at least one app test entry to check', () => {
    // A zero-hit sweep and a clean sweep are the same output otherwise. The
    // population was measured as exactly one (`apps/console`; `apps/site`
    // declares no `test` script at all) — this fires if it ever empties out.
    expect(appEntries.map((e) => e.dir)).toContain('apps/console');
  });

  for (const entry of appEntries) {
    describe(entry.dir, () => {
      it('is routed back into the repo-root config and passes the invocation guard', () => {
        expect(vitestRootOf(entry)).toBe(repoRoot);
        expect(
          evaluateVitestInvocation({
            argv: argvForScript(entry.testScript),
            cwd: path.join(repoRoot, entry.dir),
            repoRoot,
          })
        ).toBeNull();
      });

      it('names its own project instead of passing a positional path filter', () => {
        const { positionals, flags } = parseVitestArgv(argvForScript(entry.testScript));

        // The regression itself: a positional here is the objectui#8240 shape.
        expect(positionals).toEqual([]);
        // The project name vitest derives for an app is its package name.
        expect(flags['--project']).toBe(entry.pkgName);
      });

      it('is declared as a project by the root config, so the name resolves', () => {
        // `--project` naming nothing is loud (vitest throws), but a red CI run
        // is a worse place to learn it than this file.
        expect(rootConfig).toContain(`./${entry.dir}/vitest.config.ts`);
        expect(fs.existsSync(path.join(repoRoot, entry.dir, 'vitest.config.ts'))).toBe(true);
      });

      it('cannot go green on an empty collection', () => {
        // `--project` is a flag, so the root config's
        // `passWithNoTests: !cliHasTestFilters(process.argv)` resolves to TRUE
        // for this entry. That is precisely the case the explicit negation is
        // here to cover; assert the premise as well as the remedy, so this stops
        // asking for the flag if the premise ever changes.
        expect(cliHasTestFilters(argvForScript(entry.testScript))).toBe(false);
        expect(disablesPassWithNoTests(entry.testScript)).toBe(true);
      });

      it('has test files for that project to collect', () => {
        expect(collectTestFiles(path.join(repoRoot, entry.dir)).length).toBeGreaterThan(0);
      });

      it('could not have been reached by a path filter, whatever the exclude list says', () => {
        // The refutation of the reported mechanism. An app's project is rooted
        // at the app directory, so its files' project-relative paths never
        // contain `apps/<app>/` — the substring branch of vitest's filter match
        // cannot fire, independently of `sharedExclude`. Removing `apps/**`
        // from that list would therefore not have fixed anything, and is exactly
        // what the card asked nobody to do.
        const appDir = path.join(repoRoot, entry.dir);
        const files = collectTestFiles(appDir);
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
          expect(path.relative(appDir, file)).not.toContain(`${entry.dir}/`);
        }

        // Control that fires: the same paths taken relative to the REPO ROOT do
        // contain it, which is why the identical spelling works for packages/*.
        for (const file of files) {
          expect(path.relative(repoRoot, file)).toContain(`${entry.dir}/`);
        }
      });
    });
  }
});

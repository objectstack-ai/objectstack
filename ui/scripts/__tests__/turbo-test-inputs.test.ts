import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  globToRegExp,
  packagesWithScript,
  rel,
  repoFilesOnDisk,
  rootAnchoredInputs,
} from './helpers/turbo-inputs';
import {
  CONFIG_FILES,
  outOfPackageFiles,
  resolveConfigFile,
} from './helpers/vitest-config-program';

/**
 * objectui#4178 — turbo's `test` task has the same out-of-package `inputs` hole
 * that objectui#3514 closed for `type-check`, and it has it worse.
 *
 * Turbo hashes a task from its `inputs`. `$TURBO_DEFAULT$` covers only files
 * inside the package directory, and `globalDependencies` holds no source file — so any file
 * the task reads from elsewhere in the repo is invisible to the cache key. When
 * such a file changes, turbo does not re-run the task; it REPLAYS the previous
 * verdict. Before this guard, EVERY entry in the `test` task's list was
 * package-relative:
 *
 *     "inputs": ["src/**", "test/**", "tests/**", "vitest.config.*",
 *                "vitest.setup.*", "tsconfig*.json", "package.json",
 *                "$TURBO_DEFAULT$", and two negated markdown globs]
 *
 * (The two negations are spelled out in `turbo.json`, not here: a `!` glob of
 * that shape carries the character pair that ENDS a block comment, and a
 * docblock that terminates early takes the rest of itself down with it —
 * `tsconfig.scripts.json` carries the same warning for the same reason.)
 *
 * `vitest.config.*` and `vitest.setup.*` read as if they covered the Vitest
 * configuration. They do not: they resolve inside the package, while the files
 * that actually decide how a package's tests run live at the repo root. Every
 * package reaches them. Since objectui#3240 it reaches them BY NAME: every
 * package's `test` script is `vitest run --root ../.. packages/<pkg>/`, so the
 * resolution starts at the repo root and lands on `vitest.config.mts` directly.
 * Before that it arrived by the walk — a two-line re-export in
 * `packages/core/vitest.config.ts`, or, for a package with no config of its own
 * (`packages/app-shell`), Vitest looking for `vitest.config.*` / `vite.config.*`
 * in each directory from its root upward and taking the first hit.
 *
 * Measured on `main` at eb5f8cea0, `@object-ui/core#test`:
 *
 *     baseline                                  2e2087e2c30ef125
 *     after touching vitest.config.mts          2e2087e2c30ef125   <- frozen
 *     after touching vitest.setup.base.ts       2e2087e2c30ef125   <- frozen
 *     after touching vitest.setup.dom.tsx       2e2087e2c30ef125   <- frozen
 *     after touching scripts/vitest-invocation-guard.mjs
 *                                               2e2087e2c30ef125   <- frozen
 *     after touching packages/core/src/index.ts 55923ba1954a7352   (control)
 *
 * Worse than the `type-check` instance in two ways. A package's `type-check`
 * reaches out only where a tsconfig says so, whereas every package's test run
 * goes through the shared Vitest configuration by construction. And the root
 * config is not passive data: it calls `assertCanonicalVitestInvocation` from
 * `scripts/vitest-invocation-guard.mjs`, which decides whether a run is
 * REFUSED at all (objectui#3378 / objectui#3288). A stale replay of a `test`
 * task is a replay of that judgement too.
 *
 * So this defect DERIVES its requirement rather than restating it, the way the
 * `type-check` sibling does — but from a different program, and by a different
 * mechanism. The derivation lives in `./helpers/vitest-config-program.ts`,
 * which assembles each package's Vitest configuration program: the config file
 * Vitest resolves for its `test` script, that program's transitive relative
 * imports, and the files it designates through file-valued Vitest options.
 * That module's docblock carries the mechanism and its stated narrowings; this
 * file carries only the policy over the result.
 *
 * The policy: every file in that program that lands outside the package
 * directory must be matched by a `$TURBO_ROOT$` input, or this test reds naming
 * the package, the file, and the entry to add. Two assertions police the
 * reverse direction (an entry matching nothing on disk, an entry no program
 * requires any more), one pins the derivation's own liveness, and two pin the
 * config-resolution premise the whole sweep rests on.
 *
 * The turbo-side plumbing is shared with the sibling guard via
 * `./helpers/turbo-inputs.ts`; only the derivation differs, and it differs in
 * kind.
 */

/** The turbo task this guard is about. */
const TASK = 'test';

/**
 * `$TURBO_ROOT$` inputs for `test` that are deliberately NOT derivable from any
 * package's Vitest configuration program, each with the reason it cannot be.
 *
 * Empty, and worth keeping that way: an entry nothing derives is an entry
 * nobody can verify, and a glob that matches nothing at all reads as coverage
 * while providing none.
 */
const INPUTS_NOT_DERIVABLE: ReadonlyMap<string, string> = new Map();

// ── The derivation, computed once ───────────────────────────────────────────

const PACKAGES = packagesWithScript(TASK);
const DERIVED = PACKAGES.map((pkg) => ({ ...pkg, outside: outOfPackageFiles(pkg) }));
const ROOT_INPUTS = rootAnchoredInputs(TASK);
const MATCHERS = ROOT_INPUTS.map((glob) => ({ glob, re: globToRegExp(glob) }));

describe('turbo `test` inputs cover every out-of-package file (objectui#4178)', () => {
  /**
   * The guard's own liveness. Every assertion below is vacuously true if the
   * sweep found no packages or no out-of-package files — and a sweep that
   * silently degrades to nothing is precisely the failure this file exists to
   * make impossible.
   */
  it('sweeps the whole workspace and finds a non-empty out-of-package set', () => {
    expect(PACKAGES.length).toBeGreaterThan(20);
    const reaching = DERIVED.filter((pkg) => pkg.outside.length > 0);
    expect(
      reaching.map((pkg) => pkg.name),
      'no package configuration program reaches outside its directory — the derivation has ' +
        'stopped working. Since objectui#3240 EVERY package reaches outside: each test script ' +
        'is `vitest run --root ../.. <pkgdir>/`, so the config it resolves is the repo-root ' +
        'vitest.config.mts, which is outside every package directory by construction',
    ).not.toHaveLength(0);
  });

  it.each(DERIVED.filter((pkg) => pkg.outside.length > 0).map((pkg) => [pkg.name, pkg] as const))(
    '%s',
    (_name, pkg) => {
      const uncovered = pkg.outside.filter((file) => !MATCHERS.some(({ re }) => re.test(file)));
      expect(
        uncovered,
        `${pkg.name}'s Vitest configuration program reads ${uncovered.join(', ')} from outside ` +
          `${rel(pkg.dir)}, and turbo hashes ${TASK} from ${JSON.stringify(ROOT_INPUTS)} plus the ` +
          `package directory. Turbo will replay a stale verdict when ${uncovered.length === 1 ? 'that file changes' : 'those files change'}. ` +
          `Add ${uncovered.map((file) => `"$TURBO_ROOT$/${file}"`).join(', ')} to turbo.json's ` +
          `\`${TASK}\` inputs.`,
      ).toEqual([]);
    },
  );

  /**
   * The other direction. A `$TURBO_ROOT$` entry matching nothing is not
   * harmless: it reads as coverage, survives review, and quietly stops covering
   * the file it was written for the moment that file is renamed.
   */
  it('every $TURBO_ROOT$ input matches at least one file on disk', () => {
    const onDisk = repoFilesOnDisk();
    for (const { glob, re } of MATCHERS) {
      expect(
        [...onDisk].some((file) => re.test(file)),
        `turbo.json \`${TASK}\` input "$TURBO_ROOT$/${glob}" matches no file in the repo. It is ` +
          `hashing nothing while reading as coverage — fix the glob or delete the entry.`,
      ).toBe(true);
    }
  });

  /**
   * And the entry is not merely non-empty but actually earned: some package's
   * program reads a file it matches. This is what keeps the list SHRINKING —
   * when a program stops reaching out, its input entry has to go with it.
   */
  it('every $TURBO_ROOT$ input is required by some package program', () => {
    const derivedFiles = [...new Set(DERIVED.flatMap((pkg) => pkg.outside))];
    for (const { glob, re } of MATCHERS) {
      if (INPUTS_NOT_DERIVABLE.has(glob)) continue;
      expect(
        derivedFiles.filter((file) => re.test(file)),
        `turbo.json \`${TASK}\` input "$TURBO_ROOT$/${glob}" is not required by any package's ` +
          `Vitest configuration program any more. Delete it, or record why it cannot be derived ` +
          `in INPUTS_NOT_DERIVABLE.`,
      ).not.toHaveLength(0);
    }
  });

  /**
   * The derivation's own premise, pinned against the real Vitest.
   *
   * Everything above rests on "a package with no config of its own resolves
   * upward to the repo-root one". That is not documented API — it is
   * `any(configFiles, { cwd: root })` in Vitest's `createVitest`. If a future
   * Vitest stops walking up, every configless package's derived set silently
   * becomes empty and this guard goes quiet without a single red test. Pin the
   * two halves that would break: the candidate ORDER (a package holding both
   * `vitest.config.ts` and `vite.config.ts` must derive from the former) and
   * the upward walk itself.
   */
  // All three pins below root the resolution at the PACKAGE DIRECTORY
  // explicitly rather than deriving it from the package's `test` script. Since
  // objectui#3240 every one of those scripts names `--root ../..`, so a pin
  // driven from them would assert `vitest.config.mts` for the trivial reason
  // that the script already said so — a control that has stopped controlling.
  // The candidate walk still decides which config a bare `pnpm exec vitest`
  // typed inside a package picks up, which is what the invocation guard's
  // route 4 rests on, so it is still worth pinning; it just has to be asked
  // directly now.
  // `CONFIG_FILES` is the FULL candidate list — `vitest.config.*` AND
  // `vite.config.*`, in Vitest's own precedence order. The two pins below need
  // the halves apart, so name the vitest-only spellings once here.
  const VITEST_ONLY_CONFIG_FILES = CONFIG_FILES.filter((name) =>
    name.startsWith('vitest.config.'),
  );

  it('resolves a configless package upward to the repo-root config', () => {
    const configless = PACKAGES.find(
      (pkg) => !CONFIG_FILES.some((name) => fs.existsSync(path.join(pkg.dir, name))),
    );
    expect(configless, 'no configless package left to pin the upward walk with').toBeTruthy();
    expect(rel(resolveConfigFile({ root: configless!.dir, config: null })!)).toBe(
      'vitest.config.mts',
    );
  });

  it('prefers vitest.config.* over vite.config.* in the same directory', () => {
    const both = PACKAGES.find(
      (pkg) =>
        fs.existsSync(path.join(pkg.dir, 'vitest.config.ts')) &&
        fs.existsSync(path.join(pkg.dir, 'vite.config.ts')),
    );
    expect(both, 'no package holds both config spellings any more').toBeTruthy();
    expect(rel(resolveConfigFile({ root: both!.dir, config: null })!)).toBe(
      `${rel(both!.dir)}/vitest.config.ts`,
    );
  });

  it('falls back to vite.config.* where a package has no vitest config', () => {
    // The other half of the same premise, and the half objectui#3240 turned on:
    // with the per-package vitest configs deleted, THIS is the file a
    // package-cwd run now resolves to. It is a build config, which is why every
    // one of them calls the invocation guard — pinned in
    // scripts/__tests__/vitest-invocation-guard.test.ts.
    const viteOnly = PACKAGES.find(
      (pkg) =>
        !VITEST_ONLY_CONFIG_FILES.some((name) => fs.existsSync(path.join(pkg.dir, name))) &&
        fs.existsSync(path.join(pkg.dir, 'vite.config.ts')),
    );
    expect(viteOnly, 'no vite-config-only package left to pin the fallback with').toBeTruthy();
    expect(rel(resolveConfigFile({ root: viteOnly!.dir, config: null })!)).toBe(
      `${rel(viteOnly!.dir)}/vite.config.ts`,
    );
  });
});

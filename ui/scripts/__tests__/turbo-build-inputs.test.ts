import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  globToRegExp,
  packagesWithScript,
  rel,
  repoFilesOnDisk,
  rootAnchoredInputs,
  taskInputs,
} from './helpers/turbo-inputs';
import { VITE_CONFIG_FILES, buildProgramFor } from './helpers/build-program';
import { CONFIG_FILES as VITEST_CONFIG_FILES } from './helpers/vitest-config-program';

/**
 * objectui#4185 — turbo's `build` task has the same out-of-package `inputs`
 * hole that objectui#3514 closed for `type-check`, objectui#4178 closed for
 * `test` and objectui#4184 closes for `lint`. This is the fourth instance and
 * the one with the widest blast radius.
 *
 * Turbo hashes a task from its `inputs`. `$TURBO_DEFAULT$` covers only files
 * inside the package directory, and `globalDependencies` holds no source file — so any file
 * the task reads from elsewhere in the repo is invisible to the cache key. When
 * such a file changes, turbo does not re-run the task; it REPLAYS the previous
 * verdict. `build` declared no `inputs` AT ALL, so it ran on that default,
 * while:
 *
 *  - 14 packages build with a bare `tsc` whose `tsconfig.json` extends the
 *    repo-root `tsconfig.json` (and `examples/byo-backend-console` extends the
 *    root `tsconfig.tier-base.json`). Compiler options are as load-bearing as
 *    source: flipping `strict` there changes every package's output.
 *  - `apps/console`'s `vite.config.ts` imports `../../scripts/vite-crypto-stub.ts`
 *    and `../../scripts/vite-maplibre-worker.ts`. `type-check` covers those;
 *    `build`, the task that actually RUNS that Vite config, did not.
 *
 * Measured on `main` at 2b9428338:
 *
 *     @object-ui/core#build      baseline                     3f85d1417964dce6
 *                                after touching tsconfig.json 3f85d1417964dce6  <- frozen
 *                                after touching tsconfig.tier-base.json
 *                                                             3f85d1417964dce6  <- frozen
 *     @object-ui/console#build   baseline                     a17b12650e52ce28
 *                                after touching
 *                                scripts/vite-crypto-stub.ts  a17b12650e52ce28  <- frozen
 *
 * `.github/workflows/ci.yml` and `.github/workflows/performance-budget.yml`
 * both run `turbo run build` with `.turbo/cache` persisted through
 * `actions/cache`, so the stale verdict travels between runs. And `build` is
 * the task every other task consumes: `test` and `type-check` both declare
 * `dependsOn: ["^build"]`, so a `dist/` replayed from a cache key that ignored
 * a root-tsconfig change is handed to everything downstream.
 *
 * The derivation lives in `./helpers/build-program.ts`. Unlike its three
 * siblings it is a UNION rather than one walk, because `build` scripts are not
 * uniform — they are `&&` chains over tsc, `vite build`, `tsup`, `next build`,
 * `node <script>`, `tsx <script>` and `pnpm <script>`, and each tool reads its
 * own config. That module's docblock carries the mechanism and its stated
 * narrowings; this file carries only the policy over the result.
 *
 * The policy is the family's: every out-of-package file must be matched by a
 * `$TURBO_ROOT$` input, two assertions police the reverse direction, one pins
 * the sweep's liveness, one pins that the new explicit list did not narrow what
 * the old default covered, and two pin premises the sweep rests on.
 */

/** The turbo task this guard is about. */
const TASK = 'build';

/**
 * `$TURBO_ROOT$` inputs for `build` that are deliberately NOT derivable from
 * any package's build program, each with the reason it cannot be.
 *
 * Empty, and worth keeping that way: an entry nothing derives is an entry
 * nobody can verify, and a glob that matches nothing at all reads as coverage
 * while providing none.
 */
const INPUTS_NOT_DERIVABLE: ReadonlyMap<string, string> = new Map();

// ── The derivation, computed once ───────────────────────────────────────────

const PACKAGES = packagesWithScript(TASK);
const DERIVED = PACKAGES.map((pkg) => ({ ...pkg, program: buildProgramFor(pkg) }));
const ROOT_INPUTS = rootAnchoredInputs(TASK);
const MATCHERS = ROOT_INPUTS.map((glob) => ({ glob, re: globToRegExp(glob) }));

describe('turbo `build` inputs cover every out-of-package file (objectui#4185)', () => {
  /**
   * The guard's own liveness. Every assertion below is vacuously true if the
   * sweep found no packages or no out-of-package files — and a sweep that
   * silently degrades to nothing is precisely the failure this file exists to
   * make impossible.
   */
  it('sweeps the whole workspace and finds a non-empty out-of-package set', () => {
    expect(PACKAGES.length).toBeGreaterThan(20);
    const reaching = DERIVED.filter((pkg) => pkg.program.outside.length > 0);
    expect(
      reaching.map((pkg) => pkg.name),
      'no package build program reaches outside its directory — the derivation has stopped ' +
        'working, because at minimum packages/core/tsconfig.json extends ../../tsconfig.json',
    ).not.toHaveLength(0);
  });

  it.each(
    DERIVED.filter((pkg) => pkg.program.outside.length > 0).map(
      (pkg) => [pkg.name, pkg] as const,
    ),
  )('%s', (_name, pkg) => {
    const uncovered = pkg.program.outside.filter(
      (file) => !MATCHERS.some(({ re }) => re.test(file)),
    );
    expect(
      uncovered,
      `${pkg.name}'s build program reads ${uncovered.join(', ')} from outside ${rel(pkg.dir)}, ` +
        `and turbo hashes ${TASK} from ${JSON.stringify(ROOT_INPUTS)} plus the package ` +
        `directory. Turbo will replay a stale verdict — and hand the stale dist/ to every task ` +
        `that depends on it — when ${uncovered.length === 1 ? 'that file changes' : 'those files change'}. ` +
        `Add ${uncovered.map((file) => `"$TURBO_ROOT$/${file}"`).join(', ')} to turbo.json's ` +
        `\`${TASK}\` inputs.`,
    ).toEqual([]);
  });

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
    const derivedFiles = [...new Set(DERIVED.flatMap((pkg) => pkg.program.outside))];
    for (const { glob, re } of MATCHERS) {
      if (INPUTS_NOT_DERIVABLE.has(glob)) continue;
      expect(
        derivedFiles.filter((file) => re.test(file)),
        `turbo.json \`${TASK}\` input "$TURBO_ROOT$/${glob}" is not required by any package's ` +
          `build program any more. Delete it, or record why it cannot be derived in ` +
          `INPUTS_NOT_DERIVABLE.`,
      ).not.toHaveLength(0);
    }
  });

  /**
   * Declaring `inputs` on a task that had none is itself a behaviour change,
   * and it can only be a SAFE one if the explicit list still contains the
   * default it replaced. The card raised exactly this worry; this makes it
   * mechanical rather than a review note.
   */
  it('the explicit inputs list still carries $TURBO_DEFAULT$', () => {
    expect(
      taskInputs(TASK),
      `turbo.json \`${TASK}\` declares an explicit inputs list, so it no longer falls back to ` +
        `turbo's default. Without "$TURBO_DEFAULT$" in the list the package's OWN source stops ` +
        `being hashed — which would be a far larger source of stale builds than the hole this ` +
        `guard closes.`,
    ).toContain('$TURBO_DEFAULT$');
  });

  /**
   * A `pnpm --filter <pkg> build` segment inside a `prebuild` is a task-GRAPH
   * fact, not an inputs fact: the right answer to "this build needs that
   * package's dist" is `dependsOn: ["^build"]`, which turbo already declares
   * and derives from the dependency graph. A hand-written chain is a SECOND,
   * unchecked copy of the package's own `dependencies` — and it drifts:
   * objectui#7292 measured `packages/components`' three-package `prebuild`
   * against the seven-package closure turbo computes, and a clean worktree's
   * `pnpm --filter @object-ui/components build` died inside `@object-ui/react`
   * on the two packages the list had never gained.
   *
   * The predecessor of this assertion policed the survivors (each delegated
   * package must be a declared dependency). That is the weaker guard: a
   * delegation whose target IS declared still duplicates the graph, still
   * drifts, and still fails only on the trees nobody looks at. So this ratchets
   * the class to zero instead. The derivation still COLLECTS delegations —
   * that is what makes re-introducing one fail here rather than silently widen
   * an unswept build program.
   */
  it('no build lifecycle script delegates to another package with `pnpm --filter`', () => {
    const delegating = DERIVED.filter((pkg) => pkg.program.delegations.length > 0);
    expect(
      delegating.map((pkg) => `${pkg.name} -> ${pkg.program.delegations.join(', ')}`),
      'a build lifecycle script builds another workspace package through `pnpm --filter`. ' +
        "That hand-writes a copy of this package's build closure next to the `dependencies` " +
        'turbo already derives it from, and the two drift silently — the copy is only ever ' +
        'exercised on a tree where the missing packages happen to be built already. Declare ' +
        "the dependency in package.json and let turbo's `dependsOn: [\"^build\"]` order it; " +
        'build the package with `turbo run build --filter=<pkg>`, not `pnpm --filter <pkg> ' +
        'build`.',
    ).toEqual([]);
  });

  /**
   * The premise that separates this derivation from its `test` sibling: Vite
   * resolves its config in the project directory ONLY (`loadConfigFromFile`
   * loops `DEFAULT_CONFIG_FILES` over `configRoot` with no upward step), and
   * `vite.config.*` is the only spelling it looks for — whereas Vitest walks UP
   * and prefers `vitest.config.*`. `packages/components` holds both files, so
   * it builds from one and tests from the other. If a future Vite started
   * walking up, a configless package's build program would silently gain files
   * this derivation never reports; if it started reading `vitest.config.*`,
   * every dual-config package would derive the wrong program.
   */
  it('a package holding both spellings builds from vite.config.*, not vitest.config.*', () => {
    const both = PACKAGES.find(
      (pkg) =>
        VITE_CONFIG_FILES.some((name) => fs.existsSync(path.join(pkg.dir, name))) &&
        VITEST_CONFIG_FILES.filter((name) => name.startsWith('vitest.')).some((name) =>
          fs.existsSync(path.join(pkg.dir, name)),
        ),
    );
    expect(both, 'no package holds both config spellings any more').toBeTruthy();
    expect(buildProgramFor(both!).configFiles.map(rel)).toContain(
      `${rel(both!.dir)}/vite.config.ts`,
    );
  });
});

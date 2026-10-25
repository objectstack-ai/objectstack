import { describe, expect, it } from 'vitest';
import {
  globToRegExp,
  packagesWithScript,
  rel,
  repoFilesOnDisk,
  rootAnchoredInputs,
} from './helpers/turbo-inputs';
import { outOfPackageFiles } from './helpers/tsc-program';

/**
 * objectui#3514 — turbo's `type-check` `inputs` list is hand-maintained, and it
 * has now been wrong twice for the same structural reason: a package's tsc
 * program reaches OUTSIDE its own package directory.
 *
 * Turbo hashes a task from its `inputs`. `$TURBO_DEFAULT$` covers only files
 * inside the package directory, and `globalDependencies` holds no source file — so any file
 * the program reads from elsewhere in the repo is invisible to the cache key.
 * When such a file changes, turbo does not re-run the task; it REPLAYS the
 * previous verdict. That is a gate whose answer depends on cache state rather
 * than on the code, which is the "looks like enforcement, isn't" failure class
 * this repo has already paid for repeatedly (objectui#3009, objectui#3181,
 * objectui#3494). It is not local-only either: `.github/workflows/ci.yml`
 * persists `.turbo/cache` through `actions/cache`, so one poisoned entry rides
 * into later runs.
 *
 * The two known drifts:
 *
 *  1. `apps/console`'s `tsconfig.node.json` lists `../../scripts/vite-*.ts` —
 *     closed by hand with a `$TURBO_ROOT$/scripts/vite-*.ts` entry.
 *  2. objectui#3476 / PR #3513 added `../../vitest.config.mts` to that same
 *     project, and the `inputs` list did not follow. Measured on that branch: a
 *     real `TS2769` planted in the root config replayed `FULL TURBO` green.
 *     Closed by hand again, with `$TURBO_ROOT$/vitest.config.mts`.
 *
 * Two hand-fixes for one structural cause is this repo's threshold for a gate,
 * so this file DERIVES the requirement instead of restating it. It walks every
 * workspace package's real type-check program the way `tsc` itself assembles it
 * — the projects the `type-check` script actually drives, their `include`/
 * `files` root set, the configs they `extends`, and (for `tsc -b`) their project
 * references — collects every file that lands outside the package directory,
 * and asserts turbo's `inputs` cover each one. A THIRD instance of this class
 * cannot land quietly: a new out-of-package include with no matching input goes
 * red naming the file.
 *
 * The derivation immediately found a third instance, wider than the two known
 * ones: nearly every package's `tsconfig.json` extends the repo-root
 * `tsconfig.json` (and `examples/byo-backend-console` extends the root
 * `tsconfig.tier-base.json`), and neither was in `inputs`. Compiler options are as
 * load-bearing as source — flipping `strict` there changes every package's
 * verdict — so those two entries ship with this guard.
 *
 * Scope, stated so the narrowing is visible rather than assumed:
 *
 *  - ROOT FILES, not the import closure. This asserts over the files tsc is
 *    given (config `include`/`files`/`extends`/`references`), not over every
 *    module they transitively import. Building 40+ real programs to resolve
 *    imports needs a built workspace and minutes of CPU per run. The narrowing
 *    is sound for the failure it guards: a composite project must list every
 *    file in its program, which is exactly why both known drifts were `include`
 *    entries in the first place.
 *  - Cross-package references are still checked. If one package's program
 *    reaches into another package's directory, that is reported like any other
 *    out-of-package file rather than waved through on the assumption that
 *    turbo's `dependsOn: ["^build"]` covers it — `^build` covers declared
 *    DEPENDENCIES, and a tsconfig reference is not required to be one.
 *
 * The turbo-side plumbing this file used to carry inline — workspace discovery,
 * reading `$TURBO_ROOT$` entries out of `turbo.json`, and matching an input
 * glob — now lives in `./helpers/turbo-inputs.ts`, shared with the sibling
 * guards `turbo-test-inputs.test.ts` (objectui#4178), `turbo-lint-inputs.test.ts`
 * (objectui#4184) and `turbo-build-inputs.test.ts` (objectui#4185) — the same
 * defect on the `test`, `lint` and `build` tasks. Only the DERIVATION differs
 * between them, and it differs in kind: tsc programs here, Vitest configuration
 * programs there, an ESLint flat-config program for `lint`, and a union of all
 * of those for `build`. Two copies of a glob matcher whose whole doctrine is
 * "never approximate toward a match" is exactly the drift none of them would
 * survive.
 *
 * The tsc derivation itself moved out for the same reason when `build` came to
 * need it: it is `./helpers/tsc-program.ts` now, and that module's docblock
 * carries the mechanism and its narrowings. This file carries only the policy
 * over the result.
 */

/** The turbo task this guard is about. */
const TASK = 'type-check';

/**
 * `$TURBO_ROOT$` inputs that are deliberately NOT derivable from any package's
 * tsconfig, each with the reason it cannot be.
 *
 * Keep it as short as the measurement allows: an entry nothing derives is an
 * entry nobody can verify, and a glob that matches nothing at all reads as
 * coverage while providing none — the precise shape of the phantom
 * `vitest.setup.ts` include objectui#3476 found in
 * `apps/console/tsconfig.node.json`. The "matches at least one file on disk"
 * assertion below still holds every entry here, so a renamed file goes red.
 *
 * The entries below are objectui#12222's, and they are the header's "ROOT
 * FILES, not the import closure" narrowing coming due. Until that card the
 * narrowing cost nothing in CI: every `type-check` dependsOn the root task
 * `//#type-check:e2e`, whose default inputs were every tracked file in the
 * repository, so any commit moved every package's hash and the cache never
 * replayed a verdict — stale or fresh. Once the root task hashes only its own
 * program, a file a program reaches through an IMPORT (not through a tsconfig
 * root) is invisible to the hash unless it is listed. Each file here was read
 * by a real program under `tsc --listFilesOnly` (every package's `type-check`
 * projects, on the card's branch) and lies outside both the package and its
 * dependency closure, which `^build` already hashes; the derivation in this
 * file cannot see an import, which is why they are listed rather than derived.
 */
const IMPORT_CLOSURE_READ = 'read through an import, not a tsconfig root (objectui#12222)';
const INPUTS_NOT_DERIVABLE: ReadonlyMap<string, string> = new Map([
  // `packages/app-shell` tsconfig.test.json — a test imports the console's preflight.
  ['apps/console/src/lib/auth-preflight.ts', IMPORT_CLOSURE_READ],
  // `apps/console` tsconfig.json — a test imports the lint rule it pins.
  ['eslint-rules/no-unprefixed-query-params.js', IMPORT_CLOSURE_READ],
  // `packages/components` tsconfig.test.json — a test imports the CLI generator.
  ['packages/cli/src/commands/generate.ts', IMPORT_CLOSURE_READ],
  // `examples/schema-catalog` tsconfig.test.json — tests import the CLI's
  // authoring face (which imports the next two) and two doc gates.
  ['packages/cli/src/utils/authoring-face.ts', IMPORT_CLOSURE_READ],
  ['packages/cli/src/utils/issue-path.ts', IMPORT_CLOSURE_READ],
  ['packages/cli/src/utils/union-arm-diagnostics.ts', IMPORT_CLOSURE_READ],
  ['scripts/check-doc-component-types.mjs', IMPORT_CLOSURE_READ],
  ['scripts/markdown-fence-scan.mjs', IMPORT_CLOSURE_READ],
]);

// ── The derivation, computed once ────────────────────────────────────────────

const PACKAGES = packagesWithScript(TASK);
const DERIVED = PACKAGES.map((pkg) => ({ ...pkg, outside: outOfPackageFiles(pkg.dir, pkg.script) }));
const ROOT_INPUTS = rootAnchoredInputs(TASK);
const MATCHERS = ROOT_INPUTS.map((glob) => ({ glob, re: globToRegExp(glob) }));

describe('turbo `type-check` inputs cover every out-of-package file (objectui#3514)', () => {
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
      'no package program reaches outside its directory — the derivation has stopped working, ' +
        'because at minimum apps/console lists ../../scripts/vite-*.ts',
      ).not.toHaveLength(0);
  });

  it.each(DERIVED.filter((pkg) => pkg.outside.length > 0).map((pkg) => [pkg.name, pkg] as const))(
    '%s',
    (_name, pkg) => {
      const uncovered = pkg.outside.filter((file) => !MATCHERS.some(({ re }) => re.test(file)));
      expect(
        uncovered,
        `${pkg.name}'s type-check program reads ${uncovered.join(', ')} from outside ` +
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
          `type-check program any more. Delete it, or record why it cannot be derived in ` +
          `INPUTS_NOT_DERIVABLE.`,
      ).not.toHaveLength(0);
    }
  });
});

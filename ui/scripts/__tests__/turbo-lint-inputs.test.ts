import { describe, expect, it } from 'vitest';
import { uiTurboConfigPath } from '../workspace-root.mjs';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ESLint } from 'eslint';
import {
  globToRegExp,
  packagesWithScript,
  rel,
  repoFilesOnDisk,
  repoRoot,
  rootAnchoredInputs,
  taskInputs,
} from './helpers/turbo-inputs';
import { walkedFiles } from '../check-lint-rule-coverage.mjs';
import {
  FLAT_CONFIG_FILENAMES,
  configFilesFor,
  outOfPackageFiles,
  programFilesFor,
} from './helpers/eslint-config-program';

/**
 * objectui#4184 — turbo's `lint` task has the same out-of-package `inputs` hole
 * that objectui#3514 closed for `type-check` and objectui#4178 closed for
 * `test`, and it is the starkest of the three.
 *
 * Turbo hashes a task from its `inputs`. `$TURBO_DEFAULT$` covers only files
 * inside the package directory, and `globalDependencies` holds no source file — so any file
 * the task reads from elsewhere in the repo is invisible to the cache key. When
 * such a file changes, turbo does not re-run the task; it REPLAYS the previous
 * verdict. `lint` declared no `inputs` AT ALL, so it ran on that default:
 *
 *     "lint": { "outputs": [], "cache": true }
 *
 * while every package's `lint` script is `eslint .` reading one config that
 * lives outside every package — the repo-root flat config `eslint.config.js`.
 * Measured on `main` at 2b9428338, `@object-ui/core#lint`:
 *
 *     baseline                                  79872f192ee4828c
 *     after touching eslint.config.js           79872f192ee4828c   <- frozen
 *     after touching eslint-rules/index.js      79872f192ee4828c   <- frozen
 *     after touching packages/core/src/index.ts 5127842ced6c29b3   (control)
 *
 * And unlike the `test` instance, this one is live in CI today:
 * `.github/workflows/lint.yml` runs `turbo run lint` and persists `.turbo/cache`
 * through `actions/cache`, so one poisoned entry rides into later runs. The
 * concrete failure is that adding or tightening an ESLint rule can land, go
 * green on cached verdicts computed BEFORE the rule existed, and never run
 * against the code it was written for — the repo's four `object-ui/*` ratchets
 * (objectui#2879, objectui#3010, objectui#3090, ADR-0054 Phase 5) are exactly
 * the kind of rule that fails this way, silently.
 *
 * So this guard DERIVES its requirement rather than restating it, the way both
 * siblings do. The derivation lives in `./helpers/eslint-config-program.ts`,
 * which assembles each package's ESLint flat-config program: the config ESLint
 * resolves for its `lint` script, plus that config's transitive relative
 * imports — which is how `eslint-rules/index.js` and the four local rule
 * implementations enter the program. That module's docblock carries the
 * mechanism and its stated narrowings (`files` / `ignores` select subjects
 * rather than name program files; `node_modules` plugins are tracked by the
 * lockfile; type-aware linting is pinned as absent rather than assumed). This
 * file carries only the policy over the result.
 *
 * The policy: every file in that program landing outside the package directory
 * must be matched by a `$TURBO_ROOT$` input, or this test reds naming the
 * package, the file, and the entry to add. Two assertions police the reverse
 * direction, one pins the sweep's liveness, one pins that the new explicit list
 * did not narrow what the old default covered, and three pin the
 * config-resolution premises the whole sweep rests on.
 */

/** The turbo task this guard is about. */
const TASK = 'lint';

/**
 * `$TURBO_ROOT$` inputs for `lint` that are deliberately NOT derivable from any
 * package's ESLint program, each with the reason it cannot be.
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

describe('turbo `lint` inputs cover every out-of-package file (objectui#4184)', () => {
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
      'no package ESLint program reaches outside its directory — the derivation has stopped ' +
        'working, because the repo holds exactly one flat config and it is at the root, so ' +
        'EVERY package must reach it',
    ).not.toHaveLength(0);
  });

  it.each(DERIVED.filter((pkg) => pkg.outside.length > 0).map((pkg) => [pkg.name, pkg] as const))(
    '%s',
    (_name, pkg) => {
      const uncovered = pkg.outside.filter((file) => !MATCHERS.some(({ re }) => re.test(file)));
      expect(
        uncovered,
        `${pkg.name}'s ESLint flat-config program reads ${uncovered.join(', ')} from outside ` +
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
          `ESLint flat-config program any more. Delete it, or record why it cannot be derived ` +
          `in INPUTS_NOT_DERIVABLE.`,
      ).not.toHaveLength(0);
    }
  });

  /**
   * Declaring `inputs` on a task that had none is itself a behaviour change,
   * and it can only be a SAFE one if the explicit list still contains the
   * default it replaced. Drop `$TURBO_DEFAULT$` and the package's own source
   * stops being hashed — which would turn a guard against stale greens into a
   * far larger source of them.
   */
  it('the explicit inputs list still carries $TURBO_DEFAULT$', () => {
    expect(
      taskInputs(TASK),
      `turbo.json \`${TASK}\` declares an explicit inputs list, so it no longer falls back to ` +
        `turbo's default. Without "$TURBO_DEFAULT$" in the list the package's OWN files stop ` +
        `being hashed.`,
    ).toContain('$TURBO_DEFAULT$');
  });

  /**
   * The derivation's premises, pinned against the real ESLint.
   *
   * ESLint 10 looks a config up from each LINTED FILE's directory upward
   * (`findUp(FLAT_CONFIG_FILENAMES)` in `ConfigLoader.locateConfigFileToUse`),
   * while this derivation searches once from the lint TARGET's directory. The
   * two coincide only while the repo holds exactly one flat config, at the
   * root. Pin that, so a package-local `eslint.config.js` goes red here and the
   * derivation gets taught, instead of silently under-reporting the program of
   * every package underneath it.
   */
  it('the repo holds exactly one flat config, at the root', () => {
    const onDisk = [...repoFilesOnDisk()].filter((file) =>
      FLAT_CONFIG_FILENAMES.includes(path.basename(file)),
    );
    expect(
      onDisk.sort(),
      'a second flat config exists, so ESLint 10 per-file lookup can pick a config this ' +
        "derivation's per-target lookup never sees. Teach eslint-config-program.ts to search " +
        'from each linted file rather than from the lint target.',
    ).toEqual(['eslint.config.js']);

    const resolved = [...new Set(DERIVED.flatMap((pkg) => configFilesFor(pkg).map(rel)))];
    expect(resolved, 'every package must resolve that same root config').toEqual([
      'eslint.config.js',
    ]);
  });

  it('resolves a package with no config of its own upward to the repo-root config', () => {
    const configless = PACKAGES.find(
      (pkg) => !FLAT_CONFIG_FILENAMES.some((name) => fs.existsSync(path.join(pkg.dir, name))),
    );
    expect(configless, 'no configless package left to pin the upward walk with').toBeTruthy();
    expect(configFilesFor(configless!).map(rel)).toEqual(['eslint.config.js']);
  });

  /**
   * Type-aware linting would put tsconfig files into the lint program, and this
   * derivation does not follow them — see the helper's docblock. Rather than
   * leave that as an unstated assumption, assert it: switching on
   * `parserOptions.project` (or `projectService`) reds here with the
   * instruction, instead of quietly under-covering `lint`'s inputs.
   */
  it('no config in the lint program enables type-aware linting', () => {
    const offenders: string[] = [];
    for (const file of new Set(DERIVED.flatMap((pkg) => programFilesFor(pkg)))) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isPropertyAssignment(node) &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
          (node.name.text === 'project' || node.name.text === 'projectService')
        ) {
          offenders.push(`${rel(file)}: ${node.name.text}`);
        }
        node.forEachChild(visit);
      };
      visit(source);
    }
    expect(
      offenders,
      'a config in the lint program sets `project` / `projectService`, which makes ESLint read ' +
        'tsconfig files as part of the lint program. Teach eslint-config-program.ts to walk the ' +
        'tsconfig chain (./helpers/tsc-program.ts already does it for `type-check` and `build`) ' +
        'before turning this on, or those tsconfigs go unhashed exactly as eslint.config.js did.',
    ).toEqual([]);
  });
});

/**
 * objectui#12276 — the root task `lint` depends on hashes what it LINTS, not the
 * repository.
 *
 * Every package's `lint` dependsOn `//#lint:root` (objectui#4456), and turbo
 * folds a dependency's hash into its dependents'. The root task stays uncached
 * (`turbo-task-guard-coverage.test.ts` says why), so its `inputs` decide nothing
 * but that inherited hash — and with none, turbo hashed every file in the
 * repository for it. Measured on that card, before the fix: one untracked file
 * under `docs/` moved 46 of 46 package `lint` hashes, so the cache `Lint`
 * restores could never replay a single package. After it, on the same probe: 0
 * of 46; an untracked `.changeset/` or `content/` file, 0; a file in one
 * package, that package's alone; a root-level linted file (`scripts/`, `e2e/`)
 * or `eslint.config.js`, all 46 — readings of that day, not live counts.
 *
 * The inputs are the extensions ESLint lints at that scope, minus exactly the
 * trees the `lint:root` script hands ESLint as `--ignore-pattern`, so they
 * follow the script rather than a list of root directories that a new one would
 * outdate. Plus one exclusion that is turbo's, not ESLint's: under explicit
 * `inputs` turbo hashes git-ignored files as well (measured on that card: 64008
 * inputs, 63598 of them under the root `node_modules`), which `$TURBO_DEFAULT$`
 * never does.
 *
 * ⚠️ Bound, said so it is not read as coverage: turbo adds the root
 * `package.json` and `turbo.json` to a root task's inputs on its own, so an
 * edit to either still moves every package's `lint` hash. And a git-ignored
 * output directory with linted extensions outside the four trees (a local
 * `coverage/`, say) is hashed too; none exists when `Lint` runs `pnpm lint`.
 */
describe('`//#lint:root` hashes the files it lints, never the whole repository (objectui#12276)', () => {
  const ROOT_TASK = '//#lint:root';
  const turbo = JSON.parse(fs.readFileSync(uiTurboConfigPath(), 'utf8')) as {
    tasks: Record<string, { cache?: boolean; dependsOn?: string[]; inputs?: string[] }>;
  };
  const inputs = turbo.tasks[ROOT_TASK]?.inputs ?? [];
  const include = inputs.filter((glob) => !glob.startsWith('!')).map((glob) => globToRegExp(glob));
  const exclude = inputs.filter((glob) => glob.startsWith('!')).map((glob) => globToRegExp(glob.slice(1)));
  /** Turbo's rule: a file is an input when some glob names it and no `!` glob removes it. */
  const hashed = (file: string): boolean => include.some((re) => re.test(file)) && !exclude.some((re) => re.test(file));

  const script = (
    JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  ).scripts['lint:root'];
  const ignorePatterns = [...(script ?? '').matchAll(/--ignore-pattern\s+'([^']+)'/g)].map((m) => m[1]);

  it('is what every package `lint` depends on, so its hash is in all of theirs', () => {
    expect(turbo.tasks.lint?.dependsOn ?? [], 'the premise of this block').toContain(ROOT_TASK);
    expect(script, 'the root package.json must still define `lint:root`').toMatch(/^eslint \. /);
    expect(ignorePatterns, 'the `lint:root` ignore-pattern parse came back empty').toContain('docs/**');
  });

  it('declares inputs, and `$TURBO_DEFAULT$` is not one of them', () => {
    expect(
      inputs,
      `\`${ROOT_TASK}\` declares no \`inputs\`, so turbo hashes every file in the repository for it — ` +
        'and every package’s `lint` inherits that hash, so no commit can replay a cached lint.',
    ).not.toHaveLength(0);
    expect(inputs, '`$TURBO_DEFAULT$` on a root task is the whole repository again').not.toContain(
      '$TURBO_DEFAULT$',
    );
  });

  it('excludes exactly the trees the `lint:root` script ignores, and node_modules', () => {
    const negations = inputs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
    expect(
      negations.sort(),
      'the `!` inputs must be the `lint:root` script’s `--ignore-pattern` values, so a file in a tree ' +
        'that script never lints cannot move every package’s lint hash, plus `**/node_modules/**`, ' +
        'which turbo would otherwise hash',
    ).toEqual([...ignorePatterns, '**/node_modules/**'].sort());
    for (const probe of ['node_modules/x/index.js', 'scripts/node_modules/y/index.mjs', 'docs/z.ts']) {
      expect(hashed(probe), `${probe} must not be a \`${ROOT_TASK}\` input`).toBe(false);
    }
  });

  it('hashes every file ESLint lints at the `lint:root` scope', async () => {
    const eslint = new ESLint({ cwd: repoRoot, ignorePatterns });
    const walked = await walkedFiles(repoRoot, eslint);
    expect(walked.length, 'the `lint:root` walk found implausibly few files').toBeGreaterThan(100);
    expect(walked, 'the walk must reach the root config and a root script').toEqual(
      expect.arrayContaining(['eslint.config.js', 'scripts/report-turbo-cache.mjs']),
    );
    const unhashed = walked.filter((file) => !hashed(file));
    expect(
      unhashed,
      `files \`lint:root\` lints that \`${ROOT_TASK}\`'s inputs do not name — an edit to them would ` +
        'not move the hash its dependents inherit:\n' +
        unhashed.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);

    const linted = new Set(walked.map((file) => path.extname(file)));
    const beyond = [...repoFilesOnDisk()].filter((file) => hashed(file) && !linted.has(path.extname(file)));
    expect(
      beyond,
      `\`${ROOT_TASK}\`'s inputs reach files of an extension \`lint:root\` never lints, and each one ` +
        'moves every package’s lint hash when it changes:\n' +
        beyond.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('stays uncached, so its inputs scope a hash and never a replayed verdict', () => {
    expect(turbo.tasks[ROOT_TASK]?.cache).toBe(false);
  });
});

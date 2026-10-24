import fs from 'node:fs';
import path from 'node:path';
import { outOfPackageProgramFiles, programFiles } from './config-program';
import { rel, repoRoot, type WorkspacePackage } from './turbo-inputs';

/**
 * Derives a workspace package's **ESLint flat-config program** — the set of
 * files ESLint reads in order to know what linting that package even means.
 *
 * The third instance of the objectui#3514 class (objectui#4184), and the
 * starkest: turbo's `lint` task declared no `inputs` at all, so it ran on
 * `$TURBO_DEFAULT$`, which covers only files inside the package directory —
 * while the file that IS the lint program, the repo-root `eslint.config.js`,
 * lives outside every package. Change a rule there and no package's `lint` hash
 * moves; turbo replays the previous verdict instead of re-running.
 *
 * ## The program
 *
 *  1. The flat config ESLint resolves for the package's `lint` script,
 *     following the script's own `--config` / `--no-config-lookup` and then
 *     ESLint's upward search.
 *  2. Every file that config statically imports by RELATIVE specifier,
 *     transitively. That second step is not a formality here: `eslint.config.js`
 *     imports `./eslint-rules/index.js`, which imports the four local rule
 *     implementations, and those rule bodies decide what the ratchets
 *     (`object-ui/no-synthetic-event-trigger`, `no-try-catch-around-hook`,
 *     `no-inline-spec-config`, `no-dynamic-import-in-test-hook`) actually
 *     reject. A rule implementation is as load-bearing as the config line that
 *     switches it on, and neither was hashed.
 *
 * The walk is the shared one in `./config-program.ts`; what lives here is only
 * which file ESLint starts from.
 *
 * ## Narrowings specific to this derivation
 *
 *  - `files` / `ignores` ARE NOT PROGRAM FILES. A flat config's `files` and
 *    `ignores` are globs that SELECT what gets linted; the selected files are
 *    ESLint's subject, not its program, and they live inside the package where
 *    `$TURBO_DEFAULT$` already hashes them. The root config's
 *    `files: ['packages/types/src/objectql.ts']` block looks like a
 *    counter-example and is not one: when `@object-ui/types` is linted that
 *    path is inside the package, and when any other package is linted the
 *    selector simply matches nothing. Treating a selector as a program file
 *    would make every package's lint program claim to read every other
 *    package's source — which is the alias-closure mistake the sibling guards
 *    also decline to make.
 *  - PLUGINS AND SHAREABLE CONFIGS FROM `node_modules` ARE NOT FOLLOWED
 *    (`typescript-eslint`, `eslint-plugin-react-hooks`, `@eslint/js`). Those
 *    are external dependencies, which turbo tracks through the lockfile rather
 *    than through a task's `inputs`. Only this repo's own files are at stake.
 *  - TYPE-AWARE LINTING IS NOT MODELLED, because this repo does not use it.
 *    A `languageOptions.parserOptions.project` (or `projectService`) would put
 *    tsconfig files into the lint program, and the derivation would have to
 *    grow a tsc walker to follow them. Rather than leave that as an assumption,
 *    the guard PINS it: `../turbo-lint-inputs.test.ts` asserts no config in the
 *    program enables type-aware linting, so switching it on goes red here with
 *    the instruction, instead of silently under-covering.
 */

/**
 * ESLint's flat-config candidates, in its own precedence order.
 *
 * Mirrors `FLAT_CONFIG_FILENAMES` in `eslint/lib/config/config-loader.js`
 * (eslint 10.8.0), which is handed to `find-up` — so the search is
 * directory-first: walk up from the start directory and, in each directory,
 * take the first name in THIS order that exists.
 */
export const FLAT_CONFIG_FILENAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];

/**
 * ESLint flat config has no option whose value names a file the config itself
 * reads — `files` / `ignores` select subjects, and plugins arrive as imported
 * objects rather than as paths. Declared explicitly, and empty, so that the
 * shared walker's key-directed designation rule is visibly a decision here
 * rather than an omission.
 */
export const FILE_VALUED_OPTIONS: ReadonlySet<string> = new Set<string>();

export interface EslintInvocation {
  /** Directories the lint run starts its config search from. */
  readonly startDirs: readonly string[];
  /** An explicit `--config`, already resolved; `null` means "search". */
  readonly config: string | null;
  /** `--no-config-lookup` disables the search entirely. */
  readonly lookup: boolean;
}

/**
 * The ESLint invocation a package's `lint` script performs.
 *
 * Every shape in the repo today is a single `eslint <target>` — `eslint .` for
 * 44 packages and `eslint src` for `@object-ui/cli`. A script running a lint
 * command this parser cannot read throws rather than being skipped: an
 * unparsed script is an unswept program, and this guard's whole value is that
 * it cannot quietly sweep nothing.
 */
export function invocationFor(pkgDir: string, script: string): EslintInvocation {
  const commands = script
    .split('&&')
    .map((segment) => segment.trim())
    .filter((command) => /(?:^|\s)eslint(?:\s|$)/.test(command));

  if (commands.length !== 1) {
    throw new Error(
      `${rel(pkgDir)}: \`${script}\` does not run exactly one \`eslint\` command ` +
        `(found ${commands.length}). Teach invocationFor() how to read it — do not let the ` +
        `sweep skip this package.`,
    );
  }

  const tokens = commands[0].split(/\s+/);
  let config: string | null = null;
  let lookup = true;
  const targets: string[] = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const [flag, inlineValue] = token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, null];
    if (flag === '--config' || flag === '-c') config = inlineValue ?? tokens[++i];
    else if (flag === '--no-config-lookup') lookup = false;
    else if (flag.startsWith('-')) {
      // A flag this parser does not know may or may not take a value, so the
      // token stream cannot be read past it with confidence.
      throw new Error(
        `${rel(pkgDir)}: \`${commands[0]}\` passes ${JSON.stringify(flag)}, a flag ` +
          `invocationFor() does not know. Teach it rather than letting the targets be misread.`,
      );
    } else targets.push(token);
  }

  // `eslint` with no target lints the cwd, which is the package directory.
  const startDirs = (targets.length > 0 ? targets : ['.']).map((target) => {
    const resolved = path.resolve(pkgDir, target);
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      ? resolved
      : path.dirname(resolved);
  });

  return { startDirs, config: config === null ? null : path.resolve(pkgDir, config), lookup };
}

/**
 * The flat config ESLint loads for a lint run started in `startDir`.
 *
 * Reproduces `findUp(FLAT_CONFIG_FILENAMES, { cwd: fromDirectory })` from
 * `ConfigLoader.locateConfigFileToUse` — walk UP, and in each directory take
 * the first name in `FLAT_CONFIG_FILENAMES` order that exists.
 *
 * ESLint 10 looks the config up from each LINTED FILE's directory rather than
 * once from the cwd, so strictly this models the shallowest start point of that
 * per-file search. The two coincide here because the repo holds exactly one
 * flat config — a fact `../turbo-lint-inputs.test.ts` asserts rather than
 * assumes, so a package-local `eslint.config.js` goes red and this derivation
 * gets taught before it can under-report.
 *
 * The walk stops at the repo root: a config above it is not this repo's.
 */
export function resolveConfigFile(invocation: EslintInvocation, startDir: string): string | null {
  if (invocation.config !== null) {
    if (!fs.existsSync(invocation.config)) {
      throw new Error(`--config names ${rel(invocation.config)}, which does not exist.`);
    }
    return invocation.config;
  }
  if (!invocation.lookup) return null;

  let dir = startDir;
  for (;;) {
    for (const name of FLAT_CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    if (dir === repoRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Every flat config file a package's lint run resolves, absolute and sorted. */
export function configFilesFor(pkg: WorkspacePackage): string[] {
  const invocation = invocationFor(pkg.dir, pkg.script);
  const configs = new Set<string>();
  for (const startDir of invocation.startDirs) {
    const resolved = resolveConfigFile(invocation, startDir);
    if (resolved !== null) configs.add(resolved);
  }
  return [...configs].sort();
}

/** Every file a package's ESLint flat-config program reads, absolute and sorted. */
export function programFilesFor(pkg: WorkspacePackage): string[] {
  const entries = configFilesFor(pkg);
  if (entries.length === 0) return [];
  return programFiles({
    tool: 'ESLint',
    entries,
    pkgDir: pkg.dir,
    fileValuedOptions: FILE_VALUED_OPTIONS,
  });
}

/**
 * Every file a package's ESLint flat-config program reads from outside the
 * package directory, repo-relative and sorted.
 */
export function outOfPackageFiles(pkg: WorkspacePackage): string[] {
  const entries = configFilesFor(pkg);
  if (entries.length === 0) return [];
  return outOfPackageProgramFiles({
    tool: 'ESLint',
    entries,
    pkgDir: pkg.dir,
    fileValuedOptions: FILE_VALUED_OPTIONS,
  });
}

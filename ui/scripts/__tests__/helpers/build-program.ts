import fs from 'node:fs';
import path from 'node:path';
import { outOfPackageProgramFiles } from './config-program';
import {
  invocationForCommand,
  outOfPackageFilesFor,
  type TscInvocation,
} from './tsc-program';
import { rel, repoRoot, type WorkspacePackage } from './turbo-inputs';

/**
 * Derives a workspace package's **build program** — the set of files the tools
 * its `build` script drives read in order to know what to produce.
 *
 * The fourth instance of the objectui#3514 class (objectui#4185), and the one
 * with the widest blast radius: `build` declared no `inputs` at all, and `build`
 * is the task whose `dist/` every other task consumes through
 * `dependsOn: ["^build"]`. A build replayed from a cache key that ignored a
 * `strict` flip in the root `tsconfig.json` hands stale `dist/` to everything
 * downstream.
 *
 * ## Why this derivation is a union rather than one walk
 *
 * `type-check` scripts are all tsc and `test` scripts are all Vitest, so each of
 * those guards derives one kind of program. `build` scripts are not uniform —
 * they are `&&` chains over five tools:
 *
 *     tsc                     14 packages      the tsc program (./tsc-program.ts)
 *     vite build              22 packages      the Vite config program
 *     tsup                     4 packages      the tsup config program + its tsconfig
 *     next build               1 app           the Next config program + its tsconfig
 *     node <script>            2 packages      the script and what it imports
 *     tsx <script>             (as node)       the script and what it imports
 *     pnpm <script>            1 app           the same package's other script
 *
 * So a segment is classified by the tool it runs, and each tool contributes
 * whatever IT reads. A segment running a command this module cannot classify
 * throws rather than being skipped: an unclassified segment is an unswept
 * program, and this guard's whole value is that it cannot quietly sweep
 * nothing.
 *
 * The relative-import walk over the resolved config files is the shared one in
 * `./config-program.ts`; the tsc side is the shared walker in `./tsc-program.ts`
 * that objectui#3514's guard also uses. What lives here is only which file each
 * tool starts from.
 *
 * ## Narrowings specific to this derivation
 *
 *  - A BUNDLER PLUGIN'S OWN FILE READS ARE NOT MODELLED. `vite-plugin-dts`
 *    builds a tsc program from the package's `tsconfig.json`, so a `vite build`
 *    package does transitively read the root tsconfig that one extends. Chasing
 *    that would mean reproducing each plugin's version-specific default for
 *    where its config lives — a derivation that drifts silently the next time a
 *    plugin changes its defaults, which is the failure mode of the thing being
 *    guarded. It is left out deliberately, and the cost is measured rather than
 *    assumed: turbo `inputs` are TASK-wide, not per-package, so an entry earned
 *    by one package covers the task for all of them — and
 *    `$TURBO_ROOT$/tsconfig.json` is earned many times over by the 14 packages
 *    whose build IS a tsc run. The narrowing changes which packages the guard
 *    NAMES, not which files the task hashes.
 *  - POSTCSS CONFIG DISCOVERY IS NOT MODELLED, and this one is a KNOWN BLIND
 *    SPOT rather than a safe narrowing, so it is written down here and filed
 *    (objectui#4198) rather than left for the next reader to rediscover. Vite
 *    hands CSS to `postcss-load-config`, which searches UPWARD from the Vite
 *    root — so a package that processes CSS through Vite and has no
 *    `postcss.config.*` of its own would read the nearest one ABOVE its
 *    directory, which this derivation neither walks nor hashes.
 *    NO SUCH FILE EXISTS TODAY: every tracked `postcss.config.*` sits inside
 *    the package that uses it, and the repo-root `postcss.config.mjs` that
 *    used to sit above them all was deleted by objectui#4065 (PR #4349), so
 *    the upward walk currently arrives at nothing. That retires the INSTANCE,
 *    not the gap — nothing in this derivation would notice the next config to
 *    appear at the root, or in any directory above a CSS-building package.
 *    Two further facts, both measured and both COINCIDENCES rather than
 *    structural guarantees, keep the walk short even if one did appear. Every
 *    vite-build package that processes CSS (`apps/console`,
 *    `packages/components`, `packages/runner`, the two console examples)
 *    carries its own postcss config, which stops the upward walk in its own
 *    directory; `packages/fields` is the only one without a config, and its
 *    single `src/index.css` never enters the Vite graph — nothing imports it,
 *    because `scripts/build-css.mjs` compiles it separately with an explicit
 *    plugin list. Both would have to hold for a re-introduced config to stay
 *    harmless: an `import './index.css'` added to `packages/fields/src`, plus
 *    any `postcss.config.*` above that package, would pull it into the build
 *    program, turbo would not hash it, and this guard would not notice.
 *  - NO FILE-VALUED OPTIONS. Unlike a Vitest config, nothing in this repo's
 *    build configs names a program file through a string literal: entries are
 *    spelled `resolve(__dirname, 'src/index.tsx')`, which is an expression, and
 *    every out-of-package reach is an `import` instead
 *    (`apps/console/vite.config.ts` importing the two `scripts/vite-*.ts`
 *    plugins). Declared explicitly, and empty, so the shared walker's
 *    key-directed designation rule is visibly a decision here.
 *  - A `pnpm --filter <pkg> build` SEGMENT IS A TASK-GRAPH FACT, NOT AN INPUTS
 *    FACT. The right answer to "this package's build needs that package's dist"
 *    is turbo's `dependsOn: ["^build"]`, not a `$TURBO_ROOT$` glob over another
 *    package's source. So delegations are collected and returned rather than
 *    walked. NO PACKAGE DELEGATES TODAY (objectui#7292 deleted the last two:
 *    `packages/components` hand-listed types/core/react in a `prebuild` while
 *    its real closure was seven packages, and `apps/site` named the schema
 *    catalog it already declares as a dependency), and
 *    `../turbo-build-inputs.test.ts` now RATCHETS that to zero rather than
 *    policing the survivors: a hand-written list of a package's own build
 *    closure is a second, unchecked copy of its `dependencies`, and the
 *    collected `delegations` are what makes re-introducing one fail loudly.
 */

/** Vite's config candidates, in its own precedence order. */
export const VITE_CONFIG_FILES = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
];

/** tsup's config candidates, in its own precedence order. */
export const TSUP_CONFIG_FILES = [
  'tsup.config.ts',
  'tsup.config.cts',
  'tsup.config.mts',
  'tsup.config.js',
  'tsup.config.cjs',
  'tsup.config.mjs',
];

/** Next's config candidates. */
export const NEXT_CONFIG_FILES = [
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'next.config.cjs',
  'next.config.mts',
  'next.config.cts',
];

/**
 * Nothing in this repo's build configs designates a program file through a
 * string literal — see the docblock's second narrowing.
 */
export const FILE_VALUED_OPTIONS: ReadonlySet<string> = new Set<string>();

export interface BuildProgram {
  /** Tool config files the script drives, absolute — the walk's entry points. */
  readonly configFiles: string[];
  /** tsc projects the script drives, for the shared tsconfig walker. */
  readonly tscInvocations: TscInvocation[];
  /** Workspace packages this build delegates to through `pnpm --filter`. */
  readonly delegations: string[];
  /** Files the program reads from outside the package, repo-relative, sorted. */
  readonly outside: string[];
}

/** Split a command into tokens, with `--flag=value` kept as one token. */
function tokenize(command: string): string[] {
  return command.trim().split(/\s+/);
}

/** The value of `--flag value` / `--flag=value`, or null. */
function flagValue(tokens: string[], names: string[]): string | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const [flag, inline] = token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, null];
    if (names.includes(flag)) return inline ?? tokens[i + 1] ?? null;
  }
  return null;
}

/**
 * The first config name in `candidates` that exists in `dir`.
 *
 * Vite and Next both resolve their config in the project directory only —
 * Vite's `loadConfigFromFile` loops `DEFAULT_CONFIG_FILES` over `configRoot`
 * with no upward step, which is the opposite of Vitest's behaviour and the
 * reason `packages/components` builds from `vite.config.ts` while its tests run
 * from `vitest.config.ts`.
 */
function firstIn(dir: string, candidates: string[]): string | null {
  for (const name of candidates) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * tsup resolves its config by walking UP from the cwd (joycon, `stopDir` at the
 * filesystem root), taking the first name in `TSUP_CONFIG_FILES` order in each
 * directory, and also accepting a `package.json` carrying a `tsup` key. The
 * walk stops at the repo root here: a config above it is not this repo's.
 */
function resolveTsupConfig(fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const found = firstIn(dir, TSUP_CONFIG_FILES);
    if (found !== null) return found;
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { tsup?: unknown };
      if (parsed.tsup !== undefined) {
        throw new Error(
          `${rel(manifest)} configures tsup through a \`tsup\` package.json key. ` +
            `Teach buildProgramFor() to read it — a JSON config is not walked by the ` +
            `TypeScript-parser-based import walk.`,
        );
      }
    }
    if (dir === repoRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The package's own `tsconfig.json`, if it has one — what tsup and Next read. */
function conventionalTsconfig(pkgDir: string, named: string | null): TscInvocation | null {
  const project = path.resolve(pkgDir, named ?? 'tsconfig.json');
  if (!fs.existsSync(project)) return null;
  return { project, build: false };
}

interface Accumulator {
  readonly configFiles: Set<string>;
  readonly tscInvocations: TscInvocation[];
  readonly delegations: Set<string>;
  readonly seenScripts: Set<string>;
}

/** Classify one `&&` segment of a build script and record what it reads. */
/**
 * `NAME=value` words at the head of a command are the shell's environment
 * assignments for the program that follows, not the program:
 * `NODE_OPTIONS=--max-old-space-size=4096 tsc` is a tsc run under a larger V8
 * heap (the spelling `packages/spec` in objectstack uses), so the classification
 * below starts at the first word that is not an assignment. A value may itself
 * contain `=`; only the first `=` splits the name, and a name is a shell
 * identifier (objectstack#25685 item 4).
 */
export function stripEnvAssignments(tokens: readonly string[]): string[] {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  return tokens.slice(i);
}

function collectSegment(pkg: WorkspacePackage, command: string, acc: Accumulator): void {
  const tokens = stripEnvAssignments(tokenize(command));
  const tool = tokens[0];
  if (tool === undefined) {
    throw new Error(`${rel(pkg.dir)}: \`${command}\` sets environment variables and runs nothing.`);
  }

  if (tool === 'tsc') {
    acc.tscInvocations.push(invocationForCommand(pkg.dir, command));
    return;
  }

  if (tool === 'vite' && tokens[1] === 'build') {
    const named = flagValue(tokens, ['--config', '-c']);
    const root = flagValue(tokens, ['--root', '-r']);
    const configRoot = path.resolve(pkg.dir, root ?? '.');
    const config =
      named !== null ? path.resolve(configRoot, named) : firstIn(configRoot, VITE_CONFIG_FILES);
    if (config === null) {
      throw new Error(
        `${rel(pkg.dir)}: \`${command}\` finds no Vite config in ${rel(configRoot)}. Vite does ` +
          `not search upward, so this build has no config at all — teach buildProgramFor() if ` +
          `that is intentional.`,
      );
    }
    if (!fs.existsSync(config)) {
      throw new Error(`${rel(pkg.dir)}: \`${command}\` names ${rel(config)}, which does not exist.`);
    }
    acc.configFiles.add(config);
    return;
  }

  if (tool === 'tsup') {
    const config = resolveTsupConfig(pkg.dir);
    if (config !== null) acc.configFiles.add(config);
    // tsup's declaration step compiles with `options.tsconfig || "tsconfig.json"`
    // resolved from the package directory, so the tsconfig chain is part of the
    // build program exactly as it is for a bare `tsc`.
    const tsconfig = conventionalTsconfig(pkg.dir, flagValue(tokens, ['--tsconfig']));
    if (tsconfig !== null) acc.tscInvocations.push(tsconfig);
    return;
  }

  if (tool === 'next' && tokens[1] === 'build') {
    const config = firstIn(pkg.dir, NEXT_CONFIG_FILES);
    if (config !== null) acc.configFiles.add(config);
    const tsconfig = conventionalTsconfig(pkg.dir, null);
    if (tsconfig !== null) acc.tscInvocations.push(tsconfig);
    return;
  }

  // `tsx SCRIPT` is node with a TypeScript loader: it reads the script and
  // whatever the script imports, exactly as `node SCRIPT` does, so it takes the
  // same branch rather than a copy of it (objectui#11403).
  if (tool === 'node' || tool === 'tsx') {
    const script = tokens.slice(1).find((token) => !token.startsWith('-'));
    if (script === undefined) {
      throw new Error(`${rel(pkg.dir)}: \`${command}\` runs ${tool} with no script to walk.`);
    }
    const resolved = path.resolve(pkg.dir, script);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `${rel(pkg.dir)}: \`${command}\` runs ${rel(resolved)}, which does not exist.`,
      );
    }
    acc.configFiles.add(resolved);
    return;
  }

  if (tool === 'pnpm') {
    const filtered = flagValue(tokens, ['--filter', '-F']);
    if (filtered !== null) {
      acc.delegations.add(filtered);
      return;
    }
    const name = tokens.slice(1).find((token) => !token.startsWith('-') && token !== 'run');
    if (name === undefined) {
      throw new Error(`${rel(pkg.dir)}: \`${command}\` runs pnpm with no script to follow.`);
    }
    if (acc.seenScripts.has(name)) return;
    acc.seenScripts.add(name);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pkg.dir, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const delegated = manifest.scripts?.[name];
    if (delegated === undefined) {
      throw new Error(
        `${rel(pkg.dir)}: \`${command}\` runs the \`${name}\` script, which the package does ` +
          `not declare.`,
      );
    }
    collectScript(pkg, delegated, acc);
    return;
  }

  throw new Error(
    `${rel(pkg.dir)}: \`${command}\` runs a tool buildProgramFor() cannot classify. Teach it ` +
      `what that tool reads — an unclassified segment is an unswept program.`,
  );
}

/** Walk every `&&` segment of a script. */
function collectScript(pkg: WorkspacePackage, script: string, acc: Accumulator): void {
  for (const segment of script.split('&&')) {
    const command = segment.trim();
    if (command === '') continue;
    collectSegment(pkg, command, acc);
  }
}

/**
 * The build program of a package: the tool configs its `build` script reads,
 * the tsc projects it drives, the workspace packages it delegates to, and the
 * files all of that reaches outside the package directory.
 *
 * `prebuild` and `postbuild` are included when declared, because pnpm runs them
 * as part of `pnpm run build` and turbo therefore runs them too — leaving them
 * out would let a build read a file the guard never saw.
 */
export function buildProgramFor(pkg: WorkspacePackage): BuildProgram {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkg.dir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const acc: Accumulator = {
    configFiles: new Set<string>(),
    tscInvocations: [],
    delegations: new Set<string>(),
    seenScripts: new Set<string>(['build']),
  };

  for (const name of ['prebuild', 'build', 'postbuild']) {
    const script = name === 'build' ? pkg.script : manifest.scripts?.[name];
    if (script !== undefined) collectScript(pkg, script, acc);
  }

  const configFiles = [...acc.configFiles].sort();
  const outside = new Set<string>([
    ...outOfPackageProgramFiles({
      tool: 'build',
      entries: configFiles,
      pkgDir: pkg.dir,
      fileValuedOptions: FILE_VALUED_OPTIONS,
    }),
    ...outOfPackageFilesFor(pkg.dir, acc.tscInvocations),
  ]);

  return {
    configFiles,
    tscInvocations: acc.tscInvocations,
    delegations: [...acc.delegations].sort(),
    outside: [...outside].sort(),
  };
}

/**
 * Every file a package's build program reads from outside the package
 * directory, repo-relative and sorted.
 */
export function outOfPackageFiles(pkg: WorkspacePackage): string[] {
  return buildProgramFor(pkg).outside;
}

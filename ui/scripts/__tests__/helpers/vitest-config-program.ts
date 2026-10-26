import fs from 'node:fs';
import path from 'node:path';
import { outOfPackageProgramFiles } from './config-program';
import { rel, repoRoot, type WorkspacePackage } from './turbo-inputs';

/**
 * Derives a workspace package's **Vitest configuration program** — the set of
 * files Vitest reads in order to know how that package's tests run.
 *
 * Extracted as its own module rather than folded into the guard that consumes
 * it (`../turbo-test-inputs.test.ts`, objectui#4178) for two reasons. It is a
 * mechanism, not a policy: the guard decides what must be true of the result,
 * this file decides only what the result IS. And a derivation that can only be
 * exercised through the assertions it feeds is a derivation nobody can probe —
 * which is how a sweep quietly degrades to returning nothing while every
 * assertion over it stays green.
 *
 * ## The program
 *
 *  1. The config file Vitest resolves for the package's `test` script,
 *     following the script's own `--root` / `--config` flags and then Vitest's
 *     upward search.
 *  2. Every file that program statically imports by RELATIVE specifier,
 *     transitively.
 *  3. Every file it DESIGNATES through a file-valued Vitest option
 *     (`setupFiles`, `globalSetup`, `projects`, `workspace`) — themselves
 *     walked as program files, which is how `vitest.setup.tsx` pulls in the
 *     `vitest.setup.dom.tsx` it imports, and how the root config's `projects`
 *     entry pulls in `apps/console/vitest.config.ts` and the two
 *     `scripts/vite-*.ts` plugins that one imports.
 *
 * Steps 2 and 3 are the generic walk, shared with the ESLint and build
 * derivations since objectui#4184 / objectui#4185: see `./config-program.ts`,
 * whose docblock carries the narrowings all of them share (bare specifiers not
 * followed, designation key-directed, unresolvable designated paths throw).
 * What is specific to Vitest, and lives here, is only which file the walk
 * STARTS from and which option names designate files.
 *
 * ## Narrowings specific to this derivation
 *
 *  - THE CONFIGURATION PROGRAM, not the module closure of the tests. Vitest
 *    resolves `@object-ui/*` through the root config's alias table straight to
 *    other packages' `src/`, so the true read set of any package's test run is
 *    most of the repository. Requiring that is not a stricter version of this
 *    derivation, it is a different (and wrong) one — turbo's
 *    `dependsOn: ["^build"]` and per-package `$TURBO_DEFAULTimport fs from 'node:fs';
import path from 'node:path';
import { outOfPackageProgramFiles } from './config-program';
import { rel, repoRoot, type WorkspacePackage } from './turbo-inputs';

/**
 * Derives a workspace package's **Vitest configuration program** — the set of
 * files Vitest reads in order to know how that package's tests run.
 *
 * Extracted as its own module rather than folded into the guard that consumes
 * it (`../turbo-test-inputs.test.ts`, objectui#4178) for two reasons. It is a
 * mechanism, not a policy: the guard decides what must be true of the result,
 * this file decides only what the result IS. And a derivation that can only be
 * exercised through the assertions it feeds is a derivation nobody can probe —
 * which is how a sweep quietly degrades to returning nothing while every
 * assertion over it stays green.
 *
 * ## The program
 *
 *  1. The config file Vitest resolves for the package's `test` script,
 *     following the script's own `--root` / `--config` flags and then Vitest's
 *     upward search.
 *  2. Every file that program statically imports by RELATIVE specifier,
 *     transitively.
 *  3. Every file it DESIGNATES through a file-valued Vitest option
 *     (`setupFiles`, `globalSetup`, `projects`, `workspace`) — themselves
 *     walked as program files, which is how `vitest.setup.tsx` pulls in the
 *     `vitest.setup.dom.tsx` it imports, and how the root config's `projects`
 *     entry pulls in `apps/console/vitest.config.ts` and the two
 *     `scripts/vite-*.ts` plugins that one imports.
 *
 * Steps 2 and 3 are the generic walk, shared with the ESLint and build
 * derivations since objectui#4184 / objectui#4185: see `./config-program.ts`,
 * whose docblock carries the narrowings all of them share (bare specifiers not
 * followed, designation key-directed, unresolvable designated paths throw).
 * What is specific to Vitest, and lives here, is only which file the walk
 * STARTS from and which option names designate files.
 *
 * ## Narrowings specific to this derivation
 *
 already answer
 *    source. The failure being guarded is "change the SHARED TEST HARNESS, get
 *    a stale verdict", and the harness is exactly this program.
 *
 *    ⚠️ That sentence is why the `test` task still `dependsOn: ["^build"]`, and
 *    objectui#3240 re-derived the reason rather than inheriting it. The reason
 *    OF RECORD was resolution: each package had its own vitest config with no
 *    alias table, so a test run reached its siblings through their `dist`.
 *    objectui#3240 deleted those configs — every package's `test` script now
 *    runs the root config, whose alias map points at `src`, and CI's `pnpm test`
 *    builds nothing at all — so nothing needs `^build` to RESOLVE any more, and
 *    dropping it looked like free speed. It is not: `^build` is the only edge
 *    that puts a dependency's sources into a dependent's `test` cache key. Drop
 *    it and the narrowing above stops being true — a change under
 *    `packages/core/src` would no longer move `@object-ui/plugin-grid#test`'s
 *    key, and `turbo run test` would replay a stale green over code it never
 *    ran. The edge stays, for the second reason instead of the first.
 *  - The root config holds ~45 concrete test-file paths in `domTsTests` /
 *    `heavyDomTests`; those are `include` / `exclude` inputs to project
 *    definitions, covered by their own packages' inputs — not files this
 *    program reads. That is the key-directed rule in action.
 */

// ── Which config file Vitest actually loads ─────────────────────────────────

/**
 * Vitest's config candidates, in its own precedence order.
 *
 * Mirrors `CONFIG_NAMES` x `CONFIG_EXTENSIONS` from `vitest/dist/chunks/
 * constants.*.js`. The order is load-bearing: `apps/console` has BOTH a
 * `vitest.config.ts` and a `vite.config.ts`, and only the first is the config
 * Vitest reads (the second arrives as one of its imports, which is a different
 * fact). The SECOND name matters more since objectui#3240 deleted the
 * per-package vitest configs: for every `packages/*` the candidate that hits is
 * now `vite.config.ts`, which is why each of those calls the invocation guard.
 */
export const CONFIG_NAMES = ['vitest.config', 'vite.config'];
export const CONFIG_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
export const CONFIG_FILES = CONFIG_NAMES.flatMap((name) =>
  CONFIG_EXTENSIONS.map((extension) => name + extension),
);

/** Re-exported for callers that used to import it from here. */
export { RESOLVE_EXTENSIONS } from './config-program';

/** Vitest options whose value names FILES rather than globs or data. */
export const FILE_VALUED_OPTIONS = new Set(['setupFiles', 'globalSetup', 'projects', 'workspace']);

export interface VitestInvocation {
  /** The directory Vitest treats as its root (`--root`, else the package dir). */
  readonly root: string;
  /** An explicit `--config`, already resolved; `null` means "search". */
  readonly config: string | null;
}

/**
 * The Vitest invocation a package's `test` script performs.
 *
 * Every shape in the repo today is a single `vitest run [flags] [filters]`.
 * A script that runs a test command this parser cannot read throws rather than
 * being skipped: an unparsed script is an unswept program, and this guard's
 * whole value is that it cannot quietly sweep nothing.
 */
export function invocationFor(pkgDir: string, script: string): VitestInvocation {
  const commands = script
    .split('&&')
    .map((segment) => segment.trim())
    .filter((command) => /(?:^|\s)vitest(?:\s|$)/.test(command));

  if (commands.length !== 1) {
    throw new Error(
      `${rel(pkgDir)}: \`${script}\` does not run exactly one \`vitest\` command ` +
        `(found ${commands.length}). Teach invocationFor() how to read it — do not let the ` +
        `sweep skip this package.`,
    );
  }

  const tokens = commands[0].split(/\s+/);
  let root: string | null = null;
  let config: string | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const [flag, inlineValue] = token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, null];
    if (flag === '--root' || flag === '-r') root = inlineValue ?? tokens[++i];
    else if (flag === '--config' || flag === '-c') config = inlineValue ?? tokens[++i];
  }

  const resolvedRoot = path.resolve(pkgDir, root ?? '.');
  return { root: resolvedRoot, config: config === null ? null : path.resolve(resolvedRoot, config) };
}

/**
 * The config file Vitest loads for an invocation.
 *
 * Reproduces `any(configFiles, { cwd: root })` — Vitest walks UP from its root,
 * and in each directory takes the first name in `CONFIG_FILES` order that
 * exists. This is why `packages/app-shell`, which has no config of its own,
 * still runs under the repo-root `vitest.config.mts`; verified against the real
 * binary, which refuses that invocation with the root config's own guard
 * message rather than running configless.
 *
 * The walk stops at the repo root: a config above it is not this repo's.
 */
export function resolveConfigFile(invocation: VitestInvocation): string | null {
  if (invocation.config !== null) {
    if (!fs.existsSync(invocation.config)) {
      throw new Error(`--config names ${rel(invocation.config)}, which does not exist.`);
    }
    return invocation.config;
  }
  let dir = invocation.root;
  for (;;) {
    for (const name of CONFIG_FILES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    if (dir === repoRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Every file a package's Vitest configuration program reads from outside the
 * package directory, repo-relative and sorted.
 */
export function outOfPackageFiles(pkg: WorkspacePackage): string[] {
  const entry = resolveConfigFile(invocationFor(pkg.dir, pkg.script));
  if (entry === null) return [];
  return outOfPackageProgramFiles({
    tool: 'Vitest',
    entries: [entry],
    pkgDir: pkg.dir,
    fileValuedOptions: FILE_VALUED_OPTIONS,
  });
}

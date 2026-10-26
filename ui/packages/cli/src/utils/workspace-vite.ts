/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How the generated temp app resolves its imports when it runs INSIDE this
 * workspace — shared by `dev`, `serve` and `build` (objectui#3890).
 *
 * Outside a workspace the generated `package.json` declares every platform
 * package and the command installs it; inside one, both dependency maps are
 * written empty on purpose and nothing is installed, because the app is created
 * under `<cwd>/.objectui-tmp` and resolves by hoisting (objectui#3742 /
 * objectui#3827). The repo root hoists React and the toolchain, but it declares
 * no `@object-ui/*` at all — `node_modules/@object-ui/` does not exist here — so
 * the ONLY thing that resolves a platform package in a workspace is the alias
 * table below.
 *
 * ## Why the table is derived rather than written out
 *
 * It used to be a hand-kept list of eleven packages in `commands/dev.ts`. A
 * hand-kept list is not a list of what the app imports — it is a list of what
 * the app imports TRANSITIVELY, which is the import graph of every source file
 * of every package already in it. Nothing enforced that, so it drifted, and the
 * drift is silent until a browser opens the page: every module whose transform
 * hits an unlisted specifier answers 500, and the page renders blank.
 *
 * Measured on the commit that filed objectui#3890: the app's own entry names
 * nine packages, whose transitive value-imports close over 21, of which the
 * table held 11. Vite's dependency scan reported only 4 of the 10 missing ones,
 * because a scan stops at the first layer it cannot resolve — which is exactly
 * why backfilling "the missing four" would have left six more behind and the
 * page still blank. Deriving the table from the workspace removes the class:
 * a cross-package import added tomorrow is already covered.
 *
 * ## Completeness is the safe direction
 *
 * The table names every workspace package rather than the reachable subset,
 * because the two errors are not symmetric: an alias for a package nothing
 * imports is inert (an alias only applies to an import that matches it), while
 * a missing alias for a package something imports is a 500. So the rule errs
 * toward listing too much, and the test beside it reconciles the table against
 * `pnpm-workspace.yaml` so a new package cannot be missing from it.
 */

import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

import { globSync } from 'glob';
import { load as loadYaml } from 'js-yaml';

/** The scope whose packages the generated app resolves from workspace source. */
const PLATFORM_SCOPE = '@object-ui/';

/**
 * Extensions probed for a package's source barrel, in Vite's own
 * `resolve.extensions` order.
 *
 * The order matters for the same reason `scripts/__tests__/side-effects-
 * declaration-consistency.test.ts` says it does: barrels in this repo are
 * spelled both `.ts` and `.tsx` (`@object-ui/core` vs `@object-ui/fields`), and
 * assuming either one is what made the entry-inference rule look like a cost of
 * deriving the table. Probing in the resolver's order is not a guess — it is
 * the answer the resolver itself would give.
 */
const BARREL_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx'];

/** Whether `cwd` is a pnpm workspace root, i.e. whether aliasing applies. */
export function isWorkspaceRoot(cwd: string): boolean {
  return existsSync(join(cwd, 'pnpm-workspace.yaml'));
}

/** The `packages:` patterns declared by `pnpm-workspace.yaml`, verbatim. */
function workspacePatterns(cwd: string): string[] {
  const manifestPath = join(cwd, 'pnpm-workspace.yaml');
  if (!existsSync(manifestPath)) return [];
  const parsed = loadYaml(readFileSync(manifestPath, 'utf-8')) as { packages?: unknown } | null;
  const patterns = parsed?.packages;
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((p): p is string => typeof p === 'string');
}

/**
 * Every directory the workspace manifest's patterns match that holds a manifest.
 *
 * Expanded with `glob` rather than a hand-rolled `endsWith('/*')` walk so a
 * workspace spelled with `**` or with a `!` exclusion — both legal pnpm, neither
 * used by this repo today — resolves correctly instead of throwing at a user
 * whose only mistake was a different workspace layout.
 */
export function workspacePackageDirs(cwd: string): string[] {
  const patterns = workspacePatterns(cwd);
  const include = patterns.filter((p) => !p.startsWith('!'));
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
  if (include.length === 0) return [];

  const matches = globSync(include, {
    cwd,
    absolute: true,
    ignore: ['**/node_modules/**', ...exclude]
  });

  return matches
    .filter((dir) => existsSync(join(dir, 'package.json')) && statSync(dir).isDirectory())
    .sort();
}

/** The source barrel inside `srcDir`, or `undefined` when it has none. */
function findSourceBarrel(srcDir: string): string | undefined {
  for (const ext of BARREL_EXTENSIONS) {
    const candidate = join(srcDir, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The `@object-ui/*` alias table, derived from the workspace manifest.
 *
 * Targets the package's `src` DIRECTORY, not the barrel file inside it —
 * matching how every checked-in bundler config in this repo aliases the same
 * packages. A directory target is also the only one that survives a subpath
 * import: an alias replaces the matched prefix, so a file target rewrites
 * `<scope>/<pkg>/<subpath>` into `<barrel-file>/<subpath>`, a path that cannot
 * exist. With a directory the same rewrite lands in the source tree, and Vite
 * resolves the bare specifier through the directory's barrel by itself.
 *
 * A package is included when it exposes a barrel, which is the property that
 * makes it consumable from source at all — `@object-ui/runner` has a `src/` and
 * no barrel, and an alias pointing at it would only turn one resolver error
 * into another.
 */
export function workspaceSourceAliases(cwd: string): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const dir of workspacePackageDirs(cwd)) {
    let name: unknown;
    try {
      name = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { name?: unknown }).name;
    } catch {
      continue;
    }
    if (typeof name !== 'string' || !name.startsWith(PLATFORM_SCOPE)) continue;

    const srcDir = join(dir, 'src');
    if (!existsSync(srcDir) || !findSourceBarrel(srcDir)) continue;

    aliases[name] = srcDir;
  }

  return aliases;
}

/**
 * Where `lucide-react` is resolved from for the temp app.
 *
 * The generated sources import it directly, and inside a workspace the temp app
 * has no `node_modules` of its own while the repo root declares no icon library
 * either — so it is resolved out of `@object-ui/components`, which does declare
 * it.
 *
 * Returns the package ROOT, not the entry file `require.resolve` reports. The
 * entry-file spelling this replaces made the alias hijack every subpath import
 * in the workspace and rewrite it into `<entry-file>/<subpath>`: with the
 * platform packages aliased and their sources finally reachable,
 * `packages/components/src/lib/lazy-icon.tsx` answered 500 for exactly that
 * reason (it imports the library's dynamic-icon subpath). Aliasing the root
 * makes bare and subpath specifiers land on the same directory the importer
 * would have reached without an alias, and lets Vite pick the entry the
 * package's own `exports` names rather than pinning the app to whichever build
 * CommonJS resolution happens to report.
 */
export function resolveLucideAlias(cwd: string): string | undefined {
  const require = createRequire(join(cwd, 'package.json'));
  try {
    return dirname(require.resolve('lucide-react/package.json', { paths: [join(cwd, 'packages/components')] }));
  } catch {
    return undefined;
  }
}

/**
 * The PostCSS plugins the workspace-local temp app is served with.
 *
 * Inside a workspace the generated app installs nothing (it resolves everything
 * by hoisting) and its own `postcss.config.js` is removed, so this is the only
 * thing that compiles its stylesheet. Two things about it are deliberate:
 *
 * 1. **`@tailwindcss/postcss`, not `tailwindcss`.** Tailwind 4 moved the PostCSS
 *    plugin into its own package; calling `tailwindcss()` as a plugin — which
 *    this did until objectui#3852, passing it the generated
 *    `tailwind.config.js` — hits a shim whose only job is to throw ("It looks
 *    like you're trying to use `tailwindcss` directly as a PostCSS plugin"). The
 *    config-file argument goes away with it: v4 is CSS-first and the generated
 *    `src/index.css` carries its own `@source`/`@theme` (see `app-generator.ts`).
 * 2. **Resolved from this CLI, and loud when it cannot be.** Both plugins are
 *    declared by `@object-ui/cli` itself, so a bare `import` finds them wherever
 *    the CLI is installed — rather than depending on what the invoking project
 *    happens to hoist (this repo's root declares `tailwindcss` but NOT
 *    `@tailwindcss/postcss`, so resolving from the cwd cannot work here at all).
 *    A failure throws with the reason attached: the previous `catch` warned one
 *    yellow line and served the app with no stylesheet, which is exactly how a
 *    dead CSS pipeline stayed unnoticed long enough to be filed as
 *    objectui#3852.
 */
export async function loadTempAppPostcssPlugins(): Promise<unknown[]> {
  try {
    const [tailwindPostcss, autoprefixer] = await Promise.all([
      import('@tailwindcss/postcss'),
      import('autoprefixer')
    ]);
    return [tailwindPostcss.default(), autoprefixer.default()];
  } catch (error) {
    // The caught error's message is inlined below. We can't pass it as the
    // `Error` `cause` option because this package targets ES2020, whose lib
    // types the 1-arg `Error` constructor only; hence the scoped disable.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(
      `Failed to load the Tailwind CSS PostCSS pipeline: ${error instanceof Error ? error.message : error}\n` +
        `  Both '@tailwindcss/postcss' and 'autoprefixer' are dependencies of @object-ui/cli — a\n` +
        `  broken install of the CLI is the likeliest cause; reinstall it and try again.\n` +
        `  (Refusing to start unstyled: that failure is silent in the browser.)`
    );
  }
}

/** The Vite settings a temp app needs to run from workspace source. */
export interface WorkspaceViteConfig {
  resolve: { alias: Record<string, string> };
  css: { postcss: { plugins: unknown[] } };
}

/**
 * Everything `dev`, `serve` and `build` must add to their Vite config when the
 * temp app is generated inside a workspace, plus the one file they must remove.
 *
 * Kept as a single call the three commands spread into their config so they
 * cannot drift apart again: `serve` and `build` had no workspace branch at all
 * (objectui#3890), so both were incapable of resolving a platform package here
 * — a defect no amount of correctness in `dev` could cover.
 *
 * The removal is of the generated `postcss.config.js`: the programmatic
 * `css.postcss` returned here takes over (an inline config makes Vite skip
 * config-file discovery entirely), and the generated file names a plugin the
 * temp app never installs inside a workspace, so leaving it for a later Vite
 * pass to find would only reintroduce an unresolvable plugin.
 */
export async function prepareWorkspaceTempApp(cwd: string, tmpDir: string): Promise<WorkspaceViteConfig> {
  const postcssPath = join(tmpDir, 'postcss.config.js');
  if (existsSync(postcssPath)) {
    unlinkSync(postcssPath);
  }

  const alias: Record<string, string> = { ...workspaceSourceAliases(cwd) };
  const lucide = resolveLucideAlias(cwd);
  if (lucide) {
    alias['lucide-react'] = lucide;
  }

  return {
    resolve: { alias },
    css: { postcss: { plugins: await loadTempAppPostcssPlugins() } }
  };
}

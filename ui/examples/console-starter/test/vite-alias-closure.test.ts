/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `vite.config.ts`'s workspace alias table is a hand-written list standing in
 * for a real import graph, and the two drifted apart: five packages the aliased
 * `src` files import were missing from it, so Vite fell back to node resolution
 * and landed on each package's `dist` directory — which exists only after
 * `pnpm -w build`, so a plain `pnpm dev` served 500s behind a blank `#root` with
 * no on-page diagnosis (objectui#3528).
 *
 * This re-derives the graph instead of re-reading the list. It walks the
 * example's own `src/` and follows every relative import and every
 * `@object-ui/*` import into that package's `src`, transitively, and asserts the
 * alias table covers the fixed point. Because it traverses into packages
 * regardless of whether they are aliased today, a missing alias is reported
 * together with everything that alias would have pulled in — adding one entry
 * can never leave a second hole behind.
 *
 * Specifier extraction uses TypeScript's own preprocessor, not a regex. A
 * hand-rolled import regex was tried first and silently under-reported: a lazy
 * middle between `import` and `from` scans across statement boundaries, so the
 * word "import" appearing in ordinary comment prose swallowed the next two real
 * import statements on its way to a later `export ... from`, and two of the five
 * missing packages disappeared from the answer.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(exampleDir, '../..');
const viteConfigPath = path.join(exampleDir, 'vite.config.ts');

/** `'@object-ui/x': path.resolve(__dirname, '../../packages/x/src'),` */
const ALIAS_ENTRY = /'(@object-ui\/[^']+)':\s*path\.resolve\(__dirname,\s*'([^']+)'\)/g;

function readAliasTable(): Map<string, string> {
  const source = fs.readFileSync(viteConfigPath, 'utf8');
  const table = new Map<string, string>();
  for (const m of source.matchAll(ALIAS_ENTRY)) table.set(m[1], path.resolve(exampleDir, m[2]));
  return table;
}

const RESOLVABLE = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function resolveModule(target: string): string | null {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  for (const ext of RESOLVABLE) {
    if (fs.existsSync(target + ext)) return target + ext;
  }
  for (const ext of RESOLVABLE) {
    const indexFile = path.join(target, `index${ext}`);
    if (fs.existsSync(indexFile)) return indexFile;
  }
  // An ESM-correct specifier addresses the EMITTED file: `./Foo.js` is how a
  // package whose build preserves specifiers has to spell `Foo.tsx`, because
  // Node's resolver does not extension-search relative specifiers (objectui#4538,
  // enforced per pull request by `pnpm check:esm-specifiers`). Tried only after
  // every candidate above has failed, so a package that genuinely ships a `.js`
  // next to its TypeScript still resolves to that file and nothing that already
  // resolved changes answer.
  //
  // Load-bearing, and it degraded SILENTLY: the relative branch of the walk
  // drops an unresolvable specifier with no record, so as packages converted to
  // explicit extensions the walk kept shrinking while every assertion stayed
  // green. Measured on `main` before objectui#5357: 236 relative specifiers
  // dropped and 890 files walked, against 1242 once they resolve. Only the
  // `filesWalked` floor could see it, and only once app-shell — the largest
  // package — converted too and took the count to 401.
  const asSource = target.replace(/\.(js|jsx|mjs|cjs)$/, '');
  if (asSource !== target) return resolveModule(asSource);
  return null;
}

/**
 * The spellings a specifier that is *meant to be a module* can end with. Derived
 * from `RESOLVABLE` so the two cannot drift, plus the two TypeScript module
 * extensions that are legal to write but that `resolveModule` never has to
 * probe for (a `.mts` source is imported as `.mjs`).
 */
const MODULE_EXTENSIONS = [...RESOLVABLE, '.mts', '.cts'];

/**
 * Does this relative specifier denote a module the walk is supposed to follow?
 *
 * `ts.preProcessFile` reports EVERY import specifier, including `./styles.css`,
 * `./data.json` and `./logo.svg` — which `resolveModule` deliberately cannot
 * resolve, because its candidate list is JS and TS only. Those are not walk
 * failures, and recording them as such would fail this test for a reason that
 * is not a defect. The closure contains two `.css` imports today, both of which
 * happen to resolve only because `resolveModule` returns any path that exists
 * on disk verbatim; a stylesheet that is virtual, generated, or shipped only in
 * `dist` would land in the miss branch the moment it appeared.
 *
 * So the boundary is drawn on *intent*, not on whether resolution happened to
 * succeed: no extension, or one of the JS/TS emitted extensions, is a module.
 * Anything else is an asset and is skipped EXPLICITLY — recorded in
 * `nonModuleSkipped` rather than dropped — so that the skip stays auditable and
 * this branch can never again go quiet by accident.
 *
 * A specifier carrying a `?query` or `#hash` is a Vite resource specifier
 * (`?raw`, `?url`, `?inline`, `?worker`) rather than a plain module path, and
 * the walk cannot follow it meaningfully — it counts as a non-module skip. The
 * closure contains none today.
 */
function isModuleSpecifier(specifier: string): boolean {
  if (specifier.includes('?') || specifier.includes('#')) return false;
  // `.` and `..` are extensionless directory imports, not an `.`-extension.
  const ext = /\.[a-zA-Z0-9]+$/.exec(specifier)?.[0];
  if (!ext) return true;
  return MODULE_EXTENSIONS.includes(ext.toLowerCase());
}

const packageSrc = (pkg: string) =>
  path.join(repoRoot, 'packages', pkg.slice('@object-ui/'.length), 'src');

const isWorkspacePackage = (pkg: string) => {
  const src = packageSrc(pkg);
  return fs.existsSync(src) && fs.statSync(src).isDirectory();
};

/** `@object-ui/plugin-list/foo` -> `@object-ui/plugin-list` */
const packageOf = (specifier: string) => specifier.split('/').slice(0, 2).join('/');

interface Closure {
  /** every workspace package reached, mapped to the files that import it */
  packages: Map<string, Set<string>>;
  /** the subset imported directly by the example's own src/ */
  direct: Set<string>;
  filesWalked: number;
  unresolvable: string[];
  /**
   * Relative specifiers the walk skipped on purpose because they are assets,
   * not modules. Never asserted empty — this exists so the skip is observable
   * instead of implicit, and so a fixture can prove the boundary is drawn where
   * it is documented to be.
   */
  nonModuleSkipped: string[];
}

/**
 * Where Vite sends a workspace specifier: the FIRST alias entry, in table
 * order, whose key equals the specifier or is a prefix of it ending at a `/`,
 * with that key replaced by its target — the matching `@rollup/plugin-alias`
 * applies to `resolve.alias`. With no matching entry it is the package-root
 * guess (`packages/<pkg>/src` plus the subpath), so the walk still traverses a
 * package that is not aliased today and the closure assertion names it.
 *
 * A bare package specifier lands where the guess always put it. The case this
 * exists for is a SUBPATH whose module is not `src/<subpath>/index.*`:
 * `@object-ui/types/zod` is `src/zod/index.zod.ts`, which the guess cannot
 * reach and the dev server reaches only through the table's own subpath entry,
 * listed BEFORE the bare package for exactly that reason. Resolving through the
 * table models that and nothing looser: drop the subpath entry, or list it after
 * the bare package, and Vite would land on `src/zod` — which this walk then
 * reports as unresolvable, as before (pinned by the fixtures at the bottom).
 */
function viteAliasTarget(specifier: string, aliases: ReadonlyMap<string, string>): string {
  for (const [key, target] of aliases) {
    if (specifier === key || specifier.startsWith(`${key}/`)) return target + specifier.slice(key.length);
  }
  const pkg = packageOf(specifier);
  return packageSrc(pkg) + specifier.slice(pkg.length);
}

function computeClosure(
  entryDir: string = path.join(exampleDir, 'src'),
  aliases: ReadonlyMap<string, string> = readAliasTable(),
): Closure {
  const packages = new Map<string, Set<string>>();
  const direct = new Set<string>();
  const unresolvable: string[] = [];
  const nonModuleSkipped: string[] = [];
  const seen = new Set<string>();

  const exampleSrc = entryDir;

  function walk(file: string): void {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return;
    // Tests are not part of what the dev server serves.
    if (/\.(test|spec)\.[tj]sx?$/.test(file)) return;

    const code = fs.readFileSync(file, 'utf8');
    const specifiers = new Set(ts.preProcessFile(code, true, true).importedFiles.map((r) => r.fileName));

    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) {
        const resolved = resolveModule(path.resolve(path.dirname(file), specifier));
        if (resolved) {
          walk(resolved);
          continue;
        }
        // A miss used to vanish here with no record, which made
        // `unresolvable` structurally empty for this entire specifier class:
        // `expect(closure.unresolvable).toEqual([])` could not fail for a
        // relative import no matter how many the walk failed to follow. That is
        // how objectui#4538's and objectui#5214's conversions each truncated
        // this walk while landing green — the `filesWalked` floor was the only
        // signal there was, and it had enough slack to hide two pull requests.
        if (isModuleSpecifier(specifier)) {
          unresolvable.push(
            `${specifier} (unresolvable relative import, imported by ${path.relative(repoRoot, file)})`,
          );
        } else {
          nonModuleSkipped.push(`${specifier} (imported by ${path.relative(repoRoot, file)})`);
        }
        continue;
      }
      // Third-party and @objectstack/* are real registry dependencies; only
      // workspace packages are aliased to source.
      if (!specifier.startsWith('@object-ui/')) continue;

      const pkg = packageOf(specifier);
      if (!isWorkspacePackage(pkg)) {
        unresolvable.push(`${specifier} (no packages/*/src, imported by ${path.relative(repoRoot, file)})`);
        continue;
      }

      if (!packages.has(pkg)) packages.set(pkg, new Set());
      packages.get(pkg)!.add(path.relative(repoRoot, file));
      if (file.startsWith(exampleSrc + path.sep)) direct.add(pkg);

      const resolved = resolveModule(viteAliasTarget(specifier, aliases));
      if (resolved) walk(resolved);
      else unresolvable.push(`${specifier} (unresolvable under src, imported by ${path.relative(repoRoot, file)})`);
    }
  }

  for (const entry of fs.readdirSync(exampleSrc)) {
    if (/\.(ts|tsx|js|jsx)$/.test(entry)) walk(path.join(exampleSrc, entry));
  }

  return { packages, direct, filesWalked: seen.size, unresolvable, nonModuleSkipped };
}

describe('console-starter vite alias table', () => {
  const aliases = readAliasTable();
  const closure = computeClosure();

  it('parses the alias table out of vite.config.ts', () => {
    // Guards the regex above: if the config is reformatted so the entries stop
    // matching, every other assertion here would pass vacuously.
    expect(aliases.size).toBeGreaterThan(20);
    expect(aliases.get('@object-ui/app-shell')).toBe(
      path.join(repoRoot, 'packages/app-shell/src'),
    );
  });

  it('reaches the workspace graph it is meant to cover', () => {
    // Same guard for the walker: a resolution regression that walked nothing
    // would make the closure assertion trivially true.
    //
    // `unresolvable` now covers BOTH walk branches — bare `@object-ui/*` and
    // relative — so a resolution regression is reported as itself, by name and
    // importer, instead of only as a file count that drifted toward a floor.
    expect(closure.filesWalked).toBeGreaterThan(500);
    expect(closure.unresolvable).toEqual([]);
  });

  it('points every alias at a directory that exists', () => {
    const broken = [...aliases.entries()].filter(([, target]) => !fs.existsSync(target));
    expect(broken.map(([k, v]) => `${k} -> ${path.relative(repoRoot, v)}`)).toEqual([]);
  });

  it('is closed under the import graph — no aliased source imports an unaliased workspace package', () => {
    const missing = [...closure.packages.keys()]
      .filter((pkg) => !aliases.has(pkg))
      .sort()
      .map((pkg) => `${pkg} (imported by ${[...closure.packages.get(pkg)!].sort().join(', ')})`);

    // Anything listed here falls back to packages/*/dist at dev time, so
    // `pnpm dev` without a prior `pnpm -w build` renders a blank page.
    expect(missing).toEqual([]);
  });

  it('declares every workspace package the example imports directly', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(exampleDir, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));
    const undeclared = [...closure.direct].filter((pkg) => !declared.has(pkg)).sort();
    expect(undeclared).toEqual([]);
  });
});

/**
 * `closure.unresolvable` above is asserted empty, and on a healthy tree it IS
 * empty — which is exactly the reading that cannot be trusted on its own. An
 * assertion that receives nothing looks identical to one that cannot receive
 * anything, and for the relative branch it *was* the second of those for three
 * pull requests.
 *
 * So the empty reading is only worth what these fixtures are worth: the same
 * walker, over a tree built on purpose, must report the misses that genuinely
 * are misses and stay silent about the assets that are not. Pinning the class
 * here means a future edit cannot re-blind the branch without turning this red.
 */
describe('the closure walker records relative misses instead of dropping them', () => {
  /** Builds a throwaway source tree and walks it with the real `computeClosure`. */
  function withFixture<T>(files: Record<string, string>, run: (dir: string) => T): T {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alias-closure-')));
    try {
      for (const [name, content] of Object.entries(files)) {
        const target = path.join(dir, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
      return run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('walks `./Foo.js` through to the `Foo.tsx` on disk', () => {
    // The case that produced every row of objectui#5386's table: a package whose
    // build preserves specifiers must spell `Foo.tsx` as `./Foo.js`, and the
    // walk has to follow it rather than lose the subtree behind it.
    const closure = withFixture(
      {
        'entry.ts': `import './Foo.js';\n`,
        'Foo.tsx': `import './Bar';\nexport const Foo = 1;\n`,
        'Bar.ts': `export const Bar = 2;\n`,
      },
      (dir) => computeClosure(dir),
    );

    // entry.ts + Foo.tsx + Bar.ts — the subtree behind the `.js` spelling is
    // reached, not dropped at the first re-export.
    expect(closure.filesWalked).toBe(3);
    expect(closure.unresolvable).toEqual([]);
  });

  it('reports a relative module specifier that does not resolve', () => {
    // The counter-probe for the empty reading above: plant misses of both
    // module spellings and require this walker to name them.
    const closure = withFixture(
      {
        'entry.ts': `import './missing-module.js';\nimport './gone';\n`,
      },
      (dir) => computeClosure(dir),
    );

    expect(closure.unresolvable).toHaveLength(2);
    expect(closure.unresolvable.join('\n')).toContain('./missing-module.js');
    expect(closure.unresolvable.join('\n')).toContain('./gone');
  });

  it('skips an unresolvable asset specifier explicitly rather than reporting it', () => {
    // The boundary condition: a stylesheet, image or font import is not a
    // missing module. `ts.preProcessFile` reports them all, and `resolveModule`
    // cannot resolve any of them, so recording them alongside real misses would
    // manufacture failures that are not defects.
    const closure = withFixture(
      {
        'entry.ts':
          `import './theme.css';\n` +
          `import './logo.svg';\n` +
          `import './font.woff2';\n` +
          `import './data.json';\n` +
          `import './raw.css?inline';\n` +
          `import './real.js';\n`,
        'real.ts': `export const real = 1;\n`,
      },
      (dir) => computeClosure(dir),
    );

    // None of the five assets is a defect...
    expect(closure.unresolvable).toEqual([]);
    // ...but each is accounted for, so the skip is a decision and not a drop.
    expect(closure.nonModuleSkipped).toHaveLength(5);
    expect(closure.nonModuleSkipped.join('\n')).toContain('./theme.css');
    expect(closure.nonModuleSkipped.join('\n')).toContain('./raw.css?inline');
    // The module alongside them still resolves and is walked.
    expect(closure.filesWalked).toBe(2);
  });

  // objectui#8894 — the first workspace SUBPATH import inside this closure
  // (`@object-ui/types/zod`, from plugin-dashboard and plugin-designer). Its
  // module is `src/zod/index.zod.ts`, so it resolves only through the alias
  // table's subpath entry; these three pin that the walk follows the table the
  // way Vite does and is not loosened by it.
  const TYPES_SRC = path.join(repoRoot, 'packages/types/src');
  const TYPES_ZOD = path.join(TYPES_SRC, 'zod/index.zod.ts');
  const subpathEntry = { 'entry.ts': `import { DashboardWidgetSchema } from '@object-ui/types/zod';\nexport { DashboardWidgetSchema };\n` };

  it('resolves a workspace subpath through the alias entry Vite applies', () => {
    const closure = withFixture(subpathEntry, (dir) =>
      computeClosure(dir, new Map([['@object-ui/types/zod', TYPES_ZOD], ['@object-ui/types', TYPES_SRC]])),
    );
    expect(closure.unresolvable).toEqual([]);
    // The validators' module and what it imports were walked, not just named.
    expect(closure.filesWalked).toBeGreaterThan(2);
  });

  it('reports the subpath when the table has no entry for it — the package-root guess cannot reach it', () => {
    const closure = withFixture(subpathEntry, (dir) =>
      computeClosure(dir, new Map([['@object-ui/types', TYPES_SRC]])),
    );
    expect(closure.unresolvable.join('\n')).toContain('@object-ui/types/zod (unresolvable under src');
  });

  it('reports the subpath when its entry comes AFTER the bare package — the first match wins, as in Vite', () => {
    const closure = withFixture(subpathEntry, (dir) =>
      computeClosure(dir, new Map([['@object-ui/types', TYPES_SRC], ['@object-ui/types/zod', TYPES_ZOD]])),
    );
    expect(closure.unresolvable.join('\n')).toContain('@object-ui/types/zod (unresolvable under src');
  });

  it('classifies the specifier spellings that decide the boundary', () => {
    // Directly pins `isModuleSpecifier`, so the line stays where it is
    // documented even if the walk around it is rewritten.
    for (const module of ['./Foo', '.', '..', '../pkg/src', './Foo.js', './Foo.ts', './Foo.mts']) {
      expect(isModuleSpecifier(module)).toBe(true);
    }
    for (const asset of ['./a.css', './a.svg', './a.json', './a.woff2', './a.js?worker']) {
      expect(isModuleSpecifier(asset)).toBe(false);
    }
  });
});

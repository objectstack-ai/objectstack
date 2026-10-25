/**
 * Pins the scaffold's test stack (objectui#3716).
 *
 * The generator used to write an example test that imported
 * `@testing-library/react` and asserted with `toBeInTheDocument()`, plus a
 * `test: 'vitest run'` script — while declaring neither library and giving
 * Vitest no DOM environment. `npm test` in a freshly scaffolded plugin was
 * therefore red on the very first run.
 *
 * These tests assert over the SAME file map the CLI writes
 * (`buildPluginFiles`), not over this repo's source text, so they cannot go
 * green on a template that no longer produces a runnable artifact. The two
 * that matter most are structural rather than string-matching:
 *
 * - every bare import in every generated source file must be a declared
 *   dependency of the generated package (the exact defect, generalised);
 * - the `setupFiles` path in the generated Vitest config must name a file the
 *   generator actually writes.
 *
 * Two more structural gates close the blind spot on the OTHER side of that
 * import check, which only ever caught undeclared imports and never declared
 * things nothing used (objectui#3755, objectui#3759):
 *
 * - no versioned runtime dependency may be declared that no generated source
 *   imports (`workspace:*` exempt — it cannot drift);
 * - no generated `src/**` module may be unreachable from `src/index.tsx`, the
 *   single entry the generated `exports` map exposes.
 *
 * Both would pass over an empty result on today's templates, so each is paired
 * with a self-test that plants the removed defect back and asserts the rule
 * names it. A gate that is green because it produces nothing is not a gate.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VITEST_SETUP_FILE,
  buildIndexFile,
  buildPackageJson,
  buildPluginFiles,
  buildTestFile,
  buildViteConfig,
  buildVitestSetup,
  type PluginTemplateVars
} from '../templates';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** packages/create-plugin/src/__tests__ -> repo root */
const REPO_ROOT = resolve(__dirname, '../../../..');

const VARS: PluginTemplateVars = {
  packageName: '@object-ui/plugin-heatmap',
  pluginName: 'heatmap',
  pascalName: 'Heatmap',
  description: 'Heatmap plugin for ObjectUI',
  author: 'ObjectStack Team',
  license: 'MIT',
  version: '0.1.0',
  year: 2026
};

/**
 * Package names imported by a generated source file, excluding relative imports.
 *
 * Covers both `import x from 'pkg'` and the side-effect form `import 'pkg'`
 * (which is how the generated Vitest setup file pulls the matchers in), and
 * folds a subpath specifier back onto its package name so
 * `@testing-library/jest-dom/vitest` is checked against
 * `@testing-library/jest-dom`. Node builtins are dropped — the generated Vite
 * config imports `path`, which nothing declares because nothing has to.
 */
function importedPackagesOf(source: string): string[] {
  const packages = new Set<string>();
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+(?:[^;'"]*?from\s+)?'([^']+)'/g)) {
    const specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    if (isBuiltin(specifier)) continue;
    const segments = specifier.split('/');
    packages.add(specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]);
  }
  return [...packages].sort();
}

type Manifest = {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
}

/** The repo root `package.json` — anchor for every dependency it declares. */
function rootManifest(): Manifest {
  return readManifest(resolve(REPO_ROOT, 'package.json'));
}

/**
 * `packages/plugin-*` manifests, as `package name -> manifest`.
 *
 * `create-plugin` writes into `<cwd>/packages/plugin-<name>`, so a generated
 * plugin is a literal sibling of these — which makes them the faithful anchor
 * for build dependencies the root manifest does not declare
 * (`@vitejs/plugin-react`, `vite-plugin-dts`).
 */
function inRepoPluginManifests(): Record<string, Manifest> {
  const packagesDir = resolve(REPO_ROOT, 'packages');
  const manifests: Record<string, Manifest> = {};
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('plugin-')) continue;
    const manifestPath = resolve(packagesDir, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    manifests[entry.name] = readManifest(manifestPath);
  }
  return manifests;
}

/**
 * Which in-repo manifest each generated devDependency range must quote.
 *
 * Anchoring is what keeps ONE range per dependency in this repo instead of one
 * per file. `root` is preferred wherever the dependency exists there (that is
 * the anchor objectui#3733 chose for the three testing entries); the two
 * build-only tools the root does not declare are anchored to the in-repo plugin
 * manifests the generated package sits beside.
 *
 * Every key of the generated `devDependencies` must appear here — the
 * completeness test below fails on an unanchored addition, so this map cannot
 * quietly go back to covering a subset (objectui#3742).
 *
 * That completeness rule and the range rule are complements, stated together
 * here because they live in separate `it`s below where neither is visible from
 * the other (objectui#4974): the range rule judges ONLY the names listed here,
 * so entering the table is what puts a new template devDependency under the
 * anchor gate at all, and `anchors every devDependency range, leaving none
 * unpinned` is what makes skipping the entry impossible rather than silent. Add
 * the devDependency and its anchor in the same change.
 */
const DEV_DEPENDENCY_ANCHORS: Record<string, 'root' | 'in-repo-plugins'> = {
  '@testing-library/jest-dom': 'root',
  '@testing-library/react': 'root',
  '@vitejs/plugin-react': 'in-repo-plugins',
  jsdom: 'root',
  typescript: 'root',
  vite: 'root',
  'vite-plugin-dts': 'in-repo-plugins',
  vitest: 'root'
};

/** The range `name` is declared at in the root manifest, if it is declared there. */
function rootRangeOf(name: string): string | undefined {
  const manifest = rootManifest();
  return manifest.devDependencies?.[name] ?? manifest.dependencies?.[name];
}

/**
 * The range every in-repo plugin declaring `name` agrees on.
 *
 * Returns the distinct ranges found, keyed by range, so a divergence names the
 * offending manifests instead of just failing. A split here is itself a finding
 * — this repo's rule is one range per dependency — so the parity test asserts
 * unanimity rather than picking a winner.
 */
function inRepoPluginRangesOf(name: string): Record<string, string[]> {
  const byRange: Record<string, string[]> = {};
  for (const [pluginDir, manifest] of Object.entries(inRepoPluginManifests())) {
    const range = manifest.devDependencies?.[name] ?? manifest.dependencies?.[name];
    if (range === undefined) continue;
    (byRange[range] ??= []).push(pluginDir);
  }
  return byRange;
}

function generatedDevDependencies(vars: PluginTemplateVars): Record<string, string> {
  return (buildPackageJson(vars) as { devDependencies: Record<string, string> }).devDependencies;
}

function generatedDependencies(vars: PluginTemplateVars): Record<string, string> {
  return (buildPackageJson(vars) as { dependencies: Record<string, string> }).dependencies;
}

/**
 * Runtime dependencies pinned to a VERSION that no generated source imports.
 *
 * The reverse of the `import nothing the manifest does not declare` gate below.
 * That one is one-way — objectui#3733 added it against undeclared imports, so
 * `'lucide-react': '^0.563.0'` sat in the generated `dependencies` for as long
 * as it did precisely because nothing looked in this direction (objectui#3755).
 *
 * `workspace:*` entries are exempt by design, not by oversight: they resolve to
 * whatever this workspace currently builds, so an unused one costs nothing and
 * cannot drift. A versioned range is the opposite — it is installed as written,
 * and `^0.563.0` could not even float within `0.x` (a `0.x` caret is
 * `>=0.563.0 <0.564.0`), so it stayed two majors behind the repo's own
 * `^1.28.0` indefinitely.
 *
 * Returned rather than asserted so the rule can be exercised against a manifest
 * that DOES violate it — see the self-test beside its use. Without that, the
 * gate would pass by producing nothing (there are no versioned runtime ranges
 * left) and would keep passing if it were broken.
 */
function unusedVersionedDependencies(
  dependencies: Record<string, string>,
  files: Record<string, string>
): string[] {
  const imported = new Set<string>();
  for (const [relativePath, contents] of Object.entries(files)) {
    if (!/\.tsx?$/.test(relativePath)) continue;
    for (const pkg of importedPackagesOf(contents)) imported.add(pkg);
  }
  return Object.entries(dependencies)
    .filter(([name, range]) => !range.startsWith('workspace:') && !imported.has(name))
    .map(([name]) => name)
    .sort();
}

/**
 * Generated `src/**` modules NOT reachable from the entry the `exports` map names.
 *
 * objectui#3759's criterion, structurally. The generated manifest exposes one
 * `exports` key (`.` → `dist/*`), so `src/index.tsx` is a consumer's only door;
 * a module the entry does not pull in transitively is unreachable no matter what
 * it contains. `src/types.ts` was written to disk in exactly that state — the
 * deep paths that would have reached it (`<pkg>/types`, `<pkg>/dist/types`) are
 * closed by the same `exports` map, so the plugin's schema contract shipped
 * dead. The pre-existing file-map test asserted only that the path EXISTS,
 * which is what let it stay dead.
 *
 * Test files are excluded from the roots on purpose: Vitest loads them
 * directly, so entry-reachability is not required of them — and if they counted
 * as roots, a module reachable only from a test would read as live while still
 * being unreachable for every consumer.
 */
function unreachableGeneratedSources(files: Record<string, string>): string[] {
  const isSource = (path: string) => /^src\/.*\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);

  const resolveRelative = (fromPath: string, specifier: string): string | undefined => {
    const fromDir = fromPath.slice(0, fromPath.lastIndexOf('/'));
    const segments = `${fromDir}/${specifier}`.split('/');
    const stack: string[] = [];
    for (const segment of segments) {
      if (segment === '.' || segment === '') continue;
      if (segment === '..') stack.pop();
      else stack.push(segment);
    }
    const base = stack.join('/');
    return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find(
      (candidate) => files[candidate] !== undefined
    );
  };

  const reached = new Set<string>();
  const queue = ['src/index.tsx'];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (reached.has(current) || files[current] === undefined) continue;
    reached.add(current);
    // Covers `import … from './x'`, `import './x'` and `export … from './x'`,
    // including the `export type { … } from './types'` form the entry uses.
    for (const match of files[current].matchAll(
      /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"]*?from\s+)?'(\.[^']*)'/g
    )) {
      const target = resolveRelative(current, match[1]);
      if (target !== undefined) queue.push(target);
    }
  }

  return Object.keys(files)
    .filter((path) => isSource(path) && !reached.has(path))
    .sort();
}

function declaredDependencies(vars: PluginTemplateVars): Record<string, string> {
  const pkg = buildPackageJson(vars) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

/**
 * Whether an emitted vite config that carries a `test:` block also carries the
 * DECLARATION that types that key (objectui#8139).
 *
 * `vite`'s own `UserConfig` has no `test` key, so a config that passes the
 * block to a `defineConfig` imported from `vite` and says nothing else is
 * TS2769 in every editor the scaffolded plugin is opened in. Two shapes supply
 * the missing declaration and both are accepted HERE, because the invariant this
 * predicate states is "the block is typed", not "typed one particular way" —
 * which of the two the template should use is a separate question, pinned
 * separately below with the measurement that decided it.
 *
 * A config with no `test:` block has nothing to type and passes vacuously; the
 * self-test below is what stops that branch from swallowing a real regression.
 */
function typesTheTestBlock(config: string): boolean {
  if (!/test:\s*\{/.test(config)) return true;
  return (
    /\/\/\/\s*<reference\s+types="vitest\/config"\s*\/>/.test(config) ||
    /from\s+'vitest\/config'/.test(config)
  );
}

describe('generated package.json', () => {
  it('declares the whole test stack the template ships', () => {
    const pkg = buildPackageJson(VARS) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    // The script is what makes the three declarations mandatory: ship one and
    // the author's first command has to work.
    expect(pkg.scripts.test).toBe('vitest run');

    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining(['@testing-library/react', '@testing-library/jest-dom', 'jsdom'])
    );
  });

  it('declares exactly the four workspace platform packages as runtime dependencies', () => {
    // objectui#3755. The whole map, not `arrayContaining`: a versioned runtime
    // range added here has to fail this test and be argued for, which is what
    // `'lucide-react': '^0.563.0'` never was. `workspace:*` throughout is the
    // property that makes the generated manifest undriftable by construction —
    // no anchor table needed, unlike the devDependencies above.
    expect(generatedDependencies(VARS)).toEqual({
      '@object-ui/components': 'workspace:*',
      '@object-ui/core': 'workspace:*',
      '@object-ui/react': 'workspace:*',
      '@object-ui/types': 'workspace:*'
    });
  });

  it('declares no versioned runtime dependency that the generated sources never import', () => {
    // The other half of objectui#3733's one-way import gate. That gate rejects
    // an import nothing declares; this one rejects a versioned declaration
    // nothing imports — the direction that let lucide-react be installed by
    // every scaffolded plugin for code that never referenced it (objectui#3755).
    expect(unusedVersionedDependencies(generatedDependencies(VARS), buildPluginFiles(VARS))).toEqual(
      []
    );
  });

  it('catches an unused versioned runtime dependency when one is present', () => {
    // Self-test, because the assertion above currently passes over an EMPTY
    // set — there are no versioned runtime ranges left to judge. Without this,
    // that gate would go green on a broken rule just as readily as on a clean
    // manifest. Plants back the exact declaration objectui#3755 removed.
    const files = buildPluginFiles(VARS);
    const withLucide = { ...generatedDependencies(VARS), 'lucide-react': '^0.563.0' };
    expect(unusedVersionedDependencies(withLucide, files)).toEqual(['lucide-react']);

    // And does not fire on a versioned range the sources really do import, so
    // the rule rejects unused declarations rather than versioned ones.
    const withImported = { ...generatedDependencies(VARS), 'lucide-react': '^1.28.0' };
    const importingFiles = {
      ...files,
      'src/Icon.tsx': `import { Flame } from 'lucide-react';\nexport const Icon = Flame;\n`
    };
    expect(unusedVersionedDependencies(withImported, importingFiles)).toEqual([]);
  });

  it('anchors every devDependency range, leaving none unpinned', () => {
    // The completeness gate. objectui#3733 pinned only the three testing
    // ranges, and the five build ranges beside them drifted one to two majors
    // behind the repo's own toolchain unnoticed (objectui#3742). Adding a
    // devDependency to the template without naming its anchor fails here.
    const generated = generatedDevDependencies(VARS);
    expect(Object.keys(generated).sort()).toEqual(Object.keys(DEV_DEPENDENCY_ANCHORS).sort());
  });

  it('sources every devDependency range from this repo instead of inventing them', () => {
    // These literals live in `.ts` source, outside the objectui#3711
    // version-claims gate's scan face, so this is the gate for them: the
    // template must quote the monorepo's own range for the same package.
    // Bumping an in-repo manifest and leaving the template behind is the drift
    // this test exists to catch — update `src/templates.ts` in the same PR.
    const generated = generatedDevDependencies(VARS);

    // Pass 1 — the PRECONDITIONS, which are facts about THIS REPO rather than
    // drift in a generated range: a `root` anchor the root manifest no longer
    // carries, an in-repo split with no single range to quote. They keep
    // throwing on the first failure, and they all run before any range is
    // compared, so a broken precondition can never be reported as drift nor
    // read as crosstalk beside one (objectui#4974). Nothing to accumulate here
    // either: with the anchor unresolvable there is no expectation to compare a
    // generated range against.
    const expectedRanges: Record<string, { range: string; source: string }> = {};
    for (const [name, anchor] of Object.entries(DEV_DEPENDENCY_ANCHORS)) {
      if (anchor === 'root') {
        const rootRange = rootRangeOf(name);
        expect(rootRange, `${name} must exist in the root manifest`).toBeTruthy();
        expectedRanges[name] = { range: rootRange as string, source: 'the repo root' };
        continue;
      }

      const byRange = inRepoPluginRangesOf(name);
      const ranges = Object.keys(byRange);
      expect(
        ranges.length,
        `${name} must be declared by at least one packages/plugin-* manifest to anchor to`
      ).toBeGreaterThan(0);
      expect(
        ranges.sort(),
        `in-repo plugins disagree on ${name}: ${JSON.stringify(byRange)} — settle on one range first`
      ).toHaveLength(1);
      expectedRanges[name] = { range: ranges[0], source: 'its in-repo plugin range' };
    }

    // Pass 2 — the DRIFT, accumulated and reported by a single assertion
    // (objectui#4974). Per-name `expect` threw on the first mismatch, so a
    // dependabot round moving several of these ranges was one round of repair
    // PER NAME, and which name you were told about depended on its POSITION in
    // the table. It cost this file directly: the testing-library range sat
    // drifted on `main` while the sibling generator's table in `packages/cli`
    // was still red, so nothing reported it until that one was green
    // (objectui#4968). Each line carries the name, the generated range and the
    // range it must be, so the whole batch is fixable from one failure report.
    const drifted: string[] = [];
    for (const [name, { range, source }] of Object.entries(expectedRanges)) {
      if (generated[name] === range) continue;
      drifted.push(`${name}: ${generated[name]} must match ${source}, ${range}`);
    }
    expect(drifted).toEqual([]);
  });

  it('keeps the two anchors consistent wherever both declare a dependency', () => {
    // Makes the anchor CHOICE non-load-bearing: for anything declared both at
    // the root and in the plugin manifests, the two must already agree, so
    // reading one instead of the other cannot hide a drift.
    for (const name of Object.keys(DEV_DEPENDENCY_ANCHORS)) {
      const rootRange = rootRangeOf(name);
      if (rootRange === undefined) continue;
      for (const [range, plugins] of Object.entries(inRepoPluginRangesOf(name))) {
        expect(
          range,
          `${name} is ${rootRange} at the repo root but ${range} in ${plugins.join(', ')}`
        ).toBe(rootRange);
      }
    }
  });
});

describe('generated sources', () => {
  it('import nothing the generated package.json does not declare', () => {
    // The defect behind objectui#3716, generalised over every generated file:
    // the example test imported `@testing-library/react` and the manifest never
    // declared it. Add an undeclared import to any template and this goes red.
    const declared = declaredDependencies(VARS);
    const files = buildPluginFiles(VARS);
    for (const [relativePath, contents] of Object.entries(files)) {
      if (!/\.tsx?$/.test(relativePath)) continue;
      for (const pkg of importedPackagesOf(contents)) {
        expect(declared[pkg], `${relativePath} imports ${pkg}, which is not declared`).toBeTruthy();
      }
    }
  });

  it('derives the published schema interface from the protocols BaseSchema', () => {
    // objectui#3759's second half. Reachable-from-the-entry made this interface
    // the plugin's published contract; a hand-rolled `{ type; id?; className? }`
    // in that position is a second dialect of a base node `@object-ui/types`
    // already defines (AGENTS.md #0.1). It also silently omits everything else
    // `BaseSchema` carries (`name`, `label`, `visible`, …). Every in-repo plugin
    // that ships a `src/types.ts` extends it; `packages/plugin-markdown` is the
    // closest model. Narrowing `type` to the registry key is the only local part.
    const typesFile = buildPluginFiles(VARS)['src/types.ts'];
    expect(typesFile).toContain(`import type { BaseSchema } from '@object-ui/types';`);
    expect(typesFile).toContain('export interface HeatmapSchema extends BaseSchema {');
    expect(typesFile).toContain(`type: 'heatmap';`);
    // The copied subset is gone rather than kept alongside `extends`.
    expect(typesFile).not.toContain('id?: string;');
    expect(typesFile).not.toContain('className?: string;');
  });

  it('has its jest-dom matchers registered by the setup file', () => {
    expect(buildTestFile(VARS)).toContain('toBeInTheDocument');
    expect(buildVitestSetup()).toContain('@testing-library/jest-dom');
  });
});

describe('generated vite.config.ts', () => {
  const viteConfig = buildViteConfig(VARS);

  it('gives Vitest a DOM environment', () => {
    // Without this the example test's `render()` runs in Vitest's default
    // `node` environment, where React has no `document` to mount into.
    expect(viteConfig).toMatch(/test:\s*\{/);
    expect(viteConfig).toContain(`environment: 'jsdom'`);
  });

  it('types the `test:` block it carries, so the emitted config is not red on day one', () => {
    // objectui#8139. `vite`'s `UserConfig` declares no `test` key, so passing
    // the block to a `defineConfig` imported from `vite` is TS2769 — measured
    // on this exact template by the emitted-code census (objectui#7864 /
    // PR #8138). The triple-slash reference pulls in `vitest/dist/config.d.ts`,
    // whose `declare module "vite" { interface UserConfig { test?: … } }`
    // supplies the missing declaration, at zero run-time cost.
    expect(viteConfig).toMatch(/test:\s*\{/);
    expect(typesTheTestBlock(viteConfig)).toBe(true);
    expect(viteConfig).toContain('/// <reference types="vitest/config" />');

    // ⛔ NOT the other shape vitest documents. `import { defineConfig } from
    // 'vitest/config'` type-checks identically in the scaffolded repo, but in
    // THIS repo it trips the census's root bound (`vitest` is declared by the
    // root manifest and mapped by no package), so the census REFUSES this
    // template instead of judging it: measured on b38014e82, `Judged 12 … 7
    // refused` with the reference versus `Judged 11 … 8 refused` with the
    // import, the latter reporting zero diagnostics here only because it
    // stopped compiling the file. Changing this line means re-reading
    // buildViteConfig's docblock first.
    expect(viteConfig).toContain(`import { defineConfig } from 'vite';`);
    expect(viteConfig).not.toContain(`from 'vitest/config'`);
  });

  it('reports an untyped `test:` block once the reference line is stripped', () => {
    // Reverse verification of the pin above, in this file's own idiom: the
    // predicate passes over a config with no `test:` block, so restore the
    // pre-fix shape — block present, declaration absent — and it must say NO,
    // rather than staying green because it stopped looking.
    const preFix = viteConfig.replace('/// <reference types="vitest/config" />\n', '');
    expect(preFix).not.toContain('vitest/config');
    expect(preFix).toMatch(/test:\s*\{/);
    expect(typesTheTestBlock(preFix)).toBe(false);
  });

  it('enables globals so @testing-library/react registers its auto cleanup', () => {
    // RTL only hooks cleanup when `afterEach` exists as a global
    // (`@testing-library/react/dist/index.js`: `if (typeof afterEach === 'function')`).
    expect(viteConfig).toContain('globals: true');
  });

  it('resolves paths with import.meta.dirname so it survives configLoader native', () => {
    // vite 8 still defines `__dirname` under its default `bundle` config
    // loader, but warns on it ("... unsupported by `configLoader: 'native'`,
    // which is planned to become the default ... Use `import.meta.dirname`
    // instead") and would fail outright once `native` is the default: that
    // loader imports the config with Node's own ESM loader, which defines no
    // `__dirname`. Same conversion `apps/console/vite.config.ts` got in
    // objectui#3384 (objectui#3742).
    expect(viteConfig).toContain('path.resolve(import.meta.dirname,');
    expect(viteConfig).not.toContain('__dirname');
    expect(viteConfig).not.toContain('__filename');
  });

  it('points setupFiles at a file the generator actually writes', () => {
    expect(viteConfig).toContain(`setupFiles: ['./${VITEST_SETUP_FILE}']`);

    const setupPaths = [...viteConfig.matchAll(/setupFiles:\s*\['([^']+)'\]/g)].map((m) => m[1]);
    expect(setupPaths).not.toHaveLength(0);
    const files = buildPluginFiles(VARS);
    for (const setupPath of setupPaths) {
      expect(files[setupPath.replace(/^\.\//, '')], `${setupPath} is not generated`).toBeTruthy();
    }
  });
});

describe('generated file map', () => {
  it('writes the Vitest setup file next to the config that names it', () => {
    const files = buildPluginFiles(VARS);
    expect(Object.keys(files).sort()).toEqual([
      'LICENSE',
      'README.md',
      'package.json',
      'src/HeatmapImpl.test.tsx',
      'src/HeatmapImpl.tsx',
      'src/index.tsx',
      'src/types.ts',
      'tsconfig.json',
      'vite.config.ts',
      'vitest.setup.ts'
    ]);
    expect(files[VITEST_SETUP_FILE]).toContain(`import '@testing-library/jest-dom/vitest';`);
  });

  it('writes no source file that is unreachable from the packages only entry point', () => {
    // objectui#3759. `src/types.ts` used to be written and then reachable from
    // nowhere: no generated source imported it, and the `exports` map exposes
    // only `.`, so `<pkg>/types` and `<pkg>/dist/types` were closed too. The
    // interface in it is the plugin's schema contract — the one thing a
    // metadata author needs from the package — and it shipped dead.
    //
    // Structural rather than a grep for the re-export line: any future template
    // file added to the map has to be wired up to the entry (or be a test),
    // instead of quietly becoming the next dead artifact.
    expect(unreachableGeneratedSources(buildPluginFiles(VARS))).toEqual([]);
  });

  it('pins that entry-reachability is what makes a type consumable, via the exports map', () => {
    // The premise the test above rests on. If a `./types` subpath were ever
    // added to `exports`, entry-reachability would stop being the criterion —
    // so the premise is asserted rather than assumed.
    const pkg = buildPackageJson(VARS) as { exports: Record<string, unknown> };
    expect(Object.keys(pkg.exports)).toEqual(['.']);
    expect(buildIndexFile(VARS)).toContain(`export type { HeatmapSchema } from './types';`);
  });

  it('reports the schema module as unreachable when the entry stops re-exporting it', () => {
    // Self-test for the gate above, which passes over an empty result: with the
    // re-export line stripped, `src/types.ts` must be NAMED. This is the
    // reverse verification of objectui#3759 encoded in the suite — restore the
    // pre-fix entry and the gate goes red, rather than silently green because
    // it stopped looking.
    const files = buildPluginFiles(VARS);
    const preFixEntry = files['src/index.tsx'].replace(
      `export type { HeatmapSchema } from './types';\n`,
      ''
    );
    expect(preFixEntry).not.toContain(`from './types'`);
    expect(unreachableGeneratedSources({ ...files, 'src/index.tsx': preFixEntry })).toEqual([
      'src/types.ts'
    ]);
  });

  it('keeps every path inside the generated plugin directory', () => {
    // The CLI joins these onto the target dir, so a `..` segment here would
    // escape it — the same traversal the plugin-name validation guards against.
    for (const relativePath of Object.keys(buildPluginFiles(VARS))) {
      expect(relativePath).not.toMatch(/(^|\/)\.\.(\/|$)/);
      expect(relativePath.startsWith('/')).toBe(false);
    }
  });
});

/**
 * Every third-party dependency of this package whose shipped typings import
 * `react` must reach `@types/react` from ITS OWN install directory, never only
 * through a package-manager hoist (objectstack#37015).
 *
 * Why this needs a test: `react-i18next` imports `react` in its `.d.ts` but
 * does not declare `@types/react`, and React 19 itself ships no types. Under
 * pnpm the import resolved only through the hidden hoist
 * (`node_modules/.pnpm/node_modules`). An install without that hoist left
 * `React.Context` unresolved; with `skipLibCheck` TypeScript reported nothing
 * for the library and typed `useContext(I18nContext)` as `{}`, so the build of
 * this package failed with TS2339 at `packNamespace.ts` on such machines while
 * CI, whose install hoists, stayed green. The fix is the `packageExtensions`
 * peer in the workspace's `pnpm-workspace.yaml`, which links `@types/react`
 * beside the library.
 *
 * A plain build or type check cannot hold that fix: on a hoisting install it
 * passes with the fix deleted. So this test asks TypeScript's own module
 * resolution where `react` resolves from the library's typings, through a host
 * that cannot see anything above the `node_modules` directory holding the
 * library. That is exactly what an install without the hoist leaves visible,
 * whatever the install that runs this test actually hoisted.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '../..');
const requireFromPkg = createRequire(join(PKG, 'package.json'));

const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};

/** Third-party runtime dependencies: workspace packages carry their own declarations. */
const thirdParty = Object.entries(manifest.dependencies ?? {})
  .filter(([, spec]) => !spec.startsWith('workspace:'))
  .map(([name]) => name);

const IMPORTS_REACT = /(?:from\s+|import\s*\(\s*)['"]react(?:\/[^'"]*)?['"]/;

/** The library's typings entry, as a consumer's `require`/`types` condition finds it. */
function typingsEntry(pkgDir: string): string | undefined {
  const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    types?: string;
    typings?: string;
  };
  for (const candidate of ['index.d.ts', pj.types, pj.typings]) {
    if (!candidate) continue;
    const file = join(pkgDir, candidate);
    if (existsSync(file) && readFileSync(file, 'utf8').match(IMPORTS_REACT)) return file;
  }
  return undefined;
}

/**
 * Resolve `react` from `containingFile` with a host confined to `boundary`:
 * every path outside it reads as absent, as an install without any hoist
 * leaves it.
 */
function resolveReactWithin(containingFile: string, boundary: string) {
  const inside = (p: string) => {
    const abs = resolve(p);
    return abs === boundary || abs.startsWith(boundary + sep);
  };
  const host: ts.ModuleResolutionHost = {
    fileExists: (p) => inside(p) && ts.sys.fileExists(p),
    readFile: (p) => (inside(p) ? ts.sys.readFile(p) : undefined),
    directoryExists: (p) => inside(p) && ts.sys.directoryExists(p),
    realpath: (p) => realpathSync(p),
    getCurrentDirectory: () => dirname(containingFile),
  };
  return ts.resolveModuleName(
    'react',
    containingFile,
    { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext },
    host,
  ).resolvedModule;
}

const checked: string[] = [];

describe('React typings of third-party dependencies resolve without a hoist (objectstack#37015)', () => {
  for (const name of thirdParty) {
    const pkgDir = dirname(realpathSync(requireFromPkg.resolve(`${name}/package.json`)));
    const entry = typingsEntry(pkgDir);
    if (!entry) continue;
    checked.push(name);
    // The directory that holds the library: `.pnpm/<entry>/node_modules` in
    // pnpm's isolated layout, the root `node_modules` in a flat one.
    const boundary = name.startsWith('@') ? dirname(dirname(pkgDir)) : dirname(pkgDir);

    it(`${name}: 'react' resolves to @types/react inside its own install directory`, () => {
      expect(statSync(boundary).isDirectory()).toBe(true);
      const resolved = resolveReactWithin(entry, boundary);
      expect(
        resolved?.resolvedFileName,
        `${name}'s typings import 'react', but from ${boundary} TypeScript finds no @types/react; ` +
          `declare it for ${name} under packageExtensions in pnpm-workspace.yaml`,
      ).toMatch(/[\\/]@types[\\/]react[\\/]index\.d\.ts$/);
    });
  }

  it('checks react-i18next, the dependency whose React context this package reads', () => {
    // Without this pin, a typings layout the scan above stops recognising
    // would leave the file with no case at all, and a passing run.
    expect(checked).toContain('react-i18next');
  });
});

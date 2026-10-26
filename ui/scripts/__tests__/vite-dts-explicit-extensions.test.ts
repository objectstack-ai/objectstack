import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createDtsExplicitExtensions,
  findModuleSpecifiers,
  resolveExplicitSpecifier,
  rewriteDeclaration,
} from '../vite-dts-explicit-extensions';

/**
 * objectui#5365 — `@object-ui/components` and `@object-ui/layout` emit their
 * typings from the BUNDLER half of a vite build, and `tsc` copies a module
 * specifier into the declaration verbatim. So `export * from './ui'` shipped
 * extensionless in `dist/index.d.ts` while the `.js` was clean (rolldown
 * resolves the same specifier away), and every consumer on
 * `moduleResolution: nodenext` read every named export of the package as
 * missing — measured at 880 TS2305 on `@object-ui/app-shell`.
 *
 * What is pinned here, and why each case is not covered by the next:
 *
 *   1. **A file hop and a directory hop get different answers.** `./lib/utils`
 *      is `./lib/utils.js`; `./ui` — a directory with an `index.ts` — is
 *      `./ui/index.js`. A rewriter that appended `.js` to both would emit a
 *      specifier pointing at a file that does not exist, which is the same
 *      unresolvable state in a new spelling.
 *   2. **Prose in JSDoc is not a hop.** `removeComments` is false in this
 *      repository's build configs, and its comments really do contain
 *      specifiers: `packages/app-shell/src/views/metadata-admin/i18n.ts`
 *      documents itself with `import { t } from './i18n'`. A text scan would
 *      rewrite those, and — when the prose names a path that does not exist —
 *      throw and break a correct build. This is why the implementation asks
 *      the TypeScript parser instead of a regular expression.
 *   3. **An unresolvable specifier is LOUD.** The tempting fallback ("leave it
 *      alone") reproduces exactly the silence this card is about.
 *   4. **A hook that never ran fails the build.** A wiring change that stops
 *      calling `beforeWriteFile` must not read as "nothing to fix".
 *
 * Every case builds its own fixture tree on disk, so nothing here depends on a
 * prior `pnpm build` having happened.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** A throwaway package tree: `<tmp>/src/**` plus the `dist` path it maps to. */
function fixture(files: Record<string, string>): { packageDir: string; srcDir: string; outDir: string } {
  const packageDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dts-ext-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(packageDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return { packageDir, srcDir: path.join(packageDir, 'src'), outDir: path.join(packageDir, 'dist') };
}

describe('resolveExplicitSpecifier', () => {
  it('maps a file hop to `.js` and a directory hop to `/index.js`', () => {
    const { srcDir } = fixture({
      'src/lib/utils.ts': 'export const cn = 1;\n',
      'src/ui/index.ts': 'export const Button = 1;\n',
      'src/widget.tsx': 'export const W = 1;\n',
    });

    expect(resolveExplicitSpecifier('./lib/utils', srcDir)).toBe('./lib/utils.js');
    expect(resolveExplicitSpecifier('./ui', srcDir)).toBe('./ui/index.js');
    expect(resolveExplicitSpecifier('./widget', srcDir)).toBe('./widget.js');
  });

  it('leaves an already-explicit specifier alone', () => {
    const { srcDir } = fixture({ 'src/lib/utils.ts': 'export const cn = 1;\n' });

    expect(resolveExplicitSpecifier('./lib/utils.js', srcDir)).toBeNull();
    expect(resolveExplicitSpecifier('./index.css', srcDir)).toBeNull();
  });

  it('returns null — not a guess — for a specifier naming nothing', () => {
    const { srcDir } = fixture({ 'src/lib/utils.ts': 'export const cn = 1;\n' });

    expect(resolveExplicitSpecifier('./lib/nope', srcDir)).toBeNull();
  });
});

describe('rewriteDeclaration', () => {
  it('rewrites every module-specifier form the emit can produce', () => {
    const { srcDir, outDir } = fixture({
      'src/lib/utils.ts': 'export const cn = 1;\n',
      'src/ui/index.ts': 'export const Button = 1;\n',
      'src/types.ts': 'export type T = 1;\n',
    });

    const declaration = [
      "export { cn } from './lib/utils';",
      "export * from './ui';",
      "import { Button } from './ui';",
      'export declare const x: import("./types").T;',
      'export declare const y: Promise<typeof import("./lib/utils")>;',
      'export { Button };',
      '',
    ].join('\n');

    const out = rewriteDeclaration(path.join(outDir, 'index.d.ts'), declaration, srcDir);

    expect(out).toContain("from './lib/utils.js'");
    expect(out).toContain("export * from './ui/index.js'");
    expect(out).toContain("import { Button } from './ui/index.js'");
    expect(out).toContain('import("./types.js")');
    expect(out).toContain('import("./lib/utils.js")');
    // Nothing relative is left extensionless.
    const leftover = findModuleSpecifiers('index.d.ts', out).filter(
      (s) => /^\.\.?\//.test(s.text) && !/\.(js|mjs|cjs|json|css)$/.test(s.text)
    );
    expect(leftover).toEqual([]);
  });

  it('does NOT touch a specifier that is only prose inside a comment', () => {
    const { srcDir, outDir } = fixture({ 'src/i18n.ts': 'export const t = 1;\n' });

    // The second path exists nowhere. A text scan would throw on it.
    const declaration = [
      '/**',
      " * Usage: `import { t } from './i18n'`",
      " * Superseded by `from './does-not-exist'`.",
      ' */',
      "export { t } from './i18n';",
      '',
    ].join('\n');

    const out = rewriteDeclaration(path.join(outDir, 'index.d.ts'), declaration, srcDir);

    expect(out).toContain("import { t } from './i18n'`");
    expect(out).toContain("from './does-not-exist'`");
    expect(out).toContain("export { t } from './i18n.js';");
  });

  it('throws, naming the specifier, when a real hop cannot be resolved', () => {
    const { srcDir, outDir } = fixture({ 'src/index.ts': 'export const a = 1;\n' });

    expect(() =>
      rewriteDeclaration(path.join(outDir, 'index.d.ts'), "export * from './ghost';\n", srcDir)
    ).toThrow(/\.\/ghost/);
  });
});

describe('createDtsExplicitExtensions', () => {
  it('fails the build when no declaration file ever reached the hook', () => {
    const { packageDir } = fixture({ 'src/index.ts': 'export const a = 1;\n' });
    const hooks = createDtsExplicitExtensions({ packageDir });

    expect(() => hooks.afterBuild(new Map())).toThrow(/never ran/);
  });

  it('rejects an emitted specifier that names no emitted declaration', () => {
    const { packageDir, outDir } = fixture({
      'src/index.ts': "export * from './gone';\n",
      'src/gone.ts': 'export const a = 1;\n',
    });
    const hooks = createDtsExplicitExtensions({ packageDir });

    const written = hooks.beforeWriteFile(
      path.join(outDir, 'index.d.ts'),
      "export * from './gone';\n"
    );
    expect(written?.content).toContain("'./gone.js'");

    // `gone.d.ts` is deliberately absent from the emitted map: the rewrite was
    // textually fine and the published typings would still be unfollowable.
    expect(() =>
      hooks.afterBuild(new Map([[path.join(outDir, 'index.d.ts'), written!.content]]))
    ).toThrow(/names no emitted declaration/);

    expect(() =>
      hooks.afterBuild(
        new Map([
          [path.join(outDir, 'index.d.ts'), written!.content],
          [path.join(outDir, 'gone.d.ts'), 'export declare const a = 1;\n'],
        ])
      )
    ).not.toThrow();
  });

  it('skips source maps and anything outside the declaration output', () => {
    const { packageDir, outDir } = fixture({ 'src/index.ts': 'export const a = 1;\n' });
    const hooks = createDtsExplicitExtensions({ packageDir });

    expect(hooks.beforeWriteFile(path.join(outDir, 'index.d.ts.map'), '{}')).toBeUndefined();
    expect(hooks.beforeWriteFile('/elsewhere/index.d.ts', "export * from './x';")).toBeUndefined();
  });
});

describe('the two packages this fix exists for', () => {
  it('wire the hook into their `vite-plugin-dts` invocation', () => {
    for (const pkg of ['components', 'layout']) {
      const config = fs.readFileSync(
        path.join(repoRoot, 'packages', pkg, 'vite.config.ts'),
        'utf8'
      );
      expect(config).toContain('vite-dts-explicit-extensions');
      expect(config).toContain('createDtsExplicitExtensions({ packageDir: __dirname })');
    }
  });
});

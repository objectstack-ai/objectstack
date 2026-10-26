import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SINGLE_ZOD_GUARD_NAME, assertSingleZodInstance, zodPackageDirOf } from '../vite-single-zod';

/**
 * objectui#11327 — the console bundle carries exactly ONE zod instance, measured
 * on the emitted chunks by `assertSingleZodInstance` in every build.
 *
 * Moved here from `vite-objectstack-spec-dist.test.ts` when that module's
 * `OBJECTSTACK_SPEC_DIST` injection left with the objectstack pin
 * (objectstack#25711). The guard's cases are kept as they were; the cases of the
 * injection's own zod redirect (`pinZodToConsoleCopy`) and its range parity check
 * left with it.
 *
 * The fixture is two install trees: a console anchor with its own zod, and a
 * spec package whose bare `zod` resolves from ITS tree's root — the two-copy
 * shape one lockfile can still produce.
 */

/** Writes a fake `zod` package whose modules announce which copy they are. */
function writeFakeZod(dir: string, version: string, copy: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'zod',
      version,
      type: 'module',
      exports: { '.': './index.js', './v4': './v4.js', './package.json': './package.json' },
    })
  );
  fs.writeFileSync(path.join(dir, 'index.js'), `export const z = { copy: '${copy}' };\n`);
  fs.writeFileSync(path.join(dir, 'v4.js'), `export const z = { copy: '${copy}_V4' };\n`);
}

interface ZodFixture {
  root: string;
  /** A console-side package that declares zod, with its own copy. */
  anchorDir: string;
  /** A spec package whose zod is hoisted to ITS tree's root. */
  specDir: string;
}

function makeZodFixture({ consoleVersion, specOwnVersion }: { consoleVersion: string; specOwnVersion: string }): ZodFixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'single-zod-11327-')));
  const anchorDir = path.join(root, 'console/packages/app-shell');
  fs.mkdirSync(anchorDir, { recursive: true });
  fs.writeFileSync(
    path.join(anchorDir, 'package.json'),
    JSON.stringify({ name: 'anchor-11327', dependencies: { zod: `^${consoleVersion}` } })
  );
  writeFakeZod(path.join(anchorDir, 'node_modules/zod'), consoleVersion, 'CONSOLE_ZOD_11327');
  fs.writeFileSync(
    path.join(anchorDir, 'entry.mjs'),
    [
      "import { z } from 'zod';",
      "import { specZ, specZ4 } from '@objectstack/spec';",
      'globalThis.__probe11327 = [z.copy, specZ.copy, specZ4.copy, z === specZ];',
    ].join('\n')
  );

  const specDir = path.join(root, 'framework/packages/spec');
  fs.mkdirSync(path.join(specDir, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(specDir, 'package.json'),
    JSON.stringify({
      name: '@objectstack/spec',
      version: '0.0.0-probe11327',
      type: 'module',
      exports: { '.': { import: './dist/index.mjs' } },
      dependencies: { zod: `^${specOwnVersion}` },
    })
  );
  fs.writeFileSync(
    path.join(specDir, 'dist/index.mjs'),
    [
      "import { z } from 'zod';",
      "import { z as z4 } from 'zod/v4';",
      'export const specZ = z;',
      'export const specZ4 = z4;',
    ].join('\n')
  );
  writeFakeZod(path.join(root, 'framework/node_modules/zod'), specOwnVersion, 'SPEC_OWN_ZOD_11327');
  return { root, anchorDir, specDir };
}

/** Bundles the fixture's entry for real, with the given plugins; returns the code. */
async function bundleFixture(fixture: ZodFixture, plugins: unknown[]): Promise<string> {
  const result = (await build({
    root: fixture.anchorDir,
    logLevel: 'silent',
    configFile: false,
    resolve: { alias: { '@objectstack/spec': path.join(fixture.specDir, 'dist/index.mjs') } },
    plugins: plugins as never,
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(fixture.anchorDir, 'entry.mjs'), formats: ['es'], fileName: 'probe11327' },
    },
  })) as { output: { code?: string }[] }[];
  return result[0].output.map((o) => o.code ?? '').join('\n');
}

async function loadConsoleConfig(query = ''): Promise<any> {
  const specifier = `../../apps/console/vite.config.ts${query}`;
  return (await import(/* @vite-ignore */ specifier)).default;
}

describe('objectui#11327: the console bundle carries exactly one zod instance', () => {
  describe('the guard, in a real Vite build', () => {
    let fixture: ZodFixture;
    beforeAll(() => {
      fixture = makeZodFixture({ consoleVersion: '4.6.5', specOwnVersion: '4.6.1' });
    });
    afterAll(() => {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    });

    it('CONTROL: the fixture really bundles both copies — the split the guard exists for', async () => {
      const code = await bundleFixture(fixture, []);
      expect(code).toContain('CONSOLE_ZOD_11327');
      expect(code).toContain('SPEC_OWN_ZOD_11327');
      expect(code).toContain('SPEC_OWN_ZOD_11327_V4');
    });

    it('the guard fails a two-copy build, naming both copies, their versions and who imported them', async () => {
      const message = await bundleFixture(fixture, [assertSingleZodInstance()]).then(
        () => 'BUILD PASSED',
        (error: Error) => error.message
      );
      expect(message).toContain(`[${SINGLE_ZOD_GUARD_NAME}]`);
      expect(message).toContain('carries 2 zod instances');
      expect(message).toContain(`zod 4.6.1 at \`${path.join(fixture.root, 'framework/node_modules/zod')}\``);
      expect(message).toContain(`zod 4.6.5 at \`${path.join(fixture.anchorDir, 'node_modules/zod')}\``);
      // The spec's copy is traced to the spec, which is what tells a reader where to look.
      expect(message).toContain(path.join(fixture.specDir, 'dist/index.mjs'));
    });

    it('the guard counts INSTANCES: two copies of one version still fail', async () => {
      const twin = makeZodFixture({ consoleVersion: '4.6.5', specOwnVersion: '4.6.5' });
      try {
        await expect(bundleFixture(twin, [assertSingleZodInstance()])).rejects.toThrow(/carries 2 zod instances/);
      } finally {
        fs.rmSync(twin.root, { recursive: true, force: true });
      }
    });

    it('the guard passes a one-copy build', async () => {
      const single = makeZodFixture({ consoleVersion: '4.6.5', specOwnVersion: '4.6.1' });
      try {
        fs.rmSync(path.join(single.root, 'framework/node_modules/zod'), { recursive: true, force: true });
        fs.writeFileSync(path.join(single.specDir, 'dist/index.mjs'), 'export const specZ = {}; export const specZ4 = {};\n');
        const code = await bundleFixture(single, [assertSingleZodInstance()]);
        expect(code).toContain('CONSOLE_ZOD_11327');
        expect(code).not.toContain('SPEC_OWN_ZOD_11327');
      } finally {
        fs.rmSync(single.root, { recursive: true, force: true });
      }
    });

    it('the guard refuses a verdict when it sees no zod at all — its counter-probe', async () => {
      const blind = makeZodFixture({ consoleVersion: '4.6.5', specOwnVersion: '4.6.1' });
      try {
        fs.writeFileSync(path.join(blind.anchorDir, 'entry.mjs'), 'globalThis.__probe11327 = 1;\n');
        await expect(bundleFixture(blind, [assertSingleZodInstance()])).rejects.toThrow(/counter-probe failed/);
      } finally {
        fs.rmSync(blind.root, { recursive: true, force: true });
      }
    });
  });

  describe('which module ids the guard counts as zod', () => {
    // Labelled rows: one id carries a leading NUL (a virtual-module marker), and
    // a `%s` title would print that byte raw into every test report.
    it.each([
      ['a pnpm store path', '/r/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/core.js', '/r/node_modules/.pnpm/zod@4.6.5/node_modules/zod'],
      ['a copy nested under another package', '/r/node_modules/a/node_modules/zod/index.js', '/r/node_modules/a/node_modules/zod'],
      ['a virtual-module id with a query', '\0/r/node_modules/zod/index.js?commonjs-proxy', '/r/node_modules/zod'],
      ['a sibling package named zod-*', '/r/node_modules/zod-to-json-schema/dist/index.js', null],
      ['workspace source under a zod/ folder', '/r/packages/types/src/zod/index.zod.ts', null],
    ])('%s', (_label, id, expected) => {
      expect(zodPackageDirOf(id)).toBe(expected);
    });
  });

  describe('wired into the REAL console config', () => {
    it('registers the guard in every build, and `zod` stays out of `resolve.dedupe`', async () => {
      const config = await loadConsoleConfig('?single-zod=11327');
      const names = (config.plugins.flat(Infinity) as ({ name?: string } | null)[])
        .filter((p): p is { name?: string } => Boolean(p))
        .map((p) => p.name ?? '');
      expect(names).toContain(SINGLE_ZOD_GUARD_NAME);
      // `zod` is not in `resolve.dedupe`: measured a silent no-op from this root.
      expect(config.resolve.dedupe ?? []).not.toContain('zod');
    });
  });
});

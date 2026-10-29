// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin build` packs one strategy, `bundled`, and refuses a native addon
 * (ADR-0025 v2 §3.3; M1 of #27123).
 *
 * Driven through the real door, `PluginBuild.run([dir])`, over a plugin
 * project on disk with its own `node_modules`, so esbuild resolves exactly
 * what an author's tree would hand it. Every refusal case asserts the three
 * things a refusal owes: exit 1, the refused subject named, and NO artifact
 * on disk — a build that prints a refusal but still writes the `.osplugin`
 * would hand `os plugin sign` the very artifact it refused.
 *
 * `manifest-deps` (the retired second strategy) reaches this door through
 * `ManifestSchema`, which `@objectstack/cli` resolves from
 * `@objectstack/spec`'s `dist/` (no source alias), so that case reads the
 * built spec.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MANIFEST_FILENAME, readTarGz } from '../src/utils/osplugin.js';
import PluginBuild from '../src/commands/plugin/build.js';

const ID = 'com.acme.bundled';
const ARTIFACT = `${ID}-1.0.0.osplugin`;

const dirs: string[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** Write `files` (project-relative path → contents) into a fresh plugin project. */
async function project(manifest: Record<string, unknown>, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'osplugin-bundled-'));
  dirs.push(dir);
  await writeFile(
    join(dir, MANIFEST_FILENAME),
    JSON.stringify({ id: ID, name: 'Bundled', version: '1.0.0', type: 'plugin', runtime: 'node', ...manifest }),
  );
  for (const [rel, contents] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), contents);
  }
  return dir;
}

/** Run the build door; the exit code is oclif's, `undefined` when it finished. */
async function build(dir: string): Promise<{ exit: number | undefined; printed: string }> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  let exit: number | undefined;
  try {
    await PluginBuild.run([dir]);
  } catch (err) {
    exit = (err as { oclif?: { exit?: number } }).oclif?.exit;
    if (typeof exit !== 'number') throw err;
  }
  return { exit, printed: lines.join('\n') };
}

/** The refusal lines (`✗`), the channel a refusal speaks on. */
const refusals = (printed: string): string => printed.split('\n').filter((l) => l.includes('✗')).join('\n');

const PURE_DEP = {
  'node_modules/pure-dep/package.json': JSON.stringify({ name: 'pure-dep', version: '1.0.0', main: 'index.js' }),
  'node_modules/pure-dep/index.js': `module.exports = 'PURE_DEP_INLINED';\n`,
};

describe('os plugin build — `bundled` is the one packaging strategy', () => {
  for (const packaging of ['bundled', undefined] as const) {
    it(`packaging ${packaging === undefined ? 'unset' : `'${packaging}'`}: the dependency is inlined and no package.json or lockfile is packed`, async () => {
      const dir = await project(packaging === undefined ? {} : { packaging }, {
        ...PURE_DEP,
        'package.json': JSON.stringify({ name: 'demo', dependencies: { 'pure-dep': '1.0.0' } }),
        'pnpm-lock.yaml': `lockfileVersion: '9.0'\n`,
        'src/index.ts': `import pure from 'pure-dep';\nexport const value = pure;\n`,
      });

      const { exit } = await build(dir);

      expect(exit).toBeUndefined();
      const files = readTarGz(new Uint8Array(await readFile(join(dir, ARTIFACT))));
      const paths = files.map((f) => f.path).sort();
      expect(paths).toEqual(['SIGNATURE', 'dist/index.mjs', MANIFEST_FILENAME].sort());
      const bundle = Buffer.from(files.find((f) => f.path === 'dist/index.mjs')!.data).toString('utf8');
      expect(bundle).toContain('PURE_DEP_INLINED');
      expect(bundle).not.toMatch(/from\s*["']pure-dep["']|require\(\s*["']pure-dep["']\s*\)/);
    });
  }

  it("refuses the retired `packaging: 'manifest-deps'` at the manifest: exit 1, the key named, no artifact", async () => {
    const dir = await project({ packaging: 'manifest-deps' }, {
      ...PURE_DEP,
      'package.json': JSON.stringify({ name: 'demo', dependencies: { 'pure-dep': '1.0.0' } }),
      'src/index.ts': `import pure from 'pure-dep';\nexport const value = pure;\n`,
    });

    const { exit, printed } = await build(dir);

    expect(exit).toBe(1);
    expect(printed).toContain(`${MANIFEST_FILENAME} is invalid`);
    expect(refusals(printed)).toMatch(/packaging/);
    expect(printed).toMatch(/manifest-deps/);
    expect(existsSync(join(dir, ARTIFACT))).toBe(false);
  });
});

describe('os plugin build — a native addon is refused (ADR-0025 v2 §3.3)', () => {
  it('refuses a `.node` file the entry imports, naming the file and its importer', async () => {
    const dir = await project({}, {
      'src/native/addon.node': 'not really a binary',
      'src/index.ts': `import addon from './native/addon.node';\nexport const value = addon;\n`,
    });

    const { exit, printed } = await build(dir);

    expect(exit).toBe(1);
    const refused = refusals(printed);
    expect(refused).toMatch(/native addon/i);
    expect(printed).toContain('src/native/addon.node');
    expect(printed).toContain('src/index.ts');
    expect(existsSync(join(dir, ARTIFACT))).toBe(false);
  });

  it('refuses a dependency whose entry IS a `.node` file, naming the package', async () => {
    const dir = await project({}, {
      'node_modules/main-node/package.json': JSON.stringify({ name: 'main-node', version: '1.0.0', main: 'addon.node' }),
      'node_modules/main-node/addon.node': 'not really a binary',
      'src/index.ts': `import addon from 'main-node';\nexport const value = addon;\n`,
    });

    const { exit, printed } = await build(dir);

    expect(exit).toBe(1);
    expect(refusals(printed)).toMatch(/native addon/i);
    expect(printed).toContain('node_modules/main-node/addon.node');
    expect(existsSync(join(dir, ARTIFACT))).toBe(false);
  });

  // The common shape in the wild: the package's JS is bundleable, and the
  // binary is located at RUN time (`bindings`, `node-gyp-build`), so esbuild
  // never sees a `.node` import — the package itself is what gives it away.
  const nativePackages = [
    {
      why: 'declares a node-gyp build (`binding.gyp`)',
      files: { 'binding.gyp': `{ 'targets': [] }\n` },
      manifest: {},
    },
    {
      why: 'declares a node-gyp build (`gypfile: true`)',
      files: {},
      manifest: { gypfile: true },
    },
    {
      why: 'ships a compiled `.node` binary',
      files: { 'prebuilds/linux-x64/fake.node': 'not really a binary' },
      manifest: {},
    },
  ];
  for (const { why, files, manifest } of nativePackages) {
    it(`refuses a bundled dependency that ${why}, naming the package`, async () => {
      const pkgFiles: Record<string, string> = {};
      for (const [rel, contents] of Object.entries(files)) pkgFiles[`node_modules/fake-native/${rel}`] = contents;
      const dir = await project({}, {
        ...PURE_DEP,
        ...pkgFiles,
        'node_modules/fake-native/package.json': JSON.stringify({ name: 'fake-native', version: '1.0.0', main: 'index.js', ...manifest }),
        'node_modules/fake-native/index.js':
          `const path = require('path');\nmodule.exports = require(path.join(__dirname, 'build', 'Release', 'fake.node'));\n`,
        'src/index.ts': `import fake from 'fake-native';\nimport pure from 'pure-dep';\nexport const value = [fake, pure];\n`,
      });

      const { exit, printed } = await build(dir);

      expect(exit).toBe(1);
      expect(refusals(printed)).toMatch(/native addon/i);
      expect(printed).toContain('fake-native');
      // Only the native package is named: the pure one it sits beside is not.
      expect(printed).not.toContain('pure-dep');
      expect(existsSync(join(dir, ARTIFACT))).toBe(false);
    });
  }

  it('refuses a `.node` file under `assets/`, naming it', async () => {
    const dir = await project({}, {
      'assets/icon.svg': '<svg/>',
      'assets/bin/addon.node': 'not really a binary',
      'src/index.ts': `export const value = 1;\n`,
    });

    const { exit, printed } = await build(dir);

    expect(exit).toBe(1);
    expect(refusals(printed)).toMatch(/native addon/i);
    expect(printed).toContain('assets/bin/addon.node');
    expect(printed).not.toContain('assets/icon.svg');
    expect(existsSync(join(dir, ARTIFACT))).toBe(false);
  });
});

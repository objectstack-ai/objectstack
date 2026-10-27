// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two builds of an unchanged app give the same legacy runtime module: the same
 * bytes, so the same content-hashed name (`objectstack-runtime.HASH.mjs`) and
 * the same `runtimeModule` ref in `dist/objectstack.json`.
 *
 * ## The defect, measured before the fix
 *
 * `buildRuntimeBundle` wrote its generated esbuild entry beside the config as
 * `.objectstack-runtime.entry.PID.TIMESTAMP.mjs`. esbuild prints every input's
 * path into the bundle, as a `// path` comment above its code and in the inline
 * sourcemap's `sources`, so the pid and `Date.now()` reached the shipped bytes
 * and the name hashed from them: every rebuild named a new file. Those paths
 * were also relative to the process's cwd, so the same app built from another
 * directory or another checkout shipped different bytes too.
 *
 * The entry is now handed to esbuild as `stdin` under one fixed name, and paths
 * are made relative to the config's own directory. This file pins the result
 * in-process (no CLI spawn): `compile.ts` hands the module's file name to the
 * artifact unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRuntimeBundle, type BuildRuntimeResult } from '../src/utils/build-runtime.js';

let root = '';
let appDir = '';
let configPath = '';

/**
 * The hook handler calls `slugOf` from another module, so it cannot be lowered
 * to a metadata body and `os build` bundles it. `loadedConfig` below stands in
 * for what `loadConfig` answers: the module is generated from WHERE each
 * callable sits in it, and re-reads that path from the bundled config.
 */
const handler = async (): Promise<void> => {};
const loadedConfig = { hooks: [{ name: 'rb_slug', object: 'rb_doc', events: ['beforeInsert'], handler }] };
const callables = { rb_slug: handler };

const APP_FILES = ['objectstack.config.ts', 'slug.ts'];

function build(outputDir: string): Promise<BuildRuntimeResult> {
  return buildRuntimeBundle({ sourceConfigPath: configPath, callables, loadedConfig, outputDir });
}

/** The `sources` of the module's inline sourcemap. */
function sourcemapSources(code: string): string[] {
  const m = /^\/\/# sourceMappingURL=data:application\/json;base64,(.+)$/m.exec(code);
  expect(m, 'the module carries no inline sourcemap').not.toBeNull();
  return (JSON.parse(Buffer.from(m![1], 'base64').toString('utf8')) as { sources: string[] }).sources;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-runtime-reproducible-'));
  appDir = join(root, 'app');
  mkdirSync(appDir);
  writeFileSync(
    join(appDir, 'slug.ts'),
    `export const slugOf = (s: unknown): string => String(s).trim().toLowerCase();\n`,
  );
  configPath = join(appDir, 'objectstack.config.ts');
  writeFileSync(
    configPath,
    `import { slugOf } from './slug';

const slugTidy = async (ctx: { input: { title: unknown } }) => { ctx.input.title = slugOf(ctx.input.title); };

export default {
  hooks: [{ name: 'rb_slug', object: 'rb_doc', events: ['beforeInsert'], handler: slugTidy }],
};
`,
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('the legacy runtime module is reproducible', () => {
  it('two builds of an unchanged app give byte-identical modules under one name', async () => {
    const outputDir = join(root, 'dist');
    const first = await build(outputDir);
    const firstBytes = readFileSync(first.outputPath);
    const second = await build(outputDir);
    const secondBytes = readFileSync(second.outputPath);

    expect(second.outputFileName).toBe(first.outputFileName);
    expect(second.hash).toBe(first.hash);
    expect(secondBytes.equals(firstBytes), 'the two builds shipped different bytes').toBe(true);
    expect(readdirSync(outputDir)).toEqual([first.outputFileName]);
  });

  it('the module names its inputs relative to the config, never a per-run or machine-local path', async () => {
    const result = await build(join(root, 'dist-paths'));
    const code = readFileSync(result.outputPath, 'utf8');

    expect([...sourcemapSources(code)].sort()).toEqual(['.objectstack-runtime.entry.mjs', 'objectstack.config.ts', 'slug.ts']);
    // The fixture's mkdtemp directory is the machine-local part of every input path.
    expect(code).not.toContain(basename(root));
  });

  it('writes nothing beside the config, and the module still serves the bundled hook', async () => {
    const result = await build(join(root, 'dist-serve'));
    expect(readdirSync(appDir).sort()).toEqual(APP_FILES);

    const mod = (await import(pathToFileURL(result.outputPath).href)) as {
      functions: Record<string, (ctx: { input: { title: unknown } }) => Promise<void>>;
    };
    expect(Object.keys(mod.functions)).toEqual(['rb_slug']);
    const ctx = { input: { title: '  Hello World ' } };
    await mod.functions.rb_slug(ctx);
    expect(ctx.input.title).toBe('hello world');
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #36647, end to end: a real `os build` of a stack that lists a code plugin,
 * then a real boot of the artifact it wrote. The boot runs none of the app's
 * code plugins, and says so, naming each one, once.
 *
 * The build half is the measured premise. `os build` writes the stack's
 * `plugins` into `objectstack.json` as plain JSON (the instance's own data, no
 * `init`), and nothing on the artifact path turns that back into a plugin:
 * `plugins` are artifact ENVELOPE keys, runtime assembly instructions a host
 * hands to `kernel.use()`, never metadata the artifact carries. The boot half
 * is the fix: the artifact door's `AppPlugin` names every listed plugin the
 * kernel's own table does not hold (`@objectstack/runtime`,
 * `artifact-declared-plugins.ts`), so the drop is no longer silent.
 *
 * The boot reaches `@objectstack/runtime` through its `exports` map, so it
 * measures `dist/`: rebuild the runtime before reading a result here.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStandaloneStack, Runtime } from '@objectstack/runtime';
import Compile from '../src/commands/compile';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const APP_ID = 'com.test.issue-36647-build';
const VECTOR = 'com.test.issue-36647-build.vector';
const INDEXER = 'com.test.issue-36647-build.indexer';
const BOOT_TIMEOUT = 120_000;

/**
 * The stack as an author writes it: two code plugins, live instances with an
 * `init`, the shape `plugins: [new XPlugin()]` evaluates to.
 */
const CONFIG_LITERAL = `{
  manifest: { id: '${APP_ID}', name: 'Plugin Build Probe', version: '1.0.0', type: 'app', namespace: 'probeb' },
  objects: [{ name: 'probeb_clause', label: 'Clause', fields: { title: { type: 'text', label: 'Title' } } }],
  plugins: [
    { name: '${VECTOR}', version: '1.0.0', dependencies: [], options: { dimensions: 1536 }, init: async () => {} },
    { name: '${INDEXER}', version: '1.0.0', dependencies: ['${VECTOR}'], init: async () => {} },
  ],
}`;

let root = '';
let artifactPath = '';

/** Runs `os build` in-process; answers the exit code (0 when the command returned). */
async function build(configPath: string, output: string): Promise<number> {
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((_chunk: unknown, ...rest: unknown[]) => {
    const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    done?.(null);
    return true;
  }) as never);
  const exitCodeBefore = process.exitCode;
  try {
    await Compile.run([configPath, '--output', output], { root: CLI_ROOT });
    return 0;
  } catch (error) {
    const exit = (error as { oclif?: { exit?: unknown } }).oclif?.exit;
    if (typeof exit !== 'number') throw error;
    return exit;
  } finally {
    spy.mockRestore();
    process.exitCode = exitCodeBefore;
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'os-36647-build-'));
  const dir = join(root, 'app');
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'objectstack.config.ts');
  writeFileSync(configPath, defineStackSourceFromLiteral(CONFIG_LITERAL));
  linkSpec(dir);
  artifactPath = join(dir, 'dist', 'objectstack.json');
  expect(await build(configPath, artifactPath)).toBe(0);
}, 60_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#36647 — os build, then an artifact boot of what it wrote', () => {
  it('PREMISE: the artifact holds the plugins as inert descriptors, nothing that can start', () => {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { plugins?: Array<Record<string, unknown>> };
    expect(artifact.plugins?.map((p) => p.name)).toEqual([VECTOR, INDEXER]);
    for (const p of artifact.plugins ?? []) expect(p).not.toHaveProperty('init');
  });

  it('the boot runs neither plugin, and warns once naming both', async () => {
    let kernel: any;
    try {
      const standalone = await createStandaloneStack({
        artifactPath,
        projectRoot: root,
        databaseUrl: ':memory:',
        skipSeedData: true,
        runPlatformMigrations: false,
      });
      kernel = new Runtime({ cluster: false }).getKernel();
      const warn = vi.spyOn(kernel.logger, 'warn');
      for (const p of standalone.plugins) await kernel.use(p as never);
      await kernel.bootstrap();
      // CONTROL: the drop is real.
      expect(kernel.hasPlugin(VECTOR)).toBe(false);
      expect(kernel.hasPlugin(INDEXER)).toBe(false);
      const named = warn.mock.calls
        .map(([message, meta]) => ({ message: String(message), meta: meta as any }))
        .filter(({ meta }) => meta?.appId === APP_ID && Array.isArray(meta?.plugins));
      expect(named).toHaveLength(1);
      expect(named[0]!.meta).toEqual({ appId: APP_ID, plugins: [VECTOR, INDEXER] });
      expect(named[0]!.message).toContain(VECTOR);
      expect(named[0]!.message).toContain(INDEXER);
    } finally {
      try { await kernel?.shutdown(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);
});

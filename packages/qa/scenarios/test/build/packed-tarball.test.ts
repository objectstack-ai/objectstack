// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The PUBLISHED package, read as npm would serve it: `pnpm pack` (the tarball
 * `pnpm publish` uploads: `files[]` plus the `bin` target, every `workspace:`
 * range rewritten to a version), then the tarball installed into a project of
 * its own and its `bin` run under plain Node.
 *
 * Two promises are pinned here:
 *
 *   - **Only the open library ships.** Every `.json` file in the tarball is
 *     the manifest, a card byte for byte equal to one of `docs/qa/scenarios/`,
 *     or a capability area byte for byte equal to one of
 *     `docs/qa/platform-checklist/areas/`; anything else fails, wherever it
 *     sits. The private overlay (held-out and customer-derived cards,
 *     objectstack-ai/cloud#3603) is never in this repository, and a card that
 *     reached the tarball some other way is refused here, not shipped. Every
 *     shipped card is `generic`.
 *   - **The `bin` runs as built JavaScript**, no checkout and no TypeScript
 *     resolver: help, version, the shipped library loaded with no refusal,
 *     and the runner's own refusal of an API-billed login, before anything is
 *     scaffolded.
 *
 * The install links each runtime dependency to the workspace's own build
 * (its `dist/`), so no registry is reached; the scenarios package itself is
 * the extracted tarball, a real directory with nothing but what was packed.
 *
 * Reads `dist/`: build the package first (`pnpm --filter @objectstack/scenarios build`).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = resolve(PKG, '../../..');
const CARDS = 'docs/qa/scenarios';
const AREAS = 'docs/qa/platform-checklist/areas';
const LIBRARY = 'dist/library';
const BIN = 'objectstack-scenarios';

let work = '';
let tarball = '';
/** Paths in the tarball, relative to its `package/` root. */
let packed: string[] = [];
/** The extracted package, installed at `<project>/node_modules/@objectstack/scenarios`. */
let installed = '';
let project = '';
let manifest: { version: string; private?: boolean; bin?: Record<string, string>; dependencies: Record<string, string> };

const jsonFiles = (dir: string) => readdirSync(join(REPO, dir)).filter((n) => n.endsWith('.json')).sort();

function runBin(args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, [join(installed, manifest.bin![BIN]!), ...args], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeAll(() => {
  if (!existsSync(join(PKG, 'dist/bin.js')) || !existsSync(join(PKG, LIBRARY, CARDS))) {
    throw new Error('build @objectstack/scenarios first (pnpm --filter @objectstack/scenarios build): no dist/bin.js or dist/library');
  }
  work = mkdtempSync(join(tmpdir(), 'scenarios-packed-'));
  // Run from the package directory, so the repository's pinned pnpm packs it.
  const out = execFileSync('pnpm', ['pack', '--pack-destination', work], { cwd: PKG, encoding: 'utf8' });
  tarball = join(work, readdirSync(work).find((n) => n.endsWith('.tgz'))!);
  expect(out).toContain(tarball.split('/').pop());

  packed = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l && !l.endsWith('/'))
    .map((l) => l.replace(/^package\//, ''))
    .sort();

  project = join(work, 'project');
  mkdirSync(join(project, 'node_modules/@objectstack'), { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'scenarios-npx-smoke', private: true }));
  execFileSync('tar', ['-xzf', tarball, '-C', work]);
  installed = join(project, 'node_modules/@objectstack/scenarios');
  renameSync(join(work, 'package'), installed);
  manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')) as typeof manifest;
  for (const dep of Object.keys(manifest.dependencies)) {
    const to = join(project, 'node_modules', dep);
    mkdirSync(dirname(to), { recursive: true });
    symlinkSync(realpathSync(join(PKG, 'node_modules', dep)), to, 'dir');
  }
}, 120_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe('the packed @objectstack/scenarios tarball', () => {
  it('is publishable and names its bin', () => {
    expect(manifest.private).toBeUndefined();
    expect(manifest.bin).toEqual({ [BIN]: './bin/objectstack-scenarios.js' });
    expect(packed).toContain('bin/objectstack-scenarios.js');
    // Every `workspace:` range became a version the registry can serve.
    expect(Object.values(manifest.dependencies).filter((v) => v.startsWith('workspace:'))).toEqual([]);
  });

  it('carries every open card and every capability area, byte for byte', () => {
    for (const [dir, names] of [
      [CARDS, jsonFiles(CARDS)],
      [AREAS, jsonFiles(AREAS)],
    ] as const) {
      expect(names.length, dir).toBeGreaterThan(0);
      expect(packed.filter((p) => p.startsWith(`${LIBRARY}/${dir}/`)).map((p) => p.slice(`${LIBRARY}/${dir}/`.length))).toEqual(names);
      for (const name of names) {
        expect(readFileSync(join(installed, LIBRARY, dir, name)).equals(readFileSync(join(REPO, dir, name))), `${dir}/${name}`).toBe(true);
      }
    }
  });

  it('carries no other JSON: a card from anywhere but docs/qa/scenarios is refused', () => {
    const allowed = new Set(['package.json', ...jsonFiles(CARDS).map((n) => `${LIBRARY}/${CARDS}/${n}`), ...jsonFiles(AREAS).map((n) => `${LIBRARY}/${AREAS}/${n}`)]);
    expect(packed.filter((p) => p.endsWith('.json') && !allowed.has(p))).toEqual([]);
  });

  it('ships only generic cards, never a held-out or customer-derived one', () => {
    const shipped = packed.filter((p) => p.startsWith(`${LIBRARY}/${CARDS}/`));
    expect(shipped.length).toBeGreaterThan(0);
    for (const p of shipped) {
      expect((JSON.parse(readFileSync(join(installed, p), 'utf8')) as { origin?: unknown }).origin, p).toBe('generic');
    }
  });

  it('keeps the runner out of the bin: help and version load dist/bin.js alone', () => {
    // The runner's graph (objectql, plugin-sharing, spec) costs about a second warm and
    // several seconds cold; only `run` may pay it, through the built `dist/cli.js`.
    const bin = readFileSync(join(installed, 'dist/bin.js'), 'utf8');
    expect(bin.match(/from\s*["'][^"']+["']/g) ?? []).toEqual(['from "fs"', 'from "path"', 'from "url"']);
    expect(bin).toContain('import("./cli.js")');
    expect(packed).toContain('dist/cli.js');
  });

  it('ships JavaScript and declarations, never a TypeScript source', () => {
    expect(packed.filter((p) => /\.(c|m)?ts$/.test(p) && !/\.d\.(c|m)?ts$/.test(p))).toEqual([]);
    expect(packed.filter((p) => p.startsWith('src/') || p.startsWith('test/') || p.startsWith('scripts/'))).toEqual([]);
  });
});

/**
 * Each `run` case spawns Node over the runner's whole graph once. Measured: about
 * 1.3 s warm in a dev container; 5.7 s and 6.5 s cold on a CI Test Core runner
 * (run 42400730182, where vitest's 5 s default timed both out). Budgeted at
 * 30 s each, as `built-consumer.test.ts` budgets its own spawn of the same graph.
 */
const RUN_SPAWN_BUDGET_MS = 30_000;

describe('the packed bin, run under plain Node', () => {
  it('prints its usage and its version', () => {
    const help = runBin(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain(`Usage: ${BIN} <command>`);
    const version = runBin(['version']);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(manifest.version);
    const none = runBin([]);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain('name a command');
  });

  it('runs the library it ships: every card loads, none matches an unknown id', () => {
    const r = runBin(['run', '--only', 'no_such_card']);
    expect(r.stderr.trim()).toBe(`no card to run under ${join(realpathSync(installed), LIBRARY, CARDS)} matching no_such_card`);
    expect(r.status).toBe(2);
  }, RUN_SPAWN_BUDGET_MS);

  it('refuses an API-billed login before it scaffolds anything', () => {
    // A stand-in `claude` on a subscription login: only the key in the environment can refuse it.
    const fakeBin = join(work, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      join(fakeBin, 'claude'),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; else echo \'{"loggedIn":true,"authMethod":"claude.ai"}\'; fi\n',
    );
    chmodSync(join(fakeBin, 'claude'), 0o755);
    const scaffolds = join(work, 'scaffolds');
    const r = runBin(['run', '--only', 'service_desk', '--modes', 'scratch', '--work', scaffolds], {
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
      ANTHROPIC_API_KEY: 'sk-ant-smoke',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('`ANTHROPIC_API_KEY` is set');
    expect(readdirSync(scaffolds)).toEqual([]);
  }, RUN_SPAWN_BUDGET_MS);
});

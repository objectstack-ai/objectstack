// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack build` writes the runtime module (`objectstack-runtime.*.mjs`)
 * whenever a callable still needs it, and its default-path warning counts each
 * refused handler once.
 *
 * ## The defect, measured before the fix
 *
 * `compile.ts` decided the module from `count - bodyExtracted` plus the
 * extraction warnings. `count` is per callable and `bodyExtracted` per lowered
 * SLOT, so a callable lowered at two slots cancelled a `functions` entry beside
 * it. The build printed `Skipping legacy runtime bundle (all 2 callables are
 * body-only)`, exited 0 and wrote `dist/objectstack.json` alone, so the
 * `functions` entry shipped with no implementation. Three shapes did it:
 *
 *   - the same hook at the top level and in a `packages[i].manifest` body
 *     (walked twice, lowered twice), beside a `functions` entry;
 *   - one handler shared by two hooks in one walk, beside a `functions` entry;
 *   - one function bound as a lowered hook handler AND as a `functions` entry.
 *     That one `lowerCallables`' `bodylessCallables` missed as well, so the
 *     list itself changed: a slot with no body keeps its callable on it.
 *
 * The module is now decided from `bodylessCallables`, the list `--strict-body`
 * counts. `test/lower-callables.test.ts` pins that list over the shapes; this
 * file pins the door: the module on disk, the artifact pointing at it, and the
 * `functions` entry resolving to a callable that runs through the runtime's own
 * artifact loader (`loadArtifactBundle`, which merges the module's `functions`).
 *
 * The CLI runs through `bin/run-dev.js` (source, via tsx). Its dependencies,
 * `@objectstack/runtime` included, resolve through `exports` to `dist/`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArtifactBundle } from '@objectstack/runtime';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
/** A cold `tsx` spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 120_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

const SKIP_LINE = /Skipping legacy runtime bundle \(all \d+ callables are body-only\)/;
const RUNTIME_MODULE = /^objectstack-runtime\.[a-f0-9]+\.mjs$/;

/** The module files `os build` left in `<dir>/dist`. */
function runtimeModules(dir: string): string[] {
  const dist = join(dir, 'dist');
  return existsSync(dist) ? readdirSync(dist).filter((f) => RUNTIME_MODULE.test(f)) : [];
}

function artifactPath(dir: string): string {
  return join(dir, 'dist', 'objectstack.json');
}

/**
 * The stack source. `tidy` is a handler the extractor lowers (parameters and
 * globals only); `slugTidy` names the module-scope `slugOf`, so it is refused.
 * The `pb_doc` / `pb_note` objects are what the hooks bind to.
 */
function config(literal: string): string {
  return `import { defineStack } from '@objectstack/spec';

const slugOf = (s) => String(s).toLowerCase();
const tidy = async (ctx) => { ctx.input.title = String(ctx.input.title).trim(); };
const slugTidy = async (ctx) => { ctx.input.title = slugOf(ctx.input.title); };
const pbScore = (input) => 1;

const manifest = { id: 'com.example.pb', name: 'pb', version: '1.0.0', type: 'app', namespace: 'pb' };
const doc = { name: 'pb_doc', label: 'Doc', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } };
const note = { name: 'pb_note', label: 'Note', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } };
const tidyHook = { name: 'pb_tidy', object: 'pb_doc', events: ['beforeInsert'], handler: tidy };
const slugHook = { name: 'pb_slug', object: 'pb_doc', events: ['beforeInsert'], handler: slugTidy };

export default defineStack(${literal.trim()}, { strict: false });
`;
}

const FIXTURES = {
  // The card's shape: one lowerable hook and one `functions` entry, both at the
  // top level AND inside `packages[0].manifest`.
  'two-level': `{
  manifest, objects: [doc], hooks: [tidyHook], functions: { pb_score: pbScore },
  packages: [{ manifest: { ...manifest, objects: [doc], hooks: [tidyHook], functions: { pb_score: pbScore } } }],
}`,
  // One walk: one handler shared by hooks on two objects, beside a `functions` entry.
  'shared-handler': `{
  manifest, objects: [doc, note],
  hooks: [{ ...tidyHook, name: 'pb_tidy_doc' }, { ...tidyHook, name: 'pb_tidy_note', object: 'pb_note' }],
  functions: { pb_score: pbScore },
}`,
  // One walk: one function bound as a lowered hook handler AND as a `functions` entry.
  'hook-and-function': `{
  manifest, objects: [doc], hooks: [tidyHook], functions: { pb_score: tidy },
}`,
  // CONTROLS: every callable lowered, once and in both walks.
  'all-body-only': `{ manifest, objects: [doc], hooks: [tidyHook] }`,
  'all-body-only-two-level': `{
  manifest, objects: [doc], hooks: [tidyHook],
  packages: [{ manifest: { ...manifest, objects: [doc], hooks: [tidyHook] } }],
}`,
  // A refused hook walked twice: the default-path warning names it once.
  'refused-two-level': `{
  manifest, objects: [doc], hooks: [slugHook],
  packages: [{ manifest: { ...manifest, objects: [doc], hooks: [slugHook] } }],
}`,
} as const;
type Fixture = keyof typeof FIXTURES;

const dirs = {} as Record<Fixture, string>;
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-runtime-bundle-bodyless-'));
  for (const [label, literal] of Object.entries(FIXTURES) as Array<[Fixture, string]>) {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), config(literal));
    linkSpec(dir);
    dirs[label] = dir;
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Build, and assert the runtime module was written and the artifact points at it. */
async function buildWritesModule(label: Fixture): Promise<{ artifact: Record<string, any>; out: string }> {
  const run = await runCli(['build'], dirs[label]);
  const out = `${run.stdout}${run.stderr}`;
  expect(run.code, out).toBe(0);
  expect(out).not.toMatch(SKIP_LINE);
  const modules = runtimeModules(dirs[label]);
  expect(modules, out).toHaveLength(1);
  const artifact = JSON.parse(readFileSync(artifactPath(dirs[label]), 'utf8')) as Record<string, any>;
  expect(artifact.runtimeModule).toBe(`./${modules[0]}`);
  return { artifact, out };
}

describe('os build writes the runtime module when a `functions` entry still needs it', () => {
  it('two-level stack: the module is written, and `pb_score` runs through the runtime artifact loader', async () => {
    const { artifact } = await buildWritesModule('two-level');
    // Both copies of the entry name the same ref, at the top level and in the package body.
    expect(artifact.functions).toEqual({ pb_score: 'pb_score' });
    expect(artifact.packages[0].manifest.functions).toEqual({ pb_score: 'pb_score' });

    const loaded = await loadArtifactBundle(artifactPath(dirs['two-level']));
    expect(typeof loaded?.functions?.pb_score, 'the module supplied no `pb_score`').toBe('function');
    expect(await loaded.functions.pb_score({})).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it('one handler shared by two hooks, beside a `functions` entry: the module is written and `pb_score` runs', async () => {
    const { artifact } = await buildWritesModule('shared-handler');
    expect(artifact.functions).toEqual({ pb_score: 'pb_score' });

    const loaded = await loadArtifactBundle(artifactPath(dirs['shared-handler']));
    expect(await loaded?.functions?.pb_score({})).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it('one function as a lowered hook handler AND a `functions` entry: the module is written', async () => {
    const { artifact } = await buildWritesModule('hook-and-function');
    // The hook still ships its lowered body; the entry is what needs the module.
    expect(artifact.hooks[0].body?.language).toBe('js');

    // Every `functions` entry the artifact declares resolves to a callable.
    const loaded = await loadArtifactBundle(artifactPath(dirs['hook-and-function']));
    const declared = Object.keys(artifact.functions as Record<string, unknown>);
    expect(declared).toHaveLength(1);
    for (const key of declared) expect(typeof loaded?.functions?.[key], key).toBe('function');
  }, SPAWN_TIMEOUT_MS);

  it.each(['all-body-only', 'all-body-only-two-level'] as const)(
    'CONTROL — %s: the module is still skipped, and none is left in dist/',
    async (label) => {
      const run = await runCli(['build'], dirs[label]);
      const out = `${run.stdout}${run.stderr}`;
      expect(run.code, out).toBe(0);
      expect(out).toMatch(SKIP_LINE);
      expect(runtimeModules(dirs[label])).toEqual([]);
      const artifact = JSON.parse(readFileSync(artifactPath(dirs[label]), 'utf8')) as Record<string, any>;
      expect(artifact.runtimeModule).toBeUndefined();
      expect(artifact.hooks[0].body?.language).toBe('js');
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('the default build warning counts each refused handler once', () => {
  it('a refused hook at the top level and in a package body is one handler, in the warning and in the summary', async () => {
    const { out } = await buildWritesModule('refused-two-level');
    expect(out).toContain('1 handler could not be lowered to a metadata body');
    expect(out.match(/^ {2}• hook 'pb_slug':/gm), out).toHaveLength(1);
    expect(out).toContain('1 handler(s) bundled instead of lowered to a metadata body');
  }, SPAWN_TIMEOUT_MS);
});

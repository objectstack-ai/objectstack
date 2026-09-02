// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 producer side — `os build` compiles a project of N packages into
 * ONE artifact carrying `packages[]` (#14439), and the assembled bodies it
 * writes are what the load path registers.
 *
 * ## The three parse seams, and why the compile one is pinned HERE
 *
 * An assembled `packages[]` body has to survive three parses, all of them
 * `ObjectStackDefinitionSchema`:
 *
 *   1. authoring — `defineStack` (pinned in `@objectstack/spec`)
 *   2. compile   — `compile.ts`'s `ObjectStackDefinitionSchema.safeParse` of the
 *                  LOWERED stack, which is what this file runs end to end
 *   3. load      — the metadata service's artifact door
 *
 * Seam 2 is the only one that can be measured through the real command, with
 * the real lowering and the real writer, which is what these tests do: they run
 * `os build` in a temp project and read the artifact off disk.
 *
 * ## What would be green without this file
 *
 * Three failures, each silent end to end:
 *
 *   - **No `packages[]` written at all.** `os build` had zero handling of the
 *     key; a project of N packages compiled to one flat artifact, and the
 *     registration that ADR-0130 exists for simply never happened.
 *   - **Handlers inside a package body dropped.** A `packages`-carrying artifact
 *     is registered THROUGH that list, so a callable lowered at the top level
 *     and left raw inside `packages[i].manifest` is a callable the runtime never
 *     gets — `JSON.stringify` drops a `function` value without a word, the
 *     artifact validates, the build exits 0, and the hook is not there at boot.
 *   - **A malformed body accepted.** Authoring globs where definitions belong
 *     name no files in a compiled artifact, so the package installs owning
 *     nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

interface Run { code: number; stdout: string; stderr: string }

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

/**
 * A two-package project, written the way `composeStacks(…, { manifest:
 * 'preserve' })` writes it: the collections flattened to the top level AND the
 * same content assembled onto each package body, sharing one callable object.
 *
 * Hand-written rather than composed so this file resolves nothing from the
 * workspace — the shape is what is under test, and `composeStacks` producing it
 * is pinned where that function lives.
 */
const CONFIG_MULTI = `
const stampOrder = async () => { return { ok: true }; };

const account = {
  name: 'mp_account', label: 'Account', sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' } },
};
const order = {
  name: 'mp_order', label: 'Order', sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Number' } },
};
const orderHook = { name: 'mp_order_before_insert', object: 'mp_order', events: ['beforeInsert'], handler: stampOrder };

const coreManifest = { id: 'com.example.mp.core', name: 'core', version: '1.0.0', type: 'app', namespace: 'mp' };
const ordersManifest = {
  id: 'com.example.mp.orders', name: 'orders', version: '1.0.0', type: 'module', namespace: 'mp',
  dependencies: { 'com.example.mp.core': '^1.0.0' },
};

export default {
  manifest: coreManifest,
  objects: [account, order],
  hooks: [orderHook],
  packages: [
    { manifest: { ...ordersManifest, objects: [order], hooks: [orderHook] } },
    { manifest: { ...coreManifest, objects: [account] } },
  ],
};
`;

/** The same project with ONE package and no `packages` key — the D7 branch. */
const CONFIG_SINGLE = `
const stampOrder = async () => { return { ok: true }; };
export default {
  manifest: { id: 'com.example.mp.solo', name: 'solo', version: '1.0.0', type: 'app', namespace: 'mp' },
  objects: [
    { name: 'mp_order', label: 'Order', sharingModel: 'private', fields: { name: { type: 'text', label: 'Number' } } },
  ],
  hooks: [{ name: 'mp_order_before_insert', object: 'mp_order', events: ['beforeInsert'], handler: stampOrder }],
};
`;

/** A package body still carrying the AUTHORING manifest's glob patterns. */
const CONFIG_GLOBS = `
export default {
  manifest: { id: 'com.example.mp.core', name: 'core', version: '1.0.0', type: 'app', namespace: 'mp' },
  objects: [
    { name: 'mp_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } },
  ],
  packages: [
    { manifest: { id: 'com.example.mp.core', name: 'core', version: '1.0.0', type: 'app', namespace: 'mp', objects: ['./src/objects/*.object.ts'] } },
  ],
};
`;

interface Artifact {
  manifest?: { id?: string };
  objects?: Array<{ name: string }>;
  hooks?: Array<{ name: string; handler?: unknown; body?: unknown }>;
  packages?: Array<{ manifest: { id: string; objects?: Array<{ name: string }>; hooks?: Array<{ name: string; handler?: unknown }> } }>;
}

const dirs: Record<string, string> = {};
let root = '';

const artifactOf = (dir: string): Artifact =>
  JSON.parse(readFileSync(join(dir, 'dist', 'objectstack.json'), 'utf8')) as Artifact;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-multi-package-'));
  for (const [name, config] of Object.entries({ multi: CONFIG_MULTI, single: CONFIG_SINGLE, globs: CONFIG_GLOBS })) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), config);
    dirs[name] = dir;
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('ADR-0130 D4 — `os build` emits one artifact carrying `packages[]`', () => {
  let built: Run;

  beforeAll(async () => {
    built = await runCli(['build'], dirs.multi);
  }, 180_000);

  it('the fixture reaches the code path: exit 0, and the per-package leg ran', () => {
    // Asserted before anything is read off the artifact: a build that failed
    // would let every "the artifact does not contain X" assertion below pass
    // for the wrong reason.
    expect(built.code, `${built.stdout}\n${built.stderr}`).toBe(0);
    expect(built.stdout).toContain('Running author-time rules per package (2)');
  });

  it('writes `packages[]`, each entry an ASSEMBLED body owning its own metadata', () => {
    const artifact = artifactOf(dirs.multi);
    expect(artifact.packages?.map((p) => p.manifest.id)).toEqual([
      'com.example.mp.orders',
      'com.example.mp.core',
    ]);
    // Per-package ownership is the whole point: without it a two-package
    // artifact installs two package records owning nothing.
    expect(artifact.packages?.[0].manifest.objects?.map((o) => o.name)).toEqual(['mp_order']);
    expect(artifact.packages?.[1].manifest.objects?.map((o) => o.name)).toEqual(['mp_account']);
  });

  it('keeps the flattened top level — `packages[]` is ADDITIVE', () => {
    // The metadata service's artifact door iterates the top-level collections,
    // so dropping them in favour of `packages[]` would leave a booted instance
    // with no views, flows or permission sets at all.
    const artifact = artifactOf(dirs.multi);
    expect(artifact.objects?.map((o) => o.name).sort()).toEqual(['mp_account', 'mp_order']);
  });

  it('LOWERS the callables inside a package body — under the SAME ref as the top level', () => {
    // The silent-drop defect: an un-lowered handler is a `function` value and
    // `JSON.stringify` removes the key without a word. Two assertions, because
    // "it is a string" and "it is the SAME string" fail differently — a second
    // ref would bundle one implementation twice and leave the artifact's two
    // copies naming different handlers.
    const artifact = artifactOf(dirs.multi);
    const topRef = artifact.hooks?.[0]?.handler;
    const pkgRef = artifact.packages?.[0].manifest.hooks?.[0]?.handler;

    expect(typeof topRef).toBe('string');
    expect(typeof pkgRef).toBe('string');
    expect(pkgRef).toBe(topRef);
  });

  it('refuses a package body carrying authoring GLOBS, naming the path', async () => {
    const run = await runCli(['build', '--json'], dirs.globs);
    expect(run.code).toBe(1);
    const payload = JSON.parse(run.stdout) as { success: boolean; errors?: Array<{ path?: unknown[] }> };
    expect(payload.success).toBe(false);
    const paths = (payload.errors ?? []).map((e) => (e.path ?? []).join('.'));
    expect(paths).toContain('packages.0.manifest.objects.0');
  }, 180_000);
});

describe('ADR-0130 D7 — the single-package path is untouched', () => {
  it('emits NO `packages` key, and the ref names are the ones the lowering always minted', async () => {
    const run = await runCli(['build'], dirs.single);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    // The negative half of D7 at the compile door: a build that started minting
    // an empty `packages: []` for every single-package project would change
    // what every existing artifact carries, and the load path reads the key's
    // PRESENCE as the branch selector.
    const artifact = artifactOf(dirs.single);
    expect(artifact.packages).toBeUndefined();
    expect('packages' in artifact).toBe(false);

    // Ref identity: the hook lowers to its own name, not to a de-duplicated
    // `…__2`. Nothing is walked twice on this path, so nothing can collide —
    // asserted rather than argued, because the collision would be invisible in
    // the artifact (a valid ref that simply is not the one it used to be).
    expect(artifact.hooks?.[0]?.handler).toBe('mp_order_before_insert');

    // The per-package leg does not run at all — no packages, no second pass.
    expect(run.stdout).not.toContain('per package');
  }, 180_000);
});

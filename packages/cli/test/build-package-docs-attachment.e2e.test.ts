// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18431 end to end — `os build` reads `src/<pkg>/docs/` and writes those docs
 * onto the OWNING package's body, through the real command, the real lint and
 * the real writer.
 *
 * ## What would be green without this file
 *
 * The unit pins next to the collector
 * (`src/utils/collect-docs.package-docs.test.ts`) judge the collector. They
 * cannot see the two things only the command decides:
 *
 *   - **where the docs land in the emitted JSON.** The ruling puts them at
 *     `packages[i].manifest.docs` and ⛔ not at the top level, and the artifact
 *     on disk is the only place that distinction is observable.
 *   - **that the build still exits 0.** The per-package lint runs with a
 *     DIFFERENT namespace than the artifact manifest's; if the stack-level pass
 *     also judged those docs, this build would exit 1 on
 *     `docs/namespace-prefix` — and every `toEqual` about the artifact would be
 *     reading a file the previous run wrote.
 *
 * ⚠️ Pedigree, not counts. Each fixture doc carries a MARKER string written into
 * exactly one file on disk, and the assertions read the marker out of the
 * artifact — a count of 1 is satisfiable by an echo of the flat `src/docs/`
 * doc, which is the failure shape this package measured twice this month.
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
 * Two packages that do NOT share a namespace, written the way
 * `composeStacks(…, { manifest: 'preserve' })` writes one: collections
 * flattened to the top level AND assembled onto each package body.
 *
 * The namespaces differ on purpose. `orders` is `ord` while the artifact
 * manifest is `pkgdocs`, so a single global prefix rule — the pre-ruling
 * behaviour — refuses `ord_playbook` and the build exits 1.
 */
const CONFIG_MULTI = `
const account = {
  name: 'pkgdocs_account', label: 'Account', sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' } },
};
const order = {
  name: 'ord_order', label: 'Order', sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Number' } },
};

const coreManifest = { id: 'com.example.pkgdocs.core', name: 'core', version: '1.0.0', type: 'app', namespace: 'pkgdocs' };
const ordersManifest = {
  id: 'com.example.pkgdocs.orders', name: 'orders', version: '1.0.0', type: 'module', namespace: 'ord',
  dependencies: { 'com.example.pkgdocs.core': '^1.0.0' },
};

export default {
  manifest: coreManifest,
  objects: [account, order],
  packages: [
    { manifest: { ...coreManifest, objects: [account] } },
    { manifest: { ...ordersManifest, objects: [order] } },
  ],
};
`;

/** A single-package project with a flat `src/docs/` — the shape that must not move. */
const CONFIG_FLAT = `
export default {
  manifest: { id: 'com.example.flat', name: 'flat', version: '1.0.0', type: 'app', namespace: 'flat' },
  objects: [
    { name: 'flat_thing', label: 'Thing', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } },
  ],
};
`;

const MARKER_PKG = 'MARKER-package-doc-18431';
const MARKER_FLAT = 'MARKER-flat-doc-18431';

interface Artifact {
  docs?: Array<{ name: string; content?: string }>;
  packages?: Array<{ manifest: { id: string; namespace?: string; docs?: Array<{ name: string; content?: string }> } }>;
}

const readArtifact = (dir: string): Artifact =>
  JSON.parse(readFileSync(join(dir, 'dist', 'objectstack.json'), 'utf8')) as Artifact;

const dirs = { multi: '', flat: '' };
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-pkg-docs-e2e-'));

  dirs.multi = join(root, 'multi');
  mkdirSync(join(dirs.multi, 'src', 'orders', 'docs'), { recursive: true });
  mkdirSync(join(dirs.multi, 'src', 'docs'), { recursive: true });
  writeFileSync(join(dirs.multi, 'objectstack.config.ts'), CONFIG_MULTI);
  // Owned by `com.example.pkgdocs.orders` — directory name === manifest `name`,
  // and its own namespace `ord` is what the name must be prefixed with.
  writeFileSync(
    join(dirs.multi, 'src', 'orders', 'docs', 'ord_playbook.md'),
    `# Orders Playbook\n\n${MARKER_PKG}\n`,
  );
  // The stack's own flat doc, which keeps `stack.manifest.namespace`.
  writeFileSync(join(dirs.multi, 'src', 'docs', 'pkgdocs_index.md'), `# Index\n\n${MARKER_FLAT}\n`);

  dirs.flat = join(root, 'flat');
  mkdirSync(join(dirs.flat, 'src', 'docs'), { recursive: true });
  writeFileSync(join(dirs.flat, 'objectstack.config.ts'), CONFIG_FLAT);
  writeFileSync(join(dirs.flat, 'src', 'docs', 'flat_index.md'), `# Flat Index\n\n${MARKER_FLAT}\n`);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#18431] per-package docs reach the owning package body', () => {
  it('attaches to packages[i].manifest.docs and ⛔ not to the artifact top level', async () => {
    const run = await runCli(['build'], dirs.multi);
    // Asserted first: a non-zero exit makes every claim below vacuous, and a
    // build that refused `ord_playbook` under the artifact prefix is exactly
    // the pre-ruling behaviour this case exists to distinguish from.
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);

    const artifact = readArtifact(dirs.multi);
    const orders = artifact.packages?.find((p) => p.manifest.id === 'com.example.pkgdocs.orders');
    expect(orders, 'the orders package entry').toBeDefined();
    expect(orders!.manifest.docs?.map((d) => d.name)).toEqual(['ord_playbook']);
    // Pedigree: the bytes came out of that one file, not out of the flat doc.
    expect(orders!.manifest.docs?.[0].content).toContain(MARKER_PKG);

    // The core package was never given docs, and the top level carries only the
    // stack's own flat doc — the ruling's clause 1, read off the emitted JSON.
    const core = artifact.packages?.find((p) => p.manifest.id === 'com.example.pkgdocs.core');
    expect(core!.manifest.docs).toBeUndefined();
    expect(artifact.docs?.map((d) => d.name)).toEqual(['pkgdocs_index']);
    expect(JSON.stringify(artifact.docs)).not.toContain(MARKER_PKG);
  }, 120_000);

  it('reports the whole collection on the step line, package directories named', async () => {
    const run = await runCli(['build'], dirs.multi);
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);
    // 1 flat + 1 package doc. A count of 1 here would mean the package pass ran
    // and the author was told nothing about it.
    expect(run.stdout).toMatch(/Collecting package docs \(ADR-0046\)\.\.\.\s*2 collected \(1 from 1 package directory\)/);
    // ⛔ And the #18428 warning must NOT fire for a directory that WAS read.
    expect(run.stdout).not.toMatch(/docs\/uncollected-directory/);
  }, 120_000);

  it('a single-package project keeps its flat docs at the top level, with no packages[] invented', async () => {
    const run = await runCli(['build'], dirs.flat);
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);

    const artifact = readArtifact(dirs.flat);
    expect(artifact.docs?.map((d) => d.name)).toEqual(['flat_index']);
    expect(artifact.docs?.[0].content).toContain(MARKER_FLAT);
    expect(artifact).not.toHaveProperty('packages');
    expect(run.stdout).toMatch(/Collecting package docs \(ADR-0046\)\.\.\.\s*1 collected(?! \()/);
  }, 120_000);
});

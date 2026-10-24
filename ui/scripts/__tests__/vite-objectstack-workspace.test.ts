/**
 * `scripts/vite-objectstack-workspace.ts` -- the console's `@objectstack/*`
 * module-id tests, with the objectstack monorepo's `packages/` directory as
 * one more alternative (objectstack ruling D1: objectui becomes `ui/`).
 *
 * Two directions are pinned. STANDALONE, the directory the alternative names
 * does not exist beside this checkout and the three tests ARE the baseline
 * literals, byte for byte -- `vite-objectstack-spec-dist.test.ts` pins the
 * vendor literal as a flagged surface (objectui#4854), so "matches nothing"
 * is not enough; the alternative must not be there at all.
 * MERGED, an id under `<monorepo>/packages/<name>/dist/` is the vendor group
 * (spec in, lint out) and the two probes find their subjects; measured on the
 * spike, the baseline missed all three and the console build failed on its own
 * lazy-linter guard.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BASELINE_CHUNK_TESTS,
  candidateFrameworkPackagesDir,
  escapeRegExp,
  frameworkPackagesDir,
  workspaceChunkTests,
} from '../vite-objectstack-workspace.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const consoleDir = path.join(repoRoot, 'apps/console');

/** A monorepo laid out as the spike wired it: `<root>/ui/apps/console`, `<root>/packages/<name>`. */
const MONOREPO = '/srv/objectstack';
const merged = workspaceChunkTests(candidateFrameworkPackagesDir(path.join(MONOREPO, 'ui/apps/console')));
const standalone = workspaceChunkTests(frameworkPackagesDir(consoleDir));

const PLAIN_SPEC = '/w/node_modules/@objectstack/spec/dist/index.mjs';
const STORE_SPEC = '/w/node_modules/.pnpm/@objectstack+spec@18.1.0/node_modules/@objectstack/spec/dist/index.mjs';
const PLAIN_LINT = '/w/node_modules/@objectstack/lint/dist/index.js';
const STORE_LINT = '/w/node_modules/.pnpm/@objectstack+lint@18.1.0/node_modules/@objectstack/lint/dist/index.js';
const PLAIN_CLIENT = '/w/node_modules/@objectstack/client/dist/index.js';

describe('workspaceChunkTests (objectstack ruling D1)', () => {
  it('locates the monorepo packages dir three levels above the console, and names it only when it exists', () => {
    expect(candidateFrameworkPackagesDir(path.join(MONOREPO, 'ui/apps/console'))).toBe(path.join(MONOREPO, 'packages'));
    expect(candidateFrameworkPackagesDir(consoleDir)).toBe(path.resolve(repoRoot, '../packages'));
    // The standing fact the standalone pin rests on, checked rather than assumed.
    expect(existsSync(candidateFrameworkPackagesDir(consoleDir))).toBe(false);
    expect(frameworkPackagesDir(consoleDir)).toBeNull();
    expect(frameworkPackagesDir(path.join(MONOREPO, 'ui/apps/console'))).toBeNull();
    // A real monorepo-shaped tree: the directory exists, so it is named.
    const root = mkdtempSync(path.join(os.tmpdir(), 'objectstack-workspace-'));
    try {
      const console = path.join(root, 'ui/apps/console');
      mkdirSync(console, { recursive: true });
      expect(frameworkPackagesDir(console)).toBeNull();
      mkdirSync(path.join(root, 'packages'));
      expect(frameworkPackagesDir(console)).toBe(path.join(root, 'packages'));
      // A FILE of that name is not the directory.
      rmSync(path.join(root, 'packages'), { recursive: true });
      writeFileSync(path.join(root, 'packages'), '');
      expect(frameworkPackagesDir(console)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('standalone: the three tests are the baseline literals, byte for byte', () => {
    expect(standalone).toBe(BASELINE_CHUNK_TESTS);
    expect(standalone.vendor.source).toBe(
      '([\\\\/]node_modules[\\\\/]@objectstack[\\\\/](?!lint[\\\\/])|[\\\\/]@objectstack\\+(?!lint@))',
    );
    expect(standalone.spec.source).toBe('@objectstack[\\\\/+]spec');
    expect(standalone.lint.source).toBe('@objectstack[\\\\/+]lint');
    // And merged is a widening of them: every baseline arm is still there.
    for (const key of ['vendor', 'spec', 'lint'] as const) {
      expect(merged[key].source).toContain(BASELINE_CHUNK_TESTS[key].source.replace(/^\(|\)$/g, ''));
    }
  });

  it('keeps every baseline spelling: plain install and pnpm store, spec in, lint out', () => {
    for (const tests of [standalone, merged]) {
      expect(tests.vendor.test(PLAIN_SPEC)).toBe(true);
      expect(tests.vendor.test(STORE_SPEC)).toBe(true);
      expect(tests.vendor.test(PLAIN_CLIENT)).toBe(true);
      expect(tests.vendor.test(PLAIN_LINT)).toBe(false);
      expect(tests.vendor.test(STORE_LINT)).toBe(false);
      expect(tests.spec.test(PLAIN_SPEC)).toBe(true);
      expect(tests.spec.test(STORE_SPEC)).toBe(true);
      expect(tests.spec.test(PLAIN_LINT)).toBe(false);
      expect(tests.lint.test(PLAIN_LINT)).toBe(true);
      expect(tests.lint.test(STORE_LINT)).toBe(true);
      expect(tests.lint.test(PLAIN_SPEC)).toBe(false);
      // A `lint-*` sibling is not the linter and still groups.
      expect(tests.vendor.test('/w/node_modules/@objectstack/lint-extra/dist/index.js')).toBe(true);
    }
  });

  it('merged: an id under the monorepo packages dir is the vendor group, with the linter excluded and both probes live', () => {
    const spec = `${MONOREPO}/packages/spec/dist/index.mjs`;
    const client = `${MONOREPO}/packages/client/dist/index.js`;
    const lint = `${MONOREPO}/packages/lint/dist/index.js`;
    expect(merged.vendor.test(spec)).toBe(true);
    expect(merged.vendor.test(client)).toBe(true);
    expect(merged.vendor.test(lint)).toBe(false);
    expect(merged.vendor.test(`${MONOREPO}/packages/lint-extra/dist/index.js`)).toBe(true);
    expect(merged.spec.test(spec)).toBe(true);
    expect(merged.spec.test(client)).toBe(false);
    expect(merged.lint.test(lint)).toBe(true);
    expect(merged.lint.test(spec)).toBe(false);
    // The prefix is anchored: a path that merely CONTAINS the packages dir is not it,
    // and objectui's own `ui/packages/<name>` is not the framework.
    expect(merged.vendor.test(`/elsewhere${MONOREPO}/packages/spec/dist/index.mjs`)).toBe(false);
    expect(merged.vendor.test(`${MONOREPO}/ui/packages/core/dist/index.js`)).toBe(false);
    expect(merged.vendor.test(`${MONOREPO}/packages-extra/spec/dist/index.mjs`)).toBe(false);
  });

  it('standalone: a workspace-shaped id under the sibling dir matches nothing, and the spike id is unmatched', () => {
    // The merge-tree id, judged by the STANDALONE tests: no alternative claims it,
    // which is the baseline's reading too (the id carries no node_modules spelling).
    const spikeId = `${MONOREPO}/packages/spec/dist/index.mjs`;
    expect(standalone.vendor.test(spikeId)).toBe(false);
    expect(standalone.spec.test(spikeId)).toBe(false);
    expect(standalone.lint.test(`${MONOREPO}/packages/lint/dist/index.js`)).toBe(false);
    // objectui's own packages, which the standalone alternative must never claim.
    expect(standalone.vendor.test(path.join(repoRoot, 'packages/core/dist/index.js'))).toBe(false);
  });

  it('escapes a directory with regex metacharacters so the prefix is matched literally', () => {
    expect(escapeRegExp('/a.b/c+d (e)')).toBe('/a\\.b/c\\+d \\(e\\)');
    const odd = workspaceChunkTests('/w/pkgs (v1.0)/packages');
    expect(odd.spec.test('/w/pkgs (v1.0)/packages/spec/dist/index.mjs')).toBe(true);
    expect(odd.spec.test('/w/pkgsX(v1A0)/packages/spec/dist/index.mjs')).toBe(false);
  });

  it('is what the console config builds its three tests from', () => {
    const config = readFileSync(path.join(consoleDir, 'vite.config.ts'), 'utf8');
    expect(config).toContain("from '../../scripts/vite-objectstack-workspace.ts'");
    expect(config).toContain('const WORKSPACE_CHUNK_TESTS = workspaceChunkTests(frameworkPackagesDir(import.meta.dirname));');
    expect(config).toContain('const VENDOR_OBJECTSTACK_TEST = WORKSPACE_CHUNK_TESTS.vendor;');
    expect(config).toContain('const SPEC_MODULE_TEST = WORKSPACE_CHUNK_TESTS.spec;');
    expect(config).toContain('const LINT = WORKSPACE_CHUNK_TESTS.lint;');
  });
});

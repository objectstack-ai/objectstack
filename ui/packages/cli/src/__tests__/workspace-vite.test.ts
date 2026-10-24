/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins the module-resolution surface of the generated temp app (objectui#3890).
 *
 * Inside a workspace nothing is installed for the temp app — the alias table is
 * the only thing that resolves a platform package — and the table used to be a
 * hand-kept list of eleven names inside `commands/dev.ts`. Measured on the
 * commit that filed the card: the generated entry's transitive value-imports
 * close over 21 packages, so ten were unaliased, and every module whose
 * transform hit one of them answered 500 (8 of the first 400 modules a browser
 * walk reaches, `packages/plugin-grid/src/ObjectGrid.tsx` among them). Vite's
 * dependency scan named only four of the ten, because a scan stops at the first
 * layer it cannot resolve — which is why the gate below reconciles the table
 * against `pnpm-workspace.yaml` rather than against a list of known-missing
 * names.
 *
 * The reconciliation walks the workspace independently of the code it judges:
 * the helper expands the manifest's patterns with `glob`, this file expands them
 * with its own `readdirSync`. A gate that re-derives its expectation by calling
 * the function under test proves only that the function is deterministic.
 *
 * `serve` and `build` had no workspace branch at all, so the last group asserts
 * that all three commands reach this table through the one shared helper — the
 * property that keeps them from drifting apart a second time.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isWorkspaceRoot,
  resolveLucideAlias,
  workspacePackageDirs,
  workspaceSourceAliases
} from '../utils/workspace-vite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** packages/cli/src/__tests__ -> repo root */
const REPO_ROOT = resolve(__dirname, '../../../..');

const COMMAND_DIR = join(REPO_ROOT, 'packages/cli/src/commands');
/** The three commands that generate and serve a temp app. */
const TEMP_APP_COMMANDS = ['dev.ts', 'serve.ts', 'build.ts'];

/** Extensions a bundler resolves a barrel through, in Vite's own order. */
const BARREL_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx'];

/**
 * The workspace's package directories, expanded WITHOUT the helper under test.
 *
 * Deliberately hand-rolled and deliberately narrow: it understands the two
 * pattern shapes this repo's manifest actually uses (a `dir/*` fan-out and a
 * literal directory) and throws on anything else, so a manifest that grows a
 * shape this expectation cannot read fails loudly here instead of quietly
 * agreeing with whatever the helper returned.
 */
function independentWorkspaceDirs(): string[] {
  const manifest = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf-8');
  const patterns: string[] = [];
  for (const line of manifest.split('\n')) {
    const match = /^\s*-\s*['"]?([^'"#\s]+)['"]?\s*$/.exec(line);
    if (match) patterns.push(match[1]);
  }
  expect(patterns.length).toBeGreaterThan(0);

  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = join(REPO_ROOT, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent)) {
        const full = join(parent, entry);
        if (statSync(full).isDirectory()) dirs.push(full);
      }
    } else if (!pattern.includes('*')) {
      const full = join(REPO_ROOT, pattern);
      if (existsSync(full)) dirs.push(full);
    } else {
      throw new Error(
        `pnpm-workspace.yaml grew the pattern ${JSON.stringify(pattern)} — teach this expectation how to expand it.`
      );
    }
  }
  return dirs;
}

/** Every `@object-ui/*` workspace package that can be consumed from source. */
function independentAliasablePackages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of independentWorkspaceDirs()) {
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const name = (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { name?: unknown }).name;
    if (typeof name !== 'string' || !name.startsWith('@object-ui/')) continue;
    const srcDir = join(dir, 'src');
    if (!BARREL_EXTENSIONS.some((ext) => existsSync(join(srcDir, `index${ext}`)))) continue;
    found.set(name, srcDir);
  }
  return found;
}

const aliases = workspaceSourceAliases(REPO_ROOT);

describe('workspace alias table (objectui#3890)', () => {
  it('covers every @object-ui package the workspace manifest declares', () => {
    const expected = independentAliasablePackages();

    // Sanity: the reconciliation is worthless if either side is empty, and the
    // hand-kept table it replaces held eleven names.
    expect(expected.size).toBeGreaterThan(11);

    expect(Object.keys(aliases).sort()).toEqual([...expected.keys()].sort());
    for (const [name, srcDir] of expected) {
      expect(aliases[name]).toBe(srcDir);
    }
  });

  it('aliases the four packages the card measured as missing', () => {
    // Named individually because these are the ones a browser proved 500 —
    // the reconciliation above would still pass if `pnpm-workspace.yaml` and
    // the table drifted together.
    for (const name of [
      '@object-ui/fields',
      '@object-ui/permissions',
      '@object-ui/mobile',
      '@object-ui/plugin-detail'
    ]) {
      expect(aliases[name]).toBeDefined();
      expect(existsSync(aliases[name])).toBe(true);
    }
  });

  it('aliases the six the dependency scan could not reach past them', () => {
    // A Vite dependency scan reports only the first layer it fails on, so the
    // card's list of four was the visible half. These six sit behind them in
    // the same import graph and would have stayed broken under a backfill.
    for (const name of [
      '@object-ui/data-objectstack',
      '@object-ui/i18n',
      '@object-ui/plugin-map',
      '@object-ui/providers',
      '@object-ui/react-runtime',
      '@object-ui/sdui-parser'
    ]) {
      expect(aliases[name]).toBeDefined();
    }
  });

  it('resolves barrels spelled .ts and .tsx alike', () => {
    // The entry-inference rule was the stated cost of deriving the table.
    // Probing in the resolver's extension order settles it: both spellings are
    // present in this repo and both must be found.
    expect(existsSync(join(aliases['@object-ui/core'], 'index.ts'))).toBe(true);
    expect(existsSync(join(aliases['@object-ui/fields'], 'index.tsx'))).toBe(true);
  });

  it('targets source directories, so a subpath import lands in the tree', () => {
    // An alias rewrites the matched prefix and keeps the rest. A file target
    // turns `<pkg>/<subpath>` into `<barrel-file>/<subpath>`, which cannot
    // exist; a directory target lands in the package's own sources.
    for (const [name, target] of Object.entries(aliases)) {
      expect(statSync(target).isDirectory(), `${name} must alias a directory`).toBe(true);
      expect(BARREL_EXTENSIONS.some((ext) => existsSync(join(target, `index${ext}`)))).toBe(true);
    }
  });

  it('excludes a workspace package with no source barrel', () => {
    // `@object-ui/runner` has a `src/` and no barrel: an alias to it would only
    // trade one resolver error for another, so the rule is "consumable from
    // source", not "is a directory".
    const runner = join(REPO_ROOT, 'packages/runner');
    expect(existsSync(join(runner, 'src'))).toBe(true);
    expect(BARREL_EXTENSIONS.some((ext) => existsSync(join(runner, 'src', `index${ext}`)))).toBe(false);
    expect(aliases['@object-ui/runner']).toBeUndefined();
  });
});

describe('lucide-react alias (objectui#3890)', () => {
  const lucide = resolveLucideAlias(REPO_ROOT);

  it('points at the package root rather than a resolved entry file', () => {
    expect(lucide).toBeDefined();
    const manifest = JSON.parse(readFileSync(join(lucide as string, 'package.json'), 'utf-8')) as { name?: string };
    expect(manifest.name).toBe('lucide-react');
  });

  it('keeps the subpath the component library imports resolvable', () => {
    // The specifier is read out of the importer instead of being written here,
    // so this pins the real consumer rather than a copy of it. With the entry
    // file as the alias target, this rewrite produced `<entry>/<subpath>` and
    // `packages/components/src/lib/lazy-icon.tsx` answered 500 once the
    // platform aliases made it reachable at all.
    const importer = readFileSync(join(REPO_ROOT, 'packages/components/src/lib/lazy-icon.tsx'), 'utf-8');
    const match = /['"]lucide-react\/([^'"]+)['"]/.exec(importer);
    expect(match, 'lazy-icon.tsx no longer imports a lucide-react subpath').not.toBeNull();

    const rewritten = join(lucide as string, (match as RegExpExecArray)[1]);
    expect(existsSync(rewritten), `${rewritten} must exist for the aliased subpath to resolve`).toBe(true);
  });
});

describe('the derivation rule itself', () => {
  /** A throwaway workspace, so the rule is judged on inputs this repo lacks. */
  function withFixture(run: (root: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), 'objectui-ws-alias-'));
    try {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n  - 'tools'\n");
      const write = (dir: string, name: string, barrel?: string): void => {
        mkdirSync(join(root, dir, 'src'), { recursive: true });
        writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name, version: '0.0.0' }));
        if (barrel) writeFileSync(join(root, dir, 'src', barrel), 'export {};\n');
      };
      write('packages/alpha', '@object-ui/alpha', 'index.ts');
      write('packages/beta', '@object-ui/beta', 'index.tsx');
      write('packages/gamma', '@object-ui/gamma'); // no barrel
      write('packages/outsider', 'unscoped-package', 'index.ts');
      write('tools', '@object-ui/tools', 'index.ts'); // literal pattern, not a fan-out
      mkdirSync(join(root, 'packages/not-a-package'), { recursive: true }); // no manifest
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('takes scoped packages with a barrel, from both pattern shapes', () => {
    withFixture((root) => {
      expect(Object.keys(workspaceSourceAliases(root)).sort()).toEqual([
        '@object-ui/alpha',
        '@object-ui/beta',
        '@object-ui/tools'
      ]);
    });
  });

  it('drops a scoped package the moment its barrel goes away', () => {
    // The planted-defect direction: a table that is green because it produced
    // nothing is not a table. Removing the barrel must remove the entry.
    withFixture((root) => {
      expect(workspaceSourceAliases(root)['@object-ui/alpha']).toBeDefined();
      rmSync(join(root, 'packages/alpha/src/index.ts'));
      expect(workspaceSourceAliases(root)['@object-ui/alpha']).toBeUndefined();
    });
  });

  it('reads the manifest, not the directory layout', () => {
    withFixture((root) => {
      expect(workspacePackageDirs(root).length).toBe(5);
      rmSync(join(root, 'pnpm-workspace.yaml'));
      expect(isWorkspaceRoot(root)).toBe(false);
      expect(workspacePackageDirs(root)).toEqual([]);
      expect(workspaceSourceAliases(root)).toEqual({});
    });
  });
});

describe('dev / serve / build consistency (objectui#3890)', () => {
  const sources = new Map(
    TEMP_APP_COMMANDS.map((file) => [file, readFileSync(join(COMMAND_DIR, file), 'utf-8')] as const)
  );

  it('routes all three commands through the shared workspace helper', () => {
    for (const [file, source] of sources) {
      expect(source, `${file} must build its workspace config from the shared helper`).toContain(
        'prepareWorkspaceTempApp'
      );
    }
  });

  it('gives all three a workspace branch', () => {
    // `serve` and `build` had none: they ran `npm install` unconditionally
    // against a manifest that is empty inside a workspace, then handed Vite a
    // config with no aliases at all.
    for (const [file, source] of sources) {
      expect(source, `${file} must detect a workspace root`).toContain('isWorkspaceRoot');
    }
  });

  it('leaves no hand-written alias entry behind in any of them', () => {
    // The shape that drifted: a quoted platform specifier used as an object key.
    const handWritten = /['"]@object-ui\/[a-z0-9-]+['"]\s*:/;
    for (const [file, source] of sources) {
      expect(handWritten.test(source), `${file} still spells an alias entry by hand`).toBe(false);
    }
  });
});

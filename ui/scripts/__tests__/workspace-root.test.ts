/**
 * `scripts/workspace-root.mjs` -- where the pnpm workspace's four root files are,
 * in the standalone layout and under the objectstack monorepo's `ui/`
 * (objectstack#25723). The rule is held on fixtures of BOTH layouts, so the
 * nested branch is exercised whichever layout this checkout is; the live tree
 * is then asked only what is true in both. The declaration twin
 * `workspace-root.d.mts` is pinned to the module's real export surface, since a
 * hand-written declaration is the one thing here free to drift.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../js-comment-mask.mjs';
import { uiRoot } from '../ui-root.mjs';
import {
  isNestedWorkspace,
  lockfilePath,
  narrowTurboConfig,
  nestedPrefix,
  parseWorkspaceGlobs,
  rootManifest,
  rootManifestPath,
  turboConfigPath,
  uiScopedTurboConfig,
  uiTurboConfigPath,
  workspaceGlobs,
  workspaceManifestPath,
  workspaceRoot,
} from '../workspace-root.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

type Files = Record<string, string>;

/** A scratch tree; `run` gets its absolute root. */
function withTree<T>(files: Files, run: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-root-'));
  try {
    for (const [rel, contents] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    }
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const STANDALONE: Files = {
  'ws/pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'examples/*'\n  - 'apps/*'\n  - 'docs'\n",
  'ws/pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
  'ws/package.json': JSON.stringify({ name: 'fixture-ws', pnpm: { overrides: { react: '19.0.0' } } }),
  'ws/turbo.json': JSON.stringify({
    globalDependencies: ['tsconfig.json'],
    tasks: { build: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/x.mjs'] } },
  }),
};

const NESTED: Files = {
  'mono/pnpm-workspace.yaml': [
    'packages:',
    '  - packages/*',
    '  - packages/apps/*',
    '  - apps/*',
    '  # the imported tree',
    '  - ui',
    '  - ui/packages/*',
    '  - ui/apps/*',
    "  - 'ui/examples/*'",
    '',
    'overrides:',
    '  react: 19.3.0',
    '',
  ].join('\n'),
  'mono/pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
  'mono/package.json': JSON.stringify({ name: 'fixture-mono', pnpm: { ignoredBuiltDependencies: ['yarn'] } }),
  'mono/turbo.json': JSON.stringify({
    globalDependencies: ['tsconfig.json', 'ui/tsconfig.tier-base.json'],
    tasks: {
      build: { dependsOn: ['^build'], inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/tsup.mjs', '$TURBO_ROOT$/ui/scripts/check-dist.mjs'] },
      'type-check': { dependsOn: ['^build'], inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/ui/tsconfig.json'] },
      lint: { outputs: [] },
    },
  }),
  'mono/ui/package.json': JSON.stringify({ name: 'fixture-ui' }),
  'mono/ui/turbo.objectui.json': JSON.stringify({
    tasks: { build: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/check-dist.mjs'] } },
  }),
};

describe('workspaceRoot() -- rule (a): the tree, else its parent, else a throw', () => {
  it('is the tree itself when it holds a pnpm-workspace.yaml', () => {
    withTree(STANDALONE, (tmp) => {
      const ws = path.join(tmp, 'ws');
      expect(workspaceRoot(ws)).toBe(ws);
      expect(isNestedWorkspace(ws)).toBe(false);
      expect(nestedPrefix(ws)).toBe('');
      expect(workspaceManifestPath(ws)).toBe(path.join(ws, 'pnpm-workspace.yaml'));
      expect(lockfilePath(ws)).toBe(path.join(ws, 'pnpm-lock.yaml'));
      expect(rootManifestPath(ws)).toBe(path.join(ws, 'package.json'));
      expect(rootManifest(ws).pnpm?.overrides).toEqual({ react: '19.0.0' });
    });
  });

  it('is the parent when only the parent holds one -- the `ui/` layout', () => {
    withTree(NESTED, (tmp) => {
      const mono = path.join(tmp, 'mono');
      const ui = path.join(mono, 'ui');
      expect(workspaceRoot(ui)).toBe(mono);
      expect(isNestedWorkspace(ui)).toBe(true);
      expect(nestedPrefix(ui)).toBe('ui/');
      expect(workspaceManifestPath(ui)).toBe(path.join(mono, 'pnpm-workspace.yaml'));
      expect(lockfilePath(ui)).toBe(path.join(mono, 'pnpm-lock.yaml'));
      expect(rootManifest(ui).name).toBe('fixture-mono');
    });
  });

  it('throws when neither holds one, rather than picking a grandparent or the cwd', () => {
    withTree({ 'none/sub/package.json': '{}' }, (tmp) => {
      expect(() => workspaceRoot(path.join(tmp, 'none/sub'))).toThrow(/no pnpm-workspace\.yaml at/);
      expect(() => workspaceGlobs(path.join(tmp, 'none/sub'))).toThrow(/no pnpm-workspace\.yaml at/);
    });
  });
});

describe('workspaceGlobs() -- rule (b): verbatim at the root, the tree’s own subset at the parent', () => {
  it('returns the file’s globs verbatim, in order, when the tree is the root', () => {
    withTree(STANDALONE, (tmp) => {
      expect(workspaceGlobs(path.join(tmp, 'ws'))).toEqual(['packages/*', 'examples/*', 'apps/*', 'docs']);
    });
  });

  it('strips the tree’s prefix and drops the bare tree entry when the parent is the root', () => {
    withTree(NESTED, (tmp) => {
      expect(workspaceGlobs(path.join(tmp, 'mono/ui'))).toEqual(['packages/*', 'apps/*', 'examples/*']);
    });
  });

  it('throws when the parent’s file does not describe the tree at all', () => {
    withTree(
      { 'mono/pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n", 'mono/other/package.json': '{}' },
      (tmp) => {
        expect(() => workspaceGlobs(path.join(tmp, 'mono/other'))).toThrow(/declares no packages glob under other\//);
      },
    );
  });
});

describe('parseWorkspaceGlobs() -- the one parser, with the union of the three refusals', () => {
  it('reads quoted, unquoted and commented entries, and nested `dir/*` shapes', () => {
    expect(parseWorkspaceGlobs("packages:\n  - 'packages/*'\n  - docs\n")).toEqual(['packages/*', 'docs']);
    expect(parseWorkspaceGlobs('packages:\n  - "apps/*"  # trailing comment\n  # a comment line\n\n  - packages/apps/*\n')).toEqual([
      'apps/*',
      'packages/apps/*',
    ]);
    // The block ends at the next column-0 key.
    expect(parseWorkspaceGlobs('packages:\n  - a\nonlyBuiltDependencies:\n  - esbuild\n')).toEqual(['a']);
  });

  it('refuses a glob shape it does not know rather than skipping it', () => {
    expect(() => parseWorkspaceGlobs("packages:\n  - 'packages/**'\n")).toThrow(/does not know/);
    expect(() => parseWorkspaceGlobs("packages:\n  - 'packages/*/src'\n")).toThrow(/does not know/);
    expect(() => parseWorkspaceGlobs("packages:\n  - '!packages/x'\n")).toThrow(/does not know/);
    expect(() => parseWorkspaceGlobs("packages:\n  - 'pkg?/*'\n")).toThrow(/does not know/);
  });

  it('refuses an entry it cannot read, a missing key and an empty list', () => {
    expect(() => parseWorkspaceGlobs('packages:\n  - a b\n')).toThrow(/cannot read the packages entry/);
    expect(() => parseWorkspaceGlobs('packages:\n  packages/*\n')).toThrow(/cannot read the packages entry/);
    expect(() => parseWorkspaceGlobs('catalog: {}\n')).toThrow(/declares no packages/);
    expect(() => parseWorkspaceGlobs('packages:\n')).toThrow(/declares no packages/);
  });
});

describe('turbo.json -- the nearest one for what turbo hashes, the tree’s own for its task shapes', () => {
  it('standalone: every answer is `<root>/turbo.json` and the config comes back unnarrowed', () => {
    withTree(STANDALONE, (tmp) => {
      const ws = path.join(tmp, 'ws');
      expect(turboConfigPath(ws)).toBe(path.join(ws, 'turbo.json'));
      expect(uiTurboConfigPath(ws)).toBe(path.join(ws, 'turbo.json'));
      expect(uiScopedTurboConfig(ws)).toEqual(JSON.parse(fs.readFileSync(path.join(ws, 'turbo.json'), 'utf8')));
    });
  });

  it('nested: the parent’s turbo.json is nearest, the parked copy carries the tree’s own shapes', () => {
    withTree(NESTED, (tmp) => {
      const mono = path.join(tmp, 'mono');
      const ui = path.join(mono, 'ui');
      expect(turboConfigPath(ui)).toBe(path.join(mono, 'turbo.json'));
      expect(uiTurboConfigPath(ui)).toBe(path.join(ui, 'turbo.objectui.json'));
      fs.rmSync(path.join(ui, 'turbo.objectui.json'));
      expect(() => uiTurboConfigPath(ui)).toThrow(/neither turbo\.json nor turbo\.objectui\.json/);
    });
  });

  it('nested: re-roots `$TURBO_ROOT$/ui/` inputs and drops the monorepo’s own', () => {
    withTree(NESTED, (tmp) => {
      const scoped = uiScopedTurboConfig(path.join(tmp, 'mono/ui'));
      expect(scoped.globalDependencies).toEqual(['tsconfig.tier-base.json']);
      expect(scoped.tasks.build).toEqual({ dependsOn: ['^build'], inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/check-dist.mjs'] });
      expect(scoped.tasks['type-check']).toEqual({ dependsOn: ['^build'], inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/tsconfig.json'] });
      expect(scoped.tasks.lint).toEqual({ outputs: [] });
    });
  });

  it('narrowTurboConfig with an empty prefix is the identity', () => {
    const config = { globalDependencies: ['a'], tasks: { build: { inputs: ['$TURBO_ROOT$/x'] } } };
    expect(narrowTurboConfig(config, '')).toBe(config);
  });
});

describe('this checkout', () => {
  it('has a workspace root that is the tree or its parent, and globs that expand under the tree', () => {
    const ws = workspaceRoot();
    expect([uiRoot(), path.dirname(uiRoot())]).toContain(ws);
    expect(isNestedWorkspace()).toBe(ws !== uiRoot());
    expect(fs.existsSync(lockfilePath())).toBe(true);
    expect(fs.existsSync(workspaceManifestPath())).toBe(true);
    expect(typeof rootManifest().name).toBe('string');
    const globs = workspaceGlobs();
    expect(globs.length).toBeGreaterThan(2);
    // Every `dir/*` glob names a directory of this tree (`packages`, `apps`, ...).
    for (const glob of globs.filter((g) => g.endsWith('/*'))) {
      expect(fs.existsSync(path.join(uiRoot(), glob.slice(0, -2))), glob).toBe(true);
    }
    expect(fs.existsSync(turboConfigPath())).toBe(true);
    expect(fs.existsSync(uiTurboConfigPath())).toBe(true);
    expect(uiScopedTurboConfig().tasks.build.inputs).toContain('$TURBO_DEFAULT$');
  });

  it('imports node builtins and ui-root.mjs only, so the pre-install gates may import it', () => {
    const code = stripComments(fs.readFileSync(path.join(here, '..', 'workspace-root.mjs'), 'utf8'));
    const specifiers = [...code.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !s.startsWith('node:') && s !== './ui-root.mjs')).toEqual([]);
    expect(code).not.toContain('process.cwd');
  });

  it('declares in workspace-root.d.mts exactly the names workspace-root.mjs exports', async () => {
    const declared = fs.readFileSync(path.join(here, '..', 'workspace-root.d.mts'), 'utf8');
    const declaredNames = [...declared.matchAll(/^export declare (?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
    const exported = Object.keys(await import('../workspace-root.mjs')).sort();
    expect(declaredNames).toEqual(exported);
  });
});

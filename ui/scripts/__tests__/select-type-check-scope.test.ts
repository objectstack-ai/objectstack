import { describe, expect, it } from 'vitest';
import { uiTurboConfigPath } from '../workspace-root.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  globToRegExp,
  main,
  rootChanges,
  rootProgramPackages,
  rootRule,
} from '../select-type-check-scope.mjs';

/**
 * objectui#12222 — the scope selector behind the two-speed `Type Check`.
 *
 * The selector's whole correctness is its ROOT RULE: turbo's
 * `--filter=...[<base>]` draws from the package graph, and a file that sits in
 * no package selects nothing — measured on the card for the root
 * `tsconfig.json`, the root `package.json`, `scripts/vite-*.ts` and `e2e/`,
 * every one of which every package's type-check reads or depends on. So the
 * cases below hold the rule in both directions — a root change that must widen
 * the run to the whole workspace, and a change that must not — and hold the
 * DERIVED half of the rule to turbo.json itself, so a `$TURBO_ROOT$` input
 * added to turbo.json is a root change the day it lands.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const turbo = JSON.parse(fs.readFileSync(uiTurboConfigPath(), 'utf8')) as {
  globalDependencies?: string[];
  tasks: Record<string, { inputs?: string[]; dependsOn?: string[] }>;
};
const RULE = rootRule(turbo);
const caught = (files: string[]): string[] => rootChanges(files, RULE).map((h: { file: string }) => h.file);

describe('select-type-check-scope — the root rule (objectui#12222)', () => {
  it('derives every $TURBO_ROOT$ input of `type-check` and `build` from turbo.json', () => {
    const derived = ['type-check', 'build'].flatMap((task) =>
      (turbo.tasks[task].inputs ?? [])
        .filter((input) => input.startsWith('$TURBO_ROOT$/'))
        .map((input) => input.slice('$TURBO_ROOT$/'.length)),
    );
    // Non-vacuity: the live turbo.json has both kinds of entry today.
    expect(derived.length, 'turbo.json declares no $TURBO_ROOT$ input at all — the derivation is reading nothing').toBeGreaterThan(5);
    const globs = new Set(RULE.map((r: { glob: string }) => r.glob));
    expect(derived.filter((g) => !globs.has(g))).toEqual([]);
  });

  it('takes the root task’s own program, because it runs only as a dependency of a selected package', () => {
    const rootDeps = (turbo.tasks['type-check'].dependsOn ?? []).filter((d) => d.startsWith('//#'));
    expect(rootDeps, '`type-check` no longer depends on a root task — this case has nothing to hold').not.toHaveLength(0);
    for (const dep of rootDeps) {
      for (const glob of turbo.tasks[dep].inputs ?? []) {
        expect(RULE.map((r: { glob: string }) => r.glob)).toContain(glob);
      }
    }
  });

  it('widens to the whole workspace for every root file the package graph cannot see', () => {
    const roots = [
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'package.json',
      'turbo.json',
      'tsconfig.json',
      'tsconfig.tier-base.json',
      'patches/some-dep@1.0.0.patch',
      'scripts/vite-crypto-stub.ts',
      'vitest.config.mts',
      'e2e/smoke.spec.ts',
      'playwright.config.ts',
      'tsconfig.e2e.json',
      // A `build` input that sits INSIDE a package: every package's build hash
      // reads it, while the package graph would only select its owner.
      'packages/sdui-parser/src/parse.ts',
    ];
    expect(caught(roots)).toEqual(roots);
  });

  it('leaves to the package graph what the package graph does see, and ignores what nothing hashes', () => {
    const notRoot = [
      'packages/plugin-kanban/src/KanbanColumnSummary.ts',
      'packages/plugin-kanban/package.json',
      'packages/plugin-kanban/tsconfig.json',
      'apps/console/src/App.tsx',
      '.changeset/12222-type-check-cache.md',
      'docs/adr/0001-example.md',
      '.github/workflows/lint.yml',
      'scripts/check-type-check-coverage.mjs',
    ];
    expect(caught(notRoot)).toEqual([]);
  });

  it('degrades to the whole workspace — never to a skip — when a root task reads the whole repository', () => {
    const noInputs = {
      tasks: {
        'type-check': { inputs: ['$TURBO_DEFAULT$'], dependsOn: ['^build', '//#type-check:e2e'] },
        build: { inputs: ['$TURBO_DEFAULT$'] },
        '//#type-check:e2e': {},
      },
    };
    const rule = rootRule(noInputs);
    expect(rootChanges(['packages/plugin-kanban/src/x.ts', 'docs/x.md'], rule)).toHaveLength(2);
  });

  // `names the fixed half of the rule in the workflow, next to the filter`
  // retired with objectstack#25712; see the end of this file.

  it('refuses glob syntax it does not implement rather than guessing a match', () => {
    expect(() => globToRegExp('scripts/{a,b}.mjs')).toThrow(/does not implement/);
    expect(() => globToRegExp('!**/*.md')).toThrow(/does not implement/);
    expect(globToRegExp('node_modules/@objectstack/spec/.x.json').test('node_modules/@objectstack/spec/.x.json')).toBe(true);
    expect(globToRegExp('tsconfig*.json').test('packages/x/tsconfig.json')).toBe(false);
    expect(globToRegExp('e2e/**').test('e2e/live/a.spec.ts')).toBe(true);
  });
});

/**
 * objectui#12272 — the packages the repo-root `vitest.setup.*` files import,
 * named outright: the non-vacuity anchor for the derivation below, which reads
 * them out of `tsconfig.vitest-setup.json` on every run.
 */
const ROOT_PROGRAM_PACKAGES = [
  '@object-ui/components',
  '@object-ui/fields',
  '@object-ui/i18n',
  '@object-ui/plugin-dashboard',
  '@object-ui/plugin-grid',
];

describe('select-type-check-scope — the packages the repo-root programs need built (objectui#12272)', () => {
  it('derives them from the root program’s tsconfig `paths`, a subpath wildcard included', () => {
    expect(rootProgramPackages(repoRoot)).toEqual(ROOT_PROGRAM_PACKAGES);
  });

  it('matches what the root setup program really imports, so a new import is a new build', () => {
    // The derivation reads `paths`; the program's files are what needs them.
    // The root package.json declares no `@object-ui/*` dependency, so an import
    // a `paths` entry does not map cannot resolve at all -- hold the two
    // together. The files are the program's own root set, as `tsc -p` parses it.
    const configPath = path.join(repoRoot, 'tsconfig.vitest-setup.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const { fileNames } = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot, undefined, configPath);
    expect(fileNames.length, 'tsconfig.vitest-setup.json resolves no file — the parse is broken').toBeGreaterThanOrEqual(4);
    const imported = new Set<string>();
    for (const file of fileNames) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:from|import)\s+'(@object-ui\/[\w-]+)(?:\/[^']*)?'/g)) imported.add(m[1]);
    }
    expect(imported.size, 'no root setup file imports a workspace package — the scan is broken').toBeGreaterThan(0);
    expect([...imported].sort()).toEqual(rootProgramPackages(repoRoot));
  });

  it('throws on a `paths` target that sits in no workspace package, rather than dropping it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scope-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"root"}');
      fs.mkdirSync(path.join(dir, 'packages/a'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages/a/package.json'), '{"name":"@x/a"}');
      const write = (paths: Record<string, string[]>) =>
        fs.writeFileSync(path.join(dir, 'tsconfig.root.json'), JSON.stringify({ compilerOptions: { paths } }));

      write({ '@x/a/*': ['./packages/a/dist/*'] });
      expect(rootProgramPackages(dir, ['tsconfig.root.json'])).toEqual(['@x/a']);

      write({ '@x/b': ['./nowhere/b'] });
      expect(() => rootProgramPackages(dir, ['tsconfig.root.json'])).toThrow(/sits in no workspace package/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('select-type-check-scope — the verdict', () => {
  const run = (changed: string[], affected: () => string[] = () => ['@object-ui/plugin-kanban']) => {
    const lines: string[] = [];
    const code = main(['--base', 'abc123'], { root: repoRoot, changed, affected, log: (l: string) => lines.push(l) });
    return { code, lines };
  };

  it('answers scope=workspace on a root change, without asking turbo', () => {
    let asked = false;
    const { code, lines } = run(['pnpm-lock.yaml', 'packages/types/src/index.ts'], () => {
      asked = true;
      return [];
    });
    expect(code).toBe(0);
    expect(lines.at(-1)).toBe('scope=workspace');
    expect(lines.join('\n')).toContain('pnpm-lock.yaml');
    expect(asked).toBe(false);
  });

  it('answers scope=affected with turbo’s package list otherwise — an empty list included', () => {
    const one = run(['packages/plugin-kanban/src/KanbanColumnSummary.ts']);
    expect(one.code).toBe(0);
    expect(one.lines.at(-1)).toBe('scope=affected');
    expect(one.lines).toContain('  @object-ui/plugin-kanban');

    const none = run(['.github/workflows/lint.yml'], () => []);
    expect(none.lines.at(-1)).toBe('scope=affected');
    expect(none.lines.join('\n')).toContain('nothing to type-check');
  });

  it('names the root programs’ packages on an EMPTY affected set, the PR #12262 case (objectui#12272)', () => {
    const none = run(['.github/workflows/spec-main-shape-gate.yml', 'scripts/__tests__/spec-main-shape-gate.test.ts'], () => []);
    expect(none.code).toBe(0);
    expect(none.lines.at(-1)).toBe('scope=affected');
    const tail = none.lines.slice(none.lines.findIndex((l) => l.startsWith('The repo-root programs')));
    expect(tail.slice(1, -1)).toEqual(ROOT_PROGRAM_PACKAGES.map((p) => `  ${p}`));
  });

  it('names them all the same on an affected set that lacks them (objectui#12272)', () => {
    // `...[base]` over `packages/plugin-ai` alone selects that one package, and
    // its `^build` closure holds none of fields, plugin-dashboard, plugin-grid.
    const lacking = run(['packages/plugin-ai/src/index.ts'], () => ['@object-ui/plugin-ai']);
    expect(lacking.lines.at(-1)).toBe('scope=affected');
    expect(lacking.lines).toContain('  @object-ui/plugin-ai');
    const tail = lacking.lines.slice(lacking.lines.findIndex((l) => l.startsWith('The repo-root programs')));
    expect(tail.slice(1, -1)).toEqual(ROOT_PROGRAM_PACKAGES.map((p) => `  ${p}`));
  });

  it('prints exactly those packages, one per line, for `--root-builds` (objectui#12272)', () => {
    const lines: string[] = [];
    expect(main(['--root-builds'], { root: repoRoot, log: (l: string) => lines.push(l) })).toBe(0);
    expect(lines).toEqual(ROOT_PROGRAM_PACKAGES);
    expect(main(['--root-builds', '--base', 'abc123'], { log: () => {} })).toBe(2);
  });

  it('reaches NO verdict when turbo cannot answer, which ci.yml reads as the whole workspace', () => {
    expect(() =>
      run(['packages/plugin-kanban/src/x.ts'], () => {
        throw new Error('Unable to query SCM');
      }),
    ).toThrow(/SCM/);
    expect(main([], { log: () => {} })).toBe(2);
  });
});

// `ci.yml — the two speeds are wired the way the selector assumes` retired with
// objectstack#25712, and so did `names the fixed half of the rule in the
// workflow, next to the filter` above. Both read objectui ci.yml's `type-check`
// job: its `Decide which packages to type-check` step (`tc-scope`), the
// `Run type-check` step's `TURBO_FORCE` and affected filter, and the
// root-programs build between them. That file runs nowhere under the monorepo.
// The root `type-check-ui` job that replaced it does not run this selector: it
// takes the affected scope from turbo's own `...[<base>]` filter and builds the
// root programs' packages in a step of its own, as row 7 `Type Check` of the
// objectstack#25697 workflow roster records ("affected scope via turbo
// `...[base]`"). Wiring the selector there brings these pins back against
// `type-check-ui` (`helpers/root-ci.ts`).

import { describe, expect, it } from 'vitest';
import { uiTurboConfigPath } from '../workspace-root.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

import {
  FIXED_ROOT_FILES,
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

  it('names the fixed half of the rule in the workflow, next to the filter', () => {
    const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const at = ci.indexOf('- name: Decide which packages to type-check');
    expect(at, 'ci.yml’s type-check job no longer has the scope decision step').toBeGreaterThan(-1);
    const comment = ci.slice(ci.lastIndexOf('THE ROOT RULE', at), at);
    for (const glob of FIXED_ROOT_FILES) {
      const spelled = glob.replace(/\/\*\*$/, '/');
      expect(comment, `the root rule stated in ci.yml no longer names ${glob}`).toContain(spelled);
    }
  });

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

describe('ci.yml — the two speeds are wired the way the selector assumes', () => {
  const workflow = parseYaml(fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')) as {
    jobs: Record<string, { steps: Array<{ name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }> }>;
  };
  const steps = workflow.jobs['type-check'].steps;
  const decide = steps.find((s) => s.id === 'tc-scope');
  const runStep = steps.find((s) => s.name === 'Run type-check');

  it('runs the full battery, forced, on every event that is not a pull request or a queue build', () => {
    expect(decide?.run, 'the scope decision step is gone').toBeDefined();
    expect(decide?.run).toMatch(/pull_request\) base="\$PR_BASE"/);
    expect(decide?.run).toMatch(/merge_group\) base="\$QUEUE_BASE"/);
    expect(decide?.run).toMatch(/\*\)\s+echo 'scope=full'/);
    expect(runStep?.env?.TURBO_FORCE).toBe("${{ steps.tc-scope.outputs.scope == 'full' }}");
  });

  it('fails OPEN: no verdict, no base sha, or an unknown answer type-checks the whole workspace', () => {
    expect(decide?.run).toContain('node scripts/select-type-check-scope.mjs --base "$base"');
    // The catch-all branch of the verdict `case` is the whole workspace.
    expect(decide?.run).toMatch(/\*\)\s+echo "::warning::the type-check scope selector reached no verdict[^\n]*\n\s+echo 'scope=workspace'/);
    expect(decide?.run).toMatch(/if \[ -z "\$base" \]; then[\s\S]*?status=2/);
  });

  it('filters only on the affected verdict, with turbo’s own dependents filter', () => {
    expect(runStep?.run).toContain('if [ "$SCOPE" = \'affected\' ]; then');
    expect(runStep?.run).toContain('pnpm type-check "--filter=...[$BASE]"');
  });

  /**
   * objectui#12272: on the affected speed nothing else builds the packages the
   * root setup program resolves, so this step must exist, run on that speed
   * only, and sit between the turbo run and the root program.
   */
  it('builds the root programs’ packages on the affected speed, after the turbo run and before the root program', () => {
    const names = steps.map((s) => s.name);
    const at = names.indexOf('Build the packages the repo-root programs import');
    expect(at, 'the type-check job no longer builds the root programs’ packages on the affected speed').toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(names.indexOf('Run type-check'));
    expect(at).toBeLessThan(names.indexOf('Type-check repo-root vitest setup files'));

    const build = steps[at];
    expect(build.if).toContain("steps.relevant.outputs.should_run == 'true'");
    expect(build.if, 'the full battery is unchanged: this step runs on the affected speed only').toContain(
      "steps.tc-scope.outputs.scope == 'affected'",
    );
    expect(build.run).toContain('node scripts/select-type-check-scope.mjs --root-builds');
    // `turbo run build`, never `type-check` with the names added: that task
    // waits on `^build` and builds no named package's own declarations.
    expect(build.run).toContain('pnpm exec turbo run build "${filters[@]}"');
    expect(build.run, 'a failed build piped into `tee` must still fail the step').toContain('set -o pipefail');
    // `Report what the turbo cache replayed` reads the NEWEST run summary; this
    // run must not write one, or it would replace `Run type-check`'s.
    expect(build.env?.TURBO_RUN_SUMMARY).toBeUndefined();
    expect(build.run).not.toContain('TURBO_RUN_SUMMARY');
  });
});

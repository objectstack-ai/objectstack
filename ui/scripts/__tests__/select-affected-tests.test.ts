import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  changedFiles,
  changedOutsideTree,
  closureSummaries,
  dedupeFilters,
  listWorkspacePackages,
  moduleSpecifiers,
  outsideTreeReasons,
  packageClosures,
  parseWorkspaceGlobs,
  readHeavyProject,
  selectAffectedTests,
  trackedFiles,
} from '../select-affected-tests.mjs';
import { shardTotal } from '../../../scripts/ci-shard-matrix.mjs';
import { jobBlock, rootCi, triggerBlock, UI_JOBS, uiRun, withoutComments } from './helpers/root-ci';

/**
 * objectui#12214 — the affected-test selector behind the two-speed `Test` lane.
 *
 * The fixture tree below is the smallest workspace that exercises every rule
 * the selector's header states, each in BOTH directions: a change that must
 * reach a test, and a change that must not. The live-tree cases at the end hold
 * the selector to the real repository: the package graph agrees with turbo's,
 * the `dom-heavy` project still parses, and the CLI reaches a verdict.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): { root: string; tracked: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'select-affected-12214-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return { root, tracked: Object.keys(files).sort() };
}

const manifest = (name: string, deps: Record<string, string> = {}) =>
  JSON.stringify({ name, version: '0.0.0', dependencies: deps });

/** A root config carrying the two shapes `readHeavyProject` reads. */
const ROOT_CONFIG = `import path from 'path';
import { guard } from './scripts/guard.mjs';
guard();
const heavyDomTests = [
  // a comment line the reader must skip
  'packages/heavy-user/src/heavy.test.tsx',
];
export default {
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'dom-heavy',
          environment: 'happy-dom',
          setupFiles: [path.resolve(__dirname, 'vitest.setup.dom.tsx')],
          include: [...heavyDomTests],
        },
      },
    ],
  },
};
`;

function workspace() {
  return fixture({
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'package.json': manifest('root'),
    'vitest.config.mts': ROOT_CONFIG,
    'vitest.setup.dom-light.tsx': "import '@fx/locales';\n",
    'vitest.setup.dom.tsx': "import './vitest.setup.dom-light';\nimport '@fx/registry';\n",
    'scripts/guard.mjs': 'export function guard() {}\n',
    'scripts/helper.mjs': 'export const x = 1;\n',
    'scripts/__tests__/gate.test.ts': "import '../helper.mjs';\n",
    'README.md': '# fixture\n',
    'content/page.md': 'docs\n',
    'packages/locales/package.json': manifest('@fx/locales'),
    'packages/locales/src/index.ts': 'export const en = {};\n',
    'packages/registry/package.json': manifest('@fx/registry'),
    'packages/registry/src/index.ts': 'export const r = 1;\n',
    'packages/a/package.json': manifest('@fx/a'),
    'packages/a/tsconfig.json': '{}\n',
    'packages/a/src/index.ts': 'export const a = 1;\n',
    'packages/a/src/a.test.ts': "import { a } from './index';\n",
    'packages/b/package.json': manifest('@fx/b', { '@fx/a': 'workspace:*' }),
    'packages/b/src/index.ts': "import { a } from '@fx/a';\nexport const b = a;\n",
    'packages/b/src/b.test.ts': "import { b } from './index';\n",
    'packages/c/package.json': manifest('@fx/c'),
    'packages/c/src/index.ts': 'export const c = 1;\n',
    'packages/c/src/plain.test.ts': "import { c } from './index';\n",
    'packages/c/src/plain.test.tsx': "import { c } from './index';\n",
    'packages/c/src/reads.test.ts': "import './helpers/tree';\n",
    'packages/c/src/helpers/tree.ts': "import fs from 'node:fs';\nexport const t = fs.existsSync('.');\n",
    'packages/c/src/undeclared.test.ts': "import { a } from '@fx/a';\n",
    'packages/c/src/escapes.test.ts': "import '../../../scripts/helper.mjs';\n",
    'packages/heavy-user/package.json': manifest('@fx/heavy-user'),
    'packages/heavy-user/src/heavy.test.tsx': 'export {};\n',
  });
}

type Affected = Extract<ReturnType<typeof selectAffectedTests>, { mode: 'affected' }>;

function affected(root: string, tracked: string[], changed: string[]): Affected {
  const verdict = selectAffectedTests({ root, tracked, changed });
  expect(verdict.mode, `expected an affected verdict for ${changed.join(', ')}`).toBe('affected');
  return verdict as Affected;
}

function full(root: string, tracked: string[], changed: string[]): string[] {
  const verdict = selectAffectedTests({ root, tracked, changed });
  expect(verdict.mode, `expected a full run for ${changed.join(', ')}`).toBe('full');
  return (verdict as { reasons: string[] }).reasons;
}

describe('select-affected-tests — the package graph (objectui#12214)', () => {
  it('selects the changed package and its dependents, and not an unrelated package', () => {
    const { root, tracked } = workspace();
    const v = affected(root, tracked, ['packages/a/src/index.ts']);
    expect(v.changedPackages).toEqual(['@fx/a']);
    expect(v.affectedPackages).toEqual(['@fx/a', '@fx/b']);
    expect(v.filters).toContain('packages/a/');
    expect(v.filters).toContain('packages/b/');
    expect(v.filters).not.toContain('packages/c/');
    expect(v.filters.some((f) => f.includes('plain.test'))).toBe(false);
  });

  it('a dependency does not pull in its own dependencies', () => {
    const { root, tracked } = workspace();
    const v = affected(root, tracked, ['packages/b/src/index.ts']);
    expect(v.affectedPackages).toEqual(['@fx/b']);
    expect(v.filters).not.toContain('packages/a/');
  });
});

describe('select-affected-tests — the always-on set', () => {
  const { root, tracked } = workspace();
  const v = affected(root, tracked, ['content/page.md']);
  const why = new Map(v.alwaysOn.map((a) => [a.file, a.why]));

  it('a docs-only change selects the always-on set and no package', () => {
    expect(v.affectedPackages).toEqual([]);
    expect(v.filters.length).toBeGreaterThan(0);
  });

  it('keeps a test outside every package', () => {
    expect(why.get('scripts/__tests__/gate.test.ts')).toBe('outside every workspace package');
  });

  it('keeps a test whose RELATIVE closure reads the disk, not only one that imports fs itself', () => {
    expect(why.get('packages/c/src/reads.test.ts')).toBe('reads the disk or spawns a process');
  });

  it('keeps a test that imports a workspace package its own package does not depend on', () => {
    expect(why.get('packages/c/src/undeclared.test.ts')).toMatch(/imports @fx\/a, which @fx\/c does not depend on/);
  });

  it('keeps a test that reaches a file outside its own package', () => {
    expect(why.get('packages/c/src/escapes.test.ts')).toMatch(/reaches the repository root outside packages\/c/);
  });

  it('leaves out a test the package graph can place', () => {
    expect(why.has('packages/c/src/plain.test.ts')).toBe(false);
    expect(v.filters.some((f) => f.includes('plain.test'))).toBe(false);
  });
});

describe('select-affected-tests — what forces a full run', () => {
  const { root, tracked } = workspace();

  it.each([
    ['package.json', /package\.json change is a full-run trigger/],
    ['packages/c/package.json', /package\.json change is a full-run trigger/],
    ['packages/a/tsconfig.json', /tsconfig\.json change is a full-run trigger/],
    ['vitest.config.mts', /vitest\.config\.mts change is a full-run trigger/],
    ['pnpm-lock.yaml', /repository-root file that is not documentation/],
    ['patches/x.patch', /dependency patch/],
    ['scripts/guard.mjs', /root vitest config or a setup file imports it/],
    ['vitest.setup.dom-light.tsx', /root vitest config or a setup file imports it/],
    ['packages/locales/src/index.ts', /@fx\/locales is affected and a broad root vitest setup file imports it/],
  ])('%s', (changed, reason) => {
    expect(full(root, tracked, [changed]).join('\n')).toMatch(reason);
  });

  it('a root documentation file is not a full-run trigger', () => {
    affected(root, tracked, ['README.md']);
  });

  it('a script no config imports is not a full-run trigger', () => {
    affected(root, tracked, ['scripts/helper.mjs']);
  });
});

describe('select-affected-tests — the heavy DOM setup', () => {
  it('a package only the heavy setup imports adds the dom-heavy test files instead of running everything', () => {
    const { root, tracked } = workspace();
    const v = affected(root, tracked, ['packages/registry/src/index.ts']);
    expect(v.heavyEdge).toEqual(['@fx/registry']);
    expect(v.filters).toContain('packages/heavy-user/src/heavy.test.tsx');
  });

  it('no heavy edge, no heavy tests', () => {
    const { root, tracked } = workspace();
    const v = affected(root, tracked, ['packages/c/src/index.ts']);
    expect(v.heavyEdge).toEqual([]);
    expect(v.filters).not.toContain('packages/heavy-user/src/heavy.test.tsx');
  });

  it('refuses a config whose dom-heavy project it cannot read, rather than guessing', () => {
    expect(() => readHeavyProject('export default {}')).toThrow(/dom-heavy/);
    expect(() =>
      readHeavyProject(ROOT_CONFIG.replace(/'packages\/heavy-user\/src\/heavy\.test\.tsx',/, '')),
    ).toThrow(/empty/);
  });
});

/**
 * objectstack#25868 — the tree nested as `ui/` of a monorepo, the layout the
 * root `ci.yml` runs it in. The tree's own files are the fixture above; the
 * parent holds the one workspace file, the lockfile and its own packages:
 * `@os/base` <- `@os/mid` (runtime) <- the tree's `@fx/a` (dev), `@os/mid`
 * dev-depends on `@os/tooling`, and `@os/other` is unrelated.
 */
function nestedWorkspace() {
  const tree = workspace();
  const files: Record<string, string> = {
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - ui\n  - 'ui/packages/*'\n",
    'package.json': manifest('monorepo'),
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    'README.md': '# monorepo\n',
    'packages/base/package.json': manifest('@os/base'),
    'packages/base/src/index.ts': 'export const base = 1;\n',
    'packages/mid/package.json': JSON.stringify({
      name: '@os/mid',
      version: '0.0.0',
      dependencies: { '@os/base': 'workspace:*' },
      devDependencies: { '@os/tooling': 'workspace:*' },
    }),
    'packages/tooling/package.json': manifest('@os/tooling'),
    'packages/tooling/src/index.ts': 'export const t = 1;\n',
    'packages/other/package.json': manifest('@os/other'),
    'packages/other/src/index.ts': 'export const o = 1;\n',
  };
  for (const rel of tree.tracked) {
    if (rel === 'pnpm-workspace.yaml') continue; // a nested workspace root is ignored; the parent's governs
    const text = fs.readFileSync(path.join(tree.root, rel), 'utf8');
    files[`ui/${rel}`] =
      rel === 'packages/a/package.json'
        ? JSON.stringify({ name: '@fx/a', version: '0.0.0', devDependencies: { '@os/mid': 'workspace:*' } })
        : text;
  }
  const { root } = fixture(files);
  const ui = path.join(root, 'ui');
  return { monorepo: root, root: ui, tracked: tree.tracked.filter((f) => f !== 'pnpm-workspace.yaml') };
}

describe('select-affected-tests — nested as ui/ of a monorepo (objectstack#25868)', () => {
  it('a change outside the tree that every test installs or builds from is a full run', () => {
    const { root } = nestedWorkspace();
    const reasons = (outside: string[]) => outsideTreeReasons({ root, outside });
    expect(reasons(['pnpm-lock.yaml'])[0]).toMatch(/^pnpm-lock\.yaml: a workspace-root file that is not documentation/);
    expect(reasons(['package.json'])).toHaveLength(1);
    expect(reasons(['patches/x@1.0.0.patch'])[0]).toMatch(/a dependency patch/);
    // A package the tree depends on, and what that package depends on at run time.
    expect(reasons(['packages/mid/src/index.ts'])[0]).toMatch(/@os\/mid changed, .* \(through @fx\/a\)$/);
    expect(reasons(['packages/base/src/index.ts'])[0]).toMatch(/@os\/base changed/);
  });

  it('a change outside the tree that no test runs through is not', () => {
    const { root } = nestedWorkspace();
    // An outer package's devDependency is its own test tooling, not its built output.
    for (const rel of [
      'packages/tooling/src/index.ts',
      'packages/other/src/index.ts',
      'README.md',
      'docs/guide.md',
      '.github/workflows/ci.yml',
      'scripts/gate.mjs',
    ]) {
      expect(outsideTreeReasons({ root, outside: [rel] }), rel).toEqual([]);
    }
  });

  it('reads the tree as before when nothing outside it changed, and turns full when the lockfile did', () => {
    const { root, tracked } = nestedWorkspace();
    expect(listWorkspacePackages(root).map((p) => p.dir)).toContain('packages/a');
    const v = affected(root, tracked, ['packages/c/src/index.ts']);
    expect(v.affectedPackages).toEqual(['@fx/c']);
    const outside = ['docs/guide.md', 'packages/other/src/index.ts'];
    expect(selectAffectedTests({ root, tracked, changed: ['packages/c/src/index.ts'], outside }).mode).toBe('affected');
    const verdict = selectAffectedTests({ root, tracked, changed: ['packages/c/src/index.ts'], outside: ['pnpm-lock.yaml'] });
    expect(verdict.mode).toBe('full');
  });

  it('git hands the tree its own changes and the monorepo its own, both through --relative', () => {
    const { monorepo, root } = nestedWorkspace();
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
        cwd: monorepo,
        encoding: 'utf8',
      });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    fs.appendFileSync(path.join(root, 'packages/c/src/index.ts'), 'export const d = 2;\n');
    fs.appendFileSync(path.join(monorepo, 'pnpm-lock.yaml'), '# moved\n');
    git('commit', '-q', '-am', 'change');
    expect(changedFiles(root, 'HEAD~1')).toEqual(['packages/c/src/index.ts']);
    expect(changedOutsideTree(root, 'HEAD~1')).toEqual(['pnpm-lock.yaml']);
  });
});

describe('select-affected-tests — readers', () => {
  it('drops a filter another one already matches, as the vitest invocation guard requires (objectui#7814)', () => {
    expect(dedupeFilters(['packages/c/src/plain.test.tsx', 'packages/c/src/plain.test.ts', 'packages/c/'])).toEqual([
      'packages/c/',
    ]);
    expect(dedupeFilters(['x/a.test.tsx', 'x/a.test.ts'])).toEqual(['x/a.test.ts']);
  });

  it('reads every import spelling the selector depends on', () => {
    const { specifiers, globsTheTree } = moduleSpecifiers(
      [
        "import a from './a';",
        "import type { B } from './b';",
        "export * from './c';",
        "import './d';",
        "const e = await import('./e');",
        "const f = require('./f');",
        "vi.mock('./g', async (importOriginal) => ({ ...(await importOriginal()) }));",
        'import {\n  h,\n  i,\n} from "./h";',
        "const files = import.meta.glob('../**/*.md');",
      ].join('\n'),
    );
    expect(specifiers.sort()).toEqual(['./a', './b', './c', './d', './e', './f', './g', './h']);
    expect(globsTheTree).toBe(true);
  });

  it('refuses a workspace glob shape it does not know', () => {
    expect(parseWorkspaceGlobs("packages:\n  - 'packages/*'\n  - docs\n")).toEqual(['packages/*', 'docs']);
    expect(() => parseWorkspaceGlobs("packages:\n  - 'packages/**'\n")).toThrow(/does not know/);
    expect(() => parseWorkspaceGlobs('catalog: {}\n')).toThrow(/declares no packages/);
  });

  it('summarises an import CYCLE without looping, every member seeing the whole cycle', () => {
    const { root } = fixture({
      'p/x.ts': "import './y';\n",
      'p/y.ts': "import './x';\nimport 'node:fs';\n",
    });
    const summaries = closureSummaries(root, ['p/x.ts'], new Set(), () => 'p');
    expect(summaries.get('p/x.ts')?.readsDisk).toBe(true);
    expect(summaries.get('p/y.ts')?.readsDisk).toBe(true);
  });
});

describe('select-affected-tests — the live tree', () => {
  const packages = listWorkspacePackages(repoRoot);
  const { dependentClosure } = packageClosures(packages);

  it('agrees with turbo on who depends on whom', () => {
    // The header promises `turbo ls --affected`'s answer. Held, not assumed, on
    // a leaf, a mid-graph and a root package.
    const turbo = path.join(repoRoot, 'node_modules/.bin/turbo');
    for (const name of ['@object-ui/plugin-kanban', '@object-ui/app-shell', '@object-ui/i18n']) {
      const out = execFileSync(turbo, ['ls', name, '--output=json'], { cwd: repoRoot, encoding: 'utf8' });
      const reading = JSON.parse(out) as { packages: Array<{ name: string; dependents: string[] }> };
      const theirs = reading.packages.find((p) => p.name === name)?.dependents ?? [];
      expect(theirs.length, `turbo named no dependents for ${name}; a broken reading, not a leaf`).toBeGreaterThan(
        name === '@object-ui/app-shell' ? 0 : 1,
      );
      expect([...(dependentClosure.get(name) ?? [])].sort()).toEqual([...theirs].sort());
    }
  });

  it('reads the real dom-heavy project, and every file it names is tracked', () => {
    const heavy = readHeavyProject(fs.readFileSync(path.join(repoRoot, 'vitest.config.mts'), 'utf8'));
    expect(heavy.setupFile).toMatch(/^vitest\.setup\.[^/]+$/);
    const tracked = new Set(trackedFiles(repoRoot));
    expect(tracked.has(heavy.setupFile)).toBe(true);
    expect(heavy.tests.filter((t) => !tracked.has(t))).toEqual([]);
  });

  it('reaches a verdict from the command line, and an empty change still selects the always-on set', () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'select-affected-cli-')), 'filters.txt');
    tmpRoots.push(path.dirname(out));
    const run = spawnSync(process.execPath, ['scripts/select-affected-tests.mjs', '--base', 'HEAD', '--out', out], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim().split('\n').pop()).toBe('mode=affected');
    const filters = fs.readFileSync(out, 'utf8').trim().split('\n');
    expect(filters.length).toBeGreaterThan(0);
    expect(filters.every((f) => fs.existsSync(path.join(repoRoot, f)))).toBe(true);
  });

  it('answers "could not decide" with a non-zero exit, never a verdict', () => {
    const run = spawnSync(process.execPath, ['scripts/select-affected-tests.mjs', '--base', 'no-such-ref-12214', '--explain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(run.status).toBe(2);
    expect(run.stdout).not.toMatch(/^mode=/m);
  });
});

// objectui ci.yml's `test` job wired this selector; objectstack#25712 retired
// these pins with that file, and objectstack#25868 wired the selector into the
// root `test-ui` job that replaced it, so they read that job now.
describe("the root ci.yml's Test UI job wires the selector fail-open (objectui#12214, objectstack#25868)", () => {
  const code = withoutComments(rootCi());
  const job = jobBlock(code, UI_JOBS.test);

  it('runs the full battery hourly on main, beside push', () => {
    expect(triggerBlock(code)).toMatch(/^ {2}schedule:\n {4}- cron: '[^']+'$/m);
  });

  it('selects only on pull_request and merge_group, and treats every other event as full', () => {
    const step = job.slice(job.indexOf('- name: Select the tests this change affects'));
    expect(step).toMatch(/pull_request\)\n\s+if \[ -n "\$PR_BASE_REF" \]; then\n\s+base=\$\(git merge-base "refs\/remotes\/origin\/\$PR_BASE_REF" HEAD\) \|\| base=''/);
    expect(step).toMatch(/merge_group\) base="\$QUEUE_BASE"/);
    expect(step).toMatch(/\*\)\n\s+echo 'mode=full' >> "\$GITHUB_OUTPUT"/);
  });

  it('turns a selector that cannot decide into a full run, not a skip', () => {
    const step = job.slice(job.indexOf('- name: Select the tests this change affects'));
    expect(step).toContain('|| status=$?');
    expect(step).toMatch(/verdict='mode=full'/);
    // objectui#6221: the status must not be swallowed by a command substitution.
    expect(step).not.toMatch(/\$\(node ui\/scripts\/select-affected-tests\.mjs/);
  });

  it('checks out the history the diff base needs', () => {
    expect(job).toMatch(/uses: actions\/checkout@\S+\n\s+with:\n\s+fetch-depth: 0\n/);
  });

  it('keeps the matrix width and the full-suite command for the full battery', () => {
    // The width is the job's own `shard:` list, read by the monorepo's one reader of
    // shard sizes (it refuses any other spelling); every `/N` the job's run step
    // spells must be that width.
    const shards = shardTotal(rootCi(), UI_JOBS.test);
    const header = `- name: Run the ui tests (shard \${{ matrix.shard }}/${shards})`;
    expect(job).toContain(header);
    const run = job.slice(job.indexOf(header));
    expect(run).toContain(`${uiRun('test')} --shard=\${{ matrix.shard }}/${shards}`);
    expect(run).toContain(`pnpm --dir ui exec vitest run --shard=\${{ matrix.shard }}/${shards} --reporter=default --reporter=github-actions "\${filters[@]}"`);
  });
});

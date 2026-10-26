import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  closureSummaries,
  dedupeFilters,
  listWorkspacePackages,
  moduleSpecifiers,
  packageClosures,
  parseWorkspaceGlobs,
  readHeavyProject,
  selectAffectedTests,
  trackedFiles,
} from '../select-affected-tests.mjs';

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

describe('ci.yml wires the selector fail-open (objectui#12214)', () => {
  const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const code = ci
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  it('runs the full battery hourly on main, beside push', () => {
    expect(code).toMatch(/^ {2}schedule:\n {4}- cron: '[^']+'$/m);
    expect(code).toMatch(/^ {4}if: github\.event_name == 'push' \|\| github\.event_name == 'schedule'$/m);
  });

  it('selects only on pull_request and merge_group, and treats every other event as full', () => {
    const step = code.slice(code.indexOf('- name: Select the tests this change affects'));
    expect(step).toMatch(/pull_request\) base="\$PR_BASE"/);
    expect(step).toMatch(/merge_group\) base="\$QUEUE_BASE"/);
    expect(step).toMatch(/\*\)\n\s+echo 'mode=full' >> "\$GITHUB_OUTPUT"/);
  });

  it('turns a selector that cannot decide into a full run, not a skip', () => {
    const step = code.slice(code.indexOf('- name: Select the tests this change affects'));
    expect(step).toContain('|| status=$?');
    expect(step).toMatch(/verdict='mode=full'/);
    // objectui#6221: the status must not be swallowed by a command substitution.
    expect(step).not.toMatch(/\$\(node scripts\/select-affected-tests\.mjs/);
  });

  it('keeps the matrix width and the full-suite command for the full battery', () => {
    const run = code.slice(code.indexOf('- name: Run tests (shard ${{ matrix.shard }}/16)'));
    expect(run).toContain('pnpm test --shard=${{ matrix.shard }}/16');
    expect(run).toContain('pnpm exec vitest run --shard=${{ matrix.shard }}/16 "${filters[@]}"');
  });
});

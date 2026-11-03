import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TURBO_EXTENDS,
  packageOwnRootAnchoredInputs,
  packageRootAnchoredInputs,
  packageTaskInputs,
  repoRoot,
  type TurboTasks,
} from './helpers/turbo-inputs';

/**
 * objectstack#29361 — the turbo-input guards read the inputs turbo resolves
 * for the package a row judges, not the root task's list alone. These pin the
 * reader against fixtures for each of turbo's three resolutions, and against
 * the live tree for the one package that carries its own turbo.json today.
 */

const ROOT: TurboTasks = {
  tasks: {
    build: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/shared.ts'] },
    'type-check': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/tsconfig.json'] },
  },
};
const OWN_ONLY = '$TURBO_ROOT$/packages/other/src/only-here.ts';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'turbo-inputs-package-config-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** A scratch package directory holding a `package.json` with this name. */
function scratchPackage(name: string): string {
  const dir = fs.mkdtempSync(path.join(scratch, 'pkg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }));
  return dir;
}

describe('packageTaskInputs: turbo resolves a package task through its own turbo.json', () => {
  it('a package with no turbo.json reads the root task list unchanged', () => {
    const dir = scratchPackage('@fixture/plain');
    expect(packageTaskInputs('build', dir, ROOT, null)).toEqual(ROOT.tasks!.build.inputs);
  });

  it('a package task that declares no inputs inherits the root task list', () => {
    const dir = scratchPackage('@fixture/outputs-only');
    const own: TurboTasks = { tasks: { build: {} } };
    expect(packageTaskInputs('build', dir, ROOT, own)).toEqual(ROOT.tasks!.build.inputs);
  });

  it('an input list holding $TURBO_EXTENDS$ is the root list plus the package entries', () => {
    const dir = scratchPackage('@fixture/extends');
    const own: TurboTasks = { tasks: { build: { inputs: [TURBO_EXTENDS, OWN_ONLY] } } };
    expect(packageTaskInputs('build', dir, ROOT, own)).toEqual([
      '$TURBO_DEFAULT$',
      '$TURBO_ROOT$/scripts/shared.ts',
      OWN_ONLY,
    ]);
    expect(packageRootAnchoredInputs('build', dir, ROOT, own)).toEqual([
      'scripts/shared.ts',
      'packages/other/src/only-here.ts',
    ]);
    expect(packageOwnRootAnchoredInputs('build', dir, own)).toEqual(['packages/other/src/only-here.ts']);
  });

  it('the marker extends wherever it sits in the list, as turbo reads it', () => {
    const dir = scratchPackage('@fixture/extends-last');
    const own: TurboTasks = { tasks: { build: { inputs: [OWN_ONLY, TURBO_EXTENDS] } } };
    expect(packageRootAnchoredInputs('build', dir, ROOT, own)).toEqual([
      'scripts/shared.ts',
      'packages/other/src/only-here.ts',
    ]);
  });

  it('an input list without the marker replaces the root list: the root entries stop counting', () => {
    const dir = scratchPackage('@fixture/replaces');
    const own: TurboTasks = { tasks: { build: { inputs: [OWN_ONLY] } } };
    expect(packageTaskInputs('build', dir, ROOT, own)).toEqual([OWN_ONLY]);
    expect(packageRootAnchoredInputs('build', dir, ROOT, own)).not.toContain('scripts/shared.ts');
  });

  it("one package's turbo.json leaves another package's row and its other tasks alone", () => {
    const own: TurboTasks = { tasks: { build: { inputs: [TURBO_EXTENDS, OWN_ONLY] } } };
    const withOwn = scratchPackage('@fixture/with-own');
    const other = scratchPackage('@fixture/other');
    expect(packageRootAnchoredInputs('build', other, ROOT, null)).toEqual(['scripts/shared.ts']);
    expect(packageRootAnchoredInputs('type-check', withOwn, ROOT, own)).toEqual(['tsconfig.json']);
  });

  it('an empty replacing list throws instead of reading as a list that covers nothing', () => {
    const dir = scratchPackage('@fixture/empty');
    const own: TurboTasks = { tasks: { build: { inputs: [] } } };
    expect(() => packageTaskInputs('build', dir, ROOT, own)).toThrow(/empty `inputs` list/);
  });

  it('a root <package>#<task> override throws: the reader does not resolve that shape', () => {
    const dir = scratchPackage('@fixture/overridden');
    const root: TurboTasks = {
      tasks: { ...ROOT.tasks, '@fixture/overridden#build': { inputs: ['$TURBO_DEFAULT$'] } },
    };
    expect(() => packageTaskInputs('build', dir, root, null)).toThrow(/does not resolve a root/);
  });
});

describe('the live tree: the Service Worker generator hashes into the Console tasks only', () => {
  const GENERATOR = 'packages/mobile/src/serviceWorkerSource.ts';
  const consoleDir = path.join(repoRoot, 'apps/console');
  const coreDir = path.join(repoRoot, 'packages/core');

  it.each(['build', 'type-check'])(
    "@object-ui/console's %s reads the root list plus the generator, narrowed to this tree",
    (task) => {
      const resolved = packageRootAnchoredInputs(task, consoleDir);
      expect(resolved).toContain(GENERATOR);
      expect(resolved).toContain('scripts/vite-*.ts');
      expect(packageTaskInputs(task, consoleDir)).toContain('$TURBO_DEFAULT$');
    },
  );

  it.each(['build', 'type-check'])("another package's %s does not hash the generator", (task) => {
    expect(packageRootAnchoredInputs(task, coreDir)).not.toContain(GENERATOR);
  });

  it("every package's test still hashes it: the root ui vitest config loads the Console's vite.config.ts", () => {
    expect(packageRootAnchoredInputs('test', coreDir)).toContain(GENERATOR);
    expect(packageRootAnchoredInputs('test', consoleDir)).toContain(GENERATOR);
  });
});

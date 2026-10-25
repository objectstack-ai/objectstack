/**
 * objectui#12958 — `scripts/objectstack-floor.mjs`. The card's three pins run through REAL
 * git over a throwaway objectstack-shaped history with annotated release tags; npm is a
 * recorded version list. No network.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareVersions, computeFloor, floorOfRange, installedVersion, main, planRanges, releaseTags } from '../objectstack-floor.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'objectstack-floor-test-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8', env }).stdout.trim();

// c1 - c2 [next.0] - c3 - c4 [next.1] - c5 [next.2: tagged, never on npm] - c6
const upstream = fs.mkdtempSync(path.join(scratch, 'objectstack-'));
git(upstream, 'init', '-q');
const sha: Record<string, string> = {};
for (const c of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
  git(upstream, 'commit', '-q', '--allow-empty', '-m', c);
  sha[c] = git(upstream, 'rev-parse', 'HEAD');
}
for (const [c, v] of [['c2', '1.0.0-next.0'], ['c4', '1.0.0-next.1'], ['c5', '1.0.0-next.2']]) git(upstream, 'tag', '-a', '-m', v, `@objectstack/spec@${v}`, sha[c]);
const published = ['0.9.0', '1.0.0-next.0', '1.0.0-next.1'];
const npm = (args: string[]) => (args[2] === 'versions' ? published : published.find((v) => args[1].endsWith(`@${v}`)));

describe('the floor is the earliest published release whose tag contains the pin (objectui#12958)', () => {
  it.each([
    ['inside a release', 'c3', '1.0.0-next.1'],
    ['exactly a release commit', 'c4', '1.0.0-next.1'],
    ['newer than every published release (its tag is not on npm)', 'c5', null],
    ['newer than every tag', 'c6', null],
  ])('pin %s', (_, c, floor) => {
    expect(sha[c]).toMatch(/^[0-9a-f]{40}$/);
    const tags = releaseTags(fs.mkdtempSync(path.join(scratch, 'fetch-')), upstream, sha[c]);
    expect(computeFloor({ published, ...tags })).toEqual({ floor, newest: '1.0.0-next.1' });
  });

  it('orders by semver precedence, prereleases included', () => {
    const ordered = ['0.9.0', '1.0.0-alpha', '1.0.0-next.2', '1.0.0-next.10', '1.0.0', '1.1.0'];
    expect([...ordered].reverse().sort(compareVersions)).toEqual(ordered);
    expect(() => compareVersions('1.0.0+build', '1.0.0')).toThrow();
  });
});

describe('the step, end to end', () => {
  function fixture(pin: string, spec = '^1.0.0-next.0') {
    const root = fs.mkdtempSync(path.join(scratch, 'root-'));
    const files: Record<string, string> = {
      '.objectstack-sha': `${pin}\n`,
      '.changeset/config.json': JSON.stringify({ fixed: [['@x/a']] }),
      'packages/a/package.json': JSON.stringify({ name: '@x/a', version: '2.0.0', dependencies: { '@objectstack/spec': spec, react: '^19.0.0' }, devDependencies: { '@objectstack/lint': '^1.0.0-next.2' } }),
      'packages/a/CHANGELOG.md': '# @x/a\n\n## 2.0.0\n\n### Minor Changes\n\n- abc123: a change\n',
    };
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    const read = () => ['package.json', 'CHANGELOG.md'].map((f) => fs.readFileSync(path.join(root, 'packages/a', f), 'utf8'));
    return { root, read };
  }
  const run = (root: string, argv: string[] = []) => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error')].map((s) => s.mockImplementation(() => {}));
    const code = main({ root, argv, env: { OBJECTSTACK_REPO_URL: upstream }, npm });
    const out = spies.flatMap((s) => s.mock.calls).join('\n');
    spies.forEach((s) => s.mockRestore());
    return { code, out };
  };

  it('moves a range below the floor, keeps one at or above it, and records the move in CHANGELOG.md', () => {
    const { root, read } = fixture(sha.c3);
    expect(run(root).code).toBe(0);
    const [manifest, changelog] = read();
    expect(JSON.parse(manifest)).toMatchObject({
      dependencies: { '@objectstack/spec': '^1.0.0-next.1', react: '^19.0.0' },
      devDependencies: { '@objectstack/lint': '^1.0.0-next.2' },
    });
    expect(changelog).toMatch(
      /^# @x\/a\n\n## 2\.0\.0\n\n### Dependency floors\n\n.*`1\.0\.0-next\.1`\.\n\n- `@objectstack\/spec` \(`dependencies`\): `\^1\.0\.0-next\.0` → `\^1\.0\.0-next\.1`\n\n### Minor Changes\n/,
    );
  });

  it('stops with exit 2 when no published release contains the pin, writing nothing', () => {
    const { root, read } = fixture(sha.c6);
    const before = read();
    const { code, out } = run(root);
    expect(code).toBe(2);
    expect(out).toContain(`the pin ${sha.c6}`);
    expect(out).toContain('the newest published release is 1.0.0-next.1');
    expect(read()).toEqual(before);
  });

  it('refuses a range it cannot read, and --dry-run reports without writing', () => {
    const unreadable = fixture(sha.c3, 'latest');
    const before = unreadable.read();
    expect(run(unreadable.root).code).toBe(1);
    expect(unreadable.read()).toEqual(before);
    const dry = fixture(sha.c4);
    const pristine = dry.read();
    expect(run(dry.root, ['--dry-run'])).toMatchObject({ code: 0, out: expect.stringContaining('^1.0.0-next.0 → ^1.0.0-next.1') });
    expect(dry.read()).toEqual(pristine);
  });

  it('reads a workspace: range as the workspace package\'s own version (objectstack ruling D1)', () => {
    // Inside the objectstack monorepo the ranges are `workspace:^`, which publishes as
    // `^<that package's version>`; the floor is that version, resolved per name.
    const own = (name: string) => (name === '@objectstack/spec' ? '1.0.0-next.1' : null);
    expect(floorOfRange('workspace:^', '@objectstack/spec', own)).toBe('1.0.0-next.1');
    expect(floorOfRange('workspace:*', '@objectstack/spec', own)).toBe('1.0.0-next.1');
    expect(floorOfRange('workspace:~', '@objectstack/spec', own)).toBe('1.0.0-next.1');
    expect(floorOfRange('workspace:^1.0.0-next.0', '@objectstack/spec', own)).toBe('1.0.0-next.0');
    // A workspace package this tree does not resolve, or a resolver that answers nothing, is UNREADABLE, never 0.0.0.
    expect(floorOfRange('workspace:^', '@objectstack/lint', own)).toBeNull();
    expect(floorOfRange('workspace:^', '@objectstack/spec', () => 'latest')).toBeNull();
    // Every semver spelling reads as before.
    expect(floorOfRange('^1.0.0-next.0', '@objectstack/spec', own)).toBe('1.0.0-next.0');
    expect(floorOfRange('latest', '@objectstack/spec', own)).toBeNull();

    const pkg = { name: '@x/a', dir: 'packages/a', manifest: { dependencies: { '@objectstack/spec': 'workspace:^', '@objectstack/lint': '^1.0.0-next.2' } } };
    const kept = planRanges([pkg], '1.0.0-next.1', { workspaceVersionOf: own });
    expect(kept.map((r) => [r.name, r.action, r.to])).toEqual([['@objectstack/spec', 'kept', 'workspace:^'], ['@objectstack/lint', 'kept', '^1.0.0-next.2']]);
    const below = planRanges([pkg], '1.0.0-next.2', { workspaceVersionOf: own });
    expect(below.map((r) => [r.name, r.action, r.to])).toEqual([['@objectstack/spec', 'moved', '^1.0.0-next.2'], ['@objectstack/lint', 'kept', '^1.0.0-next.2']]);
    // The default resolver knows no workspace: the range is unreadable, as before this change.
    expect(planRanges([pkg], '1.0.0-next.1').map((r) => r.action)).toEqual(['unreadable', 'kept']);
  });

  it('resolves a workspace package\'s version from the nearest node_modules, end to end', () => {
    const { root, read } = fixture(sha.c3, 'workspace:^');
    // Nothing installed: the range cannot be read, nothing is written.
    const before = read();
    expect(run(root).code).toBe(1);
    expect(read()).toEqual(before);
    expect(installedVersion(root, '@objectstack/spec')).toBeNull();
    // The workspace spec at the floor: kept.
    fs.mkdirSync(path.join(root, 'node_modules/@objectstack/spec'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/@objectstack/spec/package.json'), JSON.stringify({ name: '@objectstack/spec', version: '1.0.0-next.1' }));
    expect(installedVersion(root, '@objectstack/spec')).toBe('1.0.0-next.1');
    expect(installedVersion(path.join(root, 'packages/a'), '@objectstack/spec')).toBe('1.0.0-next.1');
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out).toContain('kept');
    expect(JSON.parse(read()[0]).dependencies['@objectstack/spec']).toBe('workspace:^');
  });

  it('runs first in `pnpm changeset:publish`, and between the build and the scan nightly', () => {
    const publish = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts['changeset:publish'];
    expect(publish).toMatch(/^node scripts\/objectstack-floor\.mjs && .*check-spec-range-floors\.mjs && changeset publish$/);
    const nightly = fs.readFileSync(path.join(repoRoot, '.github/workflows/spec-range-floors.yml'), 'utf8');
    const step = nightly.indexOf('\n          node scripts/objectstack-floor.mjs || code=$?\n');
    expect(step).toBeGreaterThan(nightly.indexOf('run: pnpm exec turbo run build'));
    expect(step).toBeLessThan(nightly.indexOf('run: pnpm check:spec-floors'));
  });
});

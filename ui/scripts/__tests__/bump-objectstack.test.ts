/**
 * objectui#12957 — `scripts/bump-objectstack.sh`, driven as shipped over throwaway
 * git repositories: the refusal and warning contract it copies from objectstack's
 * `scripts/bump-objectui.sh`.
 *
 *   - a commit that cannot be resolved or read REFUSES before anything is written:
 *     `.objectstack-sha` stays byte-identical (the failed-run invariant);
 *   - a readable commit on `origin/main` is pinned with no warning;
 *   - a readable commit NOT on `origin/main` is pinned WITH a warning naming the
 *     branch it is on — a warning, never a refusal;
 *   - a checkout with no `origin/main` says the question is unanswered rather than
 *     answering it either way;
 *   - re-pinning the same commit writes nothing;
 *   - the new pin is BUILT with `--write-manifests` (objectui#13008) and its packed
 *     manifests are committed with it; a build that fails restores the old pin.
 *     The build itself is objectstack-pin.test.ts's subject: here a stub stands in
 *     for `scripts/objectstack-pin.mjs` and records how it was called.
 *
 * The cases that pin a commit are the firing controls of the refusal cases: a
 * guard that refused everything would fail them.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'scripts/bump-objectstack.sh');
const OLD_PIN = 'a'.repeat(40);

// Anchored on the OS temp directory at module scope, so no path below can be
// read as relative to the process cwd (`pnpm check:test-path-roots`).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-objectstack-'));

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

/**
 * The pin script's stand-in: records its argv and whether OBJECTSTACK_ROOT reached
 * it, writes a manifest naming the pin it read, and fails when STUB_FAIL is set.
 */
const PIN_STUB = `import fs from 'node:fs';
fs.writeFileSync('build.called', JSON.stringify({ argv: process.argv.slice(2), standIn: 'OBJECTSTACK_ROOT' in process.env }));
if (process.env.STUB_FAIL) process.exit(1);
fs.writeFileSync('.objectstack-pin/spec/package.json', JSON.stringify({ name: '@objectstack/spec', pin: fs.readFileSync('.objectstack-sha', 'utf8').trim() }) + '\\n');
`;

/** A fresh objectui-shaped directory holding the REAL script, a stub pin script, an old pin and its manifest. */
function makeObjectui(name: string): string {
  const dir = path.join(scratch, name, 'objectui');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts/bump-objectstack.sh'));
  fs.writeFileSync(path.join(dir, 'scripts/objectstack-pin.mjs'), PIN_STUB);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'build.called\n');
  fs.writeFileSync(path.join(dir, '.objectstack-sha'), `${OLD_PIN}\n`);
  fs.mkdirSync(path.join(dir, '.objectstack-pin/spec'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.objectstack-pin/spec/package.json'), '{"name":"@objectstack/spec","pin":"old"}\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/** An objectstack checkout with `origin/main`, plus one commit on an unmerged local branch. */
function makeObjectstack(name: string, { withOrigin = true } = {}) {
  const base = path.join(scratch, name);
  const upstream = path.join(base, 'upstream');
  fs.mkdirSync(upstream, { recursive: true });
  git(upstream, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(upstream, 'VERSION.txt'), 'one\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-q', '-m', 'feat(spec): first');
  fs.writeFileSync(path.join(upstream, 'VERSION.txt'), 'two\n');
  git(upstream, 'commit', '-qam', 'feat(spec): second on main');
  const checkout = path.join(base, 'objectstack');
  if (withOrigin) {
    git(base, 'clone', '-q', upstream, checkout);
  } else {
    git(base, 'clone', '-q', '--no-local', upstream, checkout);
    git(checkout, 'remote', 'remove', 'origin');
  }
  const mainTip = git(checkout, 'rev-parse', 'HEAD');
  git(checkout, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(checkout, 'VERSION.txt'), 'three\n');
  git(checkout, 'commit', '-qam', 'wip: not on main');
  const featureTip = git(checkout, 'rev-parse', 'HEAD');
  git(checkout, 'checkout', '-q', 'main');
  return { checkout, mainTip, featureTip };
}

function bump(objectui: string, objectstack: string, ...args: string[]) {
  return bumpWith({}, objectui, objectstack, ...args);
}

function bumpWith(env: Record<string, string>, objectui: string, objectstack: string, ...args: string[]) {
  return spawnSync('bash', [path.join(objectui, 'scripts/bump-objectstack.sh'), ...args], {
    cwd: objectui,
    encoding: 'utf8',
    env: { ...GIT_ENV, OBJECTSTACK_ROOT: objectstack, ...env },
  });
}

const pinOf = (objectui: string) => fs.readFileSync(path.join(objectui, '.objectstack-sha'), 'utf8');
/** How the stub pin script was called, or null when the bump never built. */
const buildCall = (objectui: string) => {
  const file = path.join(objectui, 'build.called');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('scripts/bump-objectstack.sh (objectui#12957)', () => {
  it('pins a readable commit on origin/main, with no warning, and commits the pin with its built manifests', () => {
    const { checkout, mainTip } = makeObjectstack('on-main');
    const objectui = makeObjectui('on-main');
    const r = bump(objectui, checkout, 'origin/main');
    expect(r.status, r.stderr).toBe(0);
    expect(pinOf(objectui)).toBe(`${mainTip}\n`);
    expect(r.stdout).toContain('(on origin/main)');
    expect(r.stderr).not.toContain('NOT reachable');
    // The pin was built, as the pin and not as a stand-in for the checkout read above.
    expect(buildCall(objectui)).toEqual({ argv: ['build', '--write-manifests'], standIn: false });
    expect(git(objectui, 'log', '-1', '--format=%s')).toBe(`chore: bump objectstack to ${mainTip.slice(0, 12)}`);
    expect(git(objectui, 'show', '--name-only', '--relative', '--format=', 'HEAD').split('\n').sort()).toEqual(['.objectstack-pin/spec/package.json', '.objectstack-sha']);
    expect(git(objectui, 'show', 'HEAD:./.objectstack-pin/spec/package.json')).toContain(mainTip);
  });

  it('REFUSES when the build of the new pin fails, restores the old pin, and commits nothing', () => {
    const { checkout } = makeObjectstack('build-fails');
    const objectui = makeObjectui('build-fails');
    const r = bumpWith({ STUB_FAIL: '1' }, objectui, checkout, 'origin/main');
    expect(r.status).toBe(1);
    expect(buildCall(objectui), 'the failure must come from the build, or this case tests nothing').not.toBeNull();
    expect(r.stderr).toContain('REFUSING to bump');
    expect(pinOf(objectui)).toBe(`${OLD_PIN}\n`);
    expect(git(objectui, 'status', '--porcelain')).toBe('');
    expect(git(objectui, 'log', '-1', '--format=%s')).toBe('init');
  });

  it('WARNS, and still pins, a readable commit that is not on origin/main', () => {
    const { checkout, featureTip } = makeObjectstack('off-main');
    const objectui = makeObjectui('off-main');
    const r = bump(objectui, checkout, 'feature', '--no-commit');
    expect(r.status, r.stderr).toBe(0);
    expect(pinOf(objectui)).toBe(`${featureTip}\n`);
    expect(r.stderr).toContain(`objectstack pin ${featureTip.slice(0, 12)} is NOT reachable from origin/main`);
    expect(r.stderr).toContain('on local branches : feature');
    expect(r.stdout).toContain('--no-commit: leaving .objectstack-sha and .objectstack-pin unstaged');
    expect(git(objectui, 'status', '--porcelain').split('\n').map((l) => l.trim()).sort()).toEqual(['M .objectstack-pin/spec/package.json', 'M .objectstack-sha']);
  });

  it('says the question is UNANSWERED when the checkout has no origin/main', () => {
    const { checkout, mainTip } = makeObjectstack('no-origin', { withOrigin: false });
    const objectui = makeObjectui('no-origin');
    const r = bump(objectui, checkout, '--no-commit');
    expect(r.status, r.stderr).toBe(0);
    expect(pinOf(objectui)).toBe(`${mainTip}\n`);
    expect(r.stderr).toContain(`COULD NOT DETERMINE whether ${mainTip.slice(0, 12)} is on objectstack main`);
    expect(r.stderr).not.toContain('NOT reachable');
  });

  it('REFUSES a ref that does not resolve, and writes nothing', () => {
    const { checkout } = makeObjectstack('unresolvable');
    const objectui = makeObjectui('unresolvable');
    const r = bump(objectui, checkout, 'no-such-ref');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("REFUSING to bump: 'no-such-ref' does not resolve");
    expect(buildCall(objectui)).toBeNull();
    expect(pinOf(objectui)).toBe(`${OLD_PIN}\n`);
    expect(git(objectui, 'status', '--porcelain')).toBe('');
  });

  it('REFUSES a commit whose object cannot be read, and writes nothing', () => {
    const { checkout, mainTip } = makeObjectstack('unreadable');
    const objectui = makeObjectui('unreadable');
    // Delete the loose object of HEAD's commit: `rev-parse HEAD` still resolves the
    // ref, the object behind it is gone.
    const objectFile = path.join(checkout, '.git/objects', mainTip.slice(0, 2), mainTip.slice(2));
    expect(fs.existsSync(objectFile), 'the commit must be a loose object for this case to mean anything').toBe(true);
    fs.rmSync(objectFile, { force: true });
    expect(spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()).toBe(mainTip);
    const r = bump(objectui, checkout);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REFUSING to bump');
    expect(r.stderr).toContain('NOTHING WAS WRITTEN');
    expect(pinOf(objectui)).toBe(`${OLD_PIN}\n`);
    expect(git(objectui, 'status', '--porcelain')).toBe('');
  });

  it('writes nothing when the commit is already the pin', () => {
    const { checkout, mainTip } = makeObjectstack('same');
    const objectui = makeObjectui('same');
    fs.writeFileSync(path.join(objectui, '.objectstack-sha'), `${mainTip}\n`);
    git(objectui, 'commit', '-qam', 'pin');
    const r = bump(objectui, checkout);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Already at ${mainTip.slice(0, 12)} (on origin/main), nothing to do.`);
    expect(git(objectui, 'status', '--porcelain')).toBe('');
  });

  it('prints its help from the header and stops at the sentinel', () => {
    const r = spawnSync('bash', [SCRIPT, '--help'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Bump the objectstack commit this workspace builds @objectstack/* from.');
    expect(r.stdout).not.toContain('SENTINEL, not prose');
  });
});

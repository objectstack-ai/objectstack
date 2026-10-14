// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gitFreeEnv } from '../../../../scripts/git-env.mjs';
import { listRepoWalkFiles } from './repo-walk-testkit';

// ─── the pin for `repo-walk-testkit.ts`: a generated page that names a retired key leaves the walks green ──
//
// The four repo-radius walks that went red on a docs-built checkout
// (`api/export-job-family-retirement`, `system/compliance-families-retirement`,
// `integration/connector-connection-timeout-retirement`,
// `data/currency-mode-family-closure.pin`) take their file list from
// `listRepoWalkFiles`. This file holds that list to "what git does not ignore".
//
// ## Why the fixture lives in a throwaway repository, not in the real tree
//
// The fixture is a page under `content/docs/protocol-upgrade/` that names a
// retired key. In THIS repository that directory cannot hold a committed file,
// measured both ways at `cb9841aa2`:
//
//   - committed, it turns `check:merge-driver` red: `scripts/regen-artifacts.mjs`
//     declares `content/docs/protocol-upgrade/**` untracked, and
//     `scripts/git-merge-regen.mjs` answers "declared untracked, but git tracks
//     1 file(s)";
//   - present under any name the generator does not write, it breaks the docs
//     build: `gen:upgrade-guide` refuses a directory holding a foreign file.
//
// So the fixture sits at the same path inside a throwaway repository whose
// `.gitignore` carries the real repository's two lines, beside the same page
// where git keeps it (the control), and the last case binds the two: the real
// checkout ignores those very paths. Same shape as `scripts/check-role-word.mjs`'s
// skipped-subtree battery: a page inside the skipped tree, the same page outside
// it, and a sibling whose name only starts with it.

const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');

/** The docs build's generated page for protocol 18, and the publish lane's single-file copy. */
const GUIDE_PAGE = 'content/docs/protocol-upgrade/18.md';
const GUIDE_COPY = 'packages/spec/protocol-upgrade-guide.md';

/**
 * The retired key, assembled at runtime: the connector walk reads every `.ts`
 * under `packages/`, so spelling it whole in this file would make this file
 * its offender.
 */
const RETIRED_KEY = ['connector', 'connectionTimeoutMs'].join('.');

/**
 * THE FIXTURE — the generated protocol-18 page's line that turned
 * `integration/connector-connection-timeout-retirement` red (its offender
 * line read "authors" and the member read), excerpted. The key sits outside
 * inline code, which is the shape that walk flags.
 */
const FIXTURE = [
  '## Protocol 17 → 18',
  '',
  `  - Why not automatic: ADR-0049 enforce-or-remove: retire ${RETIRED_KEY}. The spec key is tombstoned.`,
  '',
].join('\n');

/** Fixture git only: no inherited `GIT_*`, no global or system config. */
const HERMETIC_ENV: NodeJS.ProcessEnv = { ...gitFreeEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const GIT_ARGS = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0'];

const git = (args: string[], cwd: string, env: NodeJS.ProcessEnv = HERMETIC_ENV) => {
  const r = spawnSync('git', [...GIT_ARGS, ...args], { cwd, encoding: 'utf8', env });
  if (r.error) throw r.error;
  return r;
};
const mustGit = (args: string[], cwd: string) => {
  const r = git(args, cwd);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
};

describe('repo-walk-testkit — a repo-radius walk reads what git does not ignore', () => {
  let sandbox = '';
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(sandbox, rel)), { recursive: true });
    fs.writeFileSync(path.join(sandbox, rel), text);
  };
  /** The listing for each root, as `/`-separated paths relative to `base`. */
  const listUnder = (base: string, roots: string[], skipDir?: (name: string) => boolean) =>
    roots.flatMap((root) =>
      listRepoWalkFiles(path.join(base, root), { skipDir }).map((full) => path.relative(base, full).split(path.sep).join('/')),
    );

  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'os-repo-walk-testkit-'));
    mustGit(['init', '-q'], sandbox);
    // The listing runs with the caller's own git config; a personal global
    // excludes file must not decide what this sandbox ignores.
    mustGit(['config', 'core.excludesFile', '/dev/null'], sandbox);
    // The real repository's two lines for the guide's generated outputs, plus one ignored tree to force-add into.
    put('.gitignore', `${path.posix.dirname(GUIDE_PAGE)}/\n${GUIDE_COPY}\ngenerated/\n`);

    put('content/docs/guides/upgrade.md', FIXTURE); // the control: the same page where git keeps it
    put('packages/spec/README.md', FIXTURE); // the control beside the single-file copy
    put('content/docs/dist/bundle.md', FIXTURE); // tracked, under a directory the caller skips by name
    put('content/docs/deleted.md', FIXTURE); // tracked, then deleted from the work tree
    put('content/generated/forced.md', FIXTURE); // tracked although its directory is ignored
    mustGit(['add', '-A'], sandbox);
    mustGit(['add', '-f', 'content/generated/forced.md'], sandbox);
    mustGit(['commit', '-q', '-m', 'fixture'], sandbox);
    fs.rmSync(path.join(sandbox, 'content/docs/deleted.md'));

    put(GUIDE_PAGE, FIXTURE); // THE FIXTURE: generated, ignored, never committed
    put(GUIDE_COPY, FIXTURE); // the publish lane's copy, ignored the same way
    put('content/docs/protocol-upgrade-draft/18.md', FIXTURE); // new, not ignored, not yet added
  });

  afterAll(() => {
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('the fixture is not inert: it names the retired key outside inline code', () => {
    expect(FIXTURE.replace(/`[^`\n]*`/g, '')).toContain(RETIRED_KEY);
  });

  it('a page naming a retired key under the gitignored upgrade-guide tree is not listed; the same page is wherever git keeps it', () => {
    // Positive control: the excluded pages are ON DISK, so their absence below is the ignore working.
    for (const rel of [GUIDE_PAGE, GUIDE_COPY]) expect(fs.readFileSync(path.join(sandbox, rel), 'utf8')).toBe(FIXTURE);

    const listed = listUnder(sandbox, ['content', 'packages'], (name) => name === 'dist');
    expect(listed).toEqual([
      'content/docs/guides/upgrade.md', // tracked: the control
      // untracked and NOT ignored: a page not yet added is still judged, and the
      // exclusion is a path, never a string prefix of `protocol-upgrade`
      'content/docs/protocol-upgrade-draft/18.md',
      'content/generated/forced.md', // tracked wins over `.gitignore`, as in CI's checkout
      'packages/spec/README.md', // tracked: the control beside the single-file copy
    ]);
    // Left out, each for its own reason: GUIDE_PAGE and GUIDE_COPY are ignored,
    // `content/docs/dist/` is skipped by name, `content/docs/deleted.md` is gone.
  });

  it('loud, never empty: a missing root, a root that is a file, and a tree git cannot read all throw', () => {
    expect(() => listUnder(sandbox, ['content/no-such-root'])).toThrow(/ENOENT/);
    expect(() => listUnder(sandbox, ['packages/spec/README.md'])).toThrow(/not a directory/);
    // A `.git` file pointing nowhere: git refuses (exit 128), whatever encloses the temp dir.
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'os-repo-walk-testkit-broken-'));
    try {
      fs.mkdirSync(path.join(broken, 'content'));
      fs.writeFileSync(path.join(broken, 'content', 'page.md'), FIXTURE);
      fs.writeFileSync(path.join(broken, '.git'), `gitdir: ${path.join(broken, 'missing')}\n`);
      expect(() => listUnder(broken, ['content'])).toThrow(/exited 128/);
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
    }
  });

  it('the real checkout ignores the guide\'s two generated outputs, and keeps an authored docs page', () => {
    const ignored = (rel: string) => git(['check-ignore', '-q', '--', rel], REPO_ROOT, gitFreeEnv()).status;
    expect(ignored(GUIDE_PAGE), `${GUIDE_PAGE} must be gitignored here`).toBe(0);
    expect(ignored(GUIDE_COPY), `${GUIDE_COPY} must be gitignored here`).toBe(0);
    // Control: a tracked, authored page answers "not ignored", so the two zeros above are not a blanket answer.
    expect(ignored('content/docs/meta.json')).toBe(1);
    // Live on a checkout that has built the docs, vacuous on a fresh one (the
    // sandbox cases above are what can fail everywhere): nothing listed lies
    // under the generated tree, and the listing reaches the docs tree at all.
    const listed = listRepoWalkFiles(path.join(REPO_ROOT, 'content')).map((full) =>
      path.relative(REPO_ROOT, full).split(path.sep).join('/'),
    );
    expect(listed).toContain('content/docs/meta.json');
    expect(listed.filter((rel) => rel.startsWith(`${path.posix.dirname(GUIDE_PAGE)}/`))).toEqual([]);
  });
});

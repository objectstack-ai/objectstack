/**
 * Paths handed to git, in BOTH layouts (objectstack#25728). Standalone the git
 * repository root is the objectui tree; under the objectstack monorepo it is one
 * level up, and the tree is `ui/`. `scripts/workspace-root.mjs` ("Paths handed
 * to git") writes down the idiom -- git runs in the tree, a path into a revision
 * is `revPath(ref, path)` (`<ref>:./<path>`), a path listing carries
 * `--relative` -- and this file holds the readers that were the first reds on
 * the merged tree to the same answer in a scratch repository of each shape. The
 * nested shape is the one this checkout is not, so both branches run here
 * whichever layout the checkout is.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { revPath } from '../workspace-root.mjs';
import { LOCALES, analyze, packPath, readPacks, treeExistsAt } from '../check-i18n-en-drift.mjs';
import { changedFiles } from '../check-changeset-presence.mjs';
import { readBlobs, treeIndex } from '../check-changeset-claims.mjs';
import { collisions } from '../check-changeset-overwrite.mjs';
import { changedFiles as affectedChangedFiles } from '../select-affected-tests.mjs';

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

const pack = (value: string) => `export default {\n  common: {\n    save: '${value}',\n  },\n};\n`;
const allPacks = (value: string) => Object.fromEntries(LOCALES.map((lang: string) => [packPath(lang), pack(value)]));

/**
 * A repository whose objectui tree sits at `prefix` (`''` standalone, `'ui/'`
 * nested; then with one file of the monorepo's own beside it), and two commits.
 * Returns the TREE (what the scripts are handed as `root`) and both shas.
 */
function layout(prefix: string): { tree: string; base: string; head: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-paths-nested-'));
  tempRoots.push(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'gate@example.test');
  git('config', 'user.name', 'gate');
  const write = (files: Record<string, string>) => {
    for (const [rel, contents] of Object.entries(files)) {
      const full = path.join(repo, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    }
  };
  const under = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([rel, body]) => [prefix + rel, body]));

  write({
    ...under({
      ...allPacks('Save'),
      'packages/a/package.json': '{ "name": "@object-ui/a" }\n',
      '.changeset/keep.md': "---\n'@object-ui/a': patch\n---\n\nKeep.\n",
    }),
    ...(prefix ? { 'monorepo-own.txt': 'one\n' } : {}),
  });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');

  write({
    ...under({ [packPath('en')]: pack('Save now'), '.changeset/keep.md': "---\n'@object-ui/a': minor\n---\n\nKeep, louder.\n" }),
    ...(prefix ? { 'monorepo-own.txt': 'two\n' } : {}),
  });
  git('add', '-A');
  git('commit', '-q', '-m', 'head');
  const head = git('rev-parse', 'HEAD');
  return { tree: path.join(repo, prefix), base, head };
}

describe('check:i18n-drift over the change that IMPORTS the tree (objectstack#25728)', () => {
  it('reads an empty before side when the tree does not exist at the base, and still throws when only a pack is missing', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-paths-import-'));
    tempRoots.push(repo);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'gate@example.test');
    git('config', 'user.name', 'gate');
    const write = (files: Record<string, string>) => {
      for (const [rel, contents] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.writeFileSync(path.join(repo, rel), contents);
      }
    };
    write({ 'monorepo-own.txt': 'one\n' });
    git('add', '-A');
    git('commit', '-q', '-m', 'the monorepo before the import');
    const preImport = git('rev-parse', 'HEAD');
    write(Object.fromEntries(Object.entries(allPacks('Save')).map(([rel, body]) => [`ui/${rel}`, body])));
    git('add', '-A');
    git('commit', '-q', '-m', 'import ui/');
    const imported = git('rev-parse', 'HEAD');
    const tree = path.join(repo, 'ui');

    expect(treeExistsAt(tree, preImport)).toBe(false);
    const result = analyze(tree, { base: preImport, head: imported });
    expect(result.treeAtBase).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.counters.addedEnKeys).toBe(1);

    // The tree exists at the base but a pack does not: a broken input, never an empty side.
    fs.rmSync(path.join(tree, packPath('ja')));
    git('add', '-A');
    git('commit', '-q', '-m', 'lose a pack');
    const lost = git('rev-parse', 'HEAD');
    expect(() => analyze(tree, { base: lost, head: imported })).toThrow(/cannot read/);
  });
});

describe('revPath', () => {
  it('names a file at a revision relative to the cwd git runs in', () => {
    expect(revPath('HEAD', 'packages/i18n/src/locales/en.ts')).toBe('HEAD:./packages/i18n/src/locales/en.ts');
    expect(revPath('abc123', './scripts/x.mjs')).toBe('abc123:./scripts/x.mjs');
  });
});

for (const [name, prefix] of [
  ['standalone', ''],
  ['nested under ui/', 'ui/'],
] as const) {
  describe(`git paths, ${name} (objectstack#25728)`, () => {
    const { tree, base, head } = layout(prefix);

    it('reads a file at a revision through revPath, where the root-relative spelling only works standalone', () => {
      const show = (spec: string) => execFileSync('git', ['show', spec], { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      expect(show(revPath(base, packPath('en')))).toBe(pack('Save'));
      // The control: the spelling the readers used before. It must fail nested,
      // or this file would be measuring nothing.
      const rootRelative = () => show(`${base}:${packPath('en')}`);
      if (prefix) expect(rootRelative).toThrow();
      else expect(rootRelative()).toBe(pack('Save'));
    });

    it('check:i18n-drift reads the base packs and reaches its verdict (the run-4 red)', () => {
      expect(treeExistsAt(tree, base)).toBe(true);
      expect(readPacks(tree, base).get('en')?.get('common.save')).toBe('Save');
      const result = analyze(tree, { base, head });
      expect(result.treeAtBase).toBe(true);
      // en moved and none of the nine followers did: one finding naming all nine.
      expect(result.counters.changedEnKeys).toBe(1);
      expect(result.findings.map((f: { key: string; unfollowed: string[] }) => [f.key, f.unfollowed.length])).toEqual([['common.save', LOCALES.length - 1]]);
    });

    it('changed-file listings are relative to the tree and leave the monorepo’s own files out', () => {
      const want = ['.changeset/keep.md', packPath('en')].sort();
      // The working tree is the gate's default "after" side; it equals `head` here.
      expect(changedFiles(tree, { base }).sort()).toEqual(want);
      expect(affectedChangedFiles(tree, base, head).sort()).toEqual(want);
    });

    it('the tree index at a revision and in the working tree agree, and its blobs read', () => {
      const atHead = treeIndex(tree, head);
      const working = treeIndex(tree, null);
      expect([...atHead.paths].sort()).toEqual([...working.paths].sort());
      expect(atHead.paths.has('packages/a/package.json')).toBe(true);
      expect(readBlobs(tree, head, ['packages/a/package.json']).get('packages/a/package.json')).toContain('@object-ui/a');
    });

    it('check:changeset-overwrite reads the edited changeset at its base and in the working tree', () => {
      const { modified } = collisions(tree, { base });
      expect(modified.map((m: { file: string; before: unknown[]; after: unknown[]; lost: string[] }) => [m.file, m.before.length, m.after.length, m.lost])).toEqual([
        ['.changeset/keep.md', 1, 1, []],
      ]);
    });
  });
}

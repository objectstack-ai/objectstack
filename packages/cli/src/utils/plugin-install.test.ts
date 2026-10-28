// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The file-system half of `os plugin install` (ADR-0025 §3.5 M1): which
 * archive entries may be written, and how a verified artifact lands in its
 * install directory.
 *
 * Pinned: every entry that could land outside the install directory, collide
 * with another (in any letter case, or as a file and a directory at once), or
 * take one of the two reserved names is named (one line per entry); a
 * materialized install holds the unpacked files beside the ORIGINAL artifact
 * bytes and signature; a second install of one version replaces the first
 * whole, leaving no file of the first and no staging directory behind; and a
 * swap that fails at either rename puts the first install back.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256Hex } from './osplugin.js';
import {
  INSTALLED_ARTIFACT_FILE,
  INSTALLED_SIGNATURE_FILE,
  archiveEntryProblems,
  installedArtifactSha,
  materializePlugin,
} from './plugin-install.js';

/** A rename the test makes fail, by its (from, to) pair; every other rename is the real one. */
const renames = vi.hoisted(() => ({ fail: null as ((from: string, to: string) => boolean) | null }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (renames.fail?.(String(from), String(to))) throw Object.assign(new Error(`EXDEV: rename refused by the test`), { code: 'EXDEV' });
      return actual.renameSync(from, to);
    },
  };
});

const bytes = (text: string) => new TextEncoder().encode(text);
const entry = (path: string, text = path) => ({ path, data: bytes(text) });

describe('archiveEntryProblems', () => {
  it('accepts relative POSIX paths that stay inside the install directory', () => {
    expect(archiveEntryProblems([
      entry('objectstack.plugin.json'),
      entry('SIGNATURE'),
      entry('dist/index.mjs'),
      entry('dist/lib/a..b.js'),
    ])).toEqual([]);
  });

  it.each([
    ['/etc/passwd', 'not a relative POSIX path'],
    ['C:/x.js', 'not a relative POSIX path'],
    ['dist\\index.js', 'not a relative POSIX path'],
    ['dist/\u0000.js', 'not a relative POSIX path'],
    ['', 'not a relative POSIX path'],
    ['../escape.txt', "'..' segment"],
    ['dist/../../escape.txt', "'..' segment"],
    ['./dist/index.mjs', "'..' segment"],
    ['dist//index.mjs', "'..' segment"],
    ['dist/', "'..' segment"],
    [INSTALLED_ARTIFACT_FILE, 'reserves this name'],
    [INSTALLED_SIGNATURE_FILE, 'reserves this name'],
    ['Artifact.OSPLUGIN', 'reserves this name'],
    ['artifact.osplugin.SIG', 'reserves this name'],
  ])('refuses %j', (path, reason) => {
    const problems = archiveEntryProblems([entry('dist/index.mjs'), entry(path)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(JSON.stringify(path));
    expect(problems[0]).toContain(reason);
  });

  it('refuses a path that appears twice, naming it once per repeat', () => {
    const problems = archiveEntryProblems([entry('dist/index.mjs', 'a'), entry('dist/index.mjs', 'b')]);
    expect(problems).toEqual(['"dist/index.mjs": appears more than once']);
  });

  it('refuses two paths that differ only in letter case, naming both', () => {
    const problems = archiveEntryProblems([entry('dist/Index.mjs'), entry('dist/index.mjs')]);
    expect(problems).toEqual(['"dist/index.mjs": differs from "dist/Index.mjs" only in letter case']);
  });

  it.each([
    [['dist', 'dist/index.mjs'], '"dist/index.mjs": sits under "dist"'],
    [['dist/lib/a.js', 'dist/lib'], '"dist/lib/a.js": sits under "dist/lib"'],
    [['Dist', 'dist/index.mjs'], '"dist/index.mjs": sits under "Dist"'],
  ])('refuses a file that is also the directory of another entry: %j', (paths, line) => {
    const problems = archiveEntryProblems(paths.map((p) => entry(p)));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(line);
    expect(problems[0]).toContain('which is a file in the same archive');
  });

  it('control: a directory shared by two files, and a name that only starts like a sibling, are fine', () => {
    expect(archiveEntryProblems([entry('dist/a.js'), entry('dist/b.js'), entry('dist.js'), entry('dist-extra/c.js')])).toEqual([]);
  });
});

describe('installedArtifactSha', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('is undefined for no directory, null for a directory with no artifact, and the artifact sha otherwise', () => {
    const parent = mkdtempSync(join(tmpdir(), 'os-plugin-installed-sha-'));
    dirs.push(parent);
    const dir = join(parent, '1.0.0');
    expect(installedArtifactSha(dir)).toBeUndefined();
    mkdirSync(dir);
    expect(installedArtifactSha(dir)).toBeNull();
    writeFileSync(join(dir, INSTALLED_ARTIFACT_FILE), 'the bytes');
    expect(installedArtifactSha(dir)).toBe(sha256Hex(bytes('the bytes')));
  });
});

describe('materializePlugin', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function scratch(): string {
    const d = mkdtempSync(join(tmpdir(), 'os-plugin-materialize-'));
    dirs.push(d);
    return d;
  }

  it('writes the unpacked files beside the original artifact bytes and its signature', () => {
    const dir = join(scratch(), 'plugins', 'env_local', 'com.acme.a', '1.0.0');
    const artifact = bytes('the signed archive bytes');
    const result = materializePlugin({
      dir,
      files: [entry('objectstack.plugin.json', '{}'), entry('dist/index.mjs', 'export {}')],
      artifact,
      signature: 'ed25519:acme:sig',
    });
    expect(result).toEqual({ replaced: false });
    expect(readFileSync(join(dir, 'dist', 'index.mjs'), 'utf8')).toBe('export {}');
    expect(new Uint8Array(readFileSync(join(dir, INSTALLED_ARTIFACT_FILE)))).toEqual(artifact);
    expect(readFileSync(join(dir, INSTALLED_SIGNATURE_FILE), 'utf8')).toBe('ed25519:acme:sig\n');
  });

  it('writes no signature file for an install made under --trust-unsigned', () => {
    const dir = join(scratch(), 'com.acme.a', '1.0.0');
    materializePlugin({ dir, files: [entry('a.js')], artifact: bytes('x'), signature: null });
    expect(readdirSync(dir).sort()).toEqual(['a.js', INSTALLED_ARTIFACT_FILE].sort());
  });

  it('replaces an earlier install of the same version whole, and leaves no staging directory', () => {
    const parent = scratch();
    const dir = join(parent, '1.0.0');
    materializePlugin({ dir, files: [entry('old.js'), entry('shared.js', 'old')], artifact: bytes('v1'), signature: 'ed25519:acme:one' });
    const result = materializePlugin({ dir, files: [entry('shared.js', 'new')], artifact: bytes('v2'), signature: null });
    expect(result).toEqual({ replaced: true });
    expect(existsSync(join(dir, 'old.js'))).toBe(false);
    expect(existsSync(join(dir, INSTALLED_SIGNATURE_FILE))).toBe(false);
    expect(readFileSync(join(dir, 'shared.js'), 'utf8')).toBe('new');
    expect(readdirSync(parent)).toEqual(['1.0.0']);
  });

  describe('a swap that fails', () => {
    afterEach(() => { renames.fail = null; });

    function installed(): { parent: string; dir: string } {
      const parent = scratch();
      const dir = join(parent, '1.0.0');
      materializePlugin({ dir, files: [entry('old.js', 'old')], artifact: bytes('v1'), signature: 'ed25519:acme:one' });
      return { parent, dir };
    }

    function expectFirstInstall(parent: string, dir: string): void {
      expect(readFileSync(join(dir, 'old.js'), 'utf8')).toBe('old');
      expect(readFileSync(join(dir, INSTALLED_ARTIFACT_FILE), 'utf8')).toBe('v1');
      expect(readFileSync(join(dir, INSTALLED_SIGNATURE_FILE), 'utf8')).toBe('ed25519:acme:one\n');
      expect(readdirSync(parent)).toEqual(['1.0.0']);
    }

    it('when the new tree cannot be moved in, puts the earlier install back and removes the new tree', () => {
      const { parent, dir } = installed();
      renames.fail = (from, to) => from.includes('.installing-') && to === dir;
      expect(() => materializePlugin({ dir, files: [entry('new.js')], artifact: bytes('v2'), signature: null })).toThrow(/rename refused/);
      expectFirstInstall(parent, dir);
    });

    it('when the earlier install cannot be moved aside, leaves it in place and removes the new tree', () => {
      const { parent, dir } = installed();
      renames.fail = (from) => from === dir;
      expect(() => materializePlugin({ dir, files: [entry('new.js')], artifact: bytes('v2'), signature: null })).toThrow(/rename refused/);
      expectFirstInstall(parent, dir);
    });

    it('control: a leftover from an earlier failed swap does not block the next one', () => {
      const { parent, dir } = installed();
      const leftover = `${dir}.replaced-${process.pid}`;
      mkdirSync(leftover);
      writeFileSync(join(leftover, 'stale.js'), 'stale');
      materializePlugin({ dir, files: [entry('new.js', 'new')], artifact: bytes('v2'), signature: null });
      expect(readFileSync(join(dir, 'new.js'), 'utf8')).toBe('new');
      expect(readdirSync(parent)).toEqual(['1.0.0']);
    });
  });
});

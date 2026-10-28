// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The file-system half of `os plugin install` (ADR-0025 §3.5 M1): which
 * archive entries may be written, and how a verified artifact lands in its
 * install directory.
 *
 * Pinned: every entry that could land outside the install directory, collide
 * with another, or take one of the two reserved names is named (one line per
 * entry); a materialized install holds the unpacked files beside the ORIGINAL
 * artifact bytes and signature; a second install of one version replaces the
 * first whole, leaving no file of the first and no staging directory behind.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  INSTALLED_ARTIFACT_FILE,
  INSTALLED_SIGNATURE_FILE,
  archiveEntryProblems,
  materializePlugin,
} from './plugin-install.js';

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
});

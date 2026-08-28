// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8103 — the two command-level guards that decide whether a delete may run at
 * all, tested away from the boot they normally sit behind.
 *
 * Both exist to stop an ANSWER being invented:
 *
 *  - `readDeclaredDatasources` must never turn an unreadable file into `[]`.
 *    `[]` is the host stating it has no code-declared datasources; a missing or
 *    malformed file is nobody having answered, and the union turns that into a
 *    declared gap that refuses the delete. Collapsing the two would make the
 *    union look complete while being quieter than it is.
 *  - `asDeletingDriver` refuses a driver that cannot delete instead of casting
 *    the union's READ-ONLY driver port into a writing one. The cast compiles
 *    and then throws partway through the delete loop, after the export has been
 *    written and some rows are already gone.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asDeletingDriver, readDeclaredDatasources } from './orphans.js';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'os-8103-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readDeclaredDatasources — an unreadable answer is never an empty one', () => {
  it('reads a bare array', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, JSON.stringify([{ name: 'main', external: { credentialsRef: 'sys_secret:sec_1' } }]));
    expect(readDeclaredDatasources(file)).toEqual([
      { name: 'main', external: { credentialsRef: 'sys_secret:sec_1' } },
    ]);
  });

  it('reads the { datasources: [...] } wrapper', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, JSON.stringify({ datasources: [{ name: 'analytics' }] }));
    expect(readDeclaredDatasources(file)).toEqual([{ name: 'analytics' }]);
  });

  it('an EMPTY array is a real answer and stays one', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, '[]');
    // The control that makes this assertion mean something: the same function
    // over a NON-empty file returns a non-empty list, so `[]` here is the
    // file's content and not a swallowed failure.
    expect(readDeclaredDatasources(file)).toEqual([]);
    const other = join(dir, 'other.json');
    writeFileSync(other, JSON.stringify([{ name: 'x' }]));
    expect(readDeclaredDatasources(other)).toHaveLength(1);
  });

  it('throws — never returns [] — for a missing file', () => {
    expect(() => readDeclaredDatasources(join(tempDir(), 'absent.json'))).toThrow(/no such file/);
  });

  it('throws — never returns [] — for malformed JSON', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, '{ not json');
    expect(() => readDeclaredDatasources(file)).toThrow(/does not parse as JSON/);
  });

  it('throws — never returns [] — for JSON that is not a datasource list', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, JSON.stringify({ nope: true }));
    expect(() => readDeclaredDatasources(file)).toThrow(/must hold an array/);
  });
});

describe('asDeletingDriver — a missing delete() is a refusal, not a cast', () => {
  it('accepts a driver that declares delete()', () => {
    const driver = { async find() { return []; }, async delete() { return true; } };
    expect(asDeletingDriver(driver)).toBe(driver);
  });

  it('refuses the union READ-ONLY port shape, which declares only find()', () => {
    // Exactly the shape `SecretReferenceDriverLike` describes. Positive
    // control: the accepting case above proves the predicate can say yes.
    expect(asDeletingDriver({ async find() { return []; } })).toBeNull();
  });

  it('refuses undefined and a non-callable delete', () => {
    expect(asDeletingDriver(undefined)).toBeNull();
    expect(asDeletingDriver(null)).toBeNull();
    expect(asDeletingDriver({ delete: 'yes' })).toBeNull();
  });
});

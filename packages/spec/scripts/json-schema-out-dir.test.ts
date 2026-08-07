// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit pins for the `json-schema/` ownership rule (#5371): `gen:schema` clears
// its own outputs, and leaves the artifacts a sibling generator declares alone.
//
// These run against a scratch directory in milliseconds. The END-TO-END half —
// that `build-schemas.ts` actually routes its clean through this function, in
// both write and `--check` mode — is pinned in build-schemas-check-mode.test.ts,
// because a unit test over an extracted helper stays green forever if the caller
// goes back to `fs.rmSync(OUT_DIR, { recursive: true })`. Neither half is
// sufficient on its own.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  FOREIGN_JSON_SCHEMA_ARTIFACTS,
  OPENAPI_ARTIFACT_NAME,
  clearOwnedOutputs,
} from './lib/json-schema-out-dir';

let dir: string;

/** The bytes a real `gen:openapi` leaves behind, in miniature. */
const OPENAPI_BYTES = JSON.stringify({ openapi: '3.1.0', 'x-fixture': 'written by gen:openapi' }, null, 2);

/** Seed a directory shaped like a populated `json-schema/` tree. */
function seedOutDir(): void {
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'Object.json'), '{"title":"Object"}');
  fs.mkdirSync(path.join(dir, 'zzretiredcategory', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'zzretiredcategory', 'nested', 'Gone.json'), '{}');
  fs.writeFileSync(path.join(dir, 'objectstack.json'), '{"$defs":{}}');
  fs.writeFileSync(path.join(dir, OPENAPI_ARTIFACT_NAME), OPENAPI_BYTES);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-schema-out-dir-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('FOREIGN_JSON_SCHEMA_ARTIFACTS — the declared registry', () => {
  it('declares openapi.json, and names the command that writes it back', () => {
    // The entry is an EXEMPTION from a clean, so a reader who finds the file
    // missing has to be able to learn the remedy from this line alone.
    expect(FOREIGN_JSON_SCHEMA_ARTIFACTS.has(OPENAPI_ARTIFACT_NAME)).toBe(true);
    for (const [entry, owner] of FOREIGN_JSON_SCHEMA_ARTIFACTS) {
      expect(entry, 'entries are matched as top-level names, never as paths').not.toContain('/');
      expect(owner, `${entry} must name the generator command that owns it`).toMatch(/^gen:/);
      expect(owner).toMatch(/packages\/spec\/scripts\/.+\.ts/);
    }
  });
});

describe('clearOwnedOutputs — this generator clears its own outputs only (#5371)', () => {
  it("removes every entry it owns, including nested category trees, and keeps the directory", () => {
    seedOutDir();

    const result = clearOwnedOutputs(dir);

    // "No stale files remain" is the whole point of the clean and is unchanged:
    // a category folder no build emits any more still goes, subtree and all.
    expect(fs.existsSync(path.join(dir, 'zzretiredcategory'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'data'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'objectstack.json'))).toBe(false);
    expect(result.removed.sort()).toEqual(['data', 'objectstack.json', 'zzretiredcategory']);
    expect(result.failed).toEqual([]);
    // The directory itself survives — the old code deleted it and rebuilt it,
    // which is exactly how a sibling's file went down with it.
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("leaves gen:openapi's openapi.json byte-identical", () => {
    seedOutDir();

    const result = clearOwnedOutputs(dir);

    expect(fs.readFileSync(path.join(dir, OPENAPI_ARTIFACT_NAME), 'utf8')).toBe(OPENAPI_BYTES);
    expect(result.preserved).toEqual([OPENAPI_ARTIFACT_NAME]);
    expect(result.removed).not.toContain(OPENAPI_ARTIFACT_NAME);
  });

  it('is the behaviour the old whole-directory rm did NOT have — the same fixture, the other way', () => {
    // Reverse verification, written as a contrast rather than left implicit:
    // the deleted limb is `fs.rmSync(OUT_DIR, { recursive: true })`, and this
    // records what it does to the same seeded tree. Predicted direction: the
    // sibling's artifact disappears. If this case ever fails, `rmSync` stopped
    // being recursive-by-directory and the whole premise of #5371 has moved.
    seedOutDir();

    fs.rmSync(dir, { recursive: true, force: true });

    expect(fs.existsSync(path.join(dir, OPENAPI_ARTIFACT_NAME))).toBe(false);
    fs.mkdirSync(dir, { recursive: true });
  });

  it('no-ops on a directory that does not exist yet — the first build in a fresh worktree', () => {
    const missing = path.join(dir, 'not-generated-yet');

    const result = clearOwnedOutputs(missing);

    expect(result).toEqual({ removed: [], preserved: [], failed: [] });
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('reports an entry it could not remove instead of swallowing it', () => {
    // A build that cannot delete one stale file must regenerate over it rather
    // than refuse to run (the pre-#5371 behaviour), but it may not pretend the
    // file was cleaned: `failed` and `onUnremovable` are how the caller can tell
    // an exemption from a miss.
    seedOutDir();
    const stuck = path.join(dir, 'data');
    const reported: string[] = [];
    const rmSync = fs.rmSync;
    const spy = ((target: fs.PathLike, opts?: fs.RmOptions) => {
      if (String(target) === stuck) throw new Error('EBUSY: resource busy or locked');
      return rmSync(target, opts);
    }) as typeof fs.rmSync;
    fs.rmSync = spy;
    try {
      const result = clearOwnedOutputs(dir, {
        maxAttempts: 3,
        onUnremovable: (entry) => reported.push(entry),
      });

      expect(result.failed).toEqual(['data']);
      expect(reported).toEqual(['data']);
      // Everything else still went, and the sibling artifact is still spared.
      expect(result.removed.sort()).toEqual(['objectstack.json', 'zzretiredcategory']);
      expect(result.preserved).toEqual([OPENAPI_ARTIFACT_NAME]);
    } finally {
      fs.rmSync = rmSync;
    }
  });

  it('backs off between attempts only, never after the last one', () => {
    seedOutDir();
    const stuck = path.join(dir, 'data');
    const delays: number[] = [];
    const rmSync = fs.rmSync;
    const spy = ((target: fs.PathLike, opts?: fs.RmOptions) => {
      if (String(target) === stuck) throw new Error('EBUSY');
      return rmSync(target, opts);
    }) as typeof fs.rmSync;
    fs.rmSync = spy;
    try {
      clearOwnedOutputs(dir, {
        maxAttempts: 3,
        retryDelayBaseMs: 10,
        sleep: (ms) => delays.push(ms),
      });
      // Linear back-off, one sleep fewer than attempts — a build script that
      // sleeps after giving up is pure wall-clock nobody gets back.
      expect(delays).toEqual([10, 20]);
    } finally {
      fs.rmSync = rmSync;
    }
  });
});

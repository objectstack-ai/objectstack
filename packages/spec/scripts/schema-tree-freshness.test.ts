// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the freshness rule that `check:docs` now leans on (#4723).
//
// ## Why this rule had to exist before the composition could change
//
// `check:docs` used to be `pnpm gen:schema && tsx scripts/build-docs.ts --check`.
// That first step is a GENERATOR, and on a stale tree it rewrites two TRACKED
// files (`json-schema.manifest/`, `authorable-surface/`), so a script
// called `check:` edited the working tree of whoever ran it and left the
// staleness unreported — #4711's defect at a different entry point.
//
// Deleting the step fixes that. What the step ALSO did, silently, was guarantee
// that `packages/spec/json-schema/` — the gitignored tree the reference docs are
// rendered from — described the sources under test. Drop it without replacing
// that guarantee and the trade is bad: instead of a gate that repairs a tracked
// file, you get a gate that reports the docs "in sync" against a tree generated
// before the edit. A false GREEN on exactly the change (`.describe()` added, a
// key renamed) the gate exists to catch, with nothing to notice.
//
// So the guarantee became an assertion, and this is that assertion's test. The
// dangerous direction is the only one worth arguing about: **saying fresh when
// stale**. Every case below is written so that a rule which answered `false`
// unconditionally would fail it.
//
// The rule lives in `scripts/check-regen-pending.mjs` beside `distIsStale`,
// deliberately: it is the same question about a different artifact, three
// consumers read it (`build-docs.ts`, the pre-commit hook, the merge driver's
// prescription), and two copies of "is this older than src" drift in the
// direction that renders a confident page from a tree nobody rebuilt (#4675).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { schemaTreeIsStale } from '../../../scripts/check-regen-pending.mjs';

/** A throwaway `packages/spec`-shaped directory: `src/` plus `json-schema/`. */
let sandbox: string;

/** Write `rel` with `content`, creating parents, and stamp its mtime. */
function write(rel: string, content: string, mtimeEpochSeconds?: number): string {
  const p = path.join(sandbox, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (mtimeEpochSeconds !== undefined) fs.utimesSync(p, mtimeEpochSeconds, mtimeEpochSeconds);
  return p;
}

// Explicit stamps rather than sleeps: mtime resolution and scheduling are not
// what this rule is about, and a test that races them is a test that gets
// `.skip`ped later. OLD/NEW are far enough apart that no filesystem's timestamp
// granularity can collapse them.
const OLD = Math.floor(Date.now() / 1000) - 3600;
const NEW = Math.floor(Date.now() / 1000) - 60;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'os-schema-tree-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('schemaTreeIsStale — the json-schema/ freshness rule (#4723)', () => {
  it('reads a MISSING tree as stale', () => {
    // The state every fresh checkout and every worktree is in: json-schema/ is
    // gitignored, so nothing delivers it. Conservative by construction — this is
    // also the shape `--self-test` asserts at the root, on a directory that has
    // neither half.
    write('src/data/object.zod.ts', 'export const x = 1;', OLD);
    expect(schemaTreeIsStale(sandbox)).toBe(true);
  });

  it('reads an EMPTY tree as stale', () => {
    // A directory that exists but holds no `.json` is not a generation, it is a
    // leftover. `newestMtime` returns 0 for it, which must not read as "old but
    // present" — that is the silent-green shape build-docs.ts's second guard
    // exists to catch downstream.
    write('src/data/object.zod.ts', 'export const x = 1;', OLD);
    fs.mkdirSync(path.join(sandbox, 'json-schema', 'data'), { recursive: true });
    expect(schemaTreeIsStale(sandbox)).toBe(true);
  });

  it('reads a tree OLDER than src as stale — the false-green case', () => {
    // THE case. Before #4723 it could not arise, because `check:docs` regenerated
    // on every run; after it, this is what an unrebuilt tree looks like, and
    // answering `false` here is what would let `check:docs` report the docs in
    // sync with a `.describe()` it never read.
    write('json-schema/data/Object.json', '{}', OLD);
    write('src/data/object.zod.ts', 'export const x = 1;', NEW);
    expect(schemaTreeIsStale(sandbox)).toBe(true);
  });

  it('reads a tree NEWER than src as fresh', () => {
    // The state right after `gen:schema`, `pnpm build`, or the
    // `check:authorable-surface` gate that precedes `check:docs` in CI and in
    // `check:generated`. If this direction were wrong the guard would be a
    // permanent red and would get deleted rather than obeyed.
    write('src/data/object.zod.ts', 'export const x = 1;', OLD);
    write('json-schema/data/Object.json', '{}', NEW);
    expect(schemaTreeIsStale(sandbox)).toBe(false);
  });

  it('finds the newest source at ANY depth, not just the top level', () => {
    // `src/data/driver/postgres.zod.ts` is real (#4410 is the story of a walk
    // that stopped one level down and produced confident output about surface it
    // never saw). A rule that only looked at `src/*` would call this fresh.
    write('src/data/object.zod.ts', 'export const x = 1;', OLD);
    write('json-schema/data/Object.json', '{}', OLD + 60);
    write('src/data/driver/postgres.zod.ts', 'export const y = 2;', NEW);
    expect(schemaTreeIsStale(sandbox)).toBe(true);
  });

  it('ignores a newer .test.ts — the one deliberate difference from distIsStale', () => {
    // Test files are not inputs to `build-schemas.ts`: it imports the namespace
    // barrels, and no `.test.ts` is re-exported from one. Counting them would send
    // every test-only spec PR to a `gen:schema` that changes nothing, and a guard
    // that cries wolf is a guard the next person deletes. Documented in the rule,
    // asserted here so the exclusion cannot be "tidied away" as an oversight.
    write('json-schema/data/Object.json', '{}', OLD + 60);
    write('src/data/object.zod.ts', 'export const x = 1;', OLD);
    write('src/data/object.test.ts', 'it("x", () => {});', NEW);
    expect(schemaTreeIsStale(sandbox)).toBe(false);

    // …and the exclusion is by SUFFIX, not by "contains test": a source file
    // whose name merely starts with the word is still a source file.
    write('src/data/test-helpers.zod.ts', 'export const z = 3;', NEW);
    expect(schemaTreeIsStale(sandbox)).toBe(true);
  });
});

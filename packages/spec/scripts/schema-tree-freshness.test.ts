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
//
// ── Re-judged at #16175, not rewritten ──────────────────────────────────────
//
// The rule gained a second half: an mtime accusation can now be ANSWERED by
// `json-schema/.build-input-hash-schema`, the digest `build-schemas.ts` writes
// at the end of a generation. That was needed because the mtime half alone
// refuses a tree whose bytes never moved — `git merge`, `git checkout` and
// `git worktree add` re-check-out unchanged sources and bump their mtimes, the
// build correctly does not run, and `check:docs` then costs a full regeneration
// for a tree that is exactly current (measured: exit 1 on a checkout whose
// `git status` was empty).
//
// ⛔ Every case below was re-judged against that change rather than deleted, and
// every one of them still asserts what it was written to assert — because NONE
// of these sandboxes carries a stamp. That is not an accident of the fixtures,
// it is the property being pinned: no stamp is `unstamped`, `unstamped` is NO
// EVIDENCE, and no evidence leaves the mtime verdict exactly where it stood
// (#4690). So the original six cases now pin one MORE thing than they were
// written for — that the acquittal channel cannot be reached without evidence —
// and the block added after them supplies the evidence and pins what it may and
// may not do with it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { schemaStamp, schemaTreeIsStale } from '../../../scripts/check-regen-pending.mjs';

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
    //
    // Re-judged at #16175 and kept verbatim: this sandbox has no stamp, so the
    // accusation has nothing to answer it and stands. It is now BOTH the
    // false-green pin it always was and the pin for "absence of evidence is not
    // licence to acquit" — which is exactly the shape the #16175 acquittal must
    // not be able to reach on its own.
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

// ─────────────────────────────────────────────────────────────────────────────
// #16175 — the accusation can now be ANSWERED, and only in one direction.
//
// `distIsStale` (#14985/#16176) and `bundlesAreStale` (#16240) each gained a
// digest that may acquit a tree whose bytes never moved. This rule had nothing
// to read: the two `dist/` stamps are written at the END of the build, while
// `gen:schema` is its FIRST step and is also run standalone and by
// `check:authorable-surface` — so a `dist/` stamp is evidence about `dist/` and
// would have been silent in the common case. The evidence here is therefore new:
// `build-schemas.ts` writes `json-schema/.build-input-hash-schema` as the last
// thing it does, over the digest of the inputs that generation consumed.
//
// The direction is the whole ruling, in triage's words: 摘要只能赦免、不能指控
// — the digest may only ever ACQUIT a tree the mtime rule has already accused.
// So the cases below come in pairs: one that must go green with evidence, and
// one that must STAY red without it, or with evidence that does not fit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The digest a generation of `sandbox` would record, right now.
 *
 * Asked of the rule's own reader rather than hardcoded, for the reason
 * `dist-freshness.test.ts` gives: the input set includes turbo.json's
 * `globalDependencies` and the repo-relative path of every file, so a literal
 * would rot on the next unrelated edit — and a rotted literal fails as
 * `mismatch`, which reads exactly like the refusal these cases distinguish from.
 *
 * Two steps, because the reader computes `actual` only when a valid digest is
 * recorded: seed a syntactically valid placeholder, read what the inputs really
 * hash to, then let the caller write that.
 */
function currentDigest(): string {
  write('json-schema/.build-input-hash-schema', `${'0'.repeat(64)}\n`, OLD);
  const { actual } = schemaStamp(sandbox);
  if (!actual) throw new Error('the sandbox digest could not be computed — the fixture is wrong');
  return actual;
}

describe('schemaTreeIsStale — the generation stamp may acquit, never accuse (#16175)', () => {
  it('clears a tree older than src when the stamp MATCHES — THE case', () => {
    // The measured defect: `git merge` / `git checkout` / `git worktree add`
    // re-checks-out a source file with identical bytes and bumps its mtime; the
    // build correctly does not run (turbo hashes content); the tree is exactly
    // current and the rule refused it, costing a full `gen:schema`.
    write('json-schema/data/Object.json', '{}', OLD);
    write('src/data/object.zod.ts', 'export const x = 1;', NEW);
    // Without evidence this is the false-green case above, and stays refused.
    expect(schemaTreeIsStale(sandbox)).toBe(true);

    write('json-schema/.build-input-hash-schema', `${currentDigest()}\n`, OLD);
    expect(schemaStamp(sandbox).state).toBe('match');
    expect(schemaTreeIsStale(sandbox)).toBe(false);
  });

  it('keeps refusing when the stamp MISMATCHES — a real content change', () => {
    // The half that makes the case above non-vacuous. If the acquittal were
    // unconditional, this would pass too — and the rule would have gone blind
    // rather than got smarter, which is indistinguishable from fixed by any
    // assertion that only ever watches it stop refusing.
    write('json-schema/data/Object.json', '{}', OLD);
    write('src/data/object.zod.ts', 'export const x = 1;', NEW);
    write('json-schema/.build-input-hash-schema', `${'a'.repeat(64)}\n`, OLD);

    expect(schemaStamp(sandbox).state).toBe('mismatch');
    expect(schemaTreeIsStale(sandbox)).toBe(true);
  });

  it('keeps refusing on a stamp that is not a digest — absence of evidence is not licence (#4690)', () => {
    // Every way of not knowing collapses to `unstamped`: a truncated write, a
    // merge marker, a half-flushed file. None of them may read as vouched for.
    write('json-schema/data/Object.json', '{}', OLD);
    write('src/data/object.zod.ts', 'export const x = 1;', NEW);
    write('json-schema/.build-input-hash-schema', 'not-a-digest\n', OLD);

    expect(schemaStamp(sandbox).state).toBe('unstamped');
    expect(schemaTreeIsStale(sandbox)).toBe(true);
  });

  it('cannot conjure a tree: a MISSING tree stays stale however good the stamp', () => {
    // The stamp speaks for a tree; it is not a substitute for one. A leftover
    // stamp beside an emptied `json-schema/` — a failed clean, a partial cache
    // restore — must not turn "nothing to render from" into "current".
    write('src/data/object.zod.ts', 'export const x = 1;', OLD);
    write('json-schema/.build-input-hash-schema', `${currentDigest()}\n`, NEW);

    expect(schemaStamp(sandbox).state).toBe('match');
    expect(schemaTreeIsStale(sandbox)).toBe(true);
  });

  it('never accuses: a MISMATCHED stamp cannot overturn an mtime verdict of fresh', () => {
    // The one-way property stated as an assertion rather than as prose. The
    // mtime rule is the only thing that convicts — the digest cannot see a
    // hand-edited tree, a toolchain change or dependency drift, so letting it
    // convict would make a rule that passes today start failing for reasons
    // nobody measured.
    write('src/data/object.zod.ts', 'export const x = 1;', OLD);
    write('json-schema/data/Object.json', '{}', NEW);
    write('json-schema/.build-input-hash-schema', `${'b'.repeat(64)}\n`, NEW);

    expect(schemaStamp(sandbox).state).toBe('mismatch');
    expect(schemaTreeIsStale(sandbox)).toBe(false);
  });

  it('cannot vouch for itself — the stamp is invisible to both sides of the mtime rule', () => {
    // `newestMtime` skips dotted entries and the artifact side matches `.json`,
    // so the stamp counts as neither artifact nor source. Were it counted on the
    // artifact side, writing it would make every tree look newer than src and
    // the rule would clear itself unconditionally.
    write('src/data/object.zod.ts', 'export const x = 1;', NEW);
    // A stamp NEWER than the sources, and nothing else in the tree.
    write('json-schema/.build-input-hash-schema', `${currentDigest()}\n`, NEW + 60);
    expect(schemaTreeIsStale(sandbox)).toBe(true);

    // With one real artifact present but OLDER, the accusation still stands on
    // its own terms and is answered only by the digest, never by the file's date.
    write('json-schema/data/Object.json', '{}', OLD);
    expect(schemaTreeIsStale(sandbox)).toBe(false);
  });
});

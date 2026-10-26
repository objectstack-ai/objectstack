/**
 * objectui#8326 — the lockfile-integrity gate, pinned against the two causes it
 * was built for and against the three ways it could be worthless.
 *
 * The gate's own logic is exercised by `--self-test` inside the script
 * (synthetic lockfiles, no git; it prints its own case count). This file adds the
 * three things a synthetic corpus cannot say:
 *
 *   1. it is GREEN on this repository's real `pnpm-lock.yaml`;
 *   2. it is RED on the two real incident samples, built from that same real
 *      lockfile by a transformation this file asserts actually landed (the
 *      first, since objectui#12957 retired the version rule, in its
 *      merged-workspace form, objectstack#25803);
 *   3. it is wired — the workflow runs it, and the Dependabot merge gate
 *      classifies the check it produces.
 *
 * ⚠️ (2) matters more than it looks. A gate that is red on everything passes
 * both samples and is worthless, so every red assertion here is paired with a
 * green one over the same corpus.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lockfilePath } from '../workspace-root.mjs';

import { repoRoot } from './workflow-checks';
import { NOT_A_GATE, OPTIONAL_CONTEXTS, REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';
import {
  compareLockfiles,
  indexLockfile,
  readDeclaredNames,
  readSnapshotKeys,
} from '../check-lockfile-integrity.mjs';

const GATE = path.join(repoRoot, 'scripts/check-lockfile-integrity.mjs');
const LOCKFILE = lockfilePath();
const realLock = fs.readFileSync(LOCKFILE, 'utf8');

/** The check-run name the workflow's job produces. */
const CHECK_NAME = 'Lockfile Integrity Check';

describe('the gate runs its own self-test', () => {
  it('exits 0 with every case passing', () => {
    const out = execFileSync('node', [GATE, '--self-test'], { encoding: 'utf8' });
    expect(out).toMatch(/^✓ check-lockfile-integrity self-test: \d+ cases pass/m);
  });
});

describe('the real lockfile parses, and parses to something', () => {
  // Anti-vacuity, the failure mode this repository keeps re-teaching: every
  // assertion below is a comparison over these sets, and an empty set compares
  // clean no matter what the change did.
  const keys = readSnapshotKeys(realLock);
  const declared = readDeclaredNames(realLock);

  it('reads a four-figure resolution set out of pnpm-lock.yaml', () => {
    expect(keys.length).toBeGreaterThan(1000);
  });

  it('reads the workspace-declared runtime names out of the importers section', () => {
    expect(declared.size).toBeGreaterThan(50);
    // The two packages the incident is about, both declared by real packages:
    // `zod` by packages/types, app-shell and plugin-timeline; the spec by most
    // of the workspace.
    expect(declared).toContain('zod');
    expect(declared).toContain('@objectstack/spec');
    // ⛔ And a devDependency-only name is NOT in scope — the exclusion that
    // keeps the gate off ordinary build-tooling churn (`90bc5d16a`).
    expect(declared).not.toContain('vitest');
  });
});

describe('green on main — the negative control', () => {
  it('is clean against itself', () => {
    const idx = indexLockfile(realLock, 'main');
    expect(compareLockfiles(idx, idx).findings).toEqual([]);
  });

  it('is clean against its own commit in a real run', () => {
    // Exercises the git path (`--base-ref` -> `git merge-base`, then `git show
    // <rev>:<path>` from the workspace root), not just the pure functions. The
    // base is HEAD, not origin/main, since the move into objectstack's tree
    // (objectstack#25803): its Test UI job checks out at depth 1, where no
    // origin/main exists to take a merge base with, and whether THIS change's
    // lock is clean against main is the lockfile-integrity workflow's question,
    // a non-blocking one (below), not a unit test's.
    const out = execFileSync('node', [GATE, '--base-ref', 'HEAD'], {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    expect(out).toContain('VERDICT clean');
  });
});

/**
 * Sample (a) — what is left of objectui#8326 in the merged workspace
 * (objectstack#25803). The downgrade on #7058 split the workspace across two
 * physical spec copies; the version half of that card (rule 1) is retired, and
 * since the move into objectstack's tree every `@objectstack/*` package is a
 * workspace link with no snapshot key at all, so the spec can no longer stand
 * in for it (a registry copy beside a link is 0 -> 1, the newly-declared case
 * rule 2 leaves alone; objectstack-pin.test.ts asserts no such key exists). The
 * duplication half is what a partial downgrade of any declared runtime package
 * looks like: `ai`, single-copy in the merged lock and the peer every spec
 * consumer resolves through, gaining an older copy beside the current one is
 * two snapshot keys under one name. Built from the real lockfile by a
 * transformation this file asserts landed.
 */
const AI_KEY = '  ai@7.0.118(zod@4.6.7):';
function sampleA(): string {
  expect(realLock, 'the ai snapshot key moved — rebuild this sample before trusting it').toContain(AI_KEY);
  return realLock.replace(AI_KEY, '  ai@7.0.65(zod@4.6.7):\n    dependencies:\n      zod: 4.6.7\n' + AI_KEY);
}

/**
 * Sample (b) — objectui#8333, re-measured on `da5e4f69e` on 2026-09-08 by
 * `pnpm update better-auth --lockfile-only --recursive`, which resolved 1.7.3
 * and produced exactly this: the better-auth family forward, `zod@4.5.4` added,
 * and every package that sits under `ai` gaining a SECOND peer context at the
 * SAME version. Re-based on the merged lock (objectstack#25803): the
 * `@objectstack/*` packages it forked then are workspace links now, so the forks
 * are the two snapshot keys under `ai` that carry the zod peer.
 *
 * ⭐ That last part is the discriminator. No version moves, so a gate that only
 * asks "did an identity move backward" is green here.
 */
function sampleB(): string {
  let out = realLock;
  const forked = [
    "  '@ai-sdk/react@4.0.121(react@19.3.0)(zod@4.6.7)':",
    AI_KEY,
  ];
  for (const key of forked) {
    expect(out, `snapshot key moved: ${key}`).toContain(key);
    out = out.replace(key, `${key.replace('zod@4.6.7', 'zod@4.5.4')}\n    dependencies: {}\n${key}`);
  }
  const zodKey = '  zod@4.6.7: {}';
  expect(out).toContain(zodKey);
  return out.replace(zodKey, `${zodKey}\n  zod@4.5.4: {}`);
}

describe('cause 1 — a second physical copy of a declared runtime package (objectui#8326, objectstack#25803)', () => {
  const reading = compareLockfiles(indexLockfile(realLock, 'base'), indexLockfile(sampleA(), 'a'));

  it('the sample really differs from the base (the mutation landed)', () => {
    expect(sampleA()).not.toEqual(realLock);
    expect(sampleA()).toContain('  ai@7.0.65(zod@4.6.7):');
  });

  it('goes red, naming the second physical ai', () => {
    const ai = reading.duplicated.find((f) => f.name === 'ai');
    expect(ai?.baseCount).toBe(1);
    expect(ai?.headCount).toBe(2);
    expect(ai?.added).toEqual(['ai@7.0.65(zod@4.6.7)']);
  });

  it('⛔ no longer orders versions: the retired rule 1 reports nothing of its own', () => {
    expect(Object.keys(reading)).toEqual(['findings', 'duplicated']);
  });
});

describe('cause 2 — a declared dependency forks with no version moving (objectui#8333)', () => {
  const reading = compareLockfiles(indexLockfile(realLock, 'base'), indexLockfile(sampleB(), 'b'));

  it('the sample really differs from the base (the mutation landed)', () => {
    expect(sampleB()).not.toEqual(realLock);
    expect(sampleB()).toContain('zod@4.5.4');
  });

  it('⭐ still goes red: zod gained a copy', () => {
    const zod = reading.duplicated.find((f) => f.name === 'zod');
    expect(zod, 'the gate must not be blind to objectui#8333').toBeTruthy();
    // 1 -> 2 on the merged lock. objectui's own lock carried two zod copies
    // (3.25.76 + 4.6.7, the 3 line through shadcn 4.18.0), and this assertion
    // was 2 -> 3 so that a rule keyed on "was one, is now two" would be green
    // here; shadcn ^4.22.1 (objectstack#25803) took zod 3 out, re-measured. The
    // 2 -> 3 case stays held on a synthetic lock by the gate's own --self-test.
    expect(zod?.baseCount).toBe(1);
    expect(zod?.headCount).toBe(2);
  });

  it('⭐ names the second physical ai, at one unchanged version', () => {
    const ai = reading.duplicated.find((f) => f.name === 'ai');
    expect(ai?.headCount).toBe(2);
    // This is #8326's exact bundling mechanism — two real paths, nothing
    // dedupes them — arriving with no version change anywhere: both are
    // ai@7.0.118, under two peer contexts.
    expect(ai?.head.every((k) => k.startsWith('ai@7.0.118('))).toBe(true);
  });
});

describe('the gate is classified the way the dispatch reserved', () => {
  // `exists and runs the gate` and `checks out deep enough to have a merge
  // base` retired with objectstack#25712. They read objectui's
  // `lockfile-integrity.yml`, which runs nowhere under the monorepo: GitHub
  // runs the root `.github/workflows/` alone. That workflow is row 19 of the
  // objectstack#25697 workflow roster, "kept, follow-up port", re-aimed at the
  // one root `pnpm-lock.yaml`; the port brings both pins back against the root
  // job that runs the gate.

  it('⛔ is classified as NOT a blocking context (the maintainer floor)', () => {
    expect(Object.keys(NOT_A_GATE)).toContain(CHECK_NAME);
    expect(REQUIRED_CONTEXTS).not.toContain(CHECK_NAME);
    expect(Object.keys(OPTIONAL_CONTEXTS)).not.toContain(CHECK_NAME);
  });

  it('states in its own classification why enrolling it is not this card', () => {
    expect(NOT_A_GATE[CHECK_NAME]).toMatch(/maintainer decision/);
  });
});

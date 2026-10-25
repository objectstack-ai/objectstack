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
 *      first, since objectui#12957 retired the version rule, in its pinned-build
 *      form);
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

import { readWorkflows, repoRoot } from './workflow-checks';
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

  it('is clean against its own merge base in a real run', () => {
    // Exercises the git path (`--base-ref`), not just the pure functions.
    const out = execFileSync('node', [GATE, '--base-ref', 'origin/main'], {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    expect(out).toContain('VERDICT clean');
  });
});

/**
 * Sample (a) — what is left of objectui#8326 once `@objectstack/*` resolves by
 * commit (objectui#12957). The downgrade on #7058 split the workspace across two
 * physical spec copies; the version half of that card (rule 1) is retired,
 * because the pinned build carries no version for anything to move backward.
 * The duplication half is what a partial fall-back off the pin looks like now: one
 * importer resolving the REGISTRY spec beside the pinned build is two snapshot
 * keys under one name. Built from the real lockfile by a transformation this file
 * asserts landed.
 */
const PINNED_SPEC = "  '@objectstack/spec@file:.objectstack-pin/spec(ai@7.0.65(zod@4.6.7))':";
function sampleA(): string {
  expect(realLock, 'the pinned spec snapshot key moved — rebuild this sample before trusting it').toContain(PINNED_SPEC);
  return realLock.replace(
    PINNED_SPEC,
    "  '@objectstack/spec@18.0.0-next.3(ai@7.0.65(zod@4.6.7))':\n    dependencies:\n      zod: 4.6.7\n" + PINNED_SPEC,
  );
}

/**
 * Sample (b) — objectui#8333, re-measured on `da5e4f69e` on 2026-09-08 by
 * `pnpm update better-auth --lockfile-only --recursive`, which resolved 1.7.3
 * and produced exactly this: the better-auth family forward, `zod@4.5.4` added,
 * and every `@objectstack/*` package that sits under `ai` gaining a SECOND peer
 * context at the SAME version.
 *
 * ⭐ That last part is the discriminator. No `@objectstack/*` version moves, so
 * a gate that only asks "did an identity move backward" is green here.
 */
function sampleB(): string {
  let out = realLock;
  const forked = [
    PINNED_SPEC,
    "  '@objectstack/formula@file:.objectstack-pin/formula(ai@7.0.65(zod@4.6.7))':",
    "  ai@7.0.65(zod@4.6.7):",
  ];
  for (const key of forked) {
    expect(out, `snapshot key moved: ${key}`).toContain(key);
    out = out.replace(key, `${key.replace('zod@4.6.7', 'zod@4.5.4')}\n    dependencies: {}\n${key}`);
  }
  const zodKey = '  zod@4.6.7: {}';
  expect(out).toContain(zodKey);
  return out.replace(zodKey, `${zodKey}\n  zod@4.5.4: {}`);
}

describe('cause 1 — a registry @objectstack/* copy beside the pinned build (objectui#8326, objectui#12957)', () => {
  const reading = compareLockfiles(indexLockfile(realLock, 'base'), indexLockfile(sampleA(), 'a'));

  it('the sample really differs from the base (the mutation landed)', () => {
    expect(sampleA()).not.toEqual(realLock);
    expect(sampleA()).toContain("'@objectstack/spec@18.0.0-next.3(ai@7.0.65(zod@4.6.7))':");
  });

  it('goes red, naming the second physical spec', () => {
    const spec = reading.duplicated.find((f) => f.name === '@objectstack/spec');
    expect(spec?.headCount).toBe(2);
    expect(spec?.added).toEqual(['@objectstack/spec@18.0.0-next.3(ai@7.0.65(zod@4.6.7))']);
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

  it('⭐ still goes red: zod gained a copy, though it was never single-copy', () => {
    const zod = reading.duplicated.find((f) => f.name === 'zod');
    expect(zod, 'the gate must not be blind to objectui#8333').toBeTruthy();
    // ⛔ 2 -> 3, not 1 -> 2. Both cards say "forks a single-copy dependency";
    // measured on `main`, zod is ALREADY two copies (3.25.76 + 4.4.3 then;
    // 3.25.76 + 4.6.5 since objectui#11073, 3.25.76 + 4.6.7 since objectui#12626, re-measured), so a
    // rule keyed on "was one, is now two" would be green here.
    expect(zod?.baseCount).toBe(2);
    expect(zod?.headCount).toBe(3);
  });

  it('⭐ names the second physical @objectstack/spec, at one unchanged version', () => {
    const spec = reading.duplicated.find((f) => f.name === '@objectstack/spec');
    expect(spec?.headCount).toBe(2);
    // This is #8326's exact bundling mechanism — two real paths, nothing
    // dedupes them — arriving with no version change anywhere: both are the
    // pinned build, under two peer contexts.
    expect(spec?.head.every((k) => k.startsWith('@objectstack/spec@file:.objectstack-pin/spec('))).toBe(true);
  });
});

describe('the gate is wired, and wired the way the dispatch reserved', () => {
  const workflow = readWorkflows().find((w) => w.file === 'lockfile-integrity.yml');

  it('exists and runs the gate', () => {
    expect(workflow, '.github/workflows/lockfile-integrity.yml is missing').toBeTruthy();
    expect(workflow?.text).toContain('node scripts/check-lockfile-integrity.mjs');
  });

  it('checks out deep enough to have a merge base', () => {
    // A shallow checkout has no merge base and the script exits 2 rather than
    // guessing — which would be a check that reports nothing and looks fine.
    expect(workflow?.text).toContain('fetch-depth: 0');
  });

  it('⛔ is classified as NOT a blocking context (the maintainer floor)', () => {
    expect(Object.keys(NOT_A_GATE)).toContain(CHECK_NAME);
    expect(REQUIRED_CONTEXTS).not.toContain(CHECK_NAME);
    expect(Object.keys(OPTIONAL_CONTEXTS)).not.toContain(CHECK_NAME);
  });

  it('states in its own classification why enrolling it is not this card', () => {
    expect(NOT_A_GATE[CHECK_NAME]).toMatch(/maintainer decision/);
  });
});

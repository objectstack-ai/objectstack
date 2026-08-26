// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor`'s posture advice names the multi-org runtime from ONE
 * declaration, and these pins read what it RENDERS (#12464).
 *
 * ── What this closes ─────────────────────────────────────────────────────
 *
 * PR #12463 (#12151) single-sourced every operator-facing occurrence in
 * `serve.ts` onto `Serve.ORGANIZATIONS_RUNTIME_PKG` and pinned what those
 * messages render. `doctor.ts` sat outside that card's file surface and kept
 * its own bare `@objectstack/organizations` literal inside
 * `TENANCY_POSTURE_FIX_HINTS`, under no check of any kind — so a roster-key
 * rename left `os doctor` printing a package name that boot no longer
 * resolves, with EVERY GATE GREEN: the roster pin only ever sees the
 * declaration, and nothing read this hint table's text.
 *
 * The defect being closed is that SILENT DRIFT, not the duplication as such.
 * The literal is still declared three times (the roster key, serve's static,
 * doctor's const) and this file does not change that — see the const's own
 * docblock for why the roster cannot supply the name, and for the deletion
 * condition that ends the duplication properly.
 *
 * ── Two legs, and the second is the point ────────────────────────────────
 *
 *   (i)  RENDERED — the `isolated` bullet is rendered through the real gate
 *        and compared, whitespace included, against text built from the
 *        declaration.
 *   (ii) ROSTER — that declaration IS a key of the spec-owned
 *        `PLATFORM_PLUGIN_WIRED_RUNTIMES`.
 *
 * ⭐ (ii) is the entire difference between a CHECKED duplicate and a third
 * SILENT copy. Leg (i) on its own pins doctor against itself: rename the
 * roster key and the hint and the expectation move together, so (i) stays
 * green forever while `os doctor` names a package that no longer exists.
 * (ii) is what makes that rename loud. Neither leg is optional.
 *
 * ── Why it reads the RENDERED text, not the source ───────────────────────
 *
 * "No bare literal outside the declaration" is the tempting stronger form and
 * is deliberately NOT built here, for the reason PR #12463 recorded: a source
 * scan has to exclude COMMENTS — the const's docblock names the package
 * repeatedly, and this file's own header does too — and that shape is easy to
 * get wrong. What reaches the operator is what matters, so the pin renders the
 * finding and compares the affected LINE with `toBe`, which is what turns
 * "eyeballed" into "checked".
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLATFORM_PLUGIN_WIRED_RUNTIMES } from '@objectstack/spec/kernel';

import {
  ORGANIZATIONS_RUNTIME_PKG,
  resolveTenancyPostureOrFinding,
  readDotenvFiles,
  type DotenvReading,
} from './doctor.js';

/** The one declaration. Every expectation below is built from THIS, never from a literal. */
const PKG = ORGANIZATIONS_RUNTIME_PKG;

/**
 * `chalk` may or may not emit SGR codes depending on TTY detection.
 *
 * The escape is written as `\x1b`, never as the byte itself: one raw control
 * character makes grep treat the whole file as binary, and a test file nobody's
 * `git grep` can find is a test file that stops being maintained (#4890/#5157).
 */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');
const lines = (s: string) => plain(s).split('\n');

const TOUCHED = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED'] as const;
let saved: Record<string, string | undefined> = {};

/**
 * A real reading of a real directory holding no `.env*` file.
 *
 * Built by the REAL `readDotenvFiles()` rather than hand-rolled, matching
 * `doctor-tenancy-posture-report.test.ts`: a fake reading here would let these
 * cases keep passing if the real one started reporting files that do not exist.
 */
let emptyDir: string;
let shellOnly: DotenvReading;

beforeAll(() => {
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-12464-noenv-'));
  shellOnly = readDotenvFiles(emptyDir, 'production');
  expect(shellOnly.files).toEqual([]);
});

afterAll(() => {
  fs.rmSync(emptyDir, { recursive: true, force: true });
});

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** The `isolated` fix-list bullet, rendered through the real gate. */
const renderIsolatedBullet = (): string => {
  process.env.OS_TENANCY_POSTURE = 'not-a-posture';
  const reading = resolveTenancyPostureOrFinding(shellOnly);
  expect(reading.ok, 'the gate accepted a value that is not a posture').toBe(false);
  if (reading.ok) throw new Error('unreachable — guarded above');
  const bullet = lines(reading.result.fix ?? '').find((l) => l.includes('OS_TENANCY_POSTURE=isolated'));
  expect(bullet, "the fix list no longer offers an `isolated` bullet at all").toBeDefined();
  return bullet as string;
};

describe('doctor — the posture description an operator reads names the declaration (#12464)', () => {
  // LEG (i). Rendered through `resolveTenancyPostureOrFinding` rather than by
  // reading the hint table: the bullet's assembly (indent, `• OS_TENANCY_POSTURE=`,
  // the ` — ` separator) is part of what the operator sees, so it is part of
  // what is pinned.
  it('leg (i) — the `isolated` fix-list bullet names it, with the spacing intact', () => {
    expect(renderIsolatedBullet()).toBe(
      `        • OS_TENANCY_POSTURE=isolated — organization wall + the enterprise ${PKG} runtime `
      + "(the legacy spelling 'multi' is accepted and normalizes to this)",
    );
  });

  // LEG (ii) — the half that makes leg (i) mean something. Without this, a
  // roster rename moves the hint and this file's expectation together and
  // nothing anywhere goes red.
  it('leg (ii) — the name doctor prints IS a key of the spec-owned roster, not a third unchecked copy', () => {
    expect(
      Object.keys(PLATFORM_PLUGIN_WIRED_RUNTIMES),
      `os doctor tells operators about '${PKG}', which PLATFORM_PLUGIN_WIRED_RUNTIMES does not declare. `
        + 'The roster is the single source for whether an out-of-repo @objectstack/* package is real and '
        + 'where it ships from (#10921); a command that prints a package name at operators must name a row in it.',
    ).toContain(PKG);

    // Provenance, read through doctor's own spelling rather than a literal: the
    // row this advice describes is the enterprise one.
    const row = PLATFORM_PLUGIN_WIRED_RUNTIMES[PKG];
    expect(row.edition, `edition drift for the runtime doctor names ('${PKG}')`).toBe('enterprise');
  });

  it('no posture bullet an operator reads names any OTHER scoped package', () => {
    // The sweep the excluded source-scan form was reaching for, done over the
    // rendering instead — where comments cannot reach and no exclusion list is
    // needed.
    process.env.OS_TENANCY_POSTURE = 'not-a-posture';
    const reading = resolveTenancyPostureOrFinding(shellOnly);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    const names = plain(reading.result.fix ?? '').match(/@[a-z0-9-]+\/[a-z0-9._-]+/g) ?? [];
    expect(names.length, 'the fix list names no package at all — it stopped telling operators which one')
      .toBeGreaterThan(0);
    for (const name of names) {
      expect(name, `the fix list names '${name}', which is not the runtime serve loads`).toBe(PKG);
    }
  });
});

describe('#12464 CONTROL — these pins can say no', () => {
  it('a lost space around the interpolation fails the rendered comparison', () => {
    // If this instrument could not tell the two apart, leg (i) would be
    // decorative. Anchored on the exact regression interpolation invites.
    const expected =
      `        • OS_TENANCY_POSTURE=isolated — organization wall + the enterprise ${PKG} runtime `
      + "(the legacy spelling 'multi' is accepted and normalizes to this)";
    expect(
      `        • OS_TENANCY_POSTURE=isolated — organization wall + the enterprise ${PKG} runtime`
      + "(the legacy spelling 'multi' is accepted and normalizes to this)",
    ).not.toBe(expected);
    expect(
      `      • OS_TENANCY_POSTURE=isolated — organization wall + the enterprise ${PKG} runtime `
      + "(the legacy spelling 'multi' is accepted and normalizes to this)",
    ).not.toBe(expected);
    // …and says yes to the real thing, so the two `not.toBe`s above are a
    // reading rather than a pair of vacuous truths.
    expect(renderIsolatedBullet()).toBe(expected);
  });

  it('the roster key check rejects a name the roster does not declare', () => {
    // Anchored on a term that is NOT a substring of the one under test: a
    // membership assertion is not a reading until the same instrument answers no.
    const keys = Object.keys(PLATFORM_PLUGIN_WIRED_RUNTIMES);
    expect(keys).not.toContain('@objectstack/legacy-orgs');
    expect(keys).not.toContain('@acme/thing');
    expect(keys).toContain(PKG);
  });
});

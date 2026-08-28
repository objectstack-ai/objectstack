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
 *
 * ── Retargeted by #12492, not rewritten ──────────────────────────────────
 *
 * That deletion condition has since been met. `doctor.ts` no longer declares
 * `ORGANIZATIONS_RUNTIME_PKG` or its own hint table: both moved to
 * `../utils/tenancy-posture-hints.ts`, which `os serve` reads too. These pins
 * moved with the declaration — ⛔ none of them was dropped, because what they
 * measure did not change: what `os doctor` RENDERS. Leg (ii) especially, which
 * is the load-bearing one (see below).
 *
 * ⚠️ The literal is declared twice now, not three times: the roster key, and
 * the shared module this file reads. `Serve.ORGANIZATIONS_RUNTIME_PKG` was the
 * third copy; since #12579 it is ASSIGNED FROM that shared module instead of
 * spelling the package again. ⛔ It had stopped being REQUIRED before that, and
 * this paragraph is the fourth place that said it was. It used to read: it must
 * stay a string LITERAL or the host-anchoring sweep in
 * `serve-cluster-host-resolution.test.ts` can no longer resolve which package
 * that command's `import()` names. ⭐ That died at `1ca763b60` (#12533), which
 * taught the sweep to follow an import alias into a sibling module; ending the
 * duplication was then ruled on by the maintainer (2026-08-27, #12579, Option
 * A). ⛔ None of it changes what THIS file measures. What holds throughout is
 * that no copy can drift in silence: the equality pin that held serve's literal
 * to this module's — site 8 of `serve-organizations-message-spelling.test.ts` —
 * retired with its subject, and each surviving declaration keeps the roster-key
 * leg that made the pair safe in the first place.
 *
 * ── Three legs, and the second is the point ──────────────────────────────
 *
 *   (i)   RENDERED — the `isolated` bullet is rendered through the real gate
 *         and compared, whitespace included, against text built from the
 *         declaration.
 *   (ii)  ROSTER — that declaration IS a key of the spec-owned
 *         `PLATFORM_PLUGIN_WIRED_RUNTIMES`.
 *   (iii) SHARED TABLE (#12492) — every posture bullet, `single` and `group`
 *         included, renders the shared table's entry verbatim.
 *
 * ⭐ (ii) is the entire difference between a CHECKED duplicate and a third
 * SILENT copy. Leg (i) on its own pins doctor against itself: rename the
 * roster key and the hint and the expectation move together, so (i) stays
 * green forever while `os doctor` names a package that no longer exists.
 * (ii) is what makes that rename loud. Neither leg is optional.
 *
 * (iii) covers the half neither of the other two can reach. `single` and
 * `group` carry no package literal, so no roster leg is possible for them and
 * nothing ever watched them — that is the defect #12492 filed. Leg (iii) does
 * not check the PROSE (a reword moves the shared table and this expectation
 * together, and leg (i)'s hard-coded text is what reddens then); it checks that
 * doctor renders THE SHARED TABLE. Re-grow a module-local copy in `doctor.ts` —
 * exactly the state this card found — and it goes red on every posture at once.
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
import { TENANCY_POSTURES } from '@objectstack/spec/security';

// The declaration and the table both live here since #12492 — `os serve` reads
// the same module, which is what makes leg (iii) below a reading of the SHARING
// rather than of one command talking to itself.
import {
  ORGANIZATIONS_RUNTIME_PKG,
  TENANCY_POSTURE_FIX_HINTS,
} from '../utils/tenancy-posture-hints.js';
import {
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

/** One posture's fix-list bullet, rendered through the real gate. */
const renderPostureBullet = (posture: string): string => {
  process.env.OS_TENANCY_POSTURE = 'not-a-posture';
  const reading = resolveTenancyPostureOrFinding(shellOnly);
  expect(reading.ok, 'the gate accepted a value that is not a posture').toBe(false);
  if (reading.ok) throw new Error('unreachable — guarded above');
  const bullet = lines(reading.result.fix ?? '').find((l) => l.includes(`OS_TENANCY_POSTURE=${posture}`));
  expect(bullet, `the fix list no longer offers a '${posture}' bullet at all`).toBeDefined();
  return bullet as string;
};

/** The `isolated` fix-list bullet, rendered through the real gate. */
const renderIsolatedBullet = (): string => renderPostureBullet('isolated');

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

  // LEG (iii) — the half legs (i) and (ii) cannot reach (#12492). `single` and
  // `group` carry no package literal, so no roster leg is possible for them;
  // before this card nothing anywhere read their text at either command, and a
  // reword of one command's copy drifted from the other in total silence. What
  // closes that is not a pin on the PROSE — it is this: the bullets an operator
  // reads here are assembled from the SHARED table, the same one `os serve`
  // renders. A module-local hint table re-grown in `doctor.ts` reddens this.
  it('leg (iii) — every posture bullet renders the SHARED hint table verbatim, `single` and `group` included', () => {
    for (const posture of TENANCY_POSTURES) {
      const hint = TENANCY_POSTURE_FIX_HINTS[posture];
      expect(renderPostureBullet(posture)).toBe(
        `        • OS_TENANCY_POSTURE=${posture}${hint ? ` — ${hint}` : ''}`,
      );
    }
    // …and the sweep above actually swept. A posture vocabulary that went empty
    // would satisfy every assertion inside the loop without reading anything —
    // the two entries this card is ABOUT are named explicitly for that reason.
    expect(TENANCY_POSTURES).toContain('single');
    expect(TENANCY_POSTURES).toContain('group');
    expect(TENANCY_POSTURES).toContain('isolated');
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

  it('the shared-table comparison rejects a bullet whose hint was reworded (#12492)', () => {
    // If leg (iii) could not tell a reworded hint from the shared one it would
    // be decorative. Anchored on `group` — one of the two entries that had
    // nothing watching them at all before this card, and deliberately NOT a
    // substring game: 'closed engine' is a different claim, not a truncation.
    const real = `        • OS_TENANCY_POSTURE=group — ${TENANCY_POSTURE_FIX_HINTS.group}`;
    expect(
      '        • OS_TENANCY_POSTURE=group — organization wall enforced by the closed engine, one shared database',
    ).not.toBe(real);
    expect('        • OS_TENANCY_POSTURE=group').not.toBe(real);
    // …and says yes to the real thing, so the two `not.toBe`s are a reading
    // rather than a pair of vacuous truths.
    expect(renderPostureBullet('group')).toBe(real);
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

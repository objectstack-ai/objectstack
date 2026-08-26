// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The operator-facing prose that names the multi-org runtime spells it from the
 * ONE declaration, and these pins read what it RENDERS (#12151).
 *
 * ── What this closes ─────────────────────────────────────────────────────
 *
 * #11614 moved the package name `serve` RESOLVES onto
 * `Serve.ORGANIZATIONS_RUNTIME_PKG` and pinned that declaration against the
 * spec-owned `PLATFORM_PLUGIN_WIRED_RUNTIMES` roster
 * (`serve-capability-vocabulary.test.ts`). It deliberately stopped there. The
 * sentences an operator actually reads still carried their own copies of the
 * literal, under no check at all — so a roster-key rename would leave the
 * install remedy, the ADR-0093 D5 fatal refusal, the degraded-boot warning, the
 * stage-2 mount refusal and the posture description naming a package that no
 * longer exists, while boot reached for the new one. Every gate stays green
 * through that: the roster pin only ever sees the declaration.
 *
 * ── Why it reads the RENDERED text, not the source ───────────────────────
 *
 * "No bare literal outside the declaration" is the tempting stronger form and
 * is deliberately NOT built here: a source scan has to exclude comments — three
 * comments in `serve.ts` legitimately name the package — and that shape is easy
 * to get wrong. What matters is what reaches the operator, so each pin renders
 * a message and compares the affected LINE, whitespace included, against text
 * built from the constant. That is also the half that makes the interpolation
 * safe: two of these five sit on a fatal path an operator reads at the worst
 * possible moment, where a stray space or a lost backtick is a real regression,
 * and a `toBe` on the rendered line is what turns "eyeballed" into "checked".
 *
 * The expectations are built from `Serve.ORGANIZATIONS_RUNTIME_PKG` rather than
 * from a literal on purpose. Rename the roster key and these keep passing —
 * the prose moved with it. Re-spell it inline in any of these messages and the
 * rendered line stops matching the declaration, which is the exact drift this
 * file exists to catch. (The roster leg that makes that safe is not here: it is
 * `test/serve-capability-vocabulary.test.ts`, which pins the same static as a
 * roster KEY. Both halves are required; they simply live in two files.)
 *
 * ── Widened by #12492, not rewritten ─────────────────────────────────────
 *
 * `serve.ts` and `doctor.ts` each carried a byte-identical `TENANCY_POSTURE_FIX_HINTS`
 * table. It now lives once, in `../utils/tenancy-posture-hints.ts`, which both
 * commands read. ⛔ Nothing here was dropped; two pins were added.
 *
 * **Site 7** is the reading that makes the sharing REAL rather than textual: the
 * bullets `serve` renders come from that shared table, `single` and `group`
 * included — the two entries that touch no roster and that, before #12492,
 * nothing at either command ever read.
 *
 * **Site 8** covers what the shared table could NOT absorb.
 * `Serve.ORGANIZATIONS_RUNTIME_PKG` deliberately stays a string LITERAL in
 * `serve.ts` (its docblock says why: `serve-cluster-host-resolution.test.ts`
 * resolves the organizations `import()` through that static and needs the
 * literal in that file, or the load drops out of the host-anchoring sweep
 * silently). So the spelling is declared twice inside `packages/cli`, and site 8
 * is what keeps that duplication CHECKED instead of silent — it asserts the two
 * declarations are equal. Each is separately pinned as a roster key, here via
 * `test/serve-capability-vocabulary.test.ts` and there via doctor's leg (ii).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { HostDeclaration } from '@objectstack/types/node';
import { TENANCY_POSTURES } from '@objectstack/spec/security';

// The table `doctor` renders too (#12492). Read here so site 7 measures the
// SHARING, not this command talking to itself.
import {
  ORGANIZATIONS_RUNTIME_PKG as SHARED_ORGANIZATIONS_RUNTIME_PKG,
  TENANCY_POSTURE_FIX_HINTS,
} from '../utils/tenancy-posture-hints.js';

import Serve, {
  formatDegradedTenancyWarning,
  formatOrganizationsAbsentFatal,
  formatOrganizationsInstallRemedy,
  formatOrganizationsMountFatal,
  resolveTenancyPostureOrRefusal,
} from './serve.js';

/**
 * The one declaration, read through the handle `serve` exposes.
 *
 * Reading it as `Serve.…` is deliberate: what these pins are about is what THIS
 * COMMAND puts in front of an operator, and the static is the seam the boot path
 * and the roster pin already address. It is a literal in `serve.ts`, not a
 * re-export of the shared hints module — site 8 below is what holds the two
 * equal.
 */
const PKG = Serve.ORGANIZATIONS_RUNTIME_PKG;

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

/**
 * Every `@scope/name` the RENDERED text puts in front of an operator.
 *
 * Reading the rendering, not the source, is the whole point — a comment naming
 * the package is invisible here, which is why this can be a total sweep instead
 * of a scan with exclusions to get wrong.
 */
const scopedNamesIn = (rendered: string): string[] =>
  plain(rendered).match(/@[a-z0-9-]+\/[a-z0-9._-]+/g) ?? [];

const DECLARED: HostDeclaration = {
  packageName: PKG,
  hostRoot: '/srv/app',
  declared: true,
  field: 'dependencies',
  specifier: '^1.2.3',
};
const UNDECLARED: HostDeclaration = { packageName: PKG, hostRoot: '/srv/app', declared: false };

const remedyDeclared = () => formatOrganizationsInstallRemedy('declared-unresolvable', DECLARED, '/srv/app');
const remedyUndeclared = () => formatOrganizationsInstallRemedy('undeclared', UNDECLARED, '/srv/app');

describe('serve — the multi-org runtime name an operator READS comes from the declaration (#12151)', () => {
  it('site 1 — the "install is broken" remedy names it, with the spacing intact', () => {
    // The `declared-unresolvable` branch: the app's package.json IS correct and
    // the install is what broke (#4719). One of the two an operator ACTS on.
    expect(lines(remedyDeclared())[0]).toBe(
      `      • this app DECLARES ${PKG} (dependencies: "^1.2.3") — the`,
    );
  });

  it('site 2 — the "add it to THIS APP" remedy names it, with the spacing intact', () => {
    // The other instruction an operator acts on: the app never declared it.
    expect(lines(remedyUndeclared())[0]).toBe(
      `      • add ${PKG} (the enterprise multi-org runtime) to THIS APP`,
    );
  });

  it('site 3 — the ADR-0093 D5 fatal refusal names it', () => {
    const fatal = formatOrganizationsAbsentFatal('isolated', remedyUndeclared(), 'Cannot find package');
    // A leading blank line separates the refusal from whatever boot last printed.
    expect(lines(fatal)[0]).toBe('');
    expect(lines(fatal)[1]).toBe(
      `  ✖ FATAL: tenancy posture 'isolated' was requested but ${PKG} could not be loaded,`,
    );
  });

  it('site 4 — the degraded-boot warning names it', () => {
    expect(plain(formatDegradedTenancyWarning('isolated'))).toBe(
      `  ⚠ DEGRADED TENANCY (OS_ALLOW_DEGRADED_TENANCY=1): posture 'isolated' requested but `
      + `${PKG} is unavailable — booting with the organization wall INACTIVE. `
      + 'Organization boundaries are NOT enforced. (ADR-0093 D5)',
    );
  });

  it('site 5 — the stage-2 mount refusal names it', () => {
    const fatal = formatOrganizationsMountFatal('isolated', 'seat count exceeded', 'ORG_SEATS');
    expect(lines(fatal)[1]).toBe(
      `  ✖ FATAL: tenancy posture 'isolated' was requested and ${PKG} WAS found and loaded,`,
    );
    // …and it stays the "present but declined" diagnosis, not an absence.
    expect(plain(fatal)).toContain('This is NOT a missing-package problem');
  });

  it('no message an operator reads names any OTHER scoped package', () => {
    // The sweep the excluded source-scan form was reaching for, done over the
    // rendering instead — where comments cannot reach and no exclusion list is
    // needed. `mountMessage` is the plugin's own words, so it is fed something
    // neutral here; the framework never interprets it.
    for (const [label, rendered] of [
      ['remedy (declared)', remedyDeclared()],
      ['remedy (undeclared)', remedyUndeclared()],
      ['stage-1 fatal', formatOrganizationsAbsentFatal('group', remedyUndeclared(), 'ERR_MODULE_NOT_FOUND')],
      ['degraded warning', formatDegradedTenancyWarning('group')],
      ['stage-2 fatal', formatOrganizationsMountFatal('group', 'refused', undefined)],
    ] as const) {
      const names = scopedNamesIn(rendered);
      expect(names.length, `${label} names no package at all — it stopped telling operators which one`)
        .toBeGreaterThan(0);
      for (const name of names) {
        expect(name, `${label} names '${name}', which is not the runtime serve resolves`).toBe(PKG);
      }
    }
  });
});

describe('serve — the posture description an operator reads names the declaration (#12151)', () => {
  const TOUCHED = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED'] as const;
  let saved: Record<string, string | undefined> = {};

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

  it('site 6 — the `isolated` fix-list bullet names it, through the real gate', () => {
    // Rendered through `resolveTenancyPostureOrRefusal` rather than by reading
    // the hint table: the bullet's assembly (`• set OS_TENANCY_POSTURE=<p> — `)
    // is part of what the operator sees, so it is part of what is pinned.
    process.env.OS_TENANCY_POSTURE = 'not-a-posture';
    const verdict = resolveTenancyPostureOrRefusal();
    expect(verdict.ok, 'the gate accepted a value that is not a posture').toBe(false);
    if (verdict.ok) return;
    expect(lines(verdict.fatal)).toContain(
      `      • set OS_TENANCY_POSTURE=isolated — organization wall + the enterprise ${PKG} runtime `
      + "(the legacy spelling 'multi' is accepted and normalizes to this)",
    );
  });

  // #12492. Site 6 pins the `isolated` PROSE, hard-coded, and that is what
  // reddens on a reword. This pins something site 6 cannot: that the bullets
  // come from the table `os doctor` renders too — `single` and `group`
  // included, the two entries no roster touches and nothing anywhere read
  // before this card. Re-grow a module-local table in `serve.ts` and this goes
  // red on every posture at once.
  it('site 7 — every posture bullet renders the SHARED hint table verbatim, `single` and `group` included', () => {
    process.env.OS_TENANCY_POSTURE = 'not-a-posture';
    const verdict = resolveTenancyPostureOrRefusal();
    expect(verdict.ok, 'the gate accepted a value that is not a posture').toBe(false);
    if (verdict.ok) return;
    const rendered = lines(verdict.fatal);
    for (const posture of TENANCY_POSTURES) {
      const hint = TENANCY_POSTURE_FIX_HINTS[posture];
      expect(rendered).toContain(
        `      • set OS_TENANCY_POSTURE=${posture}${hint ? ` — ${hint}` : ''}`,
      );
    }
    // …and the sweep above actually swept. An empty posture vocabulary would
    // satisfy every assertion inside the loop without reading a thing — the two
    // entries this card is ABOUT are named explicitly for that reason.
    expect(TENANCY_POSTURES).toContain('single');
    expect(TENANCY_POSTURES).toContain('group');
    expect(TENANCY_POSTURES).toContain('isolated');
  });

  // #12492. The one thing the shared table could not absorb: the package name is
  // declared twice inside `packages/cli` on purpose — see
  // `Serve.ORGANIZATIONS_RUNTIME_PKG`'s docblock, and the shared module's. This
  // is the assertion that makes that duplication a CHECKED one. Drift either
  // copy and `os serve` and `os doctor` start naming different packages at
  // operators; without this, nothing anywhere would say so.
  it('site 8 — serve\'s literal and the shared hints module declare the SAME package', () => {
    expect(
      PKG,
      'Serve.ORGANIZATIONS_RUNTIME_PKG and the shared tenancy-hints module disagree about the '
        + 'multi-org runtime, so `os serve` and `os doctor` now name different packages at operators',
    ).toBe(SHARED_ORGANIZATIONS_RUNTIME_PKG);

    // …and the isolated hint an operator reads is built from the shared copy, so
    // the equality above is load-bearing rather than a spare assertion.
    expect(TENANCY_POSTURE_FIX_HINTS.isolated).toContain(SHARED_ORGANIZATIONS_RUNTIME_PKG);
  });
});

describe('#12151 CONTROL — these pins can say no', () => {
  it('a lost space between the package name and what follows it fails the comparison', () => {
    // The exact regression the card names: interpolating into a template is
    // where a stray space or a lost backtick hides. If this instrument could
    // not tell the two apart, every assertion above would be decorative.
    const expected = `      • add ${PKG} (the enterprise multi-org runtime) to THIS APP`;
    expect(`      • add ${PKG}(the enterprise multi-org runtime) to THIS APP`).not.toBe(expected);
    expect(`      • add ${PKG}  (the enterprise multi-org runtime) to THIS APP`).not.toBe(expected);
    expect(lines(remedyUndeclared())[0]).toBe(expected);
  });

  it('the shared-table comparison rejects a bullet whose hint was reworded (#12492)', () => {
    // If site 7 could not tell a reworded hint from the shared one it would be
    // decorative. Anchored on `group`, one of the two entries that had nothing
    // watching them before this card, and against a term that is NOT a
    // substring of the one under test: 'closed engine' is a different claim.
    const real = `      • set OS_TENANCY_POSTURE=group — ${TENANCY_POSTURE_FIX_HINTS.group}`;
    expect(
      '      • set OS_TENANCY_POSTURE=group — organization wall enforced by the closed engine, one shared database',
    ).not.toBe(real);
    expect('      • set OS_TENANCY_POSTURE=group').not.toBe(real);
    // …and says yes to the real thing — rendered through the real gate, not
    // restated. `expect(X).toBe(X)` here would be a vacuous truth dressed as a
    // control, which is the failure mode a control exists to rule out.
    const saved = process.env.OS_TENANCY_POSTURE;
    try {
      process.env.OS_TENANCY_POSTURE = 'not-a-posture';
      const verdict = resolveTenancyPostureOrRefusal();
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(lines(verdict.fatal)).toContain(real);
    } finally {
      if (saved === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = saved;
    }
  });

  it('the scoped-name reader returns a positive on a foreign package and empty on none', () => {
    // Anchored on a term that is NOT a substring of the one under test: a
    // zero-hit sweep is not a reading until the same instrument answers yes.
    expect(scopedNamesIn('prose naming @objectstack/legacy-orgs and @acme/thing')).toEqual([
      '@objectstack/legacy-orgs',
      '@acme/thing',
    ]);
    expect(scopedNamesIn('prose naming no scoped package at all')).toEqual([]);
    expect(scopedNamesIn(`prose naming ${PKG}`)).toEqual([PKG]);
  });
});

// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pins #10325: the startup banner (`◆ Create ObjectStack …`) names the
// version `create-objectstack`'s own package.json actually declares, not a
// hardcoded literal — the banner had said `v6.x` for eleven majors, the
// first line of output a newcomer ever sees.
//
// Two distinct properties, pinned separately so neither can go vacuous:
//
//   1. The banner's version text matches package.json's real `version`
//      field, read at test time (never a copy-pasted literal here — a test
//      that hardcoded "17.1.0" would itself go stale the next time this
//      package bumps, the same failure mode the card exists to close).
//   2. The three box lines still render to EQUAL display width with the
//      borders aligned, computed from PLAIN, ANSI-stripped text — a test
//      that only greps for the version string would still pass with the
//      right border pushed out of alignment (the #10322 defect class, one
//      function away in the same file: a box hand-kerned for one string
//      length, broken by a longer one).
//
// `renderVersionBanner` lives in banner.ts specifically so it can be unit
// tested directly with synthetic version strings (including a long
// prerelease, to exercise the box-widening path) without spawning a
// subprocess. `index.ts` itself calls `program.parse()` at module scope (see
// the comment above `rewriteProjectIdentity`), so the *wiring* — that the
// real CLI actually calls this function with the real declared version — is
// covered separately below via `tsx`, the same no-build subprocess pattern
// `scaffold-description.test.ts` and `scaffold-next-steps-pm.test.ts` use.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderVersionBanner } from './banner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const INDEX_TS = path.join(PKG_ROOT, 'src', 'index.ts');

// Built via fromCharCode rather than a literal escape in source, so nothing
// here can be silently re-materialized into a raw control byte on disk.
const ESC = String.fromCharCode(27);
/** Strip SGR color codes so a chalk-styled line measures the same as plain text. */
const stripAnsi = (s: string): string => s.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '');

/** Assert the three banner lines render to equal PLAIN width with aligned borders. */
function expectAlignedBox(lines: string[]): void {
  expect(lines).toHaveLength(3);
  const plain = lines.map(stripAnsi);
  const widths = plain.map((l) => [...l].length);
  expect(widths[1]).toBe(widths[0]);
  expect(widths[2]).toBe(widths[0]);
  // Borders: '╔'/'║'/'╚' open the line, '╗'/'║'/'╝' close it — verifying
  // this (rather than just equal length) catches a padding bug that drops
  // characters from the middle while coincidentally preserving total width.
  expect(plain[0].endsWith('╗')).toBe(true);
  expect(plain[1].endsWith('║')).toBe(true);
  expect(plain[2].endsWith('╝')).toBe(true);
}

describe('renderVersionBanner (#10325)', () => {
  it('renders an aligned box for an ordinary semver', () => {
    const lines = renderVersionBanner('17.1.0');
    expectAlignedBox(lines);
    expect(stripAnsi(lines[1])).toContain('v17.1.0');
  });

  it('widens the frame — never truncates — for a version longer than the historical width', () => {
    const long = '18.0.0-beta.1+build.20260822';
    const lines = renderVersionBanner(long);
    expectAlignedBox(lines);
    // The full version string survives intact (not clipped) inside the wider box.
    expect(stripAnsi(lines[1])).toContain(`v${long}`);
  });

  it('renders the same historical box width for a version no longer than the old placeholder budgeted for', () => {
    // "6.x" (3 chars) is one shorter than "17.1.0" (6 chars) but both sit
    // under the original hand-kerned budget — the box size should be
    // unchanged from before this fix for either.
    const lines = renderVersionBanner('6.x');
    const plainTop = stripAnsi(lines[0]);
    expect([...plainTop].length).toBe(39); // '  ╔' + 35 '═' + '╗', unchanged from the pre-fix literal
  });

  it('never renders the stale hardcoded placeholder', () => {
    const lines = renderVersionBanner('17.1.0').map(stripAnsi).join('\n');
    expect(lines).not.toContain('v6.x');
  });
});

describe('the real CLI banner (#10325, wiring)', () => {
  it('names the version create-objectstack\'s own package.json actually declares', () => {
    const declaredVersion = String(
      JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version,
    );
    // Sanity: prove this is a real assertion, not one that would pass no
    // matter what package.json said.
    expect(declaredVersion).toMatch(/^\d+\.\d+\.\d+/);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-banner-'));
    let stdout: string;
    try {
      stdout = execFileSync(
        TSX,
        [INDEX_TS, 'my-app', '--template', 'blank', '--skip-install', '--skip-skills'],
        {
          cwd: tmp,
          encoding: 'utf8',
          // Chalk decides its color level once, at import, from the process's
          // own env/TTY state — this run's vitest process itself sees no TTY,
          // so without forcing it here the child would render plain text and
          // the ANSI-stripping below would be exercised against a no-op,
          // leaving the "measure plain, not styled" requirement unverified.
          // FORCE_COLOR set on a *fresh child process* is read at that
          // process's own chalk import, unlike mutating it after the fact in
          // an already-running process (which chalk ignores).
          env: { ...process.env, FORCE_COLOR: '1' },
        },
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Sanity: the real ANSI codes are actually present here — otherwise the
    // stripAnsi() calls below would be passing through already-plain text
    // and this test would not be verifying the "measure plain, never
    // styled" property it exists to pin.
    expect(stdout).toContain(ESC + '[');

    const plain = stripAnsi(stdout);
    expect(plain).toContain(`◆ Create ObjectStack v${declaredVersion}`);
    expect(plain).not.toContain('v6.x');

    // The three banner lines specifically (not the whole run's output) must
    // still be an aligned box in the real, wired-up output — not just in the
    // isolated unit tests above.
    const bannerLines = plain
      .split('\n')
      .filter((l) => l.includes('╔═') || l.includes('◆ Create ObjectStack') || l.includes('╚═'));
    expectAlignedBox(bannerLines);
  }, 20_000);
});

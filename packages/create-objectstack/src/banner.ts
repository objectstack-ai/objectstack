// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.

/**
 * The CLI startup banner — the fixed-style box printed as the very first
 * output a scaffold run produces. Split out of index.ts (which calls
 * `program.parse()` at module scope and so cannot be imported directly by
 * tests — see the comment above `rewriteProjectIdentity`) purely so the
 * padding math has somewhere to be unit-tested without spawning a subprocess.
 *
 * #10325: the banner used to hardcode `v6.x` — eleven majors stale — rather
 * than reading the version it already had a working reader for
 * (`readCliVersion()` in index.ts, already used by `.version()`). The naive
 * fix of dropping the real version string into the old literal would have
 * reintroduced the same defect class one line later: the box's borders are a
 * fixed run of `═` computed for a 4-character `v6.x`, and `v17.1.0` (7 chars)
 * would push the right border out of alignment without recomputing the pad
 * (the sibling bug in #10322, one function away in the same file — a box
 * hand-kerned for `npm` broken by the one-character-longer `pnpm`).
 */

import chalk from 'chalk';

const PREFIX = '   ◆ Create ObjectStack ';

// Historical interior width: the original hardcoded line was 35 columns
// between the borders (`   ◆ Create ObjectStack ` + `v6.x` + 7 trailing
// spaces). Kept as a floor so ordinary version strings (`17.1.0`, `17.10.0`,
// …) still render the familiar box size unchanged; only a version long
// enough to need more room (e.g. a prerelease like `18.0.0-beta.1`) widens
// the frame.
const MIN_INNER_WIDTH = 35;

// Minimum breathing room between the version and the right border, so a
// version exactly at the width floor never has the border hugging the text.
const MIN_TRAILING_PAD = 3;

/**
 * Render the three lines of the startup banner for the given (unstyled)
 * `version` string (no leading `v` — this function adds it, matching the
 * banner's existing display convention; `readCliVersion()` in index.ts
 * returns the bare `package.json` version). The box WIDENS to fit a version
 * too long for the historical width rather than truncating it or letting the
 * trailing pad go negative — a truncated version number would be actively
 * misleading in the one place a newcomer looks to confirm what they got.
 *
 * Width math is always done on the PLAIN prefix/version strings — chalk's
 * ANSI escape codes are layered on only in the returned lines, never counted
 * (measuring a chalk-wrapped string would silently corrupt this arithmetic).
 */
export function renderVersionBanner(version: string): string[] {
  const versionLabel = `v${version}`;
  const innerWidth = Math.max(
    MIN_INNER_WIDTH,
    PREFIX.length + versionLabel.length + MIN_TRAILING_PAD,
  );
  const trailingPad = innerWidth - PREFIX.length - versionLabel.length;
  const border = '═'.repeat(innerWidth);

  return [
    chalk.bold.cyan(`  ╔${border}╗`),
    chalk.bold.cyan('  ║') +
      chalk.bold(PREFIX) +
      chalk.dim(versionLabel) +
      chalk.bold.cyan(`${' '.repeat(trailingPad)}║`),
    chalk.bold.cyan(`  ╚${border}╝`),
  ];
}

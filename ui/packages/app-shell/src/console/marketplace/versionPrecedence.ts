// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SemVer 2.0.0 precedence for marketplace package versions (objectui#10899
 * item 7).
 *
 * A package version is SemVer 2.0.0 by contract — `@objectstack/spec`'s
 * package manifest declares `version` against `SEMVER_2_0_0_VERSION_PATTERN`.
 * The package page used to decide "update available" with `installed !==
 * latest`, so an environment that held a NEWER version than the latest
 * approved one (a draft installed ahead of review) was offered an "update" to
 * the older version — `Installed v1.1.0 · Update available → v1.0.0`.
 *
 * "Update" means a version of HIGHER precedence, so this orders the two by the
 * spec's §11 rules: numeric core first; a pre-release ranks below its release;
 * pre-release identifiers compare dot by dot (numeric numerically, numeric
 * below alphanumeric, alphanumeric in ASCII order, a shorter set below a longer
 * one it prefixes); build metadata never takes part.
 *
 * A string that is not SemVer has no precedence, and `isNewerVersion` answers
 * `false` for it: the page then claims no update rather than guessing an order
 * the contract never gave it.
 */

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

// The spec's grammar: numeric identifiers carry no leading zero; the optional
// leading `v` is how the marketplace UI spells a version, never a stored one,
// and is not accepted here.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

function parseVersion(version: string): ParsedVersion | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

const NUMERIC = /^\d+$/;

function compareIdentifiers(a: string, b: string): number {
  const aNum = NUMERIC.test(a);
  const bNum = NUMERIC.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `-1` / `0` / `1` as `a` has lower / equal / higher precedence than `b`, or
 * `null` when either is not a SemVer 2.0.0 version.
 */
export function compareVersionPrecedence(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  // A release outranks every pre-release of the same core.
  if (pa.prerelease.length === 0 || pb.prerelease.length === 0) {
    if (pa.prerelease.length === pb.prerelease.length) return 0;
    return pa.prerelease.length === 0 ? 1 : -1;
  }
  const n = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < n; i += 1) {
    const c = compareIdentifiers(pa.prerelease[i], pb.prerelease[i]);
    if (c !== 0) return c as -1 | 1;
  }
  if (pa.prerelease.length === pb.prerelease.length) return 0;
  return pa.prerelease.length < pb.prerelease.length ? -1 : 1;
}

/**
 * True only when `candidate` is a version of HIGHER precedence than
 * `installed` — the one condition under which the marketplace may offer an
 * update. Equal, older, or not comparable answers `false`.
 */
export function isNewerVersion(candidate: string, installed: string): boolean {
  return compareVersionPrecedence(candidate, installed) === 1;
}

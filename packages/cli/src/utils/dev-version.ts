// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The version `os deploy` publishes: `<manifest.version>-dev.<YYYYMMDDHHMMSS>`.
 *
 * A semver PRE-RELEASE of the version the author wrote, so deploying twice
 * never collides with the control plane's "version already exists" refusal,
 * nobody hand-bumps `manifest.version` between deploys, and a dev build sorts
 * below the release it leads up to (`1.2.0-dev.… < 1.2.0`). The control plane
 * flags any `-dev` version as a pre-release.
 *
 * - The timestamp is UTC, to the second, so two people in two time zones never
 *   mint the same string for different builds; it has no leading zero, so it
 *   is a legal numeric identifier.
 * - A `manifest.version` that already carries a pre-release keeps it and gains
 *   `.dev.<ts>` (`1.2.0-beta.1` → `1.2.0-beta.1.dev.<ts>`), still below it.
 * - Build metadata (`+…`) is dropped: semver ignores it for precedence, so two
 *   deploys differing only there would be the same version.
 * - No `manifest.version` at all → `0.0.0-dev.<ts>`, as `os package publish`
 *   already does for a versionless artifact.
 * - A `manifest.version` that is not semver is refused, not repaired: minting
 *   a version the author never wrote is worse than saying what is wrong.
 */

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** `YYYYMMDDHHMMSS` in UTC. */
export function devTimestamp(at: Date): string {
  return at.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export type DevVersionResult = { ok: true; version: string } | { ok: false; reason: string };

export function devVersion(manifestVersion: unknown, at: Date): DevVersionResult {
  const ts = devTimestamp(at);
  if (manifestVersion === undefined || manifestVersion === null
    || (typeof manifestVersion === 'string' && !manifestVersion.trim())) {
    return { ok: true, version: `0.0.0-dev.${ts}` };
  }
  if (typeof manifestVersion !== 'string') {
    return { ok: false, reason: `manifest.version must be a string, got ${typeof manifestVersion}` };
  }
  const match = SEMVER.exec(manifestVersion.trim());
  if (!match) {
    return {
      ok: false,
      reason: `manifest.version '${manifestVersion}' is not a semver version (MAJOR.MINOR.PATCH, e.g. 1.0.0)`,
    };
  }
  const [, major, minor, patch, pre] = match;
  const core = `${major}.${minor}.${patch}`;
  return { ok: true, version: pre ? `${core}-${pre}.dev.${ts}` : `${core}-dev.${ts}` };
}

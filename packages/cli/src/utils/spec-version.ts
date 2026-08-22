// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createRequire } from 'module';

/**
 * Spec-version drift advisory.
 *
 * Surfaces the one thing an AI agent (or human) upgrading a third-party app
 * almost never finds on its own: the curated per-major migration guide. When
 * an app's authored `manifest.specVersion` declares an OLDER major than the
 * `@objectstack/spec` actually installed in its `node_modules`, the platform
 * moved ahead of the app and there is breaking-change guidance the author
 * should read before proceeding. Every major from v12 on is guaranteed a
 * `content/docs/releases/v<major>.mdx` page (enforced by
 * `scripts/check-release-notes.mjs`), so the URL below never 404s.
 *
 * The check is advisory-only — it never fails a build/validate. It exists so
 * the release notes are discoverable at the exact moment of the upgrade,
 * instead of being reverse-engineered from per-package `CHANGELOG.md` files.
 */

const RELEASES_BASE = 'https://objectstack.ai/docs/releases';

export interface SpecVersionGap {
  /** Major of the `@objectstack/spec` resolved from the app's node_modules. */
  installedMajor: number;
  /** Major declared by the app's `manifest.specVersion` range. */
  declaredMajor: number;
  /** Full installed spec version (e.g. `14.7.0`). */
  installedVersion: string;
  /** Canonical migration guide for the installed major. */
  url: string;
  /** Ready-to-print one-line advisory. */
  message: string;
  /** Ready-to-print follow-up pointing at the guide. */
  hint: string;
}

/** Parse the leading major integer out of a semver range like `^12.0.0`, `>=13`, `14.x`. */
function parseMajor(range: unknown): number | null {
  if (typeof range !== 'string') return null;
  const m = range.match(/\d+/);
  if (!m) return null;
  const major = Number.parseInt(m[0], 10);
  return Number.isFinite(major) ? major : null;
}

/** Resolve the installed `@objectstack/spec` version from the app being operated on. */
function resolveInstalledSpecVersion(): string | null {
  try {
    // Resolve relative to the CWD (the app), not the CLI install, so a globally
    // linked CLI still reports the app's locked spec version. Fall back to the
    // CLI's own resolution if the app doesn't hoist spec to its root.
    const requireFromApp = createRequire(`${process.cwd()}/package.json`);
    const pkg = requireFromApp('@objectstack/spec/package.json') as { version?: string };
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    // ignore — try the CLI-relative resolution below
  }
  try {
    const requireFromCli = createRequire(import.meta.url);
    const pkg = requireFromCli('@objectstack/spec/package.json') as { version?: string };
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    // ignore — spec not resolvable, no advisory
  }
  return null;
}

/**
 * Compute a spec-version drift advisory for the given app manifest, or `null`
 * when there is nothing to say (spec unresolvable, no `specVersion` declared,
 * or the declared major already matches / leads the installed platform).
 */
export function checkSpecVersionGap(
  manifest: { specVersion?: unknown } | undefined | null,
  /** Injectable for tests; defaults to the spec resolved from the app on disk. */
  installedVersion: string | null = resolveInstalledSpecVersion(),
): SpecVersionGap | null {
  const declaredMajor = parseMajor(manifest?.specVersion);
  if (declaredMajor == null) return null;

  if (!installedVersion) return null;
  const installedMajor = parseMajor(installedVersion);
  if (installedMajor == null) return null;

  // Only the upgrade case: the platform on disk is newer than what the app
  // declares. (declaredMajor > installedMajor is a stale/mismatched install —
  // a different problem, out of scope for release-note discoverability.)
  if (declaredMajor >= installedMajor) return null;

  const url = `${RELEASES_BASE}/v${installedMajor}`;
  return {
    installedMajor,
    declaredMajor,
    installedVersion,
    url,
    message: `Installed @objectstack/spec is v${installedVersion} but this app declares specVersion for v${declaredMajor}.`,
    hint: `Review the v${installedMajor} migration guide before bumping specVersion: ${url}`,
  };
}

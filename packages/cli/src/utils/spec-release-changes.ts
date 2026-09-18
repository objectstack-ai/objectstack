// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Minor-resolution upgrade data, read from the installed artifact.
 *
 * ## The question this answers, and the one `protocolVersionGap` answers
 *
 * `protocolVersionGap` (`utils/protocol-version-gap.ts`) is a MAJOR-resolution
 * advisory: it fires when the app's declared `engines.protocol` range excludes
 * the installed platform, which by construction is a major boundary. An app
 * declaring `^17` on spec 17.4.0 is compatible, so that advisory is `null` —
 * correctly, and silently, even when the release it just installed narrowed
 * several accept-sets. This repo ships BREAKING changes as minors under the
 * launch-window convention, so "compatible at the major" is not "nothing to
 * read".
 *
 * This reader answers the other half: what the installed RELEASE changed
 * relative to the one published before it, at package-version resolution. It is
 * not a second opinion about compatibility — it makes no compatibility judgment
 * at all — so the two never disagree.
 *
 * ## Why it is a read and not a computation
 *
 * The delta is computed once, at publish time, from the two tarballs, and is
 * verified there against them (`scripts/check-release-spec-changes.mjs`); it
 * ships as the `release` section of `spec-changes.json` inside
 * `@objectstack/spec` (ADR-0087 D4). Recomputing anything here would need the
 * previous tarball, which the consumer does not have — and a second producer of
 * the same fact is exactly the "two opinions" defect the protocol-gap advisory's
 * own header names. Absent section ⇒ nothing is reported, never a zero: a
 * release published before this section existed is not a release that changed
 * nothing.
 */
export interface SpecReleaseChanges {
  /** The previously published `@objectstack/spec` version this delta starts at. */
  fromVersion: string;
  /** The installed `@objectstack/spec` version. */
  toVersion: string;
  /** Public exports the installed release added. */
  added: number;
  /** Public exports the installed release removed. */
  removed: number;
  /** ADR-0087 D2 conversions first registered in the installed release. */
  converted: number;
  /** ADR-0087 D3 semantic migrations first registered in the installed release. */
  migrated: number;
  /** The file this was read from, so a consumer can read the named entries itself. */
  source: string;
}

/** The `release` section shape, as far as this reader cares. */
interface ReleaseSection {
  fromVersion?: unknown;
  toVersion?: unknown;
  added?: unknown;
  converted?: unknown;
  migrated?: unknown;
  removed?: unknown;
}

function count(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

/**
 * Locate the installed `@objectstack/spec`'s `spec-changes.json`.
 *
 * Resolved from the CWD (the app) first and the CLI second, the same order and
 * for the same reason as `resolveInstalledSpecVersion`: a globally linked CLI
 * must report the platform the APP installed.
 */
function resolveManifestPath(): string | null {
  for (const from of [`${process.cwd()}/package.json`, import.meta.url]) {
    try {
      const pkgJson = createRequire(from).resolve('@objectstack/spec/package.json');
      return join(dirname(pkgJson), 'spec-changes.json');
    } catch {
      // not resolvable from here — try the next origin
    }
  }
  return null;
}

/**
 * The installed release's own delta, or `null` when the artifact does not carry
 * one (unresolvable spec, no manifest, a release published before the section
 * existed, or a section this reader cannot fully trust).
 *
 * Every field is required: a partially readable section is reported as no
 * section at all rather than as a delta with a hole in it, because the one
 * failure mode that matters here is a consumer reading a number that is not
 * true of the release it has.
 */
export function readSpecReleaseChanges(
  /** Injectable for tests; defaults to the spec resolved from the app on disk. */
  manifestPath: string | null = resolveManifestPath(),
): SpecReleaseChanges | null {
  if (!manifestPath) return null;
  let section: ReleaseSection | undefined;
  try {
    const doc = JSON.parse(readFileSync(manifestPath, 'utf8')) as { release?: ReleaseSection };
    section = doc.release;
  } catch {
    return null;
  }
  if (!section || typeof section !== 'object') return null;

  const { fromVersion, toVersion } = section;
  if (typeof fromVersion !== 'string' || typeof toVersion !== 'string') return null;
  const added = count(section.added);
  const removed = count(section.removed);
  const converted = count(section.converted);
  const migrated = count(section.migrated);
  if (added === null || removed === null || converted === null || migrated === null) return null;

  return { fromVersion, toVersion, added, removed, converted, migrated, source: manifestPath };
}

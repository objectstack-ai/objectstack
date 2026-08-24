// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

/**
 * Matches a recursive TypeScript file pattern and captures its type infix:
 * the `object` in `object` type's declared `filePatterns` entry for `.ts`.
 *
 * Anchored on purpose. A pattern this expression does not match is one the
 * derivation below does not understand, and it answers `null` rather than
 * inventing a filename out of a shape nobody checked.
 */
const RECURSIVE_TS_PATTERN = /^\*\*\/\*\.([^/]+)\.ts$/;

/**
 * The type infix the registry declares for `type` — `object` for the `object`
 * entry's `.ts` pattern — or `null` when it declares no TypeScript pattern.
 */
export function metadataFileInfix(type: string): string | null {
  const entry = DEFAULT_METADATA_TYPE_REGISTRY.find(candidate => candidate.type === type);
  if (!entry) return null;

  for (const pattern of entry.filePatterns) {
    const match = RECURSIVE_TS_PATTERN.exec(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * The filename `os generate` writes for a metadata type, derived from that
 * type's OWN `filePatterns` in `DEFAULT_METADATA_TYPE_REGISTRY`.
 *
 * ## Why this is derived rather than tabulated
 *
 * `MetadataPlugin._loadFromFileSystem` primes every registered type by
 * globbing that type's `filePatterns`, and that is the default (`eager`)
 * bootstrap whenever no compiled artifact is configured. A scaffold whose
 * name matches none of those patterns still type-checks, still passes
 * `os validate` and still publishes, with nothing anywhere reporting that it
 * was skipped — the silent-strip shape ADR-0063's retirement of `os g agent`
 * closed (#10359).
 *
 * The harness used to write `NAME.ts` for every type, and that name matches
 * no pattern the registry declares for ANY type. Measured rather than
 * assumed: across the seven generators, `NAME.ts` matched zero `filePatterns`
 * entries and `NAME.TYPE.ts` matched exactly one, every time. #11025 closed
 * it for `skill` alone through a per-generator filename override and fenced
 * the repo-wide route as a decision of its own. This is that decision
 * (#11071), and it retires the override rather than growing it to six copies.
 *
 * ## Why it reads the pattern instead of interpolating the type name
 *
 * Three of the registry's 27 entries do not spell their pattern from their
 * own type key. `email_template` declares `*.email-template.ts` and
 * `external_catalog` declares `*.external-catalog.ts`, so a `${type}` infix
 * would write `NAME.email_template.ts` and re-create the exact invisibility
 * this closes — for a generator nobody would have to get wrong on purpose.
 * `doc` declares only a Markdown pattern and so has no TypeScript filename to
 * derive at all, which is why the miss below is a `null` the caller must
 * answer for rather than a guess.
 *
 * @param type       Metadata type key, as registered in the registry.
 * @param baseName   Already-normalized file stem (snake_case), no extension.
 * @returns The filename to write, or `null` when the registry declares no
 *          TypeScript file pattern for this type.
 */
export function metadataFileName(type: string, baseName: string): string | null {
  const infix = metadataFileInfix(type);
  return infix === null ? null : `${baseName}.${infix}.ts`;
}

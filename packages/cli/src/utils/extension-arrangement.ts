// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D10 — an extended object's whole arrangement is the paired
 * `.custom` package's, at `os validate` and `os build`.
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeExtensionArrangement`,
 * the one the save, restore, publish and install doors ask, so a green
 * validate is an artifact those doors admit: `fieldGroups` and `relatedLists`
 * on an `objectExtensions` entry only in a base's paired `.custom` package;
 * any other package places what it brings with `place`. This module only
 * hands it the artifact's packages, the reading
 * `findExtensionFieldSuffixRefusals` (`./extension-field-suffix.ts`) takes. A
 * stack naming no package id is not judged, as the judge skips a write bound
 * to no package.
 */

import { judgeExtensionArrangement } from '@objectstack/metadata-protocol';

import { artifactPackages } from './artifact-packages.js';

/** One refused arrangement key, located. `message` is the doors' sentence, verbatim. */
export interface ExtensionArrangementRefusalRow {
  /** Where the key sits in the parsed stack, e.g. `packages[1].manifest.objectExtensions[0].fieldGroups`. */
  path: string;
  /** The code the active doors refuse the same key with. */
  code: 'VALIDATION_ERROR';
  /** The key as written: `fieldGroups` or `relatedLists`. */
  key: string;
  /** The package the extension is declared in. */
  packageId: string;
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every arrangement key of the parsed stack the rule refuses. */
export function findExtensionArrangementRefusals(parsed: Record<string, unknown>): ExtensionArrangementRefusalRow[] {
  const entries = artifactPackages(parsed);
  const subjects = entries.length > 0
    ? entries.map(({ index, id, body }) => ({
      packageId: id, objectExtensions: body.objectExtensions, at: `packages[${index}].manifest.`,
    }))
    : [{
      packageId: isRecord(parsed.manifest) ? (parsed.manifest.id as string | undefined) : undefined,
      objectExtensions: parsed.objectExtensions,
    }];
  return subjects.flatMap((subject) => judgeExtensionArrangement(subject).map((r) => ({
    path: r.path, code: 'VALIDATION_ERROR' as const, key: r.key, packageId: r.packageId, message: r.message,
  })));
}

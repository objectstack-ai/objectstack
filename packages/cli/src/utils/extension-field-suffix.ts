// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D10, #28564 — the `__c` extension-field reservation at `os validate`.
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeExtensionFieldSuffix`,
 * the one the save, restore, publish, duplicate and install doors ask, so a
 * green validate is an artifact those doors admit: `__c` fields only in a
 * base's paired `.custom` package, and every `objectExtensions[].fields` key of
 * a `.custom` pair suffixed. This module only hands it the artifact's packages
 * — each `packages[]` entry under its own id, or the stack itself as one
 * package under `manifest.id` — the reading `findOverrideDeclarationRefusals`
 * (`./override-declarations.ts`) takes. A stack naming no package id is not
 * judged, as the judge skips a write bound to no package.
 */

import { judgeExtensionFieldSuffix, type ExtensionFieldSuffixRule } from '@objectstack/metadata-protocol';

import { artifactPackages } from './artifact-packages.js';

/** One refused field, located. `message` is the doors' sentence, verbatim. */
export interface ExtensionFieldSuffixRefusalRow {
  /** Where the field sits in the parsed stack, e.g. `packages[1].manifest.objectExtensions[0].fields.region`. */
  path: string;
  /** The code the active doors refuse the same field with. */
  code: 'VALIDATION_ERROR';
  /** Which of the two cases this is (`judgeExtensionFieldSuffix`'s `rule`). */
  rule: ExtensionFieldSuffixRule;
  /** The package the field is declared in. */
  packageId: string;
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every field of the parsed stack the reservation refuses. */
export function findExtensionFieldSuffixRefusals(parsed: Record<string, unknown>): ExtensionFieldSuffixRefusalRow[] {
  const entries = artifactPackages(parsed);
  const subjects = entries.length > 0
    ? entries.map(({ index, id, body }) => ({
      packageId: id, objects: body.objects, objectExtensions: body.objectExtensions, at: `packages[${index}].manifest.`,
    }))
    : [{
      packageId: isRecord(parsed.manifest) ? (parsed.manifest.id as string | undefined) : undefined,
      objects: parsed.objects,
      objectExtensions: parsed.objectExtensions,
    }];
  return subjects.flatMap((subject) => judgeExtensionFieldSuffix(subject).map((r) => ({
    path: r.path, code: 'VALIDATION_ERROR' as const, rule: r.rule, packageId: r.packageId, message: r.message,
  })));
}

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared pieces of the #4001 strictness-ledger gate
 * (`../check-strictness-ledger.mts`), extracted so the gate and its regression
 * test cannot drift apart on the one property that already broke silently:
 * whether the coverage walk descends into subdirectories.
 */

import fs from 'node:fs';
import path from 'node:path';

/** `z.object(` occurrences — the ledger's own stated counting method. */
export function countSites(file: string): number {
  return (fs.readFileSync(file, 'utf-8').match(/z\.object\(/g) ?? []).length;
}

/**
 * Every `*.zod.ts` under `dir`, **recursively**, as `/`-separated paths relative
 * to `dir` (so a nested file reads `driver/postgres.zod.ts` — exactly how the
 * ledger declares it).
 *
 * The recursion is the whole point of this function existing. The gate's first
 * version listed each triaged directory one level deep, which made
 * `data/driver/` — three per-driver connection-config files, nine authorable
 * sites — invisible to the check whose entire promise is "no undeclared
 * surface". It printed "no undeclared schema files" and was believed.
 *
 * A gate that under-reports is worse than no gate: it converts "I should
 * classify this" into "it is already classified". Keep the walk recursive, and
 * see `strictness-ledger.test.ts`, which fails if it stops being.
 */
export function listSchemaFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true })
    .map((f) => String(f).split(path.sep).join('/'))
    .filter((f) => f.endsWith('.zod.ts'))
    .sort();
}

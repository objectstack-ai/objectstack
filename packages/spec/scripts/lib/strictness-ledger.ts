// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared pieces of the #4001 strictness-ledger gate
 * (`../check-strictness-ledger.mts`), extracted so the gate and its regression
 * test cannot drift apart on the one property that already broke silently:
 * whether the coverage walk descends into subdirectories.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Object sites — `z.object(` **or** `strictObject(` — the ledger's own stated
 * counting method.
 *
 * `strictObject(` counts because it *is* an object site; it is what a converted
 * schema looks like. Counting only `z.object(` would have made every conversion
 * silently shrink the ledger's measured surface, so a directory being solved and
 * a directory being deleted would read identically — and a genuinely new,
 * un-triaged `strictObject` schema would never register as undeclared surface.
 *
 * The gate caught this itself on the first conversion (`data/seed.zod.ts`, 1 → 0),
 * which is the behaviour to preserve: a change in how schemas are written must
 * fail this check rather than quietly rebase what it measures.
 */
export function countSites(file: string): number {
  const src = fs.readFileSync(file, 'utf-8');
  return (src.match(/z\.object\(|(?<![A-Za-z0-9_])strictObject\(/g) ?? []).length;
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

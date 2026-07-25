// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for replay-unsafe seed datasets (framework#3434).
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate` and
// reusable by AI authoring. Seeds are REPLAYED — they re-load on every
// dev-server boot and every package re-publish, not applied once — so a
// dataset's mode has to be idempotent. `mode: 'insert'` is the one mode that
// is not: the loader's `insert` path writes every record unconditionally, with
// no existing-row check, so the table grows by the dataset's size on every
// restart (the showcase `showcase_project_membership` fixture went 3 → 6 → 9).
//
// This is the authoring-time nudge that would have caught #3434 before boot:
// flag `insert`, and point at the idempotent modes (`ignore` / `upsert`) plus
// the `externalId` — single field, or a COMPOSITE list of fields for a join /
// junction table that has no single natural key (`['team', 'project']`), the
// support for which #3434 added.
//
// Advisory (warning): an `insert` seed is not a schema error — it loads and
// "works" on a fresh DB; the defect only shows on the second boot. So it earns
// a located fix-it, not a hard `os compile` gate.

export type SeedReplaySafetySeverity = 'error' | 'warning';

export interface SeedReplaySafetyFinding {
  severity: SeedReplaySafetySeverity;
  rule: string;
  /** Human-readable location, e.g. `seed "showcase_project_membership"`. */
  where: string;
  /** Config path, e.g. `data[12].mode`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const SEED_INSERT_MODE_DUPLICATES_ON_REPLAY = 'seed-insert-mode-duplicates-on-replay';

type AnyRec = Record<string, unknown>;

/**
 * Flag every seed dataset declared with `mode: 'insert'` — the one non-idempotent
 * mode, which duplicates its rows on every replay boot (framework#3434). Returns
 * the findings (empty = clean). The caller decides how to surface them / whether
 * to fail the build; the CLI folds them in as advisory warnings.
 *
 * Reads `stack.data` (the `SeedSchema[]` fixtures). Safe on any shape — a stack
 * with no `data` array yields no findings.
 */
export function validateSeedReplaySafety(stack: AnyRec): SeedReplaySafetyFinding[] {
  const out: SeedReplaySafetyFinding[] = [];
  const seeds = Array.isArray(stack.data) ? (stack.data as AnyRec[]) : [];

  seeds.forEach((seed, i) => {
    if (!seed || typeof seed !== 'object') return;
    if (seed.mode !== 'insert') return;

    const object = typeof seed.object === 'string' ? seed.object : undefined;
    const where = object ? `seed "${object}"` : `data[${i}]`;

    out.push({
      severity: 'warning',
      rule: SEED_INSERT_MODE_DUPLICATES_ON_REPLAY,
      where,
      path: `data[${i}].mode`,
      message:
        "`mode: 'insert'` re-inserts every record on each replay boot (dev-server restart, " +
        'package re-publish) with no existing-row check, so the dataset duplicates the table ' +
        'on every restart — seeds are replayed, not applied once.',
      hint:
        "Use `mode: 'ignore'` (skip rows that already exist) or `'upsert'` (create-or-update), " +
        "and declare an `externalId` to match on: a single natural-key field (e.g. `externalId: 'code'`), " +
        'or a COMPOSITE list of fields for a join / junction table with no single natural key ' +
        "(e.g. `externalId: ['team', 'project']`).",
    });
  });

  return out;
}

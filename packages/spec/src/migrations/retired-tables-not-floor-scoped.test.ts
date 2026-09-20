// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `RETIRED_KEYS_BY_MAJOR` / `RETIRED_DEFS_BY_MAJOR` are keyed by protocol major
 * and live in the migration registry, which makes them look like chain state.
 * They are not: the chain never reads them, and their one reader folds every
 * major into one set with no idea a support floor exists. So raising
 * {@link MIGRATION_SUPPORT_FLOOR} can never make a row dead, and dropping rows
 * "below the floor" would delete live proof that those retirements were
 * declared.
 *
 * This matters because the loss is SILENT. Both tables are consumed as sets: a
 * row that goes missing produces no error at the moment it goes missing — the
 * tombstone the build gate was waiting for simply never arrives, and the
 * declared retirement stops being declared (#6957, 613 hand-resolved lines of
 * conflict markers over four days). The two assertions below are the structural
 * facts that make the floor and the tables independent, pinned where the next
 * floor move will read them.
 *
 * Measured on #19056 by ablation, for the record: a row planted under major 11
 * — a major whose migration step that PR deleted — was still read and judged by
 * `check:authorable-surface`, which reported it as "(registered at major 11)".
 * The reading survives the step's removal because it never depended on it.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from './registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The chain — the only thing `MIGRATION_SUPPORT_FLOOR` scopes. */
const CHAIN_SOURCE = readFileSync(resolve(HERE, 'chain.ts'), 'utf8');

/** The tables' one non-test reader (`check:authorable-surface`). */
const BUILD_SCHEMAS_SOURCE = readFileSync(resolve(HERE, '../../scripts/build-schemas.ts'), 'utf8');

describe('the retirement tables are NOT scoped by the migration support floor', () => {
  it('both tables carry rows — anti-vacuity for every assertion below', () => {
    expect(Object.values(RETIRED_KEYS_BY_MAJOR).flat().length).toBeGreaterThan(0);
    expect(Object.values(RETIRED_DEFS_BY_MAJOR).flat().length).toBeGreaterThan(0);
  });

  it('the chain never reads either table, so a floor move cannot orphan a row', () => {
    // `chain.ts` owns `MIGRATION_SUPPORT_FLOOR`'s only enforcement
    // (`MigrationFloorError`). It imports the steps and the floor, and nothing
    // from the retirement tables — which is why raising the floor retires
    // STEPS and nothing else.
    expect(CHAIN_SOURCE).toContain('MIGRATION_SUPPORT_FLOOR');
    expect(CHAIN_SOURCE).not.toContain('RETIRED_KEYS_BY_MAJOR');
    expect(CHAIN_SOURCE).not.toContain('RETIRED_DEFS_BY_MAJOR');
  });

  it('their reader does not know the floor exists, so it reads every major alike', () => {
    // `build-schemas.ts` is the only non-test importer of either table. It
    // folds `Object.entries(...)` across ALL majors into one set; the major is
    // kept to date a tombstone's aging clock, never to decide whether to read
    // the row. If this goes red, someone taught the gate about the floor —
    // which would make rows below it stop counting as declarations. Read
    // `RETIRED_KEYS_BY_MAJOR`'s "Lifecycle" docblock before changing it.
    expect(BUILD_SCHEMAS_SOURCE).toContain('RETIRED_KEYS_BY_MAJOR');
    expect(BUILD_SCHEMAS_SOURCE).toContain('RETIRED_DEFS_BY_MAJOR');
    expect(BUILD_SCHEMAS_SOURCE).not.toContain('MIGRATION_SUPPORT_FLOOR');
  });
});

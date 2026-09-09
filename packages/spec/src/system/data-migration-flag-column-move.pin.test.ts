// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16185] `columns_moved_at` — the `DataMigrationFlagSchema` member that
 * attests the COLUMN MOVE ran on this deployment, pinned at the two properties
 * the ruling on #15989 chose mechanism A for.
 *
 * The ruling picked "one nullable datetime on the flag row" over the
 * alternatives because its failure mode is ABSENCE: the row is written in the
 * same act that moves the columns, so it cannot disagree with itself, and every
 * row that exists in the world today — plus any consumer that cannot read the
 * member at all — lands on the legacy encoding with no extra logic. That makes
 * optional + nullable a CONTRACT, not a style choice, and it is the first thing
 * pinned here.
 *
 * The second is a NEGATIVE. `isDataMigrationFlagVerified` is documented as "the
 * ONE arbiter" for the existing consumers (reap gating #3459, strict flip
 * #3438); widening it would change what an already-verified row authorises on
 * deployments that have never heard of a column move. This card adds the
 * declaration and the column and stops — nothing writes the member, nothing
 * reads it yet, and the arbiter's answer for a row that omits it must be the
 * same answer it gave before the member existed. Prose cannot carry that; a
 * truth table can.
 *
 * ## Why the arbiter is pinned as an INVARIANCE and not as a truth table alone
 *
 * A truth table over `(verified_at, blocking)` re-states today's implementation
 * and would stay green if a later edit made the arbiter ALSO require
 * `columns_moved_at` — because every row in such a table would simply be
 * re-derived with the new clause. So each case is asserted three times over the
 * same `(verified_at, blocking)` pair — member absent, member null, member set
 * — and the three verdicts are asserted EQUAL to each other and to the recorded
 * expectation. A clause reading the new member breaks the equality, whatever it
 * decides. The source limb below closes the same door from the other side.
 *
 * `authorisesIrreversibleAction` is pinned with it because it composes the
 * arbiter: the same widening reached through the composition would be just as
 * silent.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  DataMigrationFlagSchema,
  authorisesIrreversibleAction,
  hasObservedDeviation,
  isDataMigrationFlagVerified,
  type DataMigrationFlag,
} from './migration.zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'migration.zod.ts');

const MOVED_AT = '2026-09-09T04:00:00.000Z';

/** A row shaped the way `recordDataMigrationRun` writes one, minus the new member. */
function baseRow(over: Partial<DataMigrationFlag> = {}): DataMigrationFlag {
  return {
    id: 'adr-0104-file-references',
    last_run_at: '2026-09-01T00:00:00.000Z',
    verified_at: '2026-09-01T00:00:00.000Z',
    applied_at: '2026-09-01T00:00:00.000Z',
    blocking: 0,
    ...over,
  };
}

describe('columns_moved_at — absence is the contract (#16185, ruling on #15989 Q1)', () => {
  it('parses green when the member is absent — every row alive today', () => {
    const result = DataMigrationFlagSchema.safeParse(baseRow());
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('injects NO default: an omitting row stays omitting after parse', () => {
    const result = DataMigrationFlagSchema.safeParse(baseRow());
    expect(result.success).toBe(true);
    // `in`, not `=== undefined`: a default of `null` or `''` would be a value
    // the absent arm must never acquire, and both would read as "present".
    expect('columns_moved_at' in (result.data as object)).toBe(false);
  });

  it('accepts an explicit null — the same fact said out loud', () => {
    const result = DataMigrationFlagSchema.safeParse(baseRow({ columns_moved_at: null }));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect((result.data as DataMigrationFlag).columns_moved_at).toBeNull();
  });

  it('is a DECLARED member, not a passthrough key — the value survives the parse', () => {
    // The object is not `.strict()`, so an undeclared key parses green too; it
    // is STRIPPED. Reading the value back is what distinguishes the two.
    const result = DataMigrationFlagSchema.safeParse(baseRow({ columns_moved_at: MOVED_AT }));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect((result.data as DataMigrationFlag).columns_moved_at).toBe(MOVED_AT);
    // Control for the same instrument: an undeclared sibling IS dropped.
    const control = DataMigrationFlagSchema.safeParse({
      ...baseRow(),
      columns_moved_at_typo: MOVED_AT,
    });
    expect(control.success).toBe(true);
    expect('columns_moved_at_typo' in (control.data as object)).toBe(false);
  });

  it('is a datetime, so a non-timestamp cannot masquerade as evidence', () => {
    for (const bad of ['', 'yes', '2026-09-09']) {
      const result = DataMigrationFlagSchema.safeParse(baseRow({ columns_moved_at: bad }));
      expect(result.success, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
    }
  });

  it('is the fourth member of the datetime-attestation set, not a replacement for one', () => {
    const row = baseRow({ columns_moved_at: MOVED_AT, deviation_observed_at: null });
    const result = DataMigrationFlagSchema.safeParse(row);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    const parsed = result.data as DataMigrationFlag;
    expect(parsed.verified_at).toBe(row.verified_at);
    expect(parsed.applied_at).toBe(row.applied_at);
    expect(parsed.deviation_observed_at).toBeNull();
    expect(parsed.columns_moved_at).toBe(MOVED_AT);
  });
});

describe('the ONE arbiter is unchanged by this card (#16185 constraint 2)', () => {
  /** `(verified_at, blocking)` and the verdict recorded BEFORE the new member existed. */
  const CASES: Array<{ label: string; over: Partial<DataMigrationFlag>; verified: boolean }> = [
    { label: 'verified, no blocking', over: { verified_at: MOVED_AT, blocking: 0 }, verified: true },
    { label: 'verified but blocking', over: { verified_at: MOVED_AT, blocking: 3 }, verified: false },
    { label: 'never verified', over: { verified_at: null, blocking: 0 }, verified: false },
    { label: 'verified_at empty string', over: { verified_at: '', blocking: 0 }, verified: false },
  ];

  it.each(CASES)(
    'isDataMigrationFlagVerified: $label — same verdict with the member absent, null and set',
    ({ over, verified }) => {
      const absent = isDataMigrationFlagVerified(baseRow(over));
      const nulled = isDataMigrationFlagVerified(baseRow({ ...over, columns_moved_at: null }));
      const set = isDataMigrationFlagVerified(baseRow({ ...over, columns_moved_at: MOVED_AT }));
      expect(absent).toBe(verified);
      expect(nulled).toBe(absent);
      expect(set).toBe(absent);
    },
  );

  it.each(CASES)(
    'authorisesIrreversibleAction: $label — the composition is invariant too',
    ({ over, verified }) => {
      const absent = authorisesIrreversibleAction(baseRow(over));
      const nulled = authorisesIrreversibleAction(baseRow({ ...over, columns_moved_at: null }));
      const set = authorisesIrreversibleAction(baseRow({ ...over, columns_moved_at: MOVED_AT }));
      // No deviation observed on these rows, so it tracks the arbiter exactly.
      expect(absent).toBe(verified);
      expect(nulled).toBe(absent);
      expect(set).toBe(absent);
    },
  );

  it('the true case is real, so the false cases are not vacuous', () => {
    expect(isDataMigrationFlagVerified(baseRow())).toBe(true);
    expect(authorisesIrreversibleAction(baseRow())).toBe(true);
    expect(hasObservedDeviation(baseRow())).toBe(false);
  });

  it('a moved column alone authorises nothing — the arbiter still needs its own evidence', () => {
    const moved = baseRow({ verified_at: null, blocking: 0, columns_moved_at: MOVED_AT });
    expect(isDataMigrationFlagVerified(moved)).toBe(false);
    expect(authorisesIrreversibleAction(moved)).toBe(false);
  });

  it('the arbiter reads verified_at and blocking, and names the new member nowhere', () => {
    const source = readFileSync(SOURCE, 'utf8');
    const decl = source.indexOf('export function isDataMigrationFlagVerified(');
    expect(decl, 'the arbiter moved — re-anchor this pin').toBeGreaterThan(-1);
    const close = source.indexOf('\n}', decl);
    expect(close, 'unterminated arbiter body').toBeGreaterThan(decl);
    const body = source.slice(decl, close);
    expect(body).toContain('verified_at');
    expect(body).toContain('blocking');
    expect(body).not.toContain('columns_moved_at');
  });
});

/**
 * Type-level half of "absence is the contract": both spellings must be
 * assignable to {@link DataMigrationFlag}, which is `z.input` of the schema. A
 * required member would redden the first, a non-nullable one the second. These
 * are checked by `pnpm --filter @objectstack/spec typecheck`, not at runtime.
 */
const OMITS_THE_MEMBER: DataMigrationFlag = {
  id: 'adr-0104-file-references',
  last_run_at: MOVED_AT,
  blocking: 0,
};
const SAYS_NULL: DataMigrationFlag = { ...OMITS_THE_MEMBER, columns_moved_at: null };

describe('the inferred input type keeps both spellings assignable', () => {
  it('compiles, and the values are what the declarations say', () => {
    expect('columns_moved_at' in OMITS_THE_MEMBER).toBe(false);
    expect(SAYS_NULL.columns_moved_at).toBeNull();
  });
});

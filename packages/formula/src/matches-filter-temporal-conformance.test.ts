// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the RLS write-side `check` evaluator (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data` so this backend, the three
 * drivers and the analytics preview are all held to one standard — see
 * `temporal-conformance.ts` for the four divergences that standard exists to
 * prevent. Adding a case there adds it here.
 *
 * This evaluator is type-blind: it sees a bare record with no schema, so both
 * the `datetime` and `date` cases run against the raw string values.
 *
 * [#21242 · ADR-0053 D-D1 items 5 and 9] It keeps no whole-day copy of the
 * bare-day upper bound any more. What reaches it is what a TYPED seam hands
 * it: the RLS compile seam lowers every policy filter with the shared
 * `lowerFilterCondition`, reading the object's declared `datetime` columns, so
 * each case's filter runs through that lowering here, against the declared
 * field map below. The expected rows are the shared table's, unchanged: the
 * whole-day cells are answered by the lowered filter, as on every seam-fed
 * face, and the `date` column is not lowered, because its stored calendar-day
 * text orders exactly as the day.
 */

import { describe, it, expect } from 'vitest';
import {
  lowerFilterCondition,
  TEMPORAL_CASES,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
} from '@objectstack/spec/data';

import { matchesFilterCondition } from './matches-filter';

/** The declared field map a typed seam reads for the shared rows. */
const CONFORMANCE_FIELDS: Readonly<Record<string, { type: string }>> = { at: { type: 'datetime' }, on: { type: 'date' } };

/** What the RLS compile seam hands this face: the case's filter, lowered on the declared `datetime` columns. */
const lowered = <T,>(filter: T): T =>
  lowerFilterCondition(filter, {
    isDatetimeColumn: (column) =>
      Object.prototype.hasOwnProperty.call(CONFORMANCE_FIELDS, column) && CONFORMANCE_FIELDS[column]!.type === 'datetime',
  });

describe('matchesFilterCondition — temporal conformance', () => {
  for (const c of TEMPORAL_CASES) {
    it(c.name, () => {
      const got = TEMPORAL_ROWS.filter((r) => matchesFilterCondition(r, lowered(c.filter))).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });
  }
});

/**
 * The storage-form axis, as it exists on a type-blind surface (#4191).
 *
 * The drivers' version of this axis injects rows below the write path. This
 * evaluator has no storage to inject into — but it has the same defect for the
 * same reason, and the population is not synthetic: `plugin-security` builds
 * the RLS `check` post-image as `{ ...opCtx.data }`, the caller's RAW write
 * payload, BEFORE any driver `formatInput` converges it. So an SDK write of
 * `new Date()` is exactly what this evaluator is handed, and the shared
 * `writerForm` tag names precisely that population.
 *
 * Measured before the fix: 10 of the 16 shared cases dropped every
 * `Date`-valued row, because JS relational operators coerce a `Date`/ISO-string
 * pair to `epoch`/`NaN`. Fail-closed turns that into a **denied write** — the
 * write-side twin of #4047, on the surface where the failure direction is a
 * rejected write rather than a missing row (the same asymmetry D-D2 recorded
 * for the bare-day upper bound).
 *
 * `on` stays text: a `Field.date` payload is a calendar day, and the shared
 * expectations for the `date` column are calendar-day text semantics. A `Date`
 * there would be asserting a different question (what a native `date` write
 * denotes), which belongs with the drivers that own a `date` storage form.
 */
describe('matchesFilterCondition — temporal conformance on a native-writer post-image', () => {
  const nativeRows = TEMPORAL_ROWS.map((r) => ({
    ...r,
    at: r.writerForm === 'native' ? new Date(r.at) : r.at,
  }));

  for (const c of TEMPORAL_CASES) {
    it(c.name, () => {
      const got = nativeRows.filter((r) => matchesFilterCondition(r as any, lowered(c.filter))).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });
  }

  it('the mirror pairing too: a CEL-lowered Date comparand against wire-form records', () => {
    // `today()` lowers to a `Date` at UTC midnight (ADR-0053 D1), so a compiled
    // `check` hands this evaluator the OTHER cross-type pairing. It broke
    // identically and must answer identically.
    const bound = new Date('2026-07-28T00:00:00.000Z');
    const got = TEMPORAL_ROWS.filter((r) => matchesFilterCondition(r, { at: { $gte: bound } } as any)).map((r) => r.id);
    // `z_last` (9999-12-31, #20600) is after the bound like `f_next` and `g_eom`.
    expect(got).toEqual(['c_open', 'd_mid', 'e_late', 'f_next', 'g_eom', 'z_last']);
  });
});

/**
 * Why the token axis is absent here.
 *
 * `TemporalCase` carries a `tokenFilter` — the same filter spelled with
 * `{today}` / `{current_month_end}` placeholders — which the driver and
 * analytics suites resolve through `resolveFilterTokens` before asserting. This
 * suite deliberately runs only `c.filter`, and that is an architectural fact
 * rather than a coverage hole:
 *
 * an RLS `check` is a **CEL expression** (`PermissionSet.check` is a string,
 * compiled by `rlsCompiler.compileFilter`), where a relative date is the
 * *function* `today()` evaluated during compilation. A `{token}` string never
 * reaches this evaluator — `resolveFilterTokens` runs on the ObjectQL **read**
 * path (`engine.ts` resolves `ast.where`), and the write-side check does not go
 * through it (`plugin-security` never calls the resolver).
 *
 * Asserting `tokenFilter` here would therefore test an input this backend
 * cannot be handed. If that ever changes — if a `check` gains a token-bearing
 * filter form — this comment is the thing to delete, and the axis is already
 * sitting in the shared table ready to be consumed.
 *
 * The same reasoning covers the wall-clock sweep below: `TemporalTimeCase`
 * carries no token spelling at all, because no relative-date macro resolves to
 * a time of day.
 */

describe('matchesFilterCondition — Field.time conformance', () => {
  // Type-blind, so the records carry the canonical wall-clock text a converged
  // column presents. That the variable-width canon still orders correctly under
  // a plain string comparison is the assertion.
  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, () => {
      const got = TEMPORAL_TIME_ROWS.filter((r) => matchesFilterCondition(r, c.filter)).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });
  }
});

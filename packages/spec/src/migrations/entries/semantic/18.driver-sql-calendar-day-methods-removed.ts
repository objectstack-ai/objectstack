// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Registered by the change that removed the three methods (#20822, PR #20988),
// not by a later reconciliation.
export const entry: SemanticMigration = {
  id: 'driver-sql-calendar-day-methods-removed',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'SqlDriver protected methods calendarDayExclusiveUpperBound, calendarDayUpperBoundRewrite '
    + 'and calendarDayBetweenRewrite (inherited by SqliteWasmDriver and TursoDriver)',
  replacement:
    'lower the filter before the driver compiles it — '
    + '`lowerFilterCondition(where, { isDatetimeColumn })` from `@objectstack/spec/data` — '
    + 'instead of calling or overriding a driver method; leave `isDatetimeColumn` out and the '
    + 'whole-day rule applies to every column',
  reason:
    'The exported `SqlDriver` class of `@objectstack/driver-sql` declared three `protected` '
    + 'methods that were its own copy of the whole-day rule of ADR-0053 D-D1: on a `datetime` '
    + 'column, a bare-day inclusive upper bound (`$lte \'2026-01-05\'`, or the maximum of a '
    + '`$between`) compiled as `$lt` the next day, and the last supported day (`9999-12-31`) '
    + 'compiled as no upper bound. `calendarDayExclusiveUpperBound` computed that bound, '
    + '`calendarDayUpperBoundRewrite` rewrote a `$lte` with it, and `calendarDayBetweenRewrite` '
    + 'rewrote a `$between` with it. The shared filter lowering in `@objectstack/spec/data` '
    + '(`lowerFilterCondition`) now applies the rule once, at the engine\'s `where` seam and '
    + 'at the RLS compile seam, before any driver sees the filter, so the driver\'s copy was '
    + 'deleted, and the three methods with it (ADR-0053 D-D1 items 5 and 9, as amended). Two '
    + 'consequences reach a subclass, and only one of them reaches the compiler. A subclass '
    + 'that CALLS one of the three, or declares one with `override`, stops compiling: '
    + 'TS2339 and TS4113, measured with tsc 6.0.3 against the published declaration. A '
    + 'subclass that re-declares one '
    + 'WITHOUT `override` compiles cleanly, with `noImplicitOverride` off and also with it '
    + 'on, because the base class no longer has a member to override. That declaration is '
    + 'never called: the driver calls none of the three any more, so the override goes '
    + 'silently dead and the rule it carried stops applying. An untyped JS subclass gets a '
    + '`TypeError` at a call and the same silent death for an override. A driver subclass is '
    + 'CODE, never stack metadata, so there is no authored source for the chain to rewrite '
    + 'and no schema tombstone. For the silent half, this entry is the only notice there is: '
    + 'the same disposition as `driver-sql-distinct-bare-filter-typed` and '
    + '`runtime-httpserver-wrapper-retired`. In this repo the one caller was `TursoDriver`\'s '
    + 'remote face, changed in the same PR. A read through the engine or the RLS compile seam '
    + 'answers as before, because the seam lowers first; a filter handed to the driver '
    + 'directly is now compared as written. ADR-0053 / ADR-0087.',
  acceptanceCriteria:
    'No subclass of `SqlDriver`, `SqliteWasmDriver` or `TursoDriver` names '
    + '`calendarDayExclusiveUpperBound`, `calendarDayUpperBoundRewrite` or '
    + '`calendarDayBetweenRewrite`. Search the source for the three names rather than relying '
    + 'on tsc, because a re-declaration without `override` compiles and is never called. A '
    + 'subclass that called one to widen a bound hands the driver a lowered filter instead: '
    + '`lowerFilterCondition(where, { isDatetimeColumn })`. One that overrode one to change '
    + 'which columns take the whole-day bound passes its own `isDatetimeColumn`. Proven when, '
    + 'on a `datetime` column, `where: { signed_on: { $lte: \'2026-01-05\' } }` reaches the '
    + 'driver through that path and returns a row stamped `2026-01-05T15:00:00.000Z`. Handed '
    + 'to the driver unlowered, the same filter compares against that day\'s midnight and '
    + 'drops the row. A host that reads only through the engine (`find`, `count`, '
    + '`aggregate`) or through RLS policies needs no change: those seams lower the filter '
    + 'before the driver sees it.',
};

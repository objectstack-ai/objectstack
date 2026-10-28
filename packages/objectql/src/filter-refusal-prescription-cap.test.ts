// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27173] Two `INVALID_FILTER` producers — the temporal-comparand door and
 * the text-operator declared-type door — state what to write instead INSIDE
 * the 500 characters a client reads.
 *
 * The cap stays: `mapDataError` (`@objectstack/types`) cuts a 4xx message at
 * `CLIENT_MESSAGE_MAX` with `…`, and that is the general bound on what reaches
 * a client. So the producer orders each refusal verdict, prescription, then
 * consequence, and this file reads every arm the way a client does — through
 * `mapDataError` — and requires the whole prescription in what survives the
 * cut, ahead of "NOT applied". Measured on `origin/main` `4d3a077f` before the
 * reorder, every arm below but `time` junk and the short-name cases put the
 * prescription last, and on these fixtures the client read none or only the
 * head of it.
 *
 * The fixtures are long on purpose — a 12-character object and field, a path
 * through an aggregation's filter and a nested `$and` / `$or` — so the pin
 * holds with margin, not only on a one-letter field.
 */

import { describe, it, expect } from 'vitest';
import { resolveFilterTokens } from '@objectstack/core';
import { mapDataError } from '@objectstack/types';
import {
  assertTemporalComparandsInterpretable,
  assertHavingTemporalComparandsInterpretable,
  assertResolvedTemporalTokensInRange,
  assertHavingResolvedTemporalTokensInRange,
} from './temporal-comparand-door.js';
import { assertTextOperatorTargetsAreStringCapable } from './text-operator-declared-type-door.js';

const OBJECT = 'support_case';
const FIELD = 'created_date';
const ROOTS = ['where', 'aggregations[0].filter'] as const;

/** The refusal a client reads: status, code, and the bounded `error` text. */
function clientReads(fn: () => void): { status: number; code: unknown; text: string; full: string } {
  let thrown: unknown;
  try { fn(); } catch (e) { thrown = e; }
  expect(thrown, 'the door refused').toBeInstanceOf(Error);
  const { status, body } = mapDataError(thrown);
  return { status, code: body.code, text: String(body.error), full: (thrown as Error).message };
}

/**
 * The prescription is whole in what the client reads, and precedes the
 * "NOT applied" sentence — the consequence after it is what a cut may take.
 */
function expectPrescriptionInside(fn: () => void, prescription: readonly string[]): void {
  const read = clientReads(fn);
  expect(read.status).toBe(400);
  expect(read.code).toBe('INVALID_FILTER');
  const notApplied = read.full.indexOf(' was NOT applied');
  expect(notApplied, read.full).toBeGreaterThan(0);
  for (const words of prescription) {
    expect(read.text, `client text misses ${JSON.stringify(words)}`).toContain(words);
    expect(read.full.indexOf(words), `${JSON.stringify(words)} sits after "NOT applied"`).toBeLessThan(notApplied);
  }
}

/** The opening and the closing words of each remedy sentence, per class. */
const DATETIME_REMEDY = ['Write a relative-date placeholder such as "{30_days_ago}"', 'or epoch milliseconds.'];
const DATE_REMEDY = ['Write a "YYYY-MM-DD" calendar day that exists', '"{current_month_start}".'];
const TIME_REMEDY = ['Write an "HH:MM" / "HH:MM:SS" wall clock', 'ADR-0053 D-C1).'];
const DATETIME_YEARS_REMEDY = ['Write an ISO-8601 instant, epoch milliseconds or a Date', 'in the years 1000 to 9999.'];
const DATE_YEARS_REMEDY = ['Write a "YYYY-MM-DD" day, epoch milliseconds or a Date', 'in the years 0001 to 9999.'];
const TOKEN_REMEDY = ['Use a relative-date placeholder whose offset lands inside those years.'];

type Kind = 'date' | 'datetime' | 'time';
const WHERE_CASES: ReadonlyArray<readonly [string, Kind, unknown, readonly string[]]> = [
  ['a preset name (junk) on a datetime', 'datetime', 'last_30_days', DATETIME_REMEDY],
  ['a 60-character junk string on a datetime', 'datetime', 'x'.repeat(80), DATETIME_REMEDY],
  ['junk on a date', 'date', 'last_30_days', DATE_REMEDY],
  ['junk on a time', 'time', 'noon', TIME_REMEDY],
  ['year 10000 on a datetime', 'datetime', '+010000-01-01T00:00:00.000Z', DATETIME_YEARS_REMEDY],
  ['year 999 on a datetime (before the floor)', 'datetime', '0999-01-01T00:00:00.000Z', DATETIME_YEARS_REMEDY],
  ['year 10000 on a date', 'date', 253402300800000, DATE_YEARS_REMEDY],
  ['an impossible day on a date', 'date', '2026-02-30', DATE_REMEDY],
  ['an impossible day on a datetime', 'datetime', '2026-02-30T00:00:00Z', DATETIME_REMEDY],
  ['a slashed day on a datetime (not ISO)', 'datetime', '07/15/2026', DATETIME_REMEDY],
  ['an instant outside the four-digit years on a time', 'time', '+010000-01-01T00:00:00.000Z', TIME_REMEDY],
];

describe('[#27173] the temporal-comparand door: the prescription lands inside the client cap', () => {
  for (const [name, kind, value, prescription] of WHERE_CASES) {
    it(`where / aggregations[i].filter — ${name}`, () => {
      const schema = { fields: { [FIELD]: { type: kind } } };
      for (const root of ROOTS) {
        expectPrescriptionInside(() => assertTemporalComparandsInterpretable(
          OBJECT, 'aggregate', schema, { $and: [{ x: 1 }, { $or: [{ [FIELD]: { $in: [value] } }] }] }, root,
        ), prescription);
      }
    });
    it(`having — ${name}`, () => {
      const classes = new Map([[FIELD, kind]]);
      const query = { aggregations: [{ alias: FIELD, function: 'max', field: 'opened_on_src' }] };
      expectPrescriptionInside(() => assertHavingTemporalComparandsInterpretable(
        OBJECT, { [FIELD]: { $gt: value } }, classes as never, query,
      ), prescription);
    });
  }

  const TOKENS: ReadonlyArray<readonly [Kind, string, readonly string[]]> = [
    ['datetime', '{8000_years_from_now}', [...TOKEN_REMEDY, ...DATETIME_YEARS_REMEDY]],
    ['datetime', '{1977_years_ago}', [...TOKEN_REMEDY, ...DATETIME_YEARS_REMEDY]],
    ['date', '{8000_years_from_now}', [...TOKEN_REMEDY, ...DATE_YEARS_REMEDY]],
    ['time', '{8000_years_from_now}', TIME_REMEDY],
  ];
  for (const [kind, token, prescription] of TOKENS) {
    it(`a ${token} placeholder resolved outside a ${kind} column's years — where, aggregations[i].filter, having`, () => {
      const schema = { fields: { [FIELD]: { type: kind } } };
      const written = { [FIELD]: { $gt: token } };
      const resolved = resolveFilterTokens(written, {});
      for (const root of ROOTS) {
        expectPrescriptionInside(() => assertResolvedTemporalTokensInRange(
          OBJECT, 'aggregate', schema, written, resolved, root,
        ), prescription);
      }
      const classes = new Map([[FIELD, kind]]);
      const query = { groupBy: [{ field: 'opened_on_src', alias: FIELD, dateGranularity: 'day' }] };
      expectPrescriptionInside(() => assertHavingResolvedTemporalTokensInRange(
        OBJECT, written, resolved, classes as never, query,
      ), prescription);
    });
  }
});

describe('[#27173] the text-operator declared-type door: the prescription lands inside the client cap', () => {
  for (const type of ['number', 'currency', 'boolean', 'datetime', 'json']) {
    it(`${type} under $notContains — where and aggregations[i].filter`, () => {
      const field = 'contract_value';
      const schema = { fields: { [field]: { type } } };
      for (const root of ROOTS) {
        expectPrescriptionInside(() => assertTextOperatorTargetsAreStringCapable(
          OBJECT, 'aggregate', schema, { $and: [{ x: 1 }, { $or: [{ [field]: { $notContains: '5' } }] }] }, root,
        ), [
          `Compare '${field}' with an operator its declared type can answer`,
          'or aim the text operator at a text-valued field.',
        ]);
      }
    });
  }
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pushdown translation table: each `where` the engine can hand the
 * driver, the `$filter` it becomes, and whether every predicate made it in.
 * The rule every row pins is the module's: never narrower than the `where`.
 */

import { describe, expect, it } from 'vitest';
import { odataV4Dialect, parseCsdlV4 } from './dialect-v4.js';
import { translateWhere, type FilterTarget } from './filter.js';
import { TRIPPIN_METADATA } from './__fixtures__/recorded-service.js';

const model = parseCsdlV4(TRIPPIN_METADATA);
const NS = 'Microsoft.OData.SampleService.Models.TripPin';

/** A target over an entity type, with the column map the tests' objects declare (remote → local). */
function targetOf(entityType: string, columnMap: Record<string, string>): FilterTarget {
  const type = model.entityTypes.get(`${NS}.${entityType}`)!;
  const byField = new Map(type.properties.map((p) => [columnMap[p.name] ?? p.name, p]));
  if (type.key.length === 1) byField.set('id', type.properties.find((p) => p.name === type.key[0])!);
  return { model, propertyOf: (field) => byField.get(field) };
}

const people = targetOf('Person', {
  UserName: 'user_name', FirstName: 'first_name', LastName: 'last_name', MiddleName: 'middle_name',
  Gender: 'gender', Age: 'age', Emails: 'emails', AddressInfo: 'address_info', Concurrency: 'concurrency',
});
const flights = targetOf('Flight', {
  PlanItemId: 'plan_item_id', FlightNumber: 'flight_number', TripDate: 'trip_date', TrackingId: 'tracking_id',
  Fare: 'fare', Cancelled: 'cancelled', StartsAt: 'starts_at', SeatNumber: 'seat_number', Duration: 'duration',
});

type Row = [label: string, target: FilterTarget, where: unknown, filter: string | null, complete: boolean];

const TABLE: Row[] = [
  // Nothing to translate.
  ['no where', people, undefined, null, true],
  ['empty where', people, {}, null, true],

  // Equality and its shorthand, through the column map and the `id` alias.
  ['bare equality', people, { first_name: 'Russell' }, "FirstName eq 'Russell'", true],
  ['$eq', people, { first_name: { $eq: 'Russell' } }, "FirstName eq 'Russell'", true],
  ['quote escaping', people, { last_name: "O'Neil" }, "LastName eq 'O''Neil'", true],
  ['id names the key', people, { id: 'russellwhyte' }, "UserName eq 'russellwhyte'", true],
  ['null equality', people, { middle_name: null }, 'MiddleName eq null', true],
  ['enum member', people, { gender: 'Female' }, `Gender eq ${NS}.PersonGender'Female'`, true],

  // Ordering and ranges on non-text types.
  ['integer ordering', people, { age: { $gte: 21, $lt: 65 } }, '(Age ge 21) and (Age lt 65)', true],
  ['$between', people, { age: { $between: [18, 30] } }, 'Age ge 18 and Age le 30', true],
  ['integer key, integer text', flights, { id: '42' }, 'PlanItemId eq 42', true],
  ['decimal', flights, { fare: { $gt: 99.5 } }, 'Fare gt 99.5', true],
  ['boolean', flights, { cancelled: false }, 'Cancelled eq false', true],
  ['date', flights, { trip_date: { $lte: '2026-11-02' } }, 'TripDate le 2026-11-02', true],
  ['date-time with its zone', flights, { starts_at: { $gt: '2026-11-02T08:00:00Z' } }, 'StartsAt gt 2026-11-02T08:00:00Z', true],
  ['Date object', flights, { starts_at: { $lt: new Date('2026-11-02T08:00:00.000Z') } }, 'StartsAt lt 2026-11-02T08:00:00.000Z', true],
  ['guid', flights, { tracking_id: '5a1d6c8e-2f0b-4b5e-9f1a-0c2d3e4f5a6b' }, 'TrackingId eq 5a1d6c8e-2f0b-4b5e-9f1a-0c2d3e4f5a6b', true],

  // Negation keeps the null rows a SQL-backed service would drop.
  ['$ne on a nullable property', people, { age: { $ne: 30 } }, 'Age ne 30 or Age eq null', true],
  ['$ne on a non-nullable property', flights, { cancelled: { $ne: true } }, 'Cancelled ne true', true],
  ['$ne null', people, { middle_name: { $ne: null } }, 'MiddleName ne null', true],
  ['$nin on a nullable property', people, { age: { $nin: [1, 2] } }, 'not (Age eq 1 or Age eq 2) or Age eq null', true],
  ['$nin empty', people, { age: { $nin: [] } }, null, true],

  // Sets and nulls.
  ['$in', people, { user_name: { $in: ['russellwhyte', 'scottketchum'] } }, "(UserName eq 'russellwhyte' or UserName eq 'scottketchum')", true],
  ['$in one', people, { user_name: { $in: ['russellwhyte'] } }, "UserName eq 'russellwhyte'", true],
  ['$in empty', people, { user_name: { $in: [] } }, 'false', true],
  ['$null true', people, { middle_name: { $null: true } }, 'MiddleName eq null', true],
  ['$null false', people, { middle_name: { $null: false } }, 'MiddleName ne null', true],

  // String functions.
  ['$contains', people, { last_name: { $contains: 'hy' } }, "contains(LastName,'hy')", true],
  ['$startsWith', people, { last_name: { $startsWith: 'Wh' } }, "startswith(LastName,'Wh')", true],
  ['$endsWith', people, { last_name: { $endsWith: 'te' } }, "endswith(LastName,'te')", true],
  ['$icontains, ASCII', people, { last_name: { $icontains: 'WHY' } }, "contains(tolower(LastName),'why')", true],

  // Combinators.
  ['two fields AND', people, { first_name: 'Russell', age: { $gt: 1 } }, "(FirstName eq 'Russell') and (Age gt 1)", true],
  ['$and', people, { $and: [{ first_name: 'Russell' }, { last_name: 'Whyte' }] }, "(FirstName eq 'Russell') and (LastName eq 'Whyte')", true],
  ['$or', people, { $or: [{ first_name: 'Russell' }, { first_name: 'Scott' }] }, "(FirstName eq 'Russell') or (FirstName eq 'Scott')", true],

  // Left to the engine — widened, never narrowed.
  ['$not is never pushed down', people, { $not: { first_name: 'Russell' } }, null, false],
  ['$and keeps what it can', people, { $and: [{ first_name: 'Russell' }, { $not: { age: 3 } }] }, "FirstName eq 'Russell'", false],
  ['$or with one untranslatable member drops whole', people, { $or: [{ first_name: 'Russell' }, { last_name: { $like: 'Wh%' } }] }, null, false],
  ['text ordering', people, { last_name: { $gt: 'M' } }, null, false],
  ['text negation', people, { last_name: { $ne: 'Whyte' } }, null, false],
  ['text $nin', people, { last_name: { $nin: ['Whyte'] } }, null, false],
  ['one operator of two', people, { age: { $gt: 1, $exists: true } }, 'Age gt 1', false],
  ['$like', people, { last_name: { $like: 'Wh%' } }, null, false],
  ['$notContains', people, { last_name: { $notContains: 'x' } }, null, false],
  ['$icontains, non-ASCII', people, { last_name: { $icontains: 'É' } }, null, false],
  ['undeclared field', people, { nickname: 'Rus' }, null, false],
  ['collection property', people, { emails: 'Russell@example.com' }, null, false],
  ['complex property', people, { address_info: { $null: true } }, null, false],
  ['field reference', people, { first_name: { $eq: { $field: 'last_name' } } }, null, false],
  ['dotted path', people, { 'best_friend.first_name': 'Scott' }, null, false],
  ['date-time without a zone', flights, { starts_at: { $gt: '2026-11-02T08:00:00' } }, null, false],
  ['date-only on a date-time', flights, { starts_at: { $gt: '2026-11-02' } }, null, false],
  ['text on an integer key', flights, { id: 'abc' }, null, false],
  ['duration', flights, { duration: 'PT2H' }, null, false],
  ['enum member that is not a name', people, { gender: "Male' or 1 eq 1" }, null, false],
];

describe('where → $filter (OData v4)', () => {
  it.each(TABLE)('%s', (_label, target, where, filter, complete) => {
    expect(translateWhere(where, target, odataV4Dialect)).toEqual({ filter, complete });
  });
});

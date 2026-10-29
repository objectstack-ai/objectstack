// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27337] The no-operator-object refusal states what to write instead INSIDE
 * the 500 characters a client reads, for every kind of column it judges.
 *
 * The cap stays: `mapDataError` (`@objectstack/types`) cuts a 4xx message at
 * `CLIENT_MESSAGE_MAX` with `…`. So `no-operator-object-door.ts` orders each
 * kind's words verdict, route, then "NOT applied" and the reasoning, and this
 * file reads every kind the way a client does — through `mapDataError` — and
 * requires the whole route in what survives the cut, ending at least
 * {@link MARGIN} characters before it, ahead of "NOT applied". Run against the
 * door as it stood on `origin/main` `6d7634a9`, the single-valued lookup route
 * is cut at both positions here, and every other kind's route sits after
 * "NOT applied".
 *
 * The fixtures are long on purpose — a 21-character object, 20- to
 * 24-character fields, a three-key object, a path through an aggregation's
 * filter and a nested `$and` / `$or` — so the pin holds with margin, not only
 * on a one-letter field.
 */

import { describe, it, expect } from 'vitest';
import { mapDataError } from '@objectstack/types';
import { narrowHavingNumberComparands, narrowNumberComparands } from './number-comparand-declared-type-door.js';

const OBJECT = 'customer_support_case';
const TARGET = 'customer_account';
/** The characters a client reads before the `…`: `CLIENT_MESSAGE_MAX - 1`. */
const CLIENT_CUT = 499;
/** How far inside the cut every route must end. */
const MARGIN = 40;
const NESTED_OBJECT = { region: 'NA', tier: 'gold', status: 'open' };

const SCHEMA = {
  fields: {
    primary_account_owner: { name: 'primary_account_owner', type: 'lookup', reference: TARGET },
    secondary_account_owners: { name: 'secondary_account_owners', type: 'lookup', reference: TARGET, multiple: true },
    integration_metadata: { name: 'integration_metadata', type: 'json' },
    shipping_destination: { name: 'shipping_destination', type: 'address' },
    contract_value_amount: { name: 'contract_value_amount', type: 'number' },
  },
};

/** The opening and the closing words of each kind's route. */
const SINGLE_LOOKUP_ROUTE = [`Move the condition to 'where', or filter`, '"$in": [ID, …] } }.'] as const;
const MULTI_LOOKUP_ROUTE = [`Move the condition to 'where': here`, 'matches one member of it.'] as const;
const JSON_ROUTE = [`Test the whole value's presence with`, 'and filter that field.'] as const;
const SCALAR_ROUTE = ["Compare '", '{ "$eq": VALUE } }).'] as const;

/** The refusal a client reads: status, code, the bounded `error` text, and the full message. */
function clientReads(fn: () => unknown): { status: number; code: unknown; text: string; full: string } {
  let thrown: unknown;
  try { fn(); } catch (e) { thrown = e; }
  expect(thrown, 'the door refused').toBeInstanceOf(Error);
  const { status, body } = mapDataError(thrown);
  return { status, code: body.code, text: String(body.error), full: (thrown as Error).message };
}

/** The route is whole in what the client reads, ends MARGIN inside the cut, and precedes "NOT applied". */
function expectRouteInside(fn: () => unknown, [open, close]: readonly [string, string]): void {
  const read = clientReads(fn);
  expect(read.status).toBe(400);
  expect(read.code).toBe('INVALID_FILTER');
  const start = read.full.indexOf(open);
  expect(start, read.full).toBeGreaterThan(0);
  const closeAt = read.full.indexOf(close, start);
  expect(closeAt, read.full).toBeGreaterThan(start);
  const end = closeAt + close.length;
  expect(read.text, 'the client text holds the whole route').toContain(read.full.slice(start, end));
  expect(end, `the route ends at ${end}, within ${MARGIN} of the ${CLIENT_CUT}-character cut`)
    .toBeLessThanOrEqual(CLIENT_CUT - MARGIN);
  const notApplied = read.full.indexOf(' was NOT applied');
  expect(notApplied, read.full).toBeGreaterThan(end - 1);
}

const nested = (field: string) => ({ $and: [{ contract_value_amount: 1 }, { $or: [{ [field]: NESTED_OBJECT }] }] });

const aggregationFilter = (field: string) => () =>
  narrowNumberComparands(OBJECT, 'aggregate', SCHEMA, nested(field), 'aggregations[1].filter');

const having = (field: string, type: string) => () =>
  narrowHavingNumberComparands(OBJECT, { [field]: NESTED_OBJECT }, new Map(), new Map([[field, type]]));

describe('[#27337] the no-operator-object refusal: every route lands inside the client cap', () => {
  it('a single-valued lookup — aggregations[i].filter and having', () => {
    expectRouteInside(aggregationFilter('primary_account_owner'), SINGLE_LOOKUP_ROUTE);
    expectRouteInside(having('primary_account_owner', 'lookup'), SINGLE_LOOKUP_ROUTE);
  });

  it('a multi-valued lookup — aggregations[i].filter', () => {
    expectRouteInside(aggregationFilter('secondary_account_owners'), MULTI_LOOKUP_ROUTE);
  });

  it('a json and an address field — where, aggregations[i].filter and having', () => {
    for (const [field, type] of [['integration_metadata', 'json'], ['shipping_destination', 'address']] as const) {
      expectRouteInside(() => narrowNumberComparands(OBJECT, 'find', SCHEMA, nested(field)), JSON_ROUTE);
      expectRouteInside(aggregationFilter(field), JSON_ROUTE);
      expectRouteInside(having(field, type), JSON_ROUTE);
    }
  });

  it('a scalar field — where, aggregations[i].filter and having', () => {
    expectRouteInside(() => narrowNumberComparands(OBJECT, 'find', SCHEMA, nested('contract_value_amount')), SCALAR_ROUTE);
    expectRouteInside(aggregationFilter('contract_value_amount'), SCALAR_ROUTE);
    expectRouteInside(having('contract_value_amount', 'number'), SCALAR_ROUTE);
  });
});

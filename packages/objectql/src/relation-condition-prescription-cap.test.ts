// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27351] The nested-relation condition refusal at `where` states what to
 * write instead INSIDE the 500 characters a client reads, for every reason it
 * refuses a condition.
 *
 * The cap stays: `mapDataError` (`@objectstack/types`) cuts a 4xx message at
 * `CLIENT_MESSAGE_MAX` with `…`. So `relation-filter-lowering.ts` orders each
 * reason's words head, the short reason, the route, then "NOT applied" and any
 * reasoning, and this file reads every reason the way a client does — through
 * `mapDataError` — and requires the whole route in what survives the cut,
 * ahead of "NOT applied". Run against the words as they stood on `origin/main`
 * `cf218eed1`, the second-level and dotted-key routes are cut on the card's
 * fixture, and every reason's route is cut on the stress fixture.
 *
 * Two fixtures. The card's — a 21-character object, a 21-character field, a
 * 16-character target, three keys, a path through a nested `$and` / `$or` —
 * must end each route {@link MARGIN} characters inside the cut. The stress
 * one — a 27-character object and target, a 32-character field, four 11- to
 * 15-character keys, a three-deep path, single- and multi-valued — must keep
 * each route whole inside the cut.
 */

import { describe, it, expect } from 'vitest';
import { mapDataError } from '@objectstack/types';
import { narrowNumberComparands } from './number-comparand-declared-type-door.js';

/** The characters a client reads before the `…`: `CLIENT_MESSAGE_MAX - 1`. */
const CLIENT_CUT = 499;
/** How far inside the cut every route on the card's fixture must end. */
const MARGIN = 40;

interface Fixture {
  readonly object: string;
  readonly target: string;
  readonly field: string;
  readonly keys: readonly string[];
  readonly multiple: boolean;
  /** Wraps the condition in the fixture's path. */
  readonly wrap: (field: string, condition: unknown) => unknown;
  /** The latest a route may end. */
  readonly limit: number;
}

const CARD: Fixture = {
  object: 'customer_support_case',
  target: 'customer_account',
  field: 'primary_account_owner',
  keys: ['region', 'tier', 'status'],
  multiple: false,
  wrap: (field, condition) => ({ $and: [{ amount: 1 }, { $or: [{ [field]: condition }] }] }),
  limit: CLIENT_CUT - MARGIN,
};

const STRESS: Fixture = {
  object: 'customer_support_case_entry',
  target: 'enterprise_customer_account',
  field: 'primary_customer_account_manager',
  keys: ['region_code', 'service_tier', 'account_status', 'billing_country'],
  multiple: false,
  wrap: (field, condition) => ({
    $and: [{ amount: 1 }, { $or: [{ $and: [{ amount: 2 }, { [field]: condition }] }] }],
  }),
  limit: CLIENT_CUT,
};

const STRESS_MULTI: Fixture = { ...STRESS, multiple: true };

/** The opening and the closing words of each reason's route. */
function routes(f: Fixture): Record<string, readonly [string, string]> {
  const ids = f.multiple ? '"$contains": ID } }, one per id.' : '"$in": [ID, …] } }.';
  return {
    secondLevel: [`Read '${f.target}' with { "parent_account": { … } }`, ids],
    dottedKey: [`Read '${f.target}' with that condition`, ids],
    empty: ['Name one (', '"$null": false } }.'],
    undeclaredKey: ['Name a field it declares', '"FIELD": VALUE } }.'],
    unregistered: ['Match ', ids],
  };
}

/** The refusal a client reads: status, code, the bounded `error` text, and the full message. */
function clientReads(fn: () => unknown): { status: number; code: unknown; text: string; full: string } {
  let thrown: unknown;
  try { fn(); } catch (e) { thrown = e; }
  expect(thrown, 'the door refused').toBeInstanceOf(Error);
  const { status, body } = mapDataError(thrown);
  return { status, code: body.code, text: String(body.error), full: (thrown as Error).message };
}

/** The route is whole in what the client reads, ends by the fixture's limit, and precedes "NOT applied". */
function expectRouteInside(f: Fixture, fn: () => unknown, [open, close]: readonly [string, string]): void {
  const read = clientReads(fn);
  expect(read.status).toBe(400);
  expect(read.code).toBe('INVALID_FILTER');
  const start = read.full.indexOf(open);
  expect(start, read.full).toBeGreaterThan(0);
  const closeAt = read.full.indexOf(close, start);
  expect(closeAt, read.full).toBeGreaterThan(start);
  const end = closeAt + close.length;
  expect(read.text, 'the client text holds the whole route').toContain(read.full.slice(start, end));
  expect(end, `the route ends at ${end}; the limit is ${f.limit}`).toBeLessThanOrEqual(f.limit);
  const notApplied = read.full.indexOf(' was NOT applied');
  expect(notApplied, read.full).toBeGreaterThan(end - 1);
}

/** Refuse `condition` beneath the fixture's relation field, at `where`. */
function refusal(f: Fixture, condition: Record<string, unknown>, registered = true) {
  const related = {
    fields: {
      ...Object.fromEntries(f.keys.map((key) => [key, { name: key, type: 'text' }])),
      parent_account: { name: 'parent_account', type: 'lookup', reference: f.target },
    },
  };
  const schema = {
    fields: {
      [f.field]: { name: f.field, type: 'lookup', reference: f.target, ...(f.multiple ? { multiple: true } : {}) },
      amount: { name: 'amount', type: 'number' },
    },
  };
  const schemaOf = (name: string) => (registered && name === f.target ? related : undefined);
  return () => narrowNumberComparands(f.object, 'find', schema, f.wrap(f.field, condition), 'where', { schemaOf });
}

const conditionOf = (f: Fixture) => Object.fromEntries(f.keys.map((key) => [key, 'x']));

describe('[#27351] the nested-relation condition refusal: every route lands inside the client cap', () => {
  for (const [label, f] of [['the card', CARD], ['stress, single-valued', STRESS], ['stress, multi-valued', STRESS_MULTI]] as const) {
    describe(label, () => {
      const route = routes(f);
      const condition = conditionOf(f);

      it('a second-level relation', () => {
        expectRouteInside(f, refusal(f, { ...condition, parent_account: { [f.keys[0]]: 'x' } }), route.secondLevel);
      });

      it('a dotted key', () => {
        expectRouteInside(f, refusal(f, { ...condition, 'parent_account.name': 'x' }), route.dottedKey);
      });

      it('an empty condition', () => {
        expectRouteInside(f, refusal(f, {}), route.empty);
      });

      it('a key the related object does not declare', () => {
        expectRouteInside(f, refusal(f, { ...condition, regio: 'x' }), route.undeclaredKey);
      });

      it('a related object not registered here', () => {
        expectRouteInside(f, refusal(f, condition, false), route.unregistered);
      });
    });
  }
});

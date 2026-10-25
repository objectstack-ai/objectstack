/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Empty-criteria guard for the sharing-rule criteria builder
 * (objectstack#3896).
 *
 * This widget used to tell an admin that an empty criteria meant "All
 * records" — the most dangerous thing it could say, because it was describing
 * a bug as a feature. A sharing rule with no predicate was stored as
 * `criteria_json: null` and then evaluated as `find(object, { filter: {} })`,
 * i.e. every record of the object granted to the recipient. `SharingRuleSchema`
 * had always forbidden that shape ("never seeded as a permissive match-all",
 * ADR-0049); the REST and data-API entries just never checked.
 *
 * The server now refuses to save such a rule and shares nothing for one
 * already stored. These tests pin the client-side mirror of that predicate, so
 * the widget warns while the admin is still looking at the empty builder
 * rather than after a rejected save.
 */
import { describe, it, expect } from 'vitest';
import { isMatchAllCriteria } from '../FilterConditionField';

describe('isMatchAllCriteria — shapes that would share every record', () => {
  it('flags the empty and vacuous shapes', () => {
    for (const shape of [
      undefined,
      null,
      {},           // what a blank builder / blank textarea parses to
      [],
      true,
      42,
      { $and: [] },
      { $or: [] },
      { $and: [{}] },
      { $or: [{ stage: 'won' }, {}] }, // one unconstrained branch opens the OR
    ]) {
      expect(isMatchAllCriteria(shape), `${JSON.stringify(shape) ?? String(shape)}`).toBe(true);
    }
  });

  it('passes anything that actually narrows the result set', () => {
    for (const shape of [
      { stage: 'won' },
      { amount: { $gte: 100000 } },
      [{ stage: 'won' }],
      { $and: [{ stage: 'won' }] },
      { $or: [{ a: 1 }, { b: 2 }] },
      { health: 'red', budget: { $gt: 1 } },
    ]) {
      expect(isMatchAllCriteria(shape), JSON.stringify(shape)).toBe(false);
    }
  });

  it('agrees with the server on the reported case: a rule saved with no criteria', () => {
    // The builder emits '' for an empty group, which the widget parses to {}.
    expect(isMatchAllCriteria({})).toBe(true);
    // …and one real condition is enough to clear the gate.
    expect(isMatchAllCriteria({ health: 'red' })).toBe(false);
  });
});

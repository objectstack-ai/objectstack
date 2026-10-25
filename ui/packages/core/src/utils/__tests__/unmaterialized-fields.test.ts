/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3950 — which field types materialise no stored column.
 *
 * The membership decides whether a renderer offers a server sort at all, so it
 * is pinned in both directions: the type that must be in it, and the two
 * neighbours that must never be (a `summary` and an `autonumber` each get a
 * real maintained column and order correctly — withholding their affordance
 * would break sorts that work).
 */
import { describe, it, expect } from 'vitest';
import { COMPUTED_VALUE_TYPES, SEARCH_VIRTUAL_TYPES } from '@objectstack/spec/data';

import { UNMATERIALIZED_FIELD_TYPES, isUnmaterializedFieldType } from '../unmaterialized-fields.js';
import { EXPANDABLE_FIELD_TYPES } from '../expand-fields.js';

describe('UNMATERIALIZED_FIELD_TYPES', () => {
  it('holds `formula` and nothing else', () => {
    expect([...UNMATERIALIZED_FIELD_TYPES]).toEqual(['formula']);
  });

  /**
   * Reference identity, not value equality: a faithful copy passes every value
   * comparison on the day it is written and drifts silently afterwards, which
   * is exactly the failure this set is bound to the platform to avoid.
   */
  it('IS the spec-side set rather than a copy of it', () => {
    expect(UNMATERIALIZED_FIELD_TYPES).toBe(SEARCH_VIRTUAL_TYPES);
  });

  /**
   * The mis-widening trap. `COMPUTED_VALUE_TYPES` is the WRITE contract
   * ("never client-written") and holds three types; only one of them lacks a
   * column. Reading the write contract here would withhold the sort affordance
   * from `summary` and `autonumber`, both of which the server orders by fine.
   */
  it('is narrower than the write contract — `summary` and `autonumber` still sort', () => {
    expect([...COMPUTED_VALUE_TYPES]).toEqual(expect.arrayContaining(['summary', 'autonumber']));
    expect(isUnmaterializedFieldType({ type: 'summary' })).toBe(false);
    expect(isUnmaterializedFieldType({ type: 'autonumber' })).toBe(false);
  });

  /**
   * The two reasons a server sort is withheld must stay separate families: a
   * type in both would make one of the consumer branches unreachable, and the
   * remedy each reason points at is different (order by the id vs. denormalise
   * onto a stored column).
   */
  it('is disjoint from the reference-bearing family', () => {
    for (const type of UNMATERIALIZED_FIELD_TYPES) {
      expect(EXPANDABLE_FIELD_TYPES.has(type), `'${type}' overlaps EXPANDABLE_FIELD_TYPES`).toBe(false);
    }
  });
});

describe('isUnmaterializedFieldType', () => {
  it('answers for the unmaterialized type', () => {
    expect(isUnmaterializedFieldType({ type: 'formula' })).toBe(true);
  });

  it('leaves stored types alone', () => {
    for (const type of ['text', 'number', 'currency', 'percent', 'date', 'select', 'boolean']) {
      expect(isUnmaterializedFieldType({ type }), type).toBe(false);
    }
  });

  it('reads only `type`, so any resolved field-metadata shape answers', () => {
    expect(isUnmaterializedFieldType({ type: 'formula', label: 'Expected Revenue', expression: 'a * b' })).toBe(true);
  });

  it('treats an unreadable definition as no verdict', () => {
    expect(isUnmaterializedFieldType(null)).toBe(false);
    expect(isUnmaterializedFieldType(undefined)).toBe(false);
    expect(isUnmaterializedFieldType({})).toBe(false);
    // A bare type STRING is not a field definition — the same answer
    // `isExpandableFieldType` gives, so the two read alike at call sites.
    expect(isUnmaterializedFieldType('formula')).toBe(false);
  });
});

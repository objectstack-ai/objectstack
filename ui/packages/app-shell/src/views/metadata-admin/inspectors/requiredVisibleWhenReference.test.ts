// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The classifier behind the field inspector's advisory for a `required` field
 * whose own `visibleWhen` reads through a reference (ADR-0113 D1, as amended):
 * the server cannot evaluate such a predicate, counts the field as shown, and
 * keeps it required where the form hides it.
 *
 * Reads are found by the REAL `@objectstack/formula` analysis, the export the
 * module loads lazily at runtime and the one the server and the lint use.
 */

import { describe, it, expect } from 'vitest';
import { analyzeRelationshipTraversals } from '@objectstack/formula';
import {
  predicateSource,
  referenceReadsInRequiredVisibleWhen,
  type TraversalReader,
} from './requiredVisibleWhenReference';

const read: TraversalReader = (source, root) => analyzeRelationshipTraversals(source, root)?.traversals ?? null;

const TYPES = { account: 'lookup', parent_deal: 'master_detail', status: 'text', ship_to: 'address' };

const reads = (def: Record<string, unknown>) => referenceReadsInRequiredVisibleWhen(def, TYPES, read);

describe('requiredVisibleWhenReference — the advisory (ADR-0113 D1, as amended)', () => {
  it('names the reference a required field\'s visibleWhen reads through', () => {
    expect(reads({ required: true, visibleWhen: "record.account.tier == 'vip'" })).toEqual(['account']);
  });

  it('reads the envelope spelling and `previous`, and names each reference once', () => {
    expect(reads({
      required: true,
      visibleWhen: { dialect: 'cel', source: "previous.parent_deal.stage == 'won' || record.account.tier == 'vip' || record.account.region == 'cn'" },
    })).toEqual(['account', 'parent_deal']);
  });

  it('draws nothing for a field that is not required — visibleWhen is display only there', () => {
    expect(reads({ visibleWhen: "record.account.tier == 'vip'" })).toEqual([]);
  });

  it('draws nothing for the record\'s own columns, or for an object-valued field', () => {
    expect(reads({ required: true, visibleWhen: "record.status == 'open'" })).toEqual([]);
    expect(reads({ required: true, visibleWhen: "record.ship_to.city == 'Paris'" })).toEqual([]);
  });

  it('draws nothing for a predicate that does not parse, or a non-CEL envelope', () => {
    expect(reads({ required: true, visibleWhen: 'record.account.' })).toEqual([]);
    expect(reads({ required: true, visibleWhen: { dialect: 'js', source: 'record.account.tier' } })).toEqual([]);
    expect(predicateSource('   ')).toBeNull();
  });
});

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
import { analyzeRelationshipTraversals, parseCelToAst } from '@objectstack/formula';
import {
  callsReceiverMethod,
  formulaReadsInRequiredVisibleWhen,
  predicateSource,
  referenceReadsInRequiredVisibleWhen,
  type FieldReader,
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

const readFields: FieldReader = (source, root) => {
  const a = analyzeRelationshipTraversals(source, root);
  return a ? { bare: a.bareFields, through: new Set(a.traversals.keys()) } : null;
};
const callsCan = (source: string) => callsReceiverMethod(parseCelToAst(source), 'can');

const SIBLINGS: Record<string, Record<string, unknown>> = {
  account: { type: 'lookup', reference: 'account' },
  amount: { type: 'number' },
  stage: { type: 'select' },
  risk: { type: 'formula', expression: "record.amount > 100 ? 'high' : 'low'" },
  tier_name: { type: 'formula', expression: 'record.account.tier' },
  tier_risk: { type: 'formula', expression: "record.tier_name == 'gold' ? 'high' : 'low'" },
  stage_label: { type: 'formula', expression: 'label(record.stage)' },
  can_edit: { type: 'formula', expression: "current_user.can('account', 'edit')" },
};

const formulaReads = (def: Record<string, unknown>) => formulaReadsInRequiredVisibleWhen(def, SIBLINGS, readFields, callsCan);

describe('requiredVisibleWhenReference — the formula advisory (ADR-0113 D1, as amended)', () => {
  it('names a formula a required field\'s visibleWhen reads; one the server computes is not unservable', () => {
    expect(formulaReads({ required: true, visibleWhen: "record.risk == 'high'" })).toEqual({ formulas: ['risk'], unservable: [] });
  });

  it('marks a formula over a formula that reads through a reference, at any depth', () => {
    expect(formulaReads({ required: true, visibleWhen: "record.tier_risk == 'high'" }))
      .toEqual({ formulas: ['tier_risk'], unservable: ['tier_risk'] });
  });

  it('marks a formula that calls label() or current_user.can()', () => {
    expect(formulaReads({ required: true, visibleWhen: "record.stage_label == 'Won' || record.can_edit" }))
      .toEqual({ formulas: ['stage_label', 'can_edit'], unservable: ['stage_label', 'can_edit'] });
  });

  it('draws nothing for a field that is not required, or a predicate reading no formula', () => {
    expect(formulaReads({ visibleWhen: "record.risk == 'high'" })).toEqual({ formulas: [], unservable: [] });
    expect(formulaReads({ required: true, visibleWhen: 'record.amount > 5' })).toEqual({ formulas: [], unservable: [] });
  });
});

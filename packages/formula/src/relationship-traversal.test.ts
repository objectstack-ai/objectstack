// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import {
  analyzeRelationshipTraversals,
  findTraversalConflicts,
} from './relationship-traversal';

/** Shorthand: the related fields named on one FK, as a sorted array. */
const hop = (source: string, field: string): string[] => {
  const a = analyzeRelationshipTraversals(source);
  return [...(a?.traversals.get(field) ?? [])].sort();
};

const bare = (source: string): string[] => {
  const a = analyzeRelationshipTraversals(source);
  return [...(a?.bareFields ?? [])].sort();
};

const isLookup = (f: string): boolean => f === 'crm_account' || f === 'owner';

describe('analyzeRelationshipTraversals — which hops an expression names', () => {
  it('names the related field behind a one-hop read', () => {
    expect(hop("record.crm_account.type == 'partner'", 'crm_account')).toEqual(['type']);
  });

  it('collects every related field named on the same FK', () => {
    const source = "record.crm_account.type == 'partner' && record.crm_account.tier > 2";
    expect(hop(source, 'crm_account')).toEqual(['tier', 'type']);
  });

  it('separates two different FKs', () => {
    const source = "record.crm_account.type == 'partner' && record.owner.email != ''";
    expect(hop(source, 'crm_account')).toEqual(['type']);
    expect(hop(source, 'owner')).toEqual(['email']);
  });

  it('reports a plain field read as BARE, not as a traversal', () => {
    const a = analyzeRelationshipTraversals("record.amount > 100");
    expect(a?.traversals.size).toBe(0);
    expect(bare('record.amount > 100')).toEqual(['amount']);
  });

  it('a traversed FK is NOT also reported bare when only traversed', () => {
    expect(bare("record.crm_account.type == 'partner'")).toEqual([]);
  });

  it('reports a FK that is BOTH traversed and used as a value', () => {
    const source = "record.crm_account.type == 'partner' && record.crm_account == 'acc_1'";
    expect(hop(source, 'crm_account')).toEqual(['type']);
    expect(bare(source)).toEqual(['crm_account']);
  });

  // A method receiver is a VALUE use: `startsWith` reads the string, it does
  // not read through a relationship. Mistaking it for a hop would make the
  // engine preload a field that is not a reference at all.
  it('treats a method receiver as a value, not a hop', () => {
    const source = "record.name.startsWith('A')";
    expect(analyzeRelationshipTraversals(source)?.traversals.size).toBe(0);
    expect(bare(source)).toEqual(['name']);
  });

  it('sees through a function argument', () => {
    expect(hop("has(record.crm_account.type)", 'crm_account')).toEqual(['type']);
  });

  it('sees through both arms of a ternary and of a disjunction', () => {
    expect(hop("record.flag ? record.crm_account.type : 'x'", 'crm_account')).toEqual(['type']);
    expect(hop("record.a == 1 || record.crm_account.tier > 2", 'crm_account')).toEqual(['tier']);
  });

  it('flags a read deeper than one hop, attributed to the first field', () => {
    const a = analyzeRelationshipTraversals('record.crm_account.owner.email != null');
    expect([...(a?.multiHopFields ?? [])]).toEqual(['crm_account']);
  });

  it('only reads the root it was asked about', () => {
    const source = "previous.crm_account.type == 'partner'";
    expect(analyzeRelationshipTraversals(source)?.traversals.size).toBe(0);
    expect(hop(source.replace('previous', 'record'), 'crm_account')).toEqual(['type']);
    expect([...(analyzeRelationshipTraversals(source, 'previous')?.traversals.keys() ?? [])])
      .toEqual(['crm_account']);
  });

  // The caller already reports parse faults; this returns null rather than
  // inventing a second verdict channel for the same failure.
  it('returns null for a source that does not parse', () => {
    expect(analyzeRelationshipTraversals('record.stage ==')).toBeNull();
    expect(analyzeRelationshipTraversals('')).toBeNull();
  });
});

describe('findTraversalConflicts — what the authoring layer refuses', () => {
  it('refuses a FK that is both traversed and compared bare', () => {
    const a = analyzeRelationshipTraversals(
      "record.crm_account.type == 'partner' && record.crm_account == 'acc_1'",
    )!;
    const conflicts = findTraversalConflicts(a, isLookup);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('bare-and-traversed');
    expect(conflicts[0].field).toBe('crm_account');
    // The prescription must name the repair, or the refusal is a dead end.
    expect(conflicts[0].message).toContain('record.crm_account.id');
  });

  // The short-circuit form is the one shape that can evaluate today for SOME
  // rows (the traversal is skipped when the left arm decides the verdict) and
  // fault for others. It is refused for that reason, not despite it.
  it('refuses the short-circuit form too', () => {
    const a = analyzeRelationshipTraversals(
      "record.crm_account == 'acc_1' || record.crm_account.type == 'partner'",
    )!;
    expect(findTraversalConflicts(a, isLookup)).toHaveLength(1);
  });

  it('refuses a read deeper than one hop', () => {
    const a = analyzeRelationshipTraversals('record.crm_account.owner.email != null')!;
    const conflicts = findTraversalConflicts(a, isLookup);
    expect(conflicts.some((c) => c.kind === 'multi-hop')).toBe(true);
  });

  // The whole point of taking a predicate rather than a field list: a
  // non-reference object-valued field traverses today and must keep doing so.
  it('leaves a NON-reference field entirely alone', () => {
    const a = analyzeRelationshipTraversals(
      "record.address.city == 'SF' && record.address != null",
    )!;
    expect(findTraversalConflicts(a, isLookup)).toEqual([]);
  });

  it('accepts the plain traversal — the shape this capability exists to serve', () => {
    const a = analyzeRelationshipTraversals("record.crm_account.type == 'partner'")!;
    expect(findTraversalConflicts(a, isLookup)).toEqual([]);
  });

  it('accepts a bare FK comparison on its own', () => {
    const a = analyzeRelationshipTraversals("record.crm_account == 'acc_1'")!;
    expect(findTraversalConflicts(a, isLookup)).toEqual([]);
  });
});

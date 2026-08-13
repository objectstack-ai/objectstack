// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8220] Filter-subtree provenance — the mark's declared semantics, pinned
 * where they are declared.
 *
 * The one property everything here defends is the FAIL DIRECTION: unmarked or
 * ambiguous answers `null`, and `null` withholds. Every degraded shape — a
 * frozen subtree, a serialized round-trip, a corrupted mark value, a rewritten
 * tree, an aliased node under conflicting arms — must land on `null`, never on
 * `'author'`.
 */

import { describe, it, expect } from 'vitest';

import {
  FILTER_SUBTREE_PROVENANCE,
  filterSubtreeProvenanceOf,
  markFilterSubtreeProvenance,
  resolveFilterSubtreeProvenance,
} from './filter-subtree-provenance';

describe('markFilterSubtreeProvenance / filterSubtreeProvenanceOf', () => {
  it('marks a subtree in place, invisibly to enumeration and JSON', () => {
    const subtree = { amount: { $gt: { $field: 'budget' } } };
    const returned = markFilterSubtreeProvenance(subtree, 'author');
    expect(returned).toBe(subtree);
    expect(filterSubtreeProvenanceOf(subtree)).toBe('author');
    // The mark must not change what any schema or serializer sees.
    expect(Object.keys(subtree)).toEqual(['amount']);
    expect(JSON.stringify(subtree)).toBe('{"amount":{"$gt":{"$field":"budget"}}}');
  });

  it('the global-registry symbol is the declared key', () => {
    const subtree = markFilterSubtreeProvenance({ a: 1 }, 'policy');
    expect((subtree as Record<symbol, unknown>)[Symbol.for('objectstack.filter.subtreeProvenance')]).toBe('policy');
    expect(FILTER_SUBTREE_PROVENANCE).toBe(Symbol.for('objectstack.filter.subtreeProvenance'));
  });

  it('first mark wins — a later actor cannot flip a policy subtree to author', () => {
    const scope = markFilterSubtreeProvenance({ organization_id: 'org_1' }, 'policy');
    markFilterSubtreeProvenance(scope, 'author');
    expect(filterSubtreeProvenanceOf(scope)).toBe('policy');
  });

  it('a frozen subtree stays unmarked (withheld), and the boundary does not throw', () => {
    const frozen = Object.freeze({ stage: 'won' });
    expect(() => markFilterSubtreeProvenance(frozen, 'author')).not.toThrow();
    expect(filterSubtreeProvenanceOf(frozen)).toBe(null);
  });

  it('non-object subtrees and undeclared mark values degrade to unmarked', () => {
    expect(markFilterSubtreeProvenance(null, 'author')).toBe(null);
    expect(filterSubtreeProvenanceOf(null)).toBe(null);
    expect(filterSubtreeProvenanceOf('author')).toBe(null);
    const corrupted: Record<symbol, unknown> = {};
    corrupted[FILTER_SUBTREE_PROVENANCE] = 'administrator'; // not a declared literal
    expect(filterSubtreeProvenanceOf(corrupted)).toBe(null);
    const wrongPolarity = markFilterSubtreeProvenance({}, 'administrator' as never);
    expect(filterSubtreeProvenanceOf(wrongPolarity)).toBe(null);
  });

  it('a serialization round-trip DROPS the mark — the wire cannot smuggle a vouch', () => {
    const marked = markFilterSubtreeProvenance({ amount: { $gt: 5 } }, 'author');
    const roundTripped = JSON.parse(JSON.stringify(marked));
    expect(filterSubtreeProvenanceOf(roundTripped)).toBe(null);
  });
});

describe('resolveFilterSubtreeProvenance', () => {
  /** The exact shape both merge boundaries produce. */
  const merged = () => {
    const authorWhere = markFilterSubtreeProvenance(
      { amount: { $gt: { $field: 'budget' } } },
      'author',
    );
    const scope = markFilterSubtreeProvenance(
      { stage: { $eq: { $field: 'organization_id' } } },
      'policy',
    );
    return { root: { $and: [authorWhere, scope] }, authorWhere, scope };
  };

  it('a node inside the author arm resolves author; inside the policy arm, policy', () => {
    const { root, authorWhere, scope } = merged();
    const authorComparand = (authorWhere.amount as Record<string, unknown>).$gt;
    const policyComparand = (scope.stage as Record<string, unknown>).$eq;
    expect(resolveFilterSubtreeProvenance(root, authorComparand as object)).toBe('author');
    expect(resolveFilterSubtreeProvenance(root, policyComparand as object)).toBe('policy');
    // The arms themselves answer their own marks.
    expect(resolveFilterSubtreeProvenance(root, authorWhere)).toBe('author');
    expect(resolveFilterSubtreeProvenance(root, scope)).toBe('policy');
  });

  it('the INNERMOST mark wins — policy nested under a vouched author root stays policy', () => {
    const scope = markFilterSubtreeProvenance({ secret: { $eq: 1 } }, 'policy');
    const root = markFilterSubtreeProvenance({ $and: [{ stage: 'won' }, scope] }, 'author');
    expect(resolveFilterSubtreeProvenance(root, scope.secret as object)).toBe('policy');
    // …while the sibling arm inherits the root's vouch.
    const authorArm = (root.$and as object[])[0] as { stage: unknown };
    expect(resolveFilterSubtreeProvenance(root, authorArm)).toBe('author');
  });

  it('an unmarked tree resolves null — no boundary ever vouched, so withheld', () => {
    const root = { $and: [{ amount: { $gt: { $field: 'budget' } } }] };
    const node = (root.$and[0] as { amount: Record<string, unknown> }).amount.$gt;
    expect(resolveFilterSubtreeProvenance(root, node as object)).toBe(null);
  });

  it('a node NOT reachable from the root resolves null — a rewritten tree cannot disclose', () => {
    const { root } = merged();
    const rewrittenCopy = { $field: 'budget' }; // structurally equal, different identity
    expect(resolveFilterSubtreeProvenance(root, rewrittenCopy)).toBe(null);
  });

  it('a node aliased into arms with CONFLICTING effective marks resolves null (ambiguous)', () => {
    const shared = { amount: { $gt: { $field: 'budget' } } };
    const root = {
      $and: [
        markFilterSubtreeProvenance({ $and: [shared] }, 'author'),
        markFilterSubtreeProvenance({ $or: [shared] }, 'policy'),
      ],
    };
    expect(resolveFilterSubtreeProvenance(root, shared)).toBe(null);
  });

  it('a node aliased into arms that AGREE resolves that agreement', () => {
    const shared = { amount: { $gt: 1 } };
    const root = {
      $and: [
        markFilterSubtreeProvenance({ $and: [shared] }, 'author'),
        markFilterSubtreeProvenance({ $or: [shared] }, 'author'),
      ],
    };
    expect(resolveFilterSubtreeProvenance(root, shared)).toBe('author');
  });

  it('terminates on cyclic input and answers for what it could reach', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const target = markFilterSubtreeProvenance({ b: 2 }, 'author');
    const root = { $and: [cyclic, target] };
    expect(resolveFilterSubtreeProvenance(root, target)).toBe('author');
    expect(resolveFilterSubtreeProvenance(root, { never: 'seen' })).toBe(null);
  });

  it('does not walk into non-plain objects — a Date comparand holds no subtree', () => {
    const target = { $gt: 1 };
    const root = { when: new Date(0), nested: { target } };
    expect(resolveFilterSubtreeProvenance(root, target)).toBe(null); // unmarked path
    const markedRoot = markFilterSubtreeProvenance(root, 'author');
    expect(resolveFilterSubtreeProvenance(markedRoot, target)).toBe('author');
  });

  it('degrades to null on non-object root or target', () => {
    expect(resolveFilterSubtreeProvenance(null, {})).toBe(null);
    expect(resolveFilterSubtreeProvenance({}, null)).toBe(null);
    expect(resolveFilterSubtreeProvenance('root' as never, {})).toBe(null);
  });
});

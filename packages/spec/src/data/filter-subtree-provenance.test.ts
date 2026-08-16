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
 *
 * [#8836] The last block pins the one shape that does NOT land there — a
 * vouchable filter object reused across requests — and the caller-side
 * invariant that keeps it out of reach. Grep for "may outlive the request".
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

/**
 * [#8836, from the #8794 survey] The invariant the fail-closed direction
 * silently depends on, made executable:
 *
 * > no filter object that can be vouched `'author'` may outlive the request
 * > that vouched it.
 *
 * ⚠️ **These tests assert what IS, not what SHOULD BE.** The mark's mechanism
 * is #8220's and is deliberately untouched here: first-mark-wins, the
 * non-writable symbol, and positional resolution all stay exactly as declared.
 * What this block pins is the COST of breaking the invariant — the disclosure a
 * reused vouchable object produces, measured against the control that makes the
 * measurement mean something. `packages/spec` cannot enforce the invariant
 * itself: "the request" is not a concept this module can see, and the callers
 * that must honour it live in `plugin-security` / `plugin-sharing`
 * (`markFilterSubtreeProvenance(…, 'author')` is reachable only on
 * `options.where` itself or on the arms of a pure `$and` root). So the guard
 * this block can offer is that the consequence stays visible and stays
 * asserted: a future change that makes any expectation below go red is a
 * change to the mark's mechanism, which #8794's ruling routes to a spec-seat
 * ruling BEFORE implementation — not something to fix by editing these
 * numbers.
 */
describe("invariant: no filter object that can be vouched 'author' may outlive the request that vouched it", () => {
  /**
   * The identity vouch both read-scope merge boundaries perform, reduced to the
   * decision that matters: `options.where` is stamped `'author'` only while the
   * AST still holds that exact object. Written out rather than imported because
   * `packages/spec` sits UNDER both plugins — the real sites are
   * `plugin-security`'s CRUD injection and `plugin-sharing`'s read-filter merge,
   * and the survey measured both. Nothing here is a stand-in for behaviour under
   * test; the subject is this module's exports.
   */
  const vouchCallerWhere = (ast: { where: unknown }, options: { where: object }): void => {
    if (ast.where !== options.where) return; // re-shaped between the two: no vouch
    markFilterSubtreeProvenance(options.where, 'author');
  };

  /**
   * One request. `composeScope` is the ordinary case where a sibling middleware
   * (or ADR-0061 search expansion) ANDs its own predicate into the AST BEFORE
   * the vouch runs, so this request's boundary no longer recognises the caller's
   * object and vouches nothing at all.
   */
  const runRequest = (callerWhere: object, opts: { composeScope?: boolean } = {}) => {
    const options = { where: callerWhere };
    const ast: { where: unknown } = { where: options.where };
    if (opts.composeScope) {
      ast.where = {
        $and: [callerWhere, markFilterSubtreeProvenance({ organization_id: 'org_1' }, 'policy')],
      };
    }
    vouchCallerWhere(ast, options);
    return ast;
  };

  it('a vouched filter that OUTLIVES its request discloses under a root the next request never vouched', () => {
    // A module-level constant, a cached scope, view metadata: one object, two requests.
    const reusedWhere = { amount: { $gt: { $field: 'budget' } } };

    // Request 1 — identity holds, so this request's boundary vouches it.
    runRequest(reusedWhere);
    expect(filterSubtreeProvenanceOf(reusedWhere)).toBe('author');

    // Request 2 — a sibling middleware composed first, so this boundary vouches NOTHING.
    const ast = runRequest(reusedWhere, { composeScope: true });
    expect(filterSubtreeProvenanceOf(ast.where)).toBe(null);

    // …and the caller's comparand still answers 'author' — request 1's vouch,
    // spent as a licence to disclose inside request 2. This is the whole cost.
    expect(resolveFilterSubtreeProvenance(ast.where, reusedWhere.amount.$gt)).toBe('author');
  });

  it('CONTROL: the same shape built FRESH per request resolves null in that same position', () => {
    const buildWhere = () => ({ amount: { $gt: { $field: 'budget' } } });

    const first = buildWhere();
    runRequest(first);
    expect(filterSubtreeProvenanceOf(first)).toBe('author'); // the vouch still happens

    // Structurally identical, same position, same middleware — only the object's
    // lifetime differs, and the verdict flips to withheld. That difference is
    // the invariant, and it is the reason the test above is not a tautology.
    const second = buildWhere();
    const ast = runRequest(second, { composeScope: true });
    expect(resolveFilterSubtreeProvenance(ast.where, second.amount.$gt)).toBe(null);
  });

  it('a later boundary cannot repair a stale author mark — the corrective policy stamp is a silent no-op', () => {
    // The mirror of the "first mark wins" case above, and the load-bearing one:
    // there a stale 'policy' mark resisted an 'author' overwrite (fail-closed);
    // here a stale 'author' mark resists the 'policy' correction (fail-open).
    const reused = markFilterSubtreeProvenance({ owner: { $field: 'manager_id' } }, 'author');

    markFilterSubtreeProvenance(reused, 'policy');
    expect(filterSubtreeProvenanceOf(reused)).toBe('author');

    // Nor can a boundary force it: the mark is non-writable and non-configurable.
    expect(() =>
      Object.defineProperty(reused, FILTER_SUBTREE_PROVENANCE, { value: 'policy' }),
    ).toThrow(TypeError);
    expect(filterSubtreeProvenanceOf(reused)).toBe('author');
  });

  it('the asymmetry: reuse degrades a policy mark toward WITHHOLDING and an author mark toward DISCLOSING', () => {
    // Why "the classification of one subtree does not change between requests"
    // is sound for a policy scope and unsound for a caller's `where`: provenance
    // is intrinsic to the first and contextual to the second. Same reuse, same
    // unvouched root, opposite fail direction.
    const unvouchedRoot = (arm: object) => ({ $and: [{ stage: 'won' }, arm] });

    const staleScope = markFilterSubtreeProvenance(
      { organization_id: { $field: 'ctx_org' } },
      'policy',
    );
    expect(
      resolveFilterSubtreeProvenance(unvouchedRoot(staleScope), staleScope.organization_id),
    ).toBe('policy'); // still correct next request, and it can only withhold

    const staleWhere = markFilterSubtreeProvenance({ amount: { $gt: { $field: 'budget' } } }, 'author');
    expect(resolveFilterSubtreeProvenance(unvouchedRoot(staleWhere), staleWhere.amount.$gt)).toBe(
      'author',
    ); // no longer this request's caller, and it DISCLOSES
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8220, A of the #7929 ruling] The analytics merge boundary's half of the
 * filter-subtree provenance mark. `ObjectQLStrategy.withReadScope` is the
 * second of the two boundaries (the first is plugin-security's CRUD
 * injection): it composes `{ $and: [userFilter, scope] }` and is the only
 * frame that knows which arm the caller wrote — so it stamps both.
 *
 *  - the read scope → `'policy'`: the driver's cross-field refusal stays
 *    redacted for it;
 *  - the strategy-built user filter → `'author'`: every name in it came from
 *    the caller's own query (dimensions, measures, `where`, time windows)
 *    through this class's own compilation;
 *  - the FK-expand's internal `idFilter` (resolveFkAttr) stays UNMARKED on
 *    purpose — no author typed it, and unmarked withholds (the fail-closed
 *    invariant).
 *
 * End-to-end through the real REST route and a real driver:
 * `packages/runtime/src/cross-field-refusal-operand-withhold.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { filterSubtreeProvenanceOf } from '@objectstack/spec/data';

import { ObjectQLStrategy } from '../strategies/objectql-strategy';

/** Reach the private merge exactly as `execute()` calls it. */
const withReadScope = (
  filter: Record<string, unknown>,
  getReadScope: unknown,
): Record<string, unknown> | undefined =>
  (new ObjectQLStrategy() as never as {
    withReadScope: (
      objectName: string,
      filter: Record<string, unknown>,
      ctx: unknown,
    ) => Record<string, unknown> | undefined;
  }).withReadScope('deal', filter, { getReadScope });

describe('[#8220] ObjectQLStrategy.withReadScope stamps filter-subtree provenance', () => {
  it("marks the user filter 'author' and the scope 'policy' on the composed $and", () => {
    const userFilter = { stage: 'won' };
    const scope = { amount: { $gt: { $field: 'secret_policy_column' } } };
    const merged = withReadScope(userFilter, () => scope)!;

    expect(merged.$and).toEqual([userFilter, scope]);
    expect((merged.$and as unknown[])[0]).toBe(userFilter);
    expect((merged.$and as unknown[])[1]).toBe(scope);
    expect(filterSubtreeProvenanceOf(userFilter)).toBe('author');
    expect(filterSubtreeProvenanceOf(scope)).toBe('policy');
    // The $and root itself carries no mark — provenance is per-arm.
    expect(filterSubtreeProvenanceOf(merged)).toBe(null);
    // …and the marks are invisible to serialization (nothing rides the wire).
    expect(JSON.stringify(merged)).toBe(
      '{"$and":[{"stage":"won"},{"amount":{"$gt":{"$field":"secret_policy_column"}}}]}',
    );
  });

  it("a scope with no user filter is returned alone, marked 'policy'", () => {
    const scope = { organization_id: 'org-1' };
    const merged = withReadScope({}, () => scope);
    expect(merged).toBe(scope);
    expect(filterSubtreeProvenanceOf(scope)).toBe('policy');
  });

  it("a user filter with no scope is returned alone, marked 'author'", () => {
    const userFilter = { amount: { $gt: { $field: 'budget' } } };
    expect(withReadScope(userFilter, () => null)).toBe(userFilter);
    expect(filterSubtreeProvenanceOf(userFilter)).toBe('author');
    const second = { stage: 'won' };
    expect(withReadScope(second, undefined)).toBe(second);
    expect(filterSubtreeProvenanceOf(second)).toBe('author');
  });

  it('an empty user filter stays undefined — nothing is marked into existence', () => {
    expect(withReadScope({}, undefined)).toBeUndefined();
    expect(withReadScope({}, () => undefined)).toBeUndefined();
  });

  it('a scope already marked keeps its first mark (idempotent across strategies)', () => {
    const scope = { organization_id: 'org-1' };
    withReadScope({}, () => scope);
    withReadScope({}, () => scope);
    expect(filterSubtreeProvenanceOf(scope)).toBe('policy');
  });
});

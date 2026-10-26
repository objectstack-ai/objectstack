// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0141 D5 — a hydrate batch is ordered by its declared dependencies, and a
 * cycle never costs the batch.
 */

import { describe, it, expect } from 'vitest';
import { orderHydrationBatch, type HydrationNode } from './hydration-order.js';
import { declaredDependencyIds } from './artifact-packages.js';

/** One package per node, the `sys_packages` shape. */
const pkg = (id: string, ...declared: string[]): HydrationNode<string> =>
  ({ item: id, label: id, packageIds: [id], declaredIds: declared });

describe('orderHydrationBatch', () => {
  it('registers a parent before the modules that declare it, whatever order the source lists', () => {
    const { ordered, cycles } = orderHydrationBatch([
      pkg('revenue', 'crm'),
      pkg('marketing', 'crm'),
      pkg('crm'),
    ]);
    expect(ordered).toEqual(['crm', 'revenue', 'marketing']);
    expect(cycles).toEqual([]);
  });

  it('keeps source order where no edge decides, and treats a declared id outside the batch as no edge', () => {
    const { ordered } = orderHydrationBatch([pkg('b', 'com.elsewhere'), pkg('a'), pkg('c', 'b')]);
    expect(ordered).toEqual(['b', 'a', 'c']);
  });

  it('resolves a declared id to the node that carries it, and ignores ids declared between packages of one node', () => {
    // An install-local ledger entry is an artifact: one node, several packages.
    const hotcrm: HydrationNode<string> = {
      item: 'hotcrm-entry', label: 'hotcrm', packageIds: ['crm', 'crm.service'], declaredIds: ['crm'],
    };
    const revenue: HydrationNode<string> = {
      item: 'revenue-entry', label: 'revenue', packageIds: ['crm.revenue'], declaredIds: ['crm'],
    };
    const { ordered, cycles } = orderHydrationBatch([revenue, hotcrm]);
    expect(ordered).toEqual(['hotcrm-entry', 'revenue-entry']);
    expect(cycles).toEqual([]);
  });

  it('degrades a cycle to source order for its members, reports it, and keeps sorting the rest — never throws', () => {
    const batch = [
      pkg('late', 'parent'),
      pkg('x', 'y', 'parent'),
      pkg('y', 'x'),
      pkg('parent'),
    ];
    let result: ReturnType<typeof orderHydrationBatch<string>> | undefined;
    expect(() => { result = orderHydrationBatch(batch); }).not.toThrow();
    const { ordered, cycles } = result!;
    expect(cycles).toEqual([['x', 'y']]);
    // Every item still reaches the caller exactly once.
    expect([...ordered].sort()).toEqual(['late', 'parent', 'x', 'y']);
    // The acyclic edge still holds for the cycle's member and for the rest…
    expect(ordered.indexOf('parent')).toBeLessThan(ordered.indexOf('x'));
    expect(ordered.indexOf('parent')).toBeLessThan(ordered.indexOf('late'));
    // …and the cycle's members keep source order among themselves.
    expect(ordered.indexOf('x')).toBeLessThan(ordered.indexOf('y'));
  });

  it('keeps every row when two rows name one id', () => {
    const { ordered } = orderHydrationBatch([pkg('dup'), pkg('dup'), pkg('m', 'dup')]);
    expect(ordered).toEqual(['dup', 'dup', 'm']);
  });
});

describe('declaredDependencyIds', () => {
  it('reads the record spelling only', () => {
    expect(declaredDependencyIds({ dependencies: { a: '^1', b: '2.x' } })).toEqual(['a', 'b']);
    expect(declaredDependencyIds({ dependencies: [{ packageId: 'a', versionRange: '^1' }] })).toEqual([]);
    expect(declaredDependencyIds({ dependencies: null })).toEqual([]);
    expect(declaredDependencyIds({})).toEqual([]);
    expect(declaredDependencyIds(undefined)).toEqual([]);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one closure walk reads a residual owner (ADR-0130 D4: no package
 * record) through the dependencies it declared — epic #31527 child R2, ruled
 * from E6's finding. Every reader of the walk (the save door's write scope,
 * the resolution rule's closure) then sees one closure for it.
 */

import { describe, expect, it } from 'vitest';
import { packageDependencyClosure, packageResolutionClosure, type PackageClosureRegistry } from './package-closure.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const R = 'com.acme.release';
const manifest = (id: string, deps: string[] = []) => ({ manifest: { id, dependencies: Object.fromEntries(deps.map((d) => [d, '*'])) } });

const registryOf = (rows: Array<{ manifest: { id: string } }>, residuals: Record<string, string[]> = {}): PackageClosureRegistry => ({
  getPackage: (id) => rows.find((r) => r.manifest.id === id),
  getAllPackages: () => rows,
  residualOwnerDependenciesOf: (id) => residuals[id],
});

describe('a residual owner\'s declared closure', () => {
  it('is walked like a package\'s, transitively, by both the save door\'s walk and the resolution closure', () => {
    const registry = registryOf([manifest(A, [B]), manifest(B)], { [R]: [A] });
    expect(packageDependencyClosure(R, registry)).toEqual({ packageId: R, dependencies: [A, B] });
    expect([...packageResolutionClosure(registry, R)].sort()).toEqual([A, B]);
  });

  it('an id that is neither a package nor a residual owner still narrows nothing', () => {
    expect(packageDependencyClosure(R, registryOf([manifest(A)]))).toBeUndefined();
    expect(packageResolutionClosure(registryOf([manifest(A)]), R).size).toBe(0);
  });

  it('a package record wins over a residual record of the same id', () => {
    const registry = registryOf([manifest(A)], { [A]: [B] });
    expect(packageDependencyClosure(A, registry)).toEqual({ packageId: A, dependencies: [] });
  });

  it('a registry without the member reads as before', () => {
    const registry: PackageClosureRegistry = { getPackage: () => undefined, getAllPackages: () => [] };
    expect(packageDependencyClosure(R, registry)).toBeUndefined();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The save door's declared dependency closure is the one walk (epic #31527,
 * child R2): `packageDependencyClosure` and the App-pair widening live in
 * `@objectstack/metadata-core` beside the resolution closure the
 * package-scoped rule reads, and this package re-exports them. Pinned by
 * identity, so no second closure can be computed here and still read green.
 */
import { describe, expect, it } from 'vitest';
// The package root reaches `@objectstack/lint` by a dynamic import; pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import * as metadataCore from '@objectstack/metadata-core';
import * as lintRuntime from '@objectstack/lint/runtime';
import { packageDependencyClosure, widenPairClosureToAppMembers } from './protocol-write-package-scope.js';
import * as packageRoot from './index.js';

describe('the save door reads the one closure walk (epic #31527 child R2)', () => {
  it('re-exports `@objectstack/metadata-core`\'s closure and widening, from this module and the package root', () => {
    expect(packageDependencyClosure).toBe(metadataCore.packageDependencyClosure);
    expect(widenPairClosureToAppMembers).toBe(metadataCore.widenPairClosureToAppMembers);
    expect(packageRoot.packageDependencyClosure).toBe(metadataCore.packageDependencyClosure);
  });

  it('the walk under it is the one the runtime authoring gate re-exports', () => {
    expect(lintRuntime.resolvePackageClosure).toBe(metadataCore.resolvePackageClosure);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resolveArtifactPackageOrder`'s ABSENT branch is `undefined` only (#19926,
 * ruling A).
 *
 * `ObjectStackDefinitionSchema.packages` is `z.array(ArtifactPackageSchema)
 * .optional()`, and `.optional()` admits `undefined`, not `null`. So `null` is
 * a present, non-array `packages`: malformed, and refused with the same
 * envelope as `{}`, `0` or `'x'`. The rule is stated once, beside
 * `AssembledPackageBodySchema` (`@objectstack/spec`, `stack.zod.ts`).
 *
 * The resolver's wider behaviour (ordering, the entry gate, duplicates) is
 * pinned where its load path is, in `@objectstack/objectql`'s
 * `artifact-load-path.test.ts`. This file pins the one branch every reader of
 * `packages` inherits from here.
 */

import { describe, it, expect } from 'vitest';
import { resolveArtifactPackageOrder, type ArtifactPackageError } from './artifact-packages';

const manifest = { id: 'com.example.a', name: 'A', version: '1.0.0', type: 'app' };

function refusalOf(artifact: unknown): ArtifactPackageError | undefined {
  try {
    resolveArtifactPackageOrder(artifact);
    return undefined;
  } catch (err) {
    return err as ArtifactPackageError;
  }
}

describe('resolveArtifactPackageOrder — `packages: null` is malformed, not absent', () => {
  it('refuses `packages: null` with INVALID_ARTIFACT_PACKAGES / 422', () => {
    const refused = refusalOf({ manifest, packages: null });
    expect(refused).toBeInstanceOf(Error);
    expect(refused?.code).toBe('INVALID_ARTIFACT_PACKAGES');
    expect(refused?.status).toBe(422);
  });

  it.each([
    ['{}', {}],
    ['0', 0],
    ["'x'", 'x'],
  ])('refuses `packages: %s` with the same envelope — `null` is one of these, not a fourth case', (_label, packages) => {
    const refused = refusalOf({ manifest, packages });
    expect(refused?.code).toBe('INVALID_ARTIFACT_PACKAGES');
    expect(refused?.status).toBe(422);
  });

  it('control: an ABSENT `packages` (no key, or an explicit `undefined`) is the single-package branch, returned by identity', () => {
    const noKey = { manifest };
    const explicitUndefined = { manifest, packages: undefined };
    for (const artifact of [noKey, explicitUndefined]) {
      expect(refusalOf(artifact)).toBeUndefined();
      const resolved = resolveArtifactPackageOrder(artifact);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBe(artifact);
    }
  });

  it('control: an ARRAY `packages` resolves to its bodies, by reference', () => {
    const body = { ...manifest };
    const resolved = resolveArtifactPackageOrder({ packages: [{ manifest: body }] });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBe(body);
    expect(resolveArtifactPackageOrder({ packages: [] })).toEqual([]);
  });
});

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `postureHasOrgWall` ↔ the protocol's `postureEnforcesWall` (objectui#5287).
 *
 * The console decides whether to render organization context — the top bar's
 * read-only current-organization indicator — from a locally spelled predicate
 * rather than from `@objectstack/spec/security`'s exported one. That choice is
 * a measured bundle trade, not a preference: pulling the security subpath into
 * the eager closure costs +237 KB minified even where the whole spec root entry
 * is already present (measured with the repo's esbuild: 1271.8 → 1509.1 KB),
 * because its schema modules are a separate graph and `@objectstack/spec`
 * declares no `sideEffects` for anything to tree-shake against. The rationale
 * lives in `../useTenancyPosture.ts`.
 *
 * What a local copy of a protocol rule normally costs is drift, and this file
 * is where that is paid instead. It is deliberately the ONLY place in the
 * console that imports the spec's predicate — a test is not bundled, so the
 * assertion is free — and it iterates `TENANCY_POSTURES` rather than a list
 * written out here, so a posture ADDED upstream is a failure here too, not a
 * silent `false`. Both directions matter:
 *
 *   - a new walled posture read as unwalled ⇒ the indicator silently stops
 *     rendering for a whole deployment shape, which is the reported defect
 *     coming back;
 *   - `single` ever read as walled ⇒ every single-tenant console grows an
 *     organization name in its top bar.
 */

import { describe, it, expect } from 'vitest';
import { postureEnforcesWall, TENANCY_POSTURES } from '@objectstack/spec/security';
import { postureHasOrgWall } from '../useTenancyPosture';

describe('postureHasOrgWall agrees with the protocol (#5287)', () => {
  it('covers every posture the spec declares', () => {
    // Guards the iteration itself: an empty or one-element list would make
    // every assertion below vacuous.
    expect(TENANCY_POSTURES.length).toBeGreaterThanOrEqual(3);
  });

  it.each([...TENANCY_POSTURES])('matches postureEnforcesWall for %s', (posture) => {
    expect(postureHasOrgWall(posture)).toBe(postureEnforcesWall(posture));
  });

  it('reads an unresolved posture as no wall — the console fails toward org-silent chrome', () => {
    expect(postureHasOrgWall(undefined)).toBe(false);
  });

  it('still discriminates: the walled and unwalled sets are both non-empty', () => {
    const walled = TENANCY_POSTURES.filter((p) => postureHasOrgWall(p));
    expect(walled.length).toBeGreaterThan(0);
    expect(walled.length).toBeLessThan(TENANCY_POSTURES.length);
  });
});

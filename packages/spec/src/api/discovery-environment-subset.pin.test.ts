// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5676] `DiscoverySchema.environment` ⊂ `EnvironmentTypeSchema`.
 *
 * One concept — "which kind of environment is this" — is declared by two enums
 * in this package:
 *
 * | declaration | members |
 * |:---|:---|
 * | `DiscoveryEnvironmentSchema` (`api/discovery.zod.ts`) | `production` `sandbox` `development` |
 * | `EnvironmentTypeSchema` (`cloud/environment.zod.ts`) | those three + `test` `staging` `preview` `trial` |
 *
 * Keeping both is the ruled outcome, not a defect: discovery answers the coarse
 * question ("am I talking to production?") on a machine-readable surface whose
 * consumers `switch` over three values, so widening it would be a breaking
 * change to a RESPONSE enum. #4828 introduced the lossy fold that makes the two
 * co-exist (`resolveDiscoveryEnvironment`: `staging` → `sandbox`, `test` →
 * `development`), and the maintainer's 2026-08-05 ruling requires every producer
 * to land inside the three.
 *
 * What was missing is the thing that makes "subset" a FACT rather than a comment:
 * nothing referenced one enum from the other, so a rename or a removal on the
 * seven-member side would leave the three-member side silently claiming a
 * membership it no longer has. The prose cross-references now run both ways
 * (`discovery.zod.ts`'s `.describe()` since #4828; `environment.zod.ts`'s JSDoc
 * since this pin) — and prose is unassertable, which is what this file is for.
 *
 * ⛔ Scope: this pins the RELATION only. It deliberately does not pin either
 * enum's exact membership — `EnvironmentTypeSchema` is free to grow a new
 * bucket, and a change-detector here would just tax that. What must never
 * happen silently is the three drifting OUT of the seven.
 *
 * Every assertion carries an anti-vacuity guard, because the failure mode of a
 * subset test is passing on an empty left-hand side.
 */

import { describe, it, expect } from 'vitest';

import { EnvironmentTypeSchema } from '../cloud/environment.zod';

import { DiscoveryEnvironmentSchema } from './discovery.zod';

/** `.options` through the `lazySchema` Proxy — read once, asserted below. */
const discoveryMembers = DiscoveryEnvironmentSchema.options as readonly string[];
const environmentMembers = EnvironmentTypeSchema.options as readonly string[];

describe('[#5676] DiscoveryEnvironment ⊂ EnvironmentType', () => {
  it('reads a non-empty membership off both enums (anti-vacuity)', () => {
    // Without this, every `every()` below passes against a broken import.
    expect(Array.isArray(discoveryMembers)).toBe(true);
    expect(Array.isArray(environmentMembers)).toBe(true);
    expect(discoveryMembers.length).toBeGreaterThan(0);
    expect(environmentMembers.length).toBeGreaterThan(discoveryMembers.length);
  });

  it('declares every discovery environment as an EnvironmentType member', () => {
    const missing = discoveryMembers.filter(m => !environmentMembers.includes(m));
    expect(
      missing,
      `${missing.join(', ')} is advertised by DiscoverySchema.environment but is no longer an `
      + 'EnvironmentTypeSchema member. The two describe one concept and discovery is the coarse '
      + 'view of it (#5676) — if a bucket was renamed on the cloud side, rename it here and in '
      + "`NODE_ENV_TO_DISCOVERY_ENVIRONMENT`'s values too, or the fold points at a dead value.",
    ).toEqual([]);
  });

  it('PARSES every discovery environment as an EnvironmentType (not just string equality)', () => {
    // The arrays could agree while the schemas disagree — a refinement, a
    // transform, a branded type. Judge the schema, not its `.options` list.
    for (const member of discoveryMembers) {
      expect(EnvironmentTypeSchema.safeParse(member).success, member).toBe(true);
    }
  });

  it('is a STRICT subset — the extra EnvironmentType buckets are rejected by discovery', () => {
    // The negative control. Without it the test above would still pass if the
    // two enums had been collapsed into one, which is the outcome #4828's
    // ruling declined (widening a response enum breaks 3-value consumers).
    const extras = environmentMembers.filter(m => !discoveryMembers.includes(m));
    expect(extras.length, 'no extra buckets left — did the two enums get collapsed?')
      .toBeGreaterThan(0);
    for (const member of extras) {
      expect(DiscoveryEnvironmentSchema.safeParse(member).success, member).toBe(false);
    }
  });
});

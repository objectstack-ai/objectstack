// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13330 — the driver registry is READABLE, and what it reads is what
 * `defineCluster()` consults.
 *
 * A driver package's whole contract is a load-time side effect into the
 * module-scope `driverRegistry` here. Until now a booting process could only
 * discover whether that side effect had landed by calling `defineCluster()`
 * and catching the throw — which constructs a real cluster on success, so it
 * is not a probe anyone can run first. `os serve` therefore ASSUMED the
 * registration, in a silent `catch`, and a shipped EE boot proved the
 * assumption wrong: the driver had loaded into a second, CommonJS instance of
 * this module, and the ESM Runtime read this one and found nothing.
 *
 * The accessor exists so that boot can read instead of assume. Its whole value
 * rests on agreeing with `defineCluster()` — an accessor that could drift from
 * the lookup it reports on would make `serve`'s diagnosis a phantom check —
 * so the agreement is pinned here in both directions, not just the shape of
 * the list.
 */

import { describe, it, expect } from 'vitest';
import type { IClusterService } from '@objectstack/spec/contracts';
import { defineCluster, listClusterDrivers, registerClusterDriver } from './cluster.js';

/** A factory whose product is identifiable without connecting to anything. */
const marker = { driver: 'fixture-marker' } as unknown as IClusterService;

describe('the driver registry can be read, not only written (#13330)', () => {
  it('CONTROL: the reader can return both answers, so an empty list is a reading', () => {
    // Nothing has registered yet in this module instance, and the reader is not
    // stuck on that answer — every assertion below depends on it moving.
    expect(listClusterDrivers()).toEqual([]);
    registerClusterDriver('custom', () => marker);
    expect(listClusterDrivers()).toEqual(['custom']);
  });

  it('omits `memory`, which defineCluster special-cases rather than registers', () => {
    // A true reading of what the REGISTRY holds. Listing `memory` here would
    // make an empty registry look populated to the one caller that needs to
    // tell those apart.
    expect(listClusterDrivers()).not.toContain('memory');
    expect(defineCluster({ driver: 'memory' }).driver).toBe('memory');
  });

  it('agrees with defineCluster — listed means resolvable', () => {
    expect(listClusterDrivers()).toContain('custom');
    expect(defineCluster({ driver: 'custom' })).toBe(marker);
  });

  it('agrees with defineCluster — unlisted means the documented throw', () => {
    // The other direction. `postgres` is accepted by the schema and shipped by
    // nobody, which is exactly the "requested but not registered" case.
    expect(listClusterDrivers()).not.toContain('postgres');
    expect(() => defineCluster({ driver: 'postgres' })).toThrow(
      /Cluster driver "postgres" is not registered/,
    );
  });
});

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Drift guard (#2874 P0): the public feature flags served by
 * `getPublicConfig()` and the classification registry in
 * `@objectstack/spec/kernel` (`PUBLIC_AUTH_FEATURES`) must stay in lockstep.
 *
 * Like `packages/mcp/src/skill-surface-guard.test.ts`, this derives the
 * ACTUAL surface from the real code path (an AuthManager instance) instead of
 * a hand-maintained list, and diffs it against the declared registry. Adding
 * a flag to the `features` literal in auth-manager.ts without classifying it
 * in the registry (gated inputs or an exemption reason) turns this red — the
 * exact drift class that let issue #2874's own first draft miss 5 of 13
 * flags.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS,
  PUBLIC_AUTH_FEATURES_NOT_ADVERTISED,
  PUBLIC_AUTH_FEATURE_NAMES,
  PUBLIC_AUTH_FEATURES,
} from '@objectstack/spec/kernel';
import { AuthManager } from './auth-manager.js';

function servedFeatures(config?: ConstructorParameters<typeof AuthManager>[0]): Record<string, unknown> {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const manager = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'http://localhost:3000',
      ...config,
    });
    return manager.getPublicConfig().features as Record<string, unknown>;
  } finally {
    warnSpy.mockRestore();
  }
}

describe('public feature-flag registry drift guard (#2874)', () => {
  it('every boolean flag served by getPublicConfig() is classified in the registry, and vice versa', () => {
    const features = servedFeatures();
    const booleanKeys = Object.keys(features).filter((k) => typeof features[k] === 'boolean');
    expect(booleanKeys.sort()).toEqual([...PUBLIC_AUTH_FEATURE_NAMES].sort());
  });

  it('non-boolean keys are limited to the declared legal-link URLs', () => {
    const features = servedFeatures();
    const nonBooleanKeys = Object.keys(features).filter((k) => typeof features[k] !== 'boolean');
    for (const key of nonBooleanKeys) {
      expect(PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS).toContain(key);
    }
  });

  // Some keys are computed conditionally (e.g. phoneNumberOtp = plugin &&
  // deliverability) — make sure no flag appears or disappears with config, so
  // a conditionally-served key can't hide from the equivalence check above.
  it('the flag key set is stable across plugin configurations', () => {
    const defaults = servedFeatures();
    const variant = servedFeatures({
      plugins: { phoneNumber: true, admin: true, organization: false, twoFactor: true },
    } as never);
    const booleans = (f: Record<string, unknown>) =>
      Object.keys(f).filter((k) => typeof f[k] === 'boolean').sort();
    expect(booleans(variant)).toEqual(booleans(defaults));
  });

  // #7481. The key-set equivalence above already fails if one of these is
  // re-added to BOTH sides — this case covers the shape that ruling actually
  // withdrew: the flag served because a deployer turned the plugin flag ON.
  // With the two dropped from the registry, `servedFeatures()` at defaults says
  // nothing about `plugins: { passkeys: true }`, which is exactly the
  // configuration that used to advertise a capability with no consumer.
  it('reserved-but-unadvertised capabilities stay out of the payload even when their plugin flag is on', () => {
    const features = servedFeatures({
      plugins: { passkeys: true, magicLink: true },
    } as never);
    for (const name of PUBLIC_AUTH_FEATURES_NOT_ADVERTISED) {
      expect(features, `features.${name} must not be advertised until objectui#4179 ships its UI`)
        .not.toHaveProperty(name);
    }
  });

  it('registry default semantics match the served defaults', () => {
    // `default-on` flags must actually serve `true` by default and `opt-in`
    // flags `false` — otherwise the lowered `!= false` / `== true` predicates
    // would not reflect reality. `multiOrgEnabled` is default-on SEMANTICS
    // (missing flag must fail open in the UI) even though a vanilla
    // single-org deployment serves `false`, so it is exempt here.
    const features = servedFeatures();
    for (const name of PUBLIC_AUTH_FEATURE_NAMES) {
      if (name === 'multiOrgEnabled') continue;
      const expected = PUBLIC_AUTH_FEATURES[name].semantics === 'default-on';
      expect(features[name], `features.${name} default`).toBe(expected);
    }
  });
});

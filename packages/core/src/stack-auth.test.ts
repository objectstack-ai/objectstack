// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22371 — the ONE rule for whether a boot composes the platform auth family
 * (and the security plugin paired with it), read by `os serve` and by
 * `os migrate security-catalog-overlays`. One case per clause of the rule, in
 * its order; the secret's environment read is driven through `process.env`
 * and restored.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITY_TO_TIER,
  DEV_AUTH_SECRET_FALLBACK,
  STACK_TIER_PRESETS,
  isHostKernelComposition,
  resolveAuthSecret,
  resolvePlatformAuthComposition,
  resolveStackTiers,
  stackSuppliesAuthPlugin,
} from './stack-auth.js';

const SECRET_VARS = ['OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET'] as const;
const saved = Object.fromEntries(SECRET_VARS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of SECRET_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const clearSecrets = () => { for (const k of SECRET_VARS) delete process.env[k]; };

describe('resolveStackTiers — declared tiers, else the preset, plus the tiers `requires` opens', () => {
  it('no declared tiers: the default preset, which carries `auth`', () => {
    expect([...resolveStackTiers({ declaredTiers: [], requires: [] })]).toEqual([...STACK_TIER_PRESETS.default]);
    expect(resolveStackTiers({ declaredTiers: [], requires: [] }).has('auth')).toBe(true);
  });

  it('an unknown preset name falls back to the default; `minimal` has no `auth`', () => {
    expect(resolveStackTiers({ declaredTiers: [], requires: [], preset: 'nope' }).has('auth')).toBe(true);
    expect(resolveStackTiers({ declaredTiers: [], requires: [], preset: 'minimal' }).has('auth')).toBe(false);
  });

  it('declared tiers replace the preset, and a `requires` token reopens its tier', () => {
    expect(resolveStackTiers({ declaredTiers: ['core'], requires: [] }).has('auth')).toBe(false);
    expect(resolveStackTiers({ declaredTiers: ['core'], requires: ['auth'] }).has('auth')).toBe(true);
    expect(resolveStackTiers({ declaredTiers: ['core'], requires: ['ai-studio'] }).has('ai')).toBe(true);
    // A token with no tier (resolved by the capability providers instead) opens none.
    expect([...resolveStackTiers({ declaredTiers: ['core'], requires: ['automation'] })]).toEqual(['core']);
    expect(CAPABILITY_TO_TIER.automation).toBeUndefined();
  });
});

describe('resolveAuthSecret — OS_AUTH_SECRET, its legacy spellings, else the development fallback', () => {
  it('the preferred spelling wins; a legacy spelling answers when it is absent', () => {
    clearSecrets();
    process.env.BETTER_AUTH_SECRET = 'legacy';
    expect(resolveAuthSecret({ isDev: false })).toBe('legacy');
    process.env.OS_AUTH_SECRET = 'preferred';
    expect(resolveAuthSecret({ isDev: false })).toBe('preferred');
  });

  it('none set: the fallback in development only', () => {
    clearSecrets();
    expect(resolveAuthSecret({ isDev: true })).toBe(DEV_AUTH_SECRET_FALLBACK);
    expect(resolveAuthSecret({ isDev: false })).toBeUndefined();
  });
});

describe('resolvePlatformAuthComposition — the gate, in `serve`\'s order', () => {
  const on = new Set(['core', 'auth']);
  const authPlugin = { name: 'com.objectstack.auth', init: async () => {} };
  class AuthPlugin { init = async () => {}; }
  const hostKernel = { name: 'com.objectstack.runtime.objectos-environment', init: async () => {} };

  it('composes, with the secret it runs on, when every clause holds', () => {
    expect(resolvePlatformAuthComposition({ plugins: [], tiers: on, secret: 's3cret' }))
      .toEqual({ composes: true, secret: 's3cret' });
  });

  it('a stack mounting AuthPlugin itself (by name or class) composes none — first, whatever else holds', () => {
    expect(stackSuppliesAuthPlugin([authPlugin])).toBe(true);
    expect(stackSuppliesAuthPlugin([new AuthPlugin()])).toBe(true);
    expect(resolvePlatformAuthComposition({ plugins: [new AuthPlugin(), hostKernel], tiers: new Set(), secret: undefined }))
      .toEqual({ composes: false, reason: 'stack-supplies-auth' });
  });

  it('the auth tier off composes none, ahead of the host-kernel and secret clauses', () => {
    expect(resolvePlatformAuthComposition({ plugins: [hostKernel], tiers: new Set(['core']), secret: undefined }))
      .toEqual({ composes: false, reason: 'auth-tier-off' });
  });

  it('a host kernel composes none, ahead of the secret clause', () => {
    expect(isHostKernelComposition([hostKernel])).toBe(true);
    expect(resolvePlatformAuthComposition({ plugins: [hostKernel], tiers: on, secret: undefined }))
      .toEqual({ composes: false, reason: 'host-kernel' });
  });

  it('no secret composes none — an empty one included', () => {
    expect(resolvePlatformAuthComposition({ plugins: [], tiers: on, secret: undefined }))
      .toEqual({ composes: false, reason: 'no-secret' });
    expect(resolvePlatformAuthComposition({ plugins: [], tiers: on, secret: '' }))
      .toEqual({ composes: false, reason: 'no-secret' });
  });
});

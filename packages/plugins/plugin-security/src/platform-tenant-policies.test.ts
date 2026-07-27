// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D3] Provenance, not pattern-matching.
 *
 * Finding F1: `collectRLSPolicies` used to drop ANY policy whose `using`
 * contained the substring `current_user.organization_id` when org isolation was
 * inactive. The token is part of the public RLS grammar, so the match swallowed
 * app-authored policies too — a declared security policy silently unenforced,
 * exactly the ADR-0049 class of defect.
 *
 * These tests pin the replacement contract from both sides: the platform's OWN
 * shipped policies are still recognized (so single-tenant deployments keep
 * paying nothing for them), and anything else is not.
 */

import { describe, it, expect } from 'vitest';

import {
  isPlatformTenantPolicy,
  isAuthoredTenantPolicy,
  platformTenantPolicyCount,
  TENANT_CONTEXT_TOKEN,
} from './platform-tenant-policies.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

/** Every tenant-scoped policy the platform actually ships, from the live declaration. */
const shippedTenantPolicies = defaultPermissionSets
  .flatMap((ps) => ps.rowLevelSecurity ?? [])
  .filter((p) => typeof p.using === 'string' && p.using.includes(TENANT_CONTEXT_TOKEN));

describe('platform tenant-policy provenance (ADR-0105 D3)', () => {
  it('recognizes every tenant-scoped policy the platform ships', () => {
    // Guards against the provenance set going empty (which would silently make
    // single-tenant deployments start compiling the platform's own policies).
    expect(shippedTenantPolicies.length).toBeGreaterThan(0);
    for (const policy of shippedTenantPolicies) {
      expect(isPlatformTenantPolicy(policy), `${policy.object}.${policy.name}`).toBe(true);
      expect(isAuthoredTenantPolicy(policy)).toBe(false);
    }
    // The provenance set is keyed by IDENTITY, so a policy shipped verbatim in
    // several permission sets (the `_self` identity carve-outs appear in
    // organization_admin / member_default / viewer_readonly) counts once.
    expect(platformTenantPolicyCount()).toBeGreaterThan(0);
    expect(platformTenantPolicyCount()).toBeLessThanOrEqual(shippedTenantPolicies.length);
  });

  it('does NOT recognize an app-authored policy that merely uses the same token', () => {
    // The F1 repro: this is precisely what the old substring match swallowed.
    const authored = {
      name: 'invoice_org_scope',
      object: 'invoice',
      operation: 'all' as const,
      using: 'organization_id == current_user.organization_id',
    };
    expect(isPlatformTenantPolicy(authored)).toBe(false);
    expect(isAuthoredTenantPolicy(authored)).toBe(true);
  });

  it('does NOT recognize a shipped policy NAME re-used on a different object', () => {
    // Name alone is not provenance — an app may legitimately reuse a name.
    const shipped = shippedTenantPolicies[0]!;
    const impostor = { ...shipped, object: 'some_app_object' };
    expect(isPlatformTenantPolicy(impostor)).toBe(false);
    expect(isAuthoredTenantPolicy(impostor)).toBe(true);
  });

  it('does NOT recognize a shipped policy whose predicate was edited', () => {
    // An admin who broadened a shipped policy owns the result: it is theirs now,
    // and it must survive collection so the change actually takes effect.
    const shipped = shippedTenantPolicies[0]!;
    const edited = { ...shipped, using: `${shipped.using} /* widened */` };
    expect(isPlatformTenantPolicy(edited)).toBe(false);
    expect(isAuthoredTenantPolicy(edited)).toBe(true);
  });

  it('treats a policy with no tenant token as neither platform nor authored-tenant', () => {
    const ownerPolicy = {
      name: 'owner_only',
      object: 'task',
      operation: 'all' as const,
      using: 'owner_id == current_user.id',
    };
    expect(isPlatformTenantPolicy(ownerPolicy)).toBe(false);
    expect(isAuthoredTenantPolicy(ownerPolicy)).toBe(false);
  });
});

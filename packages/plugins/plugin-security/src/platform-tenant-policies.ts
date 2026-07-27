// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D3] Provenance for the platform's OWN tenant-scoped RLS policies.
 *
 * `collectRLSPolicies` drops the platform's tenant policies when org isolation
 * is inactive — there is no meaningful active organization to compare against,
 * so the policy would match zero rows (or be dropped by the field-existence
 * safety net) for no benefit.
 *
 * That strip used to be a SUBSTRING match on `current_user.organization_id`
 * (ADR-0105 finding F1). The token is part of the public RLS grammar, so the
 * match also swallowed **app-authored** policies — a declared security policy
 * silently unenforced, exactly the ADR-0049 class of defect. An authored policy
 * must always reach the compiler and fail closed there (an unavailable context
 * variable makes the policy drop out, never fail open), where the operator can
 * see it, instead of vanishing during collection.
 *
 * The fix is provenance, not pattern-matching: a policy is stripped only when it
 * is IDENTICALLY one the platform ships in {@link defaultPermissionSets}. The
 * identity key is `(object, name, using)` — an app policy can only collide by
 * being byte-identical to a shipped one on the same object, in which case
 * stripping it is the same decision the platform made for its own copy.
 *
 * This deliberately does NOT introduce an authorable "strip me" flag on the RLS
 * schema: provenance is a fact about who shipped the policy, and letting
 * metadata claim it would hand authors the very footgun F1 was.
 */

import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';

import { defaultPermissionSets } from './objects/default-permission-sets.js';

/**
 * The context token that makes a policy tenant-scoped. Used ONLY to select
 * which shipped policies enter the provenance set (and to describe an authored
 * policy in the operator warning) — never as a matcher against authored input.
 */
export const TENANT_CONTEXT_TOKEN = 'current_user.organization_id';

/** `\u0000` cannot appear in an object/policy name or a `using` expression. */
function provenanceKey(policy: Pick<RowLevelSecurityPolicy, 'object' | 'name' | 'using'>): string {
  return `${policy.object ?? ''}\u0000${policy.name ?? ''}\u0000${policy.using ?? ''}`;
}

/**
 * Identity keys of every tenant-scoped policy the platform itself ships. Built
 * once from the compiled declaration — the same constant `bootstrapPlatformAdmin`
 * seeds `sys_permission_set` rows from, so a policy read back from the database
 * matches its shipped original.
 */
const PLATFORM_TENANT_POLICY_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>();
  for (const ps of defaultPermissionSets) {
    for (const policy of ps.rowLevelSecurity ?? []) {
      if (typeof policy.using === 'string' && policy.using.includes(TENANT_CONTEXT_TOKEN)) {
        keys.add(provenanceKey(policy));
      }
    }
  }
  return keys;
})();

/**
 * True iff this policy is one the PLATFORM ships for tenant scoping — the only
 * policies `collectRLSPolicies` may strip when isolation is inactive.
 */
export function isPlatformTenantPolicy(
  policy: Pick<RowLevelSecurityPolicy, 'object' | 'name' | 'using'>,
): boolean {
  return PLATFORM_TENANT_POLICY_KEYS.has(provenanceKey(policy));
}

/**
 * True iff this policy is tenant-scoped but NOT platform-shipped — i.e. an
 * app-authored policy that will now survive collection and fail closed at
 * compile time. Callers surface this to the operator once per policy so the
 * "matches zero rows" outcome is explained rather than mysterious.
 */
export function isAuthoredTenantPolicy(
  policy: Pick<RowLevelSecurityPolicy, 'object' | 'name' | 'using'>,
): boolean {
  return (
    typeof policy.using === 'string' &&
    policy.using.includes(TENANT_CONTEXT_TOKEN) &&
    !isPlatformTenantPolicy(policy)
  );
}

/** Test/diagnostic accessor — the number of shipped tenant policies recognized. */
export function platformTenantPolicyCount(): number {
  return PLATFORM_TENANT_POLICY_KEYS.size;
}

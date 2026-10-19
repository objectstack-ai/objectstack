// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { computeTenantLayer0Verdict, type TenantLayer0Input } from '@objectstack/core';
import type { TenantLayer0Verdict } from '@objectstack/spec/security';

import { RLS_DENY_FILTER } from './rls-compiler.js';

/**
 * ── Layer 0: tenant isolation (ADR-0095 D1) ─────────────────────────────────
 *
 * The tenant wall lives HERE — outside the RLS (business-policy) compiler — as
 * an independent, always-first, AND-composed filter. It shares no compiler, no
 * merge step, and no bypass bit with Layer 1 (business RLS), so a business-RLS
 * change can never weaken tenant isolation (W1), and the superuser business-RLS
 * bypass can never cross the tenant wall (W2).
 *
 * Effective read/write filter = `Layer0(tenant) AND Layer1(business RLS)`.
 *
 * This module deliberately does NOT reuse `security-plugin`'s `extractTargetField`
 * (which recognizes only the legacy single-`=`/`IN` shape, not canonical `==`);
 * it decides "is this a tenant object?" directly from the object's field set and
 * tenancy posture. That is what makes ADR-0095 delta (c) — a member reading a
 * `tenancy.enabled:false` global object — resolve correctly (see tracking issue
 * for the broader `extractTargetField` `==` blind spot, which still affects
 * Layer-1 business policies and is out of scope for D1).
 */

/**
 * [ADR-0131 D8] The verdict and its inputs live in `@objectstack/core`, so the
 * engine projects the SAME decision onto the driver's native scope
 * (`DriverOptions.tenantId` / `tenantIds`) that this layer projects onto its
 * `where` wall — one predicate, computed by one function. Re-exported here
 * because this module is where the wall's readers already import it from.
 */
export { computeTenantLayer0Verdict, type TenantLayer0Input };

/** The fail-closed verdict — shared, frozen, safe to hand out. */
const LAYER0_DENY: TenantLayer0Verdict = Object.freeze({ kind: 'deny' as const });

/**
 * Project a Layer 0 verdict onto the `where` predicate the wall AND-composes —
 * the ONE spelling of each verdict as a filter. `computeTenantLayer0Filter`
 * is `tenantLayer0FilterOf(computeTenantLayer0Verdict(input))` and nothing
 * else.
 *
 * [ADR-0139 D2 step 2] `deny` returns {@link RLS_DENY_FILTER} itself — the
 * spec's frozen object, BY REFERENCE, never a spread copy — because the
 * engine's composition and `isTenantWallDenial` in `security-plugin.ts`
 * recognise the sentinel by identity; frozen, no holder can edit it.
 * `organizations` copies the set so a later mutation of the verdict cannot
 * reach a compiled filter.
 */
export function tenantLayer0FilterOf(verdict: TenantLayer0Verdict): Record<string, unknown> | null {
  switch (verdict.kind) {
    case 'none':
      return null;
    case 'deny':
      return RLS_DENY_FILTER;
    case 'organization':
      return { organization_id: verdict.organizationId };
    case 'organizations':
      return { organization_id: { $in: [...verdict.organizationIds] } };
  }
}

/**
 * Compute the Layer 0 (tenant) filter to AND onto a read/write.
 *
 * - `null` → Layer 0 contributes nothing (`single` posture; non-tenant object;
 *   or an exempt platform admin). The caller applies only Layer 1.
 * - `{ organization_id: <id> }` → the `isolated` wall, AND-composed unconditionally.
 * - `{ organization_id: { $in: [...] } }` → the `group` union wall (ADR-0105 D2).
 * - {@link RLS_DENY_FILTER} → a walled posture on a tenant object, but the
 *   context carries no organization scope to enforce with (no active org under
 *   `isolated`, empty access set under `group`) → fail closed (zero rows /
 *   write denied).
 *
 * Only the PREDICATE widens between `isolated` and `group`; the composition
 * rules do not. Layer 0 is still computed independently of the RLS compiler,
 * still AND-composed first, and still crossable only by a true `PLATFORM_ADMIN`
 * — so ADR-0095's W1 (business RLS cannot weaken the wall) and W2 (the
 * superuser bypass cannot cross it) hold in every posture (ADR-0105 D2/D4).
 *
 * [#15813] A projection of {@link computeTenantLayer0Verdict} — one predicate,
 * computed once (ADR-0131 D8); the middleware records the verdict on the
 * operation and injects this projection, from the same computation.
 */
export function computeTenantLayer0Filter(
  input: TenantLayer0Input,
): Record<string, unknown> | null {
  return tenantLayer0FilterOf(computeTenantLayer0Verdict(input));
}

/**
 * [#15813 / ADR-0090 D10] The verdict of TWO Layer 0 walls AND-composed onto
 * one operation — the on-behalf-of shape, where the caller's wall and the
 * delegator's wall are both injected and a row must satisfy both.
 *
 * Set intersection, in the wall's own terms: `deny` on either side denies (no
 * row clears an empty scope); `none` on one side yields the other (it
 * contributed no predicate); two named scopes intersect, an empty intersection
 * is `deny`, and a one-organization intersection that either side spelled as
 * the `isolated` equality is reported as `organization` — the AND of `= X`
 * with any set containing X IS `= X`. Pure, so the middleware records the
 * composed verdict without recomputing either wall.
 */
export function intersectTenantLayer0Verdicts(
  a: TenantLayer0Verdict,
  b: TenantLayer0Verdict,
): TenantLayer0Verdict {
  if (a.kind === 'deny' || b.kind === 'deny') return LAYER0_DENY;
  if (a.kind === 'none') return b;
  if (b.kind === 'none') return a;
  const idsOf = (v: TenantLayer0Verdict): readonly string[] =>
    v.kind === 'organization' ? [v.organizationId] : v.kind === 'organizations' ? v.organizationIds : [];
  const right = new Set(idsOf(b));
  const both = idsOf(a).filter((id) => right.has(id));
  if (both.length === 0) return LAYER0_DENY;
  if (both.length === 1 && (a.kind === 'organization' || b.kind === 'organization')) {
    return { kind: 'organization', organizationId: both[0] };
  }
  return { kind: 'organizations', organizationIds: both };
}

/**
 * AND-compose Layer 0 onto Layer 1. Layer 0 is placed FIRST (outermost) so the
 * tenant predicate is always evaluated and can never be widened by a Layer 1
 * disjunction. `null` on either side means "no contribution".
 */
export function andComposeLayers(
  layer0: Record<string, unknown> | null,
  layer1: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (layer0 == null) return layer1;
  if (layer1 == null) return layer0;
  return { $and: [layer0, layer1] };
}

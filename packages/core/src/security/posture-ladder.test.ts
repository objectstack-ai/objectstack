// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { AuthzPosture } from '@objectstack/spec/security';
import {
  POSTURE_LADDER,
  POSTURE_RANK,
  POSTURE_INJECTION_RULE,
  derivePosture,
  postureVisibleRows,
  type LadderRow,
  type LadderPrincipal,
} from './posture-ladder.js';

/**
 * ADR-0095 D2/D3 posture-ladder invariants. This file locks the two properties
 * the ADR requires as TESTED invariants — strict nesting and EXTERNAL
 * deny-by-default — plus the derivation. [Ruling of record 6355206139, letter
 * B] The EXTERNAL rung is re-ruled from "explicit shares only" to explicit
 * grants only (shares, sharing rules, grant RLS), with the owner_only floor,
 * and the derivation now returns it for a holder of `org_external`. The
 * end-to-end row behavior is guarded separately by plugin-security's
 * `authz-matrix-gate` and the dogfood conformance matrix; here we assert the
 * ladder's mathematical shape.
 */

// ── Reference dataset: one principal, escalating posture ─────────────────────
// p is a member of org-1. The dataset is chosen so each rung STRICTLY adds rows.
const p: LadderPrincipal = { userId: 'u1', organizationId: 'org-1' };
const ROWS: LadderRow[] = [
  { id: 'r1', organization_id: 'org-1', owner_id: 'u1' },                    // owned by p     → EXTERNAL+ (owner_only floor)
  { id: 'r2', organization_id: 'org-1', owner_id: 'u2', owdVisible: true },  // OWD baseline   → MEMBER+
  { id: 'r3', organization_id: 'org-1', owner_id: 'u2', owdVisible: false }, // in-org, hidden → TENANT_ADMIN+
  { id: 'r4', organization_id: 'org-1', owner_id: 'u2', sharedTo: ['u1'] },  // shared to p    → EXTERNAL+
  { id: 'r5', organization_id: 'org-2', owner_id: 'u3' },                    // foreign org    → PLATFORM_ADMIN+
  { id: 'r6', organization_id: 'org-1', owner_id: 'u2', grantVisible: true }, // a grant's RLS → EXTERNAL+
];

const idsOf = (rows: LadderRow[]) => new Set(rows.map((r) => r.id));
const isSuperset = (big: Set<string>, small: Set<string>) => [...small].every((x) => big.has(x));

describe('AuthzPosture ladder — ordering (ADR-0095 D2)', () => {
  it('POSTURE_LADDER is high→low and POSTURE_RANK is strictly monotonic', () => {
    expect(POSTURE_LADDER).toEqual(['PLATFORM_ADMIN', 'TENANT_ADMIN', 'MEMBER', 'EXTERNAL']);
    expect(POSTURE_RANK).toEqual({ PLATFORM_ADMIN: 3, TENANT_ADMIN: 2, MEMBER: 1, EXTERNAL: 0 });
    for (let i = 1; i < POSTURE_LADDER.length; i++) {
      expect(POSTURE_RANK[POSTURE_LADDER[i - 1]]).toBeGreaterThan(POSTURE_RANK[POSTURE_LADDER[i]]);
    }
  });

  it('every rung maps to exactly one injection rule', () => {
    for (const rung of POSTURE_LADDER) {
      expect(typeof POSTURE_INJECTION_RULE[rung]).toBe('string');
      expect(POSTURE_INJECTION_RULE[rung].length).toBeGreaterThan(0);
    }
    expect(Object.keys(POSTURE_INJECTION_RULE).sort()).toEqual([...POSTURE_LADDER].sort());
  });
});

describe('AuthzPosture ladder — strict nesting invariant (ADR-0095 D2)', () => {
  it('visible(rung n) ⊇ visible(rung n−1) for every adjacent pair, strictly here', () => {
    const visible: Record<AuthzPosture, Set<string>> = {
      EXTERNAL: idsOf(postureVisibleRows('EXTERNAL', ROWS, p)),
      MEMBER: idsOf(postureVisibleRows('MEMBER', ROWS, p)),
      TENANT_ADMIN: idsOf(postureVisibleRows('TENANT_ADMIN', ROWS, p)),
      PLATFORM_ADMIN: idsOf(postureVisibleRows('PLATFORM_ADMIN', ROWS, p)),
    };

    // The concrete visible sets for this dataset (documents the ladder).
    expect(visible.EXTERNAL).toEqual(new Set(['r1', 'r4', 'r6']));
    expect(visible.MEMBER).toEqual(new Set(['r1', 'r2', 'r4', 'r6']));
    expect(visible.TENANT_ADMIN).toEqual(new Set(['r1', 'r2', 'r3', 'r4', 'r6']));
    expect(visible.PLATFORM_ADMIN).toEqual(new Set(['r1', 'r2', 'r3', 'r4', 'r5', 'r6']));

    // Superset chain (⊇) AND strict growth (⊋) up the ladder — from low rank up.
    const lowToHigh = [...POSTURE_LADDER].reverse(); // EXTERNAL → PLATFORM_ADMIN
    for (let i = 1; i < lowToHigh.length; i++) {
      const lower = visible[lowToHigh[i - 1]];
      const higher = visible[lowToHigh[i]];
      expect(isSuperset(higher, lower)).toBe(true);           // ⊇ (the invariant)
      expect(higher.size).toBeGreaterThan(lower.size);        // ⊋ (this dataset)
    }
  });
});

describe('AuthzPosture ladder — EXTERNAL semantics lock (ADR-0095 D2, re-ruled 6355206139)', () => {
  it('EXTERNAL reaches explicit grants only — the OWD baseline never widens it', () => {
    // A principal with no share, no owned row and no grant sees nothing, even
    // though r2 is OWD-visible.
    const stranger: LadderPrincipal = { userId: 'ext-1', organizationId: 'org-1' };
    const noGrants = ROWS.map((r) => ({ ...r, grantVisible: false }));
    expect(postureVisibleRows('EXTERNAL', noGrants, stranger)).toEqual([]);

    // Make EVERY row OWD-visible: still empty for the stranger — a permissive
    // OWD baseline cannot widen an external principal's visibility.
    const allPublic = noGrants.map((r) => ({ ...r, owdVisible: true }));
    expect(postureVisibleRows('EXTERNAL', allPublic, stranger)).toEqual([]);

    // The sources are the explicit channels: p's own row (the owner_only
    // floor), the row shared to p, and the row a grant's RLS admits.
    const seen = postureVisibleRows('EXTERNAL', ROWS.map((r) => ({ ...r, owdVisible: true })), p);
    expect(seen.map((r) => r.id)).toEqual(['r1', 'r4', 'r6']);
  });

  it('a grant’s RLS reaches an external within its organization only', () => {
    const foreignGrant: LadderRow = { id: 'x', organization_id: 'org-2', owner_id: 'u3', grantVisible: true };
    expect(postureVisibleRows('EXTERNAL', [foreignGrant], p)).toEqual([]);
  });

  it('a misconfiguration can only SHRINK external visibility, never widen it', () => {
    // Dropping a share, or a grant, removes exactly that row; nothing else appears.
    const withoutShare = ROWS.map((r) => (r.id === 'r4' ? { ...r, sharedTo: [] } : r));
    expect(postureVisibleRows('EXTERNAL', withoutShare, p).map((r) => r.id)).toEqual(['r1', 'r6']);
    const withoutGrant = ROWS.map((r) => (r.id === 'r6' ? { ...r, grantVisible: false } : r));
    expect(postureVisibleRows('EXTERNAL', withoutGrant, p).map((r) => r.id)).toEqual(['r1', 'r4']);
  });
});

describe('AuthzPosture — derivation from capability grants only (ADR-0095 D3)', () => {
  it('maps held capability grants to a rung; platform wins over tenant', () => {
    expect(derivePosture({ isPlatformAdmin: true, isTenantAdmin: false })).toBe('PLATFORM_ADMIN');
    expect(derivePosture({ isPlatformAdmin: true, isTenantAdmin: true })).toBe('PLATFORM_ADMIN');
    expect(derivePosture({ isPlatformAdmin: false, isTenantAdmin: true })).toBe('TENANT_ADMIN');
    expect(derivePosture({ isPlatformAdmin: false, isTenantAdmin: false })).toBe('MEMBER');
  });

  it('capability evidence alone never derives EXTERNAL', () => {
    const combos: Array<[boolean, boolean]> = [
      [true, true], [true, false], [false, true], [false, false],
    ];
    for (const [isPlatformAdmin, isTenantAdmin] of combos) {
      expect(derivePosture({ isPlatformAdmin, isTenantAdmin })).not.toBe('EXTERNAL');
      expect(derivePosture({ isPlatformAdmin, isTenantAdmin, isExternal: false })).not.toBe('EXTERNAL');
    }
  });

  it('[ruling 6355206139] an org_external holder derives EXTERNAL — above the org-admin grant, below the platform grant', () => {
    expect(derivePosture({ isPlatformAdmin: false, isTenantAdmin: false, isExternal: true })).toBe('EXTERNAL');
    // An explicit organization_admin grant reaches it as a grant, but does not lift the rung.
    expect(derivePosture({ isPlatformAdmin: false, isTenantAdmin: true, isExternal: true })).toBe('EXTERNAL');
    // The unscoped platform grant is deployment standing no membership role demotes.
    expect(derivePosture({ isPlatformAdmin: true, isTenantAdmin: false, isExternal: true })).toBe('PLATFORM_ADMIN');
  });
});

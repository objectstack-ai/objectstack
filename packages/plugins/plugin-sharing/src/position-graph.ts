// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isGrantActive } from '@objectstack/core';

import type { SharingEngine } from './sharing-service.js';
import { TeamGraphService, holdsRole } from './team-graph.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The `sys_user_position` predicate "assignments of `positionName`", scoped to
 * `scopeOrg` when one is given — ONE spelling for the rule-wide expansion
 * ({@link PositionGraphService.expandPositionUsers}) and the user-scoped check
 * ({@link PositionGraphService.holdsPosition}), so the two can never disagree
 * about which assignment rows count.
 */
function positionAssignmentPredicate(positionName: string, scopeOrg: string | null | undefined): Record<string, unknown> {
  const filter: Record<string, unknown> = { position: positionName };
  if (scopeOrg) filter.organization_id = scopeOrg;
  return filter;
}

/** The columns both reads project: the holder and the ADR-0091 D2 validity window. */
const ASSIGNMENT_FIELDS = ['user_id', 'valid_from', 'valid_until'];

type PositionCache = {
  expand?: Map<string, string[]>;
};

export interface PositionGraphOptions {
  engine: SharingEngine;
  /** Optional tenant scope; null means cross-tenant lookups. */
  organizationId?: string | null;
  /** Optional shared cache across one evaluator pass. */
  cache?: PositionCache;
  /** Reused for the better-auth membership expansion (sys_member.role). */
  teamGraph?: TeamGraphService;
}

/**
 * Position expansion (ADR-0090 D3).
 *
 * Positions are FLAT capability-distribution groups — there is no hierarchy
 * to walk (the org tree lives on `sys_business_unit`; the former
 * position-parent walk queried a column that never existed, ADR-0057 D5).
 * The one job left here is resolving "who holds position P":
 *
 *   1. `sys_user_position` — the platform-owned source of truth
 *      (ADR-0057 D4), keyed by the position's machine name;
 *   2. ∪ `sys_member.role` — the better-auth membership string, kept as a
 *      transition source (ADR-0057 D4 addendum) via {@link TeamGraphService}.
 *
 * All lookups elevate to a system context (assignments are platform
 * metadata); callers own their own authorization.
 *
 * ⚠️ A SECOND implementation of this question lives in `plugin-approvals`
 * (`ApprovalService.expandPositionUsers`), and it is deliberately NOT identical
 * — do not unify them without reading #8613 / commit 04d03c3a0 first. Approval routing is
 * an ADDRESSING path, so it reads the directory raw and applies no ADR-0091 D2
 * window: dropping a lapsed holder there is fail-OPEN (a step routing to
 * nobody). Note also that the `sys_position.active` gate for THIS path is not
 * here either — it lives at the rule evaluator's call site
 * (`positionConfersAccess` in `sharing-rule-service.ts`), which is where the
 * same ruling put it.
 */
export class PositionGraphService {
  private readonly engine: SharingEngine;
  private readonly organizationId: string | null;
  private readonly cache: PositionCache;
  private readonly teamGraph: TeamGraphService;

  constructor(opts: PositionGraphOptions) {
    this.engine = opts.engine;
    this.organizationId = opts.organizationId ?? null;
    this.cache = opts.cache ?? {};
    this.cache.expand ??= new Map();
    this.teamGraph =
      opts.teamGraph ?? new TeamGraphService({ engine: this.engine, organizationId: this.organizationId });
  }

  /** Users holding `positionName` (assignment table ∪ membership transition source). */
  async expandPositionUsers(positionName: string, organizationId?: string): Promise<string[]> {
    if (!positionName) return [];
    const org = organizationId ?? this.organizationId ?? '*';
    const key = `${org}::${positionName}`;
    const cached = this.cache.expand!.get(key);
    if (cached) return cached;

    const users = new Set<string>();

    // 1) Platform assignment table (source of truth).
    const scopeOrg = organizationId ?? this.organizationId;
    try {
      // valid_from / valid_until ride the projection so the ADR-0091 D2
      // validity filter below sees them — expired holders stop receiving
      // position-recipient shares at resolution time, fail-closed.
      const rows = await this.engine.find('sys_user_position', {
        filter: positionAssignmentPredicate(positionName, scopeOrg),
        fields: ASSIGNMENT_FIELDS,
        limit: 10000,
        context: SYSTEM_CTX,
      });
      const nowMs = Date.now();
      for (const r of (rows ?? []) as any[]) {
        if (!isGrantActive(r, nowMs)) continue;
        const uid = String(r.user_id ?? '');
        if (uid) users.add(uid);
      }
    } catch {
      /* table may not exist on minimal stacks — union source below still applies */
    }

    // 2) better-auth membership string (transition window, ADR-0057 D4).
    for (const uid of await this.teamGraph.expandRoleUsers(positionName, scopeOrg ?? undefined)) {
      users.add(uid);
    }

    const result = Array.from(users);
    this.cache.expand!.set(key, result);
    return result;
  }

  /**
   * Does `userId` hold `positionName`? The user-scoped twin of
   * {@link expandPositionUsers}: the same two sources, the same organization
   * scope and the same ADR-0091 D2 validity filter, each narrowed to one user,
   * so the answer is `expandPositionUsers(positionName, organizationId)
   * .includes(userId)` — pinned in `position-graph.test.ts` — read in two
   * indexed lookups instead of the position's whole holder list.
   *
   * Exists for the recipient-membership recompute
   * (`recipient-membership-recompute.ts`), which re-evaluates a position rule
   * for the ONE user whose assignment was written. That runs on the write path,
   * once per written row, so a full expansion there would make a bulk
   * assignment import quadratic in the position's holder count.
   *
   * Uncached on purpose: the answer is wanted right after a write that may
   * have changed it. A failed assignment read falls through to the transition
   * source, as the expansion's does.
   */
  async holdsPosition(userId: string, positionName: string, organizationId?: string): Promise<boolean> {
    if (!userId || !positionName) return false;
    const scopeOrg = organizationId ?? this.organizationId;
    try {
      const rows = await this.engine.find('sys_user_position', {
        filter: { ...positionAssignmentPredicate(positionName, scopeOrg), user_id: userId },
        fields: ASSIGNMENT_FIELDS,
        limit: 1000,
        context: SYSTEM_CTX,
      });
      const nowMs = Date.now();
      for (const r of (rows ?? []) as any[]) {
        if (String(r.user_id ?? '') === userId && isGrantActive(r, nowMs)) return true;
      }
    } catch {
      /* table may not exist on minimal stacks — the transition source below still applies */
    }
    return holdsRole(this.engine, positionName, userId, scopeOrg);
  }
}

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IBusinessUnitGraphService } from '@objectstack/spec/contracts';
import type { SharingEngine } from './sharing-service.js';
import { TeamGraphService, managerIsProvablyOutsideOrg } from './team-graph.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

type DeptCache = {
  descendants?: Map<string, string[]>;
  expandUsers?: Map<string, string[]>;
  /**
   * [#7807] Members of exactly one unit — a SEPARATE map from
   * {@link DeptCache.expandUsers} on purpose. Both are keyed by business-unit
   * id but answer different questions, so sharing one map would let a narrow
   * `business_unit` expansion be served a cached subtree answer (re-opening
   * the over-grant this issue closed) or vice versa, depending only on which
   * recipient kind happened to be evaluated first in the pass.
   */
  unitMembers?: Map<string, string[]>;
  head?: Map<string, string | null>;
};

export interface BusinessUnitGraphOptions {
  engine: SharingEngine;
  /** Optional tenant scope; null means cross-tenant lookups. */
  organizationId?: string | null;
  /** Optional shared cache across one evaluator pass. */
  cache?: DeptCache;
  /**
   * Optional team-graph instance to share role / manager lookups with —
   * department graph proxies `managerOf` through so callers only need one
   * service.
   */
  teamGraph?: TeamGraphService;
}

/**
 * Default {@link IBusinessUnitGraphService} implementation.
 *
 * Walks `sys_business_unit.parent_business_unit_id` for hierarchy and
 * `sys_business_unit_member` for member expansion. Treats the optional
 * `active` flag as a hard filter (inactive departments contribute no
 * members and stop BFS descent into their subtrees).
 *
 * Two DIFFERENT widths live here, and keeping them distinct is the point
 * (#7807):
 *   - {@link BusinessUnitGraphService.expandUsers} — the unit PLUS every
 *     descendant unit (the `IBusinessUnitGraphService` contract; drives the
 *     `unit_and_subordinates` recipient).
 *   - {@link BusinessUnitGraphService.expandUnitMembers} — exactly that one
 *     unit's members (drives the `business_unit` recipient).
 *
 * Two tenant screens live here, and BOTH are strict equalities:
 *   - {@link BusinessUnitGraphService.orgScope} screens `sys_business_unit`,
 *     the ANCHOR the rule names;
 *   - `memberScope` screens `sys_business_unit_member`, the SET BEING GRANTED,
 *     added by #14949 and kept (a NULL organization there means unknown
 *     tenancy, and a grant fails closed on it).
 * Each method carries the measurement it rests on. ⛔ They are not one method,
 * and ⛔ neither one gets a NULL arm — see {@link BusinessUnitGraphService.orgScope}.
 *
 * Reuses {@link TeamGraphService.managerOf} for user-level manager
 * lookup so callers can use this single service in approval / sharing
 * pipelines.
 */
export class BusinessUnitGraphService implements IBusinessUnitGraphService {
  private readonly engine: SharingEngine;
  private readonly organizationId: string | null;
  private readonly cache: DeptCache;
  private readonly teamGraph?: TeamGraphService;

  constructor(opts: BusinessUnitGraphOptions) {
    this.engine = opts.engine;
    this.organizationId = opts.organizationId ?? null;
    this.cache = opts.cache ?? {};
    this.cache.descendants ??= new Map();
    this.cache.expandUsers ??= new Map();
    this.cache.unitMembers ??= new Map();
    this.cache.head ??= new Map();
    this.teamGraph = opts.teamGraph;
  }

  async descendants(businessUnitId: string): Promise<string[]> {
    if (!businessUnitId) return [];
    const cached = this.cache.descendants!.get(businessUnitId);
    if (cached) return cached;

    // Verify seed itself is active + within tenant scope.
    const seedActive = await this.seedIsUsable(businessUnitId);
    if (!seedActive) {
      this.cache.descendants!.set(businessUnitId, []);
      return [];
    }

    const seen = new Set<string>([businessUnitId]);
    const queue: string[] = [businessUnitId];
    while (queue.length) {
      const parent = queue.shift()!;
      let children: any[] = [];
      try {
        children = await this.engine.find('sys_business_unit', {
          where: this.orgScope({ parent_business_unit_id: parent, active: { $ne: false } }),
          fields: ['id'],
          limit: 1000,
          context: SYSTEM_CTX,
        });
      } catch {
        children = [];
      }
      for (const c of children ?? []) {
        const cid = String((c as any).id ?? '');
        if (cid && !seen.has(cid)) {
          seen.add(cid);
          queue.push(cid);
        }
      }
    }
    const out = Array.from(seen);
    this.cache.descendants!.set(businessUnitId, out);
    return out;
  }

  /**
   * Is the seed unit itself active and inside the tenant scope?
   *
   * Shared by both widths so they agree on what an unusable seed is: a unit
   * that does not exist, sits in another organization, or carries
   * `active: false` contributes NOBODY — it is never merely "expanded without
   * its descendants". A read failure answers `false` (fail closed: an
   * unreadable unit must not grant).
   */
  private async seedIsUsable(businessUnitId: string): Promise<boolean> {
    try {
      const seedRows = await this.engine.find('sys_business_unit', {
        where: this.orgScope({ id: businessUnitId }),
        fields: ['id', 'active'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      const seedRow: any = Array.isArray(seedRows) ? seedRows[0] : null;
      if (!seedRow) return false;
      if (seedRow.active === false) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * [#7807] Members of EXACTLY ONE business unit — no subtree descent.
   *
   * This is the enforcement of the `business_unit` sharing-rule recipient,
   * which the spec (`ShareRecipientType`), the lint red-line table and
   * ADR-0057 D5 all declare as "exactly one business unit's members (no
   * subtree)". Until #7807 the runtime routed it through
   * {@link BusinessUnitGraphService.expandUsers} instead, so a rule anchored
   * at a division silently reached every department and office beneath it —
   * an over-grant, and one that made the strictly-wider `unit_and_subordinates`
   * kind not wider at all.
   *
   * Deliberately NOT a variant of `expandUsers`: that method is the
   * `IBusinessUnitGraphService` contract's SUBTREE expansion ("all user ids in
   * `businessUnitId` or any descendant business unit") and keeps that meaning
   * for `unit_and_subordinates`, the `bu:` approver prefix and org rollups.
   * The two widths are now two methods rather than one method and two
   * comments.
   */
  async expandUnitMembers(businessUnitId: string): Promise<string[]> {
    if (!businessUnitId) return [];
    const cached = this.cache.unitMembers!.get(businessUnitId);
    if (cached) return cached;

    if (!(await this.seedIsUsable(businessUnitId))) {
      this.cache.unitMembers!.set(businessUnitId, []);
      return [];
    }

    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_business_unit_member', {
        // [#14547] Tenant-screened — see {@link memberScope}, which is STRICT
        // on purpose and is not {@link orgScope}.
        where: this.memberScope({ business_unit_id: businessUnitId }),
        fields: ['user_id'],
        limit: 10000,
        context: SYSTEM_CTX,
      });
    } catch {
      rows = [];
    }
    const users = Array.from(
      new Set((rows ?? []).map((r: any) => String(r.user_id ?? '')).filter(Boolean)),
    );
    this.cache.unitMembers!.set(businessUnitId, users);
    return users;
  }

  async expandUsers(businessUnitId: string): Promise<string[]> {
    if (!businessUnitId) return [];
    const cached = this.cache.expandUsers!.get(businessUnitId);
    if (cached) return cached;

    const units = await this.descendants(businessUnitId);
    if (units.length === 0) return [];

    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_business_unit_member', {
        // [#14547] Tenant-screened — see {@link memberScope}. The WIDE width
        // needs the screen exactly as much as the narrow one: the reported
        // reproduction used `unit_and_subordinates`, and a subtree walk that
        // now admits org-less (seeded) units reaches MORE unscreened member
        // rows than the single-unit read, not fewer.
        where: this.memberScope({ business_unit_id: { $in: units } }),
        fields: ['user_id'],
        limit: 10000,
        context: SYSTEM_CTX,
      });
    } catch {
      rows = [];
    }
    const users = Array.from(
      new Set((rows ?? []).map((r: any) => String(r.user_id ?? '')).filter(Boolean)),
    );
    this.cache.expandUsers!.set(businessUnitId, users);
    return users;
  }

  async headOf(businessUnitId: string): Promise<string | null> {
    if (!businessUnitId) return null;
    if (this.cache.head!.has(businessUnitId)) return this.cache.head!.get(businessUnitId) ?? null;
    let row: any = null;
    try {
      const rows = await this.engine.find('sys_business_unit', {
        where: this.orgScope({ id: businessUnitId }),
        fields: ['id', 'manager_user_id'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      row = Array.isArray(rows) ? rows[0] : null;
    } catch {
      row = null;
    }
    const head = row?.manager_user_id ? String(row.manager_user_id) : null;
    this.cache.head!.set(businessUnitId, head);
    return head;
  }

  /**
   * [#10231] Honours the declared `organizationId` on BOTH limbs.
   *
   * The delegating limb always did, by construction — it hands the argument to
   * {@link TeamGraphService.managerOf}, which now screens. The STANDALONE
   * fallback below did not, and that gap was the whole risk: the fallback is
   * reached exactly when no `teamGraph` was supplied, so a caller could get the
   * unscreened answer from the same method name purely by how the service
   * happened to be constructed. A screen that depends on a constructor option
   * is not a screen.
   */
  async managerOf(userId: string, organizationId?: string): Promise<string | null> {
    if (this.teamGraph) return this.teamGraph.managerOf(userId, organizationId);
    // Standalone fallback: read sys_user.manager_id directly.
    if (!userId) return null;
    const org = organizationId ?? this.organizationId;
    try {
      const rows = await this.engine.find('sys_user', {
        where: { id: userId },
        fields: ['id', 'manager_id'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      const row: any = Array.isArray(rows) ? rows[0] : null;
      const managerId = row?.manager_id ? String(row.manager_id) : null;
      if (!managerId) return null;
      // The SAME screen the delegating limb applies — one implementation,
      // imported rather than restated, so the two limbs cannot drift.
      if (await managerIsProvablyOutsideOrg(this.engine, managerId, org)) return null;
      return managerId;
    } catch {
      return null;
    }
  }

  /**
   * [ADR-0131 D8] The UNIT screen — STRICT equality, as 17.2.0 ships it.
   *
   * ⛔ Do NOT re-add a NULL arm here. #14949 briefly made this `$or` the rule's
   * own organization together with a second arm matching an unset
   * `organization_id`, so that an org-stamped rule could name a seeded
   * (org-less) `sys_business_unit` row — the shape
   * `SqlDriver.applyTenantScope` writes. That was reverted before 17.3 was cut on
   * the maintainer's ruling: it re-implements, a second time and in a second
   * place, the very predicate `SqlDriver.applyTenantScope` already owns — the
   * duplication ADR-0131 exists to retire (#10103 cause 1) — and it had not
   * shipped, so reverting cost nothing while shipping it would have owed v18 a
   * breaking change plus a migration.
   *
   * #14547 therefore REMAINS as in 17.2.0: an org-stamped rule naming a seeded
   * unit expands to nobody. That is a real defect and it is not fixed here.
   * Its root cause is the seed loader's `sys_` exemption plus first-boot
   * ordering, and it is fixed STRUCTURALLY on the v18 line by ADR-0131 C1 —
   * the Default Organization exists before application seed datasets load, and
   * the seed loader stamps `sys_business_unit` seeds — so the row this screen
   * reads carries an organization and no screen has to special-case it.
   * `SharingRuleService.warnOnEmptyUnitExpansion` (#14949's other half, kept)
   * is what keeps the 17.x symptom LOUD instead of silent.
   */
  private orgScope(filter: Record<string, unknown>): Record<string, unknown> {
    if (this.organizationId) return { ...filter, organization_id: this.organizationId };
    return filter;
  }

  /**
   * [#14949, KEPT] The MEMBER screen — STRICT equality.
   *
   * ⚠️ This half is NOT part of the ADR-0131 D8 revert that restored
   * {@link orgScope} to a strict equality. It is kept, and it is load-bearing
   * on its own.
   *
   * ## Why the member rows are screened at all
   *
   * Both member reads used to carry no organization predicate whatever, under
   * a {@link SYSTEM_CTX} that carries no tenant either — so the query was
   * completely unscoped by organization: any unit an org-stamped rule could
   * see handed back EVERY tenant's membership rows hanging off it, and tenant
   * A's rule materialised real `sys_record_share` rows for tenant B's users.
   * A strict {@link orgScope} narrows which units are reachable but does not
   * close that: `sys_business_unit_member` rows of another organization sit on
   * org-stamped units too, and those units are exactly the visible ones. This
   * screen is the only thing that answers there.
   *
   * ## Why STRICT
   *
   * A member row is part of the SET BEING GRANTED — enumerated by the platform
   * rather than named by anyone — and its organization is the only tenancy
   * fact it carries.
   *
   * `sys_business_unit_member` rows are NOT organization-stamped on every write
   * path. Re-measured on this tree at `origin/main` for #14547:
   *
   *   - REST / session writes ARE stamped — the engine threads the caller's
   *     `tenantId` into `DriverOptions` and `SqlDriver.injectTenantOnInsert`
   *     fills the injected `organization_id` column;
   *   - SEED replay is NOT — `seed-loader.ts` withholds its single-org
   *     `fallbackOrgId` from every `/^(sys_|cloud_|ai_)/` object, so a seeded
   *     membership lands org-less unless the replay pinned an organization or
   *     the record spelled the column itself;
   *   - ELEVATED (system-context) writes are NOT — `sys_business_unit_member`
   *     is absent from `PLATFORM_OBJECT_TENANCY`
   *     (`packages/objectql/src/tenancy/platform-object-tenancy.ts`), so it
   *     classifies `unclassified` and `Engine.resolveSystemInsertOrganization`
   *     returns early, stamping nothing. That residual classification gap is
   *     tracked separately (#14570) and is not closed here;
   *   - `driver-memory` / `driver-mongodb` never stamp a tenant column at all
   *     (both refuse to boot multi-tenant, which is what makes that safe).
   *
   * So a NULL organization on a member row does not mean "platform-global", it
   * means UNKNOWN TENANCY — and admitting an identity of unknown tenancy into
   * an org-stamped grant is the same cross-tenant over-grant, arriving by the
   * other door. A grant fails CLOSED: unknown tenancy is not a member here.
   * The sibling recipient widths already read their membership rows this way —
   * `TeamGraphService` screens `sys_team_member` and `PositionGraphService`
   * screens `sys_user_position`, both with a strict equality.
   *
   * ⚠️ The cost is declared, not hidden: a rule stamped with an organization
   * whose memberships were seeded expands to nobody even on a unit it can see.
   * That outcome is LOUD — `SharingRuleService.expandRecipient` warns once per
   * rule, naming the rule and the unit — where before it was silent, and the
   * repair is to stamp the membership rows rather than to widen this screen.
   *
   * ⛔ Do not "unify" this with {@link orgScope}. One method serving both
   * screens re-opens whichever half it does not implement.
   */
  private memberScope(filter: Record<string, unknown>): Record<string, unknown> {
    if (!this.organizationId) return filter;
    return { ...filter, organization_id: this.organizationId };
  }
}

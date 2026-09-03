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
 * Two DIFFERENT tenant screens live here too, and keeping THEM distinct is
 * the point of #14547 — an asymmetric pair, not an oversight:
 *   - {@link BusinessUnitGraphService.orgScope} screens `sys_business_unit`,
 *     the ANCHOR the rule names, with the platform's NULL-INCLUSIVE predicate
 *     (a seeded unit belongs to no organization and every tenant may see it);
 *   - `memberScope` screens `sys_business_unit_member`, the SET BEING GRANTED,
 *     with a STRICT equality (a NULL organization there means unknown
 *     tenancy, and a grant fails closed on it).
 * Each method carries the measurement it rests on. ⛔ They are not one method.
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
   * [#14547] The UNIT screen — the platform's own NULL-INCLUSIVE tenant
   * predicate, not a strict equality.
   *
   * `SqlDriver.applyTenantScope` — the platform's single chokepoint for
   * read-side tenant isolation — emits `(organization_id = ? OR
   * organization_id IS NULL)`, and its own comment names business units among
   * the populations that arm depends on: a NULL organization marks a
   * PLATFORM/seeded row that every tenant may see (#2734). This method used to
   * AND a bare `organization_id = <rule org>` instead, dropping that NULL arm.
   *
   * A `sys_business_unit` row written by seed data carries no organization — a
   * seed cannot know the id the runtime mints at boot — so an org-stamped rule
   * naming a seeded unit matched nothing: {@link seedIsUsable} read the unit as
   * "does not exist", both recipient widths returned zero users, and the rule
   * stayed `active: true` having materialised no `sys_record_share` row and
   * logged nothing. A silent under-grant whose only symptom is "the right
   * people cannot see the record".
   *
   * The same predicate, for the same rows, is already written twice in this
   * codebase: `SharingRuleService.adminOrgScope` (#7676) for the rule table,
   * and `ApprovalService.businessUnitOrgScope` (#3807) for `sys_business_unit`
   * itself. This file was the outlier, and `sharing-rule-service.ts` names the
   * mistake in prose while this file made it.
   *
   * The spelling is `$or` rather than threading `context.tenantId` on purpose.
   * A tenant on the context would hand the SQL driver the same predicate, but
   * these reads are elevated ({@link SYSTEM_CTX}) precisely so they can see
   * rows no recipient could; more decisively, `driver-memory` and
   * `driver-mongodb` implement no `applyTenantScope` layer at all, so a screen
   * that existed only inside the SQL family would be no screen. The predicate
   * is written where the decision is, and it is the same one the driver writes.
   *
   * ⛔ This is NOT the screen the MEMBER rows get — see {@link memberScope},
   * which is strict on purpose. The asymmetry is the whole point of #14547,
   * and both halves are pinned (`business-unit-graph.test.ts`,
   * `recipient-width.test.ts`).
   */
  private orgScope(filter: Record<string, unknown>): Record<string, unknown> {
    if (!this.organizationId) return filter;
    return {
      ...filter,
      $or: [{ organization_id: this.organizationId }, { organization_id: null }],
    };
  }

  /**
   * [#14547] The MEMBER screen — STRICT equality, deliberately not
   * {@link orgScope}.
   *
   * ## Why the member rows are screened at all
   *
   * Both member reads used to carry no organization predicate whatever, under
   * a {@link SYSTEM_CTX} that carries no tenant either — so the query was
   * completely unscoped by organization. That was survivable only because the
   * strict equality {@link orgScope} used to apply kept an org-stamped rule
   * from ever reaching a seeded unit. Widening the unit screen ALONE would
   * therefore have converted a silent UNDER-grant into a silent CROSS-TENANT
   * OVER-grant: a seeded unit id exists identically in every tenant, so tenant
   * A's rule would expand to tenant B's members and materialise real
   * `sys_record_share` rows for them. The bug was moonlighting as the tenant
   * guard, and removing a screen from the only place it was being enforced is
   * not a fix.
   *
   * ## Why STRICT, when the unit screen is null-inclusive
   *
   * The two rows answer different questions. The unit is the ANCHOR the rule's
   * author named by id, and a NULL organization on it is the documented
   * platform/seeded class the driver's NULL arm exists for. A member row is
   * part of the SET BEING GRANTED — enumerated by the platform rather than
   * named by anyone — and its organization is the only tenancy fact it carries.
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
   * whose unit AND memberships were both seeded still expands to nobody. That
   * outcome is now LOUD — `SharingRuleService.expandRecipient` warns once per
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

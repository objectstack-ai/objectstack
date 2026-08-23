// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ITeamGraphService } from '@objectstack/spec/contracts';
import type { SharingEngine } from './sharing-service.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

type Cache = {
  expandUsers?: Map<string, string[]>;
  expandRole?: Map<string, string[]>;
  /**
   * [#10231] Keyed `org::userId`, NOT bare `userId`. The answer is now
   * org-dependent (a manager across a tenant boundary is screened out), so a
   * user-only key would serve one caller's screened `null` to the next caller
   * that asked without an organization — turning a screen into a permanent
   * outage for every unscoped reader that happened to run second. Mirrors the
   * composite key {@link Cache.expandRole} has carried for the same reason.
   */
  manager?: Map<string, string | null>;
};

export interface TeamGraphOptions {
  engine: SharingEngine;
  /** Optional tenant scope; null means cross-tenant lookups. */
  organizationId?: string | null;
  /** Optional shared cache across one evaluator pass. */
  cache?: Cache;
}

/**
 * Default {@link ITeamGraphService} implementation backed by
 * `sys_team` + `sys_team_member` (better-auth's flat collaboration
 * grouping) plus `sys_member.role` for tenant role expansion.
 *
 * **This service does NOT walk a hierarchy.** Teams here are flat —
 * the enterprise org chart lives in `sys_business_unit` and is served by
 * {@link BusinessUnitGraphService}.
 *
 * All queries elevate to {@link SYSTEM_CTX} since the graph is platform
 * metadata; callers (sharing rule evaluator, approval engine) own their
 * own enforcement.
 */
/**
 * Is `managerId` PROVABLY a member of other organizations and not of
 * `organizationId`? (#10231)
 *
 * This is the screen `ITeamGraphService.managerOf`'s declared `organizationId`
 * parameter asks for. It is deliberately the SAME shape #10153 landed for the
 * identical column on the approvals side (`managerIsProvablyOutsideOrg` in
 * `plugin-approvals`): both are consumers of one fact — `sys_user.manager_id` —
 * and a screen that differed between them would route an approval one way and
 * share a record the other.
 *
 * ## Why this reads `sys_member` instead of filtering the `sys_user` read
 *
 * `sys_user` carries NO `organization_id`. It is the global better-auth
 * identity table (`managedBy: 'better-auth'`, `protection.lock: 'full'`,
 * ADR-0010 section 3.7), so a membership row is the only tenancy fact that
 * exists for a user. Adding `organization_id` to the `sys_user` predicate is
 * not a tighter version of this screen, it is a broken one: the column does
 * not exist, so the predicate matches NOTHING and every manager lookup given
 * an organization returns null. That failure is SILENT — the surrounding
 * `catch` swallows the driver's complaint — which is exactly why the screen is
 * a second, explicit read rather than one more key in the first one.
 *
 * ## Why "provably outside" rather than "must prove membership"
 *
 *   - membership rows exist for this user, none in the caller's org
 *       => the tenancy fact is present and NEGATIVE => screen him out;
 *   - no membership rows at all, or the read failed
 *       => the tenancy fact is ABSENT => leave the answer exactly as it was.
 *
 * The fail-open half is the ruled posture for this column (#10153), not
 * timidity, and it is load-bearing: a stack that stamps an organization on its
 * callers but never materializes `sys_member` rows would otherwise lose every
 * manager at once — a far bigger behaviour change than the hole being closed.
 *
 * ⛔ Not exported from the package index. This is the screen's ONE
 * implementation, shared with {@link BusinessUnitGraphService}'s standalone
 * fallback so the two cannot drift; it is not a public affordance.
 */
export async function managerIsProvablyOutsideOrg(
  engine: SharingEngine,
  managerId: string,
  organizationId?: string | null,
): Promise<boolean> {
  const callerOrg = organizationId ? String(organizationId) : '';
  // No organization in play => nothing to screen against, and NO read. The
  // ordinary single-organization / embedded stack pays nothing here, and the
  // absent-organization path stays byte-identical to its pre-#10231 shape.
  if (!callerOrg) return false;
  let rows: any[] = [];
  try {
    rows = await engine.find('sys_member', {
      where: { user_id: managerId },
      fields: ['user_id', 'organization_id'],
      limit: 1000,
      context: SYSTEM_CTX,
    });
  } catch {
    return false; // membership unreadable — see the fail-open note above
  }
  const orgs = (rows ?? [])
    .map((r: any) => String(r?.organization_id ?? ''))
    .filter(Boolean);
  if (!orgs.length) return false;          // no tenancy fact recorded for this user
  return !orgs.includes(callerOrg);        // member here => route as before
}

export class TeamGraphService implements ITeamGraphService {
  private readonly engine: SharingEngine;
  private readonly organizationId: string | null;
  private readonly cache: Cache;

  constructor(opts: TeamGraphOptions) {
    this.engine = opts.engine;
    this.organizationId = opts.organizationId ?? null;
    this.cache = opts.cache ?? {};
    this.cache.expandUsers ??= new Map();
    this.cache.expandRole ??= new Map();
    this.cache.manager ??= new Map();
  }

  async expandUsers(teamId: string): Promise<string[]> {
    if (!teamId) return [];
    const cached = this.cache.expandUsers!.get(teamId);
    if (cached) return cached;

    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_team_member', {
        where: { team_id: teamId },
        fields: ['user_id'],
        limit: 10000,
        context: SYSTEM_CTX,
      });
    } catch {
      rows = [];
    }
    const users = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id ?? '')).filter(Boolean)));
    this.cache.expandUsers!.set(teamId, users);
    return users;
  }

  async expandRoleUsers(roleName: string, organizationId?: string): Promise<string[]> {
    if (!roleName) return [];
    const key = `${organizationId ?? this.organizationId ?? '*'}::${roleName}`;
    const cached = this.cache.expandRole!.get(key);
    if (cached) return cached;
    const filter: Record<string, unknown> = { role: roleName };
    const org = organizationId ?? this.organizationId;
    if (org) filter.organization_id = org;
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_member', {
        filter,
        fields: ['user_id'],
        limit: 10000,
        context: SYSTEM_CTX,
      });
    } catch {
      rows = [];
    }
    const users = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id ?? '')).filter(Boolean)));
    this.cache.expandRole!.set(key, users);
    return users;
  }

  /**
   * [#10231] The declared `organizationId` is HONOURED, not discarded.
   *
   * It used to be spelled `_organizationId` — accepted and dropped — while the
   * sibling {@link TeamGraphService.expandRoleUsers} on this same class applied
   * `organization_id` to its read. That asymmetry was not a considered posture:
   * the two methods differ only in which table backs them, and `sys_user`
   * (unlike `sys_member`) has no organization column to filter on. The tenancy
   * fact lives one table over; see {@link managerIsProvablyOutsideOrg}.
   *
   * Resolution order matches `expandRoleUsers` exactly — the argument, else the
   * instance's `organizationId`, else no screen at all.
   */
  async managerOf(userId: string, organizationId?: string): Promise<string | null> {
    if (!userId) return null;
    const org = organizationId ?? this.organizationId;
    const key = `${org ?? '*'}::${userId}`;
    if (this.cache.manager!.has(key)) return this.cache.manager!.get(key) ?? null;
    let row: any = null;
    try {
      const rows = await this.engine.find('sys_user', {
        where: { id: userId },
        fields: ['id', 'manager_id'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      row = Array.isArray(rows) ? rows[0] : null;
    } catch {
      row = null;
    }
    let mgr = row?.manager_id ? String(row.manager_id) : null;
    if (mgr && (await managerIsProvablyOutsideOrg(this.engine, mgr, org))) mgr = null;
    this.cache.manager!.set(key, mgr);
    return mgr;
  }
}

/**
 * Convenience helper used by the sharing-rule evaluator + approval
 * engine: expand an approver / recipient descriptor of the form
 * `{type, value}` into a flat list of user IDs by routing to the
 * appropriate graph service.
 *
 * `team` → flat team members (this service).
 * `department` → recursive department members (delegated; requires a
 *   {@link IBusinessUnitGraphService} instance passed in `opts.dept`).
 * `role` → tenant role members.
 * `manager` → submitter's manager via `record[value] ?? record.owner_id`.
 * `field` → literal user id stored in `record[value]`.
 * `user` → literal value.
 * Anything else echoes `type:value` for back-compat with legacy
 * substring-match approver flows.
 */
export async function expandPrincipal(
  input: { type: string; value: string; record?: any },
  ctx: { team: TeamGraphService; dept?: { expandUsers(id: string): Promise<string[]> }; organizationId?: string | null },
): Promise<string[]> {
  const t = input.type;
  const v = String(input.value ?? '');
  if (!v) return [];
  if (t === 'user') return [v];
  if (t === 'team') return ctx.team.expandUsers(v);
  if (t === 'business_unit' || t === 'bu') {
    if (ctx.dept) return ctx.dept.expandUsers(v);
    return [`${t}:${v}`];
  }
  if (t === 'role') return ctx.team.expandRoleUsers(v, ctx.organizationId ?? undefined);
  if (t === 'field' && input.record) {
    const fv = (input.record as any)[v];
    return fv ? [String(fv)] : [];
  }
  if (t === 'manager' && input.record) {
    const subject = (input.record as any)[v] ?? (input.record as any).owner_id;
    if (!subject) return [];
    const mgr = await ctx.team.managerOf(String(subject), ctx.organizationId ?? undefined);
    return mgr ? [mgr] : [];
  }
  // queue / unknown — fall back to raw prefix string so existing
  // string-match approver flows keep working.
  return [`${t}:${v}`];
}

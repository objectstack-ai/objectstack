// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ITeamGraphService } from '@objectstack/spec/contracts';
import { isMissingTableError, keysetWalk } from '@objectstack/types';
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

/**
 * The `sys_team_member` predicate "the members of `teamId`" — ONE spelling for
 * the rule-wide expansion ({@link TeamGraphService.expandUsers}) and the
 * user-scoped membership check ({@link teamHasMember}), so the two can never
 * disagree about who is a member.
 */
function teamMemberPredicate(teamId: string): Record<string, unknown> {
  return { team_id: teamId };
}

/**
 * The `sys_member` predicate "holders of role `roleName`", scoped to `org` when
 * one is given — ONE spelling for {@link TeamGraphService.expandRoleUsers} and
 * {@link holdsRole}.
 */
function roleHolderPredicate(roleName: string, org: string | null | undefined): Record<string, unknown> {
  const filter: Record<string, unknown> = { role: roleName };
  if (org) filter.organization_id = org;
  return filter;
}

/**
 * [#29362] Rows per page of the role-holder read — the bound the read always
 * carried, so a role held by fewer people issues the one read it always did.
 */
const ROLE_HOLDER_PAGE_ROWS = 10000;

/**
 * [#29362] Every holder of `roleName` (in `org`, when given), read to
 * completion — or a refusal, never a shortened or an invented empty set.
 *
 * Pages of {@link ROLE_HOLDER_PAGE_ROWS} through the platform's one keyset
 * walk (`keysetWalk`, `@objectstack/types`): ordered by `id`, each page
 * resuming after the last id the one before it returned, so a role held past
 * the bound is read whole rather than cut at an arbitrary 10,000 rows.
 *
 * Loud, never short. The set feeds sharing GRANTS, and the reconcilers diff the
 * grants a rule already holds against it — an answer missing a holder revokes
 * that holder's access, and an invented `[]` revokes everyone's. So:
 *
 *   - a read that fails throws, carrying the driver's error as `cause`;
 *   - a walk that cannot vouch for completion (a row without an `id` to resume
 *     after, a page the driver returned without honouring the cursor) throws;
 *   - a membership object that does not exist is the one failure that IS an
 *     answer — a stack that never materialises `sys_member` has no role
 *     holders — and answers `[]` as it always did; see
 *     {@link membershipObjectAbsent}.
 */
/**
 * [#29362] Did the role read fail because this stack has no `sys_member` at
 * all — the one failure whose empty answer is the truth? Two spellings of the
 * same absence, each attributed to `sys_member` so a failure about another
 * object is not evidence about this one: the driver's missing-table refusal
 * (the shared `isMissingTableError`, the table registered but never created),
 * and the engine's `OBJECT_NOT_FOUND` (a composition that never registers the
 * object, refused before any driver is asked — the reading
 * `sys-metadata-repository.ts` gives its own history object). Anything else
 * is an outage and stays loud.
 */
function membershipObjectAbsent(err: unknown): boolean {
  if (isMissingTableError(err, 'sys_member')) return true;
  const refused = err as { code?: unknown; object?: unknown } | null | undefined;
  return refused?.code === 'OBJECT_NOT_FOUND' && refused.object === 'sys_member';
}

async function readRoleHoldersToCompletion(
  engine: SharingEngine,
  roleName: string,
  org: string | null | undefined,
): Promise<string[]> {
  const refusal = (reason: string, cause?: unknown) => Object.assign(new Error(
    `[sharing] the holders of role '${roleName}'${org ? ` in organization '${org}'` : ''} could not be read: `
      + `${reason}. A shortened or empty holder set would withhold or revoke the grants it confers, so the `
      + 'expansion refuses instead.',
  ), cause === undefined ? {} : { cause });
  const users = new Set<string>();
  const walk = keysetWalk<Record<string, unknown>>(
    (page) => engine.find('sys_member', { ...page, fields: ['id', 'user_id'], context: SYSTEM_CTX }),
    { where: roleHolderPredicate(roleName, org), pageSize: ROLE_HOLDER_PAGE_ROWS },
  );
  try {
    for await (const page of walk.pages()) {
      for (const row of page) {
        const uid = String(row?.user_id ?? '');
        if (uid) users.add(uid);
      }
    }
  } catch (err) {
    if (membershipObjectAbsent(err)) return [];
    throw refusal(err instanceof Error ? err.message : String(err), err);
  }
  if (walk.truncated) {
    throw refusal('the read by id could not continue past a page (a row without an id, or a page that repeated the cursor)');
  }
  return Array.from(users);
}

/**
 * Is `userId` a member of `teamId`? The user-scoped twin of
 * {@link TeamGraphService.expandUsers}: the same table and the same predicate,
 * narrowed to one user, so the answer is `expandUsers(teamId).includes(userId)`
 * read in one indexed lookup instead of the whole membership list.
 *
 * Exists for the recipient-membership recompute (`recipient-membership-recompute.ts`),
 * which re-evaluates a team rule for the ONE user whose membership row was
 * written — a write path, where reading every member of the team per written
 * row would make a bulk membership import quadratic. A failed read answers
 * `false`, exactly as the expansion answers `[]`.
 *
 * ⛔ Not exported from the package index — an internal seam, not a public
 * affordance of {@link TeamGraphService}.
 */
export async function teamHasMember(engine: SharingEngine, teamId: string, userId: string): Promise<boolean> {
  if (!teamId || !userId) return false;
  try {
    const rows = await engine.find('sys_team_member', {
      where: { ...teamMemberPredicate(teamId), user_id: userId },
      fields: ['user_id'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    return (rows ?? []).some((r: any) => String(r?.user_id ?? '') === userId);
  } catch {
    return false;
  }
}

/**
 * Does `userId` hold role `roleName` (in `organizationId`, when given)? The
 * user-scoped twin of {@link TeamGraphService.expandRoleUsers}, for the same
 * reason and with the same failure answer as {@link teamHasMember}. Its one
 * caller is `PositionGraphService.holdsPosition`, which reads the role column as
 * the position transition source (ADR-0057 D4 addendum).
 *
 * ⛔ Not exported from the package index.
 */
export async function holdsRole(
  engine: SharingEngine,
  roleName: string,
  userId: string,
  organizationId?: string | null,
): Promise<boolean> {
  if (!roleName || !userId) return false;
  try {
    const rows = await engine.find('sys_member', {
      filter: { ...roleHolderPredicate(roleName, organizationId), user_id: userId },
      fields: ['user_id'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    return (rows ?? []).some((r: any) => String(r?.user_id ?? '') === userId);
  } catch {
    return false;
  }
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
        where: teamMemberPredicate(teamId),
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
    const org = organizationId ?? this.organizationId;
    // [#29362] Read to completion, and a failed read throws — so nothing is
    // cached for it, and the next caller reads again.
    const users = await readRoleHoldersToCompletion(this.engine, roleName, org);
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

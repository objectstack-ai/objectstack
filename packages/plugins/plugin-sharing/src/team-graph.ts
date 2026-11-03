// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ITeamGraphService } from '@objectstack/spec/contracts';
import { isObjectAbsentError, keysetWalk } from '@objectstack/types';
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
 * [#29362, #29503] Rows per page of a membership read — the bound each read
 * always carried, so a recipient held by fewer people issues the one read it
 * always did, and one held by more is read in further pages rather than cut.
 */
const MEMBERSHIP_PAGE_ROWS = 10000;

/**
 * What a refused read was for, which decides how its refusal words the
 * consequence: a holder-set `expansion`, a user-scoped holder `check`, or a
 * `lookup` of the one person a head or manager column names.
 */
type HolderReadKind = 'expansion' | 'check' | 'lookup';

/**
 * [#29503] Why a holder read refused, as one sentence family: what could not
 * be read, the reason, and why the answer is a refusal rather than "nobody".
 * The driver's error rides along as `cause`.
 *
 * [#29792] A `lookup` reads one person (a unit's head, a user's manager), not
 * a set of holders, so its refusal says so: answering "none" would drop that
 * person from whatever the caller routes through the answer.
 */
function holderReadRefusal(subject: string, reason: string, cause: unknown, kind: HolderReadKind): Error {
  const consequence = kind === 'expansion'
    ? 'A shortened or empty holder set would withhold or revoke the grants it confers, so the expansion refuses instead.'
    : kind === 'check'
      ? 'Answering "not a holder" would revoke the grants the holding confers, so the check refuses instead.'
      : 'Answering "none" would drop the person it names from everything routed through the answer, so the lookup refuses instead.';
  return Object.assign(
    new Error(`[sharing] ${subject} could not be read: ${reason}. ${consequence}`),
    cause === undefined ? {} : { cause },
  );
}

/** The reason text for a keyset walk that could not vouch for completion. */
const WALK_INCOMPLETE = 'the read by id could not continue past a page (a row without an id, or a page that repeated the cursor)';

/**
 * [#29362, #29503] Every row of `object` matching `where`, read to completion —
 * or a refusal, never a shortened or an invented empty set; `null` when the
 * object does not exist on this stack.
 *
 * Pages of {@link MEMBERSHIP_PAGE_ROWS} (or `pageRows`) through the platform's
 * one keyset walk (`keysetWalk`, `@objectstack/types`): ordered by `id`, each
 * page resuming after the last id the one before it returned, so a recipient
 * held past the bound is read whole rather than cut at an arbitrary row.
 *
 * Loud, never short. These sets feed sharing GRANTS, and the reconcilers diff
 * the grants a rule already holds against them — an answer missing a holder
 * revokes that holder's access, and an invented `[]` revokes everyone's. So:
 *
 *   - a read that fails throws, carrying the driver's error as `cause`;
 *   - a walk that cannot vouch for completion (a row without an `id` to resume
 *     after, a page the driver returned without honouring the cursor) throws;
 *   - a membership object that does not exist is the one failure that IS an
 *     answer — a stack that never materialises it has no holders through it —
 *     and answers `null`, so each caller says what absence means for it
 *     (`isObjectAbsentError`, `@objectstack/types`).
 *
 * ⛔ Not exported from the package index — the one walk the team, role,
 * position and business-unit member reads share (#29606), not a public
 * affordance.
 */
export async function readMembershipToCompletion(
  engine: SharingEngine,
  read: {
    object: string;
    where: Record<string, unknown>;
    fields: readonly string[];
    subject: string;
    pageRows?: number;
    /**
     * A user-scoped holder check words its refusal as a check, and a single
     * head or manager lookup as a lookup; the default is an expansion.
     */
    kind?: HolderReadKind;
  },
): Promise<Record<string, unknown>[] | null> {
  const rows: Record<string, unknown>[] = [];
  const walk = keysetWalk<Record<string, unknown>>(
    (page) => engine.find(read.object, { ...page, fields: ['id', ...read.fields], context: SYSTEM_CTX }),
    { where: read.where, pageSize: read.pageRows ?? MEMBERSHIP_PAGE_ROWS },
  );
  try {
    for await (const page of walk.pages()) rows.push(...page);
  } catch (err) {
    if (isObjectAbsentError(err, read.object)) return null;
    throw holderReadRefusal(read.subject, err instanceof Error ? err.message : String(err), err, read.kind ?? 'expansion');
  }
  if (walk.truncated) throw holderReadRefusal(read.subject, WALK_INCOMPLETE, undefined, read.kind ?? 'expansion');
  return rows;
}

/**
 * [#29503] One user-scoped holder probe (`limit: 1`): does any row of `object`
 * match `where`? A one-row existence probe is not cut by its bound, so only its
 * failure answer changed: absence of the object answers `false` (no holders
 * through it), and every other failure refuses — "not a holder" on an outage is
 * what made the per-user recompute revoke a holder's grants.
 *
 * ⛔ Not exported from the package index.
 */
export async function probeMembership(
  engine: SharingEngine,
  probe: { object: string; filter: Record<string, unknown>; fields: readonly string[]; subject: string; limit?: number },
): Promise<Record<string, unknown>[]> {
  try {
    const rows = await engine.find(probe.object, {
      filter: probe.filter,
      fields: [...probe.fields],
      limit: probe.limit ?? 1,
      context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (isObjectAbsentError(err, probe.object)) return [];
    throw holderReadRefusal(probe.subject, err instanceof Error ? err.message : String(err), err, 'check');
  }
}

/** The user ids `rows` carry, de-duplicated, in first-seen order. */
function userIdsOf(rows: readonly Record<string, unknown>[]): string[] {
  const users = new Set<string>();
  for (const row of rows) {
    const uid = String(row?.user_id ?? '');
    if (uid) users.add(uid);
  }
  return Array.from(users);
}

/**
 * [#29362] Every holder of `roleName` (in `org`, when given), read to
 * completion through {@link readMembershipToCompletion}. A stack with no
 * `sys_member` has no role holders and answers `[]` as it always did.
 */
async function readRoleHoldersToCompletion(
  engine: SharingEngine,
  roleName: string,
  org: string | null | undefined,
): Promise<string[]> {
  const rows = await readMembershipToCompletion(engine, {
    object: 'sys_member',
    where: roleHolderPredicate(roleName, org),
    fields: ['user_id'],
    subject: `the holders of role '${roleName}'${org ? ` in organization '${org}'` : ''}`,
  });
  return rows ? userIdsOf(rows) : [];
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
 * row would make a bulk membership import quadratic. [#29503] A failed read
 * refuses, exactly as the expansion does: the recompute's per-user catch then
 * logs and the user's grants stay, where a `false` revoked them on an outage.
 * A stack with no `sys_team_member` answers `false`.
 *
 * ⛔ Not exported from the package index — an internal seam, not a public
 * affordance of {@link TeamGraphService}.
 */
export async function teamHasMember(engine: SharingEngine, teamId: string, userId: string): Promise<boolean> {
  if (!teamId || !userId) return false;
  const rows = await probeMembership(engine, {
    object: 'sys_team_member',
    filter: { ...teamMemberPredicate(teamId), user_id: userId },
    fields: ['user_id'],
    subject: `whether user '${userId}' is a member of team '${teamId}'`,
  });
  return rows.some((r: any) => String(r?.user_id ?? '') === userId);
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
  const rows = await probeMembership(engine, {
    object: 'sys_member',
    filter: { ...roleHolderPredicate(roleName, organizationId), user_id: userId },
    fields: ['user_id'],
    subject: `whether user '${userId}' holds role '${roleName}'${organizationId ? ` in organization '${organizationId}'` : ''}`,
  });
  return rows.some((r: any) => String(r?.user_id ?? '') === userId);
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

    // [#29503] Read to completion, and a failed read throws — so nothing is
    // cached for it, and the next caller reads again. A stack with no
    // `sys_team_member` has no team members.
    const rows = await readMembershipToCompletion(this.engine, {
      object: 'sys_team_member',
      where: teamMemberPredicate(teamId),
      fields: ['user_id'],
      subject: `the members of team '${teamId}'`,
    });
    const users = rows ? userIdsOf(rows) : [];
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
   *
   * [#29792] The `sys_user` read goes through {@link readMembershipToCompletion}
   * as a `lookup`, the read `BusinessUnitGraphService`'s standalone fallback
   * uses: a read that FAILS throws and nothing is cached for it, so the next
   * caller on the same pass reads again. It caught any error to `null` ("no
   * manager") and cached that `null` under `org::userId` for the pass, so a
   * consumer naming "the owner's manager" dropped the manager on an outage and
   * kept dropping it after the read recovered. A stack that never materialises
   * `sys_user` has no manager on file and answers `null`. The organization
   * screen keeps its ruled fail-open posture ({@link managerIsProvablyOutsideOrg}).
   */
  async managerOf(userId: string, organizationId?: string): Promise<string | null> {
    if (!userId) return null;
    const org = organizationId ?? this.organizationId;
    const key = `${org ?? '*'}::${userId}`;
    if (this.cache.manager!.has(key)) return this.cache.manager!.get(key) ?? null;
    const rows = await readMembershipToCompletion(this.engine, {
      object: 'sys_user',
      where: { id: userId },
      fields: ['manager_id'],
      subject: `the manager of user '${userId}'`,
      kind: 'lookup',
    });
    const row = rows?.[0];
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

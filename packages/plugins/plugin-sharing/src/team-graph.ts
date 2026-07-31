// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ITeamGraphService } from '@objectstack/spec/contracts';
import type { SharingEngine } from './sharing-service.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

type Cache = {
  expandUsers?: Map<string, string[]>;
  expandRole?: Map<string, string[]>;
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

  async managerOf(userId: string, _organizationId?: string): Promise<string | null> {
    if (!userId) return null;
    if (this.cache.manager!.has(userId)) return this.cache.manager!.get(userId) ?? null;
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
    const mgr = row?.manager_id ? String(row.manager_id) : null;
    this.cache.manager!.set(userId, mgr);
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

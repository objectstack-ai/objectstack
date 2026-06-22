// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IBusinessUnitGraphService } from '@objectstack/spec/contracts';
import type { SharingEngine } from './sharing-service.js';
import { TeamGraphService } from './team-graph.js';

const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;

type DeptCache = {
  descendants?: Map<string, string[]>;
  expandUsers?: Map<string, string[]>;
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
    this.cache.head ??= new Map();
    this.teamGraph = opts.teamGraph;
  }

  async descendants(businessUnitId: string): Promise<string[]> {
    if (!businessUnitId) return [];
    const cached = this.cache.descendants!.get(businessUnitId);
    if (cached) return cached;

    // Verify seed itself is active + within tenant scope.
    let seedActive = true;
    try {
      const seedRows = await this.engine.find('sys_business_unit', {
        where: this.orgScope({ id: businessUnitId }),
        fields: ['id', 'active'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      const seedRow: any = Array.isArray(seedRows) ? seedRows[0] : null;
      if (!seedRow) seedActive = false;
      else if (seedRow.active === false) seedActive = false;
    } catch {
      seedActive = false;
    }
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

  async expandUsers(businessUnitId: string): Promise<string[]> {
    if (!businessUnitId) return [];
    const cached = this.cache.expandUsers!.get(businessUnitId);
    if (cached) return cached;

    const units = await this.descendants(businessUnitId);
    if (units.length === 0) return [];

    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_business_unit_member', {
        where: { business_unit_id: { $in: units } },
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

  async managerOf(userId: string, organizationId?: string): Promise<string | null> {
    if (this.teamGraph) return this.teamGraph.managerOf(userId, organizationId);
    // Standalone fallback: read sys_user.manager_id directly.
    if (!userId) return null;
    try {
      const rows = await this.engine.find('sys_user', {
        where: { id: userId },
        fields: ['id', 'manager_id'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      const row: any = Array.isArray(rows) ? rows[0] : null;
      return row?.manager_id ? String(row.manager_id) : null;
    } catch {
      return null;
    }
  }

  private orgScope(filter: Record<string, unknown>): Record<string, unknown> {
    if (this.organizationId) return { ...filter, organization_id: this.organizationId };
    return filter;
  }
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6206 / #6430 ruling A] The `group`-posture repro: minting a share link for
 * a record the caller can read.
 *
 * ## Why this file lives in plugin-SECURITY
 *
 * The defect is a seam in `@objectstack/plugin-sharing` (its share-link routes
 * rebuilt a four-field subset of the `resolveAuthzContext` envelope and fed it
 * to `engine.find` as the [Finding-2] visibility check's context), but the
 * VERDICT that made it a 403 is computed here: `computeTenantLayer0Filter`
 * reads `ExecutionContext.accessible_org_ids` and, under the `group` posture,
 * an absent/empty set denies (ADR-0105 D2, fail closed). Proving the bug
 * therefore needs both packages in one process, and this is the one that owns
 * the wall — plugin-security already depends on plugin-sharing for the same
 * reason (`controlled-by-parent-sharing.test.ts`,
 * `vama-write-path-convergence.test.ts`), never the other way round.
 *
 * ## What is real here and what is a double
 *
 * REAL: the plugin's own route wiring and context assembly (the plugin is
 * booted, so the closure under test is the production one), the share-link
 * service, and the tenant wall — `computeTenantLayer0Filter` is called with the
 * context the route actually produced, exactly as `security-plugin.ts` calls it
 * on a read.
 *
 * DOUBLE: storage. The engine below is an in-memory table set that applies the
 * wall the same way the security middleware does — AND-composed first, on a
 * non-system context — so `RLS_DENY_FILTER` denies by being an unmatchable
 * predicate rather than by a special case, which is how it denies in
 * production.
 *
 * ## Before/after, recorded
 *
 * With the four-field assembly restored in plugin-sharing, `groupPostureMint`
 * answers 403 (`FORBIDDEN: Not permitted to share crm_account/acc_1`) — the
 * card's repro — while the `single`-posture case stays 201. After the fix the
 * `group` case is 201 and the `single` case is unchanged. The third case is the
 * one that keeps the fix honest: a caller with no membership in the record's
 * organization must STILL be refused, because the envelope was widened, not the
 * authority.
 */

import { describe, it, expect, vi } from 'vitest';
// The producers' OWN dispatch predicates for the double's write verbs, from
// `@objectstack/metadata-core` (where they live since #5619) — this package
// does not depend on `@objectstack/objectql`, and taking that edge to reach the
// re-export would be a cycle turbo refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { TenancyPosture } from '@objectstack/spec/security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { computeTenantLayer0Filter } from './tenant-layer.js';

const BASE = '/api/v1/share-links';
const OBJECT = 'crm_account';
const RECORD = 'acc_1';
const ORG_A = 'org_plant_a';
const ORG_B = 'org_plant_b';

/** Objects that carry `organization_id` — the wall's "is this a tenant object?" input. */
const TENANT_OBJECTS = new Set([OBJECT]);

function matches(row: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
    if (v && typeof v === 'object' && '$in' in v) return (v as any).$in.includes(row[k]);
    return row[k] === v;
  });
}

/**
 * An engine that enforces Layer 0 exactly as the security middleware does: the
 * REAL `computeTenantLayer0Filter`, fed the caller's context, AND-composed onto
 * the query's own predicate. A system context bypasses it, as it does in
 * production.
 */
function makeEngine(tables: Record<string, any[]>, posture: TenancyPosture) {
  return {
    async find(object: string, opts: any) {
      const ctx = opts?.context ?? {};
      let rows = tables[object] ?? [];
      if (!ctx.isSystem && TENANT_OBJECTS.has(object)) {
        const layer0 = computeTenantLayer0Filter({
          tenancyPosture: posture,
          organizationId: ctx.tenantId,
          // [ADR-0105 D2] The `group` wall's predicate — the field the
          // share-link route used to drop before this call could see it.
          accessibleOrgIds: ctx.accessible_org_ids,
          objectHasOrgIdField: true,
          tenancyDisabled: false,
          posturePermitsCrossTenant: false,
          isPlatformAdmin: false,
        });
        if (layer0) rows = rows.filter((r) => matches(r, layer0));
      }
      return rows.filter((r) => matches(r, opts?.where ?? {}));
    },
    async insert(object: string, row: any) {
      (tables[object] ??= []).push(row);
      return row;
    },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = tables[object] ?? [];
      if (dispatch.kind === 'by-id') {
        const i = rows.findIndex((r) => r.id === dispatch.id);
        if (i >= 0) rows[i] = { ...rows[i], ...data };
        return data;
      }
      const matched = rows.filter((r) => matches(r, options?.where ?? {}));
      for (const r of matched) Object.assign(r, data);
      return matched.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = tables[object] ?? [];
      if (dispatch.kind === 'by-id') {
        const before = rows.length;
        tables[object] = rows.filter((r) => r.id !== dispatch.id);
        return tables[object].length < before;
      }
      const matched = rows.filter((r) => matches(r, options?.where ?? {}));
      tables[object] = rows.filter((r) => !matched.includes(r));
      return matched.length;
    },
    getSchema(object: string) {
      return object === OBJECT
        ? {
            name: OBJECT,
            publicSharing: {
              enabled: true,
              allowedAudiences: ['link_only'],
              allowedPermissions: ['view'],
            },
          }
        : { name: object };
    },
  };
}

class MockHttp {
  routes = new Map<string, any>();
  private add(method: string, path: string, handler: any) { this.routes.set(`${method} ${path}`, handler); }
  get(path: string, h: any) { this.add('GET', path, h); return this as any; }
  post(path: string, h: any) { this.add('POST', path, h); return this as any; }
  put(path: string, h: any) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: any) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: any) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

interface MintOptions {
  /** The tenancy posture in force for this deployment. */
  posture: TenancyPosture;
  /** Organizations the caller holds a `sys_member` row in. */
  memberOf: string[];
  /** The record's owning organization. */
  recordOrg?: string;
}

/**
 * Boot the real `SharingServicePlugin` and POST `/api/v1/share-links` for
 * `crm_account/acc_1` as a signed-in member — the exact call a user makes from
 * the record page's "share" button.
 */
async function groupPostureMint(opts: MintOptions): Promise<{ status: number; body: any }> {
  const userId = 'u_sharer';
  const activeOrg = opts.memberOf[0];
  const tables: Record<string, any[]> = {
    sys_user: [{ id: userId, email: 'sharer@example.com' }],
    sys_member: opts.memberOf.map((org, i) => ({
      id: `mem_${i}`,
      user_id: userId,
      organization_id: org,
      role: 'member',
    })),
    sys_user_position: [],
    sys_user_permission_set: [],
    sys_permission_set: [],
    [OBJECT]: [{ id: RECORD, name: 'Acme', organization_id: opts.recordOrg ?? ORG_A }],
    sys_share_link: [],
  };

  const engine = makeEngine(tables, opts.posture);
  const http = new MockHttp();
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const ctx: any = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    hook: (event: string, handler: () => Promise<void> | void) => { (hooks[event] ??= []).push(handler); },
    getService: (name: string) => {
      if (name === 'objectql') return engine;
      if (name === 'http-server') return http;
      if (name === 'auth') {
        return {
          api: {
            getSession: async () => ({
              user: { id: userId, email: 'sharer@example.com' },
              session: { userId, activeOrganizationId: activeOrg },
            }),
          },
        };
      }
      throw new Error(`service not registered: ${name}`);
    },
    registerService: vi.fn(),
  };

  const plugin = new SharingServicePlugin({ enforce: false });
  await plugin.start(ctx);
  for (const handler of hooks['kernel:ready'] ?? []) await handler();

  const handler = http.routes.get(`POST ${BASE}`);
  if (!handler) throw new Error('share-link create route was not mounted');
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json: (data: any) => { captured.body = data; },
    send: () => undefined,
    status: (code: number) => { captured.status = code; return res; },
    header: () => res,
  };
  await handler(
    {
      params: {},
      query: {},
      body: { object: OBJECT, recordId: RECORD },
      headers: { cookie: 'better-auth.session_token=t' },
      method: 'POST',
      path: BASE,
    },
    res,
  );
  return captured;
}

describe('[#6206] share-link creation under the `group` tenancy posture', () => {
  it('mints a link for a record the caller can read (403 before the envelope was passed through whole)', async () => {
    const res = await groupPostureMint({ posture: 'group', memberOf: [ORG_A] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true });
    expect(res.body.data).toMatchObject({ object_name: OBJECT, record_id: RECORD });
    expect(typeof res.body.data.token).toBe('string');
  });

  it('still refuses a record OUTSIDE the caller org access set — the wall is live, not bypassed', async () => {
    // Same posture, same route, same code: the caller belongs to plant B and
    // the record belongs to plant A, so Layer 0's `$in` predicate excludes it
    // and the mint is refused. This is what separates "the envelope now
    // arrives" from "the check was disabled".
    const res = await groupPostureMint({ posture: 'group', memberOf: [ORG_B], recordOrg: ORG_A });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('reaches records across EVERY organization the caller belongs to (MOAC union)', async () => {
    const res = await groupPostureMint({ posture: 'group', memberOf: [ORG_B, ORG_A], recordOrg: ORG_A });
    expect(res.status).toBe(201);
  });

  it('`single` posture is unchanged — Layer 0 is inert there, before and after', async () => {
    const res = await groupPostureMint({ posture: 'single', memberOf: [ORG_A] });
    expect(res.status).toBe(201);
  });
});

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sys_user.primary_business_unit_id projection (ADR-0057 addendum D12).
 *
 * `sys_business_unit_member` is the effective-dated, matrix-friendly source of
 * truth for "which business units a user belongs to". But a lookup field can
 * only filter on the *target object's own columns* (`lookupFilters` /
 * `dependsOn`), and ObjectQL cannot traverse the membership junction inside a
 * single filter. So "pick people by business unit" — the Dataverse *filtered
 * lookup* / ServiceNow *reference qualifier* interaction — is not expressible
 * against `sys_user` unless the user row carries its BU directly.
 *
 * This module maintains a denormalised `sys_user.primary_business_unit_id`
 * (the member row flagged `is_primary`) so a plain `where:
 * { primary_business_unit_id: X }` works with **zero** query-engine change.
 * It is a *projection*, not a second source of truth: `sys_business_unit_member`
 * still owns matrix / effective-dated membership.
 *
 * Home: plugin-sharing — always loaded, owns the BU graph domain
 * (`BusinessUnitGraphService`), and already binds engine hooks on
 * `kernel:ready`. NOT plugin-org-scoping (that is multi-tenant-only; BU
 * membership is usable single-tenant too).
 */

import type { OptionalSharingLogger } from './logger-shapes.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export const PRIMARY_BU_HOOK_PACKAGE = 'plugin-sharing:primary-bu';

/** Shared-hookContext key: beforeDelete stashes the doomed row's user_id here
 * because afterDelete exposes neither `previous` nor the (now-gone) row. */
const STASH_KEY = '__primaryBuUserId';

interface MinimalEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => any | Promise<any>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  unregisterHooksByPackage(packageId: string): number;
  find(object: string, query?: any, options?: any): Promise<any[]>;
  update(object: string, data: any, options?: any): Promise<any>;
}

/** Recompute one user's primary_business_unit_id from their `is_primary` member
 * row (null when they have none). Idempotent. */
async function recompute(engine: MinimalEngine, userId: string, logger?: OptionalSharingLogger): Promise<void> {
  if (!userId) return;
  let buId: string | null = null;
  try {
    const rows = await engine.find('sys_business_unit_member', {
      where: { user_id: userId, is_primary: true },
      fields: ['business_unit_id'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    buId = rows?.[0]?.business_unit_id ?? null;
  } catch (err: any) {
    logger?.warn?.('[primary-bu] member lookup failed', { userId, error: err?.message });
    return;
  }
  try {
    await engine.update('sys_user', { id: userId, primary_business_unit_id: buId }, { context: SYSTEM_CTX });
  } catch (err: any) {
    logger?.warn?.('[primary-bu] sys_user update failed', { userId, error: err?.message });
  }
}

/** Affected user_ids reachable from a member-write hook context. */
function collectUserIds(ctx: any): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => { if (v != null && v !== '') ids.add(String(v)); };
  add(ctx?.result?.user_id);
  add(ctx?.previous?.user_id);
  // `input.data` is the ONE key a write hook's payload arrives under — measured
  // and pinned by objectql's `hook-input-shape-contract.test.ts` ("insert carries
  // `data` — never `doc`", #5273). An `input.doc` alias limb sat below this read
  // for a producer that never existed; removed in #5906 (same family as #5671)
  // rather than left as a second de-facto contract (PD #12).
  add(ctx?.input?.data?.user_id);
  add(ctx?.[STASH_KEY]);
  return [...ids];
}

/**
 * Bind insert/update/delete hooks on `sys_business_unit_member` that keep the
 * `sys_user.primary_business_unit_id` projection in step. Unlike the
 * sharing-rule hooks, these run for **system-context writes too** — the
 * projection must stay correct regardless of who mutates membership (seeds,
 * HRIS sync, admin UI).
 */
export function bindPrimaryBuHooks(engine: MinimalEngine, logger?: OptionalSharingLogger): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(PRIMARY_BU_HOOK_PACKAGE);
  }
  const opts = { object: 'sys_business_unit_member', packageId: PRIMARY_BU_HOOK_PACKAGE, priority: 150 };

  // afterDelete loses the row; capture user_id while it still exists. Same
  // hookContext instance is reused for before/afterDelete (engine.ts), so the
  // stash survives into the afterDelete handler below.
  engine.registerHook('beforeDelete', async (ctx: any) => {
    const id = ctx?.input?.id;
    if (!id) return;
    try {
      const rows = await engine.find('sys_business_unit_member', {
        where: { id }, fields: ['user_id'], limit: 1, context: SYSTEM_CTX,
      });
      const uid = rows?.[0]?.user_id;
      if (uid) ctx[STASH_KEY] = String(uid);
    } catch { /* best-effort — projection self-heals on next member write or boot backfill */ }
  }, opts);

  const sync = async (ctx: any) => {
    for (const uid of collectUserIds(ctx)) await recompute(engine, uid, logger);
  };
  engine.registerHook('afterInsert', sync, opts);
  engine.registerHook('afterUpdate', sync, opts);
  engine.registerHook('afterDelete', sync, opts);

  logger?.info?.('[primary-bu] projection hooks bound on sys_business_unit_member');
}

/**
 * One-time boot reconcile: set every user's primary_business_unit_id from their
 * `is_primary` member row, so pre-existing memberships (seeds, prior data)
 * project even though their inserts pre-dated the hooks. Idempotent.
 */
export async function backfillPrimaryBu(engine: MinimalEngine, logger?: OptionalSharingLogger): Promise<{ updated: number }> {
  let rows: any[] = [];
  try {
    rows = await engine.find('sys_business_unit_member', {
      where: { is_primary: true },
      fields: ['user_id', 'business_unit_id'],
      limit: 10000,
      context: SYSTEM_CTX,
    });
  } catch (err: any) {
    logger?.warn?.('[primary-bu] backfill scan failed', { error: err?.message });
    return { updated: 0 };
  }
  let updated = 0;
  for (const m of rows ?? []) {
    if (!m?.user_id) continue;
    try {
      await engine.update('sys_user', { id: m.user_id, primary_business_unit_id: m.business_unit_id }, { context: SYSTEM_CTX });
      updated++;
    } catch { /* skip one bad row, keep going */ }
  }
  if (updated > 0) logger?.info?.('[primary-bu] backfilled projection', { updated });
  return { updated };
}

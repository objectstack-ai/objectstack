// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8060] Position ↔ permission-set bindings for the CRM example.
 *
 * Mirrors `examples/app-showcase/src/security/bind-position-sets.ts` — see
 * that file for the full rationale. Short version: the permission model is
 * record-authoritative (ADR-0090/0094), bindings live only as
 * `sys_position_permission_set` rows, and this app declared three positions
 * (`sales_rep`, `sales_manager`, `finance_approver`) and a `crm_sales_user`
 * permission set that never met — every persona silently degraded to the
 * `everyone` baseline (probe-blocked on every CRM object) until an admin
 * hand-assigned the set.
 *
 * This cannot be a declarative SEED: the seed loader runs before the security
 * bootstrap creates the `sys_position` / `sys_permission_set` rows, so the
 * name references cannot resolve. We play the admin's part imperatively —
 * inserting each missing binding idempotently (dedup by position+set pair,
 * stable ids) — on `kernel:bootstrapped`, the anchor the kernel fires only
 * AFTER every `kernel:ready` handler (incl. the security bootstrap) has
 * settled.
 *
 * `crm_sales_user` is deliberately NOT marked `isDefault`: that would
 * auto-bind it to the `everyone` anchor and grant every user — including
 * ones holding none of the three positions — full CRUD on every CRM object,
 * which changes the example's security story instead of completing it
 * (ruling on #8060). Only the three declared positions get the set.
 */

const BINDINGS: ReadonlyArray<readonly [position: string, permissionSet: string]> = [
  ['sales_rep', 'crm_sales_user'],
  ['sales_manager', 'crm_sales_user'],
  ['finance_approver', 'crm_sales_user'],
];

const SYS = { isSystem: true } as const;

interface BindHostContext {
  ql: {
    find: (object: string, query: unknown, options?: unknown) => Promise<unknown>;
    insert: (object: string, data: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  };
  logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void };
  hook?: (event: string, handler: () => Promise<void> | void) => void;
}

/** Find one row by `name`, passing the system context the way the engine's own
 * read path expects it (merged from `query.context`; see objectql `find`). */
async function findOneByName(ctx: BindHostContext, object: string, name: string): Promise<{ id?: string } | undefined> {
  try {
    const rows = (await ctx.ql.find(object, { where: { name }, limit: 1, context: SYS })) as
      | Array<{ id?: string }>
      | { records?: Array<{ id?: string }> };
    if (Array.isArray(rows)) return rows[0];
    return rows?.records?.[0];
  } catch (err) {
    ctx.logger?.warn?.('[crm] position binding lookup failed', {
      object,
      name,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

export function registerCrmPositionBindings(ctx: BindHostContext): void {
  const run = async (): Promise<void> => {
    let created = 0;
    for (const [positionName, setName] of BINDINGS) {
      const position = await findOneByName(ctx, 'sys_position', positionName);
      const set = await findOneByName(ctx, 'sys_permission_set', setName);
      if (!position?.id || !set?.id) {
        ctx.logger?.warn?.('[crm] position binding skipped (row missing)', { position: positionName, set: setName });
        continue;
      }
      const existing = (await ctx.ql.find(
        'sys_position_permission_set',
        { where: { position_id: position.id, permission_set_id: set.id }, limit: 1, context: SYS },
      )) as unknown;
      const hit = Array.isArray(existing) ? existing[0] : (existing as { records?: unknown[] })?.records?.[0];
      if (hit) continue;
      try {
        await ctx.ql.insert(
          'sys_position_permission_set',
          { id: `ppsb_crm_${positionName}`, position_id: position.id, permission_set_id: set.id },
          { context: SYS },
        );
        created += 1;
      } catch (err) {
        ctx.logger?.warn?.('[crm] position binding insert failed', {
          position: positionName,
          set: setName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    ctx.logger?.info?.('[crm] position bindings ensured', { created, total: BINDINGS.length });
  };

  // Bind on `kernel:bootstrapped` — the anchor that fires only after every
  // `kernel:ready` handler (incl. the security bootstrap that seeds the
  // position/set rows) has settled. Fall back to a deferred immediate run
  // if the host context somehow omits the hook registrar.
  if (typeof ctx.hook === 'function') {
    ctx.hook('kernel:bootstrapped', run);
  } else {
    setTimeout(() => void run(), 0);
  }
}

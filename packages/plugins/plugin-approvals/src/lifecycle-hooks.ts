// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Lifecycle Hooks — node-era record lock (ADR-0019).
 *
 * Approval is now a flow node, so there is no per-object process registry to
 * bind auto-trigger hooks against — a flow decides *when* to open an approval.
 * What remains worth enforcing at the data layer is the **record lock**: while
 * a record has a pending `sys_approval_request`, block edits to it.
 *
 * A single global `beforeUpdate` hook handles every object (the target object
 * of an approval node is only known at flow-run time). For each update it:
 *
 *   1. Skips engine self-writes (status mirror) and `sys_approval_*` bookkeeping.
 *   2. Looks up a pending request for `(object, recordId)`.
 *   3. Reads the lock policy from that request's `node_config_json` snapshot:
 *      - `lockRecord === false` → allow.
 *      - otherwise block, EXCEPT when the only changed field is the configured
 *        `approvalStatusField` (so the status mirror is never blocked) or the
 *        caller is an `admin`.
 *
 * Registered under `packageId: 'plugin-approvals:lock'` so it can be cleanly
 * unbound on plugin stop.
 */

export const APPROVALS_HOOK_PACKAGE = 'plugin-approvals:lock';

interface MinimalEngine {
  registerHook(event: string, handler: (ctx: any) => any | Promise<any>, options?: {
    object?: string | string[];
    priority?: number;
    packageId?: string;
  }): void;
  unregisterHooksByPackage(packageId: string): number;
  find<T = any>(object: string, args: any, opts?: any): Promise<T[]>;
}

interface MinimalLogger {
  debug?: (msg: any, ...rest: any[]) => void;
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
  error?: (msg: any, ...rest: any[]) => void;
}

function parseJson<T = any>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return raw as T;
}

/** The pending request gating a record, plus its snapshotted node config. */
async function pendingRequestFor(
  engine: MinimalEngine,
  objectName: string,
  recordId: string,
): Promise<any | null> {
  try {
    const rows = await engine.find('sys_approval_request', {
      where: { object_name: objectName, record_id: String(recordId), status: 'pending' },
      limit: 1,
    } as any);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

/**
 * Bind the global record-lock hook. Caller is responsible for calling
 * {@link unbindAllHooks} first if re-binding.
 */
export function bindApprovalLockHook(engine: MinimalEngine, logger?: MinimalLogger): void {
  engine.registerHook('beforeUpdate', async (ctx: any) => {
    const id = String((ctx?.input?.id ?? '') as string);
    if (!id) return;
    const object = (ctx?.object ?? ctx?.objectName) as string | undefined;
    // No object name (shouldn't happen) or our own bookkeeping objects → skip.
    if (!object || String(object).startsWith('sys_approval')) return;

    const data = (ctx?.input?.data ?? {}) as Record<string, unknown>;
    const changedFields = Object.keys(data).filter((k) => k !== 'id' && k !== 'updated_at');
    if (changedFields.length === 0) return;

    // Allow engine self-writes (status mirror from the approvals service, etc).
    if ((ctx?.session as any)?.isSystem) return;

    // Allow admin override.
    const roles = (ctx?.session?.roles ?? []) as string[];
    if (Array.isArray(roles) && roles.includes('admin')) return;

    const pending = await pendingRequestFor(engine, object, id);
    if (!pending) return;

    const config = parseJson<any>(pending.node_config_json, {});
    if (config?.lockRecord === false) return;

    // Allow when every changed field is the approval status mirror.
    const mirror = config?.approvalStatusField;
    if (typeof mirror === 'string' && mirror && changedFields.every((f) => f === mirror)) return;

    const err: any = new Error('RECORD_LOCKED: record is locked while an approval is in progress');
    err.code = 'RECORD_LOCKED';
    err.statusCode = 409;
    throw err;
  }, { packageId: APPROVALS_HOOK_PACKAGE, priority: 50 });

  logger?.info?.('[approvals] record-lock hook bound');
}

/** The self-service out-of-office delegation object (#1322). */
export const DELEGATION_OBJECT = 'sys_approval_delegation';

/**
 * Self-service write guard for `sys_approval_delegation` (#1322 follow-up).
 *
 * The object is `apiEnabled` CRUD so a user can declare their own out-of-office
 * delegation. But it is a system object: it gets no auto `owner_id` anchor and
 * (with no `sharingModel`) defaults to a `public` sharing model, so an
 * unguarded member could **forge a delegation for someone else**
 * (`delegator_id = victim`) and reroute the victim's individually-routed
 * approvals to themselves. This guard forces a normal user's writes to name
 * themselves as the delegator:
 *
 *   - **system** context (service / seed / import) → bypass;
 *   - **admin** (`roles` includes `'admin'`) → may set `delegator_id` to anyone;
 *   - otherwise `delegator_id` must equal the acting user — an absent delegator
 *     on insert is stamped to the caller, a foreign delegator is rejected.
 *
 * Row-level ownership on update/delete (you can only touch a delegation you
 * created) is already enforced by `member_default`'s wildcard
 * `created_by == current_user.id` RLS; this guard adds the delegator-identity
 * check that RLS alone can't express. Mirrors the ADR-0092 identity write-guard
 * shape and the security plugin's `owner_id` anchor guard, scoped to this one
 * object.
 */
export function bindDelegationWriteGuard(engine: MinimalEngine, logger?: MinimalLogger): void {
  const makeGuard = (isInsert: boolean) => async (ctx: any) => {
    const session = (ctx?.session ?? {}) as any;
    if (session.isSystem) return;                                    // service / seed / import
    const roles = (session.roles ?? []) as unknown[];
    if (Array.isArray(roles) && roles.includes('admin')) return;     // admin may act for anyone
    const userId = session.userId != null ? String(session.userId) : '';
    const data = ctx?.input?.data;
    const rows = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
    const deny = (): never => {
      const err: any = new Error(
        'FORBIDDEN: you may only manage out-of-office delegations where you are the delegator'
        + (userId ? ` ('${userId}')` : ''),
      );
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    };
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const has = Object.prototype.hasOwnProperty.call(row, 'delegator_id');
      const supplied = has ? String((row as any).delegator_id ?? '') : '';
      if (isInsert && (!has || supplied === '')) {
        // Self-service: stamp the caller as delegator when omitted (the schema's
        // `required` is the fallback if the engine doesn't persist the stamp).
        if (!userId) deny();
        (row as any).delegator_id = userId;
        continue;
      }
      // A foreign delegator on insert (forge) or update (relabel/hijack) → deny.
      if (has && supplied !== userId) deny();
    }
  };
  engine.registerHook('beforeInsert', makeGuard(true), { object: DELEGATION_OBJECT, packageId: APPROVALS_HOOK_PACKAGE, priority: 50 });
  engine.registerHook('beforeUpdate', makeGuard(false), { object: DELEGATION_OBJECT, packageId: APPROVALS_HOOK_PACKAGE, priority: 50 });
  logger?.info?.('[approvals] delegation write-guard bound');
}

/** Unregister every hook the lock module registered. */
export function unbindAllHooks(engine: MinimalEngine): number {
  return engine.unregisterHooksByPackage(APPROVALS_HOOK_PACKAGE);
}

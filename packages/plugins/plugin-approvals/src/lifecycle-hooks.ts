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
 *   2. Resolves **which records the write would touch** and looks up the pending
 *      requests gating them.
 *   3. Reads the lock policy from each request's `node_config_json` snapshot:
 *      - `lockRecord === false` → allow.
 *      - otherwise block, EXCEPT when the only changed field is the configured
 *        `approvalStatusField` (so the status mirror is never blocked) or the
 *        writer is the run that opened the request (`flowRunId`, #3456 / #3712).
 *
 * ## There is no admin exemption — by design (#4839)
 *
 * The lock applies to a platform/tenant admin exactly as it applies to anyone
 * else. An admin who must release a locked record does it through the
 * **sanctioned rescue path** (#3424): `ApprovalService.recall` / `decideNode`
 * (reject) / `reassign`, all gated by `isOverrideActor` and all audited
 * (`via_override`, #4466). Finalising the request is what releases the lock —
 * the record is never edited *under* a live approval, which is precisely the
 * guarantee a compliance-minded tenant buys the lock for.
 *
 * This is also not a behaviour change. The hook used to open with
 * `if (session.roles?.includes('admin')) return`, but `roles` has no producer:
 * ObjectQL's `buildSession()` never writes it, so the branch was dead on every
 * real engine path and the lock has always applied to admins. Deleting it makes
 * the code say what the runtime does — and closes a second, forbidden admin
 * dialect: privilege in this codebase is judged by the ADR-0095 vocabulary
 * (`permissions` / `positions` / derived posture), never by a string comparison
 * against `'admin'` (ADR-0090 D3 bans the `role` spelling outright). See
 * {@link file://./approval-service.ts} `isOverrideActor` for the one predicate.
 *
 * ## Step 2 is per-row, and it covers PREDICATE writes (#4778)
 *
 * The engine extracts `input.id` only from a **scalar** `where.id`; an operator
 * object (`{ $in: [...] }`) or any other predicate is a multi-row write that
 * routes to `updateMany`, and reaches this hook with **no** `input.id`. The
 * hook used to open with `if (!id) return`, i.e. it read *"no row was
 * resolved"* as *"there is nothing to authorize"* when the truth was *"nothing
 * was ever queried"* — the same fail-open reasoning as #4757 (`sys_attachment`)
 * and #4630 (`sys_comment`). Rewriting the very same edit as `multi: true` then
 * bypassed the lock with **no privilege at all**: no `isSystem`, no
 * `lockRecord: false`, no whitelisted field.
 *
 * So the hook now resolves the row set the way the attachment/comment guards
 * do, with one difference the record lock forces: it is a **per-row** guard
 * ("does THIS record have a pending approval"), not a "should this whole-table
 * write be refused" guard — so an unscoped bulk update is *not* refused
 * outright. Instead the resolution is inverted, which is what keeps it cheap:
 * the bound is on the **pending requests for the object** (of which there are
 * normally none, and the hook returns after one query), never on the update's
 * match set. Only when some record of the object *is* locked does the hook ask
 * the engine which of those locked rows the caller's predicate actually
 * matches. Past {@link PENDING_LOCK_LIMIT} locked records — or if that
 * intersection query fails — the write fails **CLOSED**.
 *
 * Every exemption above is evaluated on the multi-row path exactly as on the
 * by-id path: extending a guard to more rows must move the *allow* rules with
 * the *deny* rules, or fail-open merely becomes false-positive.
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
  /**
   * The GUARANTEED fallback channel (#9754). `error` stays optional — hosts do
   * inject reduced sinks — so `warn` is where a durability report lands when
   * `error` is absent, and a fallback that may itself be missing is not a
   * fallback. Call sites keep the `logger?.warn?.(…)` spelling as the backstop
   * for hosts the TYPE cannot reach; `SweepLogger` in plugin-email's
   * `outbox-sweep.ts` carries the full reasoning and the measurement.
   */
  warn: (msg: any, ...rest: any[]) => void;
  error?: (msg: any, ...rest: any[]) => void;
}

function parseJson<T = any>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return raw as T;
}

/**
 * Bound on the records one write may be authorized against — the sibling of
 * `sys_attachment`'s `MULTI_DELETE_AUTH_LIMIT` and `sys_comment`'s
 * `MULTI_WRITE_AUTH_LIMIT` (#4757 / #4630).
 *
 * It bounds LOCKED records (pending requests on the object) and ids the caller
 * names, never the update's match set: a mass update of 50 000 unlocked rows
 * costs one query and is allowed, while an object carrying more pending
 * approvals than this cannot be decided row by row and fails CLOSED.
 */
const PENDING_LOCK_LIMIT = 1_000;

/**
 * The approvals bookkeeping — and the row set a predicate write would touch —
 * are read as SYSTEM. A guard's own input must never be narrowed by the
 * caller's visibility: a locked row the caller cannot READ is still a locked
 * row they must not WRITE (the #4630 rule).
 */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

function lockedError(message: string): never {
  const err: any = new Error(`RECORD_LOCKED: ${message}`);
  err.code = 'RECORD_LOCKED';
  err.statusCode = 409;
  throw err;
}

/**
 * The record ids a write names outright — a scalar id or an `{ $in: [...] }` —
 * or `null` when the ids cannot be read off it (any other predicate, or an
 * `$in` carrying a non-scalar, which we refuse to guess at).
 *
 * Mirrors `asIdList` in the attachment/comment kits. An empty `$in` legitimately
 * names *no* record, so it returns `[]` (nothing to gate), not `null`.
 */
function asIdList(id: unknown): Array<string | number> | null {
  if (typeof id === 'number') return [id];
  if (typeof id === 'string') return id === '' ? null : [id];
  if (id && typeof id === 'object' && Array.isArray((id as any).$in)) {
    const raw = (id as any).$in as unknown[];
    const scalars = raw.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
    return scalars.length === raw.length ? scalars : null;
  }
  return null;
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
      context: { ...SYSTEM_CTX },
    } as any);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

/** Pending requests gating any of the records a write names by id. */
async function pendingRequestsForRecords(
  engine: MinimalEngine,
  objectName: string,
  recordIds: ReadonlyArray<string | number>,
): Promise<any[]> {
  if (recordIds.length === 0) return [];
  if (recordIds.length > PENDING_LOCK_LIMIT) {
    lockedError(
      `refusing to authorize an update naming more than ${PENDING_LOCK_LIMIT} records of '${objectName}' — ` +
      'the approval lock cannot check them row by row; scope the write',
    );
  }
  if (recordIds.length === 1) {
    const one = await pendingRequestFor(engine, objectName, String(recordIds[0]));
    return one ? [one] : [];
  }
  try {
    const rows = await engine.find('sys_approval_request', {
      where: { object_name: objectName, record_id: { $in: recordIds.map(String) }, status: 'pending' },
      limit: PENDING_LOCK_LIMIT + 1,
      context: { ...SYSTEM_CTX },
    } as any);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Every record of `objectName` currently held by a pending approval, capped one
 * past the bound so the caller can tell "at the cap" from "over it".
 *
 * `null` means the bookkeeping could not be read at all. That reads as "no
 * lock" — deliberately the ONE fail-open left, and the pre-existing behaviour
 * of {@link pendingRequestFor}: this hook is GLOBAL over every object, so a
 * kernel where `sys_approval_request` is absent or momentarily unreadable would
 * otherwise refuse every update in the deployment. The fail-closed decisions
 * below are the ones an attacker can actually steer (a predicate they choose);
 * "is the approvals table readable" is not one of them.
 */
async function pendingRequestsForObject(
  engine: MinimalEngine,
  objectName: string,
): Promise<any[] | null> {
  try {
    const rows = await engine.find('sys_approval_request', {
      where: { object_name: objectName, status: 'pending' },
      limit: PENDING_LOCK_LIMIT + 1,
      context: { ...SYSTEM_CTX },
    } as any);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/**
 * Narrow `candidates` (pending requests) to the ones whose record the caller's
 * predicate actually matches — asked of the engine as an intersection, so the
 * query is bounded by the number of LOCKED rows, not by the update's match set.
 *
 * A failure here fails CLOSED: we know some record of this object is locked and
 * we could not prove the write misses it.
 */
async function narrowToMatchedRecords(
  engine: MinimalEngine,
  objectName: string,
  where: unknown,
  candidates: any[],
): Promise<any[]> {
  const lockedIds = candidates.map((c) => String(c?.record_id ?? ''));
  let rows: any[];
  try {
    rows = await engine.find(objectName, {
      where: { $and: [where, { id: { $in: lockedIds } }] },
      fields: ['id'],
      limit: lockedIds.length,
      context: { ...SYSTEM_CTX },
    } as any);
  } catch (err) {
    lockedError(
      `cannot determine which rows a predicate update on '${objectName}' would touch ` +
      `(${(err as Error)?.message ?? String(err)}); ${candidates.length} record(s) of it carry a pending ` +
      'approval, so the write is refused',
    );
  }
  const matched = new Set((Array.isArray(rows) ? rows : []).map((r: any) => String(r?.id)));
  return candidates.filter((c) => matched.has(String(c?.record_id ?? '')));
}

/**
 * The pending requests gating the rows THIS write would touch.
 *
 * Four shapes, cheapest first:
 *   - `input.id` (engine's scalar by-id fast path) → that record only. The
 *     driver updates by primary key, so the rest of `where` never narrows it —
 *     narrowing here would be a fail-open.
 *   - predicate naming ids only (`{ id: { $in: [...] } }`) → those records.
 *   - predicate with other keys → the object's locked records, intersected with
 *     the predicate.
 *   - no predicate at all (`updateMany` over the whole table) → every locked
 *     record of the object.
 */
async function gatingRequests(
  engine: MinimalEngine,
  ctx: any,
  objectName: string,
): Promise<any[]> {
  const byId = asIdList(ctx?.input?.id);
  if (byId) return pendingRequestsForRecords(engine, objectName, byId);

  // Predicate write. `where` is canonical here: the engine folds the `filter`
  // alias into it before hooks run (PD #12 — no consumer-side `?? filter`).
  const rawWhere = (ctx?.input?.options as any)?.where;
  const hasWhere = rawWhere !== undefined && rawWhere !== null;
  const whereObj = hasWhere && typeof rawWhere === 'object' && !Array.isArray(rawWhere)
    ? rawWhere as Record<string, unknown>
    : null;

  const namedIds = whereObj ? asIdList(whereObj.id) : null;
  const candidates = namedIds
    ? await pendingRequestsForRecords(engine, objectName, namedIds)
    : await pendingRequestsForObject(engine, objectName);
  if (candidates === null) return [];          // bookkeeping unreadable — see the note above
  if (candidates.length === 0) return [];      // nothing locked in reach
  if (candidates.length > PENDING_LOCK_LIMIT) {
    lockedError(
      `refusing a predicate update on '${objectName}': more than ${PENDING_LOCK_LIMIT} of its records carry a ` +
      'pending approval, so the lock cannot decide row by row; scope the write to the rows you mean',
    );
  }
  // No predicate → the write touches every row, so every locked row is in reach.
  if (!hasWhere) return candidates;
  // The predicate was exactly the id list we already resolved against.
  if (namedIds && whereObj && Object.keys(whereObj).every((k) => k === 'id')) return candidates;
  return narrowToMatchedRecords(engine, objectName, rawWhere, candidates);
}

/**
 * Bind the global record-lock hook. Caller is responsible for calling
 * {@link unbindAllHooks} first if re-binding.
 */
export function bindApprovalLockHook(engine: MinimalEngine, logger?: MinimalLogger): void {
  engine.registerHook('beforeUpdate', async (ctx: any) => {
    const object = (ctx?.object ?? ctx?.objectName) as string | undefined;
    // No object name (shouldn't happen) or our own bookkeeping objects → skip.
    if (!object || String(object).startsWith('sys_approval')) return;

    const data = (ctx?.input?.data ?? {}) as Record<string, unknown>;
    const changedFields = Object.keys(data).filter((k) => k !== 'id' && k !== 'updated_at');
    if (changedFields.length === 0) return;

    // ── Caller-level exemptions. Row-independent, so they are decided once,
    // before any row is resolved — and they hold identically for a by-id and a
    // predicate write (#4778: an exemption that only survives on one path turns
    // a fail-open into a false-positive).

    // Allow engine self-writes (status mirror from the approvals service, etc).
    if ((ctx?.session as any)?.isSystem) return;

    // NOTE (#4839): there is deliberately NO admin exemption here. A privileged
    // admin releases a locked record through the audited #3424 rescue path
    // (recall / reject / reassign, gated by `isOverrideActor`), not by editing
    // the record while its approval is live. See the module docstring.

    // ── Which rows does this write touch, and which of them are locked?
    const gating = await gatingRequests(engine, ctx, object);
    if (gating.length === 0) return;

    // The run that OPENED this approval may still write its own target record
    // (#3456). Without this the lock cannot tell "the run that owns this pending
    // request" from "an unrelated user edit", so a flow that touches the record
    // between opening the approval and the decision — or a manual `resume` with
    // no decision — dies on its own `RECORD_LOCKED` and leaves the record locked
    // behind it.
    //
    // Keyed on run identity, NOT on elevation: a `runAs:'user'` run must stay
    // RLS-scoped, so widening it to `isSystem` would be the wrong tool. The
    // automation engine stamps `flowRunId` into the server-built ExecutionContext
    // (never client-supplied, like `isSystem`) and it grants nothing by itself —
    // the only write it permits is to the one record this very run already holds
    // a pending request against.
    //
    // Read off `provenance`, not `session`: provenance says WHAT produced the
    // write, and a run can own its writes while resolving no principal at all.
    // A schedule-triggered run is exactly that — it reaches here with NO
    // session, and that shape is the one that used to die on its own lock
    // (#3712).
    const writerRun = (ctx?.provenance as any)?.flowRunId;

    // Per-row verdict: the write is refused as soon as ONE touched record is
    // locked against it. Each request carries its own snapshotted policy, so a
    // multi-row write spanning two approvals is judged by each of them.
    for (const pending of gating) {
      if (writerRun && pending?.flow_run_id && String(writerRun) === String(pending.flow_run_id)) continue;

      const config = parseJson<any>(pending?.node_config_json, {});
      if (config?.lockRecord === false) continue;

      // Allow when every changed field is the approval status mirror.
      const mirror = config?.approvalStatusField;
      if (typeof mirror === 'string' && mirror && changedFields.every((f) => f === mirror)) continue;

      lockedError(
        `record '${String(pending?.record_id ?? '')}' of '${object}' is locked while an approval is in progress`,
      );
    }
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
 *   - otherwise `delegator_id` must equal the acting user — an absent delegator
 *     on insert is stamped to the caller, a foreign delegator is rejected.
 *
 * ## Delegation is SELF-MANAGED — there is no admin exemption (#4839)
 *
 * The guard used to bypass for `session.roles?.includes('admin')`, so an admin
 * could declare an out-of-office delegation *on behalf of* another user. That
 * branch never ran (`roles` has no producer — ObjectQL's `buildSession()` never
 * writes it), and it is not being restored, for two reasons:
 *
 *   1. **It could not do the job it was written for.** A delegation is consulted
 *      at *slate-resolution* time only: `applyOooDelegation` runs inside
 *      `resolveApproverSpec` while a request is being OPENED. Declaring a
 *      delegation for an approver who has *already* gone unavailable does not
 *      touch the approvals pending against them — it only redirects future ones.
 *   2. **The in-flight case already has a sanctioned path.** For the approvals
 *      an unavailable approver is *currently* holding, a privileged admin uses
 *      `ApprovalService.reassign` (hand that approver's slot to a substitute —
 *      it even carries the slot's per_group membership over), `recall`, or
 *      `decideNode` with `reject`; all three are gated by `isOverrideActor`'s
 *      ADR-0095 criteria and audited via `via_override` (#4466). That is the
 *      operation an admin actually needs, and it exists.
 *
 * So the semantic is final: **a delegation names its own author as delegator**;
 * acting for someone else is done through the approval-level override, in the
 * one privilege vocabulary this codebase has (ADR-0090 D3 / ADR-0095 D3) — never
 * by comparing a session field against the string `'admin'`.
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
    // NOTE (#4839): no admin exemption — a delegation names its own author as
    // delegator. Acting on another user's in-flight approvals is the approval
    // service's audited override (reassign / recall / reject), not a forged
    // delegation row. See the docstring above.
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

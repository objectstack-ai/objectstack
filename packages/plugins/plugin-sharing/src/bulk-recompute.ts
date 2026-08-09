// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4779] Resolve WHICH rows a write touched, so sharing-rule recompute is
 * driven by the write's row SET instead of by a single record id.
 *
 * ## The defect this exists to close
 *
 * `bindRuleHooks` used to open its handler with
 *
 * ```ts
 * const id = String(data?.id ?? ctx?.input?.id ?? '');
 * if (!id) return;                       // ← every predicate write, silently
 * ```
 *
 * and `ObjectQL.update()` — AT THE TIME — only populated `input.id` for a
 * scalar `where.id`. ([#6966] That is no longer how a predicate write is
 * dispatched: since #5038/#5574 both phases fire once per matched row with
 * `input.id` bound, so the guard above would now pass per row rather than skip.
 * The defect it caused is unchanged history; the mechanism sentence is not
 * current, and is kept only to explain what was fixed.)
 * A predicate (`multi: true`) update therefore recomputed NOTHING: an admin
 * could bulk-move a thousand records out of a sharing rule's criteria and
 * every `sys_record_share` row the rule had issued stayed in the table,
 * answering. That is a fail-open on the AUTHORIZATION side — the same family
 * as #4757 (`sys_attachment`) and #4778 (approval locks), just better hidden,
 * because the stale grant looks exactly like a legitimate one.
 *
 * ## The two answers, and why there are exactly two
 *
 * A recompute needs the affected rows one at a time (`evaluateAllForRecord`
 * runs a criteria probe, a recipient expansion and a grant diff PER ROW), so
 * it needs a bound. A revoke does not: `sys_record_share` can be scoped by
 * `object_name` in a single set-based delete. The maintainer's ruling on this
 * issue (2026-08-04, option C) turns that asymmetry into the design —
 * **over-granting is a security incident, under-granting is an availability
 * wobble** — so the safety half is always synchronous and complete, and only
 * the expensive restoration half is deferred:
 *
 *  - {@link AffectedRows} `kind: 'rows'` — the write's row set is known and
 *    within {@link RULE_RECOMPUTE_ROW_CAP}. `afterUpdate` recomputes each row
 *    synchronously, which covers BOTH directions (a row bulk-updated INTO a
 *    rule's criteria is granted, one updated OUT of it is revoked) because
 *    `reconcileForRecord` is diff-based.
 *  - {@link AffectedRows} `kind: 'unbounded'` — the row set could not be
 *    bounded. Every rule-sourced grant on the object is revoked synchronously
 *    (one set-based statement, no cap to exceed), then re-granted
 *    asynchronously by reconciling the object's rules.
 *
 * The write is never refused (that was option A, the fallback): refusing would
 * make an internal recompute bound into a business-visible limit on how many
 * rows an admin may update, reported by a subsystem they never configured.
 *
 * ### Why the unbounded revoke is object-wide and not `record_id: {$in: […]}`
 *
 * Scoping the revoke to the affected ids would spare the untouched rows their
 * brief outage — but it needs the full id list, and needing the full id list
 * is exactly the bound this branch exists because we could not meet. A scoped
 * revoke would therefore re-import the cap into the one operation that is
 * free of it. The wider blast radius is deliberate and is in the safe
 * direction: the extra rows lose access for as long as the re-grant takes,
 * and no row keeps access it should have lost.
 *
 * ## Superset, never subset
 *
 * The predicate is resolved with SYSTEM_CTX, while the write itself also
 * carries the sharing middleware's writable-rows filter (`buildWriteFilter`)
 * composed into its AST. So the resolved set is a SUPERSET of the rows the
 * write actually changed. That is the correct direction and is load-bearing:
 * `evaluateAllForRecord` is idempotent, so recomputing an untouched row costs
 * a query and changes nothing, whereas MISSING a changed row is the defect.
 */

/**
 * Rows a single write may recompute synchronously before the recompute is
 * deferred. 1000 mirrors the fail-closed bound the sibling authorization
 * guards already chose — `MULTI_DELETE_AUTH_LIMIT` in service-storage's
 * attachment hooks (#4757) and #4630's `sys_comment` resolve — so the three
 * guards in this family answer "how many rows may one write drag through a
 * per-row pass?" with one number.
 */
export const RULE_RECOMPUTE_ROW_CAP = 1_000;

/** Why a write's row set could not be enumerated. */
export type UnboundedReason =
  /** `multi: true` with no `where` at all — the AST covers the whole table. */
  | 'no-predicate'
  /** The predicate matches more rows than {@link RULE_RECOMPUTE_ROW_CAP}. */
  | 'over-cap'
  /** The resolve query itself failed; nothing at all is known about the set. */
  | 'resolve-failed';

/** The row set a write touched, as far as it can be known before it lands. */
export type AffectedRows =
  | { readonly kind: 'rows'; readonly ids: readonly string[] }
  | { readonly kind: 'unbounded'; readonly reason: UnboundedReason; readonly detail?: string };

/** The slice of the ObjectQL engine this module reads. */
export interface RecomputeEngine {
  find(object: string, options?: any): Promise<any[]>;
}

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
  error?: (msg: any, ...rest: any[]) => void;
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * Ids named directly by a hook's `input.id`.
 *
 * `delete()` accepts `{ id: { $in: [...] } }`, so a "single id" input can name
 * many rows — the same shape `asIdList` handles in service-storage's
 * attachment guard (#4757). Anything else (a predicate operator, an object)
 * names no primary key and returns `null` so the caller falls through to the
 * predicate resolve.
 */
export function idsFromHookInput(id: unknown): string[] | null {
  if (typeof id === 'string' || typeof id === 'number' || typeof id === 'bigint') {
    return [String(id)];
  }
  if (Array.isArray(id)) {
    const out = id.filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
    return out.length > 0 ? out : null;
  }
  if (id && typeof id === 'object' && Array.isArray((id as any).$in)) {
    const out = (id as any).$in
      .filter((v: unknown) => typeof v === 'string' || typeof v === 'number')
      .map(String);
    return out.length > 0 ? out : null;
  }
  return null;
}

/**
 * Resolve the rows a `beforeUpdate` / `beforeDelete` context is about to
 * change, bounded by {@link RULE_RECOMPUTE_ROW_CAP}.
 *
 * Called from a BEFORE hook on purpose: an update that moves rows out of a
 * rule's criteria makes them unfindable by that same predicate the moment it
 * lands, and a delete removes them outright. The `after` hook then reads the
 * stashed answer (the engine reuses one `HookContext` instance across the
 * before/after pair of a write, which is the seam `primary-bu-projection.ts`
 * already relies on).
 */
export async function resolveAffectedRows(
  engine: RecomputeEngine,
  objectName: string,
  hookCtx: any,
  logger?: MinimalLogger,
): Promise<AffectedRows> {
  // 1. The write names its rows directly (scalar id, or delete's `$in` form).
  const named = idsFromHookInput(hookCtx?.input?.id);
  if (named) return { kind: 'rows', ids: named };

  // 2. Some writes carry the id in the payload instead (insert, and upsert-
  //    shaped updates whose `data.id` the engine has not lifted yet).
  const payloadId = (hookCtx?.input?.data as any)?.id;
  const fromPayload = idsFromHookInput(payloadId);
  if (fromPayload) return { kind: 'rows', ids: fromPayload };

  // 3. Predicate write. No predicate at all means the AST is `{ object }` —
  //    literally every row. Enumerating "the whole table" is not a bound, so
  //    say so rather than resolving a partial page and treating it as the set.
  //    ("Nothing was queried" is not "nothing matched" — #4757's own lesson.)
  const where = hookCtx?.input?.options?.where;
  if (where === undefined || where === null) {
    return { kind: 'unbounded', reason: 'no-predicate' };
  }

  try {
    // CAP + 1 is the whole detection: one extra row is enough to know the set
    // is over the cap, and reading the exact size would cost the scan this
    // branch exists to avoid.
    const rows = await engine.find(objectName, {
      where,
      fields: ['id'],
      limit: RULE_RECOMPUTE_ROW_CAP + 1,
      context: SYSTEM_CTX,
    });
    const ids = (Array.isArray(rows) ? rows : [])
      .map((r: any) => (r?.id == null ? '' : String(r.id)))
      .filter(Boolean);
    if (ids.length > RULE_RECOMPUTE_ROW_CAP) {
      return { kind: 'unbounded', reason: 'over-cap' };
    }
    return { kind: 'rows', ids };
  } catch (err: any) {
    // The predicate could not be run, so the row set is unknown — which is a
    // strictly weaker state than "matched nothing" and must not be read as it.
    logger?.warn?.(
      '[sharing-rule] could not resolve the rows a bulk write touches — every rule grant on the object ' +
        'will be revoked and re-granted asynchronously instead',
      { object: objectName, error: err?.message },
    );
    return { kind: 'unbounded', reason: 'resolve-failed', detail: err?.message };
  }
}

/**
 * [#4779] Shared-`HookContext` key holding the row set the write is about to
 * change, stashed by the `before` hook for the `after` hook to consume.
 *
 * The stash is necessary, not a convenience: an update that moves rows OUT of
 * a rule's criteria makes them unfindable by the write's own predicate the
 * instant it lands, and a delete removes them outright — so `afterUpdate` /
 * `afterDelete` are structurally too late to ask "which rows was this?".
 *
 * [#5103] Lives HERE, next to the resolver, rather than in `rule-hooks.ts`
 * where it started: two independent hook packages now need the same answer for
 * the same write (the rule recompute, and the record-delete share cascade),
 * and each resolving it separately would double the predicate query on every
 * bulk write for no gain — the row set is a property of the WRITE, not of
 * either subscriber.
 *
 * ## [#6966] Where the stash actually lives, and why that had to change
 *
 * This used to say: "`ObjectQL.update()` / `.delete()` reuse ONE `HookContext`
 * instance across each before/after pair (they mutate `ctx.event` in place)."
 * That stopped being true for a predicate (`multi: true`) write when #5574
 * made the `before*` phase dispatch PER ROW — each row gets a freshly built
 * context, so a stash written on it died with that row and the `after*` phase
 * found nothing. `readAffectedRows` then answered `unbounded/resolve-failed`,
 * and both subscribers took their safe branch: every bulk update or delete on
 * a ruled object revoked ALL of that object's rule grants and queued a full
 * asynchronous re-grant — once per matched row. Safe (the ruling's
 * "over-granting is an incident, under-granting is a wobble" direction), but
 * a large and silent behaviour change nobody asked for.
 *
 * The seam is now the engine's own: `HookContext.dispatch.scope` is one object
 * shared by every dispatch of one caller write, across both phases. See
 * {@link stashHost} for the fallback that keeps hand-built contexts working.
 */
export const AFFECTED_ROWS_STASH_KEY = '__sharingAffectedRows';

/**
 * [#6966] Accumulator for the per-row dispatch: the ids handed over one at a
 * time by the engine's per-row `before*` fan-out. A SET, not an array, because
 * two independent subscribers ({@link stashAffectedRows} is registered by both
 * `rule-hooks` and `record-share-cascade`) each run on every row — appending
 * would double every id.
 */
const AFFECTED_ROW_IDS_KEY = '__sharingAffectedRowIds';

/**
 * Where a before→after stash for ONE write lives.
 *
 * The engine's per-write scratch when the marker is present; the context
 * itself otherwise. The fallback is not legacy tolerance — a `HookContext`
 * built by hand (tests, an embedding that calls a handler directly) carries no
 * `dispatch`, and for a single-id write the context IS shared across the pair,
 * so stashing on it remains correct there.
 */
function stashHost(hookCtx: any): any {
  return hookCtx?.dispatch?.scope ?? hookCtx;
}

/**
 * Resolve (or reuse) the row set a `before` hook's write is about to change and
 * park it on the shared `HookContext`.
 *
 * **Reuse is the point.** The first plugin-sharing `before` hook to run on a
 * write resolves; every later one reads that answer back. Recomputing would be
 * wasteful and — worse — could disagree, because a resolve issued after an
 * earlier hook has already changed something is answering a different question.
 *
 * Never throws: `resolveAffectedRows` already fails safe to `unbounded`, and
 * this adds the belt for a genuinely unexpected throw. "Unknown" must never
 * degrade to "no rows" — that is the direction that silently skips cleanup.
 *
 * ## [#6966] The per-row dispatch does not resolve at all — it accumulates
 *
 * On a predicate write the engine has ALREADY matched the rows and dispatches
 * this hook once per row with `input.id` bound, so re-asking the predicate
 * would be both wasteful and wrong: `resolveAffectedRows` short-circuits on a
 * bound `input.id` (step 1), so the "reuse" branch above would have frozen the
 * whole batch's answer to the FIRST row's id — under-revoking every other row,
 * which is the fail-OPEN direction this module exists to avoid. Rows are
 * therefore unioned as they arrive, and the cap is applied to the union.
 */
export async function stashAffectedRows(
  engine: RecomputeEngine | { find?: RecomputeEngine['find'] },
  objectName: string,
  hookCtx: any,
  logger?: MinimalLogger,
): Promise<AffectedRows> {
  const host = stashHost(hookCtx);
  if (hookCtx?.dispatch?.mode === 'per-row') {
    const rowId = hookCtx?.input?.id;
    const seen: Set<string> = host[AFFECTED_ROW_IDS_KEY] ?? (host[AFFECTED_ROW_IDS_KEY] = new Set<string>());
    if (rowId != null) seen.add(String(rowId));
    return readAffectedRows(hookCtx);
  }
  const already = host?.[AFFECTED_ROWS_STASH_KEY] as AffectedRows | undefined;
  if (already) return already;
  let resolved: AffectedRows;
  try {
    resolved = typeof engine?.find === 'function'
      ? await resolveAffectedRows(engine as RecomputeEngine, objectName, hookCtx, logger)
      : { kind: 'unbounded', reason: 'resolve-failed', detail: 'engine has no find()' };
  } catch (err: any) {
    resolved = { kind: 'unbounded', reason: 'resolve-failed', detail: err?.message };
  }
  if (host && typeof host === 'object') host[AFFECTED_ROWS_STASH_KEY] = resolved;
  return resolved;
}

/**
 * What an `after` hook should act on. A missing stash means no `before` hook of
 * ours ran for this write, which is not "nothing changed" — it is "we do not
 * know", and it reads as `unbounded` so the caller takes its safe branch.
 *
 * [#6966] The per-row union is materialised HERE rather than on every `before`
 * dispatch, so N rows × 2 subscribers cost N set inserts instead of 2N array
 * copies. The cap is re-applied to the union: a batch the engine's own ceiling
 * lets through can still exceed what a per-row recompute is willing to do, and
 * that verdict must be the same `over-cap` the predicate resolver returns.
 */
export function readAffectedRows(hookCtx: any): AffectedRows {
  const host = stashHost(hookCtx);
  const seen = host?.[AFFECTED_ROW_IDS_KEY] as Set<string> | undefined;
  if (seen) {
    return seen.size > RULE_RECOMPUTE_ROW_CAP
      ? { kind: 'unbounded', reason: 'over-cap' }
      : { kind: 'rows', ids: [...seen] };
  }
  return (host?.[AFFECTED_ROWS_STASH_KEY] as AffectedRows | undefined)
    ?? { kind: 'unbounded', reason: 'resolve-failed', detail: 'no before-hook stash' };
}

/**
 * The asynchronous half of the ruling: re-grant after the synchronous revoke.
 *
 * Deliberately in-process and dependency-free rather than routed through
 * `IJobService`. The job service is an OPTIONAL capability (`serve.ts`'s
 * `CAPABILITY_PROVIDERS` lists `job` and `sharing` independently, and
 * plugin-sharing does not depend on it), so routing through it would make the
 * re-grant happen in some compositions and silently not in others — a
 * declared-but-not-enforced guarantee, which is the shape AGENTS.md PD #10
 * exists to forbid. An in-process queue is present in every composition that
 * has the hooks at all.
 *
 * Durability comes from the layer that already provides it: the plugin's
 * `kernel:bootstrapped` pass (`backfillRuleGrants`) reconciles EVERY rule on
 * every boot and `evaluateRule` is idempotent, so a re-grant lost to a crash
 * is repaired by the next start. That is the compensating executor this
 * design leans on; nothing here needs to survive the process.
 *
 * Tasks are serialized (never concurrent) so a bulk write cannot fan out into
 * hundreds of parallel criteria queries.
 */
export class RuleRegrantQueue {
  private chain: Promise<void> = Promise.resolve();
  private depth = 0;

  /** Tasks enqueued and not yet settled. */
  get pending(): number {
    return this.depth;
  }

  /**
   * Queue a re-grant. Returns immediately — the caller is a write hook and
   * must not wait. Failures are logged, never rethrown: an unhandled rejection
   * from a detached task would take down the host, and the failure mode here
   * is under-sharing, which the next boot repairs.
   */
  enqueue(task: () => Promise<void>, onError?: (err: unknown) => void): void {
    this.depth += 1;
    this.chain = this.chain.then(async () => {
      try {
        await task();
      } catch (err) {
        try {
          onError?.(err);
        } catch {
          /* a logger that throws must not poison the chain */
        }
      } finally {
        this.depth -= 1;
      }
    });
  }

  /**
   * Resolves once every task enqueued BEFORE this call has settled. The seam
   * tests use to observe the asynchronous half deterministically; production
   * code never awaits it.
   */
  whenIdle(): Promise<void> {
    return this.chain;
  }
}

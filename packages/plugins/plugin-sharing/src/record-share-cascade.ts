// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5103 / #5190] The record-delete → share-revoke cascade.
 *
 * ## The invariant
 *
 * A `sys_record_share` row says "principal P has level L on (object O, record
 * R)". Delete R and the row cannot describe any access at all — there is
 * nothing left to have access to. So: **record gone ⇒ every share on it gone,
 * whatever its `source`.**
 *
 * ## What was missing
 *
 * #4779 (PR #5102) bound `afterDelete` inside the sharing-RULE package, and
 * two conditions fenced it in:
 *
 *  1. it revokes only `source: 'rule'` rows — correct for that package (rule
 *     recompute must never touch a human's manual decision, which #5102
 *     pinned and this module does not regress: recompute still only ever sees
 *     rule rows);
 *  2. it binds only on objects that appear in `sys_sharing_rule` — so an
 *     object using nothing but manual shares had no delete hook at all.
 *
 * Together: **manual share + record delete = a permanent orphan, on every
 * object.** Harmless only while record ids are never reused — an assumption
 * nothing in the platform enforces. Recycle an id (custom primary keys, an
 * import that preserves ids) and the new record inherits the dead one's
 * recipients.
 *
 * ## The binding model, and why there is nothing to rebind
 *
 * The maintainer ruling (2026-08-04) chose option A: plugin-sharing binds
 * `afterDelete` on all sharing-enabled objects, "sharing-enabled" decided at
 * runtime by `sharingModel` METADATA rather than by the rules table — which
 * the ruling notes is a different enumeration model from the rule hooks', and
 * asks for metadata hot-updates to be handled if a seam allows it.
 *
 * A seam does, and it is better than a rebind: bind ONE hook pair with no
 * object filter and evaluate the metadata predicate **inside the handler**, at
 * delete time. An object that gains `sharingModel` an hour after boot is
 * covered on its very next delete, because the enumeration never happened —
 * there is no bound set to go stale, and therefore no rebind to forget. (The
 * same reason `plugin-pinyin-search` binds its companion hooks globally with a
 * cheap early-out instead of enumerating provisioned objects.) The predicate
 * is `objectCanCarryRecordShares`, one exported function, tested in isolation.
 *
 * Cost of the global bind: one registry lookup (an in-memory map read) per
 * delete. Objects the predicate rejects return before any query runs.
 *
 * ## Bounded and unbounded deletes
 *
 * A predicate (`multi: true`) delete does not name its ids, and after it lands
 * the rows are unfindable — the same problem #4779 solved with a `beforeDelete`
 * stash, whose resolver and `HookContext` key this module now SHARES rather
 * than duplicating (`bulk-recompute.ts`). Whichever of the two packages'
 * `before` hooks runs first resolves; the other reads the same answer.
 *
 *  - bounded row set → revoke every share of those ids, synchronously,
 *    set-based;
 *  - unbounded (no predicate at all, or over the cap) → queue an
 *    object-scoped orphan sweep. NOT the rule path's "revoke everything on the
 *    object and re-grant asynchronously": that trade is only sound where a
 *    reconcile can put the grants back, and nothing can ever re-create a
 *    manual share. The sweep instead asks, per share row, whether its record
 *    still exists — which needs no id list from the write.
 *
 * The `kernel:bootstrapped` sweep (unscoped) is the durable backstop for both:
 * a hook that failed, a process that died mid-cascade, and every orphan that
 * predates this code converge on the next boot.
 *
 * ## Referential cascades are covered
 *
 * `ObjectQLEngine.cascadeDeleteRelations` removes a `deleteBehavior: 'cascade'`
 * child by recursing through the PUBLIC `delete()` ("so the child's own
 * cascade, hooks and events fire"), not by calling the driver directly — so a
 * detail record swept away with its master reaches this hook like any other
 * delete. That is why `controlled_by_parent` counts as sharing-capable in
 * {@link objectCanCarryRecordShares} despite refusing manual grants: rows can
 * exist there (the rule evaluator grants under system context), and this is
 * the path that reclaims them.
 *
 * ## [#5190] Two tables, one cascade
 *
 * `sys_share_link` has the same invariant and needed the same three things (the
 * bounded revoke, the unbounded sweep, the boot backstop), so it rides THIS
 * seam rather than growing a parallel one: one `beforeDelete` stash, one
 * `afterDelete`, one serialized sweep queue, one boot pass. What differs is only
 * the posture predicate — a link is minted under `publicSharing`, which is
 * orthogonal to `sharingModel` — hence {@link objectCanCarryShareLinks} beside
 * {@link objectCanCarryRecordShares}, each gating its own half inside the
 * handler.
 *
 * The link half is reached through the `ShareLinkService` (late-bound: the
 * plugin constructs it after this bind, and `sys_share_link` is
 * `managedBy: 'engine-owned'` with every write flowing through that service).
 * Absent service → the boot sweep is the only reclaim, exactly as when the
 * engine has no hook API at all.
 */

import {
  stashAffectedRows,
  readAffectedRows,
  RuleRegrantQueue,
} from './bulk-recompute.js';
import { effectiveSharingModel, type SharingService } from './sharing-service.js';

export const RECORD_SHARE_CASCADE_PACKAGE = 'plugin-sharing:record-share-cascade';

/**
 * The sharing subsystem's own tables. They are never the TARGET of a share
 * (`sys_record_share` is on the enforcement bypass list precisely so the gates
 * do not recurse through themselves), and cascading on `sys_record_share`
 * itself would mean a share-row delete firing a share-row delete.
 */
const SHARING_OWN_OBJECTS = new Set([
  'sys_record_share',
  'sys_sharing_rule',
  'sys_share_link',
]);

/**
 * Could `schema`'s object carry `sys_record_share` rows? The runtime,
 * metadata-driven answer to "is sharing enabled here" — evaluated per delete,
 * so it tracks metadata changes with no rebind.
 *
 * Deliberately WIDER than `assertSharingEnforced`, which gates whether a new
 * MANUAL grant may be created. Two rows can exist that that gate would refuse
 * today: one written before the object's `sharingModel` changed, and one
 * materialised by the rule evaluator (which grants under system context and so
 * skips the gate entirely). A cleanup predicate narrower than the set of rows
 * that can exist is how orphans survive, and being wide costs only a delete
 * statement against a record that is already gone.
 *
 * The one exclusion beyond the subsystem's own tables is a SYSTEM object that
 * declares no `sharingModel`: it resolves to public (ADR-0090 D1 makes the
 * secure default apply to custom objects, not platform ones), no gate consults
 * shares on it, and sparing it keeps this hook off the platform's hottest
 * delete paths. A rule pointed at such an object could still materialise rows
 * there — that residue is the boot sweep's, and it is the documented boundary
 * of this predicate rather than an unnoticed hole.
 *
 * An unresolvable schema returns `true`: "we cannot tell" must fall toward
 * cleaning up, never toward the orphan this issue is about.
 */
export function objectCanCarryRecordShares(schema: unknown): boolean {
  if (schema == null) return true;
  const s = schema as any;
  const name = s?.name == null ? '' : String(s.name);
  if (SHARING_OWN_OBJECTS.has(name)) return false;
  const declared = s?.sharingModel ?? s?.security?.sharingModel;
  if (declared != null) return true;
  return effectiveSharingModel(s) !== 'public';
}

/**
 * [#5190] Could `schema`'s object carry `sys_share_link` rows?
 *
 * NOT the same question as {@link objectCanCarryRecordShares}, and that is the
 * reason this predicate exists rather than reusing it. Link minting is gated by
 * `publicSharing`, which is INDEPENDENT of `sharingModel`: the object most
 * likely to hold links is a public-ish one that opted into link sharing, and
 * that object can be exactly the one the record-share predicate skips. Gating
 * links on the sharing model would have left the commonest case orphaned.
 *
 * Wide, on purpose, in three directions:
 *
 *  - `publicSharing` DECLARED counts even when `enabled: false` — links minted
 *    while it was on outlive the flip, and cleanup must reach them;
 *  - anything the record-share cascade already covers counts too. `createLink`
 *    lets a SYSTEM (or `permissive`) caller mint on an object that never opted
 *    in, so links can exist wherever records do; those objects are already in
 *    the handler, and the marginal cost is one set-based statement;
 *  - an unresolvable schema counts — "we cannot tell" must fall toward cleanup.
 *
 * What is left out is the same documented boundary #5103 drew: an UNMARKED
 * system object (no `sharingModel`, no `publicSharing`), which keeps this hook
 * off the platform's hottest delete paths. A system-minted link there is the
 * boot sweep's to reclaim — and, whether or not it ever is, `resolveToken`'s
 * existence check already refuses to honour it.
 */
export function objectCanCarryShareLinks(schema: unknown): boolean {
  if (schema == null) return true;
  const s = schema as any;
  const name = s?.name == null ? '' : String(s.name);
  if (SHARING_OWN_OBJECTS.has(name)) return false;
  if (s?.publicSharing != null) return true;
  return objectCanCarryRecordShares(schema);
}

/** The slice of the engine this module needs. */
export interface CascadeEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => any | Promise<any>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  unregisterHooksByPackage(packageId: string): number;
  find?(object: string, options?: any): Promise<any[]>;
  getSchema?(object: string): any;
  registry?: { getObject?(name: string): any };
}

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  /**
   * Non-optional for the same reason as `rule-hooks.ts`'s twin: this logger is
   * FORWARDED into `stashAffectedRows` (bulk-recompute.ts), whose sink
   * guarantees a `warn` channel under #9754. A `warn?` here would re-open the
   * silence one module downstream of where it was closed, and `tsc` said so the
   * moment the callee tightened (#10556).
   */
  warn: (msg: any, ...rest: any[]) => void;
}

/**
 * [#5190] The slice of `ShareLinkService` the cascade drives. Structural, so a
 * host can supply its own link store, and LATE-BOUND at the call site (see
 * {@link bindRecordShareCascade}'s `links` parameter) because the plugin binds
 * this cascade before it constructs the share-link service.
 */
export interface ShareLinkCascade {
  revokeLinksForDeletedRecords(object: string, recordIds: readonly string[]): Promise<void>;
  sweepOrphanedShareLinks(options?: { object?: string }): Promise<unknown>;
}

/**
 * The in-process executor for the unbounded-delete branch's object-scoped
 * sweep. Module-scoped for the same reason `ruleRegrantQueue` is: a rebind
 * must not orphan work already in flight. Serialized, so a burst of bulk
 * deletes cannot fan out into parallel table walks. Exported for tests to
 * await; production code never does.
 */
export const orphanShareSweepQueue = new RuleRegrantQueue();

function resolveSchema(engine: CascadeEngine, objectName: string): unknown {
  try {
    const fromRegistry = engine.registry?.getObject?.(objectName);
    if (fromRegistry) return fromRegistry;
  } catch {
    /* fall through to getSchema */
  }
  try {
    return engine.getSchema?.(objectName);
  } catch {
    return undefined;
  }
}

/**
 * Bind the record-delete → share-revoke cascade. Idempotent: unbinds its own
 * package first, so a re-bind (hot reload, a second `kernel:ready`) never
 * doubles the hooks.
 *
 * Runs for SYSTEM writes too — unlike the rule recompute, which leaves seed
 * writes to the boot backfill. There is no equivalent backstop here: the
 * record is gone either way, and a system-context delete (a seed reset, a
 * platform cleanup job, an admin tool) orphans a manual share exactly as an
 * interactive one does.
 */
export function bindRecordShareCascade(
  engine: CascadeEngine,
  sharing: Pick<SharingService, 'revokeSharesForDeletedRecords' | 'sweepOrphanedRecordShares'>,
  logger?: MinimalLogger,
  /**
   * [#5190] Late-bound `sys_share_link` half. A GETTER, not the service: the
   * plugin binds this cascade during `kernel:ready` and constructs the share-link
   * service later in the same handler, and the same indirection is how the
   * plugin's other optional collaborators are wired (`hierarchyResolver`,
   * `securityService`). Absent / returning nullish → links are left to the boot
   * sweep, and `resolveToken` refuses them meanwhile.
   */
  links?: () => ShareLinkCascade | null | undefined,
): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(RECORD_SHARE_CASCADE_PACKAGE);
  }
  // 190 — after the rule package's 180, so on a rules-bearing object the
  // rule-scoped revoke runs first and this one sweeps up whatever it left
  // (manual rows). Either order reaches the same state; this one keeps the
  // narrower, subsystem-owned revoke first.
  const opts = { packageId: RECORD_SHARE_CASCADE_PACKAGE, priority: 190 };

  /**
   * Which halves apply to this object, from ONE schema resolve. Both are
   * evaluated per delete (never enumerated at bind time), so an object that
   * gains `sharingModel` or `publicSharing` after boot is covered on its very
   * next delete with no rebind.
   */
  const targets = (objectName: string): { shares: boolean; links: boolean } => {
    if (!objectName || SHARING_OWN_OBJECTS.has(objectName)) return { shares: false, links: false };
    const schema = resolveSchema(engine, objectName);
    return {
      shares: objectCanCarryRecordShares(schema),
      links: objectCanCarryShareLinks(schema),
    };
  };

  /**
   * Run one half. The delete has already landed; failing here would not bring
   * the record back, so nothing rethrows — and each half is isolated, so a
   * driver error reclaiming shares cannot also skip the links (they are
   * different tables, and the token is the more dangerous leftover).
   *
   * `warn`, not `error`: the consequence is a stale row that no live record
   * matches, and the `kernel:bootstrapped` sweep repairs it on the next boot —
   * a functional degradation with a named repair path, not silent durability
   * loss.
   */
  const attempt = async (
    objectName: string,
    what: string,
    run: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await run();
    } catch (err: any) {
      logger?.warn?.(
        `[sharing] could not revoke the ${what} of a deleted record — the rows stay until the next ` +
          'boot-time orphan sweep reclaims them',
        { object: objectName, error: err?.message },
      );
    }
  };

  engine.registerHook('beforeDelete', async (ctx: any) => {
    const objectName = String(ctx?.object ?? '');
    const t = targets(objectName);
    if (!t.shares && !t.links) return;
    // Must be `before`: the delete is what makes these rows unfindable.
    // Shared stash — the rule package's own `beforeDelete` reads or writes the
    // same answer, so a write resolves its row set once however many of our
    // hook packages are bound to it.
    await stashAffectedRows(engine as any, objectName, ctx, logger);
  }, opts);

  engine.registerHook('afterDelete', async (ctx: any) => {
    const objectName = String(ctx?.object ?? '');
    const t = targets(objectName);
    if (!t.shares && !t.links) return;
    // [#6966] Once per WRITE, not once per row. `readAffectedRows` returns the
    // whole batch's id set and both branches below act on all of it — so a
    // predicate delete's per-row `afterDelete` fan-out (#5038) would repeat the
    // batch's revoke N times, and the unbounded branch's queued walk with it.
    // The row set is a property of the write; so is this work.
    if (ctx?.dispatch?.mode === 'per-row' && ctx.dispatch.index !== 0) return;
    // Belt around everything OUTSIDE the two halves (each of which has its own
    // `attempt`): a delete that already landed must never be failed by this
    // hook, whatever goes wrong in it.
    let affected: ReturnType<typeof readAffectedRows>;
    try {
      affected = readAffectedRows(ctx);
    } catch (err: any) {
      logger?.warn?.(
        '[sharing] could not read the row set of a deleted record — its shares and links stay until ' +
          'the next boot-time orphan sweep reclaims them',
        { object: objectName, error: err?.message },
      );
      return;
    }

    if (affected.kind === 'rows') {
      if (affected.ids.length === 0) return;
      if (t.shares) {
        await attempt(objectName, 'shares', () =>
          sharing.revokeSharesForDeletedRecords(objectName, affected.ids));
      }
      if (t.links) {
        const linkService = readLinkService(links, objectName, logger);
        if (linkService) {
          await attempt(objectName, 'share links', () =>
            linkService.revokeLinksForDeletedRecords(objectName, affected.ids));
        }
      }
      return;
    }

    // Unbounded: the ids are unknown, so ask the rows instead of the write.
    // Queued, because the walk's cost is unrelated to this write's and a hook
    // must not hold the caller. Under-cleaning for a moment is the safe
    // direction; over-deleting a manual share would be unrecoverable.
    // `info`, not `warn`: unlike the rule path's unbounded branch — which
    // revokes grants that records still deserve and warns because recipients
    // visibly lose access until the re-grant lands — nothing here is taken
    // from a surviving record. The sweep only removes rows whose record is
    // gone, so a deferred reclaim has no user-visible consequence to warn
    // about, and a `warn` on every bulk delete would just erode the level.
    // The sweep speaks up (at `warn`) if it actually revokes anything.
    logger?.info?.(
      '[sharing] a bulk delete touched more rows than could be enumerated — the shares of the ' +
        'deleted records are being reclaimed by a background orphan sweep instead ' +
        '(a restart re-runs the same sweep)',
      { object: objectName, reason: affected.reason },
    );
    if (t.shares) {
      orphanShareSweepQueue.enqueue(
        () => sharing.sweepOrphanedRecordShares({ object: objectName }).then(() => undefined),
        (err: any) => logger?.warn?.(
          '[sharing] background orphan share sweep failed — share rows for the deleted records stay ' +
            'until the next sweep (any bulk delete on this object, or a restart)',
          { object: objectName, error: err?.message },
        ),
      );
    }
    if (t.links) {
      const linkService = readLinkService(links, objectName, logger);
      if (linkService) {
        // Same queue as the share sweep, not a second one: both walk the same
        // records, and serializing them keeps a burst of bulk deletes from
        // fanning out into parallel table scans.
        orphanShareSweepQueue.enqueue(
          () => linkService.sweepOrphanedShareLinks({ object: objectName }).then(() => undefined),
          (err: any) => logger?.warn?.(
            '[sharing] background orphan share-link sweep failed — link rows for the deleted records ' +
              'stay until the next sweep (any bulk delete on this object, or a restart). They cannot ' +
              'be resolved meanwhile: the token check re-asks whether the record exists',
            { object: objectName, error: err?.message },
          ),
        );
      }
    }
  }, opts);

  logger?.info?.(
    '[sharing] record-delete share cascade bound (all objects; sharing posture judged per delete)' +
      (links ? ' — sys_record_share + sys_share_link' : ' — sys_record_share only (no share-link service)'),
  );
}

/**
 * [#5190] Resolve the late-bound link half. A getter that throws (a service
 * registry mid-teardown) must not fail the delete hook — it degrades to "no
 * link service", which the boot sweep repairs and `resolveToken` covers in the
 * meantime.
 */
function readLinkService(
  links: (() => ShareLinkCascade | null | undefined) | undefined,
  objectName: string,
  logger?: MinimalLogger,
): ShareLinkCascade | null {
  if (typeof links !== 'function') return null;
  try {
    return links() ?? null;
  } catch (err: any) {
    logger?.warn?.(
      '[sharing] share-link service unavailable while cascading a record delete — its links stay ' +
        'until the next boot-time orphan sweep (they cannot be resolved meanwhile)',
      { object: objectName, error: err?.message },
    );
    return null;
  }
}

/** Unbind the cascade. Returns the number of hooks removed. */
export function unbindRecordShareCascade(engine: CascadeEngine): number {
  if (typeof engine.unregisterHooksByPackage !== 'function') return 0;
  return engine.unregisterHooksByPackage(RECORD_SHARE_CASCADE_PACKAGE);
}

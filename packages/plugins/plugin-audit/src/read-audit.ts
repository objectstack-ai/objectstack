// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8992] Read/view audit — the `read` action in the compliance ledger.
 *
 * ## What this closes
 *
 * `sys_audit_log` covered WRITES only. `actionFor()` in `audit-writers.ts` maps
 * exactly `afterInsert`/`afterUpdate`/`afterDelete`, and the shipped list views
 * confirmed the scope, so the platform could not answer the one question every
 * regulated-industry security review opens with: **"who viewed this customer
 * record, and when?"** The only honest answer on a coverage matrix was
 * "requires customisation".
 *
 * ## The ruling this implements (maintainer, 2026-08-16, ruled jointly with
 * #8993 as the enterprise compliance bundle)
 *
 * Option A, scoped MVP. The scope pins are binding, and each one is a line of
 * code in this file rather than a sentence about it:
 *
 *   - **Record-detail views only.** {@link extractDetailReadId} is the whole
 *     definition: a read qualifies when it materialized ONE record and its
 *     predicate pinned the primary key. A list/search read never produces a
 *     row — list auditing is deferred to a follow-up on measured pull, and a
 *     deferral that leaks rows anyway is not a deferral.
 *   - **Per-object opt-in, closed.** {@link installReadAuditWriter} takes the
 *     opted-in object names and registers on exactly those. There is no global
 *     flag and no exception list.
 *   - **Async batched writes off the request path.** The hook ENQUEUES and
 *     returns; {@link createReadAuditBatcher} persists later. The read that
 *     produced the row never awaits its write.
 *
 * ## Why the opt-in is an INSTALL-TIME LIST and not an object-metadata key
 *
 * The neutral seam belongs in this package (open runtime); the policy —
 * *which* objects a deployment audits — belongs to the caller, which in the
 * enterprise packaging is `@objectstack/security-enterprise` composing on top.
 * A list is the whole seam: the enterprise policy engine computes it and hands
 * it over, and the open edition wires it from plugin config.
 *
 * ⛔ It is deliberately ONE input, not a registration target plus a separate
 * runtime predicate. Those would be two surfaces that can disagree, and the
 * disagreement is silent in the worst direction: a policy naming an object the
 * registration never targeted declares coverage that produces no row. On an
 * audit surface that is worse than a missing feature — a compliance reviewer
 * reads the declaration as coverage (ADR-0049 dead surface; the same argument
 * `audit-writers.ts` makes for deriving `AUDIT_EXCLUDED_OBJECTS` from
 * `SKIP_OBJECTS` rather than re-typing it).
 *
 * An object-metadata key (`enable.auditReads`) is the natural ObjectStack
 * spelling and may well be the right follow-up, but `ObjectCapabilities` is a
 * `strictObject` in `packages/spec` — a spec-side key, which routes to the spec
 * seat rather than landing here.
 *
 * ## ⛔ The row records NO field values, and that is load-bearing
 *
 * `SecurityPlugin` masks fields in MIDDLEWARE, after `next()` — i.e. **after**
 * the `afterFind` hooks this writer runs in (`security-plugin.ts`, step 4 of
 * the read middleware). So `ctx.result` here is the PRE-MASK record: it still
 * holds the plaintext of every field the caller was about to have masked or
 * deleted, including the #8993 `maskingRule` channel's partial masks.
 *
 * Copying values into `old_value` / `new_value` would therefore mint a
 * plaintext copy of exactly the data field-level security exists to withhold,
 * inside the one table compliance staff are granted broad access to. Both stay
 * `null`, and the row records WHO looked at WHICH record — which is the
 * question the card asks.
 *
 * This is also why the trail does not derive "what did this viewer actually
 * see". That answer exists and has ONE implementation —
 * `SecurityPlugin.computeReadPartialMaskRules`, which #9127 lifted so explain's
 * fls layer, result masking and `getReadableFields` all read it — and a second
 * derivation minted here would drift from it. Recording the viewer's masking
 * state is a follow-up that must READ that lifted implementation, never
 * re-derive it.
 *
 * ## Declared boundary: system-elevated reads produce no row
 *
 * A read carrying `session.isSystem` is the platform reading for its own
 * bookkeeping — a formula recompute, a roll-up, a trigger, any `api.sudo()`
 * path (`sudo()` is `{ ...ctx, isSystem: true }`, so it keeps the caller's
 * `userId`). Those are not "a person opened this record", and recording them
 * would bury the human views this ledger exists to make findable. Skipping
 * them is a NARROWING, and it is declared here and pinned in
 * `read-audit.test.ts` rather than left to be discovered — 审计面宁窄勿谎, but
 * the narrow edge has to be visible to be honest.
 */

import type { HookContext } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/spec/contracts';
// DERIVED, never re-typed — the same rule `audit-writers.ts` states for its own
// two faces. An object excluded from write auditing (recursion, auth/session
// noise, ADR-0057 telemetry plumbing) is excluded from read auditing for the
// identical reasons, and a second hand-kept list would disagree on the day
// either is fixed.
import { AUDIT_EXCLUDED_OBJECTS, createFieldPresenceProbe } from './audit-writers.js';

/**
 * The ledger action this writer emits.
 *
 * Declared as a const rather than spelled inline at the insert: every
 * `sys_audit_log` field is `readonly: true` and `validateRecord` skips readonly
 * fields, so the `action` enum validates NOTHING in either direction — a
 * misspelled action is accepted silently and no test that watches for a throw
 * can see it. The closed-literal posture is the only structural protection
 * available, and it is the same one `AuthSessionAuditAction` takes.
 * `objects/sys-audit-log-retired-actions.test.ts` pins that this value is
 * declared by the enum and that the enum declares nothing without a writer.
 */
export const READ_AUDIT_ACTION = 'read';

/** Minimal logger surface — structurally the kernel `ctx.logger` (`ILogger`). */
export interface ReadAuditLogger {
  error?(msg: string, err?: Error, meta?: Record<string, any>): void;
  /**
   * The GUARANTEED fallback channel (#9754). `error` stays optional — hosts do
   * inject reduced sinks — so `warn` is where a durability report lands when
   * `error` is absent, and a fallback that may itself be missing is not a
   * fallback. Call sites keep the `logger?.warn?.(…)` spelling as the backstop
   * for hosts the TYPE cannot reach; `SweepLogger` in plugin-email's
   * `outbox-sweep.ts` carries the full reasoning and the measurement.
   */
  warn(msg: string, meta?: Record<string, any>): void;
  debug?(msg: string, meta?: Record<string, any>): void;
}

/**
 * One record-detail view, in the vocabulary of what HAPPENED rather than of
 * what to store — the same posture `AuthSessionAuditEvent` takes, and for the
 * same reason: plugin-audit owns the `sys_audit_log` row shape, so callers hand
 * over an event and never assemble a row.
 */
export interface ReadAuditEvent {
  /** Object whose record was opened. */
  objectName: string;
  /** The record's id. */
  recordId: string;
  /** When it was opened — the VIEW instant, not the flush instant. */
  viewedAt: Date;
  /** The `sys_user` subject that opened it, when there is one. */
  userId?: string;
  /** Principal label (a user id, or `svc:<name>`) — ADR-0014 D2. */
  actor?: string;
  /** Tenant context: the record's own organization, else the session's. */
  organizationId?: string;
}

/** Handle returned by {@link createReadAuditBatcher}. */
export interface ReadAuditBatcher {
  /** Record a view. Returns immediately — never awaits the ledger write. */
  enqueue(event: ReadAuditEvent): void;
  /** Persist everything buffered right now. */
  flush(): Promise<void>;
  /** How many views are buffered and not yet persisted. */
  pending(): number;
  /** Cancel the timer and flush what is buffered. */
  stop(): Promise<void>;
}

/** Timer seam — injectable so the interval path is testable without wall time. */
export interface ReadAuditTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const DEFAULT_TIMERS: ReadAuditTimers = {
  set(fn, ms) {
    const t = setTimeout(fn, ms);
    // Never hold the process open for an audit flush: `stop()` is what
    // guarantees the tail lands on a clean shutdown.
    (t as unknown as { unref?: () => void }).unref?.();
    return t;
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface ReadAuditBatcherOptions {
  /** Persist one drained batch. Must not be called concurrently with itself. */
  persist(events: ReadAuditEvent[]): Promise<void>;
  /** Flush as soon as this many views are buffered. Default 50. */
  maxBatchSize?: number;
  /** Flush this long after the first view of a batch. Default 2000ms. */
  flushIntervalMs?: number;
  /**
   * Hard ceiling on the buffer. Beyond it the OLDEST buffered views are
   * dropped, loudly, once. A ledger that consumes unbounded memory during a
   * database outage takes the whole process with it, which loses far more than
   * the views it was protecting. Default 10000.
   */
  maxBufferedEvents?: number;
  logger?: ReadAuditLogger;
  timers?: ReadAuditTimers;
}

/**
 * Buffer record-detail views and persist them in batches, off the request path.
 *
 * Reads vastly outnumber writes, and the RFI that produced this card carries a
 * 2s record-open budget — so the read path must not pay for a ledger INSERT.
 * `enqueue` is synchronous and allocation-only; the write happens on a later
 * tick, from the timer or from a size-triggered flush.
 *
 * Failure posture matches `auth-event-audit.ts`: a lost batch is reported ONCE
 * per process and dropped, never retried in a loop. An audit write must never
 * turn a valid read into an error, and a retry storm against an unreachable
 * table is the shape that turns a degradation into an outage.
 */
export function createReadAuditBatcher(opts: ReadAuditBatcherOptions): ReadAuditBatcher {
  const {
    persist,
    maxBatchSize = 50,
    flushIntervalMs = 2000,
    maxBufferedEvents = 10_000,
    logger,
    timers = DEFAULT_TIMERS,
  } = opts;

  let buffer: ReadAuditEvent[] = [];
  let timer: unknown = null;
  /** Serializes flushes so two never interleave against the same driver. */
  let inFlight: Promise<void> = Promise.resolve();
  let stopped = false;

  let overflowReported = false;
  const reportOverflow = (dropped: number): void => {
    if (overflowReported) {
      logger?.debug?.('Read-audit buffer overflow (already reported)', { dropped });
      return;
    }
    overflowReported = true;
    logger?.warn?.(
      'Read-audit buffer OVERFLOWED — record-view rows are being DROPPED, so the compliance trail now has ' +
        'holes that no error anywhere else will show: every read still succeeded and returned 200. The buffer ' +
        'only grows this far when ledger writes are not draining (an unreachable `sys_audit_log`, or a view rate ' +
        'above what the datasource can absorb). This is reported ONCE — raise the log level to `debug` to see ' +
        'the rest. Fix: confirm `sys_audit_log` is writable from this process, then lower `flushIntervalMs` or ' +
        'raise `maxBatchSize` so batches drain faster than views arrive.',
      { dropped, maxBufferedEvents },
    );
  };

  const cancelTimer = (): void => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  };

  const drainOnce = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await persist(batch);
  };

  const runFlush = (): Promise<void> => {
    cancelTimer();
    // Chain onto whatever is already running rather than racing it. The catch
    // is `persist`'s own contract: it reports and swallows, so this chain can
    // never be left rejected and poison every later flush.
    inFlight = inFlight.then(drainOnce, drainOnce);
    return inFlight;
  };

  const armTimer = (): void => {
    if (stopped || timer !== null) return;
    timer = timers.set(() => {
      timer = null;
      void runFlush();
    }, flushIntervalMs);
  };

  return {
    enqueue(event: ReadAuditEvent): void {
      if (stopped) return;
      buffer.push(event);
      if (buffer.length > maxBufferedEvents) {
        const dropped = buffer.length - maxBufferedEvents;
        buffer.splice(0, dropped);
        reportOverflow(dropped);
      }
      if (buffer.length >= maxBatchSize) {
        void runFlush();
        return;
      }
      armTimer();
    },
    flush(): Promise<void> {
      return runFlush();
    },
    pending(): number {
      return buffer.length;
    },
    async stop(): Promise<void> {
      stopped = true;
      cancelTimer();
      await runFlush();
    },
  };
}

/**
 * The record-detail discriminator — the MVP scope pin, as code.
 *
 * A read is a record-detail view when BOTH hold:
 *
 *  1. it materialized ONE record rather than a collection. `find()` sets
 *     `ctx.result` to an array on every path (`[]` when nothing matched);
 *     `findOne()` sets it to the record or `null`. One `afterFind` event covers
 *     both verbs (#3195), so the result's shape is the only structural signal
 *     of which one ran — and it is a reliable one.
 *  2. its predicate PINNED the primary key. `GET /data/:object/:id` reaches the
 *     engine as `findOne(object, { where: { id } })` (`protocol.ts` `getData`),
 *     which is the record-detail surface. A `findOne` with any other predicate
 *     is "give me *a* matching record" — an internal lookup, not someone
 *     opening a record.
 *
 * Requiring (2) rather than accepting every `findOne` is what keeps the
 * deferral of list/search auditing real, and keeps the platform's own by-name
 * lookups out of a ledger that is supposed to answer a question about people.
 *
 * The predicate walk tolerates the shape the read middleware actually leaves
 * behind: `SecurityPlugin` AND-composes its RLS predicates onto `ast.where`
 * BEFORE the driver runs, so by the time this sees it, `{ id: 'x' }` has often
 * become `{ $and: [{ id: 'x' }, { organization_id: 'o' }] }`. `$or` and `$not`
 * are refused outright — under either, the id equality no longer proves the
 * read was FOR that record.
 *
 * @returns the pinned record id, or `null` when this read is not a detail view.
 */
export function extractDetailReadId(where: unknown, result: unknown): string | null {
  // (1) One materialized record.
  if (Array.isArray(result) || result === null || result === undefined) return null;
  if (typeof result !== 'object') return null;
  const resultId = (result as Record<string, unknown>).id;
  if (typeof resultId !== 'string' && typeof resultId !== 'number') return null;

  // (2) A primary-key pin somewhere in the AND-closure of the predicate.
  const pinned = findIdPin(where, 0);
  if (pinned === null) return null;

  return String(resultId);
}

/** Max `$and` nesting walked — a guard against a pathological/cyclic predicate. */
const MAX_PREDICATE_DEPTH = 8;

function findIdPin(node: unknown, depth: number): string | null {
  if (depth > MAX_PREDICATE_DEPTH) return null;
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const obj = node as Record<string, unknown>;

  // `$or` / `$not` anywhere on the path breaks the proof: the row may have
  // matched through the other arm, so an `id` equality below one of them does
  // not mean the caller asked for THIS record.
  if ('$or' in obj || '$not' in obj) return null;

  const idClause = obj.id;
  if (typeof idClause === 'string' || typeof idClause === 'number') return String(idClause);
  if (idClause && typeof idClause === 'object' && !Array.isArray(idClause)) {
    const eq = (idClause as Record<string, unknown>).$eq;
    if (typeof eq === 'string' || typeof eq === 'number') return String(eq);
  }

  const and = obj.$and;
  if (Array.isArray(and)) {
    for (const member of and) {
      const found = findIdPin(member, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Handle returned by {@link installReadAuditWriter}. */
export interface ReadAuditWriterHandle {
  /** The objects this writer is installed on — the closed opt-in set. */
  readonly auditedObjects: readonly string[];
  /** Persist every buffered view now. */
  flush(): Promise<void>;
  /** Views buffered and not yet persisted. */
  pending(): number;
  /** Cancel the timer and flush the tail. */
  stop(): Promise<void>;
}

export interface ReadAuditWriterOptions {
  /**
   * The per-object opt-in — the closed set of objects whose record-detail views
   * are recorded. Empty (or all-excluded) installs nothing at all: no hook is
   * registered, so a deployment that opts nothing in pays nothing.
   */
  objects: readonly string[];
  packageId?: string;
  logger?: ReadAuditLogger;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  maxBufferedEvents?: number;
  timers?: ReadAuditTimers;
  /** Clock seam — the view instant stamped on the row. Defaults to `Date`. */
  now?: () => Date;
}

/**
 * Install the record-view writer on the engine.
 *
 * Registers ONE `afterFind` hook, targeted at exactly the opted-in objects, so
 * a read of any other object never dispatches into this package at all. That
 * narrow registration is the per-object opt-in's enforcement — not a wildcard
 * hook with an early return, which would pay a dispatch on every read in the
 * system to answer "no".
 */
export function installReadAuditWriter(
  engine: IDataEngine,
  opts: ReadAuditWriterOptions,
): ReadAuditWriterHandle | null {
  const eng = engine as unknown as {
    registerHook?: (event: string, handler: (ctx: HookContext) => unknown, options?: unknown) => unknown;
  };
  if (!engine || typeof eng.registerHook !== 'function') return null;

  const { packageId = 'com.objectstack.audit', logger, now = () => new Date() } = opts;

  const excluded = new Set(AUDIT_EXCLUDED_OBJECTS);
  // De-duplicated, exclusion-filtered, and order-stable so the handle reports
  // exactly what was registered rather than what was asked for.
  const auditedObjects = [...new Set(opts.objects ?? [])].filter((name) => {
    if (typeof name !== 'string' || name.trim().length === 0) return false;
    if (excluded.has(name)) {
      logger?.warn?.(
        `Read audit: '${name}' is on the audit exclusion list (recursion / auth-session noise / ADR-0057 ` +
          'telemetry plumbing) and will NOT have its record views recorded. Remove it from the read-audit ' +
          'opt-in so the configuration stops claiming coverage this writer does not provide.',
        { object: name },
      );
      return false;
    }
    return true;
  });

  if (auditedObjects.length === 0) return null;

  const objectHasField = createFieldPresenceProbe(engine);

  /**
   * Write one batch of ledger rows.
   *
   * Extracted as a NAMED callee so `pnpm check:durability-log-level` can anchor
   * on it — it is declared in that gate's `DURABILITY_CRITICAL_CALLEES` in the
   * same PR, so a future edit cannot quietly walk the failure report back down
   * to `warn`. A bare `.insert()` is far too generic a name for a repo-wide
   * vocabulary. Same reasoning as `persistAuditTrailRow` / `persistAuthEventAuditRow`.
   */
  const persistReadAuditRows = async (rows: Record<string, unknown>[]): Promise<void> => {
    // `sys_audit_log` exposes only `get`/`list` on the API and every field is
    // `readonly`, so a user-context write would be refused. The system context
    // is also what lets the row keep its VIEW timestamp — see `buildRow`.
    await engine.insert('sys_audit_log', rows as any, { context: { isSystem: true } } as any);
  };

  let failureReported = false;
  const reportReadAuditWriteFailure = (count: number, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      if (failureReported) {
        logger?.debug?.('Read-audit write failed (already reported)', { count, err: detail });
        return;
      }
      failureReported = true;
      const message =
        `Read-audit write FAILED — ${count} record-view row(s) were LOST and the compliance trail is now ` +
          'INCOMPLETE. The reads themselves SUCCEEDED and returned 200, so the API, the screens and every ' +
          'counter read clean; only the `sys_audit_log` rows recording WHO opened those records never landed, ' +
          'and nothing retries them. Every subsequent batch is likely lost the same way (this is reported ONCE ' +
          '— raise the log level to `debug` to see the rest). The whole point of this capability is answering ' +
          '"who viewed this record" for an auditor, so the failure mode is a query that returns a confident, ' +
          'wrong, SHORT answer. Fix: confirm `sys_audit_log` is reachable from the connection this write ran ' +
          'on — its ADR-0057 §3.6 lifecycle class routes it to the dedicated `telemetry` datasource whenever ' +
          'one is registered (`os dev` provisions one by default as a SIBLING SQLite file), so a "no such ' +
          'table" here usually means the write executed against a DIFFERENT datasource than the one the table ' +
          'was created in. Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on the primary ' +
          'datasource.';
      // `error` is OPTIONAL on this sink, so `logger?.error?.(…)` printed
      // NOTHING when the host injected one without it — the durability
      // degradation this text describes would then be reported by nobody at
      // all (#9657). Reach for `error`, fall back to `warn`, never to silence.
      if (logger?.error) {
        logger.error(message, err instanceof Error ? err : new Error(detail), { count });
      } else {
        logger?.warn?.(message, { count, err: detail });
      }
    } catch {
      /* logging must never break the read */
    }
  };

  const buildRow = (event: ReadAuditEvent): Record<string, unknown> => {
    const tenantId = event.organizationId ?? null;
    const row: Record<string, unknown> = {
      action: READ_AUDIT_ACTION,
      // ⛔ The VIEW instant, not the flush instant. Batching moves the INSERT
      // off the request path by design, so `created_at`'s `NOW()` default would
      // stamp every row in a batch with one flush timestamp up to
      // `flushIntervalMs` after the fact — a ledger that answers "when did they
      // look?" with the time its own buffer drained. `created_at` is
      // engine-owned and stripped from ordinary writes (#4447), and a
      // system-context write is the declared exemption (pinned by
      // `engine-audit-anchor-write.test.ts`: "a system-context write is still
      // exempt"), which is exactly the context `persistReadAuditRows` uses.
      created_at: event.viewedAt,
      user_id: event.userId ?? null,
      object_name: event.objectName,
      record_id: event.recordId,
      // ⛔ Both stay null — see this module's header. `afterFind` runs INSIDE
      // the security middleware, before its field masking, so `ctx.result` here
      // is pre-mask plaintext. A "view" is not a field diff either: recording
      // `{}` would be a claim about a record that never changed.
      old_value: null,
      new_value: null,
      tenant_id: tenantId,
    };
    // Both columns are conditionally present — see `createFieldPresenceProbe`.
    // `organization_id` is what the SecurityPlugin's RLS predicate gates on, so
    // an unstamped row is a row non-admin members can never see.
    if (objectHasField('sys_audit_log', 'organization_id')) {
      row.organization_id = tenantId;
    }
    if (objectHasField('sys_audit_log', 'actor')) {
      row.actor = event.actor ?? event.userId ?? null;
    }
    return row;
  };

  const batcher = createReadAuditBatcher({
    async persist(events) {
      try {
        await persistReadAuditRows(events.map(buildRow));
      } catch (err) {
        reportReadAuditWriteFailure(events.length, err);
      }
    },
    ...(opts.maxBatchSize !== undefined ? { maxBatchSize: opts.maxBatchSize } : {}),
    ...(opts.flushIntervalMs !== undefined ? { flushIntervalMs: opts.flushIntervalMs } : {}),
    ...(opts.maxBufferedEvents !== undefined ? { maxBufferedEvents: opts.maxBufferedEvents } : {}),
    ...(logger !== undefined ? { logger } : {}),
    ...(opts.timers !== undefined ? { timers: opts.timers } : {}),
  });

  const recordView = (ctx: HookContext): void => {
    const session = ((ctx as any).session ?? {}) as Record<string, unknown>;
    // Declared boundary — see this module's header. `sudo()` keeps the caller's
    // `userId`, so this flag is the ONLY thing separating "a person opened this
    // record" from "the platform read it while doing something else".
    if (session.isSystem === true) return;

    const userId = typeof session.userId === 'string' && session.userId ? session.userId : undefined;
    const actor =
      typeof session.actor === 'string' && session.actor.trim() ? session.actor.trim() : undefined;
    // No principal, no answer to "who". A row naming nobody adds noise to the
    // one query this capability exists to serve.
    if (!userId && !actor) return;

    const recordId = extractDetailReadId((ctx as any).input?.ast?.where, ctx.result);
    if (recordId === null) return;

    const organizationId =
      readRecordOrganization(ctx.result) ??
      (typeof session.organizationId === 'string' && session.organizationId
        ? session.organizationId
        : undefined);

    batcher.enqueue({
      objectName: ctx.object,
      recordId,
      viewedAt: now(),
      ...(userId !== undefined ? { userId } : {}),
      ...(actor !== undefined ? { actor } : {}),
      ...(organizationId !== undefined ? { organizationId } : {}),
    });
  };

  /**
   * The hook. Synchronous by design and wrapped whole: it must add no awaited
   * work to the read it observes, and an audit failure must never turn a valid
   * read into an error.
   */
  const auditRead = (ctx: HookContext): void => {
    try {
      recordView(ctx);
    } catch (err) {
      logger?.debug?.('Read-audit hook skipped a read', {
        object: ctx?.object,
        err: String((err as any)?.message ?? err),
      });
    }
  };

  eng.registerHook('afterFind', auditRead, { object: [...auditedObjects], packageId });

  return {
    auditedObjects,
    flush: () => batcher.flush(),
    pending: () => batcher.pending(),
    stop: () => batcher.stop(),
  };
}

/**
 * The record's own organization, when it carries one.
 *
 * Deliberately the same precedence the CRUD writer settled on under the #8287
 * ruling: the audited RECORD'S organization wins, the acting session's active
 * organization is the fallback. An audit row is read through `sys_audit_log`'s
 * own tenant wall, so a row about an org-A record stamped with the viewer's
 * active org B lands behind B's wall — invisible to the one tenant admin the
 * row concerns.
 *
 * Read straight off the returned record rather than through
 * `resolveRecordOrganizationField`: a read result is the materialized row, so
 * the column is either on it or it is not, and the platform-default
 * `organization_id` is the only spelling `sys_audit_log`'s own wall gates on.
 */
function readRecordOrganization(record: unknown): string | undefined {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const v = (record as Record<string, unknown>).organization_id;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sys_comment record-level authorization (#4630, ADR-0049 enforce-or-remove).
 *
 * `sys_comment` rows are written and read through the generic data path, and
 * the default member permission sets grant wildcard CRUD with no row scoping.
 * The object is public, carries no owner column, and its parent lives inside a
 * *string* (`thread_id` = `{object_name}:{record_id}`), so neither OWD/sharing
 * nor RLS ever narrows it: before this module any authenticated member could
 * list — and post — comments on records they cannot see. `enable.feeds` is
 * opt-OUT (spec default `true`), so that side-channel hung off every object of
 * every app.
 *
 * This is the sys_attachment kit (`attachment-access-hooks.ts` in
 * @objectstack/service-storage) applied to the comment thread: a comment's
 * access is DERIVED FROM ITS PARENT RECORD, the same way an attachment's is
 * (Salesforce ContentDocumentLink / Chatter semantics, generalizing ADR-0055
 * `controlled_by_parent` to a parent named at runtime).
 *
 *  - {@link installCommentAccessHooks} — the write side:
 *    * `beforeInsert`: the caller must be able to READ the parent record —
 *      verified with a caller-scoped `findOne`, so the parent's own
 *      OWD/sharing, RLS and object-level CRUD all apply. `author_id` is
 *      server-stamped from the session; a client-supplied value never wins.
 *    * `beforeUpdate` / `beforeDelete`: the caller must be the comment's
 *      AUTHOR, or hold EDIT on the parent record (sharing's `canEdit`;
 *      public-model parents are editable by design) — the attachment kit's
 *      uploader-or-parent-editor rule. A multi-row write requires EVERY
 *      matched row to pass, and an update that re-points `thread_id` must
 *      additionally satisfy the insert rule on the NEW thread.
 *  - {@link installCommentReadVisibility} — the read side: a
 *    `find`/`findOne`/`count`/`aggregate` middleware that intersects the query
 *    with the threads whose parent record the caller can actually read.
 *
 * Why read gating requires EDIT on write but only READ on insert: posting a
 * comment is collaboration — a user who may READ a record may discuss it (the
 * attachment kit's stricter `canEdit` on insert exists because attaching a
 * FILE mutates the record's content surface). Rewriting or removing someone
 * else's words is moderation, hence the tighter author-or-parent-editor rule.
 *
 * Everything fails CLOSED. A `thread_id` that names no parseable parent (the
 * dangling `"crm_opportunity:"` of #4630, a free-form thread, a thread on
 * `sys_comment` itself) is REFUSED on write and EXCLUDED on read: an
 * unauthorizable thread is not an unguarded one.
 *
 * System-context operations (engine self-writes, seeds, imports) bypass all of
 * it, as do context-less programmatic calls on bare kernels (no principal to
 * authorize — every real transport carries a context).
 *
 * These run alongside `enforceFeedsCapability` in `audit-writers.ts`, which is
 * ORTHOGONAL: that gate answers "does this object allow comments at all"
 * (`enable.feeds`), this one answers "may THIS caller see/touch THIS record's
 * comments". Both are fail-closed 403s, so their relative order is not
 * load-bearing.
 */

import type { ISharingService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/** Minimal engine surface these installers need — duck-typed (like
 * service-storage's attachment seams) so tests can fake it and so plugin-audit
 * keeps its dependency-free posture. */
export interface CommentAccessEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string; packageId?: string },
  ): void;
  /** Onion-model data middleware (runs for find/findOne/count/aggregate AND
   * writes) — the only seam that filters `count()` (→ list `total`) identically
   * to `find()`. Optional: only the read-visibility installer needs it. */
  registerMiddleware?(
    fn: (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>,
    options?: { object?: string },
  ): void;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
}

/** Minimal shape of the engine `OperationContext` the read middleware reads. */
export interface CommentReadMiddlewareCtx {
  object: string;
  operation: 'find' | 'findOne' | 'insert' | 'update' | 'delete' | 'count' | 'aggregate';
  ast?: { object?: string; where?: unknown } & Record<string, unknown>;
  context?: { userId?: string; tenantId?: string; positions?: string[]; permissions?: string[]; isSystem?: boolean } & Record<string, unknown>;
}

/**
 * The single method of plugin-sharing's contract this gate consults. Taken as
 * a `Pick` of the real `ISharingService` rather than re-declared locally: the
 * narrow surface is the point, a second hand-written shape for it is not
 * (AGENTS.md PD #12 — one contract, no dialects).
 */
export type CommentSharingLike = Pick<ISharingService, 'canEdit'>;

export interface CommentAccessLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  debug?(msg: string, meta?: unknown): void;
}

/** Must match `AuditPlugin.name` — hooks are removable by owning package. */
const PACKAGE_ID = 'com.objectstack.audit';
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * The one wire code these gates emit. Deliberately the STANDARD catalog member
 * (`StandardErrorCode`, "Sharing rule restriction") rather than a new
 * `COMMENT_*` extension: ADR-0112's ledger says to reach for the catalog when
 * the condition is generic permission, and "you have no access to the record
 * behind this thread" is exactly that. One condition, one code — the message
 * names which gate refused.
 */
const DENY_CODE = 'RECORD_NOT_ACCESSIBLE';

/** Bound on rows authorized per multi-row update/delete; mirrors the
 * attachment kit's bound. Larger multi-writes fail closed. */
const MULTI_WRITE_AUTH_LIMIT = 1_000;

/** Bound on the per-read candidate pre-scan. Beyond this the filter fails
 * CLOSED (excludes the un-scanned rows) rather than leaking them. */
const READ_SCAN_LIMIT = 2_000;

const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

/** No real row matches — the fail-closed sentinel (mirrors plugin-sharing's
 * `{ id: '__deny_all__' }` read-filter deny). */
const READ_DENY_ALL = { id: '__comment_thread_denied__' } as const;

/** Object machine-name shape (`ObjectSchema.name` in packages/spec). */
const OBJECT_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/** The record a comment thread hangs off. */
export interface CommentThreadTarget {
  object: string;
  recordId: string;
}

/**
 * Parse `thread_id` into the record it hangs off — the ONE definition both the
 * write hooks and the read middleware use, so a thread can never be readable
 * under one gate and writable under another.
 *
 * `{object_name}:{record_id}`, split on the FIRST colon (a record id may
 * legally contain one). Returns `null` — meaning "no authorizable parent",
 * which every caller here treats as DENY — for:
 *   - a non-string / colon-less / free-form thread id;
 *   - an empty object name or an empty record id (the dangling
 *     `"crm_opportunity:"` of #4630, which used to insert happily);
 *   - an object name that is not a machine name;
 *   - `sys_comment` itself: a comment is not a record-level parent (replies use
 *     the `parent_id` lookup), and probing it would re-enter these very gates.
 */
export function parseCommentThreadId(threadId: unknown): CommentThreadTarget | null {
  if (typeof threadId !== 'string') return null;
  const sep = threadId.indexOf(':');
  if (sep <= 0) return null;
  const object = threadId.slice(0, sep);
  const recordId = threadId.slice(sep + 1);
  if (!recordId) return null;
  if (!OBJECT_NAME_RE.test(object)) return null;
  if (object === 'sys_comment') return null;
  return { object, recordId };
}

function forbid(message: string, object?: string): never {
  const err: any = new Error(message);
  err.code = DENY_CODE;
  err.status = 403;
  if (object) err.object = object;
  throw err;
}

function asIdList(id: unknown): Array<string | number> | null {
  if (typeof id === 'string' || typeof id === 'number') return [id];
  if (id && typeof id === 'object' && Array.isArray((id as any).$in)) {
    return (id as any).$in.filter((v: unknown) => typeof v === 'string' || typeof v === 'number');
  }
  return null;
}

/**
 * Keys plugin-security's middleware STAMPS onto the operation context, resolved
 * for the object of the CURRENT operation — `sys_comment` here.
 *
 * They are middleware-private vocabulary, not fields of `ExecutionContext`, and
 * they are all read as WIDENING inputs by whoever consumes them: the ADR-0057
 * D1 access DEPTH the sharing owner-match expands to (`__readScope` /
 * `__writeScope`, plus the ADR-0090 D10 delegator halves
 * `__delegatorReadScope` / `__delegatorWriteScope`, `security-plugin.ts` — `sc.__readScope = …`),
 * and the engine's internal privilege markers on the same channel
 * (`__expandRead` waives the object-level CRUD check for a lookup expansion,
 * `__referentialFieldClear` the referential-clear write).
 *
 * Every gate in this module asks about the PARENT record's object, never about
 * `sys_comment`, so carrying any of these across is one object's widening
 * applied to another object's question — the exact stale-scope leak
 * `resolveWriteScopeForSharing` was extracted to prevent ("a stale value can
 * never leak in through a spread", `security-plugin.ts`). They are therefore
 * dropped by PREFIX rather than by a name list: the `__` convention is what
 * marks a key as belonging to the operation in flight, and a list would go
 * stale the day the middleware stamps a fifth one.
 */
const OPERATION_PRIVATE_KEY_PREFIX = '__';

/**
 * The caller's execution envelope, minus the operation-private keys above.
 *
 * [#7141] A FRESH object every time, so a callee that stamps its own
 * `__writeScope` onto what it receives (which is exactly what plugin-security
 * does before it calls the sharing service) can never write back into the
 * operation context this hook was handed.
 */
function withoutOperationPrivateKeys(exec: Record<string, unknown>): ExecutionContext {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exec)) {
    if (key.startsWith(OPERATION_PRIVATE_KEY_PREFIX)) continue;
    out[key] = value;
  }
  return out as ExecutionContext;
}

/** The caller's ExecutionContext rides on the operation options — the session
 * snapshot lacks `permissions`, which sharing bypasses need.
 *
 * [#7136] Typed as the full envelope, which is what `ISharingService` declares
 * for every parameter this value is handed to (#6523 / the #6206 ruling).
 *
 * [#7141] And FORWARDED as the full envelope, which is the other half of that
 * ruling: a caller "MUST NOT rebuild a subset of it". The five-field projection
 * this replaced (`userId` / `tenantId` / `positions` / `permissions` /
 * `isSystem`) was doing two jobs at once, and only one of them was correct:
 *
 *  - dropping the middleware-private keys — CORRECT, and preserved above by
 *    {@link withoutOperationPrivateKeys}: `return exec;` would hand
 *    `sys_comment`'s access depth to the parent object's owner-match;
 *  - dropping the PRINCIPAL fields — the defect. Two of them decide the
 *    verdict the gate then trusts:
 *    * `onBehalfOf` — `ISecurityService.hasWriteBypass`, the `modifyAllRecords`
 *      probe `SharingService.canEdit` consults last, is documented to fail
 *      CLOSED on a delegated context and implements that by reading exactly
 *      `context?.onBehalfOf?.userId` (`security-plugin.ts`). Stripped, that
 *      guard could never fire here, and a `/mcp` OAuth agent principal (which
 *      `resolve-execution-context.ts` builds WITH the delegation link) reached
 *      the bypass probe looking like an ordinary direct call.
 *    * `principalKind` — `resolvePermissionSetsForContext` keys the ADR-0090
 *      D10 rule "an agent's grants are EXACTLY its scope-derived ceiling" on
 *      `principalKind === 'agent'`; stripped, the additive human baseline
 *      (`member_default`) was appended to an agent's ceiling on this path, so
 *      the sets the bypass probe evaluated were a SUPERSET of what the user
 *      consented to.
 *
 *    `systemPermissions`, `accessible_org_ids`, `posture`, `audience` and
 *    `rlsMembership` were dropped by the same projection; they are forwarded
 *    now for the same reason — the envelope is the contract's unit.
 *
 * Note what deliberately did NOT change: no access DEPTH is synthesised for the
 * parent object. Absent depth leaves the sharing owner-match at its narrowest
 * (`own`) — the safe direction, and byte-for-byte the behaviour the projection
 * produced.
 *
 * [#7144] That is now the RULED shape, not a pending question: the maintainer's
 * ruling of 2026-08-10 keeps these gates at `own`, deliberately tighter than
 * the parent's real edit authority. The reasoning — including the fail-open in
 * `ISecurityService.resolveWriteScope` that makes the widening unsafe to wire
 * today — is recorded once on the contract that owns this gate's meaning
 * (`@objectstack/spec` — `ISharingService`, "Write DEPTH is an input the CALLER
 * supplies"), because the `sys_attachment` kit reaches the same gate from
 * another package; it is not restated here. */
function callerContext(ctx: any): ExecutionContext {
  const exec = ctx?.input?.options?.context;
  if (exec && typeof exec === 'object') {
    return withoutOperationPrivateKeys(exec as Record<string, unknown>);
  }
  const s = ctx?.session ?? {};
  return { userId: s.userId, tenantId: s.tenantId ?? s.organizationId, positions: s.positions };
}

/** Can the CALLER read `(object, recordId)`? A caller-scoped `findOne` through
 * the hook api, so the parent's OWD/sharing, RLS and object-level CRUD all
 * decide it. Any throw (unknown object, driver error) reads as "no". */
async function callerCanRead(ctx: any, target: CommentThreadTarget): Promise<boolean> {
  try {
    return !!(await ctx.api.object(target.object).findOne({ where: { id: target.recordId } }));
  } catch {
    return false;
  }
}

/**
 * Install the write-side gates on `sys_comment` (insert / update / delete).
 *
 * `getSharing` resolves plugin-sharing's service lazily so plugin registration
 * order does not matter, and returns `null` on a deployment without it — in
 * which case the edit checks degrade to caller-scoped parent READ visibility,
 * still strictly tighter than no gate at all.
 */
export function installCommentAccessHooks(
  engine: CommentAccessEngine,
  getSharing: () => CommentSharingLike | null | undefined,
  logger: CommentAccessLogger,
): void {
  /** May the caller EDIT the parent record behind `target`? Sharing's
   * `canEdit` when the service is present, else caller-scoped parent read
   * visibility (degraded mode). */
  const canEditParent = async (ctx: any, target: CommentThreadTarget, verb: string): Promise<boolean> => {
    const sharing = getSharing();
    if (sharing && typeof sharing.canEdit === 'function') {
      return sharing.canEdit(target.object, target.recordId, callerContext(ctx));
    }
    logger.debug?.(
      `[audit] comment access: sharing service absent — ${verb} gated on parent read visibility`,
    );
    return callerCanRead(ctx, target);
  };

  // ── Create: parent-record READ access + author_id stamping ──────────
  engine.registerHook(
    'beforeInsert',
    async (ctx: any) => {
      if (ctx?.session?.isSystem) return;
      if (!ctx?.session) return; // context-less programmatic call (bare kernel)
      const data: any = ctx?.input?.data;
      if (!data || typeof data !== 'object') return;

      // Server stamps provenance: the session identity wins over whatever the
      // client sent. Without this the author-or-parent-editor rule below is
      // spoofable — a caller could post as anyone, then "author-delete" it.
      if (ctx.session.userId) data.author_id = ctx.session.userId;

      const target = parseCommentThreadId(data.thread_id);
      if (!target) {
        forbid(
          `Cannot comment: thread_id ${JSON.stringify(data.thread_id ?? null)} does not name a record ` +
            '(expected `{object_name}:{record_id}`)',
        );
      }
      // Commenting requires READ on the parent — a user who may see a record
      // may discuss it. The parent's OWD/sharing/RLS/CRUD decide, so a
      // permission set that reads nothing (a portal/guest set) cannot comment.
      if (!(await callerCanRead(ctx, target))) {
        forbid(
          `Cannot comment on ${target.object}/${target.recordId}: the record does not exist or you cannot read it`,
          target.object,
        );
      }
    },
    { object: 'sys_comment', packageId: PACKAGE_ID },
  );

  /** Resolve every sys_comment row a write matches, under SYSTEM context — the
   * caller may legitimately be unable to READ rows they are allowed to touch,
   * and the read middleware must not narrow the authorization input. Fails
   * closed on an unscoped multi-write and on an over-large match set. */
  const resolveTargetRows = async (ctx: any, verb: string): Promise<Array<Record<string, unknown>>> => {
    const ids = asIdList(ctx?.input?.id);
    if (ids) {
      const rows: Array<Record<string, unknown>> = [];
      for (const id of ids) {
        const row = await engine.findOne('sys_comment', { where: { id }, context: { ...SYSTEM_CTX } });
        if (row) rows.push(row);
      }
      return rows;
    }
    const where = ctx?.input?.options?.where;
    if (where === undefined || where === null) {
      // No id and no predicate: a bulk write over the WHOLE table. Nothing to
      // authorize row-by-row, and "nothing to authorize" must never read as
      // "allowed" (the engine would hand an unscoped AST to deleteMany).
      forbid(`Refusing an unscoped multi-${verb} of comments — scope the write to the rows you mean`);
    }
    const rows = await engine.find('sys_comment', {
      where,
      limit: MULTI_WRITE_AUTH_LIMIT + 1,
      context: { ...SYSTEM_CTX },
    });
    if (rows.length > MULTI_WRITE_AUTH_LIMIT) {
      forbid(`Refusing to authorize a multi-${verb} matching more than ${MULTI_WRITE_AUTH_LIMIT} comments`);
    }
    return rows;
  };

  /** Author-or-parent-editor over every matched row (the attachment kit's
   * uploader-or-parent-editor rule). Parent-edit verdicts are memoized per
   * thread — a multi-row write usually targets one record. */
  const authorizeRows = async (
    ctx: any,
    rows: Array<Record<string, unknown>>,
    verb: 'update' | 'delete',
  ): Promise<void> => {
    const userId = ctx.session.userId as string | undefined;
    const canEditCache = new Map<string, boolean>();
    for (const row of rows) {
      if (userId && row.author_id === userId) continue; // authors govern their own words

      const threadId = row.thread_id;
      const target = parseCommentThreadId(threadId);
      if (!target) {
        // A dangling thread has no parent to inherit authority from, and the
        // caller is not the author → nobody but system may touch it.
        forbid(
          `Cannot ${verb} comment ${row.id}: its thread ${JSON.stringify(threadId ?? null)} names no record, ` +
            'so only its author may modify it',
        );
      }
      const cacheKey = String(threadId);
      let allowed = canEditCache.get(cacheKey);
      if (allowed === undefined) {
        allowed = await canEditParent(ctx, target, verb);
        canEditCache.set(cacheKey, allowed);
      }
      if (!allowed) {
        forbid(
          `Cannot ${verb} comment ${row.id}: only its author or a user who can edit the parent record ` +
            `(${target.object}/${target.recordId}) may ${verb} it`,
          target.object,
        );
      }
    }
  };

  // ── Update: author or parent editor (+ the insert rule on a re-point) ──
  engine.registerHook(
    'beforeUpdate',
    async (ctx: any) => {
      if (ctx?.session?.isSystem) return;
      if (!ctx?.session) return;
      const rows = await resolveTargetRows(ctx, 'update');
      if (rows.length) await authorizeRows(ctx, rows, 'update');

      // Moving a comment to another thread is an insert into that thread: the
      // NEW parent must be readable, or an authorized edit of your own comment
      // would be a way to plant content on a record you cannot see.
      const nextThreadId: unknown = ctx?.input?.data?.thread_id;
      if (nextThreadId === undefined) return;
      if (rows.length && rows.every((r) => r.thread_id === nextThreadId)) return; // unchanged
      const target = parseCommentThreadId(nextThreadId);
      if (!target) {
        forbid(
          `Cannot move comment: thread_id ${JSON.stringify(nextThreadId ?? null)} does not name a record ` +
            '(expected `{object_name}:{record_id}`)',
        );
      }
      if (!(await callerCanRead(ctx, target))) {
        forbid(
          `Cannot move comment to ${target.object}/${target.recordId}: the record does not exist or you cannot read it`,
          target.object,
        );
      }
    },
    { object: 'sys_comment', packageId: PACKAGE_ID },
  );

  // ── Delete: author or parent editor ─────────────────────────────────
  engine.registerHook(
    'beforeDelete',
    async (ctx: any) => {
      if (ctx?.session?.isSystem) return;
      if (!ctx?.session) return;
      const rows = await resolveTargetRows(ctx, 'delete');
      if (!rows.length) return; // nothing matched — nothing to authorize
      await authorizeRows(ctx, rows, 'delete');
    },
    { object: 'sys_comment', packageId: PACKAGE_ID },
  );
}

/**
 * sys_comment READ visibility inheritance — the read half of the kit.
 *
 * The hooks above gate writes, but a member could still LIST `sys_comment`
 * rows (body, author, thread_id) pointing at records they cannot read, which
 * is the leak #4630 actually reported. `sys_comment` is public with no owner
 * field, so the sharing/RLS static-predicate filters never narrow it.
 *
 * This is a data **middleware** (not a find-hook) on purpose: middleware runs
 * for `find`, `findOne`, `count`, AND `aggregate`, so a list's `total` (which
 * comes from `engine.count()`, NOT the find path) is filtered identically to
 * the returned rows — a beforeFind/afterFind hook would leave `count()`
 * unfiltered and leak the true row count via `total`.
 *
 * Mechanism: for each read, pre-scan the candidate `thread_id`s the query
 * would touch (system context), resolve which of their parent records the
 * caller can actually read through the caller-scoped engine (the parent's own
 * RLS/OWD/sharing apply), and AND `{ thread_id: { $in: <visible threads> } }`
 * into `ctx.ast.where`. Threads whose parent is invisible — and threads that
 * name no parent at all — simply never enter that list.
 */
export function installCommentReadVisibility(
  engine: CommentAccessEngine,
  logger: CommentAccessLogger,
): void {
  if (typeof engine.registerMiddleware !== 'function') return; // engine lacks the seam
  const andIn = (ctx: CommentReadMiddlewareCtx, filter: unknown) => {
    if (!ctx.ast) return;
    ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, filter] } : filter;
  };

  engine.registerMiddleware(
    async (ctx, next) => {
      // Only reads carry an `ast` to constrain; writes are gated by the hooks
      // above. System / context-less (internal) reads are not narrowed.
      if (!READ_OPS.has(ctx.operation) || !ctx.ast || !ctx.context || ctx.context.isSystem) {
        return next();
      }
      try {
        const filter = await computeThreadVisibilityFilter(engine, ctx, logger);
        if (filter) andIn(ctx, filter);
      } catch (err) {
        // A filter-compute failure must never fall open into a leak.
        logger.warn(
          `[audit] comment read visibility: filter failed, denying all (${(err as Error)?.message ?? err})`,
        );
        andIn(ctx, READ_DENY_ALL);
      }
      return next();
    },
    { object: 'sys_comment' },
  );
}

/**
 * Resolve the thread-visibility WHERE predicate for one sys_comment read.
 * Returns `null` when the query matches no rows (nothing to narrow), a
 * `thread_id` `$in` of the visible threads, or the deny-all sentinel.
 */
async function computeThreadVisibilityFilter(
  engine: CommentAccessEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
): Promise<unknown | null> {
  // 1. Candidate thread ids the query would touch — read under SYSTEM context
  //    (the caller may not see the rows yet; that is exactly what we are
  //    deciding). Bypasses this middleware (isSystem).
  const candidates = await engine.find('sys_comment', {
    where: (ctx.ast?.where as Record<string, unknown>) ?? {},
    fields: ['thread_id'],
    limit: READ_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (!candidates.length) return null;
  if (candidates.length >= READ_SCAN_LIMIT) {
    // Not silent (fail-closed truncation): rows beyond the scan window are
    // excluded from the visibility filter, so a very broad unscoped list may
    // omit rows the caller could see. The comment panel scopes to one thread
    // so never hits this; a global list should paginate by thread_id.
    logger.warn(
      `[audit] comment read visibility: candidate pre-scan hit the ${READ_SCAN_LIMIT}-row cap; ` +
        'the visibility filter for this broad read is fail-closed and may omit visible rows — scope the query by thread_id',
    );
  }

  /** thread_id (verbatim, as stored) → its parent. Unparseable threads are
   * dropped here, which is what makes them invisible. */
  const threads = new Map<string, CommentThreadTarget>();
  const byObject = new Map<string, Set<string>>();
  for (const row of candidates) {
    const threadId = row.thread_id;
    if (typeof threadId !== 'string' || threads.has(threadId)) continue;
    const target = parseCommentThreadId(threadId);
    if (!target) continue;
    threads.set(threadId, target);
    let ids = byObject.get(target.object);
    if (!ids) byObject.set(target.object, (ids = new Set()));
    ids.add(target.recordId);
  }
  if (threads.size === 0) return READ_DENY_ALL;

  // 2. Per parent object, the visible id subset via the CALLER's context —
  //    the parent object's own RLS/OWD/sharing applies.
  //
  //    [#7141] The caller's envelope, minus the operation-private keys: this
  //    probe reads a DIFFERENT object than the one the middleware resolved its
  //    depth for, and `__readScope` / `__expandRead` are widening inputs that
  //    would arrive attached to the wrong question (the security middleware
  //    re-stamps the depth for THIS object when it resolves any set, so the
  //    only thing dropping them can do is leave the owner-match at its
  //    narrowest — the safe direction). Same rule as `callerContext` above.
  const callerEnvelope = withoutOperationPrivateKeys(
    (ctx.context ?? {}) as Record<string, unknown>,
  );
  const visibleByObject = new Map<string, Set<string>>();
  for (const [parentObject, idSet] of byObject) {
    const ids = [...idSet];
    let visible: string[] = [];
    try {
      const rows = await engine.find(parentObject, {
        where: { id: { $in: ids } },
        fields: ['id'],
        limit: ids.length,
        context: { ...callerEnvelope },
      });
      visible = rows.map((r) => String(r.id)).filter(Boolean);
    } catch {
      // Unknown/failing parent object → none visible (fail closed).
      visible = [];
    }
    visibleByObject.set(parentObject, new Set(visible));
  }

  // 3. Keep the thread ids VERBATIM (never re-assembled from the parts) so the
  //    emitted filter can only ever match rows the pre-scan actually saw.
  const visibleThreads: string[] = [];
  for (const [threadId, target] of threads) {
    if (visibleByObject.get(target.object)?.has(target.recordId)) visibleThreads.push(threadId);
  }
  if (visibleThreads.length === 0) return READ_DENY_ALL;
  return { thread_id: { $in: visibleThreads } };
}

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
 *      AUTHOR, or hold EDIT on the parent record (see "Parent EDIT" below) —
 *      the attachment kit's uploader-or-parent-editor rule. A multi-row write
 *      requires EVERY
 *      matched row to pass, and an update that re-points `thread_id` must
 *      additionally satisfy the insert rule on the NEW thread. A write
 *      carrying NEITHER an id NOR a `where` is refused outright rather than
 *      authorizing the whole table by resolving zero rows — on BOTH verbs that
 *      refusal reaches this handler through the `dispatchUnscopedMultiWrite`
 *      whole-operation dispatch both registrations declare (#9719/commit c7655d472 built
 *      it for delete; #9974 ruled it onto update).
 *    * Both write verbs refuse a caller who cannot READ the comment's parent —
 *      or whose thread names no parent at all, which nobody reads — with the
 *      platform's not-visible refusal instead of the named one (#21755); see
 *      {@link refuseNotVisible}. The named refusal is what a caller who can
 *      read the parent, but may not edit it, receives.
 *    * The edit stamp (#23124, ruling A): a SECOND `beforeUpdate` handler, not
 *      part of the authorization above, sets `is_edited` / `edited_at` when the
 *      body changes — see {@link stampCommentBodyEdit}. The create hook sets
 *      both to "not edited" over a client value.
 *  - {@link installCommentReadVisibility} — the read side: a
 *    `find`/`findOne`/`count`/`aggregate` middleware that intersects the query
 *    with the threads whose parent record the caller can actually read.
 *
 * Why read gating requires EDIT on write but only READ on insert: posting a
 * comment is collaboration — a user who may READ a record may discuss it (the
 * attachment kit's stricter parent-EDIT rule on insert exists because attaching a
 * FILE mutates the record's content surface). Rewriting or removing someone
 * else's words is moderation, hence the tighter author-or-parent-editor rule.
 *
 * ## Parent EDIT
 *
 * The moderation limb asks the question the attachment kit's four limbs ask —
 * may the caller edit the parent record? — and answers it the same way: with
 * the answer a by-id UPDATE of the parent record, by the same caller, gets.
 *
 * [#24646] The security service's judgement of that update decides it alone:
 * `ISecurityService.explain`'s record-grained verdict for `update` on the
 * parent, which admits only when `allowed` and `record.visible` are both
 * `true` — a decision that carries no record verdict did not judge the record,
 * and refuses. That verdict is the write path's own composition: the parent
 * object's grant, its row-level security, its record sharing at the caller's
 * real write DEPTH, the deferral to an app-authored row-level write policy,
 * the master of a `controlled_by_parent` parent (ADR-0055), and both legs of an
 * on-behalf-of write (ADR-0090 D10). So a caller who can update the parent
 * record by id can also moderate its comments; a caller who cannot, still
 * cannot. A rejection propagates unchanged. The gate keeps no copy of that
 * judgement: until #24646 it also asked record sharing at owner-only depth and
 * then the master-detail check, ahead of the judgement — a narrower duplicate
 * that refused a caller with `unit`, `unit_and_below` or `org` write depth on
 * the parent, whom the CRUD path admits. The ruling that kept it (#7144) is
 * superseded for these gates. With no sharing service, caller-scoped parent
 * READ visibility is asked first (the degraded mode), then the judgement.
 *
 * A security service that serves no `explain`, or none at all, judges no by-id
 * update here. There the gate keeps the composition it had before it could ask
 * one: plugin-sharing's TRI-STATE `checkEdit` (`allow` admits, `deny` refuses);
 * on `abstain` (record sharing does not enforce on the parent), the ADR-0055
 * master-detail write check (`ISecurityService.checkControlledByParentWrite`),
 * whose `allow` and `not_applicable` admit and whose `deny` and `unresolvable`
 * refuse, while a kernel that does not serve it lets the abstention admit, as
 * the parent's own update would; with no sharing service, the degraded read
 * alone. ⛔ Dropping those steps on such a kernel would admit every caller, so
 * they stay there. ⛔ On that path, never `canEdit`: it folds `abstain` into
 * `true`, and `effectiveSharingModel` maps every `controlled_by_parent` parent
 * to `public`, so that fold let any member holding the `sys_comment` delete bit
 * remove other people's comments from every master-detail child record of the
 * org.
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
 *
 * ## A comment's reactions ride the same two installers
 *
 * `sys_comment_reaction` (#22566, ruling A amended on #22505) is one emoji
 * reaction, the reactor's own record, keyed to its comment by `comment_id`.
 * Its access derives from its COMMENT the way a comment's derives from its
 * parent record, so the two installers below answer for it too, with the
 * same handler registered on both objects:
 *
 *  - read: a reaction is readable exactly when its comment is. The gate asks
 *    {@link resolveReadableParentIds} about `sys_comment` under the caller's
 *    context — one caller-scoped read of the comments, which runs the
 *    comment's own grant, row scope and thread gate. No rule about who may
 *    read a comment is restated for its reactions.
 *  - create: a caller reacts only to a comment that same question says they
 *    can read, and `user_id` is stamped from the session.
 *  - delete: deliberately NOT here. A reaction is its reactor's own record, so
 *    the platform's own-record floor (`owner_only_deletes`, plugin-security)
 *    is the whole rule; a second, gate-local ownership check would be the
 *    widener-blind second implementation that floor's provenance warns about.
 *  - update: not offered (`apiMethods`), so nothing to gate.
 *
 * One handler per seam, not one per object, on purpose: the system and
 * context-less early return each installer opens with is read ONCE for both
 * objects, so the two can never disagree about who is exempt.
 */

import { resolveReadableParentIds, withoutOperationPrivateKeys } from '@objectstack/core';
import type { StandardErrorCode } from '@objectstack/spec/api';
import type { ISecurityService, ISharingService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { renderOperationMessage, type ValidationMessageTranslator } from '@objectstack/spec/system';
import { AUDIT_EXCLUDED_OBJECTS } from './audit-writers.js';
import {
  computeParentRecordFilter,
  type ParentObjectReadAdmissionSource,
  type ParentRecordGate,
  type ParentRecordGateEngine,
} from './parent-record-read-gate.js';

/** Minimal engine surface these installers need — duck-typed (like
 * service-storage's attachment seams) so tests can fake it and so plugin-audit
 * keeps its dependency-free posture. */
export interface CommentAccessEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: {
      object?: string;
      packageId?: string;
      /** [commit c7655d472, both verbs since #9974] Opt-in whole-operation `beforeUpdate` /
       * `beforeDelete` dispatch for an UNSCOPED predicate write
       * (`multi: true`, no `where`) — the engine declaration added by #9719.
       * Declared here because this file's registrations pass it; the mechanism,
       * its `beforeUpdate`/`beforeDelete`-only validity and its rebind refusal
       * are owned by `HookEntry.dispatchUnscopedMultiWrite` in
       * `@objectstack/objectql`, not restated. */
      dispatchUnscopedMultiWrite?: boolean;
    },
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
  /** [ADR-0139 E7] The registered schema, read to learn whether `sys_comment`
   * declares its parent pair ({@link declaresCommentParentPair}). Optional: an
   * engine without it is treated as one whose `sys_comment` declares none. */
  getSchema?(object: string): unknown;
}

/** Minimal shape of the engine `OperationContext` the read middleware reads. */
export interface CommentReadMiddlewareCtx {
  object: string;
  operation: 'find' | 'findOne' | 'insert' | 'update' | 'delete' | 'count' | 'aggregate';
  ast?: { object?: string; where?: unknown } & Record<string, unknown>;
  context?: { userId?: string; tenantId?: string; positions?: string[]; permissions?: string[]; isSystem?: boolean } & Record<string, unknown>;
}

/**
 * The single method of plugin-sharing's contract this gate consults — the
 * TRI-STATE edit verdict (see "Parent EDIT" above), asked only where the
 * security service judges no by-id update; its presence alone also decides
 * whether the degraded read is asked. Taken as a `Pick` of the
 * real `ISharingService` rather than re-declared locally: the narrow surface is
 * the point, a second hand-written shape for it is not (AGENTS.md PD #12 — one
 * contract, no dialects).
 */
export type CommentSharingLike = Pick<ISharingService, 'checkEdit'>;

/**
 * The two members of the security service's contract this gate consults:
 * `explain`, whose record-grained `update` verdict is the parent's own by-id
 * update judgement and decides the question wherever it is served (see "Parent
 * EDIT" above), and the ADR-0055 master-detail write check, asked only where no
 * `explain` is served (OPTIONAL on the contract, so the gate handles its
 * absence by construction). `explain` is feature-detected like every member
 * here, so it is optional on this view of the contract.
 */
export type CommentSecurityLike = Pick<ISecurityService, 'checkControlledByParentWrite'> &
  Partial<Pick<ISecurityService, 'explain'>>;

/** A security service known to serve `explain` — the one the parent's by-id update judgement is asked of. */
type ExplainingSecurity = CommentSecurityLike & Pick<ISecurityService, 'explain'>;

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

/** The object a reaction's access derives from. */
const COMMENT_OBJECT = 'sys_comment';

/**
 * A comment's emoji reactions — one row per (comment, emoji, user), the
 * reactor's own record (`objects/sys-comment-reaction.object.ts`).
 */
export const COMMENT_REACTION_OBJECT = 'sys_comment_reaction';

/** The reaction read gate's fail-closed sentinel. */
const REACTION_READ_DENY_ALL = { id: '__comment_reaction_denied__' } as const;

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

/** [ADR-0139 E7, ADR-0052 §5] The column a comment's parent OBJECT is stamped in. */
export const COMMENT_PARENT_OBJECT_COLUMN = 'object_name';

/** [ADR-0139 E7, ADR-0052 §5] The column a comment's parent RECORD id is stamped in. */
export const COMMENT_PARENT_RECORD_COLUMN = 'record_id';

/** The pair, in one list. */
export const COMMENT_PARENT_PAIR_COLUMNS = [COMMENT_PARENT_OBJECT_COLUMN, COMMENT_PARENT_RECORD_COLUMN] as const;

/** What a comment row's parent pair is stamped with. Both `null`: the thread names no record. */
export interface CommentParentPair {
  object_name: string | null;
  record_id: string | null;
}

/**
 * [ADR-0139 E7] The ONE derivation of a comment's parent pair: the record its
 * `thread_id` names, by {@link parseCommentThreadId} — the parse every gate in
 * this module authorizes by — or `null` / `null` for a thread that names none.
 * Called by the stamp on create and on a re-point, and by the stored-row
 * backfill (`comment-parent-pair-backfill.ts`), so a stored row and a new row
 * with the same thread carry the same pair. Pure.
 *
 * `thread_id` stays the authored key: the pair is never authored, only derived.
 */
export function planCommentParentPair(threadId: unknown): CommentParentPair {
  const target = parseCommentThreadId(threadId);
  return target ? { object_name: target.object, record_id: target.recordId } : { object_name: null, record_id: null };
}

/**
 * Whether the REGISTERED `sys_comment` declares both pair columns. Read on
 * every call, never cached: a composition that registers its own earlier
 * definition of the object (a test harness, a host override) has no column to
 * stamp — an insert naming one would be refused as an unknown field — and no
 * column a read could be narrowed by, so the read gate keeps the thread probe
 * for it (`installCommentReadVisibility`). The E6 precedent
 * (`declaresActivityStampColumns`).
 */
export function declaresCommentParentPair(engine: { getSchema?(object: string): unknown }): boolean {
  let fields: unknown;
  try {
    const schema = typeof engine.getSchema === 'function' ? engine.getSchema('sys_comment') : undefined;
    fields = schema && typeof schema === 'object' ? (schema as { fields?: unknown }).fields : undefined;
  } catch {
    return false;
  }
  return !!fields && typeof fields === 'object' && COMMENT_PARENT_PAIR_COLUMNS.every((column) => column in (fields as object));
}

/** Stamp one row in place: the planner's answer, over whatever the writer sent. */
function stampCommentParentPair(row: Record<string, unknown>): void {
  const pair = planCommentParentPair(row.thread_id);
  row[COMMENT_PARENT_OBJECT_COLUMN] = pair.object_name;
  row[COMMENT_PARENT_RECORD_COLUMN] = pair.record_id;
}

/**
 * [ADR-0139 E7] The pair's two writers, both registered for EVERY caller —
 * system, seed and context-less included — because the pair is derived, not
 * authorized: the authorization handlers below exempt system callers, this
 * stamp exempts nobody.
 *
 *  - create (`beforeInsert`): every inserted row is stamped from its
 *    `thread_id`, over whatever value the writer sent. The engine's create-side
 *    `readonly` strip leaves `sys_` objects to their own guards
 *    (`staticReadonlyInsertSubject`), so this assignment is the guard, as the
 *    create hook is for `is_edited`.
 *  - update (`beforeUpdate`), for every caller: an update that names
 *    `thread_id` — the re-point the update gate authorizes as an insert into
 *    the new thread — is stamped from it. The payload is shared by every row a
 *    predicate update matches, so every row gets the same pair, as it gets the
 *    same `thread_id`. An update that names either pair column WITHOUT a
 *    thread is re-derived from the row's own stored thread (`previous`), so no
 *    writer's value lands, the backfill's included. ⛔ The engine's update-side
 *    `readonly` strip is not the guard here: under `preserveAudit` (a REST
 *    historical import puts it on an ordinary caller's write) it keeps a
 *    readonly value. A predicate update naming the pair without a thread
 *    re-derives a pair per matched row over one shared payload, and one SET
 *    clause carries a single pair to every row, so when the matched rows'
 *    threads name different records the write is refused whole, before
 *    anything is written ({@link refusePairDivergence}, `VALIDATION_ERROR` /
 *    400): the engine's own key-set divergence check cannot see it, since
 *    every row assigns the same two keys. With no stored row to derive from,
 *    the pair is dropped from the write. An update naming none of the three
 *    columns stamps nothing.
 */
/** The catalog member for a request whose shape is refused (ADR-0112). */
const PAIR_DIVERGENCE_CODE: StandardErrorCode = 'VALIDATION_ERROR';

/** The pair the first row of a predicate update derived, per write (the engine's shared `dispatch.scope`). */
const pairByWrite = new WeakMap<object, CommentParentPair>();

/**
 * Refuse a predicate (`per-row`) update whose matched rows derive different
 * parent pairs: one `SET` clause cannot carry two pairs, and carrying one row's
 * pair to another row would authorize that comment by a record its thread does
 * not name. Refused before anything is written (every before-hook runs ahead
 * of the one write). A by-id update, and a predicate update whose rows share
 * one thread, pass. `VALIDATION_ERROR` / 400: the request's shape is what is
 * refused, and the remedy is in the caller's hands.
 */
function refusePairDivergence(dispatch: unknown, pair: CommentParentPair): void {
  const d = dispatch as { mode?: unknown; scope?: unknown } | undefined;
  if (d?.mode !== 'per-row' || !d.scope || typeof d.scope !== 'object') return;
  const first = pairByWrite.get(d.scope);
  if (!first) {
    pairByWrite.set(d.scope, pair);
    return;
  }
  if (first.object_name === pair.object_name && first.record_id === pair.record_id) return;
  const err: any = new Error(
    'Refusing a multi-row update of sys_comment that names object_name / record_id without thread_id: the matched ' +
      "comments' threads name different records, and one write cannot store each comment's own pair. The pair is " +
      "derived from thread_id — update the comments one by one, or name thread_id.",
  );
  err.code = PAIR_DIVERGENCE_CODE;
  err.status = 400;
  err.statusCode = 400;
  throw err;
}

function installCommentParentPairStamp(engine: CommentAccessEngine): void {
  engine.registerHook(
    'beforeInsert',
    (ctx: any) => {
      if (!declaresCommentParentPair(engine)) return;
      const data = ctx?.input?.data;
      for (const row of Array.isArray(data) ? data : [data]) {
        if (row && typeof row === 'object' && !Array.isArray(row)) stampCommentParentPair(row as Record<string, unknown>);
      }
    },
    { object: COMMENT_OBJECT, packageId: PACKAGE_ID },
  );
  engine.registerHook(
    'beforeUpdate',
    (ctx: any) => {
      const data: unknown = ctx?.input?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const payload = data as Record<string, unknown>;
      const names = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);
      if (!names('thread_id') && !COMMENT_PARENT_PAIR_COLUMNS.some(names)) return;
      if (!declaresCommentParentPair(engine)) return;
      if (names('thread_id')) {
        stampCommentParentPair(payload);
        return;
      }
      // The pair named without a thread: derive it from the row's own thread.
      const previous: unknown = ctx?.previous;
      const storedThread =
        previous && typeof previous === 'object' ? (previous as Record<string, unknown>).thread_id : undefined;
      if (typeof storedThread !== 'string') {
        for (const column of COMMENT_PARENT_PAIR_COLUMNS) delete payload[column];
        return;
      }
      const pair = planCommentParentPair(storedThread);
      // A predicate update dispatches this handler once per matched row over
      // ONE shared payload, and one SET clause carries the last row's values to
      // every row. The engine's key-set divergence check cannot see this (every
      // row assigns the same two keys), so the pair is compared here, across
      // the call's rows, on the scope object the engine shares between them.
      refusePairDivergence(ctx?.dispatch, pair);
      payload[COMMENT_PARENT_OBJECT_COLUMN] = pair.object_name;
      payload[COMMENT_PARENT_RECORD_COLUMN] = pair.record_id;
    },
    { object: COMMENT_OBJECT, packageId: PACKAGE_ID },
  );
}

function forbid(message: string, object?: string): never {
  const err: any = new Error(message);
  err.code = DENY_CODE;
  err.status = 403;
  if (object) err.object = object;
  throw err;
}

/**
 * The code of the platform's not-visible refusal: the one plugin-security's
 * by-id write pre-image check throws when the caller's own read visibility
 * does not reach the target row (`PermissionDeniedError`, 403).
 *
 * [#21771] No longer the pre-image check's answer for a row the caller cannot
 * read: under the write doors' ruling A that check asks the caller's read
 * visibility for every principal, and answers the by-id update or delete the
 * caller addressed with what a nonexistent id answers, before this gate runs.
 * This refusal stays the gate's own, for a write the gate answers first.
 */
const NOT_VISIBLE_CODE: StandardErrorCode = 'PERMISSION_DENIED';
const NOT_VISIBLE_STATUS = 403;

/**
 * [#21755] Refuse a write on a comment whose parent record the caller cannot
 * READ — with the platform's not-visible refusal, never the gate's named one.
 *
 * The named refusal ({@link forbid}) names the parent record (`object/id`) in
 * the message, or the raw `thread_id` of a thread that names none, and the
 * parent's object on the envelope. That is honest to a caller who can read the
 * parent and may not edit it; to a caller who cannot, it is a disclosure across
 * the read boundary — the read door answers that same caller "not found" for
 * the comment, because a comment's visibility IS its parent's
 * ({@link installCommentReadVisibility}, which also hides every thread naming
 * no parent). The by-id write pre-image check already refuses such a write
 * before this gate runs for every principal its row filter binds; this is the
 * same answer for the principals it does not bind.
 *
 * The same answer, not a lookalike: the sentence is rendered by the shared
 * Operation Message Catalog under the pre-image check's own key
 * (`record_access_denied`, which names nothing), through the same
 * locale/override ladder, and the envelope carries the pre-image check's code
 * and status. Nothing about the parent rides on it — no `object` (the doors
 * fill the ROUTE's object, exactly as for the pre-image check), no `details`,
 * no `developerMessage`. The operator's half is logged by the caller instead.
 *
 * Who may write does not change: this replaces the refusal a caller was
 * already getting, on exactly the rows that were already refused.
 */
function refuseNotVisible(
  callerCtx: ExecutionContext,
  messageTranslator: (() => ValidationMessageTranslator | undefined) | undefined,
): never {
  let translate: ValidationMessageTranslator | undefined;
  try {
    translate = messageTranslator?.();
  } catch {
    // i18n is optional and late-bound; the built-in catalog still renders the
    // caller's locale without it.
    translate = undefined;
  }
  const locale = typeof callerCtx?.locale === 'string' ? callerCtx.locale : undefined;
  const err: any = new Error(renderOperationMessage({ messageKey: 'record_access_denied' }, { locale, translate }));
  err.name = 'PermissionDeniedError';
  err.code = NOT_VISIBLE_CODE;
  err.status = NOT_VISIBLE_STATUS;
  err.statusCode = NOT_VISIBLE_STATUS;
  throw err;
}

/**
 * [#23124, maintainer ruling A] The platform marks a comment edited: when an
 * update's `body` differs from the stored body, set `is_edited: true` and
 * `edited_at` to the server clock. Both fields are `readonly` on
 * `sys_comment`, so on an update by a non-system caller this hook is their one
 * writer, as the create hook is on a create (`objects/sys-comment.object.ts`,
 * "Platform-written").
 *
 * What counts as an edit is the BODY and nothing else: an update that does not
 * name `body`, or names the stored text again (the console rewrites `mentions`
 * beside it), stamps nothing. A row with no readable pre-image is stamped —
 * the engine binds `previous` on both update paths, and a mark that cannot be
 * proven unneeded is the safe side of a reader's trust signal.
 *
 * Every caller is stamped, system included, the way the engine's `updated_at`
 * stamp is: the mark records that the text changed after it was posted, not
 * who was allowed to change it (the authorization handler is separate and
 * exempts system callers; this one does not). The one exception is the
 * engine's own: a `preserveAudit` write (a historical import) keeps a value it
 * supplies, as `updated_at` does, and is stamped only where it supplies none.
 *
 * Why the stamp is an assignment and the client's value needs no handling here:
 * the engine hides a non-system caller's `readonly` values from the hooks and
 * strips them after, and keeps a value a hook ASSIGNED (`hookWrittenKeys`). So
 * on an edit the stamp lands whatever the client sent, and without one the
 * client's value is dropped and reported as `droppedFields`.
 *
 * A predicate (`multi: true`) update dispatches this handler once per matched
 * row, with that row as `previous`, over ONE shared payload. If every row's
 * body changes, every row is stamped; if none does, none is. A batch whose rows
 * disagree is refused whole by the engine (`MULTI_UPDATE_HOOK_KEY_DIVERGENCE`,
 * 400, nothing written) — one SET clause cannot mark some rows and not others,
 * and stamping all of them would mark text that never changed.
 */
async function stampCommentBodyEdit(ctx: any): Promise<void> {
  const data: unknown = ctx?.input?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const payload = data as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(payload, 'body')) return;
  const previous: unknown = ctx?.previous;
  if (previous && typeof previous === 'object' && Object.is((previous as Record<string, unknown>).body, payload.body)) {
    return;
  }
  const now = new Date().toISOString();
  if (ctx?.session?.preserveAudit === true) {
    payload.is_edited = payload.is_edited ?? true;
    payload.edited_at = payload.edited_at ?? now;
    return;
  }
  payload.is_edited = true;
  payload.edited_at = now;
}

function asIdList(id: unknown): Array<string | number> | null {
  if (typeof id === 'string' || typeof id === 'number') return [id];
  if (id && typeof id === 'object' && Array.isArray((id as any).$in)) {
    return (id as any).$in.filter((v: unknown) => typeof v === 'string' || typeof v === 'number');
  }
  return null;
}

/**
 * Why this module strips the operation-private keys before forwarding an
 * envelope — the LOCAL half of the argument.
 *
 * plugin-security's middleware stamps `__`-prefixed keys onto the operation
 * context resolved for the object of the CURRENT operation, which here is
 * `sys_comment`. Every gate in this module asks about the PARENT record's
 * object, never about `sys_comment`, so carrying any of them across is one
 * object's widening applied to another object's question.
 *
 * [#7141] The general rule — which keys those are, why they are dropped by
 * PREFIX rather than by a name list, and why the copy is load-bearing in both
 * directions — is `withoutOperationPrivateKeys` in `@objectstack/core`. It was
 * hand-copied into this file, `service-storage`'s attachment kit and
 * `plugin-reports` before #7284 gave it one owner; ⛔ import it, never re-derive
 * it locally (`operation-private-keys.pin.test.ts` catches the fourth copy).
 */

/** The caller's ExecutionContext rides on the operation options — the session
 * snapshot lacks `permissions`, which sharing bypasses need.
 *
 * [#7136] Typed as the full envelope, which is what `ISharingService` declares
 * for every parameter this value is handed to (commit aa4b90d9a / the full-envelope ruling).
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
 * parent object, and none is carried across from `sys_comment`.
 *
 * [#24646] The parent's own depth is the security service's to resolve, and it
 * does: the by-id update judgement this gate asks resolves it together with the
 * parent object's grant, so the fail-open of a depth probe used alone
 * (`ISecurityService.resolveWriteScope` answering `'org'` for an object no
 * permission set mentions) never arises here. Where that judgement is not
 * served, record sharing is asked with no depth, so its owner-match stays at
 * its narrowest (`own`) — the safe direction. The contract that owns this
 * gate's meaning records it once (`@objectstack/spec` — `ISharingService`,
 * "Write DEPTH is an input the CALLER supplies"), because the `sys_attachment`
 * kit reaches the same question from another package; it is not restated
 * here. */
function callerContext(ctx: any): ExecutionContext {
  const exec = ctx?.input?.options?.context;
  if (exec && typeof exec === 'object') {
    return withoutOperationPrivateKeys(exec as Record<string, unknown>);
  }
  const s = ctx?.session ?? {};
  // [#9691] The `s.tenantId` arm was DEAD, not a fallback: `HookContextSchema`
  // strips a `tenantId` key from the session (#3290) and the engine's
  // `buildSession` only ever emits `organizationId`, so the first arm answered
  // `undefined` on every call and the second one carried the value. Dropping it
  // is byte-for-byte the same envelope; it is removed because a dead read of a
  // removed alias is what an author copies out of a reference body.
  return { userId: s.userId, tenantId: s.organizationId, positions: s.positions };
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
 *
 * `messageTranslator` resolves the deployment's i18n lookup for the
 * not-visible refusal's sentence ({@link refuseNotVisible}) — lazily, per
 * refusal, because the i18n service is contributed by another plugin that may
 * start after this one. Absent, the built-in catalog still renders the
 * caller's locale.
 *
 * `getSecurity` resolves the security service, lazily for the same reason, for
 * its judgement of a by-id update of the parent (`explain`), which decides the
 * parent-edit question wherever it is served (see "Parent EDIT" in the module
 * header). Serving none, the service's ADR-0055 master-detail write check is
 * asked on a record-sharing abstention instead; absent too, a
 * `controlled_by_parent` parent meets no master check here, exactly as its own
 * update meets none.
 */
export function installCommentAccessHooks(
  engine: CommentAccessEngine,
  getSharing: () => CommentSharingLike | null | undefined,
  logger: CommentAccessLogger,
  messageTranslator?: () => ValidationMessageTranslator | undefined,
  getSecurity?: () => CommentSecurityLike | null | undefined,
): void {
  /** May the caller EDIT the parent record behind `target`? The composition
   * "Parent EDIT" in the module header sets out. [#24646] Where the security
   * service serves `explain`, the parent's own by-id update judgement decides
   * alone — after caller-scoped parent read visibility on a kernel with no
   * sharing service (the degraded mode). Where it serves none, the composition
   * the gate had before it could ask that judgement decides: record sharing
   * (or the degraded read) and the master check. */
  const canEditParent = async (ctx: any, target: CommentThreadTarget, verb: string): Promise<boolean> => {
    let security: CommentSecurityLike | null | undefined;
    try {
      security = getSecurity?.();
    } catch {
      security = undefined;
    }
    if (!security || typeof security.explain !== 'function') {
      logger.debug?.(
        `[audit] comment access: the security service judges no by-id update of ${target.object} here — ${verb} ` +
          'decided by record sharing and the master-detail check',
      );
      return sharingAndMasterAdmit(ctx, target, verb);
    }
    const sharing = getSharing();
    if ((!sharing || typeof sharing.checkEdit !== 'function') && !(await degradedParentRead(ctx, target, verb))) {
      return false;
    }
    return parentUpdateAdmits(security as ExplainingSecurity, target, callerContext(ctx), verb);
  };

  /** [#24549, #24646] The parent's own by-id update judgement: the security
   * service's record-grained `explain` verdict for `update` on the parent,
   * which admits only when `allowed` and `record.visible` are both `true` — a
   * decision that carries no record verdict did not judge the record, and
   * refuses. See "Parent EDIT" in the module header. A rejection propagates
   * unchanged. */
  const parentUpdateAdmits = async (
    security: ExplainingSecurity,
    target: CommentThreadTarget,
    callerCtx: ExecutionContext,
    verb: string,
  ): Promise<boolean> => {
    const decision = await security.explain(
      { object: target.object, operation: 'update', recordId: target.recordId },
      callerCtx,
    );
    if (decision?.allowed === true && decision.record?.visible === true) return true;
    logger.debug?.(
      `[audit] comment access: ${verb} refused — a by-id update of ${target.object}/${target.recordId} is refused ` +
        'to this caller',
    );
    return false;
  };

  /** The degraded mode (no sharing service): caller-scoped parent READ visibility. */
  const degradedParentRead = (ctx: any, target: CommentThreadTarget, verb: string): Promise<boolean> => {
    logger.debug?.(`[audit] comment access: sharing service absent — ${verb} gated on parent read visibility`);
    return callerCanRead(ctx, target);
  };

  /** The composition {@link canEditParent} keeps where the security service
   * judges no by-id update: record sharing (or the degraded read), then the
   * master check. */
  const sharingAndMasterAdmit = async (ctx: any, target: CommentThreadTarget, verb: string): Promise<boolean> => {
    const sharing = getSharing();
    if (!sharing || typeof sharing.checkEdit !== 'function') {
      return degradedParentRead(ctx, target, verb);
    }
    const callerCtx = callerContext(ctx);
    const verdict = await sharing.checkEdit(target.object, target.recordId, callerCtx);
    if (verdict === 'allow') return true;
    // `deny`, and anything that is not one of the three verdicts, refuses.
    if (verdict !== 'abstain') return false;

    // Record sharing does not enforce on this parent. Whether that is
    // permission is the master-detail check's question (ADR-0055): it answers
    // `not_applicable` for a parent that derives nothing from a master.
    let security: CommentSecurityLike | null | undefined;
    try {
      security = getSecurity?.();
    } catch {
      security = undefined;
    }
    if (!security || typeof security.checkControlledByParentWrite !== 'function') {
      // No master-detail check is composed in this kernel, and the parent's own
      // update meets none either. ⛔ Not "the master was judged editable" —
      // nothing measured it.
      logger.debug?.(
        `[audit] comment access: record sharing abstains on ${target.object} and the security service composes no ` +
          `master-detail write check — ${verb} admitted on the abstention, as the parent's own update would be`,
      );
      return true;
    }
    // A rejection (a datasource fault, a context the write path refuses) is a
    // refusal of the request, and propagates as it is.
    const answer = await security.checkControlledByParentWrite(target.object, target.recordId, callerCtx);
    return answer.outcome === 'allow' || answer.outcome === 'not_applicable';
  };

  /**
   * [#22566] Create a reaction: the reactor is the session's user, and the
   * comment must be one the caller can read.
   *
   * `user_id` is stamped, never taken from the client — a reaction recorded
   * under someone else's name is the spoofed provenance `author_id` stamping
   * exists to stop. A session with no user has nobody to record, so it is
   * refused rather than left to whatever the client sent.
   *
   * "Can read the comment" is asked of {@link resolveReadableParentIds}, the
   * evaluator the reaction read gate asks, so the create door never admits a
   * reaction the read door would hide.
   */
  const authorizeReactionInsert = async (ctx: any, data: Record<string, unknown>): Promise<void> => {
    const userId: unknown = ctx.session.userId;
    if (typeof userId !== 'string' || userId === '') {
      forbid('Cannot react: there is no signed-in user to record as the one reacting');
    }
    data.user_id = userId;

    const commentId = data.comment_id;
    if ((typeof commentId !== 'string' && typeof commentId !== 'number') || String(commentId) === '') {
      forbid(`Cannot react: comment_id ${JSON.stringify(commentId ?? null)} does not name a comment`);
    }
    const readable = await resolveReadableParentIds(
      engine,
      callerContext(ctx),
      new Map([[COMMENT_OBJECT, new Set([String(commentId)])]]),
    );
    if (!readable.get(COMMENT_OBJECT)?.has(String(commentId))) {
      forbid(`Cannot react to comment ${String(commentId)}: the comment does not exist or you cannot read it`);
    }
  };

  // ── Create: parent-record READ access + author_id stamping ──────────
  // One handler for both objects (see "A comment's reactions" in the module
  // header): the system / context-less exemption is decided once.
  const onInsert = async (ctx: any): Promise<void> => {
    if (ctx?.session?.isSystem) return;
    if (!ctx?.session) return; // context-less programmatic call (bare kernel)
    const data: any = ctx?.input?.data;
    if (!data || typeof data !== 'object') return;

    if (ctx.object === COMMENT_REACTION_OBJECT) {
      await authorizeReactionInsert(ctx, data);
      return;
    }

    // Server stamps provenance: the session identity wins over whatever the
    // client sent. Without this the author-or-parent-editor rule below is
    // spoofable — a caller could post as anyone, then "author-delete" it.
    if (ctx.session.userId) data.author_id = ctx.session.userId;

    // [#23124] A new comment is not an edited one, whatever the client sent.
    // The engine's create-side `readonly` strip leaves `sys_` objects to their
    // own guards, so this is the guard: the platform's value, assigned over a
    // client's, exactly as `author_id` above. Only a key the client named is
    // touched; an absent one takes the field's default.
    if (Object.prototype.hasOwnProperty.call(data, 'is_edited')) data.is_edited = false;
    if (Object.prototype.hasOwnProperty.call(data, 'edited_at')) data.edited_at = null;

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
  };
  engine.registerHook('beforeInsert', onInsert, { object: COMMENT_OBJECT, packageId: PACKAGE_ID });
  engine.registerHook('beforeInsert', onInsert, { object: COMMENT_REACTION_OBJECT, packageId: PACKAGE_ID });

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
      //
      // [commit c7655d472/#9974] This branch is verb-neutral in what it says AND, since
      // #9974, in what reaches it. On BOTH verbs the only dispatch that can
      // deliver this shape is the `dispatchUnscopedMultiWrite` whole-operation
      // dispatch this module's two `before*` registrations declare (see below):
      // the per-row contract (#5038/#5574) binds `input.id` on every predicate
      // dispatch, which routes into the by-id branch above, and a zero-match
      // predicate dispatches nothing at all.
      //
      // ⚠️ The update half was NOT always reachable, and the history is the
      // reason this comment exists. #9719 built the mechanism on `beforeDelete`
      // only and refused the flag elsewhere by design, so until #9974 an
      // unscoped `multi: true` UPDATE was refused only when it happened to
      // sweep a row the caller may not touch — the PER-ROW gate catching the
      // shape by accident, with the per-row message — and resolved silently
      // when the caller was entitled to every row, zero-match included. The
      // maintainer ruled that closed (option A, 2026-08-19): an overwrite
      // leaves no trace and no pre-image, so the verb with the less recoverable
      // failure must not be the less guarded one.
      //
      // ⛔ If this branch ever stops firing on a verb, the fix is the DISPATCH,
      // not this policy — do not widen the branch to compensate.
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
    const callerCtx = callerContext(ctx);
    const canEditCache = new Map<string, boolean>();
    /** Parent READ verdicts, asked only for a row about to be refused. */
    const canReadCache = new Map<string, boolean>();
    /** [#21755] Can the caller READ `target`? Decided by the same evaluator
     * the read door uses ({@link resolveReadableParentIds}), so the write door
     * never names what the read door hides. */
    const callerReadsParent = async (target: CommentThreadTarget): Promise<boolean> => {
      const cacheKey = `${target.object}:${target.recordId}`;
      let canRead = canReadCache.get(cacheKey);
      if (canRead === undefined) {
        canRead = !!(await resolveReadableParentIds(engine, callerCtx, new Map([[target.object, new Set([target.recordId])]])))
          .get(target.object)
          ?.has(target.recordId);
        canReadCache.set(cacheKey, canRead);
      }
      return canRead;
    };
    /** [#21755] Answer the platform's not-visible refusal; the operator's half
     * — the sentence naming the parent or the thread — stays server-side. */
    // A function DECLARATION, not an arrow: TypeScript narrows on a call to a
    // `never`-returning function only when its type is declared, and the
    // dangling-thread branch below relies on that narrowing.
    function answerNotVisible(row: Record<string, unknown>, namedMessage: string): never {
      logger.warn(`[audit] comment access: ${namedMessage} (the caller cannot read the parent; answered not-visible)`, {
        operation: verb,
        object: 'sys_comment',
        recordId: row.id,
        userId: userId ?? 'unknown',
      });
      return refuseNotVisible(callerCtx, messageTranslator);
    }
    for (const row of rows) {
      if (userId && row.author_id === userId) continue; // authors govern their own words

      const threadId = row.thread_id;
      const target = parseCommentThreadId(threadId);
      if (!target) {
        // A dangling thread has no parent to inherit authority from, and the
        // caller is not the author → nobody but system may touch it. Nobody
        // READS it either (the read middleware drops every thread naming no
        // record), so the refusal is the not-visible one: naming the thread
        // would hand its raw value to a caller the read door answers "not
        // found" (#21755).
        answerNotVisible(
          row,
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
        const namedMessage =
          `Cannot ${verb} comment ${row.id}: only its author or a user who can edit the parent record ` +
          `(${target.object}/${target.recordId}) may ${verb} it`;
        // The named refusal is for a caller who can READ the parent and may
        // not edit it; one who cannot read it gets the not-visible refusal.
        if (!(await callerReadsParent(target))) answerNotVisible(row, namedMessage);
        forbid(namedMessage, target.object);
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
    // [#9974] `dispatchUnscopedMultiWrite` is what makes the #4630 unscoped
    // refusal in `resolveTargetRows` REACHABLE ON UPDATE — the half commit c7655d472 could
    // not land, ruled in on 2026-08-19. Without it the predicate path dispatches
    // per row with `input.id` bound (so the by-id branch shadows the shape
    // check) and a zero-match predicate dispatches nothing, leaving the declared
    // refusal to fire only by accident, on the rows rather than on the shape.
    // Same declaration the `beforeDelete` registration below carries.
    { object: 'sys_comment', packageId: PACKAGE_ID, dispatchUnscopedMultiWrite: true },
  );

  // ── Update: the platform stamps an edit of the body (#23124) ─────────
  // Its own registration, deliberately: the authorization handler above
  // returns early for system and context-less callers and declares the
  // whole-operation dispatch, and the stamp wants neither — see
  // {@link stampCommentBodyEdit}.
  engine.registerHook('beforeUpdate', stampCommentBodyEdit, { object: COMMENT_OBJECT, packageId: PACKAGE_ID });

  // ── Create and re-point: the platform stamps the parent pair (ADR-0139 E7) ─
  // Its own registrations, for the stamp's reason above: every caller is
  // stamped — see {@link installCommentParentPairStamp}.
  installCommentParentPairStamp(engine);

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
    // [commit c7655d472] `dispatchUnscopedMultiWrite` is what makes the #4630 unscoped
    // refusal in `resolveTargetRows` REACHABLE through the wired engine: the
    // predicate path dispatches per row with `input.id` bound (so the by-id
    // branch shadows the check), and a zero-match predicate dispatches nothing
    // at all — the engine's opt-in whole-operation dispatch is the one call
    // that arrives with no id and the caller's raw `options`, before any row is
    // resolved. Same declaration `sys_attachment` carries (#9719).
    { object: 'sys_comment', packageId: PACKAGE_ID, dispatchUnscopedMultiWrite: true },
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
 * ## Comment threads: one `ReadableIds` leaf per parent object (ADR-0139 D4, E7)
 *
 * A comment's parent is stamped in its pair, `object_name` + `record_id`
 * ({@link planCommentParentPair}), so the thread gate is the parent-record gate
 * the activity stream and the ledger use (`parent-record-read-gate.ts`,
 * {@link computeParentRecordFilter}), over the comment's own pair: one branch
 * `{ object_name: P, record_id: { $in: ReadableIds.of(P) } }` per registered
 * parent object, ORed and ANDed into the read's `where`. No pre-scan reads the
 * comments, so a list, its `total` and a grouped count are each one statement
 * over every comment the caller may read, on any table size. The parent
 * objects are every registered object but `sys_comment` itself: a comment can
 * hang off any record (the console writes `thread_id` from every record
 * detail page), so every object the audit writer excludes is a named parent of
 * this gate ({@link commentThreadGate}).
 *
 * That module decides up front, by name, what keeps the bounded probe (over the
 * pair): ADR-0139 D5's three classes — a delegated caller (the whole read), a
 * parent an object-scoped read middleware narrows (`sys_attachment`,
 * `sys_comment_reaction`, `sys_approval_request`, …), a federated parent — and
 * the two whole-read states it reports once: an engine that cannot classify,
 * and a security service that answers no `canReadObject` (no leaf is written
 * without it). ⛔ Never reached by catching a refusal.
 *
 * ## A row the backfill has not reached keeps the probe — never a leaf
 *
 * A row with no stamped pair (`object_name` NULL) — written before the pair
 * existed, until `os migrate comment-parent-pair --apply` stamps it, or a
 * thread that names no record — is answered by the bounded thread probe this
 * gate always had, restricted to those rows ({@link probeUnstampedThreads}):
 * pre-scan their `thread_id`s under SYSTEM context (at most
 * {@link READ_SCAN_LIMIT}, in the caller's order), resolve which parent records
 * the caller can read through the caller-scoped engine, and OR in
 * `{ object_name: NULL, thread_id: { $in: VISIBLE_THREADS } }`. Beyond the
 * bound it fails CLOSED, and says so. A thread naming no record never enters
 * that list. Once the backfill has run, the probe finds no candidate.
 *
 * A composition whose registered `sys_comment` declares no pair
 * ({@link declaresCommentParentPair}) has no column to leaf over: every read is
 * the thread probe over every row, and that is said once.
 *
 * ## What the read's own refusal does (ADR-0139 D3)
 *
 * A leaf is composed by the engine after this middleware hands the read on
 * (`next()`), so a composition or driver refusal (on `driver-mongodb`, a 500
 * until O3) is the read's own failure and reaches the caller saying why.
 * ⛔ Nothing here catches it into the deny-all sentinel: the `catch` below
 * wraps only this gate's own filter computation, which runs before `next()`.
 *
 * ## Comment reactions keep the probe (ADR-0139 D5.2)
 *
 * A reaction's only parent is `sys_comment`, which this very middleware
 * narrows — D5.2's class by name — so the reaction gate stays the bounded
 * probe ({@link computeReactionVisibilityFilter}). A leaf over the comment's
 * parent record instead would skip the caller's grant on `sys_comment` and
 * widen an access boundary.
 *
 * `getAdmission` resolves, on every read, the security service whose
 * `canReadObject` admits a leaf's parent object (absent: every read is the
 * probe, said once).
 */
export function installCommentReadVisibility(
  engine: ParentRecordGateEngine,
  logger: CommentAccessLogger,
  getAdmission?: ParentObjectReadAdmissionSource,
): void {
  if (typeof engine.registerMiddleware !== 'function') return; // engine lacks the seam
  const andIn = (ctx: CommentReadMiddlewareCtx, filter: unknown) => {
    if (!ctx.ast) return;
    ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, filter] } : filter;
  };
  // Built at install time, never at module load: `audit-writers.ts` is read
  // through an import this module shares with its consumers.
  const threadGate = commentThreadGate();
  const admission: ParentObjectReadAdmissionSource = getAdmission ?? (() => undefined);

  // One handler for both objects (see "A comment's reactions" in the module
  // header): the system / context-less exemption is decided once.
  const gate = async (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>): Promise<void> => {
    // Only reads carry an `ast` to constrain; writes are gated by the hooks
    // above. System / context-less (internal) reads are not narrowed.
    if (!READ_OPS.has(ctx.operation) || !ctx.ast || !ctx.context || ctx.context.isSystem) {
      return next();
    }
    const reaction = ctx.object === COMMENT_REACTION_OBJECT;
    try {
      const filter = reaction
        ? await computeReactionVisibilityFilter(engine, ctx, logger)
        : await computeThreadVisibilityFilter(engine, ctx, logger, threadGate, admission);
      if (filter) andIn(ctx, filter);
    } catch (err) {
      // A filter-compute failure must never fall open into a leak.
      logger.warn(
        `[audit] ${reaction ? 'comment reaction' : 'comment'} read visibility: filter failed, denying all ` +
          `(${(err as Error)?.message ?? err})`,
      );
      andIn(ctx, reaction ? REACTION_READ_DENY_ALL : READ_DENY_ALL);
    }
    // [ADR-0139 D3] Outside the `try`: a leaf's composition refusal is the read's.
    return next();
  };
  engine.registerMiddleware(gate, { object: COMMENT_OBJECT });
  engine.registerMiddleware(gate, { object: COMMENT_REACTION_OBJECT });
}

/**
 * [ADR-0139 E7] The comment-thread gate, as the parent-record gate reads it:
 * `sys_comment` over its pair, every row naming no parent excluded, no caller
 * exempt. Every object the audit writer excludes is a named parent: comment
 * writers name any record, so the comment gate enumerates every registered
 * object but `sys_comment`, exactly the set {@link parseCommentThreadId}
 * accepts.
 */
export function commentThreadGate(): ParentRecordGate {
  return {
    object: COMMENT_OBJECT,
    seam: 'comment read visibility',
    denyAll: READ_DENY_ALL,
    namedParents: [...AUDIT_EXCLUDED_OBJECTS],
  };
}

/**
 * [#22566] Resolve the WHERE predicate for one `sys_comment_reaction` read: a
 * reaction is readable exactly when its comment is.
 *
 * Returns `null` when the query matches no rows (nothing to narrow), a
 * `comment_id` `$in` of the comments the caller can read, or the deny-all
 * sentinel.
 *
 * Nothing here decides whether a comment is readable. The candidate comment
 * ids are handed to {@link resolveReadableParentIds} as one caller-scoped read
 * of `sys_comment`, and that read runs everything a direct read of those
 * comments runs: the caller's grant on `sys_comment`, its row scope, and the
 * thread gate above, which in turn asks the record each thread names. A
 * reaction whose comment no longer exists is not found by that read, so it is
 * excluded (fail closed), as is a row naming no comment at all.
 */
async function computeReactionVisibilityFilter(
  engine: CommentAccessEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
): Promise<unknown | null> {
  // 1. The comment ids the query would touch, read under SYSTEM context (the
  //    caller may not see the rows yet; that is what is being decided). The
  //    caller's own order rides along, so on a table larger than the scan
  //    bound the window scanned is the window the caller pages through.
  const orderBy = (ctx.ast as { orderBy?: unknown } | undefined)?.orderBy;
  const candidates = await engine.find(COMMENT_REACTION_OBJECT, {
    where: (ctx.ast?.where as Record<string, unknown>) ?? {},
    fields: ['comment_id'],
    ...(Array.isArray(orderBy) && orderBy.length > 0 ? { orderBy } : {}),
    limit: READ_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (!candidates.length) return null;
  if (candidates.length >= READ_SCAN_LIMIT) {
    // Not silent (fail-closed truncation): rows beyond the scan window are
    // excluded, so a very broad read may omit reactions the caller could see.
    // A comment feed reads the reactions of the comments it shows, by
    // `comment_id`, and never hits this.
    logger.warn(
      `[audit] comment reaction read visibility: candidate pre-scan hit the ${READ_SCAN_LIMIT}-row cap; ` +
        'the visibility filter for this broad read is fail-closed and may omit visible rows — scope the query by comment_id',
    );
  }

  /** comment id as compared → the value as STORED, which is what the emitted
   * filter carries, so it can only match rows the pre-scan actually saw. */
  const commentIds = new Map<string, unknown>();
  for (const row of candidates) {
    const stored = row.comment_id;
    if (typeof stored !== 'string' && typeof stored !== 'number') continue;
    const key = String(stored);
    if (key === '' || commentIds.has(key)) continue;
    commentIds.set(key, stored);
  }
  if (commentIds.size === 0) return REACTION_READ_DENY_ALL;

  // 2. The one readability answer: the comments the CALLER can read.
  const readable = (
    await resolveReadableParentIds(engine, ctx.context, new Map([[COMMENT_OBJECT, new Set(commentIds.keys())]]))
  ).get(COMMENT_OBJECT);

  // 3. Keep the stored values of the readable comments.
  const kept: unknown[] = [];
  for (const [key, stored] of commentIds) if (readable?.has(key)) kept.push(stored);
  if (kept.length === 0) return REACTION_READ_DENY_ALL;
  return { comment_id: { $in: kept } };
}

/** The thread probe's whole-read state, reported once per engine. */
const undeclaredPairReported = new WeakSet<object>();

/** The rows no pair is stamped on: the unbackfilled ones, and threads naming no record. */
const UNSTAMPED_ROWS = { [COMMENT_PARENT_OBJECT_COLUMN]: { $null: true } } as const;

/**
 * Resolve the thread-visibility WHERE predicate for one sys_comment read
 * (installer docblock above): the parent-record gate's branches over the
 * stamped pair, ORed with the bounded thread probe's branch for the rows no
 * pair is stamped on — or, on a composition whose `sys_comment` declares no
 * pair, the thread probe over every row. Returns `null` only on that last
 * path when the query matches no row (nothing to narrow); otherwise the
 * predicate, or the deny-all sentinel when no branch remains.
 */
async function computeThreadVisibilityFilter(
  engine: ParentRecordGateEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
  gate: ParentRecordGate,
  getAdmission: ParentObjectReadAdmissionSource,
): Promise<unknown | null> {
  if (!declaresCommentParentPair(engine)) {
    if (!undeclaredPairReported.has(engine)) {
      undeclaredPairReported.add(engine);
      logger.warn(
        `[audit] comment read visibility: the registered sys_comment declares no ${COMMENT_PARENT_OBJECT_COLUMN} / ` +
          `${COMMENT_PARENT_RECORD_COLUMN} pair, so every read is answered by the bounded thread probe (at most ` +
          `${READ_SCAN_LIMIT} candidate rows, fail-closed). Reported once for this engine.`,
      );
    }
    return probeUnstampedThreads(engine, ctx, logger, false);
  }

  const branches: unknown[] = [];
  // 1. The stamped rows: one ReadableIds leaf per composable parent object, or
  //    the bounded probe over the pair for D5's classes (ADR-0139 D4, D5).
  const stamped = await computeParentRecordFilter(engine, ctx, logger, gate, getAdmission);
  if (stamped && stamped !== gate.denyAll) branches.push(stamped);
  // 2. The rows no pair is stamped on: the bounded thread probe, never a leaf.
  const unstamped = await probeUnstampedThreads(engine, ctx, logger, true);
  if (unstamped && unstamped !== READ_DENY_ALL) branches.push(unstamped);

  if (branches.length === 0) return READ_DENY_ALL;
  return branches.length === 1 ? branches[0] : { $or: branches };
}

/**
 * The bounded thread probe (the gate's mechanism before ADR-0139 E7): pre-scan
 * the candidate `thread_id`s the query would touch under SYSTEM context,
 * resolve which of their parent records the caller can read through the
 * caller-scoped engine (the parent's own RLS/OWD/sharing apply), and keep the
 * visible threads verbatim.
 *
 * `onlyUnstamped`: restricted to the rows no pair is stamped on, and the
 * emitted branch says so, so it can never select a stamped row — those are the
 * leaf's. Returns `null` when the query matches no candidate, the deny-all
 * sentinel when none is visible. A throw is the caller's to fail closed on.
 */
async function probeUnstampedThreads(
  engine: CommentAccessEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
  onlyUnstamped: boolean,
): Promise<unknown | null> {
  // 1. Candidate thread ids the query would touch — read under SYSTEM context
  //    (the caller may not see the rows yet; that is exactly what we are
  //    deciding). Bypasses this middleware (isSystem). The caller's own order
  //    rides along, so on a table larger than the scan bound the window
  //    scanned is the window the caller pages through.
  const callerWhere = ctx.ast?.where as Record<string, unknown> | undefined;
  const where = onlyUnstamped
    ? callerWhere
      ? { $and: [callerWhere, { ...UNSTAMPED_ROWS }] }
      : { ...UNSTAMPED_ROWS }
    : (callerWhere ?? {});
  const orderBy = (ctx.ast as { orderBy?: unknown } | undefined)?.orderBy;
  const candidates = await engine.find('sys_comment', {
    where,
    fields: ['thread_id'],
    ...(Array.isArray(orderBy) && orderBy.length > 0 ? { orderBy } : {}),
    limit: READ_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (!candidates.length) return null;
  if (candidates.length >= READ_SCAN_LIMIT) {
    // Not silent (fail-closed truncation): rows beyond the scan window are
    // excluded from the visibility filter, so a very broad read may omit rows
    // the caller could see. Stamping the pair lifts the bound for every row.
    logger.warn(
      `[audit] comment read visibility: the thread probe's candidate pre-scan ` +
        `(${onlyUnstamped ? 'rows with no stamped parent pair' : 'the whole read'}) hit the ${READ_SCAN_LIMIT}-row ` +
        'cap; the visibility filter for these rows is fail-closed and may omit visible rows — ' +
        (onlyUnstamped
          ? 'run `os migrate comment-parent-pair --apply` to stamp them'
          : 'scope the query by thread_id'),
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
  const visibleByObject = await resolveReadableParentIds(engine, ctx.context, byObject);

  // 3. Keep the thread ids VERBATIM (never re-assembled from the parts) so the
  //    emitted filter can only ever match rows the pre-scan actually saw.
  const visibleThreads: string[] = [];
  for (const [threadId, target] of threads) {
    if (visibleByObject.get(target.object)?.has(target.recordId)) visibleThreads.push(threadId);
  }
  if (visibleThreads.length === 0) return READ_DENY_ALL;
  const visible = { thread_id: { $in: visibleThreads } };
  return onlyUnstamped ? { ...UNSTAMPED_ROWS, ...visible } : visible;
}

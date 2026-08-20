// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { withoutOperationPrivateKeys } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import type {
  AttachmentLifecycleEngine,
  AttachmentLifecycleLogger,
  AttachmentReadMiddlewareCtx,
} from './attachment-lifecycle.js';

/**
 * sys_attachment access enforcement (#2755, ADR-0049 enforce-or-remove).
 *
 * `sys_attachment` rows are written through the generic data path, and the
 * default member permission sets grant wildcard CRUD with no row scoping —
 * without these hooks any member can attach files to records they cannot
 * see and rewrite or delete any other user's attachments. Salesforce
 * semantics (ContentDocumentLink): an attachment's access is derived from
 * its PARENT record.
 *
 *  - beforeInsert: the caller must be able to READ the parent record —
 *    verified with a caller-scoped findOne so RLS/OWD/sharing apply.
 *    Fail-closed 403 `ATTACHMENT_PARENT_ACCESS`. (Salesforce requires edit
 *    on the parent; v1 enforces read visibility — strictly better than
 *    nothing, edit-parity is a tracked follow-up.) `uploaded_by` is
 *    server-stamped from the session — a client-supplied value never wins.
 *  - beforeUpdate (#10091): the caller must be the uploader OR hold edit on
 *    the parent record — the delete rule, applied to the verb that could
 *    otherwise rewrite the other two gates away: an ungated update let any
 *    member re-point `parent_id` at a record they cannot see, or rewrite
 *    `uploaded_by` and walk through the delete gate's uploader shortcut.
 *    Fail-closed 403, standard catalog code `RECORD_NOT_ACCESSIBLE` (see
 *    {@link UPDATE_DENY_CODE}). A re-point of `parent_object`/`parent_id`
 *    must additionally satisfy the attach rule on the NEW parent (403
 *    `ATTACHMENT_PARENT_ACCESS`), and an unscoped multi-update is refused
 *    outright — mirroring the delete verb below, through the same
 *    `dispatchUnscopedMultiWrite` declaration (#9974 made it valid on both
 *    write verbs). This is the rule the derived sys_comment kit
 *    (`comment-access-hooks.ts`) has carried on update since #4630; the
 *    source kit was missing the limb its derivative copied.
 *  - beforeDelete: the caller must be the uploader OR hold edit on the
 *    parent record (sharing service's `canEdit`; public-model parents are
 *    editable by design). Fail-closed 403 `ATTACHMENT_DELETE_DENIED`; a
 *    multi-delete requires EVERY matched row to pass, and one carrying
 *    NEITHER an id NOR a `where` is refused outright (#4757) — the engine
 *    would hand `deleteMany` an AST over the whole table, and a gate that
 *    resolved no rows for it would be authorizing exactly that. The refusal
 *    reaches this handler through the `dispatchUnscopedMultiWrite`
 *    whole-operation dispatch its registration declares (#9719) — the
 *    per-row dispatch alone can never deliver the shape it refuses.
 *
 * System-context operations (engine self-writes, seeds, lifecycle sweeps)
 * bypass all three gates, as do context-less programmatic calls on bare
 * kernels (no principal to authorize — REST always carries a context).
 *
 * These run alongside plugin-audit's `enforceFilesCapability` (the
 * enable.files opt-in gate); both are fail-closed 403s, so their relative
 * order is not load-bearing.
 */

/** Minimal surface of plugin-sharing's service this gate consults. */
export interface AttachmentSharingLike {
  canEdit(object: string, recordId: string, context: Record<string, unknown>): Promise<boolean>;
}

const PACKAGE_ID = 'com.objectstack.service.storage';
const SYSTEM_CTX = { isSystem: true } as const;
/** Bound on join rows authorized per multi-update/-delete; mirrors the
 * lifecycle hooks' resolve bound. Larger multi-writes fail closed. */
const MULTI_WRITE_AUTH_LIMIT = 1_000;

/**
 * The wire code the UPDATE gate emits. Deliberately the STANDARD catalog
 * member (`StandardErrorCode`, "Sharing rule restriction") rather than an
 * `ATTACHMENT_UPDATE_DENIED` sibling of the insert/delete codes: ADR-0112
 * says a generic permission condition takes the catalog, and since #8211 the
 * error-code ledger's admission gate mechanically REFUSES a new extension
 * code that shadows a standard member. `ATTACHMENT_PARENT_ACCESS` /
 * `ATTACHMENT_DELETE_DENIED` predate that rule (grandfathered, wire values
 * unchanged — consolidating either is a deliberate wire change with its own
 * card per the #8211 adjudication), so the delete gate keeps its code and
 * the new verb takes the vocabulary the rule asks for — exactly what the
 * derived comment kit did (`DENY_CODE` in `comment-access-hooks.ts`). REST
 * already maps this code 403 + object-preserving (`error-response.ts`).
 */
const UPDATE_DENY_CODE = 'RECORD_NOT_ACCESSIBLE';

function forbid(code: string, message: string, object?: string): never {
  const err: any = new Error(message);
  err.code = code;
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
 * Why this module strips the operation-private keys before forwarding an
 * envelope — the LOCAL half of the argument.
 *
 * plugin-security's middleware stamps `__`-prefixed keys onto the operation
 * context resolved for the object of the CURRENT operation, which here is
 * `sys_attachment`. Every gate in this module asks about the PARENT record's
 * object, never about `sys_attachment`, so carrying any of them across is one
 * object's widening applied to another object's question.
 *
 * [#7145] The general rule — which keys those are, why they are dropped by
 * PREFIX rather than by a name list, and why the copy is load-bearing in both
 * directions — is `withoutOperationPrivateKeys` in `@objectstack/core`. It was
 * hand-copied into this file, `plugin-audit`'s comment kit and `plugin-reports`
 * before #7284 gave it one owner; ⛔ import it, never re-derive it locally
 * (`operation-private-keys.pin.test.ts` catches the fourth copy).
 */

/** The caller's ExecutionContext rides on the operation options — the
 * session snapshot lacks `permissions`, which sharing bypasses need.
 *
 * [#7145] Forwarded as the full envelope, which is what `ISharingService`
 * declares for every parameter this value is handed to and what the #6206
 * ruling requires of every caller: they "MUST NOT rebuild a subset of it"
 * (#6523). The five-field projection this replaced (`userId` / `tenantId` /
 * `positions` / `permissions` / `isSystem`) was doing two jobs at once, and
 * only one of them was correct — same defect, same kit, one package over from
 * `comment-access-hooks.ts` (#7141 / PR #7143), which this mirrors:
 *
 *  - dropping the middleware-private keys — CORRECT, and preserved above by
 *    {@link withoutOperationPrivateKeys}: `return exec;` would hand
 *    `sys_attachment`'s access depth to the parent object's owner-match;
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
 *      `principalKind === 'agent'`; stripped, the additive human baseline was
 *      appended to an agent's ceiling on this path, so the sets the bypass
 *      probe evaluated were a SUPERSET of what the user consented to.
 *
 *    `systemPermissions`, `accessible_org_ids`, `posture`, `audience` and
 *    `rlsMembership` were dropped by the same projection; they are forwarded
 *    now for the same reason — the envelope is the contract's unit.
 *
 * Note what deliberately did NOT change: no access DEPTH is synthesised for the
 * parent object. Absent depth leaves the sharing owner-match at its narrowest
 * (`own`) — the safe direction, and byte-for-byte the behaviour the projection
 * produced. Resolving the parent's own depth would WIDEN this gate and is a
 * separate decision, tracked as #7144. */
function callerContext(ctx: any): ExecutionContext {
  const exec = ctx?.input?.options?.context;
  if (exec && typeof exec === 'object') {
    return withoutOperationPrivateKeys(exec as Record<string, unknown>);
  }
  const s = ctx?.session ?? {};
  // [#9691] `s.organizationId`, NOT `s.tenantId`. The hook session's org key is
  // `organizationId` (engine `buildSession`; `HookContextSchema` STRIPS a
  // `tenantId` key outright, pinned in `packages/spec/src/data/hook.test.ts`),
  // so the removed alias read here answered `undefined` on every call and this
  // fallback handed `ISharingService.canEdit` an envelope with no org at all.
  // The target field keeps its `tenantId` spelling: that is `ExecutionContext`'s
  // driver-layer name for the same value, a separate axis #3290 deliberately
  // left alone. The comment kit's `callerContext` already read the blessed name
  // (`s.tenantId ?? s.organizationId`), so this is the #7145 parity that kit's
  // card asked for, completed.
  return { userId: s.userId, tenantId: s.organizationId, positions: s.positions };
}

export function installAttachmentAccessHooks(
  engine: AttachmentLifecycleEngine,
  getSharing: () => AttachmentSharingLike | null | undefined,
  logger: AttachmentLifecycleLogger,
): void {
  /** Resolve every sys_attachment row a write matches, under SYSTEM context
   * — the caller may legitimately be unable to READ rows they are allowed to
   * touch (and the read-visibility middleware below must not narrow the
   * authorization input). Fails closed on an unscoped multi-write and on an
   * over-large match set. One resolver for BOTH write verbs — the shape of
   * `resolveTargetRows` in the derived sys_comment kit — so the two gates
   * cannot drift apart on what "the matched rows" means. */
  const resolveTargetRows = async (
    ctx: any,
    verb: 'update' | 'delete',
    denyCode: string,
  ): Promise<Array<Record<string, unknown>>> => {
    const ids = asIdList(ctx?.input?.id);
    if (ids) {
      const rows: Array<Record<string, unknown>> = [];
      for (const id of ids) {
        const row = await engine.findOne('sys_attachment', { where: { id }, context: { ...SYSTEM_CTX } });
        if (row) rows.push(row);
      }
      return rows;
    }
    const where = ctx?.input?.options?.where;
    if (where === undefined || where === null) {
      // #4757 — no id AND no predicate: the engine hands the driver an AST of
      // `{ object }`, i.e. the WHOLE table. Falling through here would
      // authorize that by resolving zero rows, so refuse instead. "Nothing to
      // authorize" and "nothing was ever queried" are not the same verdict;
      // reading the second as the first is fail-open. (Mirrors #4630's
      // `resolveTargetRows` for sys_comment.)
      //
      // [#9719/#9974] Reached through the wired engine ONLY via the
      // `dispatchUnscopedMultiWrite` whole-operation dispatch BOTH write
      // registrations below declare: the per-row contract (#5038/#5574)
      // binds `input.id` on every predicate dispatch — which routes into the
      // by-id branch above — and a zero-match predicate dispatches nothing
      // at all, so without that declaration this refusal cannot fire,
      // whatever this file says. #9719 built the dispatch for `beforeDelete`
      // only; #9974 (option A, 2026-08-19) ruled it onto `beforeUpdate`, on
      // the recoverability asymmetry: an overwrite leaves no trace and no
      // pre-image, so the verb with the less recoverable failure must not be
      // the less guarded one.
      //
      // ⛔ If this branch ever stops firing on a verb, the fix is the
      // DISPATCH, not this policy — do not widen the branch to compensate.
      forbid(
        denyCode,
        `Refusing an unscoped multi-${verb} of attachments — scope the ${verb} to the rows you mean (an id or a where predicate)`,
      );
    }
    const rows = await engine.find('sys_attachment', {
      where,
      limit: MULTI_WRITE_AUTH_LIMIT + 1,
      context: { ...SYSTEM_CTX },
    });
    if (rows.length > MULTI_WRITE_AUTH_LIMIT) {
      forbid(
        denyCode,
        `Refusing to authorize a multi-${verb} matching more than ${MULTI_WRITE_AUTH_LIMIT} attachments`,
      );
    }
    return rows;
  };

  /** Uploader-or-parent-editor over every matched row. Parent-edit verdicts
   * are memoized per (object, id) — a multi-row write usually targets one
   * record. Degrades to caller-scoped parent READ visibility when no sharing
   * service is present — still strictly tighter than no gate. */
  const authorizeRows = async (
    ctx: any,
    rows: Array<Record<string, unknown>>,
    verb: 'update' | 'delete',
    denyCode: string,
  ): Promise<void> => {
    const userId = ctx.session.userId as string | undefined;
    const sharing = getSharing();
    const callerCtx = callerContext(ctx);
    const canEditCache = new Map<string, boolean>();
    for (const row of rows) {
      if (userId && row.uploaded_by === userId) continue; // the uploader governs their own attachment

      const parentObject = String(row.parent_object ?? '');
      const parentId = String(row.parent_id ?? '');
      const cacheKey = `${parentObject}\u0000${parentId}`;
      let allowed = canEditCache.get(cacheKey);
      if (allowed === undefined) {
        if (sharing && typeof sharing.canEdit === 'function') {
          allowed = await sharing.canEdit(parentObject, parentId, callerCtx);
        } else {
          // Degraded mode (no sharing service): fall back to caller-scoped
          // parent READ visibility — still strictly tighter than no gate.
          try {
            allowed = !!(await ctx.api.object(parentObject).findOne({ where: { id: parentId } }));
          } catch {
            allowed = false;
          }
          logger.debug?.(
            `[storage] attachment access: sharing service absent — ${verb} gated on parent read visibility`,
          );
        }
        canEditCache.set(cacheKey, allowed);
      }
      if (!allowed) {
        forbid(
          denyCode,
          `Cannot ${verb} attachment ${row.id}: only the uploader or a user who can edit the parent record (${parentObject}/${parentId}) may ${verb} it`,
          parentObject,
        );
      }
    }
  };

  // ── Create: parent-record EDIT access + uploaded_by stamping ────────
  engine.registerHook(
    'beforeInsert',
    async (ctx: any) => {
      if (ctx?.session?.isSystem) return;
      if (!ctx?.session) return; // context-less programmatic call (bare kernel)
      const data: any = ctx?.input?.data;
      if (!data || typeof data !== 'object') return;

      // Server stamps provenance: the session identity wins over whatever
      // the client sent (spoofable field otherwise).
      if (ctx.session.userId) data.uploaded_by = ctx.session.userId;

      const parentObject = data.parent_object;
      const parentId = data.parent_id;
      // Schema requires both — let validation report the miss.
      if (typeof parentObject !== 'string' || !parentObject) return;
      if (parentId === undefined || parentId === null || parentId === '') return;

      // Salesforce parity (#2970 item 3): attaching to a record requires EDIT
      // access to it, not merely read. Public-model parents return canEdit
      // true for any member (so the common case is unchanged); private,
      // owner-scoped parents require the caller to own/edit them. Degrades to
      // caller-scoped READ visibility when no sharing service is present.
      const sharing = getSharing();
      let allowed = false;
      if (sharing && typeof sharing.canEdit === 'function') {
        allowed = await sharing.canEdit(parentObject, String(parentId), callerContext(ctx));
      } else {
        try {
          allowed = !!(await ctx.api.object(parentObject).findOne({ where: { id: parentId } }));
        } catch {
          allowed = false;
        }
        logger.debug?.(
          '[storage] attachment access: sharing service absent — attach gated on parent read visibility',
        );
      }
      if (!allowed) {
        forbid(
          'ATTACHMENT_PARENT_ACCESS',
          `Cannot attach to ${parentObject}/${parentId}: the parent record does not exist or you cannot edit it`,
          parentObject,
        );
      }
    },
    { object: 'sys_attachment', packageId: PACKAGE_ID },
  );

  // ── Update: uploader or parent editor (+ the attach rule on a re-point) ──
  engine.registerHook(
    'beforeUpdate',
    async (ctx: any) => {
      if (ctx?.session?.isSystem) return;
      if (!ctx?.session) return; // context-less programmatic call (bare kernel)
      const rows = await resolveTargetRows(ctx, 'update', UPDATE_DENY_CODE);
      // Reached only after a real resolve (the unscoped shape was refused in
      // the resolver): ids that name no live row mean the driver writes
      // nothing, so there is genuinely nothing to gate. The re-point check
      // below is deliberately per-ROW for the same reason — with no matched
      // row a partial re-point (`parent_object` and `parent_id` are two
      // independent columns) has no effective target to authorize, and no
      // write to carry it.
      if (!rows.length) return;
      await authorizeRows(ctx, rows, 'update', UPDATE_DENY_CODE);

      // NOTE `uploaded_by` is deliberately NOT re-stamped here: the insert
      // stamp records provenance at creation, and re-stamping on update would
      // hand the row to whoever edits it. Nor is a client-supplied value
      // refused: to reach this point at all the caller is already the
      // uploader or a parent editor, and a parent editor already holds every
      // verb the uploader shortcut grants — so rewriting `uploaded_by` buys
      // no privilege the row rule did not just verify. (Same posture as the
      // derived comment kit takes for `author_id` on update. The escalation
      // the issue names — rewrite `uploaded_by`, then delete as "uploader" —
      // is closed by the row rule itself, not by stamping.)

      // Re-pointing an attachment is an INSERT into the new parent's files
      // panel: the NEW parent must satisfy the attach rule (EDIT via the
      // sharing service, degrading to caller-scoped read visibility — the
      // beforeInsert gate above), or an authorized edit of your own
      // attachment would be a way to plant files on records you cannot see.
      // Mirrors the comment kit's thread re-point rule (#4630).
      const data: any = ctx?.input?.data;
      if (!data || typeof data !== 'object') return;
      if (data.parent_object === undefined && data.parent_id === undefined) return;

      const sharing = getSharing();
      /** Attach-rule verdicts memoized per effective (object, id) target. */
      const canAttachCache = new Map<string, boolean>();
      for (const row of rows) {
        const nextObject = data.parent_object === undefined ? row.parent_object : data.parent_object;
        const nextId = data.parent_id === undefined ? row.parent_id : data.parent_id;
        if (
          String(nextObject ?? '') === String(row.parent_object ?? '') &&
          String(nextId ?? '') === String(row.parent_id ?? '')
        ) {
          continue; // parent unchanged on this row — no re-point to authorize
        }
        // An unauthorizable target is a REFUSED one (fail closed, like the
        // comment kit's unparseable thread_id) — never "let validation report
        // the miss" as the insert gate does for absent fields: here the field
        // IS present, and a `null`/empty half that validation happened to
        // admit would otherwise sail past this gate.
        if (typeof nextObject !== 'string' || !nextObject || nextId === undefined || nextId === null || nextId === '') {
          forbid(
            'ATTACHMENT_PARENT_ACCESS',
            `Cannot move attachment ${row.id}: ${JSON.stringify(nextObject ?? null)}/${JSON.stringify(nextId ?? null)} does not name a record`,
          );
        }
        const cacheKey = `${nextObject}\u0000${String(nextId)}`;
        let allowed = canAttachCache.get(cacheKey);
        if (allowed === undefined) {
          if (sharing && typeof sharing.canEdit === 'function') {
            allowed = await sharing.canEdit(nextObject, String(nextId), callerContext(ctx));
          } else {
            try {
              allowed = !!(await ctx.api.object(nextObject).findOne({ where: { id: nextId } }));
            } catch {
              allowed = false;
            }
            logger.debug?.(
              '[storage] attachment access: sharing service absent — re-point gated on parent read visibility',
            );
          }
          canAttachCache.set(cacheKey, allowed);
        }
        if (!allowed) {
          forbid(
            'ATTACHMENT_PARENT_ACCESS',
            `Cannot move attachment ${row.id} to ${nextObject}/${String(nextId)}: the parent record does not exist or you cannot edit it`,
            nextObject,
          );
        }
      }
    },
    // [#9974] `dispatchUnscopedMultiWrite` is what makes the unscoped refusal
    // in `resolveTargetRows` REACHABLE on update: the per-row contract
    // (#5038/#5574) binds `input.id` on every predicate dispatch (so the
    // by-id branch shadows the shape check), and a zero-match predicate
    // dispatches nothing at all — the whole-operation dispatch is the one
    // call that arrives with no id and the caller's raw `options`, before any
    // row is resolved. Same declaration the `beforeDelete` registration below
    // carries (#9719), and the same both-verbs pairing the derived comment
    // kit ships.
    { object: 'sys_attachment', packageId: PACKAGE_ID, dispatchUnscopedMultiWrite: true },
  );

  // ── Delete: uploader or parent editor ───────────────────────────────
  engine.registerHook(
    'beforeDelete',
    async (ctx: any) => {
      if (ctx?.session?.isSystem) return;
      if (!ctx?.session) return; // context-less programmatic call (bare kernel)
      // Resolve every row this delete matches (system read — the caller may
      // legitimately be unable to READ rows they are allowed to detach).
      const rows = await resolveTargetRows(ctx, 'delete', 'ATTACHMENT_DELETE_DENIED');
      // Reached only after a real resolve: the query ran and matched no row
      // (or the ids name no live row), so there is genuinely nothing to gate.
      if (!rows.length) return;
      await authorizeRows(ctx, rows, 'delete', 'ATTACHMENT_DELETE_DENIED');
    },
    // [#9719] `dispatchUnscopedMultiWrite` is what makes the #4757 branch in
    // `resolveTargetRows` REACHABLE through the wired engine: the predicate
    // path dispatches per row with `input.id` bound (so the by-id branch
    // shadows the check), and a zero-match predicate dispatches nothing at
    // all — the engine's opt-in whole-operation dispatch is the one call that
    // arrives with no id and the caller's raw `options`, before any row is
    // resolved.
    //
    // [#9974] The flag was renamed from `dispatchUnscopedMultiDelete` when
    // the mechanism was ruled onto `beforeUpdate` as well; the refusal stays
    // PER REGISTRATION. This one carries #4757's delete refusal under its
    // grandfathered `ATTACHMENT_DELETE_DENIED` envelope; the `beforeUpdate`
    // registration above declares the update-verb refusal (#10091) under the
    // standard catalog code — the same both-verbs pairing the derived
    // comment kit ships.
    { object: 'sys_attachment', packageId: PACKAGE_ID, dispatchUnscopedMultiWrite: true },
  );
}

/** No real row matches — the fail-closed sentinel (mirrors plugin-sharing's
 * `{ id: '__deny_all__' }` read-filter deny). */
const READ_DENY_ALL = { id: '__attachment_parent_denied__' } as const;

/** Bound on the per-read candidate pre-scan. Beyond this the filter fails
 * CLOSED (excludes the un-scanned rows) rather than leaking them. */
const READ_SCAN_LIMIT = 2_000;

const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

/**
 * sys_attachment READ visibility inheritance (#2755 follow-up, #2970 item 1).
 *
 * The create/delete hooks above gate writes, but a member could still LIST
 * `sys_attachment` rows (file_name, size, parent_id) pointing at records they
 * cannot read — an info leak, since attachment access derives from the PARENT
 * record (Salesforce ContentDocumentLink semantics). `sys_attachment` is
 * public with no owner field, so the sharing/RLS static-predicate filters
 * never narrow it.
 *
 * This is a data **middleware** (not a find-hook) on purpose: middleware runs
 * for `find`, `findOne`, `count`, AND `aggregate`, so the list `total` (which
 * comes from `engine.count()`, NOT the find path) is filtered identically to
 * the returned rows — a beforeFind/afterFind hook would leave `count()`
 * unfiltered and leak the true row count via `total`.
 *
 * Mechanism (generalizes ADR-0055 `controlled_by_parent` to a polymorphic
 * parent): for each read, pre-scan the candidate `(parent_object, parent_id)`
 * pairs the query would touch (system context), resolve the visible parent
 * ids per `parent_object` through the caller-scoped engine (RLS/OWD/sharing
 * of the PARENT apply), and AND a `$or` of
 * `{ parent_object, parent_id: { $in: <visible> } }` into `ctx.ast.where`.
 */
export function installAttachmentReadVisibility(
  engine: AttachmentLifecycleEngine,
  logger: AttachmentLifecycleLogger,
): void {
  if (typeof engine.registerMiddleware !== 'function') return; // engine lacks the seam
  const andIn = (ctx: AttachmentReadMiddlewareCtx, filter: unknown) => {
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
        const filter = await computeParentVisibilityFilter(engine, ctx, logger);
        if (filter) andIn(ctx, filter);
      } catch (err) {
        // A filter-compute failure must never fall open into a leak.
        logger.warn(
          `[storage] attachment read visibility: filter failed, denying all (${(err as Error)?.message ?? err})`,
        );
        andIn(ctx, READ_DENY_ALL);
      }
      return next();
    },
    { object: 'sys_attachment' },
  );
}

/**
 * Resolve the parent-visibility WHERE predicate for one sys_attachment read.
 * Returns `null` when the query matches no rows (nothing to narrow), a
 * `$or` of visible-parent clauses, or the deny-all sentinel.
 */
async function computeParentVisibilityFilter(
  engine: AttachmentLifecycleEngine,
  ctx: AttachmentReadMiddlewareCtx,
  logger: AttachmentLifecycleLogger,
): Promise<unknown | null> {
  // 1. Candidate (parent_object, parent_id) pairs the query would touch —
  //    read under SYSTEM context (the caller may not see the rows yet; that
  //    is exactly what we are deciding). Bypasses this middleware (isSystem).
  const candidates = await engine.find('sys_attachment', {
    where: (ctx.ast?.where as Record<string, unknown>) ?? {},
    fields: ['parent_object', 'parent_id'],
    limit: READ_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (!candidates.length) return null;
  if (candidates.length >= READ_SCAN_LIMIT) {
    // Not silent (fail-closed truncation): rows beyond the scan window are
    // excluded from the visibility filter, so a very broad unscoped list may
    // omit some rows the caller could see. The panel scopes to one parent so
    // never hits this; a global list should paginate by parent_object.
    logger.warn(
      `[storage] attachment read visibility: candidate pre-scan hit the ${READ_SCAN_LIMIT}-row cap; ` +
        'the visibility filter for this broad read is fail-closed and may omit visible rows — scope the query by parent_object',
    );
  }

  const byObject = new Map<string, Set<string>>();
  for (const row of candidates) {
    const po = row.parent_object;
    const pid = row.parent_id;
    // Skip self-referential rows (no valid files-enabled target is
    // sys_attachment) — also prevents caller-scoped re-entry into this
    // middleware during the visibility probe below.
    if (typeof po !== 'string' || !po || po === 'sys_attachment') continue;
    if (pid === undefined || pid === null || pid === '') continue;
    let ids = byObject.get(po);
    if (!ids) byObject.set(po, (ids = new Set()));
    ids.add(String(pid));
  }
  if (byObject.size === 0) return READ_DENY_ALL;

  // 2. Per parent_object, the visible id subset via the CALLER's context —
  //    the parent object's own RLS/OWD/sharing applies.
  //
  //    [#7145] The caller's envelope, minus the operation-private keys: this
  //    probe reads a DIFFERENT object than the one the middleware resolved its
  //    depth for, and `__readScope` / `__expandRead` are widening inputs that
  //    would arrive attached to the wrong question (the security middleware
  //    re-stamps the depth for THIS object when it resolves any set, so the
  //    only thing dropping them can do is leave the owner-match at its
  //    narrowest — the safe direction). Same rule as `callerContext` above,
  //    and the same half of #7141 / PR #7143 the comment kit already carries.
  const callerEnvelope = withoutOperationPrivateKeys(
    (ctx.context ?? {}) as Record<string, unknown>,
  );
  const clauses: Array<Record<string, unknown>> = [];
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
    if (visible.length) {
      clauses.push({ parent_object: parentObject, parent_id: { $in: visible } });
    }
  }

  if (clauses.length === 0) return READ_DENY_ALL;
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

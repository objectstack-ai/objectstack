// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { withoutOperationPrivateKeys } from '@objectstack/core';
import type { StandardErrorCode } from '@objectstack/spec/api';
import type { ISecurityService, ISharingService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { renderOperationMessage, type ValidationMessageTranslator } from '@objectstack/spec/system';

import {
  createRefusedAttachTombstoner,
  type AttachmentLifecycleEngine,
  type AttachmentLifecycleLogger,
  type AttachmentReadMiddlewareCtx,
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
 *  - beforeInsert: the caller must be able to EDIT the parent record (see
 *    "Parent EDIT" below; Salesforce parity, #2970 item 3 — v1 asked read
 *    visibility, which is now only the degraded mode). Fail-closed 403
 *    `ATTACHMENT_PARENT_ACCESS`. `uploaded_by` is server-stamped from the
 *    session — a client-supplied value never wins. A refusal also hands the
 *    refused `file_id` to the lifecycle, which tombstones the caller's own
 *    never-attached upload (#22466, `createRefusedAttachTombstoner`).
 *  - beforeUpdate (commit da891e0ef): the caller must be the uploader OR hold edit on
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
 *  - Both write verbs refuse a caller who cannot READ the parent with the
 *    platform's not-visible refusal instead of the named one (#21755) — see
 *    {@link refuseNotVisible}. The named refusals below are what a caller who
 *    can read the parent, but may not edit it, receives.
 *  - beforeDelete: the caller must be the uploader OR hold edit on the
 *    parent record (see "Parent EDIT" below). Fail-closed 403
 *    `ATTACHMENT_DELETE_DENIED`; a
 *    multi-delete requires EVERY matched row to pass, and one carrying
 *    NEITHER an id NOR a `where` is refused outright (#4757) — the engine
 *    would hand `deleteMany` an AST over the whole table, and a gate that
 *    resolved no rows for it would be authorizing exactly that. The refusal
 *    reaches this handler through the `dispatchUnscopedMultiWrite`
 *    whole-operation dispatch its registration declares (#9719) — the
 *    per-row dispatch alone can never deliver the shape it refuses.
 *
 * ## Parent EDIT — one question, four limbs
 *
 * The attach rule, the row rule's parent-editor limb (update and delete) and
 * the attach rule on a re-point all ask ONE question — may the caller edit the
 * parent record? — answered by ONE composition ({@link installAttachmentAccessHooks}'s
 * `mayEditParent`), so the four cannot drift:
 *
 *  - plugin-sharing's `checkEdit` (`ISharingService`) answers first: `allow`
 *    admits and `deny` refuses (with each limb's own envelope).
 *  - `abstain` means record sharing does not enforce on the parent at all. For
 *    most parents that IS permission (a `public_read_write` object: nobody
 *    owns its rows). For a `controlled_by_parent` parent it is not: its access
 *    derives from its MASTER (ADR-0055), and `effectiveSharingModel` maps it to
 *    `public` precisely because the security plugin's master-detail check
 *    judges it instead. So an abstention asks that check —
 *    `ISecurityService.checkControlledByParentWrite`, the answer a by-id update
 *    of the parent gets — and only its `allow` and `not_applicable` admit.
 *    `deny` and `unresolvable` (a broken declaration, a missing record, a null
 *    master reference) refuse. A rejection — a datasource fault, a context the
 *    write path refuses — propagates unchanged, so an outage keeps its `503`.
 *  - A kernel whose security service does not serve that member composes no
 *    master check, and there the parent's own update meets none either: the
 *    abstention admits, as it always did.
 *  - No sharing service at all: caller-scoped parent READ visibility (degraded
 *    mode) — still strictly tighter than no gate.
 *
 * ⛔ This is why the gate reads `checkEdit`, never `canEdit`: `canEdit` is its
 * two-state projection, folding `abstain` into `true`, and an attach gate that
 * took that fold as permission let any member holding the `sys_attachment`
 * create or delete bit write files onto every master-detail child record of
 * the org — including records whose own update refuses them.
 *
 * System-context operations (engine self-writes, seeds, lifecycle sweeps)
 * bypass all three gates, as do context-less programmatic calls on bare
 * kernels (no principal to authorize — REST always carries a context).
 *
 * These run alongside plugin-audit's `enforceFilesCapability` (the
 * enable.files opt-in gate); both are fail-closed 403s, so their relative
 * order is not load-bearing.
 */

/**
 * The one member of plugin-sharing's contract this gate consults — the
 * TRI-STATE edit verdict, because the gate must tell "sharing permits this"
 * from "sharing does not enforce here" (see "Parent EDIT" above). A `Pick` of
 * the real `ISharingService`, not a hand-written shape.
 */
export type AttachmentSharingLike = Pick<ISharingService, 'checkEdit'>;

/**
 * The one member of the security service's contract this gate consults: the
 * ADR-0055 master-detail write check, for a `controlled_by_parent` parent.
 * OPTIONAL on the contract, so the gate handles its absence by construction.
 */
export type AttachmentSecurityLike = Pick<ISecurityService, 'checkControlledByParentWrite'>;

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
 * [#21755] Refuse a write on an attachment whose parent the caller cannot
 * READ — with the platform's not-visible refusal, never the gate's named one.
 *
 * The named refusals ({@link forbid} with `ATTACHMENT_DELETE_DENIED` /
 * {@link UPDATE_DENY_CODE}) name the parent record (`object/id`) in the
 * message and its object on the envelope. That is honest to a caller who can
 * read the parent and may not edit it; to a caller who cannot read it, it is a
 * disclosure across the read boundary — the read door answers that same caller
 * "not found" for the attachment, because an attachment's visibility IS its
 * parent's ({@link installAttachmentReadVisibility}). The by-id write pre-image
 * check already refuses such a write before this gate runs for every principal
 * its row filter binds; this is the same answer for the principals it does not
 * bind, so the gate never becomes the door that names what the read door hides.
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
 * The parent an attachment row names, or `null` when it names none a caller
 * could read — the ONE rule both the read-visibility middleware (which skips
 * such rows, so nobody reads them) and the write gate's not-visible check use.
 * `sys_attachment` itself is never a valid files-enabled target, and probing
 * it would re-enter this module's own middleware.
 */
function attachmentParentOf(row: Record<string, unknown>): { object: string; id: string } | null {
  const po = row.parent_object;
  const pid = row.parent_id;
  if (typeof po !== 'string' || !po || po === 'sys_attachment') return null;
  if (pid === undefined || pid === null || pid === '') return null;
  return { object: po, id: String(pid) };
}

/**
 * Which of these parent records can the CALLER read? Answered per parent
 * object by ONE caller-scoped engine read of the candidate ids, so the parent
 * object's own OWD/sharing, RLS and object-level CRUD decide.
 *
 * This is the one answer both halves of this module ask: the read-visibility
 * middleware (which attachments a read may return) and the write gate's
 * not-visible check (#21755). One evaluator, so an attachment can never be
 * hidden by the read door and named by the write door.
 *
 * An object whose read throws (unknown to the engine, refused, driver fault)
 * contributes no visible id — fail closed.
 *
 * [#7145] The caller's envelope, minus the operation-private keys: this probe
 * reads a DIFFERENT object than the one the middleware resolved its depth for,
 * and `__readScope` / `__expandRead` are widening inputs that would arrive
 * attached to the wrong question (the security middleware re-stamps the depth
 * for THIS object when it resolves any set, so the only thing dropping them can
 * do is leave the owner-match at its narrowest — the safe direction). Same rule
 * as `callerContext` below, and the same half of #7141 / PR #7143 the comment
 * kit already carries.
 */
async function resolveReadableParentIds(
  engine: Pick<AttachmentLifecycleEngine, 'find'>,
  callerContext: Record<string, unknown> | undefined,
  idsByObject: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<Map<string, Set<string>>> {
  const callerEnvelope = withoutOperationPrivateKeys((callerContext ?? {}) as Record<string, unknown>);
  const visibleByObject = new Map<string, Set<string>>();
  for (const [parentObject, idSet] of idsByObject) {
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
  return visibleByObject;
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
 * declares for every parameter this value is handed to and what the full-envelope
 * ruling requires of every caller: they "MUST NOT rebuild a subset of it"
 * (commit aa4b90d9a). The five-field projection this replaced (`userId` / `tenantId` /
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

/**
 * Install the write-side gates on `sys_attachment` (insert / update / delete).
 *
 * `messageTranslator` resolves the deployment's i18n lookup for the
 * not-visible refusal's sentence ({@link refuseNotVisible}) — lazily, per
 * refusal, because the i18n service is contributed by another plugin that may
 * start after this one. Absent, the built-in catalog still renders the
 * caller's locale.
 *
 * `getSecurity` resolves the security service, lazily for the same reason, for
 * its ADR-0055 master-detail write check (see "Parent EDIT" in the module
 * header). Absent — or serving no such member — a `controlled_by_parent`
 * parent meets no master check here, exactly as its own update meets none.
 */
export function installAttachmentAccessHooks(
  engine: AttachmentLifecycleEngine,
  getSharing: () => AttachmentSharingLike | null | undefined,
  logger: AttachmentLifecycleLogger,
  messageTranslator?: () => ValidationMessageTranslator | undefined,
  getSecurity?: () => AttachmentSecurityLike | null | undefined,
): void {
  /**
   * [#22466] What a refused attach does about its file. Created HERE, at
   * installation — outside every engine operation — because the tombstone it
   * schedules runs in a snapshot of this context: outside the refused write's
   * unit of work, so a caller's transaction rolling back cannot take the
   * tombstone with it. See {@link createRefusedAttachTombstoner}.
   */
  const tombstoneRefusedAttach = createRefusedAttachTombstoner(engine, logger);

  /**
   * May the caller EDIT the parent record `(object, recordId)`? The one
   * question the attach rule, the row rule's parent-editor limb and the
   * re-point's attach rule all ask — see "Parent EDIT" in the module header for
   * the composition and why each outcome lands where it does.
   *
   * `recordId` is the value the limb holds (the degraded read probe keeps the
   * shape each limb always queried with); the sharing and security services
   * are handed its string form, as `canEdit` always was.
   */
  const mayEditParent = async (
    ctx: any,
    object: string,
    recordId: unknown,
    callerCtx: ExecutionContext,
    limb: string,
  ): Promise<boolean> => {
    const sharing = getSharing();
    if (!sharing || typeof sharing.checkEdit !== 'function') {
      // Degraded mode (no sharing service): caller-scoped parent READ
      // visibility — still strictly tighter than no gate.
      logger.debug?.(`[storage] attachment access: sharing service absent — ${limb} gated on parent read visibility`);
      try {
        return !!(await ctx.api.object(object).findOne({ where: { id: recordId } }));
      } catch {
        return false;
      }
    }
    const verdict = await sharing.checkEdit(object, String(recordId), callerCtx);
    if (verdict === 'allow') return true;
    // `deny`, and anything that is not one of the three verdicts, refuses.
    if (verdict !== 'abstain') return false;

    // Record sharing does not enforce on this parent. Whether that is
    // permission is the master-detail check's question (ADR-0055): it answers
    // `not_applicable` for a parent that derives nothing from a master.
    let security: AttachmentSecurityLike | null | undefined;
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
        `[storage] attachment access: record sharing abstains on ${object} and the security service composes no ` +
          `master-detail write check — ${limb} admitted on the abstention, as the parent's own update would be`,
      );
      return true;
    }
    // A rejection (a datasource fault, a context the write path refuses) is a
    // refusal of the request, and propagates as it is.
    const answer = await security.checkControlledByParentWrite(object, String(recordId), callerCtx);
    return answer.outcome === 'allow' || answer.outcome === 'not_applicable';
  };

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
   * ({@link mayEditParent}) are memoized per (object, id) — a multi-row write
   * usually targets one record. */
  const authorizeRows = async (
    ctx: any,
    rows: Array<Record<string, unknown>>,
    verb: 'update' | 'delete',
    denyCode: string,
  ): Promise<void> => {
    const userId = ctx.session.userId as string | undefined;
    const callerCtx = callerContext(ctx);
    const canEditCache = new Map<string, boolean>();
    /** Parent READ verdicts, asked only for a row about to be refused. */
    const canReadCache = new Map<string, boolean>();
    for (const row of rows) {
      if (userId && row.uploaded_by === userId) continue; // the uploader governs their own attachment

      const parentObject = String(row.parent_object ?? '');
      const parentId = String(row.parent_id ?? '');
      const cacheKey = `${parentObject}\u0000${parentId}`;
      let allowed = canEditCache.get(cacheKey);
      if (allowed === undefined) {
        allowed = await mayEditParent(ctx, parentObject, parentId, callerCtx, verb);
        canEditCache.set(cacheKey, allowed);
      }
      if (!allowed) {
        // [#21755] The named refusal below names the parent. It is only for a
        // caller who can READ that parent; one who cannot gets the platform's
        // not-visible refusal, decided by the same evaluator the read door
        // uses (so the write door never names what the read door hides).
        const parent = attachmentParentOf(row);
        let canRead = canReadCache.get(cacheKey);
        if (canRead === undefined) {
          canRead = parent
            ? !!(await resolveReadableParentIds(engine, callerCtx, new Map([[parent.object, new Set([parent.id])]])))
                .get(parent.object)
                ?.has(parent.id)
            : false;
          canReadCache.set(cacheKey, canRead);
        }
        const namedMessage = `Cannot ${verb} attachment ${row.id}: only the uploader or a user who can edit the parent record (${parentObject}/${parentId}) may ${verb} it`;
        if (!canRead) {
          // The operator's half stays server-side, where the parent may be named.
          logger.warn(`[storage] attachment access: ${namedMessage} (the caller cannot read the parent; answered not-visible)`, {
            operation: verb,
            object: 'sys_attachment',
            recordId: row.id,
            userId: userId ?? 'unknown',
          });
          refuseNotVisible(callerCtx, messageTranslator);
        }
        forbid(denyCode, namedMessage, parentObject);
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
      // access to it, not merely read — answered as "Parent EDIT" in the module
      // header sets out, so a `controlled_by_parent` parent is judged through
      // its master, as its own update is.
      const allowed = await mayEditParent(ctx, parentObject, parentId, callerContext(ctx), 'attach');
      if (!allowed) {
        // [#22466] Every refusal leg of the attach rule arrives HERE — sharing
        // `deny` or a non-verdict, the master-detail check's `deny` or
        // `unresolvable`, the degraded read probe's miss — so this one call
        // covers them all and no leg can drift. A REJECTION from either check
        // (an outage) never reaches this line: it is no verdict, and keeps
        // its own status. The tombstone is scheduled, never awaited, and is
        // conditional on the file being the caller's own unheld upload.
        tombstoneRefusedAttach(data.file_id, ctx.session.userId);
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
      // panel: the NEW parent must satisfy the attach rule (parent EDIT, the
      // beforeInsert gate above), or an authorized edit of your own
      // attachment would be a way to plant files on records you cannot see.
      // Mirrors the comment kit's thread re-point rule (#4630).
      const data: any = ctx?.input?.data;
      if (!data || typeof data !== 'object') return;
      if (data.parent_object === undefined && data.parent_id === undefined) return;

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
          allowed = await mayEditParent(ctx, nextObject, nextId, callerContext(ctx), 're-point');
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
    // registration above declares the update-verb refusal (commit da891e0ef) under the
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
    // Skip rows that name no readable parent — self-referential rows included
    // (no valid files-enabled target is sys_attachment), which also prevents
    // caller-scoped re-entry into this middleware during the probe below.
    const parent = attachmentParentOf(row);
    if (!parent) continue;
    let ids = byObject.get(parent.object);
    if (!ids) byObject.set(parent.object, (ids = new Set()));
    ids.add(parent.id);
  }
  if (byObject.size === 0) return READ_DENY_ALL;

  // 2. Per parent_object, the visible id subset via the CALLER's context —
  //    the parent object's own RLS/OWD/sharing applies. The write gate's
  //    not-visible check asks the same evaluator (#21755); the envelope rule
  //    (#7145) lives on it.
  const visibleByObject = await resolveReadableParentIds(
    engine,
    ctx.context as Record<string, unknown> | undefined,
    byObject,
  );
  const clauses: Array<Record<string, unknown>> = [];
  for (const parentObject of byObject.keys()) {
    const visible = [...(visibleByObject.get(parentObject) ?? [])];
    if (visible.length) {
      clauses.push({ parent_object: parentObject, parent_id: { $in: visible } });
    }
  }

  if (clauses.length === 0) return READ_DENY_ALL;
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

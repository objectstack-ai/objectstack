// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { IHttpServer, IHttpRequest, IHttpResponse, IStorageService } from '@objectstack/spec/contracts';
import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';
// [#15999] The BRAND predicate, never `instanceof` — this error crosses package
// boundaries and a monorepo resolves the same module through more than one path
// (`src` under vitest aliases, `dist` under the published `exports`), so two
// copies of the class make `instanceof` answer FALSE for a genuine instance.
// See `packages/core/src/security/authz-store-unavailable.ts`.
import { isAuthzStoreUnavailableError } from '@objectstack/core';
import type {
  StorageMetadataStore,
  FileRecord,
  UploadSessionRecord,
  StorageWriteContext,
} from './metadata-store.js';
// [#22175] Whether a door's scoped by-id write can reach the row it names —
// the store's own answer, asked before the write. [#22332] And the chunk
// door's conditional progress write.
import { organizationOutOfWriteReach, updateSessionProgressIfUnchanged } from './metadata-store.js';
import type { LocalStorageAdapter } from './local-storage-adapter.js';
// [#22046] The ONE upload ownership rule. Declared in its own module and only
// CALLED here — the three doors below share it rather than each carrying a
// copy of the comparison.
import {
  isFileUploader,
  NOT_UPLOADER_CODE,
  NOT_UPLOADER_MESSAGE,
  NOT_UPLOADER_STATUS,
} from './upload-ownership.js';
// Type only. The PREDICATE is never re-implemented in this file (#10246): it
// arrives through `opts.resolveFileHolder`, which the plugin binds to the reap
// guard's own `findFileHolder`.
import type { FileHolder } from './attachment-lifecycle.js';
import { contentDispositionValue } from './content-disposition.js';
// [#22283] The `storage` settings namespace's Limits group — read and resolved
// in ONE module, called per request by the doors below.
import {
  resolveStorageLimits,
  BYTES_PER_UPLOAD_MB,
  type ResolvedStorageLimits,
  type StorageLimitsSnapshot,
} from './storage-limits.js';

/** Authorization verdict for an attachments-scope download (#2970 item 2). */
export type FileReadVerdict = 'allow' | 'deny' | 'unauthenticated';

/**
 * [#22175] The answer the commit and chunked-completion doors give an uploader
 * whose active organization is no longer the one the upload was started in —
 * see `requireStartingOrganization` inside {@link registerStorageRoutes}.
 * [#22218] The chunk door gives it too, and so does the progress door when the
 * session's expiry stamp is due.
 *
 * `409` / `RESOURCE_CONFLICT`, the standard-catalog member HTTP 409 derives
 * (ADR-0112; no storage extension code is registered for this): the request
 * conflicts with where the upload stands, and the caller can resolve it — the
 * same call succeeds once they switch back. Not `403 PERMISSION_DENIED`: that
 * code is the ownership rule's one refusal, and this caller IS the uploader.
 */
const ORGANIZATION_CHANGED_STATUS = 409;
const ORGANIZATION_CHANGED_CODE: StandardErrorCode = 'RESOURCE_CONFLICT';
/**
 * Constant, and naming no organization: it tells the uploader what changed and
 * what finishes the upload. The organization ids go to the operator log only.
 */
const ORGANIZATION_CHANGED_MESSAGE =
  'This upload was started in a different organization than your active one. ' +
  'Switch your active organization back to the one the upload was started in, then finish the upload.';

/**
 * [#22283] The answer every upload door gives a file over the resolved
 * `max_upload_mb` — before the backend stores a byte and before any row is
 * written.
 *
 * `413` because that is the condition (RFC 9110, content too large).
 * `PAYLOAD_TOO_LARGE` because it is the one registered code for that condition
 * (ADR-0112 ledger, listed under this package's owner key beside
 * `@objectstack/rest`, which answers it for its import row ceilings): a client
 * branches on "too large" by the code alone, at every door that refuses it.
 * Not `VALIDATION_ERROR`, the bucket `standardErrorCodeForHttpStatus` derives
 * for a `413`: the standard catalog names no `413` member, so that code would
 * say only "malformed request" and leave the client to read the status.
 *
 * Typed `RegisteredErrorCode` so a misspelling, or the code leaving the
 * ledger, fails to compile; that this package's own owner key lists it is
 * `check:error-code-provenance`'s to hold. The message names the limit and
 * where it is set.
 */
const UPLOAD_TOO_LARGE_STATUS = 413;
const UPLOAD_TOO_LARGE_CODE: RegisteredErrorCode = 'PAYLOAD_TOO_LARGE';

/** The refusal's message: what was measured, the limit, and the one setting that moves it. */
function uploadTooLargeMessage(measured: string, maxUploadBytes: number): string {
  const mb = Math.round((maxUploadBytes / BYTES_PER_UPLOAD_MB) * 100) / 100;
  return (
    `${measured}, over the maximum upload size of ${mb} MB (${maxUploadBytes} bytes). ` +
    'The limit is the "Max upload size (MB)" storage setting (max_upload_mb in the storage settings), ' +
    'which an administrator can change.'
  );
}

/**
 * [#22313] The answer the chunked-completion door gives an upload that does
 * not hold the file it declared — a declared chunk it never received, a chunk
 * beyond the declared count, bytes that do not add up to the declared total
 * size — or a request whose parts list names a chunk the upload does not hold,
 * or names it with another eTag. Nothing is assembled and the session stays in
 * flight, so the uploader can send what it lacks and complete again.
 *
 * `409` / `RESOURCE_CONFLICT`, the standard-catalog member HTTP 409 derives
 * (ADR-0112; no storage extension code is registered for this): the request
 * conflicts with where the upload stands, and the caller can resolve it. Not
 * `400`: the request can be well formed and still be refused here, because
 * what is missing is bytes the server does not hold. The `details` carry the
 * chunk indexes, so a client can re-send exactly those.
 */
const INCOMPLETE_UPLOAD_STATUS = 409;
const INCOMPLETE_UPLOAD_CODE: StandardErrorCode = 'RESOURCE_CONFLICT';

/**
 * [#22332] How many times the chunk door tries to record a stored chunk in the
 * upload's progress before it refuses.
 *
 * The record is written with a compare-and-set
 * (`updateSessionProgressIfUnchanged`), and a write only loses to a write
 * that landed between the door's read and its own — so each lost attempt is
 * another chunk recorded, and a chunk loses at most once per chunk recorded
 * alongside it. Sixteen covers parallel uploaders well beyond the four to ten
 * lanes they commonly run; past it the door refuses rather than spin.
 *
 * The refusal is `409` / `RESOURCE_CONFLICT` (ADR-0112's standard member for
 * HTTP 409, the code the completion door answers too): the chunk's bytes are
 * stored but the upload does not record it, and sending the chunk again
 * resolves it — a re-sent chunk replaces its slot. ⛔ Never a `200`: a chunk
 * answered as stored and missing from the record is the loss this guards.
 */
export const CHUNK_RECORD_ATTEMPTS = 16;
const CHUNK_NOT_RECORDED_STATUS = 409;
const CHUNK_NOT_RECORDED_CODE: StandardErrorCode = 'RESOURCE_CONFLICT';

/**
 * The request's declared `content-length`, or `undefined` when it carries none
 * that parses. A pre-check only, so an oversized body is refused before it is
 * read into memory: the bytes actually read are judged again after.
 */
function declaredContentLength(req: IHttpRequest): number | undefined {
  const raw = (req.headers ?? {})['content-length'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === undefined || first === null || String(first).trim() === '') return undefined;
  const n = Number(first);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * What the upload routes need to know about the caller (#2755, widened #12745).
 *
 * `organizationId` is the session's ACTIVE organization — the scope the upload
 * is happening in, and the value threaded into `createFile` so the new
 * `sys_file` row is stamped rather than landing NULL, and (since #12928) into
 * `createSession` so the chunked door's `sys_upload_session` row is stamped
 * for the same reason. It is optional in both directions on purpose: a
 * resolver that only knows the user (every pre-#12745 implementation, and
 * every single-tenant deployment) keeps type-checking and keeps working, and a
 * session with no active organization resolves to `undefined` rather than to a
 * guess.
 *
 * ⚠️ Since commit f087c376f the same value also travels on this door's `updateFile` /
 * `updateSession` calls, where it does something DIFFERENT — it scopes the
 * statement instead of stamping a column, so a row belonging to another
 * organization is no longer reachable (see `StorageWriteContext`). Two
 * handlers had the session in hand and discarded it (`if ((await
 * requireUploadSession(req, res)) === false) return;`); they now bind it, for
 * the same reason #12745 bound it here — the value was already resolved, and
 * dropping it was the whole defect.
 */
export interface StorageUploadSession {
  userId?: string;
  organizationId?: string;
}

/**
 * Options for the storage route registration helper.
 */
export interface StorageRoutesOptions {
  basePath?: string;
  /**
   * Default presigned URL TTL in seconds (3600 when unset). A SAVED
   * `storage.presigned_ttl` wins over it; the namespace's own default does not
   * (see {@link StorageRoutesOptions.limitsSnapshot}).
   */
  presignedTtl?: number;
  /**
   * Default chunked upload session TTL in seconds (86400 when unset). A SAVED
   * `storage.session_ttl` wins over it; the namespace's own default does not.
   */
  sessionTtl?: number;
  /**
   * [#22283] The `storage` settings namespace's Limits group as last read —
   * `presigned_ttl`, `session_ttl` and `max_upload_mb` — asked once per
   * request, so a save reaches the next upload without a remount. Resolved
   * against `presignedTtl` / `sessionTtl` above by `resolveStorageLimits`
   * (`storage-limits.ts`): a saved value wins over these options, these options
   * win over the namespace default.
   *
   * Absent, or answering `undefined` (no settings namespace bound): the TTLs
   * are the options above and NO upload size limit applies — the behaviour
   * before the Limits group was honoured. `composeStorageRoutes` binds it from
   * the `storage` service the plugin registers, for both mounts.
   */
  limitsSnapshot?: () => StorageLimitsSnapshot | undefined;
  /**
   * Session resolver for the UPLOAD entry points (#2755). When wired, the
   * presigned/complete/chunked upload routes reject anonymous requests with
   * 401 `AUTH_REQUIRED`, and new sys_file rows are stamped with
   * `owner_id = session.userId` and — since #12745 — with the session's active
   * `organizationId`. Since #22046 the commit, chunked-completion and
   * progress doors also refuse a caller who is not the file's uploader
   * (`isFileUploader`, `403 PERMISSION_DENIED`). When absent (bare kernels,
   * tests), the routes stay open — back-compat, logged once — and there is no
   * caller identity for the ownership rule to compare. Download routes are NOT
   * gated here (capability URLs embedded in <img src>/<a href>; gating them
   * is a tracked follow-up needing cookie sessions or signed links).
   */
  resolveSession?: (req: IHttpRequest) => Promise<StorageUploadSession | null | undefined>;
   /**
   * Authorize a DOWNLOAD of a parent-governed file (#2970 item 2, extended by
   * ADR-0104 D3 wave 2). When wired, the download endpoints
   * (`/files/:fileId` and `/files/:fileId/url`) consult this for
   * `scope==='attachments'` files AND for field-owned files (`ref_object` set),
   * excluding `public_read` ones:
   *   - `unauthenticated` → 401 (no session)
   *   - `deny` → 403 (session, but cannot read the parent record the file
   *     belongs to / is attached to, and is not the owner)
   *   - `allow` → a short-lived signed URL is issued
   * A THROW is not a verdict: since #15999 an `AuthzStoreUnavailableError`
   * raised by this authorizer is relayed as its declared `503`
   * `SERVICE_UNAVAILABLE` rather than flattened into the `deny` 403 — the
   * store was unreadable, so no verdict was ever reached. Every other throw
   * still fails closed to `deny`.
   * A file with neither an attachments scope nor a field owner — an unclaimed
   * upload, an org logo — keeps the stable anonymous capability URL, as does
   * any file explicitly marked `acl: 'public_read'` (the opt-in for genuinely
   * public embedding, since `<img src>` cannot carry a bearer token).
   * When absent (bare kernels, tests), all downloads stay open (back-compat).
   */
  authorizeFileRead?: (file: FileRecord, req: IHttpRequest) => Promise<FileReadVerdict>;
  /**
   * "Is anything still holding this file?" for a TOMBSTONED row (#10246).
   *
   * A `sys_file` tombstone (`status: 'deleted'` + `deleted_at`) is recoverable
   * state, not a delete: re-pointing a `sys_attachment` join row onto it, or
   * re-claiming it through the `ref_*` ownership columns, makes it live again
   * — and the sweep already honours that, un-tombstoning and vetoing the reap
   * instead of reclaiming the bytes. But the sweep is the only thing that ever
   * asks, and it asks only AFTER the declared 30d TTL expires, so inside the
   * grace window a live attachment pointed at a tombstone downloaded as 404
   * for up to 30 days and then silently started working.
   *
   * ⛔ This does NOT add a second revival mechanism. Revival stays solely the
   * sweep guard's; nothing on the read path writes to the row. What moves here
   * is the JUDGEMENT — the download path stops treating the tombstone as the
   * last word and asks the same question the guard asks.
   *
   * ⚠️ Wire this to `findFileHolder` (`attachment-lifecycle.ts`) and to
   * nothing else. That function is the ONE definition of "still held", a
   * deliberate union of the two surfaces that can hold a `sys_file` —
   * `sys_attachment` join rows AND the `ref_*` ownership columns — and it is
   * what decides whether the next sweep reaps this row. A read side that
   * re-derived a narrower question (join rows only, say) would refuse files
   * the sweep refuses to reap: the same defect, one limb over.
   *
   * Absent (bare kernels, no data engine, tests that don't wire it): tombstones
   * stay refused, exactly as before this option existed.
   */
  resolveFileHolder?: (file: FileRecord) => Promise<FileHolder>;
  /**
   * TTL (seconds) for the signed URL minted on a GATED attachments download.
   * Short by design — the link is followed immediately after an explicit
   * click. Default 300 (5 min). Non-gated downloads keep `presignedTtl`.
   */
  downloadTtl?: number;
  /** Optional logger for the one-time open-mode notice. */
  logger?: { info(msg: string): void; warn(msg: string): void };
}

/**
 * Register `/api/v1/storage/*` REST routes with the HTTP server.
 *
 * Implements the contract defined in `packages/spec/src/api/storage.zod.ts`
 * (`StorageApiContracts`). This function follows the "autonomous plugin route
 * registration" pattern used by `I18nServicePlugin`, `AuthPlugin`, etc.
 *
 * Routes:
 * - POST   /storage/upload/presigned               → get presigned upload URL
 * - POST   /storage/upload/complete                → mark upload as committed
 * - POST   /storage/upload/chunked                 → initiate chunked upload
 * - PUT    /storage/upload/chunked/:uploadId/chunk/:chunkIndex → upload a chunk
 * - POST   /storage/upload/chunked/:uploadId/complete          → complete chunked
 * - GET    /storage/upload/chunked/:uploadId/progress          → get upload progress
 * - GET    /storage/files/:fileId/url              → get download URL
 * - PUT    /storage/_local/raw/:token              → local adapter raw upload
 * - GET    /storage/_local/raw/:token              → local adapter raw download
 */
export function registerStorageRoutes(
  httpServer: IHttpServer,
  storage: IStorageService,
  store: StorageMetadataStore,
  opts: StorageRoutesOptions = {},
): void {
  const basePath = opts.basePath ?? '/api/v1/storage';
  const downloadTtl = opts.downloadTtl ?? 300;

  // [#22283] The limits THIS request is served under — the saved Limits group
  // resolved against this mount's own options, asked per request (never
  // hoisted to registration) so a settings save reaches the next request.
  const currentLimits = (): ResolvedStorageLimits =>
    resolveStorageLimits(opts.limitsSnapshot?.(), {
      presignedTtl: opts.presignedTtl,
      sessionTtl: opts.sessionTtl,
    });

  // [#22283] The size gate every upload door asks before it stores a byte or
  // writes a row. `false` ⇒ the 413 was already sent and the handler must stop.
  // `bytes` that is not a finite number cannot be judged and passes — the
  // byte-carrying doors judge what they actually receive.
  const requireWithinUploadLimit = (
    bytes: number,
    maxUploadBytes: number | undefined,
    measured: (bytes: number) => string,
    res: IHttpResponse,
  ): boolean => {
    if (maxUploadBytes === undefined || !Number.isFinite(bytes) || bytes <= maxUploadBytes) return true;
    sendError(res, UPLOAD_TOO_LARGE_STATUS, UPLOAD_TOO_LARGE_CODE, uploadTooLargeMessage(measured(bytes), maxUploadBytes));
    return false;
  };

  // ── Download authorization gate (#2970 item 2, ADR-0104 D3 wave 2) ───
  // Two kinds of file are gated, both deriving access from a PARENT record:
  //   - `attachments`-scope files, via their sys_attachment join rows;
  //   - field-owned files, via the single record whose field owns them
  //     (`ref_object`/`ref_id`, ADR-0104 D3 wave 2).
  // `acl: 'public_read'` opts a file back out to the stable anonymous
  // capability URL — needed for genuinely public embedding (`<img src>`
  // cannot carry a bearer token), and now an explicit declaration rather
  // than the silent default it used to be for every field file.
  //
  // Dual-mode safe: a legacy field holds an inline blob or an external URL,
  // never a `sys_file` id, so no legacy file has `ref_object` set and none of
  // them start being gated by this change.
  //
  // Returns the signed-URL TTL to use, or `false` if a response was already
  // sent (401/403, and since #15999 the `503 SERVICE_UNAVAILABLE` an
  // authorization-store OUTAGE is answered with) and the handler must stop.
  const authorizeDownload = async (
    file: FileRecord,
    req: IHttpRequest,
    res: IHttpResponse,
  ): Promise<number | false> => {
    const fieldOwned = !!file.ref_object && file.ref_id != null && file.ref_id !== '';
    const gated = file.scope === 'attachments' || fieldOwned;
    if (!gated || file.acl === 'public_read' || !opts.authorizeFileRead) {
      return currentLimits().presignedTtl;
    }
    let verdict: FileReadVerdict;
    try {
      verdict = await opts.authorizeFileRead(file, req);
    } catch (err) {
      // [#15999, ruling item 3] An UNREADABLE authorization store is an outage,
      // not a verdict. `buildFileReadAuthorizer` already re-raises the brand
      // rather than returning `'deny'` (commit 6a180e42d) — and until now this `catch`
      // absorbed that re-raise one frame up and rendered it as this gate's own
      // `403`, which is precisely the confusion commit 6a180e42d was made to prevent: an
      // outage answered as a capability denial, indistinguishable on the wire
      // from a genuine refusal.
      //
      // RELAYED here rather than re-raised. A bare re-raise escapes into the
      // route's own outer `catch`, which answers `500 INTERNAL` — no longer
      // wrong-but-informative, merely opaque — and the shared render that would
      // give an escaped envelope its declared status does not exist yet
      // (#16545). A relay answers the DECLARED envelope before the throw
      // escapes, so it is correct today and stays correct once #16545 lands;
      // the same shape `badRequest` in `service-datasource`'s `admin-routes.ts`
      // has used for a service-thrown `503`/`SERVICE_UNAVAILABLE` since #6504.
      //
      // `status` / `code` are read OFF the error rather than written as digits:
      // the envelope this answers is the one the producer declared.
      //
      // ⛔ Scoped to the brand on purpose. Every other fault still falls to
      // `'deny'` below — this door must never fall open, and widening the arm
      // to "anything that carries a status" would let an unrelated coded throw
      // decide the answer.
      if (isAuthzStoreUnavailableError(err)) {
        sendError(res, err.status, err.code, err.message);
        return false;
      }
      verdict = 'deny'; // a failed authz check must never fall open
    }
    if (verdict === 'unauthenticated') {
      sendError(res, 401, 'AUTH_REQUIRED', 'Authentication required to download this file');
      return false;
    }
    if (verdict === 'deny') {
      if (fieldOwned) {
        sendError(res, 403, 'FILE_DOWNLOAD_DENIED', 'You do not have access to the record this file belongs to');
      } else {
        sendError(res, 403, 'ATTACHMENT_DOWNLOAD_DENIED', 'You do not have access to a record this file is attached to');
      }
      return false;
    }
    return downloadTtl;
  };

  // ── Download servability (#10246) ────────────────────────────────────
  // Written ONCE and called by both download endpoints. They used to carry a
  // copy each of `file.status !== 'committed'`, which is how a rule that needs
  // to widen turns into two rules that drift; `/files/:fileId/url` and
  // `/files/:fileId` are the same decision reached through two doors.
  //
  //   - `committed` → servable, unconditionally and unchanged.
  //   - `pending`   → refused, unconditionally and unchanged: an upload that
  //                   was never completed has no bytes to promise.
  //   - `deleted`   → servable for exactly as long as something still holds
  //                   it. The tombstone is NOT the last word; it is a claim
  //                   about the future (this row is reapable when the grace
  //                   window ends) that the sweep re-checks and often
  //                   withdraws. Asking the guard's own question here makes
  //                   the two agree by construction: a file this returns
  //                   `true` for is a file the next sweep would un-tombstone
  //                   rather than reap, and the moment the last holder goes it
  //                   returns `false` again — same instant the sweep starts
  //                   reaping it.
  //
  // The row is never written to. Revival remains the sweep guard's alone
  // (triage's ruling on this card: 复活机制仍唯一归 sweep guard,判断移到读侧,
  // 不新增生命周期动词).
  const isServableForDownload = async (file: FileRecord): Promise<boolean> => {
    if (file.status === 'committed') return true;
    if (file.status !== 'deleted' || !opts.resolveFileHolder) return false;
    try {
      return (await opts.resolveFileHolder(file)) !== null;
    } catch {
      // Unreadable evidence is not evidence of a holder. Refuse — the same
      // answer this route gave before #10246, and the same direction the reap
      // guard fails in (it vetoes rather than reaps when it cannot tell).
      return false;
    }
  };

  // ── Upload auth gate (#2755) ─────────────────────────────────────────
  // `false` ⇒ the 401 was already sent and the handler must stop.
  // `null` ⇒ open mode (no resolver wired) — proceed unauthenticated.
  let warnedOpenUploads = false;
  const requireUploadSession = async (
    req: IHttpRequest,
    res: IHttpResponse,
  ): Promise<StorageUploadSession | null | false> => {
    if (!opts.resolveSession) {
      if (!warnedOpenUploads) {
        warnedOpenUploads = true;
        opts.logger?.info(
          '[storage] no session resolver wired — upload routes accept anonymous requests (bare-kernel mode)',
        );
      }
      return null;
    }
    let session: StorageUploadSession | null | undefined;
    try {
      session = await opts.resolveSession(req);
    } catch {
      session = null;
    }
    if (!session?.userId) {
      sendError(res, 401, 'AUTH_REQUIRED', 'Authentication required to upload files');
      return false;
    }
    return session;
  };

  // ── Upload ownership gate (#22046, ruling B) ─────────────────────────
  // The commit, chunked-completion and progress doors act on an id the
  // caller NAMES. Each calls this right after its by-id read and before any
  // write or disclosure; `false` ⇒ the refusal was already sent and the
  // handler must stop. The rule itself is `isFileUploader`
  // (`upload-ownership.ts`) — the caller must be the file's uploader, an
  // empty owner and a missing file row are refused, no administrator
  // exception — and the answer is the same body whoever is refused.
  //
  // `authSession === null` is the OPEN mode `requireUploadSession` returns
  // when no session resolver is wired (bare kernels, tests): there is no
  // caller identity to compare, every upload in that mode lands with no
  // owner, and the routes stay open exactly as `resolveSession` declares.
  // Any wired resolver yields a session with a user id, and the rule then
  // applies without exception.
  const requireUploader = (
    authSession: StorageUploadSession | null,
    file: FileRecord | null,
    res: IHttpResponse,
  ): boolean => {
    if (authSession === null) return true;
    if (isFileUploader(authSession.userId, file)) return true;
    sendError(res, NOT_UPLOADER_STATUS, NOT_UPLOADER_CODE, NOT_UPLOADER_MESSAGE);
    return false;
  };

  // ── Starting-organization gate (#22175, #22218) ──────────────────────
  // The commit, chunked-completion and chunk doors write by id under the
  // ACTING organization (`StorageWriteContext`), and so does the progress
  // door's expiry stamp. On an engine-backed store that write is SCOPED to
  // it: the driver's statement reaches a row stamped for the acting
  // organization or for none, and no other. An uploader who switched their
  // active organization after starting an upload therefore names a row the
  // write cannot reach, and that scoped miss used to surface as `500
  // INTERNAL` carrying the store's outage text ("Restore the data engine…") —
  // an organization change diagnosed, to the caller and to the operator, as a
  // data-engine fault.
  //
  // Each door asks this right after the check that proves the caller may act
  // on the upload — the ownership rule, or on the chunk door the resume token
  // — so only that caller ever learns of it, and BEFORE its first write: the
  // expiry stamp, and on the chunk door the backend chunk as well. The
  // progress door asks only when the stamp is due, because a progress read
  // writes nothing else and has no reach to miss. `false` ⇒ the 409 was
  // already sent and the handler must stop.
  //
  // The question is the write's own reach and nothing wider, and the store
  // answers it (`organizationOutOfWriteReach`) for the write context the door
  // is about to pass: open mode and a session with no active organization
  // thread no scope; a row stamped with no organization stays in reach; the
  // engine-absent stand-in does not scope at all, so it never refuses here and
  // its answers are unchanged. Every row the door is about to write is asked —
  // the chunked door writes the upload session AND its file, and either one
  // out of reach means the write misses.
  //
  // ⛔ It changes nothing about where an upload belongs: it asks, it never
  // re-stamps, and the write context the doors pass is untouched — switching
  // back finishes the upload in the organization it was started in.
  // ⛔ It is not a `catch`: a real engine failure on a row in the caller's own
  // organization still reaches the door's outer `catch` and its `500`.
  const requireStartingOrganization = (
    writeContext: StorageWriteContext,
    rows: ReadonlyArray<{ organization_id?: string | null } | null>,
    door: string,
    upload: string,
    res: IHttpResponse,
  ): boolean => {
    for (const row of rows) {
      const started = organizationOutOfWriteReach(store, row, writeContext);
      if (started === null) continue;
      // The operator log names the cause — a `4xx` is otherwise quiet in the
      // server-fault log, which used to carry the misleading outage line.
      opts.logger?.warn(
        `[storage] ${door}: refused upload '${upload}' with ${ORGANIZATION_CHANGED_STATUS} ` +
          `${ORGANIZATION_CHANGED_CODE} — it was started in organization '${started}', and the ` +
          `uploader's active organization is now '${writeContext.organizationId}'. The door writes by ` +
          'id under the active organization, which cannot reach a row stamped for another one: an ' +
          `organization change, not a data-engine fault. Switching back to '${started}' finishes the upload.`,
      );
      sendError(res, ORGANIZATION_CHANGED_STATUS, ORGANIZATION_CHANGED_CODE, ORGANIZATION_CHANGED_MESSAGE);
      return false;
    }
    return true;
  };

  // ── Terminal upload-session statuses (#7667) ─────────────────────────────
  // `sys_upload_session.status` declares `failed` and `expired`, the retention
  // backstop reaps on them (`onlyWhen: { status: { $in: ['completed',
  // 'failed', 'expired'] } }`), and `UploadProgressSchema`
  // (packages/spec/src/api/storage.zod.ts) publishes both to every client that
  // reads the contract. Until #7667 NOTHING wrote either one — a declaration
  // with no producer, which ADR-0049 treats as enforce-or-remove. Both are
  // enforced here rather than removed, because the two failure states are real
  // and were previously invisible:
  //
  //  - `failed`: a completion whose backend `completeChunkedUpload` threw left
  //    the row at `completing` FOREVER. That is a non-terminal status, so the
  //    retention backstop never reaped it, and a progress poller read "still
  //    assembling" for a session that had already given up.
  //  - `expired`: a session past its own `expires_at` kept answering
  //    `in_progress` and kept accepting chunks, until the TTL sweep deleted the
  //    row out from under the caller — so the deadline the init response
  //    already announced (`expiresAt`) was advisory on the way in and abrupt on
  //    the way out.
  //
  // The reap guard (`createUploadSessionReapGuard`) already handled both — it
  // aborts the backend multipart for any non-`completed` row with a
  // `backend_upload_id` — so this closes the loop rather than opening one.

  /** Statuses no longer in flight — never re-statused by the expiry guard. */
  const TERMINAL_SESSION_STATUSES = new Set(['completed', 'failed', 'expired']);

  /**
   * Whether an in-flight session is past its own `expires_at`, so that the
   * `expired` stamp is due.
   *
   * A row with no `expires_at` (or an unparseable one) has no declared deadline
   * and is left alone: this enforces the deadline the session itself carries,
   * it does not invent one. Terminal rows are never due — a `completed` upload
   * does not become `expired` by sitting around.
   */
  const expiryStampDue = (session: UploadSessionRecord): boolean => {
    if (TERMINAL_SESSION_STATUSES.has(session.status)) return false;
    const deadline = session.expires_at ? Date.parse(session.expires_at) : NaN;
    return Number.isFinite(deadline) && deadline <= Date.now();
  };

  /**
   * Status the session `expired` — the write {@link expiryStampDue} says is
   * due — and hand back the row as it now stands.
   */
  const stampExpired = async (
    session: UploadSessionRecord,
    context?: StorageWriteContext,
  ): Promise<UploadSessionRecord> => {
    const updated = await store.updateSession(session.id, { status: 'expired' }, context);
    // `updateSession` answers null only when the row went away under us (the
    // TTL sweep, most likely) — the caller is refused either way.
    return updated ?? { ...session, status: 'expired' };
  };

  /**
   * Status an in-flight session `expired` once it is past its own `expires_at`,
   * and hand back the row as it now stands.
   */
  const expireIfPastDeadline = async (
    session: UploadSessionRecord,
    context?: StorageWriteContext,
  ): Promise<UploadSessionRecord> =>
    expiryStampDue(session) ? stampExpired(session, context) : session;

  /**
   * Best-effort `failed` stamp for a completion that threw.
   *
   * Deliberately swallowing-but-loud: the caller is already on its way to a
   * 500 carrying the REAL cause, and letting the status write replace that
   * cause would trade a diagnosable backend error for a metadata-store one.
   * The row staying at `completing` is the pre-#7667 behaviour, so the warn
   * names the consequence rather than pretending nothing happened.
   */
  const markSessionFailed = async (
    uploadId: string,
    context?: StorageWriteContext,
  ): Promise<void> => {
    try {
      await store.updateSession(uploadId, { status: 'failed' }, context);
    } catch (statusErr: any) {
      opts.logger?.warn(
        `[storage] upload session ${uploadId} failed to complete, and the 'failed' status could not be ` +
          `persisted (${statusErr?.message ?? statusErr}) — the row stays at 'completing', so the 7d ` +
          'retention backstop will not reap it and progress reads will overstate it. Restore the data ' +
          'engine; the reap guard still aborts the backend multipart when the TTL sweep reaches the row.',
      );
    }
  };

  // ---------------------------------------------------------------------------
  // POST /storage/upload/presigned
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/presigned`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const session = await requireUploadSession(req, res);
      if (session === false) return;
      const { filename, mimeType, size, scope, bucket } = req.body ?? {};
      if (!filename || !mimeType || size == null) {
        sendError(res, 400, 'INVALID_REQUEST', 'filename, mimeType, and size are required');
        return;
      }
      // [#22283] The declared size against the saved limit — before the
      // pending row and before any URL is minted. On the local adapter the
      // bytes are judged again at `_local/raw`; an S3 URL takes them straight
      // to the bucket, so this is the platform's one look at that upload.
      const { presignedTtl, maxUploadBytes } = currentLimits();
      if (!requireWithinUploadLimit(Number(size), maxUploadBytes, (n) => `The declared file size is ${n} bytes`, res)) return;

      const fileId = randomUUID();
      const key = buildKey(scope ?? 'user', fileId, filename);

      // Persist pending file record.
      //
      // [#12745] The acting organization travels with the write. It was
      // already in the caller's hand — `session` is read for `owner_id` on the
      // line below — and dropping it is what left every `sys_file` row NULL on
      // a tenancy-ENABLED object.
      await store.createFile(
        {
          id: fileId,
          key,
          name: filename,
          mime_type: mimeType,
          size,
          scope: scope ?? 'user',
          bucket,
          acl: 'private',
          status: 'pending',
          owner_id: session?.userId,
        },
        { organizationId: session?.organizationId },
      );

      // If adapter supports presigned upload, use it; otherwise build a local stub URL
      let uploadUrl: string;
      let method: 'PUT' | 'POST' = 'PUT';
      let headers: Record<string, string> = { 'content-type': mimeType };
      let expiresIn = presignedTtl;

      if (storage.getPresignedUpload) {
        const desc = await storage.getPresignedUpload(key, presignedTtl, { contentType: mimeType });
        uploadUrl = desc.uploadUrl;
        method = desc.method;
        if (desc.headers) headers = desc.headers;
        expiresIn = desc.expiresIn;
      } else {
        // Fallback — caller should PUT to the standard raw endpoint
        uploadUrl = `${basePath}/_local/raw/${fileId}`;
      }

      sendOk(res, {
        uploadUrl,
        method,
        headers,
        fileId,
        expiresIn,
        downloadUrl: `${basePath}/files/${fileId}/url`,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/complete
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/complete`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      // [commit f087c376f] Bound, not discarded: this handler already resolved the
      // session and threw the value away, which is what left the commit
      // statement unscoped and raising `[tenant-audit]`.
      const session = await requireUploadSession(req, res);
      if (session === false) return;
      const { fileId, eTag } = req.body ?? {};
      if (!fileId) {
        sendError(res, 400, 'INVALID_REQUEST', 'fileId is required');
        return;
      }

      const file = await store.getFile(fileId);
      if (!file) {
        sendError(res, 404, 'FILE_NOT_FOUND', 'File not found');
        return;
      }
      // [#22046] Only the uploader commits — before the write below and
      // before anything about the row is answered.
      if (!requireUploader(session, file, res)) return;
      // [#22175] …and only while the scoped write below can reach the row —
      // asked of the SAME write context that write is about to carry.
      const writeContext: StorageWriteContext = { organizationId: session?.organizationId };
      if (!requireStartingOrganization(writeContext, [file], 'commit', fileId, res)) return;

      const updated = await store.updateFile(
        fileId,
        {
          status: 'committed',
          etag: eTag ?? undefined,
        },
        writeContext,
      );

      sendOk(res, {
        // The opaque sys_file id — the value a file field stores as a
        // reference (ADR-0104 D3). Previously omitted, so a caller could not
        // learn the id to persist after committing an upload.
        fileId: updated!.id ?? fileId,
        path: updated!.key,
        name: updated!.name,
        size: updated!.size ?? 0,
        mimeType: updated!.mime_type ?? 'application/octet-stream',
        lastModified: updated!.updated_at ?? new Date().toISOString(),
        created: updated!.created_at ?? new Date().toISOString(),
        etag: updated!.etag,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/chunked
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/chunked`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const session = await requireUploadSession(req, res);
      if (session === false) return;
      const { filename, mimeType, totalSize, chunkSize: reqChunkSize, scope, bucket, metadata } = req.body ?? {};
      if (!filename || !mimeType || !totalSize) {
        sendError(res, 400, 'INVALID_REQUEST', 'filename, mimeType, and totalSize are required');
        return;
      }
      // [#22283] The declared total against the saved limit — before the file
      // row, the backend multipart and the session row. The chunk door judges
      // the bytes as they arrive.
      const { sessionTtl, maxUploadBytes } = currentLimits();
      if (!requireWithinUploadLimit(Number(totalSize), maxUploadBytes, (n) => `The declared total size is ${n} bytes`, res)) return;

      const chunkSize = Math.max(reqChunkSize ?? 5242880, 5242880);
      const totalChunks = Math.ceil(totalSize / chunkSize);

      const fileId = randomUUID();
      const key = buildKey(scope ?? 'user', fileId, filename);

      // Create pending file — same organization threading as the presigned
      // door above (#12745).
      await store.createFile(
        {
          id: fileId,
          key,
          name: filename,
          mime_type: mimeType,
          size: totalSize,
          scope: scope ?? 'user',
          bucket,
          acl: 'private',
          status: 'pending',
          metadata: metadata ? JSON.stringify(metadata) : undefined,
          owner_id: session?.userId,
        },
        { organizationId: session?.organizationId },
      );

      // Initiate chunked upload in backend
      let backendUploadId: string | undefined;
      if (storage.initiateChunkedUpload) {
        backendUploadId = await storage.initiateChunkedUpload(key, { contentType: mimeType, metadata });
        // S3 adapter needs to know the key for subsequent chunk/complete calls
        if ('setUploadKey' in storage && typeof (storage as any).setUploadKey === 'function') {
          (storage as any).setUploadKey(backendUploadId, key);
        }
      }

      const uploadId = backendUploadId ?? randomUUID().replace(/-/g, '');
      const resumeToken = randomUUID();
      const expiresAt = new Date(Date.now() + sessionTtl * 1000).toISOString();

      // The session row is stamped from the SAME session value the
      // `createFile` above already threads (#12928). `sys_upload_session` is a
      // tenancy-enabled object too, so an insert with no context lands
      // `organization_id` NULL — invisible to its own tenant under a walled
      // posture, since both walled Layer 0 predicates exclude NULL.
      await store.createSession(
        {
          id: uploadId,
          file_id: fileId,
          key,
          filename,
          mime_type: mimeType,
          total_size: totalSize,
          chunk_size: chunkSize,
          total_chunks: totalChunks,
          resume_token: resumeToken,
          backend_upload_id: backendUploadId,
          scope: scope ?? 'user',
          bucket,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
          status: 'in_progress',
          expires_at: expiresAt,
        },
        { organizationId: session?.organizationId },
      );

      sendOk(res, {
        uploadId,
        resumeToken,
        fileId,
        totalChunks,
        chunkSize,
        expiresAt,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /storage/upload/chunked/:uploadId/chunk/:chunkIndex
  // ---------------------------------------------------------------------------
  httpServer.put(`${basePath}/upload/chunked/:uploadId/chunk/:chunkIndex`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      // [commit f087c376f] Bound rather than discarded — see the commit door above.
      // Named `authSession` because `session` below is the sys_upload_session
      // ROW; these are two different things and the handler needs both.
      const authSession = await requireUploadSession(req, res);
      if (authSession === false) return;
      const writeContext: StorageWriteContext = { organizationId: authSession?.organizationId };
      const { uploadId, chunkIndex: chunkIndexStr } = req.params;
      const chunkIndex = parseInt(chunkIndexStr, 10);
      if (!uploadId || isNaN(chunkIndex)) {
        sendError(res, 400, 'INVALID_REQUEST', 'uploadId and chunkIndex are required');
        return;
      }

      const session = await store.getSession(uploadId);
      if (!session) {
        sendError(res, 404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
        return;
      }

      // Verify resume token
      const token = (req.headers['x-resume-token'] ?? '') as string;
      if (session.resume_token && token !== session.resume_token) {
        sendError(res, 403, 'INVALID_RESUME_TOKEN', 'Invalid resume token');
        return;
      }

      // [#22218] This door writes the session row — the expiry stamp below,
      // then the progress after the chunk — so that row must be in the scoped
      // writes' reach. Asked after the resume token, for the same reason the
      // expiry check is, and before the expiry stamp and the backend chunk, so
      // a refused chunk lands nowhere.
      if (!requireStartingOrganization(writeContext, [session], 'chunk', uploadId, res)) return;

      // Expiry is checked AFTER the resume token: a caller who cannot prove it
      // owns the session learns nothing about its state (#7667).
      const live = await expireIfPastDeadline(session, writeContext);
      if (live.status === 'expired') {
        sendError(
          res,
          410,
          'UPLOAD_SESSION_EXPIRED',
          `Upload session expired at ${live.expires_at}; start a new chunked upload`,
        );
        return;
      }

      // [#22283] The bytes received so far plus this chunk, against the saved
      // limit — the declared length first, so an oversized chunk is refused
      // before it is read, then the bytes actually read, before the backend
      // stores them and before the progress write. "So far" is what the
      // upload will hold: a RETRIED chunk index replaces its earlier bytes in
      // both backends, so those bytes are not counted twice (see
      // `bytesHeldByOtherChunks`).
      const { maxUploadBytes } = currentLimits();
      const currentParts: StoredChunkPart[] = JSON.parse(session.parts ?? '[]');
      const receivedSoFar = bytesHeldByOtherChunks(currentParts, chunkIndex, session.uploaded_size ?? 0);
      const reaches = (n: number) => `This chunk would bring the upload to ${n} bytes`;
      const declaredChunk = declaredContentLength(req);
      if (declaredChunk !== undefined && !requireWithinUploadLimit(receivedSoFar + declaredChunk, maxUploadBytes, reaches, res)) return;

      // Get raw body (binary data)
      let data: Buffer;
      if (req.rawBody) {
        data = await req.rawBody();
      } else if (Buffer.isBuffer(req.body)) {
        data = req.body;
      } else if (req.body instanceof ArrayBuffer) {
        data = Buffer.from(req.body);
      } else {
        sendError(res, 400, 'INVALID_REQUEST', 'Binary body required');
        return;
      }
      if (!requireWithinUploadLimit(receivedSoFar + data.byteLength, maxUploadBytes, reaches, res)) return;

      // Upload the chunk (S3 uses 1-based part numbers)
      let eTag = '';
      if (storage.uploadChunk) {
        eTag = await storage.uploadChunk(uploadId, chunkIndex + 1, data);
      }

      // Update session progress — each part records its size (#22283), so
      // the limit above can tell a retried chunk from a new one. [#22313] A
      // chunk index sent again REPLACES its slot in the record, exactly as it
      // replaces its bytes in the backend, so a retry is counted once in
      // `uploaded_chunks` and `uploaded_size` — the counts `resumeUpload`
      // resumes from (see `recordChunk`).
      //
      // [#22332] The record is merged from the row this door READ, so it is
      // written only while the row still holds that progress: a chunk PUT
      // running alongside this one may have recorded its part in between, and
      // an unconditional write erased it — both answered `200` and the upload
      // held one chunk. When the write does not land, the door re-reads the
      // row and merges again, up to CHUNK_RECORD_ATTEMPTS.
      const part = { chunkIndex, eTag, size: data.byteLength };
      let seen = session;
      let parts = currentParts;
      for (let attempt = 1; ; attempt++) {
        const progress = recordChunk(parts, part, seen.uploaded_size ?? 0);
        const landed = await updateSessionProgressIfUnchanged(
          store,
          uploadId,
          seen,
          {
            uploaded_chunks: progress.uploadedChunks,
            uploaded_size: progress.uploadedSize,
            parts: JSON.stringify(progress.parts),
          },
          writeContext,
        );
        if (landed) break;
        if (attempt >= CHUNK_RECORD_ATTEMPTS) {
          sendError(
            res,
            CHUNK_NOT_RECORDED_STATUS,
            CHUNK_NOT_RECORDED_CODE,
            `Chunk ${chunkIndex} was stored, but recording it in the upload's progress lost to another write on each of ` +
              `${CHUNK_RECORD_ATTEMPTS} attempts, so the upload does not hold it: send this chunk again.`,
            { details: { chunkIndex, attempts: CHUNK_RECORD_ATTEMPTS } },
          );
          return;
        }
        const fresh = await store.getSession(uploadId);
        if (!fresh) {
          sendError(res, 404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
          return;
        }
        // A write that did not land on a row still holding the progress it
        // was conditioned on lost to no other write: it cannot reach the row.
        // Trying again would answer the same, and a `409` would tell the
        // uploader to retry what cannot succeed.
        if (sameProgress(fresh, seen)) {
          throw new Error(
            `Chunk ${chunkIndex} was stored, but its progress write to upload session '${uploadId}' matched no row ` +
              'although the row still holds the progress the write was conditioned on: the write cannot reach the ' +
              'row, and the upload does not hold the chunk.',
          );
        }
        seen = fresh;
        parts = JSON.parse(fresh.parts ?? '[]');
      }

      sendOk(res, {
        chunkIndex,
        eTag,
        bytesReceived: data.byteLength,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/chunked/:uploadId/complete
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/chunked/:uploadId/complete`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      // [commit f087c376f] Bound rather than discarded — see the commit door above.
      const authSession = await requireUploadSession(req, res);
      if (authSession === false) return;
      const writeContext: StorageWriteContext = { organizationId: authSession?.organizationId };
      const { uploadId } = req.params;
      const session = await store.getSession(uploadId);
      if (!session) {
        sendError(res, 404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
        return;
      }
      // [#22046] The session row names no user; it reaches its uploader
      // through `file_id`. Asked before the expiry stamp, the status writes
      // and the completion answer below.
      const file = await store.getFile(session.file_id);
      if (!requireUploader(authSession, file, res)) return;
      // [#22175] Both rows this door writes must be in the scoped writes'
      // reach — asked before the expiry stamp, which is the first of them.
      if (!requireStartingOrganization(writeContext, [session, file], 'chunked completion', uploadId, res)) return;

      const live = await expireIfPastDeadline(session, writeContext);
      if (live.status === 'expired') {
        sendError(
          res,
          410,
          'UPLOAD_SESSION_EXPIRED',
          `Upload session expired at ${live.expires_at}; start a new chunked upload`,
        );
        return;
      }

      // [#22313] The server is the guard, whatever the client lists. The
      // backend assembles the parts the SESSION holds — its own record of
      // every chunk the chunk door stored, with the eTag the backend answered
      // for it — never the request's list: a resuming client lists only the
      // chunks its own pass sent, and assembling that list completed a short
      // file with a `200`. The list is CHECKED against the record (a listed
      // chunk the upload does not hold, or holds with another eTag, is
      // refused), and the record against the declared size. Asked after the
      // expiry check and before the `completing` write, so a refused upload is
      // left in flight to be finished.
      const listed = listedParts(req.body?.parts);
      if (listed === null) {
        sendError(
          res,
          400,
          'INVALID_REQUEST',
          'parts must be an array of { chunkIndex, eTag } entries: chunkIndex a whole number, eTag the string the chunk upload answered',
        );
        return;
      }
      const verdict = judgeCompletion(session, listed);
      if (!verdict.ok) {
        sendError(res, INCOMPLETE_UPLOAD_STATUS, INCOMPLETE_UPLOAD_CODE, verdict.message, { details: verdict.details });
        return;
      }

      await store.updateSession(uploadId, { status: 'completing' }, writeContext);

      const partsForBackend = verdict.parts.map(p => ({
        partNumber: p.chunkIndex + 1,
        eTag: p.eTag,
      }));

      let finalKey = session.key;
      try {
        if (storage.completeChunkedUpload) {
          finalKey = await storage.completeChunkedUpload(uploadId, partsForBackend);
        }

        // Update file + session
        await store.updateFile(
          session.file_id,
          { status: 'committed', key: finalKey },
          writeContext,
        );
        await store.updateSession(uploadId, { status: 'completed' }, writeContext);
      } catch (completionErr) {
        // Terminal for THIS attempt, not a lock: nothing here reads `failed` as
        // a refusal, so a client that retries the same uploadId after a
        // transient backend blip runs the happy path again and overwrites it
        // with `completed`. What the stamp buys is that an attempt which is
        // NOT retried stops claiming to be in flight (#7667).
        await markSessionFailed(uploadId, writeContext);
        throw completionErr;
      }

      sendOk(res, {
        fileId: session.file_id,
        key: finalKey,
        size: session.total_size,
        mimeType: session.mime_type ?? 'application/octet-stream',
        url: `${basePath}/files/${session.file_id}/url`,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/upload/chunked/:uploadId/progress
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/upload/chunked/:uploadId/progress`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      // [commit f087c376f] Bound rather than discarded — the progress door can WRITE
      // (`expireIfPastDeadline` statuses the row `expired`), so it owes the
      // same context the other two write doors do.
      const authSession = await requireUploadSession(req, res);
      if (authSession === false) return;
      const writeContext: StorageWriteContext = { organizationId: authSession?.organizationId };
      const { uploadId } = req.params;
      const stored = await store.getSession(uploadId);
      if (!stored) {
        sendError(res, 404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
        return;
      }
      // [#22046] Same rule, same place: after the by-id read, before the
      // expiry write below and before the progress answer discloses the row.
      if (!requireUploader(authSession, await store.getFile(stored.file_id), res)) return;

      // [#22218] The expiry stamp is this door's only write, so the session
      // row must be in its reach only when the stamp is due. A read with
      // nothing to stamp has no reach to miss, and keeps answering the
      // uploader from any organization. Decided ONCE, so the question and the
      // stamp cannot disagree about the deadline.
      const due = expiryStampDue(stored);
      if (due && !requireStartingOrganization(writeContext, [stored], 'progress', uploadId, res)) return;

      // Progress REPORTS the expiry rather than refusing it: `expired` is a
      // declared member of `UploadProgressSchema.status`, and a resuming client
      // (the SDK's `resumeUpload` polls this first) needs to be told the
      // session is gone, not handed a 410 it has to interpret (#7667).
      const session = due ? await stampExpired(stored, writeContext) : stored;

      const uploadedChunks = session.uploaded_chunks ?? 0;
      const uploadedSize = session.uploaded_size ?? 0;
      const percentComplete = session.total_size > 0
        ? Math.min(100, Math.round((uploadedSize / session.total_size) * 100))
        : 0;

      sendOk(res, {
        uploadId: session.id,
        fileId: session.file_id,
        filename: session.filename,
        totalSize: session.total_size,
        uploadedSize,
        totalChunks: session.total_chunks,
        uploadedChunks,
        percentComplete,
        status: session.status,
        startedAt: session.started_at,
        expiresAt: session.expires_at,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/files/:fileId/url
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/files/:fileId/url`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { fileId } = req.params;
      const file = await store.getFile(fileId);
      if (!file || !(await isServableForDownload(file))) {
        sendError(res, 404, 'FILE_NOT_FOUND', 'File not found or not downloadable');
        return;
      }

      const ttl = await authorizeDownload(file, req, res);
      if (ttl === false) return;

      const downloadOpts = { filename: file.name, contentType: file.mime_type };
      let url: string;
      if (storage.getPresignedDownload) {
        const desc = await storage.getPresignedDownload(file.key, ttl, downloadOpts);
        url = desc.downloadUrl;
      } else if (storage.getSignedUrl) {
        url = await storage.getSignedUrl(file.key, ttl, downloadOpts);
      } else {
        // See the sibling branch on `GET /files/:fileId`: no adapter capability
        // means no download URL, and handing back an unmounted one is worse
        // than admitting it (#3641).
        sendError(res, 501, 'NOT_IMPLEMENTED', 'This storage adapter cannot issue download URLs');
        return;
      }

      // `{ success: true, data: { url } }` since #3689 — this route used to
      // answer a bare `{ url }`, the one success body on the surface that
      // carried no envelope at all.
      sendOk(res, { url });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/files/:fileId — stable redirect to the actual bytes.
  //
  // Frontend widgets (`ImageField`, `<img src>`, user avatars, org logos)
  // need a URL that:
  //   - is stable (won't expire — records may live for years)
  //   - serves the bytes directly when followed
  // The `/url` endpoint above returns JSON. This sibling endpoint resolves
  // to the same short-lived signed URL and 302-redirects so it can be used
  // verbatim in any browser context.
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/files/:fileId`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { fileId } = req.params;
      const file = await store.getFile(fileId);
      if (!file || !(await isServableForDownload(file))) {
        sendError(res, 404, 'FILE_NOT_FOUND', 'File not found or not downloadable');
        return;
      }

      const ttl = await authorizeDownload(file, req, res);
      if (ttl === false) return;

      const downloadOpts = { filename: file.name, contentType: file.mime_type };
      let url: string;
      if (storage.getPresignedDownload) {
        const desc = await storage.getPresignedDownload(file.key, ttl, downloadOpts);
        url = desc.downloadUrl;
      } else if (storage.getSignedUrl) {
        url = await storage.getSignedUrl(file.key, ttl, downloadOpts);
      } else {
        // An adapter with neither `getPresignedDownload` nor `getSignedUrl`
        // cannot produce a download URL. This used to redirect to
        // `${basePath}/_local/file/<key>`, which no registrar mounts — a 302
        // straight into a 404 (#3641). Say so instead: the caller learns the
        // adapter is the limitation, rather than chasing a broken link.
        sendError(res, 501, 'NOT_IMPLEMENTED', 'This storage adapter cannot issue download URLs');
        return;
      }

      res.status(302).header('Location', url).send('');
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /storage/_local/raw/:token — presigned raw upload (LocalStorageAdapter)
  // ---------------------------------------------------------------------------
  httpServer.put(`${basePath}/_local/raw/:token`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { token } = req.params;
      const localAdapter = storage as LocalStorageAdapter;
      if (!localAdapter.verifyToken) {
        sendError(res, 501, 'NOT_IMPLEMENTED', 'Presigned raw upload not supported by this adapter');
        return;
      }

      const payload = localAdapter.verifyToken(token, 'put');
      // [#22283] The local adapter's byte door for a presigned upload: the
      // declared length first, so an oversized body is refused before it is
      // read, then the bytes actually read — before `upload` stores them.
      // Judged against the limit in force NOW, whatever the URL was minted under.
      const { maxUploadBytes } = currentLimits();
      const bodyIs = (n: number) => `The upload body is ${n} bytes`;
      const declaredBody = declaredContentLength(req);
      if (declaredBody !== undefined && !requireWithinUploadLimit(declaredBody, maxUploadBytes, bodyIs, res)) return;
      let data: Buffer;
      if (req.rawBody) {
        data = await req.rawBody();
      } else if (Buffer.isBuffer(req.body)) {
        data = req.body;
      } else {
        sendError(res, 400, 'INVALID_REQUEST', 'Binary body required');
        return;
      }
      if (!requireWithinUploadLimit(data.byteLength, maxUploadBytes, bodyIs, res)) return;

      await storage.upload(payload.k, data, { contentType: payload.ct });
      // `{ ok: true, key }` until #3689. `ok` was a second, private word for
      // `success` on a route that is mounted under `/api/v1/storage` like any
      // other; the envelope now says it once. Nothing reads this body — the
      // SDK and the console both PUT here opaquely, exactly as they would an
      // S3 presigned URL, and check only the status — so the move is
      // observable to conformance tests and to curl, not to a caller.
      sendOk(res, { key: payload.k });
    } catch (err: any) {
      const invalidToken = err?.message?.includes('expired') || err?.message?.includes('signature');
      sendError(
        res,
        invalidToken ? 403 : 500,
        invalidToken ? 'INVALID_TOKEN' : 'INTERNAL',
        err?.message ?? 'Upload failed',
      );
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/_local/raw/:token — presigned raw download (LocalStorageAdapter)
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/_local/raw/:token`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { token } = req.params;
      const localAdapter = storage as LocalStorageAdapter;
      if (!localAdapter.verifyToken) {
        sendError(res, 501, 'NOT_IMPLEMENTED', 'Presigned download not supported by this adapter');
        return;
      }

      const payload = localAdapter.verifyToken(token, 'get');
      const data = await storage.download(payload.k);

      res.header('content-type', payload.ct ?? 'application/octet-stream');
      res.header('content-length', String(data.byteLength));
      // When the token carries the original filename, advertise it so the
      // browser saves the file under its real name (not the opaque URL token).
      if (payload.n) {
        res.header('content-disposition', contentDispositionValue(payload.n, payload.d ?? 'inline'));
      }
      res.send(data);
    } catch (err: any) {
      const invalidToken = err?.message?.includes('expired') || err?.message?.includes('signature');
      sendError(
        res,
        invalidToken ? 403 : 500,
        invalidToken ? 'INVALID_TOKEN' : 'INTERNAL',
        err?.message ?? 'Download failed',
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One entry of `sys_upload_session.parts`. `size` is recorded since #22283; rows written before it lack it. */
interface StoredChunkPart {
  chunkIndex: number;
  eTag: string;
  size?: number;
}

/**
 * [#22283] The bytes the upload holds in chunks OTHER than `chunkIndex` —
 * what the chunk door adds this chunk to before judging the limit.
 *
 * A chunk index sent again REPLACES its earlier bytes (the local adapter
 * rewrites `.parts/UPLOAD/INDEX`, S3 overwrites the part number), so a
 * client retrying a chunk whose answer it lost must not be judged as if the
 * upload held both copies. The latest size per index counts, and the index
 * being written now counts as this chunk alone.
 *
 * A session whose parts predate the recorded `size` (started before this
 * change, still inside its TTL) has no per-chunk sizes to sum, so it is judged
 * by its running `uploaded_size` — the upper bound the bytes cannot exceed.
 * That side refuses a retry near the limit rather than admitting an upload
 * over it, and it ends with that session.
 */
function bytesHeldByOtherChunks(parts: ReadonlyArray<StoredChunkPart>, chunkIndex: number, uploadedSize: number): number {
  if (parts.some((p) => typeof p.size !== 'number')) return uploadedSize;
  const latest = new Map<number, number>();
  for (const p of parts) latest.set(p.chunkIndex, p.size as number);
  latest.delete(chunkIndex);
  let held = 0;
  for (const size of latest.values()) held += size;
  return held;
}

/**
 * [#22313] The parts the upload HOLDS: one per chunk index, the latest entry
 * the record carries for it. A record written before #22313 can list an index
 * more than once (the chunk door appended every send); the later entry is the
 * one whose bytes the backend holds.
 */
function heldPartsByIndex(parts: ReadonlyArray<StoredChunkPart>): Map<number, StoredChunkPart> {
  const held = new Map<number, StoredChunkPart>();
  for (const p of parts) held.set(p.chunkIndex, p);
  return held;
}

/**
 * [#22313] The session's record and progress once the chunk door has stored
 * `part`. The chunk's index REPLACES its slot — the backend replaced its bytes
 * — so `uploadedChunks` is the number of distinct chunks held and a re-sent
 * chunk leaves both counts where they were.
 *
 * `uploadedSize` is the sum of the latest size per chunk. A session whose
 * record still carries a part with no size (started before #22283, still
 * inside its TTL) has no per-chunk sizes to sum, so it keeps its running total,
 * as {@link bytesHeldByOtherChunks} judges it — an upper bound that ends with
 * that session.
 */
function recordChunk(
  parts: ReadonlyArray<StoredChunkPart>,
  part: StoredChunkPart & { size: number },
  runningTotal: number,
): { parts: StoredChunkPart[]; uploadedChunks: number; uploadedSize: number } {
  const held = heldPartsByIndex(parts);
  held.set(part.chunkIndex, part);
  const next = [...held.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const sized = next.every((p) => typeof p.size === 'number');
  return {
    parts: next,
    uploadedChunks: next.length,
    uploadedSize: sized ? next.reduce((sum, p) => sum + (p.size as number), 0) : runningTotal + part.size,
  };
}

/**
 * [#22332] Whether two reads of one session row hold the same progress — the
 * three columns the chunk door's conditional write is compared on.
 */
function sameProgress(a: UploadSessionRecord, b: UploadSessionRecord): boolean {
  return (
    (a.parts ?? null) === (b.parts ?? null) &&
    (a.uploaded_chunks ?? null) === (b.uploaded_chunks ?? null) &&
    (a.uploaded_size ?? null) === (b.uploaded_size ?? null)
  );
}

/** One entry of a completion request's `parts` list. */
interface ListedPart {
  chunkIndex: number;
  eTag: string;
}

/**
 * [#22313] The completion request's `parts`, or `null` when it is not a list
 * of `{ chunkIndex, eTag }` — an entry the door cannot read is an entry it
 * cannot check. An absent list is an empty one, as it always was.
 */
function listedParts(raw: unknown): ListedPart[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  for (const p of raw) {
    if (!p || typeof p !== 'object') return null;
    const { chunkIndex, eTag } = p as Record<string, unknown>;
    if (!Number.isInteger(chunkIndex) || typeof eTag !== 'string') return null;
  }
  return raw as ListedPart[];
}

/** What the completion door's refusal carries in `error.details` — chunk indexes are zero-based. */
interface IncompleteUploadDetails {
  /** The chunk count the upload declared at its start. */
  totalChunks: number;
  /** The byte count the upload declared at its start. */
  totalSize: number;
  /**
   * The bytes the chunks it holds come to — or, for a session whose record
   * predates per-chunk sizes, its running total, which they cannot exceed.
   */
  heldBytes: number;
  /** Declared chunks the upload does not hold: send these. */
  missingChunks: number[];
  /** Chunks the upload holds beyond its declared count. */
  unexpectedChunks: number[];
  /** Chunks the request lists that the upload does not hold. */
  unheldListedChunks: number[];
  /** Chunks the request lists with an eTag other than the one the upload holds for them. */
  mismatchedChunks: number[];
}

type CompletionVerdict =
  | { ok: true; parts: StoredChunkPart[] }
  | { ok: false; message: string; details: IncompleteUploadDetails };

const chunkList = (indexes: ReadonlyArray<number>): string =>
  `${indexes.length === 1 ? 'chunk' : 'chunks'} ${indexes.join(', ')}`;

/**
 * [#22313] Whether the chunked-completion door may assemble this upload, and
 * from which parts.
 *
 * The parts are the session's OWN record — every chunk the chunk door stored,
 * with the eTag the backend answered for it, which is all a backend needs to
 * assemble (S3's `CompleteMultipartUpload` takes part numbers and those eTags;
 * the local adapter reads the part files by number). The request's list is
 * checked against that record and never replaces it: it may omit a chunk the
 * upload holds (a resuming client lists only what its own pass sent), and it
 * may not name a chunk the upload does not hold, or name one with another
 * eTag.
 *
 * The record is then checked against what the upload declared: every chunk
 * index from 0 to `total_chunks - 1`, none beyond it, and sizes adding up to
 * `total_size` exactly. A session whose record predates per-chunk sizes is
 * judged by its running `uploaded_size`, an upper bound: below the declared
 * total it is certainly short.
 */
function judgeCompletion(session: UploadSessionRecord, listed: ReadonlyArray<ListedPart>): CompletionVerdict {
  const held = heldPartsByIndex(JSON.parse(session.parts ?? '[]') as StoredChunkPart[]);
  const totalChunks = Number(session.total_chunks);
  const totalSize = Number(session.total_size);

  const missingChunks: number[] = [];
  for (let i = 0; i < totalChunks; i++) if (!held.has(i)) missingChunks.push(i);
  const unexpectedChunks = [...held.keys()].filter((i) => !(i >= 0 && i < totalChunks)).sort((a, b) => a - b);

  const unheld = new Set<number>();
  const mismatched = new Set<number>();
  for (const p of listed) {
    const holding = held.get(p.chunkIndex);
    if (!holding) unheld.add(p.chunkIndex);
    else if (holding.eTag !== p.eTag) mismatched.add(p.chunkIndex);
  }
  const unheldListedChunks = [...unheld].sort((a, b) => a - b);
  const mismatchedChunks = [...mismatched].sort((a, b) => a - b);

  const parts = [...held.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const sized = parts.every((p) => typeof p.size === 'number');
  const heldBytes = sized ? parts.reduce((sum, p) => sum + (p.size as number), 0) : Number(session.uploaded_size ?? 0);
  const sizeAgrees = sized ? heldBytes === totalSize : heldBytes >= totalSize;

  const clauses: string[] = [];
  if (missingChunks.length > 0) {
    clauses.push(
      `It does not hold ${chunkList(missingChunks)} of the ${totalChunks} it declared (indexes are zero-based): ` +
        'upload the missing chunks, then complete again.',
    );
  }
  if (unexpectedChunks.length > 0) {
    clauses.push(`It holds ${chunkList(unexpectedChunks)}, beyond the ${totalChunks} it declared.`);
  }
  if (!sizeAgrees && missingChunks.length === 0 && unexpectedChunks.length === 0) {
    clauses.push(
      sized
        ? `The chunks it holds come to ${heldBytes} bytes, not the ${totalSize} bytes it declared.`
        : `The chunks it holds come to at most ${heldBytes} bytes, short of the ${totalSize} bytes it declared.`,
    );
  }
  if (unheldListedChunks.length > 0) {
    clauses.push(`The request lists ${chunkList(unheldListedChunks)}, which this upload does not hold.`);
  }
  if (mismatchedChunks.length > 0) {
    clauses.push(
      `The request lists ${chunkList(mismatchedChunks)} with an eTag other than the one this upload holds: ` +
        'list the eTag the last upload of that chunk answered, or upload it again.',
    );
  }
  if (clauses.length === 0 && sizeAgrees) return { ok: true, parts };

  return {
    ok: false,
    message: `This chunked upload cannot be completed. ${clauses.join(' ')} Nothing was assembled; the upload stays open until it expires.`,
    details: {
      totalChunks,
      totalSize,
      heldBytes,
      missingChunks,
      unexpectedChunks,
      unheldListedChunks,
      mismatchedChunks,
    },
  };
}

function buildKey(scope: string, fileId: string, filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
  return `${scope}/${fileId}${ext}`;
}

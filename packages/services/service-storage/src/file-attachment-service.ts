// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';
import type {
  ISecurityService,
  AttachFileInput,
  AttachedFile,
  IDataEngine,
  IFileAttachmentService,
  IObjectQLEngine,
  IStorageService,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
// The one reference this verb's caller-scoped insert vouches for: the file it
// created in the same call (see step ⑤).
import { vouchForReference } from '@objectstack/core';
import { StorageMetadataStore, organizationOutOfWriteReach, type StorageWriteContext } from './metadata-store.js';
// The upload ownership rule, asked of the upload the attach-on-commit verb
// names — the commit door's own rule and its one refusal.
import { isFileUploader, NOT_UPLOADER_CODE, NOT_UPLOADER_MESSAGE, NOT_UPLOADER_STATUS } from './upload-ownership.js';
// The one definition of "is anything holding this file?" — the reap guard's —
// asked so the attach-on-commit verb vouches only for an upload nothing holds.
import { findFileHolder } from './attachment-lifecycle.js';
// The attach rule's one verdict (parent EDIT), asked here before a producer
// spends work on a file it could not attach.
import {
  mayEditAttachmentParent,
  type AttachmentSecurityLike,
  type AttachmentSharingLike,
} from './attachment-access-hooks.js';
// The package's one answer to "which organization is this record walled
// into?", read off the registered schema — never a hard-coded column.
import { createWallOrganizationResolver } from './backfill-sys-file-organizations.js';
// The upload doors' own size verdict and refusal, asked here rather than
// restated.
import {
  resolveStorageLimits,
  uploadSizeRefusal,
  UPLOAD_TOO_LARGE_CODE,
  UPLOAD_TOO_LARGE_STATUS,
  type StorageLimitsSnapshot,
} from './storage-limits.js';
// The upload doors' own storage-key layout, and the commit door's question
// of whether the backend holds an upload's bytes.
import { buildKey, heldBytesRefusal } from './storage-routes.js';

/**
 * [#23306] The server-side attach verb — `IFileAttachmentService`, registered
 * by `StorageServicePlugin` under `FILE_ATTACHMENT_SERVICE`
 * (`@objectstack/spec/contracts`): store bytes, and attach them to a record as
 * one `sys_file` row and one `sys_attachment` row.
 *
 * ## One writer — what it runs, and where each check comes from
 *
 * A server-side producer (inbound mail first, then imports and generated
 * output) has no browser upload in front of it, so this verb acts as the
 * SYSTEM. It restates no check; each one is the code every other attachment of
 * the parent already meets:
 *
 *  - **Size.** `uploadSizeRefusal` (`storage-limits.ts`), the verdict the REST
 *    upload doors ask before they store a byte, against the same resolved
 *    `max_upload_mb` (`resolveStorageLimits` over the `storage` service's
 *    Limits snapshot). Refused `413 PAYLOAD_TOO_LARGE`, with the doors' own
 *    sentence, before anything is stored.
 *  - **The `sys_file` row.** `StorageMetadataStore` — the upload doors' writer,
 *    carrying the organization through the same `StorageWriteContext` channel,
 *    so the driver stamps it exactly as it stamps an upload.
 *  - **The `sys_attachment` row.** A data-engine insert, so every gate the
 *    engine runs on a `sys_attachment` insert judges it — the gate's decision,
 *    never a copy of it here. Measured under this verb's system context:
 *    `plugin-audit`'s `enable.files` gate runs and refuses `403
 *    FILES_DISABLED` for a parent object without the opt-in; the attachment
 *    lifecycle hooks run; the parent-EDIT gate
 *    (`installAttachmentAccessHooks`) returns at its system-context line by its
 *    own declared design — there is no caller whose edit access to the parent
 *    could be asked.
 *  - **The organization.** The parent is read by id as the system, and its
 *    organization comes from `createWallOrganizationResolver` — the column the
 *    parent is WALLED by. A parent walled into another organization than the
 *    caller's is refused `404 RECORD_NOT_FOUND`, exactly like a parent that
 *    does not exist, so the answer says nothing about the other organization.
 *    Both rows are then written in the parent's organization (or the caller's,
 *    for a global parent), so the file sits behind the same wall as the record
 *    it is attached to.
 *
 * ## No refusal leaves a committed `sys_file`
 *
 * The write order is the presigned upload door's: the `sys_file` row first,
 * `pending`, then the bytes — so the row is always the pointer the platform's
 * pending-upload retention (`sys_file`'s `retention` on `status: 'pending'`,
 * and the reap guard that deletes a pending row's bytes) can reclaim both by,
 * even if the process dies mid-call. The row turns `committed` only in the SAME
 * engine transaction as the `sys_attachment` insert, so a refused insert rolls
 * the commit back with it; on an engine that offers no transaction the commit
 * simply never runs after a refused insert. Every refusal then removes the
 * bytes and the pending row before it rethrows, unchanged.
 */

/**
 * The data-engine surface this verb uses: the reads and writes every engine
 * has, plus — where the engine offers one — its transaction and its schema
 * read (the wall resolver's input).
 */
export type FileAttachmentEngine = IDataEngine &
  Partial<Pick<IObjectQLEngine, 'transaction'>> & {
    getSchema?(objectName: string): unknown;
  };

/** What {@link FileAttachmentService} is composed over — each read at call time. */
export interface FileAttachmentServiceDeps {
  /**
   * The data engine, once every plugin has installed its `sys_attachment`
   * gates on it (armed at `kernel:bootstrapped`). `null` before that, or when
   * no engine is wired: the verb then refuses rather than write rows a gate has
   * not judged.
   */
  getEngine(): FileAttachmentEngine | null;
  /** The `storage` service the bytes go to. */
  getStorage(): IStorageService | null;
  /** The `storage` namespace's Limits group as last read — the upload doors' own source. */
  getLimitsSnapshot(): StorageLimitsSnapshot | undefined;
  logger: { warn(message: string): void; debug?(message: string): void };
  /** The sharing service, for the attach rule's verdict ({@link FileAttachmentService.assertMayAttach}). */
  getSharing?(): AttachmentSharingLike | null | undefined;
  /**
   * The security service: the attach rule's master-detail check, and `explain`
   * for whether the caller may create an attachment at all.
   */
  getSecurity?(): (AttachmentSecurityLike & Partial<Pick<ISecurityService, 'explain'>>) | null | undefined;
}

/**
 * The caller-scoped face of the `file-attachments` service: the same one
 * writer, run AS THE REQUESTING USER instead of as the system. A package-local
 * contract of `@objectstack/service-storage`, reached through the same
 * `FILE_ATTACHMENT_SERVICE` slot (the registered service implements both).
 *
 * For a producer acting for a signed-in user (a record printed to a PDF): the
 * parent is read as the caller, the `sys_attachment` insert runs under the
 * caller's context — so every gate on it judges the caller (the parent-EDIT
 * attach rule, the `enable.files` opt-in) and it is stamped `uploaded_by` the
 * caller — and the `sys_file` row is owned by the caller.
 */
export interface ICallerFileAttachmentService {
  /**
   * Refuse, with the answer the `sys_attachment` insert would give, unless
   * `context` may attach a file to the record — with no write, for a producer
   * to refuse before it spends work on the file. Two questions, each the
   * insert's own: may the caller create an attachment at all (the CRUD
   * middleware's verdict, asked through `ISecurityService.explain`;
   * `PERMISSION_DENIED` / `403`), and does the attach rule admit them (parent
   * EDIT, the insert gate's verdict; `ATTACHMENT_PARENT_ACCESS` / `403`).
   */
  assertMayAttach(parentObject: string, parentId: string, context: ExecutionContext): Promise<void>;
  /**
   * {@link IFileAttachmentService.attachFile}, as `context`'s user. Refuses as
   * `attachFile` does, plus: an `organizationId` other than the caller's own
   * (the context's `tenantId`, or `null` when it names none) answers
   * `PERMISSION_DENIED` / `403`; a parent the caller cannot read answers
   * `RECORD_NOT_FOUND` / `404`, and the attach rule's refusal
   * (`ATTACHMENT_PARENT_ACCESS` / `403`) is the insert gate's own. A context
   * without a user, or the system context, is refused `PERMISSION_DENIED` /
   * `403`: the system has `attachFile`.
   */
  attachFileAs(input: AttachFileInput, context: ExecutionContext): Promise<AttachedFile>;
  /**
   * Attach the caller's own browser upload to a record, and commit it, in one
   * unit, as `context`'s user: the attach verb of the record attachments
   * surface, asked by the upload-complete door when its request carries
   * `attachTo` (`POST /api/v1/storage/upload/complete`).
   *
   * The file must be the upload the caller is completing: a `sys_file` row
   * whose `owner_id` is the caller (the upload doors stamp it from the
   * session), still `pending`, in the `attachments` scope, in the caller's
   * organization, held by nothing yet (no `sys_attachment` names it and no
   * record field owns it — `findFileHolder`), with its bytes held by the
   * storage backend. That is the whole premise of the vouch: the one file this
   * call turns from the caller's unattached upload into an attachment, and
   * nothing else. Any other id —
   * another user's upload, an id that names no file — is refused with the
   * upload ownership rule's one answer (`PERMISSION_DENIED` / `403`, the same
   * body for both); a committed or already-held file `RESOURCE_CONFLICT` /
   * `409`; another scope `INVALID_REQUEST` / `400`.
   *
   * Then the attach authorization, before any write: {@link assertMayAttach}
   * (the permission to create an attachment, and the parent-EDIT attach rule),
   * and the parent read as the caller (`RECORD_NOT_FOUND` / `404`, as
   * {@link attachFileAs} answers). The `sys_attachment` insert runs as the
   * caller, so every gate on it judges the caller, and it vouches for this
   * one file id and for nothing else (`vouchForReference`, `@objectstack/core`).
   * A refusal leaves the upload `pending`, its bytes stored, and no attachment.
   */
  attachUploadAs(input: AttachUploadInput, context: ExecutionContext): Promise<AttachedFile>;
}

/** What {@link ICallerFileAttachmentService.attachUploadAs} attaches: an upload, and the record it is attached to. */
export interface AttachUploadInput {
  /** The `sys_file` id the upload-start door returned to the caller. */
  fileId: string;
  /** The object of the record the file is attached to. */
  parentObject: string;
  /** The id of the record the file is attached to. */
  parentId: string;
  /** The ETag the client reports for the uploaded bytes, stored on the file as the commit door stores it. */
  eTag?: string;
}

/** The upload scope of every file this verb writes: the attachments surface. */
const ATTACHMENTS_SCOPE = 'attachments';

const NOT_READY_MESSAGE =
  'The file-attachments service cannot store a file: no data engine is wired into this kernel, or the kernel ' +
  'has not finished booting. It serves once kernel:bootstrapped has fired, in a kernel that composes the data engine.';

/** An ADR-0112-enveloped refusal: `code` and `status` on the thrown error. */
function refuse(code: StandardErrorCode | RegisteredErrorCode, status: number, message: string): never {
  const err = new Error(message) as Error & { code: string; status: number };
  err.code = code;
  err.status = status;
  throw err;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** The caller-scoped verbs serve a user; the system has `attachFile`. */
function requireUserContext(context: ExecutionContext): ExecutionContext {
  if (!context || typeof context !== 'object' || context.isSystem === true || !nonEmptyString(context.userId)) {
    refuse(
      'PERMISSION_DENIED',
      403,
      'attachFileAs / assertMayAttach act as a signed-in user: the context carries no user, or is the system context ' +
        '(which attaches through attachFile).',
    );
  }
  return context;
}

/**
 * The input, checked field by field: a JavaScript caller can hand anything,
 * and a malformed field is the caller's to fix (`400 VALIDATION_ERROR`) before
 * anything is read or written. Length limits are not judged here — the engine
 * judges the rows against their declared fields.
 */
function validateAttachFileInput(input: AttachFileInput): AttachFileInput {
  const fail = (message: string): never => refuse('VALIDATION_ERROR', 400, `attachFile: ${message}`);
  if (!input || typeof input !== 'object') fail('the input must be an object');
  for (const field of ['parentObject', 'parentId', 'filename', 'mimeType'] as const) {
    if (!nonEmptyString(input[field])) fail(`'${field}' must be a non-empty string`);
  }
  if (input.organizationId !== null && !nonEmptyString(input.organizationId)) {
    fail(
      "'organizationId' must be the organization the call acts in, or null for none — it is required, " +
        'so acting in no organization is stated rather than left out',
    );
  }
  if (!Buffer.isBuffer(input.data)) fail("'data' must be a Buffer holding the file's bytes");
  return input;
}

/** {@link validateAttachFileInput}'s counterpart for {@link AttachUploadInput}. */
function validateAttachUploadInput(input: AttachUploadInput): AttachUploadInput {
  const fail = (message: string): never => refuse('VALIDATION_ERROR', 400, `attachUploadAs: ${message}`);
  if (!input || typeof input !== 'object') fail('the input must be an object');
  for (const field of ['fileId', 'parentObject', 'parentId'] as const) {
    if (!nonEmptyString(input[field])) fail(`'${field}' must be a non-empty string`);
  }
  if (input.eTag !== undefined && typeof input.eTag !== 'string') fail("'eTag' must be a string when it is given");
  return input;
}

export class FileAttachmentService implements IFileAttachmentService, ICallerFileAttachmentService {
  constructor(private readonly deps: FileAttachmentServiceDeps) {}

  async attachFile(input: AttachFileInput): Promise<AttachedFile> {
    return this.attach(input, null);
  }

  async attachFileAs(input: AttachFileInput, context: ExecutionContext): Promise<AttachedFile> {
    return this.attach(input, requireUserContext(context));
  }

  async attachUploadAs(input: AttachUploadInput, context: ExecutionContext): Promise<AttachedFile> {
    const caller = requireUserContext(context);
    const request = validateAttachUploadInput(input);
    const engine = this.deps.getEngine();
    const storage = this.deps.getStorage();
    if (!engine || !storage) refuse('SERVICE_UNAVAILABLE', 503, NOT_READY_MESSAGE);
    const store = new StorageMetadataStore(engine);

    // ① The upload — the caller's own, as the store stamped it. Read as the
    // system, by id, as the commit door reads it; nothing about the row is
    // answered before the ownership rule has passed, and a missing row gets
    // the same answer as another user's.
    const file = await store.getFile(request.fileId);
    if (!file || !isFileUploader(caller.userId, file)) {
      refuse(NOT_UPLOADER_CODE, NOT_UPLOADER_STATUS, NOT_UPLOADER_MESSAGE);
    }
    if (file.status !== 'pending') {
      refuse(
        'RESOURCE_CONFLICT',
        409,
        'This upload is already completed, so it cannot be attached on completion. An upload is attached in the ' +
          'call that completes it: start a new upload and complete it with attachTo.',
      );
    }
    if (file.scope !== ATTACHMENTS_SCOPE) {
      refuse(
        'INVALID_REQUEST',
        400,
        `This upload was started in the '${String(file.scope ?? 'user')}' scope, and only an upload in the ` +
          `'${ATTACHMENTS_SCOPE}' scope is attached to a record. Start the upload with scope '${ATTACHMENTS_SCOPE}'.`,
      );
    }
    const callerOrganization = nonEmptyString(caller.tenantId) ? caller.tenantId : null;
    if (organizationOutOfWriteReach(store, file, { organizationId: callerOrganization }) !== null) {
      refuse(
        'PERMISSION_DENIED',
        403,
        'attachUploadAs: this upload was started in another organization than the one the caller acts in; ' +
          'switch back to that organization to attach it.',
      );
    }
    if ((await findFileHolder(engine, file.id, file as unknown as Record<string, unknown>)) !== null) {
      refuse(
        'RESOURCE_CONFLICT',
        409,
        'This upload is already attached to a record or owned by a record field, so it cannot be attached on ' +
          'completion. Start a new upload and complete it with attachTo.',
      );
    }
    const notHeld = await heldBytesRefusal(storage, file);
    if (notHeld !== null) refuse('RESOURCE_CONFLICT', 409, notHeld);

    // ② The attach authorization, before any write: the permission to create
    // an attachment and the attach rule (parent EDIT), then the parent read as
    // the caller and the organization the attachment is written in.
    await this.assertMayAttach(request.parentObject, request.parentId, caller);
    const organizationId = await this.organizationOfParent(
      engine,
      { parentObject: request.parentObject, parentId: request.parentId, organizationId: callerOrganization },
      caller,
    );
    const fileOrganization = nonEmptyString(file.organization_id) ? file.organization_id : null;
    if (fileOrganization !== null && fileOrganization !== organizationId) {
      refuse(
        'RECORD_NOT_FOUND',
        404,
        `Cannot attach a file to ${request.parentObject}/${request.parentId}: the record does not exist in the ` +
          'organization the upload was started in.',
      );
    }
    const writeContext: StorageWriteContext = { organizationId };

    // ③ The attachment and the commit — one unit, as the caller.
    let attachmentId: string | undefined;
    let ownedUnit = false;
    try {
      await this.inOneUnit(engine, organizationId, caller, async (unitContext, owned) => {
        ownedUnit = owned;
        const row = (await engine.insert(
          'sys_attachment',
          {
            parent_object: request.parentObject,
            parent_id: request.parentId,
            file_id: file.id,
            file_name: file.name,
            mime_type: file.mime_type,
            size: file.size,
          },
          // As in `attachFileAs`: the call vouches for the one file it judged
          // in ① — the caller's own pending upload, which this call commits —
          // and for no other value. The write-time reference check does not
          // ask the caller's read door for that id, and still probes that it
          // exists; every other gate on the insert judges the caller.
          { context: vouchForReference(unitContext as ExecutionContext, { object: 'sys_attachment', field: 'file_id', id: file.id }) },
        )) as { id?: unknown } | null | undefined;
        if (row?.id === undefined || row.id === null || row.id === '') {
          throw new Error('attachUploadAs: the sys_attachment insert answered no row id, so the attachment cannot be named');
        }
        attachmentId = String(row.id);
        const committed = await store.updateFile(
          file.id,
          { status: 'committed', ...(request.eTag !== undefined ? { etag: request.eTag } : {}) },
          writeContext,
        );
        if (!committed) {
          throw new Error(`attachUploadAs: the sys_file row ${file.id} was gone before it could be committed`);
        }
      });
    } catch (err) {
      // An owned transaction rolled the attachment back with the commit. A
      // unit this call does not own keeps an inserted row, so it is removed
      // here. The upload itself is the caller's and stays as it was —
      // `pending`, its bytes stored — so completing again can still commit it.
      if (!ownedUnit && attachmentId !== undefined) {
        await this.removeAttachment(engine, attachmentId, file.id, writeContext);
      }
      throw err;
    }
    return { fileId: file.id, attachmentId: attachmentId!, size: Number(file.size ?? 0) };
  }

  async assertMayAttach(parentObject: string, parentId: string, context: ExecutionContext): Promise<void> {
    const caller = requireUserContext(context);
    const engine = this.deps.getEngine();
    if (!engine) refuse('SERVICE_UNAVAILABLE', 503, NOT_READY_MESSAGE);
    let security: ReturnType<NonNullable<FileAttachmentServiceDeps['getSecurity']>>;
    try {
      security = this.deps.getSecurity?.();
    } catch {
      security = undefined;
    }
    // A kernel with no security service enforces no object permission on the
    // insert either, so there is nothing to ask.
    if (security && typeof security.explain === 'function') {
      const decision = await security.explain({ object: 'sys_attachment', operation: 'create' }, caller);
      if (!decision.allowed) {
        refuse(
          'PERMISSION_DENIED',
          403,
          'You cannot attach files: your permissions do not allow creating attachments (sys_attachment).',
        );
      }
    }
    const allowed = await mayEditAttachmentParent(
      {
        getSharing: () => this.deps.getSharing?.(),
        getSecurity: () => this.deps.getSecurity?.(),
        logger: this.deps.logger,
      },
      parentObject,
      parentId,
      caller,
      'attach',
      () => engine.findOne(parentObject, { where: { id: parentId } }, { context: caller }),
    );
    if (!allowed) {
      refuse(
        'ATTACHMENT_PARENT_ACCESS',
        403,
        `Cannot attach to ${parentObject}/${parentId}: the parent record does not exist or you cannot edit it`,
      );
    }
  }

  /** The one write path: as the system (`caller` null), or as the caller. */
  private async attach(input: AttachFileInput, caller: ExecutionContext | null): Promise<AttachedFile> {
    const request = validateAttachFileInput(input);
    // As the caller, the call acts in the caller's own organization and no
    // other: an input naming another (or none, for a caller who acts in one)
    // is refused before anything is read or written. Without this, a global
    // parent would take the sys_file into the named organization while the
    // caller's insert lands in theirs.
    if (caller) {
      const callerOrganization = nonEmptyString(caller.tenantId) ? caller.tenantId : null;
      if (request.organizationId !== callerOrganization) {
        refuse(
          'PERMISSION_DENIED',
          403,
          "attachFileAs: 'organizationId' must be the organization the caller acts in (the context's tenantId, or " +
            'null when it names none); a caller cannot attach a file in another organization.',
        );
      }
    }
    const engine = this.deps.getEngine();
    const storage = this.deps.getStorage();
    if (!engine || !storage) refuse('SERVICE_UNAVAILABLE', 503, NOT_READY_MESSAGE);

    // ① Size — before a byte is stored or a row is written.
    const size = request.data.byteLength;
    const tooLarge = uploadSizeRefusal(
      size,
      resolveStorageLimits(this.deps.getLimitsSnapshot()).maxUploadBytes,
      (n) => `The file is ${n} bytes`,
    );
    if (tooLarge !== null) refuse(UPLOAD_TOO_LARGE_CODE, UPLOAD_TOO_LARGE_STATUS, tooLarge);

    // ② The parent, and the organization both rows are written in.
    const organizationId = await this.organizationOfParent(engine, request, caller);
    const writeContext: StorageWriteContext = { organizationId };
    const store = new StorageMetadataStore(engine);

    // ③ The `sys_file` row, `pending` — the pointer the bytes are reclaimed by.
    const fileId = randomUUID();
    const key = buildKey(ATTACHMENTS_SCOPE, fileId, request.filename);
    await store.createFile(
      {
        id: fileId,
        key,
        name: request.filename,
        mime_type: request.mimeType,
        size,
        scope: ATTACHMENTS_SCOPE,
        acl: 'private',
        status: 'pending',
        ...(caller ? { owner_id: caller.userId as string } : {}),
      },
      writeContext,
    );

    // ④ The bytes.
    try {
      await storage.upload(key, request.data, { contentType: request.mimeType });
    } catch (err) {
      await this.discard(engine, store, storage, { fileId, key, writeContext });
      throw err;
    }

    // ⑤ The attachment and the commit — one unit.
    let attachmentId: string | undefined;
    let ownedUnit = false;
    try {
      await this.inOneUnit(engine, organizationId, caller, async (context, owned) => {
        ownedUnit = owned;
        const row = (await engine.insert(
          'sys_attachment',
          {
            parent_object: request.parentObject,
            parent_id: request.parentId,
            file_id: fileId,
            file_name: request.filename,
            mime_type: request.mimeType,
            size,
          },
          // As the caller, this insert names the one file this call created
          // in ③ for the caller, after reading the parent as the caller: the
          // call vouches for that file id and for no other value
          // (`vouchForReference`, @objectstack/core). The write-time reference
          // check then does not ask the caller's read door for it — a caller
          // who may attach need not read `sys_file` — and still probes that it
          // exists. Every other gate on the insert judges the caller as
          // before: the object permission to create an attachment, the attach
          // rule (parent EDIT), `enable.files`, the file-reference gate, RLS,
          // FLS and the `uploaded_by` stamp. The system context is exempt from
          // the read-door question already, so it carries no mark.
          { context: caller ? vouchForReference(context, { object: 'sys_attachment', field: 'file_id', id: fileId }) : context },
        )) as { id?: unknown } | null | undefined;
        if (row?.id === undefined || row.id === null || row.id === '') {
          throw new Error('attachFile: the sys_attachment insert answered no row id, so the attachment cannot be named');
        }
        attachmentId = String(row.id);
        const committed = await store.updateFile(fileId, { status: 'committed' }, writeContext);
        if (!committed) {
          throw new Error(`attachFile: the sys_file row ${fileId} was gone before it could be committed`);
        }
      });
    } catch (err) {
      // An owned transaction rolled the attachment back with the commit. A
      // unit this call does not own — no transaction, or a caller's it joined —
      // keeps an inserted row, so it is removed here.
      await this.discard(engine, store, storage, {
        fileId,
        key,
        writeContext,
        attachmentId: ownedUnit ? undefined : attachmentId,
      });
      throw err;
    }
    return { fileId, attachmentId: attachmentId!, size };
  }

  /**
   * Read the parent — as the system for `attachFile`, as the caller for
   * `attachFileAs` — and answer the organization both rows are written in: the
   * parent's own when it is walled into one, otherwise the call's (`null` for
   * none). A parent that does not exist, that the caller cannot read, or that
   * is walled into another organization than the call's, is refused with one
   * answer.
   */
  private async organizationOfParent(
    engine: FileAttachmentEngine,
    request: Pick<AttachFileInput, 'parentObject' | 'parentId' | 'organizationId'>,
    caller: ExecutionContext | null,
  ): Promise<string | null> {
    let parent: Record<string, unknown> | null;
    try {
      parent = await engine.findOne(
        request.parentObject,
        { where: { id: request.parentId } },
        { context: caller ?? { isSystem: true } },
      );
    } catch (err) {
      // A caller refused the read answers exactly as a record that does not
      // exist: never a 403 that tells the two apart.
      if (caller && (err as { status?: unknown })?.status === 403) parent = null;
      else throw err;
    }
    const parentOrganization = parent
      ? createWallOrganizationResolver(engine).organizationOf(request.parentObject, parent)
      : null;
    const outside =
      request.organizationId !== null && parentOrganization !== null && parentOrganization !== request.organizationId;
    if (!parent || outside) {
      refuse(
        'RECORD_NOT_FOUND',
        404,
        request.organizationId === null
          ? `Cannot attach a file to ${request.parentObject}/${request.parentId}: the record does not exist.`
          : `Cannot attach a file to ${request.parentObject}/${request.parentId}: the record does not exist in ` +
              'the organization this call acts in.',
      );
    }
    return parentOrganization ?? request.organizationId;
  }

  /**
   * Run `work` in one engine transaction when the engine offers one, telling it
   * whether this call owns that transaction (`false` when it joined a caller's,
   * and on an engine with none).
   */
  private async inOneUnit(
    engine: FileAttachmentEngine,
    organizationId: string | null,
    caller: ExecutionContext | null,
    work: (context: Record<string, unknown>, owned: boolean) => Promise<void>,
  ): Promise<void> {
    // As the caller: the caller's own context, unchanged, so every gate on the
    // insert judges the caller. As the system: the system, in the parent's
    // organization.
    const base: Record<string, unknown> = caller
      ? (caller as Record<string, unknown>)
      : organizationId === null
        ? { isSystem: true }
        : { isSystem: true, tenantId: organizationId };
    if (typeof engine.transaction !== 'function') {
      await work(base, false);
      return;
    }
    await engine.transaction((trxCtx, info) => work(trxCtx as Record<string, unknown>, info?.owned === true), base);
  }

  /**
   * Remove the `sys_attachment` row a refused call inserted outside a
   * transaction it owns. Best-effort: the call's refusal is what is thrown.
   */
  private async removeAttachment(
    engine: FileAttachmentEngine,
    attachmentId: string,
    fileId: string,
    writeContext: StorageWriteContext,
  ): Promise<void> {
    try {
      const tenant = writeContext.organizationId;
      await engine.delete('sys_attachment', {
        where: { id: attachmentId },
        context: tenant ? { isSystem: true, tenantId: tenant } : { isSystem: true },
      });
    } catch (err) {
      this.deps.logger.warn(
        `[storage] attachFile: a refused call could not remove its sys_attachment row ${attachmentId} ` +
          `(${(err as Error)?.message ?? err}). It points at the pending sys_file ${fileId}; delete the ` +
          'attachment row by hand.',
      );
    }
  }

  /**
   * Undo a refused call: the attachment row it still holds (if any), then the
   * bytes, then the pending row. Best-effort, and the caller's refusal is what
   * is thrown either way. A failure only delays the reclaim: while the pending
   * row stands, the pending-upload retention removes it and its bytes — so a
   * failed byte delete keeps the row on purpose.
   */
  private async discard(
    engine: FileAttachmentEngine,
    store: StorageMetadataStore,
    storage: IStorageService,
    call: { fileId: string; key: string; writeContext: StorageWriteContext; attachmentId?: string },
  ): Promise<void> {
    const { logger } = this.deps;
    if (call.attachmentId !== undefined) {
      await this.removeAttachment(engine, call.attachmentId, call.fileId, call.writeContext);
    }
    try {
      await storage.delete(call.key);
    } catch (err) {
      logger.warn(
        `[storage] attachFile: a refused call could not delete its stored bytes (${(err as Error)?.message ?? err}). ` +
          `The sys_file row ${call.fileId} stays pending, so the pending-upload retention reclaims the bytes and the row.`,
      );
      return;
    }
    try {
      await store.deleteFile(call.fileId, call.writeContext);
    } catch (err) {
      logger.warn(
        `[storage] attachFile: a refused call could not delete its pending sys_file row ${call.fileId} ` +
          `(${(err as Error)?.message ?? err}). The pending-upload retention removes it.`,
      );
    }
  }
}

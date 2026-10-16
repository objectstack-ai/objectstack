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
import { StorageMetadataStore, type StorageWriteContext } from './metadata-store.js';
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
// The upload doors' own storage-key layout.
import { buildKey } from './storage-routes.js';

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
  /** The sharing service, for the attach rule's verdict ({@link FileAttachmentService.mayAttach}). */
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
   * `attachFile` does, plus: a parent the caller cannot read answers
   * `RECORD_NOT_FOUND` / `404`, and the attach rule's refusal
   * (`ATTACHMENT_PARENT_ACCESS` / `403`) is the insert gate's own. A context
   * without a user, or the system context, is refused `PERMISSION_DENIED` /
   * `403`: the system has `attachFile`.
   */
  attachFileAs(input: AttachFileInput, context: ExecutionContext): Promise<AttachedFile>;
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

export class FileAttachmentService implements IFileAttachmentService, ICallerFileAttachmentService {
  constructor(private readonly deps: FileAttachmentServiceDeps) {}

  async attachFile(input: AttachFileInput): Promise<AttachedFile> {
    return this.attach(input, null);
  }

  async attachFileAs(input: AttachFileInput, context: ExecutionContext): Promise<AttachedFile> {
    return this.attach(input, requireUserContext(context));
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
          { context },
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
   * Read the parent as the system and answer the organization both rows are
   * written in: the parent's own when it is walled into one, otherwise the
   * caller's (`null` for none). A parent that does not exist, or that is walled
   * into another organization than the caller's, is refused with one answer.
   */
  private async organizationOfParent(
    engine: FileAttachmentEngine,
    request: AttachFileInput,
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
      try {
        const tenant = call.writeContext.organizationId;
        await engine.delete('sys_attachment', {
          where: { id: call.attachmentId },
          context: tenant ? { isSystem: true, tenantId: tenant } : { isSystem: true },
        });
      } catch (err) {
        logger.warn(
          `[storage] attachFile: a refused call could not remove its sys_attachment row ${call.attachmentId} ` +
            `(${(err as Error)?.message ?? err}). It points at the pending sys_file ${call.fileId}; delete the ` +
            'attachment row by hand.',
        );
      }
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

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';
import type {
  AttachedFile,
  AttachFileInput,
  IDataEngine,
  ISecurityService,
  IStorageService,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { FILE_REFERENCE_TYPES, RAW_FILE_VALUES_CONTEXT_KEY, isFileIdToken } from '@objectstack/spec/data';
import {
  StorageMetadataStore,
  updateFileIfUnchanged,
  type FileRecord,
  type StorageWriteContext,
} from './metadata-store.js';
// The attach rule's one verdict (parent EDIT), asked before a link is minted.
import {
  mayEditAttachmentParent,
  type AttachmentSecurityLike,
  type AttachmentSharingLike,
} from './attachment-access-hooks.js';
// The upload doors' own size verdict and refusal, asked here rather than
// restated.
import {
  resolveStorageLimits,
  uploadSizeRefusal,
  UPLOAD_TOO_LARGE_CODE,
  UPLOAD_TOO_LARGE_STATUS,
  type StorageLimitsSnapshot,
} from './storage-limits.js';
// The upload doors' own storage-key layout, and the download doors' link.
import { buildKey, mintDownloadUrl } from './storage-routes.js';
import {
  UPLOAD_LINK_SEGMENT,
  UPLOAD_LINK_UNUSABLE_CODE,
  UPLOAD_LINK_UNUSABLE_MESSAGE,
  UPLOAD_LINK_UNUSABLE_STATUS,
} from './upload-link-wire.js';

/**
 * [#30892] A record's files for a caller the host has already resolved: read
 * one, and attach one through a single-use upload link. The MCP door is the
 * first producer: an agent reads a policy PDF a record carries, and hands its
 * user a link to the photo of an invoice it should attach.
 *
 * ## No second access judgement
 *
 * Each question is the one an existing door asks, for the same caller:
 *
 *  - **Reading.** The record is read AS THE CALLER (a record the caller cannot
 *    read answers as one that does not exist). A field's file is the id the
 *    caller's read returns in that field, so field-level security decides
 *    which field files exist for them; an attachment is a `sys_attachment` row
 *    the caller's read returns on that record, so the attachment read gate
 *    decides. The file itself is then judged by the download door's own
 *    verdict (`judgeFileRead`, bound by the plugin), and its link is the one
 *    the `/files/:fileId/url` door mints, with the record-governed lifetime.
 *  - **Minting a link.** For the attachments list, `assertMayAttach` (the
 *    `sys_attachment` insert's own two questions). For a file field, the
 *    parent-EDIT verdict the attach rule asks (`mayEditAttachmentParent`) and
 *    the field's writability as the security service answers it.
 *  - **Using a link.** The upload acts as the user who minted it: their grants
 *    are resolved again at that moment (the plugin binds
 *    {@link RecordFileAccessDeps.resolveUserContext}, the `runAs: 'user'`
 *    automation precedent), and the existing writers run under them —
 *    `attachFileAs` for an attachment, the record's own update for a field,
 *    whose file-reference hooks claim the file. So a revoked grant refuses the
 *    upload, and every gate on the write judges that user.
 *
 * ## The link is a pending `sys_file` row
 *
 * Minting writes one `pending` `sys_file` row owned by the caller, holding no
 * bytes, whose `metadata` carries what the link is bound to: the record, the
 * field or the attachments list, the user, the organization, the expiry, and
 * the SHA-256 of the link's secret — never the secret itself. The link names
 * the row and carries a 256-bit secret; the row's metadata is the only record
 * that it was issued. Using it is one conditional write (the row still
 * `pending` and named open ⇒ rename it used), so of two concurrent uses
 * exactly one proceeds. A used, expired or unknown link answers one refusal,
 * the same for all three. An unused link is reclaimed by the pending-upload
 * retention, as an abandoned upload is. No published schema, setting or
 * object is added.
 *
 * ## What counts the upload
 *
 * The bytes go through the doors' own size verdict (`max_upload_mb`, 413
 * `PAYLOAD_TOO_LARGE`), the same `sys_file` writer and the same storage
 * adapter as every other upload, so whatever a host counts uploads by counts
 * this one too.
 */

/** How long a minted upload link stays usable, in seconds: ten minutes. */
export const UPLOAD_LINK_TTL_SECONDS = 10 * 60;

/** The upload link's secret: 32 random bytes (256 bits), base64url in the link. */
const UPLOAD_LINK_SECRET_BYTES = 32;

/** The marker a link row's `metadata` carries, so no other pending row reads as a link. */
const UPLOAD_LINK_KIND = 'upload_link';

/**
 * A link row's `name` while the link is open, and once it is used. The state
 * lives in `name` because the one conditional write that spends a link
 * compares it (`updateFileIfUnchanged`); the `metadata` binding never changes.
 */
const LINK_NAME_OPEN = 'upload-link';
const LINK_NAME_USED = 'upload-link (used)';

/** The most attachments {@link RecordFileAccess.listRecordFilesAs} lists for one record. */
const ATTACHMENT_LIST_LIMIT = 100;

/** The scope of a file a link attaches to a field: the user's upload, as the presigned door files one. */
const FIELD_UPLOAD_SCOPE = 'user';

/** Which of a record's files to read: one a file field holds, or one attachment. */
export type RecordFileTarget = { field: string; fileId?: string } | { attachmentId: string };

/** Where an upload link lands: a file field, or the record's attachments list. */
export type UploadLinkTarget = { field: string } | { attachments: true };

/** One file a record carries, as {@link RecordFileAccess.listRecordFilesAs} lists it. */
export interface RecordFileEntry {
  fileId: string;
  name: string;
  mimeType: string | null;
  /** Bytes, as recorded when the upload was committed; `null` when the row records none. */
  size: number | null;
  /** The file field that holds it, for a field file. */
  field?: string;
  /** The `sys_attachment` row, for an attachment. */
  attachmentId?: string;
}

/** {@link RecordFileAccess.readRecordFileAs}'s answer. */
export interface RecordFileRead extends RecordFileEntry {
  /** The byte cap the read was asked under. */
  maxBytes: number;
  /** The file's bytes, present only when the file is within {@link maxBytes}. */
  bytes?: Buffer;
  /**
   * A short-lived download link, as the `/files/:fileId/url` door mints it
   * (the adapter's own URL; a local adapter's is a path on this server), or
   * `null` when the adapter can issue none.
   */
  download: { url: string; expiresAt: string } | null;
}

/** {@link RecordFileAccess.createUploadLinkAs}'s answer. */
export interface UploadLinkGrant {
  /** The link's token: the pending row's id and the secret. Shown once, never stored. */
  token: string;
  /** The link's path on this server: the storage base path, the segment and the token. */
  path: string;
  /** When the link stops working (ISO 8601). */
  expiresAt: string;
  object: string;
  recordId: string;
  /** The file field the upload lands in, or absent for the attachments list. */
  field?: string;
}

/** What the link's page may show: that it is usable, until when, and where the file lands. */
export interface UploadLinkView {
  expiresAt: string;
  target: 'field' | 'attachments';
}

/** One upload arriving through a link. */
export interface UploadLinkUpload {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/** Where an upload through a link landed. */
export interface UploadLinkOutcome {
  object: string;
  recordId: string;
  fileId: string;
  size: number;
  /** The file field it now fills, for a field link. */
  field?: string;
  /** The `sys_attachment` row it was attached as, for an attachments link. */
  attachmentId?: string;
}

/**
 * The caller-scoped face of the `file-attachments` service for a record's
 * files — a package-local contract of `@objectstack/service-storage`, reached
 * through the same `FILE_ATTACHMENT_SERVICE` slot as
 * `ICallerFileAttachmentService`. Every verb acts as `context`'s user and
 * refuses the system context and a context with no user
 * (`PERMISSION_DENIED` / 403).
 */
export interface ICallerRecordFileService {
  /** The files `context` can read on the record: its file fields' files and its attachments. */
  listRecordFilesAs(object: string, recordId: string, context: ExecutionContext): Promise<RecordFileEntry[]>;
  /** One of the record's files, with its bytes when within `maxBytes`, and a short-lived download link. */
  readRecordFileAs(
    object: string,
    recordId: string,
    target: RecordFileTarget,
    context: ExecutionContext,
    options: { maxBytes: number },
  ): Promise<RecordFileRead>;
  /** A single-use upload link bound to exactly this record and field (or attachments list). */
  createUploadLinkAs(
    object: string,
    recordId: string,
    target: UploadLinkTarget,
    context: ExecutionContext,
  ): Promise<UploadLinkGrant>;
}

/**
 * The two verbs the upload-link HTTP doors call. `callerUserId` is the user
 * the request's own session names: a link is usable only by the user it was
 * minted for, signed in, so the token alone opens nothing. Another user gets
 * the one unusable-link refusal, and the link is not spent.
 */
export interface UploadLinkDoor {
  /** The link's view, or the one unusable-link refusal. Writes nothing. */
  inspectUploadLink(token: string, callerUserId: string): Promise<UploadLinkView>;
  /** Spend the link on `upload`, landing it where the link is bound. */
  consumeUploadLink(token: string, upload: UploadLinkUpload, callerUserId: string): Promise<UploadLinkOutcome>;
}

/** The data-engine surface these verbs use: the reads and writes every engine has, plus its schema read. */
export type RecordFileEngine = IDataEngine & { getObject?(objectName: string): unknown };

/** What {@link RecordFileAccess} is composed over — each read at call time. */
export interface RecordFileAccessDeps {
  /** The data engine, once armed (`kernel:bootstrapped`); `null` before that. */
  getEngine(): RecordFileEngine | null;
  getStorage(): IStorageService | null;
  getLimitsSnapshot(): StorageLimitsSnapshot | undefined;
  /** The caller-scoped attach verbs (`FileAttachmentService`). */
  attachments: {
    attachFileAs(input: AttachFileInput, context: ExecutionContext): Promise<AttachedFile>;
    assertMayAttach(parentObject: string, parentId: string, context: ExecutionContext): Promise<void>;
  };
  /** The download door's verdict on one file for one resolved caller (`judgeFileRead`). */
  judgeFileRead(file: FileRecord, context: ExecutionContext): Promise<'allow' | 'deny'>;
  /** The download doors' servability rule (committed, or a tombstone something still holds). */
  isServable(file: FileRecord): Promise<boolean>;
  /**
   * The user's execution context, resolved now from their grants in
   * `organizationId`, or `null` when they can no longer act there.
   */
  resolveUserContext(userId: string, organizationId: string | null): Promise<ExecutionContext | null>;
  /** The signed-URL lifetime of a record-governed download, in seconds. */
  getDownloadTtl(): number;
  /** The storage routes' base path, for the link's path. */
  getBasePath(): string;
  getSharing?(): AttachmentSharingLike | null | undefined;
  getSecurity?():
    | (AttachmentSecurityLike & Partial<Pick<ISecurityService, 'getWritableFields'>>)
    | null
    | undefined;
  logger: { warn(message: string): void; debug?(message: string): void };
  /** Clock (tests). */
  now?(): number;
}

/** What a link row's `metadata` binds the link to, every value a string (`sys_file.metadata` is a JSON object of strings). */
interface UploadLinkState {
  kind: typeof UPLOAD_LINK_KIND;
  secret_sha256: string;
  expires_at: string;
  object: string;
  record_id: string;
  target: 'field' | 'attachments';
  field?: string;
  user_id: string;
  organization_id?: string;
}

/** An ADR-0112-enveloped refusal: `code` and `status` on the thrown error. */
function refuse(code: StandardErrorCode | RegisteredErrorCode, status: number, message: string): never {
  const err = new Error(message) as Error & { code: string; status: number };
  err.code = code;
  err.status = status;
  throw err;
}

function refuseUnusableLink(): never {
  refuse(UPLOAD_LINK_UNUSABLE_CODE, UPLOAD_LINK_UNUSABLE_STATUS, UPLOAD_LINK_UNUSABLE_MESSAGE);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** These verbs serve a user; nothing here acts as the system. */
function requireUserContext(context: ExecutionContext): ExecutionContext {
  if (!context || typeof context !== 'object' || context.isSystem === true || !nonEmptyString(context.userId)) {
    refuse(
      'PERMISSION_DENIED',
      403,
      "A record's files are read and attached as a signed-in user: the context carries no user, or is the system context.",
    );
  }
  return context;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A link row's id: the UUID {@link RecordFileAccess.createUploadLinkAs} mints. */
const LINK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A link secret: {@link UPLOAD_LINK_SECRET_BYTES} bytes, base64url without padding. */
const LINK_SECRET = /^[A-Za-z0-9_-]{43}$/;

/** `{ id, secret }` from a token, or `null` for anything that is not one. */
function parseToken(token: unknown): { id: string; secret: string } | null {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return LINK_ID.test(id) && LINK_SECRET.test(secret) ? { id, secret } : null;
}

/** The binding an open link's row holds, or `null` when the row is not an open link. */
function openLinkStateOf(row: FileRecord | null): UploadLinkState | null {
  if (!row || row.status !== 'pending' || row.name !== LINK_NAME_OPEN || typeof row.metadata !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.metadata);
  } catch {
    return null;
  }
  const s = parsed as Partial<UploadLinkState> | null;
  if (!s || typeof s !== 'object' || s.kind !== UPLOAD_LINK_KIND) return null;
  for (const key of ['secret_sha256', 'expires_at', 'object', 'record_id', 'user_id'] as const) {
    if (!nonEmptyString(s[key])) return null;
  }
  if (s.target !== 'field' && s.target !== 'attachments') return null;
  if (s.target === 'field' && !nonEmptyString(s.field)) return null;
  return s as UploadLinkState;
}

/** `sys_file.metadata` for a link's binding. */
function linkMetadata(state: UploadLinkState): string {
  return JSON.stringify({
    kind: state.kind,
    secret_sha256: state.secret_sha256,
    expires_at: state.expires_at,
    object: state.object,
    record_id: state.record_id,
    target: state.target,
    ...(state.field !== undefined ? { field: state.field } : {}),
    user_id: state.user_id,
    ...(state.organization_id !== undefined ? { organization_id: state.organization_id } : {}),
  });
}

/** Constant-time comparison of two hex digests of equal length. */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** The stored file ids a file field's raw value holds (one id, or an array of them). */
function fileIdsIn(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.filter(isFileIdToken);
}

function fieldDefOf(engine: RecordFileEngine, object: string, field: string): Record<string, unknown> | undefined {
  const schema = engine.getObject?.(object) as { fields?: Record<string, Record<string, unknown>> } | undefined;
  return schema?.fields?.[field];
}

/** The object's file-class field names, or `[]`. */
function fileFieldsOf(engine: RecordFileEngine, object: string): string[] {
  const schema = engine.getObject?.(object) as { fields?: Record<string, { type?: unknown }> } | undefined;
  return Object.entries(schema?.fields ?? {})
    .filter(([, def]) => def && FILE_REFERENCE_TYPES.has(def.type as never))
    .map(([name]) => name);
}

/** The file field `field` of `object`, or a refusal naming the object's file fields. */
function requireFileField(engine: RecordFileEngine, object: string, field: string): Record<string, unknown> {
  const def = fieldDefOf(engine, object, field);
  if (def && FILE_REFERENCE_TYPES.has(def.type as never)) return def;
  const fileFields = fileFieldsOf(engine, object);
  refuse(
    'VALIDATION_ERROR',
    400,
    `"${field}" is not a file field of ${object}. ` +
      (fileFields.length > 0
        ? `Its file fields: ${fileFields.join(', ')}; or use the record's attachments.`
        : 'It has no file fields; use the record\'s attachments.'),
  );
}

function describe(file: FileRecord): Pick<RecordFileEntry, 'fileId' | 'name' | 'mimeType' | 'size'> {
  return {
    fileId: file.id,
    name: typeof file.name === 'string' ? file.name : '',
    mimeType: typeof file.mime_type === 'string' && file.mime_type ? file.mime_type : null,
    size: typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : null,
  };
}

export class RecordFileAccess implements ICallerRecordFileService, UploadLinkDoor {
  constructor(private readonly deps: RecordFileAccessDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private engineOrRefuse(): RecordFileEngine {
    const engine = this.deps.getEngine();
    if (!engine) {
      refuse(
        'SERVICE_UNAVAILABLE',
        503,
        "A record's files cannot be reached: no data engine is wired into this kernel, or it has not finished booting.",
      );
    }
    return engine;
  }

  private storageOrRefuse(): IStorageService {
    const storage = this.deps.getStorage();
    if (!storage) refuse('SERVICE_UNAVAILABLE', 503, 'No storage adapter is configured, so no file can be read or stored.');
    return storage;
  }

  /**
   * The record as `caller` reads it, file fields in their stored form (the
   * bare ids). A record the caller may not read answers exactly as one that
   * does not exist: never a 403 that tells the two apart.
   */
  private async readRecordAs(
    engine: RecordFileEngine,
    object: string,
    recordId: string,
    caller: ExecutionContext,
  ): Promise<Record<string, unknown>> {
    let row: Record<string, unknown> | null;
    try {
      row = await engine.findOne(
        object,
        { where: { id: recordId } },
        { context: { ...caller, [RAW_FILE_VALUES_CONTEXT_KEY]: true } as ExecutionContext },
      );
    } catch (err) {
      const status = (err as { status?: unknown })?.status;
      if (status === 403 || status === 404) row = null;
      else throw err;
    }
    if (!row) refuse('RECORD_NOT_FOUND', 404, `Record "${recordId}" not found in "${object}"`);
    return row;
  }

  async listRecordFilesAs(object: string, recordId: string, context: ExecutionContext): Promise<RecordFileEntry[]> {
    const caller = requireUserContext(context);
    const engine = this.engineOrRefuse();
    const record = await this.readRecordAs(engine, object, recordId, caller);
    const store = new StorageMetadataStore(engine);

    const entries: RecordFileEntry[] = [];
    for (const field of fileFieldsOf(engine, object)) {
      for (const fileId of fileIdsIn(record[field])) {
        const file = await store.getFile(fileId);
        if (file && (await this.deps.isServable(file))) entries.push({ ...describe(file), field });
      }
    }
    const attachments = ((await engine.find(
      'sys_attachment',
      {
        where: { parent_object: object, parent_id: recordId },
        fields: ['id', 'file_id'],
        limit: ATTACHMENT_LIST_LIMIT,
      },
      { context: caller },
    )) ?? []) as Array<Record<string, unknown>>;
    for (const row of attachments) {
      if (!nonEmptyString(row?.file_id) || row.id == null) continue;
      const file = await store.getFile(row.file_id);
      if (file && (await this.deps.isServable(file))) entries.push({ ...describe(file), attachmentId: String(row.id) });
    }
    return entries;
  }

  async readRecordFileAs(
    object: string,
    recordId: string,
    target: RecordFileTarget,
    context: ExecutionContext,
    options: { maxBytes: number },
  ): Promise<RecordFileRead> {
    const caller = requireUserContext(context);
    const engine = this.engineOrRefuse();
    const storage = this.storageOrRefuse();
    const record = await this.readRecordAs(engine, object, recordId, caller);

    let fileId: string;
    let located: Pick<RecordFileEntry, 'field' | 'attachmentId'>;
    if ('attachmentId' in target) {
      // The attachment read gate decides which rows the caller sees.
      const rows = ((await engine.find(
        'sys_attachment',
        { where: { id: target.attachmentId, parent_object: object, parent_id: recordId }, fields: ['id', 'file_id'], limit: 1 },
        { context: caller },
      )) ?? []) as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row || !nonEmptyString(row.file_id)) {
        refuse('RESOURCE_NOT_FOUND', 404, `${object}/${recordId} has no attachment "${target.attachmentId}" you can read.`);
      }
      fileId = row.file_id;
      located = { attachmentId: String(row.id) };
    } else {
      requireFileField(engine, object, target.field);
      // Field-level security decides: a field the caller may not read is
      // absent from their read, so it holds no file for them.
      const held = fileIdsIn(record[target.field]);
      if (target.fileId !== undefined) {
        if (!held.includes(target.fileId)) {
          refuse('RESOURCE_NOT_FOUND', 404, `${object}/${recordId}.${target.field} holds no file "${target.fileId}" you can read.`);
        }
        fileId = target.fileId;
      } else if (held.length === 1) {
        fileId = held[0];
      } else if (held.length === 0) {
        refuse('RESOURCE_NOT_FOUND', 404, `${object}/${recordId}.${target.field} holds no file you can read.`);
      } else {
        refuse(
          'VALIDATION_ERROR',
          400,
          `${object}/${recordId}.${target.field} holds ${held.length} files; name one with fileId: ${held.join(', ')}.`,
        );
      }
      located = { field: target.field };
    }

    const store = new StorageMetadataStore(engine);
    const file = await store.getFile(fileId);
    if (!file || !(await this.deps.isServable(file))) {
      refuse('FILE_NOT_FOUND', 404, 'File not found or not downloadable');
    }
    // The download door's verdict, for the same caller.
    if (file.acl !== 'public_read' && (await this.deps.judgeFileRead(file, caller)) !== 'allow') {
      if (located.attachmentId !== undefined) {
        refuse('ATTACHMENT_DOWNLOAD_DENIED', 403, 'You do not have access to a record this file is attached to');
      }
      refuse('FILE_DOWNLOAD_DENIED', 403, 'You do not have access to the record this file belongs to');
    }

    const entry = { ...describe(file), ...located };
    const maxBytes = options.maxBytes;
    let bytes: Buffer | undefined;
    if (entry.size !== null && entry.size <= maxBytes) {
      const read = await storage.download(file.key);
      // The recorded size is the committed one; the cap holds on what was read.
      if (read.byteLength <= maxBytes) bytes = read;
    }
    const ttl = this.deps.getDownloadTtl();
    const url = await mintDownloadUrl(storage, file, ttl);
    return {
      ...entry,
      maxBytes,
      ...(bytes ? { bytes } : {}),
      download: url ? { url, expiresAt: new Date(this.now() + ttl * 1000).toISOString() } : null,
    };
  }

  async createUploadLinkAs(
    object: string,
    recordId: string,
    target: UploadLinkTarget,
    context: ExecutionContext,
  ): Promise<UploadLinkGrant> {
    const caller = requireUserContext(context);
    const engine = this.engineOrRefuse();
    const field = 'field' in target ? target.field : undefined;

    if (field !== undefined) requireFileField(engine, object, field);
    // A record the caller cannot read answers as one that does not exist, at
    // this door as at `get_record`.
    await this.readRecordAs(engine, object, recordId, caller);
    if (field === undefined) {
      // The `sys_attachment` insert's own two questions, with no write.
      await this.deps.attachments.assertMayAttach(object, recordId, caller);
    } else {
      // The record must be one the caller may edit (the attach rule's
      // parent-EDIT verdict), and the field one they may write. The field
      // answer is advisory (`undefined` is "no answer"); the write the upload
      // makes is judged by the field-level-security gate either way.
      const mayEdit = await mayEditAttachmentParent(
        {
          getSharing: () => this.deps.getSharing?.(),
          getSecurity: () => this.deps.getSecurity?.(),
          logger: this.deps.logger,
        },
        object,
        recordId,
        caller,
        'upload link',
        () => engine.findOne(object, { where: { id: recordId } }, { context: caller }),
      );
      if (!mayEdit) {
        refuse('PERMISSION_DENIED', 403, `You cannot attach a file to ${object}/${recordId}: you cannot edit that record.`);
      }
      const writable = await this.deps.getSecurity?.()?.getWritableFields?.(object, caller);
      if (Array.isArray(writable) && !writable.includes(field)) {
        refuse('FIELD_NOT_ACCESSIBLE', 403, `You cannot attach a file to ${object}.${field}: you cannot edit that field.`);
      }
    }

    const organizationId = nonEmptyString(caller.tenantId) ? caller.tenantId : null;
    const id = randomUUID();
    const secret = randomBytes(UPLOAD_LINK_SECRET_BYTES).toString('base64url');
    const expiresAt = new Date(this.now() + UPLOAD_LINK_TTL_SECONDS * 1000).toISOString();
    const state: UploadLinkState = {
      kind: UPLOAD_LINK_KIND,
      secret_sha256: sha256Hex(secret),
      expires_at: expiresAt,
      object,
      record_id: recordId,
      target: field === undefined ? 'attachments' : 'field',
      ...(field !== undefined ? { field } : {}),
      user_id: caller.userId as string,
      ...(organizationId !== null ? { organization_id: organizationId } : {}),
    };
    const store = new StorageMetadataStore(engine);
    await store.createFile(
      {
        id,
        key: buildKey(field === undefined ? 'attachments' : FIELD_UPLOAD_SCOPE, id, LINK_NAME_OPEN),
        name: LINK_NAME_OPEN,
        size: 0,
        scope: field === undefined ? 'attachments' : FIELD_UPLOAD_SCOPE,
        acl: 'private',
        status: 'pending',
        owner_id: caller.userId as string,
        metadata: linkMetadata(state),
      },
      { organizationId },
    );
    const token = `${id}.${secret}`;
    return {
      token,
      path: `${this.deps.getBasePath()}/${UPLOAD_LINK_SEGMENT}/${token}`,
      expiresAt,
      object,
      recordId,
      ...(field !== undefined ? { field } : {}),
    };
  }

  /**
   * The open, unexpired link a token names, minted for `callerUserId`, with
   * its row — or the one refusal. A link minted for someone else answers
   * exactly as an unknown one does, so a signed-in stranger holding the token
   * learns nothing and spends nothing.
   */
  private async openLink(
    store: StorageMetadataStore,
    token: string,
    callerUserId: string,
  ): Promise<{ row: FileRecord; state: UploadLinkState }> {
    const parsed = parseToken(token);
    if (!parsed) refuseUnusableLink();
    const row = await store.getFile(parsed.id);
    const state = openLinkStateOf(row);
    if (!row || !state) refuseUnusableLink();
    if (!sameDigest(state.secret_sha256, sha256Hex(parsed.secret))) refuseUnusableLink();
    const deadline = Date.parse(state.expires_at);
    if (!Number.isFinite(deadline) || deadline <= this.now()) refuseUnusableLink();
    if (!nonEmptyString(callerUserId) || state.user_id !== callerUserId) refuseUnusableLink();
    return { row, state };
  }

  async inspectUploadLink(token: string, callerUserId: string): Promise<UploadLinkView> {
    const { state } = await this.openLink(new StorageMetadataStore(this.engineOrRefuse()), token, callerUserId);
    return { expiresAt: state.expires_at, target: state.target };
  }

  async consumeUploadLink(token: string, upload: UploadLinkUpload, callerUserId: string): Promise<UploadLinkOutcome> {
    const engine = this.engineOrRefuse();
    const storage = this.storageOrRefuse();
    const store = new StorageMetadataStore(engine);
    const { row, state } = await this.openLink(store, token, callerUserId);

    if (!nonEmptyString(upload.filename)) refuse('VALIDATION_ERROR', 400, 'The upload names no file.');
    if (!Buffer.isBuffer(upload.data)) refuse('VALIDATION_ERROR', 400, 'The upload carries no bytes.');
    // The doors' own size verdict, before the link is spent.
    const tooLarge = uploadSizeRefusal(
      upload.data.byteLength,
      resolveStorageLimits(this.deps.getLimitsSnapshot()).maxUploadBytes,
      (n) => `The file is ${n} bytes`,
    );
    if (tooLarge !== null) refuse(UPLOAD_TOO_LARGE_CODE, UPLOAD_TOO_LARGE_STATUS, tooLarge);

    // The user the link was minted for, resolved now: a grant revoked since
    // refuses the upload, and the writes below run as them.
    const organizationId = state.organization_id ?? null;
    const user = await this.deps.resolveUserContext(state.user_id, organizationId);
    if (!user) {
      refuse(
        'PERMISSION_DENIED',
        403,
        'This upload link was issued in an organization its user can no longer act in, so nothing can be attached through it.',
      );
    }

    // Spend the link: exactly one use turns it from open to used.
    const writeContext: StorageWriteContext = { organizationId };
    const spent = await updateFileIfUnchanged(
      store,
      row.id,
      { status: 'pending', name: LINK_NAME_OPEN },
      { name: LINK_NAME_USED },
      writeContext,
    );
    if (!spent) refuseUnusableLink();

    try {
      const mimeType = nonEmptyString(upload.mimeType) ? upload.mimeType : 'application/octet-stream';
      const outcome =
        state.target === 'attachments'
          ? await this.attachThroughLink(state, user, upload, mimeType, organizationId)
          : await this.fillFieldThroughLink(engine, storage, store, state, user, upload, mimeType, writeContext);
      return outcome;
    } finally {
      // The link row has done its work, used or refused: it holds no bytes,
      // and a used link is refused whether or not it still exists. A failed
      // delete leaves a used, pending row the pending-upload retention reaps.
      try {
        await store.deleteFile(row.id, writeContext);
      } catch (err) {
        this.deps.logger.warn(
          `[storage] upload link: could not delete the used link row ${row.id} ` +
            `(${(err as Error)?.message ?? err}). It stays marked used; the pending-upload retention removes it.`,
        );
      }
    }
  }

  private async attachThroughLink(
    state: UploadLinkState,
    user: ExecutionContext,
    upload: UploadLinkUpload,
    mimeType: string,
    organizationId: string | null,
  ): Promise<UploadLinkOutcome> {
    const attached = await this.deps.attachments.attachFileAs(
      {
        parentObject: state.object,
        parentId: state.record_id,
        filename: upload.filename,
        mimeType,
        data: upload.data,
        organizationId,
      },
      user,
    );
    return {
      object: state.object,
      recordId: state.record_id,
      fileId: attached.fileId,
      size: attached.size,
      attachmentId: attached.attachmentId,
    };
  }

  /**
   * Store the bytes as the user's committed upload, then write the record's
   * field as the user: the record's own update, so its permissions, field
   * security, validation and the file-reference hooks (which claim the file
   * and check the field's `accept` / `maxSize`) all judge it. A multi-file
   * field gains the file beside the ones it holds; a single-file field takes
   * it in place of the one it held, which the lifecycle releases.
   */
  private async fillFieldThroughLink(
    engine: RecordFileEngine,
    storage: IStorageService,
    store: StorageMetadataStore,
    state: UploadLinkState,
    user: ExecutionContext,
    upload: UploadLinkUpload,
    mimeType: string,
    writeContext: StorageWriteContext,
  ): Promise<UploadLinkOutcome> {
    const field = state.field as string;
    const def = requireFileField(engine, state.object, field);
    const fileId = randomUUID();
    const key = buildKey(FIELD_UPLOAD_SCOPE, fileId, upload.filename);
    const size = upload.data.byteLength;
    await store.createFile(
      {
        id: fileId,
        key,
        name: upload.filename,
        mime_type: mimeType,
        size,
        scope: FIELD_UPLOAD_SCOPE,
        acl: 'private',
        status: 'pending',
        owner_id: user.userId as string,
      },
      writeContext,
    );
    try {
      await storage.upload(key, upload.data, { contentType: mimeType });
      // A record write takes only a completed upload.
      await store.updateFile(fileId, { status: 'committed' }, writeContext);
      let value: string | string[] = fileId;
      if (def.multiple === true) {
        const current = await this.readRecordAs(engine, state.object, state.record_id, user);
        value = [...fileIdsIn(current[field]), fileId];
      }
      const updated = await engine.update(state.object, { [field]: value }, { where: { id: state.record_id }, context: user });
      // A row the user's update no longer reaches (deleted, or out of their
      // scope since the link was minted) is refused, never answered as landed.
      if (updated == null || updated === 0) {
        refuse('RECORD_NOT_FOUND', 404, `Record "${state.record_id}" not found in "${state.object}"`);
      }
    } catch (err) {
      await this.discard(storage, store, fileId, key, writeContext);
      throw err;
    }
    return { object: state.object, recordId: state.record_id, fileId, size, field };
  }

  /** Undo a refused field upload: the bytes, then the row. Best-effort; the refusal is what is thrown. */
  private async discard(
    storage: IStorageService,
    store: StorageMetadataStore,
    fileId: string,
    key: string,
    writeContext: StorageWriteContext,
  ): Promise<void> {
    try {
      await storage.delete(key);
    } catch (err) {
      this.deps.logger.warn(
        `[storage] upload link: a refused upload could not delete its stored bytes (${(err as Error)?.message ?? err}). ` +
          `The sys_file row ${fileId} is kept so the bytes stay addressable; delete both by hand.`,
      );
      return;
    }
    try {
      await store.deleteFile(fileId, writeContext);
    } catch (err) {
      this.deps.logger.warn(
        `[storage] upload link: a refused upload could not delete its sys_file row ${fileId} ` +
          `(${(err as Error)?.message ?? err}). Its bytes are gone; delete the row by hand.`,
      );
    }
  }
}

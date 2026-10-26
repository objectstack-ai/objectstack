// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';
import type {
  FieldFileDescription,
  FieldFileSlot,
  IDataEngine,
  IFieldFileService,
  IStorageService,
  StoreFieldFileInput,
  StoredFieldFile,
} from '@objectstack/spec/contracts';
import { StorageMetadataStore, type StorageWriteContext } from './metadata-store.js';
// The field-reference lifecycle's own release, so a slot this verb settles
// lets go of its old file exactly as a record write that replaces the value
// does — the tombstone policy included.
import {
  ownedBySlot,
  releaseOwnership,
  type FileReferenceEngine,
  type FileReferenceLogger,
} from './file-reference-lifecycle.js';
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
 * [#25779] The server-side field-file verb — `IFieldFileService`, registered
 * by `StorageServicePlugin` under `FIELD_FILE_SERVICE`
 * (`@objectstack/spec/contracts`): store bytes as a `sys_file` no record owns
 * yet, then hand it to the (object, record, field) slot whose value holds its
 * id.
 *
 * Its producer is the seed loader, writing the files a package ships
 * (`seedFile(path)`) into the file fields of the rows it seeds. A seed has no
 * upload, so it acts as the SYSTEM, and each check is the one an upload meets:
 *
 *  - **Size.** `uploadSizeRefusal` against the resolved `max_upload_mb`, the
 *    verdict the REST upload doors and the attach verb ask, before anything is
 *    stored.
 *  - **The `sys_file` row.** `StorageMetadataStore`, the upload doors' writer,
 *    with the organization threaded through `StorageWriteContext`, so the
 *    driver stamps the row exactly as it stamps an upload.
 *  - **The storage key.** `buildKey`, under the `tenant` scope: the file is
 *    the organization's, not a user's upload.
 *
 * ## Pending until a record owns it
 *
 * The write order is the presigned upload door's: the row first, `pending`,
 * then the bytes. The row turns `committed` only when {@link claimFiles} hands
 * it to the slot that holds it, so a file whose record never lands — a row the
 * engine refused, a process that died between the two — is reclaimed, row and
 * bytes, by the pending-upload retention.
 *
 * ## The claim is the lifecycle's claim, made explicit
 *
 * When the record write that holds the id runs under the field-reference hooks
 * (`installFileReferenceHooks`, armed at `kernel:ready`), the hooks claim the
 * file themselves; {@link claimFiles} then finds it already owned by the slot
 * and only commits it. A write that runs before the hooks are installed — a
 * seed in a plugin's `start()` — gets its ownership here instead. Either way a
 * file has one owner: a file another slot owns is refused, never transferred
 * (the hooks' own rule), and the slot's previous file is released through the
 * lifecycle's {@link releaseOwnership}.
 */

/** What {@link FieldFileService} is composed over — each read at call time. */
export interface FieldFileServiceDeps {
  /** The data engine `sys_file` lives in; `null` when none is wired. */
  getEngine(): (IDataEngine & FileReferenceEngine) | null;
  /** The `storage` service the bytes go to. */
  getStorage(): IStorageService | null;
  /** The `storage` namespace's Limits group as last read — the upload doors' own source. */
  getLimitsSnapshot(): StorageLimitsSnapshot | undefined;
  logger: FileReferenceLogger;
}

/** The storage scope every field file this verb stores is filed under. */
const FIELD_FILE_SCOPE = 'tenant';

const NOT_READY_MESSAGE =
  'The field-files service cannot store a file: no data engine is wired into this kernel, so there is no ' +
  'sys_file table to record it in.';

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

/** The system context for a `sys_file` read or write in `organizationId`. */
function systemContextIn(organizationId: string | null): Record<string, unknown> {
  return organizationId === null ? { isSystem: true } : { isSystem: true, tenantId: organizationId };
}

function validateStoreInput(input: StoreFieldFileInput): StoreFieldFileInput {
  const fail = (message: string): never => refuse('VALIDATION_ERROR', 400, `storeFile: ${message}`);
  if (!input || typeof input !== 'object') fail('the input must be an object');
  for (const field of ['filename', 'mimeType'] as const) {
    if (!nonEmptyString(input[field])) fail(`'${field}' must be a non-empty string`);
  }
  if (input.organizationId !== null && !nonEmptyString(input.organizationId)) {
    fail(
      "'organizationId' must be the organization the file is stored in, or null for none — it is required, " +
        'so storing in no organization is stated rather than left out',
    );
  }
  if (!Buffer.isBuffer(input.data)) fail("'data' must be a Buffer holding the file's bytes");
  if (input.metadata !== undefined) {
    const entries = input.metadata && typeof input.metadata === 'object' ? Object.values(input.metadata) : null;
    if (!entries || entries.some((v) => typeof v !== 'string')) {
      fail("'metadata' must map names to string values");
    }
  }
  return input;
}

function validateSlot(slot: FieldFileSlot, fileIds: readonly string[]): void {
  const fail = (message: string): never => refuse('VALIDATION_ERROR', 400, `claimFiles: ${message}`);
  if (!slot || typeof slot !== 'object') fail('the slot must be an object');
  for (const field of ['object', 'recordId', 'field'] as const) {
    if (!nonEmptyString(slot[field])) fail(`the slot's '${field}' must be a non-empty string`);
  }
  if (!Array.isArray(fileIds) || fileIds.some((id) => !nonEmptyString(id))) {
    fail("'fileIds' must be an array of file ids");
  }
}

/** `sys_file.metadata` as written by {@link FieldFileService.storeFile}: a JSON object of strings. */
function parseMetadata(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function describeRow(row: Record<string, unknown>): FieldFileDescription {
  const status = row.status === 'committed' || row.status === 'deleted' ? row.status : 'pending';
  const owner =
    row.ref_object != null && row.ref_id != null && row.ref_field != null
      ? { object: String(row.ref_object), recordId: String(row.ref_id), field: String(row.ref_field) }
      : null;
  return {
    fileId: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    mimeType: typeof row.mime_type === 'string' ? row.mime_type : null,
    status,
    owner,
    metadata: parseMetadata(row.metadata),
  };
}

function isSlot(owner: FieldFileSlot | null, slot: FieldFileSlot): boolean {
  return owner !== null && owner.object === slot.object && owner.recordId === slot.recordId && owner.field === slot.field;
}

export class FieldFileService implements IFieldFileService {
  constructor(private readonly deps: FieldFileServiceDeps) {}

  async storeFile(input: StoreFieldFileInput): Promise<StoredFieldFile> {
    const request = validateStoreInput(input);
    const engine = this.deps.getEngine();
    const storage = this.deps.getStorage();
    if (!engine || !storage) refuse('SERVICE_UNAVAILABLE', 503, NOT_READY_MESSAGE);

    // ① Size — before a byte is stored or a row is written.
    const size = request.data.byteLength;
    const tooLarge = uploadSizeRefusal(
      size,
      resolveStorageLimits(this.deps.getLimitsSnapshot()).maxUploadBytes,
      (n) => `The file ${request.filename} is ${n} bytes`,
    );
    if (tooLarge !== null) refuse(UPLOAD_TOO_LARGE_CODE, UPLOAD_TOO_LARGE_STATUS, tooLarge);

    // ② The `sys_file` row, `pending` — the pointer the bytes are reclaimed by.
    const writeContext: StorageWriteContext = { organizationId: request.organizationId };
    const store = new StorageMetadataStore(engine);
    const fileId = randomUUID();
    const key = buildKey(FIELD_FILE_SCOPE, fileId, request.filename);
    await store.createFile(
      {
        id: fileId,
        key,
        name: request.filename,
        mime_type: request.mimeType,
        size,
        scope: FIELD_FILE_SCOPE,
        acl: 'private',
        status: 'pending',
        ...(request.metadata ? { metadata: JSON.stringify(request.metadata) } : {}),
      },
      writeContext,
    );

    // ③ The bytes. A failed upload removes the row it would have filled; if
    // even that fails, the pending row is the retention's to reclaim.
    try {
      await storage.upload(key, request.data, { contentType: request.mimeType });
    } catch (err) {
      try {
        await store.deleteFile(fileId, writeContext);
      } catch (deleteErr) {
        this.deps.logger.warn(
          `[storage] field-files: could not delete the pending sys_file row ${fileId} of a failed upload ` +
            `(${(deleteErr as Error)?.message ?? deleteErr}). The pending-upload retention removes it.`,
        );
      }
      throw err;
    }
    return { fileId, size };
  }

  async describeFiles(
    fileIds: readonly string[],
    organizationId: string | null,
  ): Promise<Map<string, FieldFileDescription>> {
    const engine = this.deps.getEngine();
    if (!engine) refuse('SERVICE_UNAVAILABLE', 503, NOT_READY_MESSAGE);
    const ids = [...new Set(fileIds.filter(nonEmptyString))];
    const found = new Map<string, FieldFileDescription>();
    if (ids.length === 0) return found;
    // Which organization's files the read reaches is the driver's tenant term,
    // the lifecycle's own lookup channel. ⛔ No organization comparison here.
    const rows =
      (await engine.find('sys_file', {
        where: { id: { $in: ids } },
        limit: ids.length,
        context: systemContextIn(organizationId),
      })) ?? [];
    for (const row of rows) {
      if (row?.id == null) continue;
      found.set(String(row.id), describeRow(row));
    }
    return found;
  }

  async claimFiles(slot: FieldFileSlot, fileIds: readonly string[], organizationId: string | null): Promise<void> {
    validateSlot(slot, fileIds);
    const engine = this.deps.getEngine();
    if (!engine) refuse('SERVICE_UNAVAILABLE', 503, NOT_READY_MESSAGE);
    const ids = [...new Set(fileIds)];
    const files = await this.describeFiles(ids, organizationId);
    for (const id of ids) {
      const file = files.get(id);
      if (!file) {
        refuse(
          'RECORD_NOT_FOUND',
          404,
          `claimFiles: no file ${id} exists in ${organizationId === null ? 'this deployment' : `organization ${organizationId}`}, ` +
            `so ${slot.object}/${slot.recordId}.${slot.field} cannot own it.`,
        );
      }
      if (file.owner !== null && !isSlot(file.owner, slot)) {
        refuse(
          'RESOURCE_CONFLICT',
          409,
          `claimFiles: file ${id} is owned by ${file.owner.object}/${file.owner.recordId}.${file.owner.field}; a field ` +
            `file has one owner and is never transferred, so ${slot.object}/${slot.recordId}.${slot.field} cannot take it.`,
        );
      }
    }

    // The slot's other files are released first — the slot now holds `ids` and
    // nothing else — through the lifecycle's own release.
    const held = await ownedBySlot(engine, slot.object, slot.recordId, slot.field);
    await releaseOwnership(
      engine,
      this.deps.logger,
      held.filter((row) => !ids.includes(String(row.id))),
    );

    const store = new StorageMetadataStore(engine);
    const writeContext: StorageWriteContext = { organizationId };
    for (const id of ids) {
      const file = files.get(id)!;
      if (file.status === 'committed' && isSlot(file.owner, slot)) continue;
      await store.updateFile(
        id,
        {
          ref_object: slot.object,
          ref_id: slot.recordId,
          ref_field: slot.field,
          status: 'committed',
          deleted_at: null,
        },
        writeContext,
      );
    }
  }
}

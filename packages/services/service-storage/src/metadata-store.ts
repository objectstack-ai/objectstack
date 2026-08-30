// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';

/**
 * Persisted file metadata record (matches `sys_file` object schema).
 */
export interface FileRecord {
  id: string;
  key: string;
  name: string;
  mime_type?: string;
  size?: number;
  scope?: string;
  bucket?: string;
  acl?: string;
  status: 'pending' | 'committed' | 'deleted';
  etag?: string;
  owner_id?: string;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
  /** Orphan tombstone (#2755) — set when the last sys_attachment reference
   * is removed; the sys_file lifecycle TTL reaps after the grace window. */
  deleted_at?: string | null;
  /** Exclusive field-reference owner (ADR-0104 D3 wave 2) — the single
   * (object, record, field) slot whose value is this file's id. NULL while
   * unclaimed and for every attachments-surface file. */
  ref_object?: string | null;
  ref_id?: string | null;
  ref_field?: string | null;
  /**
   * The registry-injected tenant column (#12745).
   *
   * `sys_file` declares no `tenancy` key, so `isTenancyDisabled()` reads
   * `false` and `applySystemFields` provisions `organization_id` on every
   * install — the column's existence is decoupled from the multi-tenant flag,
   * so it is there whether or not the deployment is walled.
   *
   * ⛔ The store does NOT put this in the engine payload. Whether this object
   * carries a tenant column, and whether an explicit value wins, is the
   * DRIVER's decision (`injectTenantOnInsert` → `resolveTenantField`), reached
   * by threading the acting organization as an execution context on the insert
   * — see {@link StorageWriteContext}. It is declared here because the column
   * is real: a caller may read it back off a row, and an admin
   * cross-organization write may set it explicitly (the driver never
   * overwrites an explicit value).
   */
  organization_id?: string | null;
}

/**
 * The acting session's organization, threaded into a `sys_file` write (#12745)
 * or a `sys_upload_session` write (#12928).
 *
 * ## Why a context and not a column on the payload
 *
 * `sys_file` is a tenancy-ENABLED object whose `organization_id` was never
 * written: `createFile` inserted with no context at all, so the driver's
 * `injectTenantOnInsert` had no `tenantId` to stamp from and every row landed
 * NULL. The repair is the channel that was missing, not a second stamping
 * rule — the store hands the engine the organization it is acting in and the
 * platform's existing insert-side chokepoint decides the rest:
 *
 *   `context.tenantId` → `ObjectQLEngine.buildDriverOptions` →
 *   `DriverOptions.tenantId` → `SqlDriver.injectTenantOnInsert`
 *
 * That chokepoint already answers the two questions a metadata store must not
 * answer for itself: whether this object has a tenant column at all
 * (`resolveTenantField` → `null` ⇒ nothing is stamped, which is what keeps a
 * `systemFields: false` / `tenancy.enabled: false` install from being written
 * a column it does not have) and whether an explicit value on the row wins (it
 * does). Stamping the payload here would re-decide both, one package away from
 * the schema.
 *
 * It also silences the `[tenant-audit]` warning this insert door raises on
 * every walled deployment — a warning naming exactly this defect ("writes will
 * not be tenant-isolated").
 */
export interface StorageWriteContext {
  /**
   * The organization the write is acting in — the session's active
   * organization at the call site. Absent / empty means "no organization scope
   * resolved", and the write proceeds unstamped exactly as it did before.
   */
  organizationId?: string | null;
}

/**
 * The engine options carrying a {@link StorageWriteContext}, or `undefined`
 * when there is no organization to thread.
 *
 * `undefined` rather than `{ context: {} }` on purpose: an empty context is
 * still a context, and handing one to the engine changes what every other
 * option resolver on that call sees for a caller that has nothing to say.
 */
function writeOptionsFor(
  context?: StorageWriteContext,
): { context: { tenantId: string } } | undefined {
  const organizationId = context?.organizationId;
  if (typeof organizationId !== 'string' || organizationId.length === 0) return undefined;
  return { context: { tenantId: organizationId } };
}

/**
 * Persisted upload-session record (matches `sys_upload_session` object schema).
 */
export interface UploadSessionRecord {
  id: string;
  file_id: string;
  key: string;
  filename: string;
  mime_type?: string;
  total_size: number;
  chunk_size: number;
  total_chunks: number;
  uploaded_chunks?: number;
  uploaded_size?: number;
  parts?: string;
  resume_token?: string;
  backend_upload_id?: string;
  scope?: string;
  bucket?: string;
  metadata?: string;
  status: 'in_progress' | 'completing' | 'completed' | 'failed' | 'expired';
  started_at?: string;
  expires_at?: string;
  updated_at?: string;
  /**
   * The registry-injected tenant column (#12928) — the `sys_upload_session`
   * sibling of the `sys_file` declaration above.
   *
   * `sys_upload_session` declares no `tenancy` key either, so
   * `isTenancyDisabled()` reads `false` and `applySystemFields` provisions
   * `organization_id` on every install, walled deployment or not.
   *
   * Same division of labour as {@link FileRecord.organization_id}: the store
   * does NOT put this in the engine payload (see {@link StorageWriteContext}),
   * and it is declared here because the column is real — a caller may read it
   * back off a row, an admin cross-organization write may set it explicitly,
   * and the engine-absent stand-in records it.
   */
  organization_id?: string | null;
}

/** The `IDataEngine` operations this store issues. */
export type StorageMetadataOperation = 'insert' | 'update' | 'delete' | 'findOne';

/**
 * A `sys_file` / `sys_upload_session` operation failed against a data engine
 * that IS wired (#5216).
 *
 * This is deliberately NOT the same condition as "no data engine" — that one
 * is served by the process-local Map and is not an error at all. An engine
 * that is present and failing is a constraint violation, a connection blip, an
 * RLS refusal or a missing table, and every one of those means the row the
 * caller was told about does not exist. Swallowing it (what this store did
 * until #5216) turns a diagnosable error into lost business truth: the bytes
 * land in the backend, `sys_file` never records them, and the API answers 200.
 *
 * `message` carries the two things AGENTS.md → "Degradation log levels" makes
 * a durability failure owe — the CONSEQUENCE (what is not persisted) and the
 * FIX — because that string is what reaches the operator, through the REST
 * layer's 500 body and through whatever logs the host keeps.
 */
export class StorageMetadataStoreError extends Error {
  override readonly name = 'StorageMetadataStoreError';
  /** The object the failed operation targeted (`sys_file` / `sys_upload_session`). */
  readonly objectName: string;
  /** The `IDataEngine` method that threw. */
  readonly operation: StorageMetadataOperation;
  /**
   * The engine failure this wraps.
   *
   * Declared here rather than inherited: this package compiles against
   * `lib: ES2020`, which predates `Error.cause` — so the field, and the
   * assignment in the constructor, are the whole of it.
   */
  readonly cause: unknown;

  constructor(
    objectName: string,
    operation: StorageMetadataOperation,
    consequence: string,
    cause: unknown,
  ) {
    super(
      `StorageMetadataStore: ${objectName} ${operation} failed against the data engine — ${consequence} ` +
        'Restore the data engine (connectivity / permissions / `' +
        objectName +
        '` schema migration); the process-local Map fallback serves only ' +
        'deployments with NO engine wired (tests, dev), so it cannot stand in here. ' +
        `Cause: ${describeCause(cause)}`,
    );
    this.objectName = objectName;
    this.operation = operation;
    this.cause = cause;
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}

// ---------------------------------------------------------------------------
// Consequence lines — one per (object, operation), stated as what is NOT true
// anymore if this call is allowed to fail quietly.
// ---------------------------------------------------------------------------

const FILE_INSERT_CONSEQUENCE =
  'the sys_file row was NOT written, so the uploaded bytes have no durable record and are unaddressable after this process exits.';
const FILE_UPDATE_CONSEQUENCE =
  'the sys_file row still holds its pre-update contents, so a commit / status / key change the caller is about to be told succeeded did not land.';
const FILE_DELETE_CONSEQUENCE =
  'the sys_file row is still present, so a file reported as deleted remains addressable.';
const FILE_READ_CONSEQUENCE =
  'the row could not be read at all, which is NOT the same as it being absent — answering "not found" here would report durable business truth as missing.';

const SESSION_INSERT_CONSEQUENCE =
  'the sys_upload_session row was NOT written, so subsequent chunk requests — which may land on any worker — cannot find this upload.';
const SESSION_UPDATE_CONSEQUENCE =
  'the persisted upload progress is stale, so resuming or completing this upload will read the wrong part list.';
const SESSION_DELETE_CONSEQUENCE =
  'the sys_upload_session row is still present, so an upload reported as cleaned up is still resumable.';
const SESSION_READ_CONSEQUENCE =
  'the row could not be read at all, which is NOT the same as it being absent — answering "upload session not found" here would abort a live upload.';

/**
 * Storage metadata persistence.
 *
 * Backed by `IDataEngine` (objectql). The process-local `Map` is the
 * **engine-absent stand-in** — what `new StorageMetadataStore(null)` gets in
 * tests and in dev environments where the data engine isn't wired up. It is
 * not a runtime fallback: when an engine IS present every read and write goes
 * to it and nothing is mirrored into the Map, so no in-process shadow can make
 * a write that never landed look like it did (#5216).
 *
 * **A wired engine that fails is not an absent engine**, and this store no
 * longer conflates the two. Every engine call propagates its failure as a
 * {@link StorageMetadataStoreError}; the REST layer turns that into a 500
 * instead of the 200 it used to answer over a `sys_file` row that was never
 * written. `sys_file` is mostly-permanent business truth with compliance value
 * (#5202), and a durability failure that still looks normal from the outside
 * is precisely what AGENTS.md → "Degradation log levels" forbids.
 *
 * **A miss is still a miss.** `findOne` returning nothing means the row is not
 * there, and the reader gets `null` (the REST layer answers 404). Only a
 * thrown engine error — an outage — propagates. Silently substituting this
 * process's Map for an unreachable engine would be worse than either: under
 * multiple workers the Map holds only this process's shadow, so the "read"
 * would dress a stale or empty local guess up as the persisted answer.
 */
export class StorageMetadataStore {
  private readonly files = new Map<string, FileRecord>();
  private readonly sessions = new Map<string, UploadSessionRecord>();

  constructor(private readonly engine: IDataEngine | null) {}

  /**
   * Run one engine call, converting any failure into a
   * {@link StorageMetadataStoreError} that names the consequence and the fix.
   */
  private async engineOp<T>(
    objectName: string,
    operation: StorageMetadataOperation,
    consequence: string,
    run: (engine: IDataEngine) => Promise<T>,
  ): Promise<T> {
    try {
      return await run(this.engine!);
    } catch (cause) {
      throw new StorageMetadataStoreError(objectName, operation, consequence, cause);
    }
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  /**
   * Insert one `sys_file` row.
   *
   * `context` carries the acting organization (#12745). With it the insert
   * reaches the engine as `{ context: { tenantId } }`, which is how
   * `sys_file.organization_id` gets written at all — see
   * {@link StorageWriteContext} for the chain and for why the column is not
   * stamped onto the payload here. Without it the call behaves exactly as it
   * did before: the row lands unstamped.
   */
  async createFile(rec: FileRecord, context?: StorageWriteContext): Promise<FileRecord> {
    const now = new Date().toISOString();
    const full: FileRecord = { created_at: now, updated_at: now, ...rec };
    const options = writeOptionsFor(context);
    if (!this.engine) {
      // The engine-absent stand-in has no schema to ask, so it records what it
      // was told rather than deriving a column: a no-engine deployment has no
      // wall to be on the wrong side of, and a test driving this path still
      // observes the organization the caller threaded. An explicit value on
      // the record wins, mirroring `injectTenantOnInsert`'s rule.
      const stamped: FileRecord =
        options && full.organization_id == null
          ? { ...full, organization_id: options.context.tenantId }
          : full;
      this.files.set(stamped.id, stamped);
      return stamped;
    }
    await this.engineOp('sys_file', 'insert', FILE_INSERT_CONSEQUENCE, (engine) =>
      engine.insert('sys_file', full, options),
    );
    return full;
  }

  async getFile(id: string): Promise<FileRecord | null> {
    if (!this.engine) return this.files.get(id) ?? null;
    const found = await this.engineOp('sys_file', 'findOne', FILE_READ_CONSEQUENCE, (engine) =>
      engine.findOne('sys_file', { where: { id } }),
    );
    return (found as FileRecord | null | undefined) ?? null;
  }

  async updateFile(id: string, patch: Partial<FileRecord>): Promise<FileRecord | null> {
    const existing = await this.getFile(id);
    if (!existing) return null;
    const merged: FileRecord = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
    if (!this.engine) {
      this.files.set(id, merged);
      return merged;
    }
    await this.engineOp('sys_file', 'update', FILE_UPDATE_CONSEQUENCE, (engine) =>
      engine.update('sys_file', merged as any, { where: { id } } as any),
    );
    return merged;
  }

  async deleteFile(id: string): Promise<void> {
    if (!this.engine) {
      this.files.delete(id);
      return;
    }
    await this.engineOp('sys_file', 'delete', FILE_DELETE_CONSEQUENCE, (engine) =>
      engine.delete('sys_file', { where: { id } } as any),
    );
  }

  // ---------------------------------------------------------------------------
  // Upload sessions
  // ---------------------------------------------------------------------------

  /**
   * Insert one `sys_upload_session` row.
   *
   * `context` carries the acting organization (#12928). It is the same channel,
   * the same chokepoint and the same reasoning as {@link createFile} (#12745):
   * with it the insert reaches the engine as `{ context: { tenantId } }`, which
   * is how `sys_upload_session.organization_id` gets written at all — see
   * {@link StorageWriteContext} for the chain and for why the column is not
   * stamped onto the payload here. Without it the call behaves exactly as it
   * did before: the row lands unstamped.
   *
   * ⚠️ Ruled scope (maintainer, 2026-08-29, verbatim and untranslated: 「同意」):
   * FORWARD STAMP ONLY. Rows that are already NULL are deliberately not
   * repaired — they age out through this object's own ADR-0057 TTL sweep
   * (`lifecycle.ttl`, keyed on `expires_at`). That premise is not assumed here:
   * `sys-upload-session-ttl-sweep.test.ts` drives the real declaration through
   * the real Reaper against live SQL, because if the sweep were dead the
   * no-backfill half of the ruling would fall with it.
   */
  async createSession(
    rec: UploadSessionRecord,
    context?: StorageWriteContext,
  ): Promise<UploadSessionRecord> {
    const now = new Date().toISOString();
    const full: UploadSessionRecord = {
      uploaded_chunks: 0,
      uploaded_size: 0,
      parts: '[]',
      started_at: now,
      updated_at: now,
      ...rec,
    };
    const options = writeOptionsFor(context);
    if (!this.engine) {
      // Mirrors `createFile`'s stand-in exactly: no schema to ask, so it
      // records what it was told, and an explicit value on the record wins
      // just as `injectTenantOnInsert` lets it.
      const stamped: UploadSessionRecord =
        options && full.organization_id == null
          ? { ...full, organization_id: options.context.tenantId }
          : full;
      this.sessions.set(stamped.id, stamped);
      return stamped;
    }
    await this.engineOp('sys_upload_session', 'insert', SESSION_INSERT_CONSEQUENCE, (engine) =>
      engine.insert('sys_upload_session', full, options),
    );
    return full;
  }

  async getSession(id: string): Promise<UploadSessionRecord | null> {
    if (!this.engine) return this.sessions.get(id) ?? null;
    const found = await this.engineOp(
      'sys_upload_session',
      'findOne',
      SESSION_READ_CONSEQUENCE,
      (engine) => engine.findOne('sys_upload_session', { where: { id } }),
    );
    return (found as UploadSessionRecord | null | undefined) ?? null;
  }

  async updateSession(id: string, patch: Partial<UploadSessionRecord>): Promise<UploadSessionRecord | null> {
    const existing = await this.getSession(id);
    if (!existing) return null;
    const merged: UploadSessionRecord = {
      ...existing,
      ...patch,
      id,
      updated_at: new Date().toISOString(),
    };
    if (!this.engine) {
      this.sessions.set(id, merged);
      return merged;
    }
    await this.engineOp('sys_upload_session', 'update', SESSION_UPDATE_CONSEQUENCE, (engine) =>
      engine.update('sys_upload_session', merged as any, { where: { id } } as any),
    );
    return merged;
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.engine) {
      this.sessions.delete(id);
      return;
    }
    await this.engineOp('sys_upload_session', 'delete', SESSION_DELETE_CONSEQUENCE, (engine) =>
      engine.delete('sys_upload_session', { where: { id } } as any),
    );
  }
}

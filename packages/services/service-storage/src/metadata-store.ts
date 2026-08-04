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

  async createFile(rec: FileRecord): Promise<FileRecord> {
    const now = new Date().toISOString();
    const full: FileRecord = { created_at: now, updated_at: now, ...rec };
    if (!this.engine) {
      this.files.set(full.id, full);
      return full;
    }
    await this.engineOp('sys_file', 'insert', FILE_INSERT_CONSEQUENCE, (engine) =>
      engine.insert('sys_file', full),
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

  async createSession(rec: UploadSessionRecord): Promise<UploadSessionRecord> {
    const now = new Date().toISOString();
    const full: UploadSessionRecord = {
      uploaded_chunks: 0,
      uploaded_size: 0,
      parts: '[]',
      started_at: now,
      updated_at: now,
      ...rec,
    };
    if (!this.engine) {
      this.sessions.set(full.id, full);
      return full;
    }
    await this.engineOp('sys_upload_session', 'insert', SESSION_INSERT_CONSEQUENCE, (engine) =>
      engine.insert('sys_upload_session', full),
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

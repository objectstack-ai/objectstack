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

/**
 * Storage metadata persistence.
 *
 * Backed by `IDataEngine` (objectql) when available — otherwise falls back to
 * a process-local Map (suitable for tests and dev environments where the
 * data engine isn't wired up).
 */
export class StorageMetadataStore {
  private readonly files = new Map<string, FileRecord>();
  private readonly sessions = new Map<string, UploadSessionRecord>();

  constructor(private readonly engine: IDataEngine | null) {}

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  async createFile(rec: FileRecord): Promise<FileRecord> {
    const now = new Date().toISOString();
    const full: FileRecord = { created_at: now, updated_at: now, ...rec };
    this.files.set(full.id, full);
    if (this.engine) {
      try {
        await this.engine.insert('sys_file', full);
      } catch {
        /* engine not available or schema not migrated — keep in-memory only */
      }
    }
    return full;
  }

  async getFile(id: string): Promise<FileRecord | null> {
    if (this.engine) {
      try {
        const found = await this.engine.findOne('sys_file', { where: { id } });
        if (found) return found as FileRecord;
      } catch {
        /* fall through to memory */
      }
    }
    return this.files.get(id) ?? null;
  }

  async updateFile(id: string, patch: Partial<FileRecord>): Promise<FileRecord | null> {
    const existing = await this.getFile(id);
    if (!existing) return null;
    const merged: FileRecord = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
    this.files.set(id, merged);
    if (this.engine) {
      try {
        await this.engine.update('sys_file', merged as any, { where: { id } } as any);
      } catch {
        /* ignore */
      }
    }
    return merged;
  }

  async deleteFile(id: string): Promise<void> {
    this.files.delete(id);
    if (this.engine) {
      try {
        await this.engine.delete('sys_file', { where: { id } } as any);
      } catch {
        /* ignore */
      }
    }
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
    this.sessions.set(full.id, full);
    if (this.engine) {
      try {
        await this.engine.insert('sys_upload_session', full);
      } catch {
        /* ignore */
      }
    }
    return full;
  }

  async getSession(id: string): Promise<UploadSessionRecord | null> {
    if (this.engine) {
      try {
        const found = await this.engine.findOne('sys_upload_session', { where: { id } });
        if (found) return found as UploadSessionRecord;
      } catch {
        /* ignore */
      }
    }
    return this.sessions.get(id) ?? null;
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
    this.sessions.set(id, merged);
    if (this.engine) {
      try {
        await this.engine.update('sys_upload_session', merged as any, { where: { id } } as any);
      } catch {
        /* ignore */
      }
    }
    return merged;
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    if (this.engine) {
      try {
        await this.engine.delete('sys_upload_session', { where: { id } } as any);
      } catch {
        /* ignore */
      }
    }
  }
}

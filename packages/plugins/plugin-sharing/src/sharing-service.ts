// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  ISharingService,
  RecordShare,
  GrantShareInput,
  SharingExecutionContext,
  ShareAccessLevel,
} from '@objectstack/spec/contracts';

/**
 * Shape of the data engine the service actually needs. Kept narrow so
 * unit tests can pass an in-memory fake without depending on the full
 * ObjectQL engine class.
 */
export interface SharingEngine {
  find(object: string, options?: any): Promise<any[]>;
  findOne?(object: string, options?: any): Promise<any>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, idOrData: any, dataOrOptions?: any, options?: any): Promise<any>;
  delete(object: string, options?: any): Promise<any>;
  getSchema?(object: string): any | undefined;
}

/**
 * Random share id. Keeps the plugin self-contained (no `crypto.randomUUID`
 * dependency in environments that don't expose it on `globalThis`).
 */
function makeShareId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `shr_${g.crypto.randomUUID()}`;
  return `shr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** System-elevated context for the plugin's own queries / mutations. */
const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;

/**
 * Owner field convention. Hard-coded to `owner_id` for MVP — the
 * sharing model in Salesforce / ServiceNow / Dynamics all assume a
 * single owner field, and customising it is a follow-up. Objects
 * without `owner_id` are treated as "unowned" and read filters are
 * suppressed (they fall back to OWD-public behaviour).
 */
const OWNER_FIELD = 'owner_id';

/**
 * Effective sharing model — collapses the authorable OWD vocabulary onto the
 * three behaviours this service enforces (ADR-0056 D1):
 *   - `private`                         → owner-only read + write
 *   - `public_read` / legacy `read`     → everyone reads, owner writes
 *   - everything else                   → public (no record-level filter)
 *
 * "Everything else" covers the canonical `public_read_write`, the legacy
 * `read_write` / `full` aliases, `controlled_by_parent` (scoped separately by
 * the security plugin), and objects that declare no `sharingModel` at all — so
 * existing behaviour is preserved until an admin opts an object in.
 */
function effectiveSharingModel(schema: any): 'private' | 'read' | 'public' {
  const m = schema?.sharingModel ?? schema?.security?.sharingModel;
  if (m === 'private') return 'private';
  if (m === 'read' || m === 'public_read') return 'read';
  return 'public';
}

function hasOwnerField(schema: any): boolean {
  return Boolean(schema?.fields && OWNER_FIELD in schema.fields);
}

export interface SharingServiceOptions {
  engine: SharingEngine;
  /** Object names that bypass sharing — typically platform internals. */
  bypassObjects?: string[];
}

/**
 * Default `ISharingService` implementation.
 *
 * Stores every grant in `sys_record_share`. The plugin layer registers
 * an engine middleware that calls `buildReadFilter` / `canEdit` so that
 * neither this class nor its callers need to know about middleware
 * plumbing.
 */
export class SharingService implements ISharingService {
  private readonly engine: SharingEngine;
  private readonly bypassObjects: Set<string>;

  constructor(options: SharingServiceOptions) {
    this.engine = options.engine;
    this.bypassObjects = new Set([
      'sys_record_share',
      'sys_user',
      'sys_organization',
      'sys_member',
      'sys_role',
      'sys_permission_set',
      'sys_user_permission_set',
      'sys_role_permission_set',
      ...(options.bypassObjects ?? []),
    ]);
  }

  /**
   * Build a `FilterCondition` restricting `find` to records the caller
   * may see. Returns `null` when no filter should be applied.
   */
  async buildReadFilter(
    object: string,
    context: SharingExecutionContext,
  ): Promise<unknown | null> {
    if (this.shouldBypass(object, context)) return null;

    const schema = this.engine.getSchema?.(object);
    if (!schema) return null;
    if (effectiveSharingModel(schema) !== 'private') return null;
    if (!hasOwnerField(schema)) return null;
    if (!context.userId) {
      // Authenticated context with no user id is a degenerate case
      // (e.g. anonymous API key). Restrict to nothing rather than
      // accidentally leaking owner-only data.
      return { id: '__deny_all__' };
    }

    const grants = await this.engine.find('sys_record_share', {
      filter: {
        object_name: object,
        recipient_type: 'user',
        recipient_id: context.userId,
      },
      fields: ['record_id', 'access_level'],
      limit: 5000,
      context: SYSTEM_CTX,
    });

    const grantedIds: string[] = Array.isArray(grants)
      ? grants.map((g: any) => String(g.record_id)).filter(Boolean)
      : [];

    if (grantedIds.length === 0) {
      return { [OWNER_FIELD]: context.userId };
    }

    return {
      $or: [
        { [OWNER_FIELD]: context.userId },
        { id: { $in: grantedIds } },
      ],
    };
  }

  /**
   * Return `true` if the caller may edit `(object, recordId)`. Always
   * `true` for system context, public objects, and objects without an
   * owner field.
   */
  async canEdit(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<boolean> {
    if (this.shouldBypass(object, context)) return true;

    const schema = this.engine.getSchema?.(object);
    if (!schema) return true;
    const model = effectiveSharingModel(schema);
    if (model === 'public') return true;
    if (!hasOwnerField(schema)) return true;
    if (!context.userId) return false;

    // 1) Ownership — fast path.
    const own = await this.engine.find(object, {
      filter: { id: recordId },
      fields: ['id', OWNER_FIELD],
      limit: 1,
      context: SYSTEM_CTX,
    });
    const owner = Array.isArray(own) && own[0] ? (own[0] as any)[OWNER_FIELD] : undefined;
    if (owner && String(owner) === String(context.userId)) return true;

    // 2) Explicit edit / full share.
    const editGrants = await this.engine.find('sys_record_share', {
      filter: {
        object_name: object,
        record_id: recordId,
        recipient_type: 'user',
        recipient_id: context.userId,
        access_level: { $in: ['edit', 'full'] },
      },
      fields: ['id'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    return Array.isArray(editGrants) && editGrants.length > 0;
  }

  /**
   * Upsert a share row. Returning the existing row when an identical
   * grant already exists keeps the REST endpoint idempotent.
   */
  async grant(
    input: GrantShareInput,
    context: SharingExecutionContext,
  ): Promise<RecordShare> {
    if (!input.object) throw new Error('VALIDATION_FAILED: object is required');
    if (!input.recordId) throw new Error('VALIDATION_FAILED: recordId is required');
    if (!input.recipientId) throw new Error('VALIDATION_FAILED: recipientId is required');

    const recipientType = input.recipientType ?? 'user';
    const accessLevel: ShareAccessLevel = input.accessLevel ?? 'read';
    const source = input.source ?? 'manual';

    // Upsert: if a row with same (object, record, recipient) exists,
    // update its access level / reason; otherwise insert a new one.
    const existing = await this.engine.find('sys_record_share', {
      filter: {
        object_name: input.object,
        record_id: input.recordId,
        recipient_type: recipientType,
        recipient_id: input.recipientId,
      },
      limit: 1,
      context: SYSTEM_CTX,
    });
    const now = new Date().toISOString();
    if (Array.isArray(existing) && existing[0]) {
      const row: any = existing[0];
      const patch: any = {
        id: row.id,
        access_level: accessLevel,
        source,
        source_id: input.sourceId ?? row.source_id ?? null,
        reason: input.reason ?? row.reason ?? null,
        updated_at: now,
      };
      await this.engine.update('sys_record_share', patch, { context: SYSTEM_CTX });
      return { ...row, ...patch } as RecordShare;
    }

    const id = makeShareId();
    const row: any = {
      id,
      object_name: input.object,
      record_id: input.recordId,
      recipient_type: recipientType,
      recipient_id: input.recipientId,
      access_level: accessLevel,
      source,
      source_id: input.sourceId ?? null,
      granted_by: context.userId ?? null,
      reason: input.reason ?? null,
      created_at: now,
      updated_at: now,
    };
    await this.engine.insert('sys_record_share', row, { context: SYSTEM_CTX });
    return row as RecordShare;
  }

  /** Delete a share row by id. No-op when not found. */
  async revoke(shareId: string, _context: SharingExecutionContext): Promise<void> {
    if (!shareId) throw new Error('VALIDATION_FAILED: shareId is required');
    await this.engine.delete('sys_record_share', {
      where: { id: shareId },
      context: SYSTEM_CTX,
    });
  }

  /** List share rows for `(object, recordId)`. */
  async listShares(
    object: string,
    recordId: string,
    _context: SharingExecutionContext,
  ): Promise<RecordShare[]> {
    const rows = await this.engine.find('sys_record_share', {
      filter: { object_name: object, record_id: recordId },
      orderBy: [{ field: 'created_at', order: 'desc' }],
      limit: 500,
      context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? (rows as RecordShare[]) : [];
  }

  // ── helpers ──────────────────────────────────────────────────────

  private shouldBypass(object: string, context: SharingExecutionContext): boolean {
    if (context?.isSystem) return true;
    if (this.bypassObjects.has(object)) return true;
    return false;
  }
}

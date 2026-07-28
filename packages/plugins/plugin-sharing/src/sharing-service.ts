// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  ISharingService,
  IHierarchyScopeResolver,
  RecordShare,
  GrantShareInput,
  SharingExecutionContext,
  ShareAccessLevel,
} from '@objectstack/spec/contracts';
import { WRITE_ACCESS_LEVELS, normalizeAccessLevel } from './access-level.js';

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
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

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
 * three behaviours this service enforces:
 *   - `private`              → owner-only read + write
 *   - `public_read`          → everyone reads, owner writes
 *   - `public_read_write`    → public (no record-level filter)
 *   - `controlled_by_parent` → public here (scoped separately by the
 *                              security plugin's master-detail path, ADR-0055)
 *
 * [ADR-0090 D1] Secure default: a CUSTOM object (not `sys_*`, not
 * `isSystem`) that declares NO `sharingModel` resolves to **`private`** —
 * the former fall-through-to-public default silently granted org-wide
 * read/write to any C/R/U grant holder (the objectui#2348 incident).
 * System/platform objects keep their explicit ADR-0066 posture and the
 * bypass list; an unset model on them stays public as before.
 *
 * [ADR-0090 D4] The legacy aliases (`read`/`read_write`/`full`) no longer
 * parse at authoring. A stored value this function does not recognise
 * fails CLOSED to `private` (never silently public).
 */
function effectiveSharingModel(schema: any): 'private' | 'read' | 'public' {
  const m = schema?.sharingModel ?? schema?.security?.sharingModel;
  if (m === 'private') return 'private';
  if (m === 'public_read') return 'read';
  if (m === 'public_read_write' || m === 'controlled_by_parent') return 'public';
  if (m == null) {
    const isSystem = schema?.isSystem === true || String(schema?.name ?? '').startsWith('sys_');
    return isSystem ? 'public' : 'private';
  }
  return 'private';
}

function hasOwnerField(schema: any): boolean {
  return Boolean(schema?.fields && OWNER_FIELD in schema.fields);
}

export interface SharingServiceOptions {
  engine: SharingEngine;
  /** Object names that bypass sharing — typically platform internals. */
  bypassObjects?: string[];
  /**
   * [ADR-0057] Late-bound lookup for the enterprise hierarchy-scope resolver
   * (`hierarchy-scope-resolver` service). Returns null in the open edition.
   */
  hierarchyResolver?: () => IHierarchyScopeResolver | null | undefined;
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
  private readonly hierarchyResolver?: () => IHierarchyScopeResolver | null | undefined;

  constructor(options: SharingServiceOptions) {
    this.engine = options.engine;
    this.hierarchyResolver = options.hierarchyResolver;
    this.bypassObjects = new Set([
      'sys_record_share',
      'sys_user',
      'sys_organization',
      'sys_member',
      'sys_position',
      'sys_permission_set',
      'sys_user_permission_set',
      'sys_position_permission_set',
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

    // [ADR-0057 D1] Access DEPTH widens the owner-match for this grant:
    // own → [me], unit → my BU members, unit_and_below → my BU subtree, org →
    // no owner filter. Sharing grants are still OR-ed in on top (additive).
    const readScope = (context as any).__readScope as ('own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined);
    if (readScope === 'org') return null;
    const ownerIds = await this.resolveOwnerScopeIds(context, readScope);
    const ownerMatch: Record<string, unknown> = ownerIds.length === 1
      ? { [OWNER_FIELD]: ownerIds[0] }
      : { [OWNER_FIELD]: { $in: ownerIds } };

    const grants = await this.engine.find('sys_record_share', {
      where: {
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
      return ownerMatch;
    }

    return {
      $or: [
        ownerMatch,
        { id: { $in: grantedIds } },
      ],
    };
  }

  /**
   * Build a `FilterCondition` restricting a **bulk** (multi-row) write to the
   * records the caller may edit — the write analogue of {@link buildReadFilter}.
   * Single-id writes are gated by {@link canEdit}; a `update({multi:true})` /
   * `deleteMany` has no single id, so without this filter it would touch every
   * matching row regardless of ownership (#2982). Returns `null` when no
   * restriction applies (system/bypass, public objects, no owner field).
   *
   * Editable-set = owner-match (widened by write DEPTH) OR records shared to
   * the caller at a {@link WRITE_ACCESS_LEVELS} level. Unlike reads, this
   * applies to BOTH `private` and `read` (public_read) models — public_read is
   * read-open but write-owned; only a fully `public` object is write-open.
   */
  async buildWriteFilter(
    object: string,
    context: SharingExecutionContext,
  ): Promise<unknown | null> {
    if (this.shouldBypass(object, context)) return null;

    const schema = this.engine.getSchema?.(object);
    if (!schema) return null;
    if (effectiveSharingModel(schema) === 'public') return null;
    if (!hasOwnerField(schema)) return null;
    if (!context.userId) {
      // Authenticated but principal-less → edit nothing (fail closed),
      // mirroring buildReadFilter's degenerate-context handling.
      return { id: '__deny_all__' };
    }

    const writeScope = (context as any).__writeScope as ('own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined);
    if (writeScope === 'org') return null;
    const ownerIds = await this.resolveOwnerScopeIds(context, writeScope);
    const ownerMatch: Record<string, unknown> = ownerIds.length === 1
      ? { [OWNER_FIELD]: ownerIds[0] }
      : { [OWNER_FIELD]: { $in: ownerIds } };

    const grants = await this.engine.find('sys_record_share', {
      where: {
        object_name: object,
        recipient_type: 'user',
        recipient_id: context.userId,
        access_level: { $in: [...WRITE_ACCESS_LEVELS] },
      },
      fields: ['record_id'],
      limit: 5000,
      context: SYSTEM_CTX,
    });
    const grantedIds: string[] = Array.isArray(grants)
      ? grants.map((g: any) => String(g.record_id)).filter(Boolean)
      : [];

    if (grantedIds.length === 0) return ownerMatch;
    return { $or: [ownerMatch, { id: { $in: grantedIds } }] };
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

    // 1) Ownership (write DEPTH widens the owner-set) — fast path.
    const own = await this.engine.find(object, {
      where: { id: recordId },
      fields: ['id', OWNER_FIELD],
      limit: 1,
      context: SYSTEM_CTX,
    });
    const owner = Array.isArray(own) && own[0] ? (own[0] as any)[OWNER_FIELD] : undefined;
    if (owner != null) {
      const writeScope = (context as any).__writeScope as ('own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined);
      if (writeScope === 'org') return true;
      const owners = await this.resolveOwnerScopeIds(context, writeScope);
      if (owners.includes(String(owner))) return true;
    }

    // 2) Explicit write-level share (`edit`, plus not-yet-normalised `full`).
    const editGrants = await this.engine.find('sys_record_share', {
      where: {
        object_name: object,
        record_id: recordId,
        recipient_type: 'user',
        recipient_id: context.userId,
        access_level: { $in: [...WRITE_ACCESS_LEVELS] },
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
    // Validate BEFORE any write. Previously anything at all was persisted
    // verbatim, so a typo'd level became a grant that no gate ever matched — a
    // share row that looks granted and enforces nothing (#3865). `full`
    // normalises to `edit` (what it always meant); everything unrecognised is a
    // loud VALIDATION_FAILED the REST layer maps to 400.
    const accessLevel: ShareAccessLevel = normalizeAccessLevel(input.accessLevel, 'read');
    const source = input.source ?? 'manual';

    // Upsert: if a row with same (object, record, recipient) exists,
    // update its access level / reason; otherwise insert a new one.
    const existing = await this.engine.find('sys_record_share', {
      where: {
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
      where: { object_name: object, record_id: recordId },
      orderBy: [{ field: 'created_at', order: 'desc' }],
      limit: 500,
      context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? (rows as RecordShare[]) : [];
  }

  // ── helpers ──────────────────────────────────────────────────────

  /**
   * [ADR-0057] Resolve the owner-id set for a DEPTH scope. `own`/unset/`org`
   * resolve locally to the caller. HIERARCHY scopes (`unit` / `unit_and_below`
   * / `own_and_reports`) are an ENTERPRISE capability resolved by a pluggable
   * {@link IHierarchyScopeResolver} (`hierarchy-scope-resolver` service, shipped
   * only by `@objectstack/security-enterprise`). The open edition has none, so
   * this fails CLOSED to owner-only — a hierarchy scope NEVER widens without the
   * enterprise resolver (the spec gate also refuses to compile such a grant).
   */
  private async resolveOwnerScopeIds(
    context: SharingExecutionContext,
    scope: 'own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined,
  ): Promise<string[]> {
    const me = String((context as any).userId);
    if (!scope || scope === 'own' || scope === 'org') return [me];
    const resolver = this.hierarchyResolver?.();
    if (!resolver) return [me];
    try {
      const ids = await resolver.resolveOwnerIds(
        {
          userId: me,
          organizationId: (context as any).organizationId ?? null,
          tenantId: (context as any).tenantId ?? null,
        },
        scope,
      );
      return Array.isArray(ids) && ids.length > 0 ? ids : [me];
    } catch {
      return [me];
    }
  }

  private shouldBypass(object: string, context: SharingExecutionContext): boolean {
    if (context?.isSystem) return true;
    if (this.bypassObjects.has(object)) return true;
    return false;
  }
}

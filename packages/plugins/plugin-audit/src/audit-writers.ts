// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { HookContext } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/spec/contracts';

/**
 * Minimal structural view of `NotificationService.emit` (ADR-0030). Declared
 * locally so plugin-audit takes no runtime dependency on service-messaging — it
 * resolves whatever object is registered under the `messaging` service at hook
 * time and routes collaboration notifications through the single ingress.
 */
export interface MessagingEmitSurface {
  emit(input: {
    topic: string;
    audience: string[];
    payload?: Record<string, unknown>;
    severity?: 'info' | 'warning' | 'critical';
    dedupKey?: string;
    source?: { object: string; id: string };
    actorId?: string;
    organizationId?: string;
  }): Promise<unknown>;
}

/** Options for {@link installAuditWriters}. */
export interface AuditWriterOptions {
  /**
   * Lazily resolve the messaging service so collaboration `@mention` /
   * assignment notifications go through the ADR-0030 single ingress rather than
   * writing `sys_notification` directly. Returns `undefined` when messaging is
   * not installed — those notifications are then skipped (no pipeline, no bell),
   * matching the `notify` node's degradation.
   */
  getMessaging?(): MessagingEmitSurface | undefined;
}

/**
 * Audit writer hook installer.
 *
 * Subscribes to the ObjectQL engine's wildcard `before*` / `after*` lifecycle
 * events and writes:
 *
 *  - `sys_audit_log` rows — immutable, compliance-grade entries with
 *    field-level `old_value` / `new_value` diffs.
 *  - `sys_activity` rows — denormalized, human-readable summaries shown
 *    in the dashboard recent-activity feed and per-record timelines.
 *
 * Skip rules avoid recursion and noise:
 *  - Never audit the audit/activity tables themselves.
 *  - Never audit session/presence/auth tables (high-frequency, low value).
 *  - Read-only operations (`afterFind`) are never audited.
 *
 * All writes go through `ctx.api.sudo()` so they bypass record-level
 * permissions and always succeed regardless of the calling user's RBAC.
 */

/** Tables that are intentionally excluded from audit/activity writes. */
const SKIP_OBJECTS = new Set<string>([
  'sys_audit_log',
  'sys_activity',
  'sys_comment',
  'sys_session',
  'sys_presence',
  'sys_account',
  'sys_account_session',
  'sys_account_verification',
  'sys_account_account',
]);

/** Fields that are noise in diffs (always change, never user-meaningful). */
const NOISE_FIELDS = new Set<string>([
  'updated_at',
  'updated_by',
  'created_at',
  'created_by',
]);

/** Action name produced from a HookContext.event string. */
function actionFor(event: string): 'create' | 'update' | 'delete' | null {
  if (event === 'afterInsert') return 'create';
  if (event === 'afterUpdate') return 'update';
  if (event === 'afterDelete') return 'delete';
  return null;
}

/** Activity type produced from an audit action. */
function activityTypeFor(action: 'create' | 'update' | 'delete'): 'created' | 'updated' | 'deleted' {
  return action === 'create' ? 'created' : action === 'update' ? 'updated' : 'deleted';
}

/**
 * Compute the human-readable record label from a record by trying common
 * label fields. Falls back to record id.
 */
function recordLabel(record: any, id: string): string {
  if (!record || typeof record !== 'object') return id;
  const candidates = ['name', 'subject', 'title', 'full_name', 'label', 'first_name', 'company', 'email'];
  for (const k of candidates) {
    const v = record[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return id;
}

/**
 * Compute a shallow JSON diff between two records. Returns only keys whose
 * value changed (and ignores keys in `NOISE_FIELDS`). Both sides are
 * serialisable via `JSON.stringify` — values that fail to serialise are
 * coerced to `String(value)`.
 */
function diff(before: Record<string, any>, after: Record<string, any>): { old: Record<string, any>; next: Record<string, any> } {
  const oldOut: Record<string, any> = {};
  const newOut: Record<string, any> = {};
  const keys = new Set<string>([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (NOISE_FIELDS.has(k)) continue;
    const b = before?.[k];
    const a = after?.[k];
    if (safeStringify(b) !== safeStringify(a)) {
      oldOut[k] = b ?? null;
      newOut[k] = a ?? null;
    }
  }
  return { old: oldOut, next: newOut };
}

function safeStringify(v: any): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * Resolve a field value to its display string, preferring a select/picklist
 * option label over the raw stored value. Empty/missing → "∅".
 */
function displayFieldValue(field: any, value: any): string {
  if (value === null || value === undefined || value === '') return '∅';
  const options = field?.options;
  if (Array.isArray(options)) {
    for (const o of options) {
      const ov = o && typeof o === 'object' ? (o.value ?? o.name ?? o.label) : o;
      if (ov === value) {
        const ol = o && typeof o === 'object' ? (o.label ?? o.name ?? ov) : o;
        return String(ol);
      }
    }
  }
  return String(value);
}

/**
 * ADR-0052 §5b — declarative activity. For fields declared `trackHistory: true`,
 * render the diff the writer already captured as a human-readable timeline
 * summary ("Stage: Proposal → Closed Won"; multiple changes joined by "; "),
 * using the field label and select option labels. Returns null when no tracked
 * field changed, so the caller falls back to the generic "Updated <object>".
 */
function renderTrackedChangeSummary(
  fields: Record<string, any> | undefined | null,
  oldVals: Record<string, any> | null,
  newVals: Record<string, any> | null,
): string | null {
  if (!fields || !newVals) return null;
  const parts: string[] = [];
  for (const key of Object.keys(newVals)) {
    const field = fields[key];
    if (!field || field.trackHistory !== true) continue;
    const label = (typeof field.label === 'string' && field.label) || key;
    const from = displayFieldValue(field, oldVals ? oldVals[key] : undefined);
    const to = displayFieldValue(field, newVals[key]);
    parts.push(`${label}: ${from} → ${to}`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * Install audit + activity writers on the given engine. Idempotent per
 * `packageId` — calling twice with the same id replaces the previous
 * registration.
 */
export function installAuditWriters(
  engine: any,
  packageId = 'com.objectstack.audit',
  opts: AuditWriterOptions = {},
): void {
  if (!engine || typeof engine.registerHook !== 'function') return;

  const getMessaging = opts.getMessaging ?? (() => undefined);

  // Remove any prior installation so we can safely re-install on hot reload.
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(packageId);
  }

  // Whether a given object's *registered* schema declares a field. The
  // SchemaRegistry auto-injects `organization_id` only in multi-tenant mode
  // (`applySystemFields({ multiTenant })`), so on single-tenant stacks the
  // `sys_audit_log` / `sys_activity` tables have no `organization_id` column.
  // Unconditionally stamping it there made every audit INSERT fail with
  // "table sys_audit_log has no column named organization_id" (the error was
  // swallowed, so audit logging was silently non-functional). Resolve the
  // field set lazily from the engine schema and cache it — object schemas are
  // static after registration.
  const fieldSetCache = new Map<string, Set<string> | null>();
  const objectHasField = (objectName: string, field: string): boolean => {
    let set = fieldSetCache.get(objectName);
    if (set === undefined) {
      set = null;
      try {
        const schema: any =
          typeof (engine as any).getSchema === 'function' ? (engine as any).getSchema(objectName) : null;
        const fields = schema?.fields;
        if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
          set = new Set<string>(Object.keys(fields));
        } else if (Array.isArray(fields)) {
          set = new Set<string>(fields.map((f: any) => f?.name).filter(Boolean));
        }
      } catch {
        /* ignore — best-effort; absence just means we skip the stamp */
      }
      fieldSetCache.set(objectName, set);
    }
    return set != null && set.has(field);
  };

  // Cached full field-definition map per object (for ADR-0052 §5b trackHistory
  // rendering — needs labels/options, not just field names).
  const fieldDefsCache = new Map<string, Record<string, any> | null>();
  const getFieldDefs = (objectName: string): Record<string, any> | null => {
    if (fieldDefsCache.has(objectName)) return fieldDefsCache.get(objectName) ?? null;
    let defs: Record<string, any> | null = null;
    try {
      const schema: any =
        typeof (engine as any).getSchema === 'function' ? (engine as any).getSchema(objectName) : null;
      const fields = schema?.fields;
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) defs = fields;
    } catch {
      /* ignore — best-effort; absence just means we fall back to generic text */
    }
    fieldDefsCache.set(objectName, defs);
    return defs;
  };

  /**
   * beforeUpdate / beforeDelete: capture "previous" snapshot via api.sudo()
   * so we can compute the diff in the afterXxx hook. We attach the snapshot
   * to the context (`(ctx as any).__previous`) since `HookContext.previous`
   * is officially typed but not always populated by the engine itself.
   */
  const captureBefore = async (ctx: HookContext) => {
    if (SKIP_OBJECTS.has(ctx.object)) return;
    const id = (ctx.input as any)?.id;
    if (!id) return; // bulk update/delete — too costly to snapshot every row here
    try {
      // Use the engine directly (not api.sudo) so we can thread the
      // active transaction through. On drivers with single-connection
      // pools (e.g. SQLite via knex) a sudo() findOne that does NOT
      // carry the open transaction will deadlock for the full
      // acquireConnectionTimeout (~60s) because the outer transaction
      // holds the only connection.
      const trx = (ctx as any).transaction;
      const ql = (ctx as any).ql ?? (ctx as any).api?.engine;
      if (ql?.findOne) {
        const prev = await ql.findOne(ctx.object, {
          where: { id },
          context: { isSystem: true, ...(trx ? { transaction: trx } : {}) },
        });
        if (prev) (ctx as any).__previous = prev;
        return;
      }
      const api: any = (ctx as any).api;
      if (!api?.sudo) return;
      const prev = await api.sudo().object(ctx.object).findOne({ where: { id } });
      if (prev) (ctx as any).__previous = prev;
    } catch {
      /* ignore — best-effort */
    }
  };

  engine.registerHook('beforeUpdate', captureBefore, { packageId });
  engine.registerHook('beforeDelete', captureBefore, { packageId });

  /**
   * afterInsert / afterUpdate / afterDelete: write audit_log + activity rows.
   * Errors are swallowed (logged) so user-facing CRUD is never broken by
   * audit failures.
   */
  const writeAudit = async (ctx: HookContext) => {
    if (SKIP_OBJECTS.has(ctx.object)) return;
    const action = actionFor(ctx.event);
    if (!action) return;

    const api: any = (ctx as any).api;
    if (!api?.sudo) return;

    const after: any = ctx.result;
    const before: any = (ctx as any).__previous ?? (ctx as any).previous ?? null;

    // Resolve record id from after (insert/update) or before (delete) or input.
    let recordId: string | undefined =
      (typeof after === 'object' && after?.id) ||
      (typeof before === 'object' && before?.id) ||
      ((ctx.input as any)?.id);
    if (recordId !== undefined) recordId = String(recordId);

    const sess: any = (ctx as any).session ?? {};
    const userId: string | undefined = sess.userId;
    // Prefer the active session tenant, but fall back to the audited
    // record's own `organization_id`. This matters in two cases:
    //   1. Background jobs / unauthenticated sudo paths where the
    //      session has no `tenantId` populated.
    //   2. better-auth's `activeOrganizationId` cache miss on first
    //      requests after sign-in, before the active-org has been set
    //      on the session row.
    // Without this fallback, audit rows are written with
    // `organization_id=NULL` and the SecurityPlugin's RLS predicate
    // (`organization_id = current_user.organization_id`) hides them
    // forever — making the audit log UI appear permanently empty even
    // though writes succeed.
    const recordOrgId: string | undefined =
      (typeof (ctx.result as any)?.organization_id === 'string' && (ctx.result as any).organization_id) ||
      (typeof ((ctx as any).__previous as any)?.organization_id === 'string' && ((ctx as any).__previous as any).organization_id) ||
      undefined;
    const tenantId: string | undefined = sess.tenantId ?? recordOrgId;

    let oldValue: Record<string, any> | null = null;
    let newValue: Record<string, any> | null = null;
    if (action === 'create') {
      newValue = (after && typeof after === 'object') ? { ...after } : null;
    } else if (action === 'update') {
      const d = diff(before || {}, after || {});
      oldValue = d.old;
      newValue = d.next;
      // If nothing meaningfully changed, skip the audit row to avoid noise.
      if (Object.keys(newValue).length === 0) return;
    } else if (action === 'delete') {
      oldValue = before && typeof before === 'object' ? { ...before } : null;
    }

    const auditRow: Record<string, any> = {
      action,
      user_id: userId ?? null,
      object_name: ctx.object,
      record_id: recordId ?? null,
      old_value: oldValue ? safeStringify(oldValue) : null,
      new_value: newValue ? safeStringify(newValue) : null,
      // `tenant_id` is the schema-declared "tenant context" lookup.
      tenant_id: tenantId ?? null,
    };
    // The platform-default `organization_id` column is what RLS gates on
    // (`organization_id = current_user.organization_id`). The audit writer
    // runs through `api.sudo()` which bypasses the SecurityPlugin's
    // auto-stamping of `organization_id`, so we stamp it explicitly here —
    // without it, non-admin members would see 0 rows on Setup dashboards
    // because RLS would deny every audit row as wrong-tenant. But the column
    // only exists in multi-tenant deployments (the SchemaRegistry auto-injects
    // it conditionally); stamping it on a single-tenant table that lacks the
    // column made every audit INSERT fail. Only stamp it when declared.
    if (objectHasField('sys_audit_log', 'organization_id')) {
      auditRow.organization_id = tenantId ?? null;
    }

    const label = recordLabel(after ?? before, recordId ?? '');
    let summary: string;
    if (action === 'create') {
      summary = `Created ${ctx.object} "${label}"`;
    } else if (action === 'delete') {
      summary = `Deleted ${ctx.object} "${label}"`;
    } else {
      // ADR-0052 §5b: if any changed field declares `trackHistory: true`, render
      // the diff legibly ("Stage: Proposal → Closed Won"); else generic text.
      summary =
        renderTrackedChangeSummary(getFieldDefs(ctx.object), oldValue, newValue) ??
        `Updated ${ctx.object} "${label}"`;
    }

    const activityRow: Record<string, any> = {
      type: activityTypeFor(action),
      // Explicit ISO timestamp — `defaultValue: 'NOW()'` on the column
      // isn't resolved by every driver and would otherwise leak the
      // literal string "NOW()" into the row.
      timestamp: new Date().toISOString(),
      summary,
      actor_id: userId ?? null,
      object_name: ctx.object,
      record_id: recordId ?? null,
      record_label: label,
      metadata: newValue || oldValue ? safeStringify({ old: oldValue, new: newValue }) : null,
    };
    // Same rationale as auditRow: stamp the tenant column so RLS matches the
    // recipient's organization on read — but only when the (auto-injected)
    // column actually exists, so single-tenant activity writes don't fail.
    if (objectHasField('sys_activity', 'organization_id')) {
      activityRow.organization_id = tenantId ?? null;
    }

    try {
      const sys = api.sudo();
      await sys.object('sys_audit_log').create(auditRow);
      await sys.object('sys_activity').create(activityRow);
      // M10.8 / ADR-0030: notify the assignee. Best-effort; never throws into
      // the user-facing CRUD path. Goes through the messaging single ingress
      // (`emit`) — the inbox channel materializes the bell row — rather than
      // writing `sys_notification` directly. If owner_id / assigned_to was
      // newly set (or changed to a different user) on a non-system record, the
      // recipient sees "Lead X was assigned to you" without polling.
      //
      // (Comment mentions are handled separately by the sys_comment hook below
      //  since SKIP_OBJECTS excludes it from this writer.)
      await writeAssignmentNotifications(getMessaging(), {
        object: ctx.object,
        recordId: recordId ?? null,
        label,
        action,
        before,
        after,
        actorId: userId ?? null,
        tenantId: tenantId ?? null,
      });
    } catch (err) {
      // Log via engine logger if available, but never throw.
      try { (engine as any).logger?.warn?.('Audit write failed', { object: ctx.object, action, err: String((err as any)?.message ?? err) }); } catch {}
    }
  };

  engine.registerHook('afterInsert', writeAudit, { packageId });
  engine.registerHook('afterUpdate', writeAudit, { packageId });
  engine.registerHook('afterDelete', writeAudit, { packageId });

  /**
   * M10.8: Dedicated hook on `sys_comment` afterInsert that parses the
   * `mentions` JSON field and writes one sys_notification per mentioned
   * user. Lives outside `writeAudit` because sys_comment is in
   * SKIP_OBJECTS (we don't want audit/activity rows for comments —
   * those have their own first-class feed).
   */
  const writeCommentMentions = async (ctx: HookContext) => {
    if (ctx.object !== 'sys_comment') return;
    if (ctx.event !== 'afterInsert') return;
    const messaging = getMessaging();
    if (!messaging) return; // no pipeline installed → no mention notifications
    const row: any = ctx.result;
    if (!row || typeof row !== 'object') return;

    // mentions is a JSON-string textarea on sys_comment. Accept either
    // a raw array of user-ids ["u1","u2"] or an array of objects
    // [{ id: "u1" }, ...]; tolerate parse failures silently.
    let mentions: any = row.mentions;
    if (typeof mentions === 'string') {
      try { mentions = JSON.parse(mentions); } catch { mentions = null; }
    }
    if (!Array.isArray(mentions) || mentions.length === 0) return;

    const userIds = mentions
      .map((m: any) => (typeof m === 'string' ? m : m?.id))
      .filter((id: any) => typeof id === 'string' && id.length > 0);
    if (userIds.length === 0) return;

    const [source_object, source_id] = String(row.thread_id ?? '').split(':');
    const actorId = row.author_id ?? null;
    const actorName = row.author_name ?? null;
    const bodyPreview = String(row.body ?? '').slice(0, 240);
    const sess: any = (ctx as any).session ?? {};
    const tenantId: string | null = sess.tenantId ?? row.organization_id ?? null;
    const commentId = row.id != null ? String(row.id) : null;

    for (const uid of userIds) {
      if (uid === actorId) continue; // don't notify the mention author
      try {
        // ADR-0030 single ingress — emit() writes the L2 event and the inbox
        // channel materializes the bell row + a delivered receipt.
        await messaging.emit({
          topic: 'collab.mention',
          audience: [uid],
          severity: 'info',
          source: source_object ? { object: source_object, id: source_id ?? '' } : undefined,
          actorId: actorId ?? undefined,
          organizationId: tenantId ?? undefined,
          dedupKey: commentId ? `collab.mention:${commentId}:${uid}` : undefined,
          payload: {
            title: actorName ? `${actorName} mentioned you` : 'You were mentioned',
            body: bodyPreview,
            actorName,
          },
        });
      } catch (err) {
        try { (engine as any).logger?.warn?.('Mention notification emit failed', { uid, err: String((err as any)?.message ?? err) }); } catch {}
      }
    }
  };
  engine.registerHook('afterInsert', writeCommentMentions, { packageId });
}

/**
 * Identify the assignee/owner field of a record. We accept several
 * conventional names so this works across CRM-style objects (owner_id,
 * assigned_to) and platform objects (recipient_id is handled separately).
 */
const OWNER_FIELDS = ['owner_id', 'assigned_to', 'assignee_id', 'owner', 'assignee'];

function pickOwner(rec: any): string | null {
  if (!rec || typeof rec !== 'object') return null;
  for (const f of OWNER_FIELDS) {
    const v = rec[f];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

async function writeAssignmentNotifications(
  messaging: MessagingEmitSurface | undefined,
  params: {
    object: string;
    recordId: string | null;
    label: string;
    action: 'create' | 'update' | 'delete';
    before: any;
    after: any;
    actorId: string | null;
    tenantId: string | null;
  },
): Promise<void> {
  if (!messaging) return; // no pipeline installed → no assignment notifications
  if (params.action === 'delete') return;
  if (!params.recordId) return;

  const newOwner = pickOwner(params.after);
  const oldOwner = pickOwner(params.before);
  if (!newOwner) return;
  if (params.action === 'update' && newOwner === oldOwner) return;
  if (newOwner === params.actorId) return; // self-assignment is silent

  try {
    // ADR-0030 single ingress — emit() writes the L2 event and the inbox
    // channel materializes the bell row + a delivered receipt. organizationId
    // is propagated so the recipient (same tenant as the action) sees the
    // materialized row through RLS.
    // Dedup only a true double-fire of the SAME write: scope the key by the
    // record's write-version (updated_at). Without a version component the key
    // would be permanent and a legitimate re-assignment back to a prior owner
    // would be silently suppressed. When no version field exists, omit the key
    // (every assignment notifies — same as the pre-ADR-0030 direct-write path).
    const writeVersion =
      (params.after && typeof params.after === 'object'
        ? params.after.updated_at ?? params.after.modified_at ?? params.after.updated_date
        : null) ?? null;
    await messaging.emit({
      topic: 'collab.assignment',
      audience: [newOwner],
      severity: 'info',
      source: { object: params.object, id: params.recordId },
      actorId: params.actorId ?? undefined,
      organizationId: params.tenantId ?? undefined,
      dedupKey: writeVersion
        ? `collab.assignment:${params.object}:${params.recordId}:${newOwner}:${writeVersion}`
        : undefined,
      payload: {
        title: `${params.object} "${params.label}" assigned to you`,
      },
    });
  } catch {
    // best-effort; never throw into CRUD path
  }
}

// Re-export for convenience.
export type { IDataEngine };

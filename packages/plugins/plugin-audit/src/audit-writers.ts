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

/**
 * Minimal structural view of `II18nService.t`. Declared locally (same
 * rationale as {@link MessagingEmitSurface}) so plugin-audit resolves whatever
 * object is registered under the `i18n` service without a runtime dependency
 * on service-i18n. The kernel always registers at least the in-memory
 * fallback, and `t` returns the key verbatim on a miss.
 */
export interface AuditI18nSurface {
  t(key: string, locale: string, params?: Record<string, unknown>): string;
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
  /**
   * Lazily resolve the i18n service used to localize activity summaries
   * (framework#3039): verb templates (`messages.activityCreated` …) and object
   * display labels (`objects.{name}.label`). Absent → English summaries.
   */
  getI18n?(): AuditI18nSurface | undefined;
  /**
   * Resolve the workspace default locale (ADR-0053 `localization.locale`) for
   * the write's tenant/user scope. Called per audited write but memoized here
   * with a short TTL, so implementations may hit the settings service
   * directly. Absent → summaries stay English (status quo).
   */
  getLocale?(tenantId?: string, userId?: string): Promise<string | undefined>;
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

/**
 * Tables that are intentionally excluded from audit/activity writes.
 *
 * Two reasons an object lands here:
 *  1. Recursion / auth noise — the audit & activity tables themselves, plus
 *     session/presence/auth tables (high-frequency, low value).
 *  2. Operational telemetry / plumbing (ADR-0057) — platform-internal
 *     event/log/queue objects with a `telemetry`/`transient`/`event`
 *     lifecycle class. These are NOT user-attributable, compliance-relevant
 *     changes; mirroring every one of them into the immutable audit ledger
 *     *and* the activity feed is the dominant source of unbounded growth (a
 *     single 20s scheduled flow fanned out to ~21 audit+activity rows/tick,
 *     ~76% of all row growth — see the lifecycle-retention ADR). Until the
 *     event-spine (ADR-0052 §P2) lands, exclude them at the writer seam.
 */
const SKIP_OBJECTS = new Set<string>([
  // (1) recursion + auth/session noise
  'sys_audit_log',
  'sys_activity',
  'sys_comment',
  'sys_session',
  'sys_presence',
  'sys_account',
  'sys_account_session',
  'sys_account_verification',
  'sys_account_account',
  'sys_device_code',
  // (2) operational telemetry / plumbing (ADR-0057 — telemetry/transient/event)
  'sys_job',                     // schedule heartbeats (last_run_at churn)
  'sys_job_run',                 // one row per scheduled execution
  'sys_automation_run',          // one row per automation execution
  'sys_notification',            // messaging-owned (ADR-0030); its own lifecycle
  'sys_notification_delivery',
  'sys_notification_receipt',
  'sys_inbox_message',           // per-user fan-out of every notification
  'sys_http_delivery',           // webhook/outbound transport log
  'ai_traces',                   // LLM trace telemetry
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
 * Field types whose values the engine computes on READ (formula / summary /
 * rollup / autonumber). The `before` snapshot is read back through the query
 * path and therefore carries them, but `after` (`ctx.result`) is the raw
 * write result and does not — so diffing them records a phantom
 * "value → null" change on EVERY update (surfaced by the objectui record
 * History tab). As derived values their changes are implied by their source
 * fields anyway, so they are excluded from the audit diff.
 */
const COMPUTED_FIELD_TYPES = new Set<string>(['formula', 'summary', 'rollup', 'autonumber', 'auto_number']);

/**
 * Compute a shallow JSON diff between two records. Returns only keys whose
 * value changed (and ignores keys in `NOISE_FIELDS` plus computed field
 * types per `fieldDefs`). Both sides are serialisable via `JSON.stringify` —
 * values that fail to serialise are coerced to `String(value)`.
 */
function diff(
  before: Record<string, any>,
  after: Record<string, any>,
  fieldDefs?: Record<string, any> | null,
): { old: Record<string, any>; next: Record<string, any> } {
  const oldOut: Record<string, any> = {};
  const newOut: Record<string, any> = {};
  const keys = new Set<string>([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (NOISE_FIELDS.has(k)) continue;
    const type = fieldDefs?.[k]?.type;
    if (typeof type === 'string' && COMPUTED_FIELD_TYPES.has(type)) continue;
    // `?? null` BEFORE comparing: a key absent on one side (undefined) must
    // compare equal to an explicit null on the other. JSON.stringify(undefined)
    // returns undefined (not a string), so the raw comparison saw
    // undefined ≠ 'null' and wrote a noise row with old=new=null.
    const b = before?.[k] ?? null;
    const a = after?.[k] ?? null;
    if (safeStringify(b) !== safeStringify(a)) {
      oldOut[k] = b;
      newOut[k] = a;
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
 * ADR-0052 §5b.2 — declarative semantic milestones. If a watched field
 * transitioned INTO a configured `value` on this update (before ≠ value, after =
 * value), return the interpolated summary (and optional activity type). `{token}`
 * in the template is replaced by the record's field value, resolving select
 * option labels when possible. Returns null when no milestone fired (needs the
 * `before` snapshot to detect a transition). Takes precedence over the raw
 * field-change summary.
 */
function matchMilestone(
  objectDef: any,
  fields: Record<string, any> | null,
  before: Record<string, any> | null,
  after: Record<string, any> | null,
): { summary: string; type?: string } | null {
  const milestones =
    objectDef && Array.isArray(objectDef.activityMilestones) ? objectDef.activityMilestones : null;
  if (!milestones || !after || !before) return null;
  for (const m of milestones) {
    if (!m || typeof m.field !== 'string' || typeof m.summary !== 'string') continue;
    if (after[m.field] === m.value && before[m.field] !== m.value) {
      const summary = m.summary.replace(/\{(\w+)\}/g, (_match: string, key: string) => {
        const v = after[key];
        if (v === null || v === undefined || v === '') return '';
        const field = fields ? fields[key] : undefined;
        return field ? displayFieldValue(field, v) : String(v);
      });
      return { summary, type: typeof m.type === 'string' ? m.type : undefined };
    }
  }
  return null;
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
  const getI18n = opts.getI18n ?? (() => undefined);

  // Workspace locale changes rarely, but writeAudit runs on every CRUD write —
  // memoize the settings lookup per principal scope with a short TTL so audit
  // logging doesn't add a settings query to every mutation's hot path.
  const LOCALE_TTL_MS = 30_000;
  const localeCache = new Map<string, { value: string | undefined; expires: number }>();
  const resolveWriteLocale = async (tenantId?: string, userId?: string): Promise<string | undefined> => {
    if (!opts.getLocale) return undefined;
    const cacheKey = `${tenantId ?? ''}|${userId ?? ''}`;
    const now = Date.now();
    const hit = localeCache.get(cacheKey);
    if (hit && hit.expires > now) return hit.value;
    let value: string | undefined;
    try {
      value = await opts.getLocale(tenantId, userId);
    } catch {
      value = undefined;
    }
    localeCache.set(cacheKey, { value, expires: now + LOCALE_TTL_MS });
    return value;
  };

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

  // Cached full object definition (for ADR-0052 §5b.2 activityMilestones —
  // object-level metadata, not just fields).
  const objectDefCache = new Map<string, any>();
  const getObjectDef = (objectName: string): any => {
    if (objectDefCache.has(objectName)) return objectDefCache.get(objectName);
    let def: any = null;
    try {
      def = typeof (engine as any).getSchema === 'function' ? (engine as any).getSchema(objectName) : null;
    } catch {
      /* ignore — best-effort */
    }
    objectDefCache.set(objectName, def);
    return def;
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
    // Principal label for attribution. Prefer the real user id; otherwise fall
    // back to a service/automation principal the host put on the context
    // (`ExecutionContext.actor`, e.g. `svc:<name>`). This is what makes a
    // non-user-authenticated write attributable instead of a null actor — the
    // os-790m7q env-delete class (ADR-0014 D2). `user_id` stays user-only (it's
    // a strict sys_user lookup); the service principal lands on `actor`.
    const actorLabel: string | null =
      userId ?? (typeof sess.actor === 'string' && sess.actor.trim() ? sess.actor.trim() : null);
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
      const d = diff(before || {}, after || {}, getFieldDefs(ctx.object));
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
    // First-class principal label (ADR-0014 D2). Conditionally stamped — same
    // rationale as organization_id: older audit tables predate the column.
    if (objectHasField('sys_audit_log', 'actor')) {
      auditRow.actor = actorLabel;
    }

    const label = recordLabel(after ?? before, recordId ?? '');
    // Summaries are user-facing (the record Discussion feed and Setup
    // dashboards render them verbatim), so name the object by its display
    // label ("Semantic Zoo"), not its API name ("showcase_semantic_zoo"), and
    // localize both the verb template and the object label to the workspace
    // default locale (ADR-0053, framework#3039). Every step is best-effort:
    // no locale / no i18n / key miss all degrade to the English literal.
    const locale = await resolveWriteLocale(tenantId, userId);
    const translate = (key: string, params?: Record<string, unknown>): string | undefined => {
      if (!locale) return undefined;
      const i18n = getI18n();
      if (!i18n || typeof i18n.t !== 'function') return undefined;
      try {
        const value = i18n.t(key, locale, params);
        // A miss returns the key verbatim (II18nService contract).
        return typeof value === 'string' && value !== key ? value : undefined;
      } catch {
        return undefined;
      }
    };
    const objectDef = getObjectDef(ctx.object);
    const objectDisplay =
      translate(`objects.${ctx.object}.label`) ??
      (typeof objectDef?.label === 'string' && objectDef.label.length > 0
        ? objectDef.label
        : ctx.object);
    let summary: string;
    let activityType: string = activityTypeFor(action);
    if (action === 'create') {
      summary =
        translate('messages.activityCreated', { object: objectDisplay, label }) ??
        `Created ${objectDisplay} "${label}"`;
    } else if (action === 'delete') {
      summary =
        translate('messages.activityDeleted', { object: objectDisplay, label }) ??
        `Deleted ${objectDisplay} "${label}"`;
    } else {
      // ADR-0052 §5b — declarative activity, precedence: a configured semantic
      // milestone (§5b.2) wins; else a tracked field-change diff ("Stage:
      // Proposal → Closed Won", §5b.1); else the generic fallback.
      const milestone = matchMilestone(getObjectDef(ctx.object), getFieldDefs(ctx.object), before, after);
      if (milestone) {
        summary = milestone.summary;
        if (milestone.type) activityType = milestone.type;
      } else {
        summary =
          renderTrackedChangeSummary(getFieldDefs(ctx.object), oldValue, newValue) ??
          translate('messages.activityUpdated', { object: objectDisplay, label }) ??
          `Updated ${objectDisplay} "${label}"`;
      }
    }

    const activityRow: Record<string, any> = {
      type: activityType,
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

    // `enable.activities` is an opt-OUT capability (#2707): absent block/flag
    // = mirror on (spec default `true`), explicit `false` = this object's CRUD
    // is not mirrored into the sys_activity timeline. This is the per-object
    // lever for activity-row growth (ADR-0057). The compliance audit row is
    // NOT gated — sys_audit_log capture stays unconditional.
    const activitiesEnabled = getObjectDef(ctx.object)?.enable?.activities !== false;

    try {
      const sys = api.sudo();
      await sys.object('sys_audit_log').create(auditRow);
      if (activitiesEnabled) await sys.object('sys_activity').create(activityRow);
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
   * `enable.feeds` server-side enforcement (#2707). Comments are created
   * through the generic data path (`dataSource.create('sys_comment', …)`),
   * so the engine hook seam is the one gate every caller crosses — REST,
   * SDK, and feed-service alike. Opt-OUT semantics matching `enable.clone`
   * (cloneData in metadata-protocol): absent block/flag = allowed, only an
   * explicit `feeds: false` on the *target* object rejects. The thrown
   * error carries `.status`, which the REST layer's `sendError` forwards
   * verbatim → 403 FEEDS_DISABLED, fail-closed like CLONE_DISABLED.
   *
   * The target object is resolved from `thread_id` (conventionally
   * `{object}:{record_id}` — see sys-comment.object.ts). A missing or
   * unconventional thread_id is allowed through: this is capability
   * gating, not access control, and free-form threads have no object to
   * gate on.
   */
  const enforceFeedsCapability = async (ctx: HookContext) => {
    const data: any = (ctx.input as any)?.data;
    const threadId = data?.thread_id;
    if (typeof threadId !== 'string') return;
    const sep = threadId.indexOf(':');
    if (sep <= 0) return;
    const targetObject = threadId.slice(0, sep);
    const def = getObjectDef(targetObject);
    if (def?.enable?.feeds === false) {
      const err: any = new Error(`Comments are disabled for object '${targetObject}' (enable.feeds: false)`);
      err.code = 'FEEDS_DISABLED';
      err.status = 403;
      err.object = targetObject;
      throw err;
    }
  };
  engine.registerHook('beforeInsert', enforceFeedsCapability, { object: 'sys_comment', packageId });

  /**
   * `enable.files` server-side enforcement (#2727). The generic Attachments
   * panel persists `sys_attachment` join rows through the generic data path,
   * so — like the feeds gate above — the engine hook seam is the one gate
   * every caller crosses. Unlike feeds, `files` is opt-IN (spec default
   * `false`): the panel is a new surface, not an existing behavior, so a
   * parent object must declare `enable: { files: true }` before attachments
   * may target it. Fail-closed: an absent enable block, an absent flag, and
   * an unknown parent object all reject — opt-in means *explicit*.
   *
   * Deliberately NOT gated: `Field.file` / `Field.image` uploads. Those
   * store the file URL in the record's own column via service-storage and
   * never create a sys_attachment row, so field-level attachments keep
   * working regardless of this flag.
   */
  const enforceFilesCapability = async (ctx: HookContext) => {
    const data: any = (ctx.input as any)?.data;
    const parentObject = data?.parent_object;
    if (typeof parentObject !== 'string' || parentObject.length === 0) return; // schema requires it; let validation report the miss
    const def = getObjectDef(parentObject);
    if (def?.enable?.files !== true) {
      const err: any = new Error(`File attachments are not enabled for object '${parentObject}' (requires enable.files: true)`);
      err.code = 'FILES_DISABLED';
      err.status = 403;
      err.object = parentObject;
      throw err;
    }
  };
  engine.registerHook('beforeInsert', enforceFilesCapability, { object: 'sys_attachment', packageId });

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

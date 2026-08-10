// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { HookContext } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/spec/contracts';
// [#6656] The read-mask CONTRACT, imported rather than re-typed. `SECRET_MASK`
// is the exact string the engine's read path substitutes and
// `collectMaskedReadFields` is the exact predicate that picks the fields
// (`secret` always; `password` unless the object is `managedBy: 'better-auth'`
// — ADR-0100). A hand-copied `'••••••••'` or a re-typed "is it secret?" test
// here would be a second de-facto contract that drifts from the engine's by one
// character and leaks on the day it does; `secret-fields.ts` makes the same
// argument for its own single definition. The `/core` subpath is the
// engine-free surface of the same package.
import { SECRET_MASK, collectMaskedReadFields } from '@objectstack/objectql/core';
// [#7230] ADR-0079's record display-name contract, imported rather than
// re-derived. `resolveDisplayField` IS the definition of "which field is this
// object's human title" (`nameField` → deprecated `displayNameField` alias →
// deterministic derivation). A local "try name, then title, then subject"
// heuristic here would be a second de-facto contract that disagrees with the
// picker, the search companion and the approval inbox the day an author sets
// `nameField` — the same argument the SECRET_MASK import above makes.
import { resolveDisplayField } from '@objectstack/spec/data';

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
  // [#5193, ADR-0057 D5 "stop the amplifier"] `sys_job_queue` is `sys_job_run`'s
  // sibling — `lifecycle.class: 'transient'` since #5179 — and the highest-volume
  // table of this family. It is engine-owned plumbing (`managedBy:
  // 'engine-owned'`, `enable.apiMethods: ['get','list']`), written ONLY by
  // `DbQueueAdapter` under SYSTEM_CTX, so no row here is a user-attributable,
  // compliance-relevant change. Every message costs at least three writes —
  // publish insert, lease `pending→running`, terminal `→completed` (plus a retry
  // update per failure and the #5192 reaper's periodic DELETE of completed rows)
  // — and each one mirrored into `sys_audit_log` AND `sys_activity`. Since #5160
  // routes email through the queue, that is the amplifier on every single mail.
  'sys_job_queue',               // durable queue/DLQ messages (≥3 writes each)
  'sys_automation_run',          // one row per automation execution
  'sys_notification',            // messaging-owned (ADR-0030); its own lifecycle
  'sys_notification_delivery',
  'sys_notification_receipt',
  'sys_inbox_message',           // per-user fan-out of every notification
  'sys_http_delivery',           // webhook/outbound transport log
  // [#5202, ADR-0057 D5 — the same gap as #5193, one table over] Also
  // `lifecycle.class: 'transient'`, and its own object comment settles what the
  // rows are worth: "an upload session is ephemeral state, **never business
  // truth**" (ADR-0057 / #2970 item 4). `StorageMetadataStore` is its only
  // writer — `createSession()` inserts, `updateSession()` runs ONCE PER CHUNK,
  // and `deleteSession()` (plus the TTL/retention reaper) removes the row — so
  // an N-chunk upload cost 2 × (1 + N) `sys_audit_log` + `sys_activity` rows,
  // each with its own `beforeUpdate` snapshot read. Worse per row than the
  // count suggests: `updateSession()` writes the MERGED FULL record, so every
  // chunk's diff drags along the `parts` JSON blob that grows with each part.
  // Deliberately NOT `sys_file`: those rows are mostly permanent business truth
  // and keep their compliance value, so they stay audited (see #5202).
  'sys_upload_session',          // chunked-upload progress (1 write per chunk)
  'ai_traces',                   // LLM trace telemetry
]);

/**
 * [#5860] The same list, on the REGISTRATION face.
 *
 * `SKIP_OBJECTS` above is consulted inside the handlers, where it is invisible
 * to the engine. That made every audit registration read as GLOBAL, so the
 * per-object demand gates (#5284's single-id prior-row read on `update()`,
 * #5038's bulk equivalents) had to answer "yes, a hook covers this object" for
 * every one of these tables and buy a row read for a handler that returns on
 * its first line. The knowledge existed; the contract had nowhere to put it
 * until #5928 / PR #6575 added `excludeObjects`.
 *
 * Why the negative face and not `object: [...]` with the complement: the object
 * universe is OPEN. `/meta` PUT registers new objects into a running engine and
 * `SchemaRegistry.registerObject` emits no event, so an enumerated allow list
 * would freeze at boot and silently stop auditing everything created after —
 * for a compliance plugin, a regression that reports nothing. Subtraction has
 * no such failure mode: an object nobody had heard of at install time is
 * audited by default. Pinned in `audit-hook-object-scope.test.ts`.
 *
 * DERIVED, never re-typed: the registration face and the handlers' early return
 * are one list, so neither can drift from the other. The early return stays as
 * defence in depth — it is what protects every non-hook caller of these
 * handlers, and it keeps audit behaviour bit-for-bit conserved by this change.
 */
const AUDIT_EXCLUDED_OBJECTS: string[] = [...SKIP_OBJECTS];

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
 * Field types whose values the engine computes rather than storing (formula /
 * summary / rollup / autonumber). Excluded from the audit diff because a
 * DERIVED value's change is already implied by the source fields that produced
 * it — recording both says the same thing twice.
 *
 * The original symptom was narrower: `before` came back through the query path
 * (computed) while `after` (`ctx.result`) was the raw write result (formula
 * key ABSENT), so every update recorded a phantom "value → null" change on the
 * objectui record History tab. Since #5504 the write path hydrates formulas
 * too, so that particular asymmetry is gone and the two sides now agree. The
 * exclusion is kept on its own merit — the derived-is-implied reason above —
 * and it is keyed on the field TYPE from `fieldDefs`, never on a key being
 * missing, which is why the fix one layer down did not disturb it.
 *
 * [#6656] Since the pre-image became the engine's raw row, `before` no longer
 * carries formula keys at all while `after` still does (#5504's write-path
 * hydration) — so the asymmetry is back on the SNAPSHOT faces, which this set
 * never reached. `ledgerView(..., { dropComputed: true })` now applies the same
 * rule to create `new_value` and delete `old_value`; this set is the single
 * definition both faces read.
 */
const COMPUTED_FIELD_TYPES = new Set<string>(['formula', 'summary', 'rollup', 'autonumber', 'auto_number']);

/**
 * [#6656] Field types that are **virtual** — no driver ever returns a column
 * for one. Dropped from the FULL SNAPSHOTS (create `new_value`, delete
 * `old_value`), which is a different job from {@link COMPUTED_FIELD_TYPES}
 * above, on a deliberately different set.
 *
 * Why a snapshot needs the rule at all: `ctx.result` hydrates formulas onto
 * what a write hands back (#5504) while the pre-image is the engine's RAW row,
 * which structurally cannot carry them. Left in, create `new_value` would
 * describe formula fields and delete `old_value` could not — the two snapshot
 * faces disagreeing about their own vocabulary.
 *
 * ⚠️ Why it is NARROWER than `COMPUTED_FIELD_TYPES`, and must stay so. Of that
 * set only `formula` is virtual — "formulas are virtual: no driver ever returns
 * a column for one" (`engine.ts`, #5504). The rest are ordinary **stored**
 * columns the engine maintains: `autonumber` is seeded at insert
 * (`seedAutonumber`), and a `summary` roll-up is written to the parent row by
 * `recomputeSummaries` and seeded at create time (#5749/#6063). They are
 * present on BOTH sides and symmetric, so dropping them from a snapshot would
 * delete real ledger content — the record's human-facing number, and its
 * roll-up values — to fix an asymmetry they never had.
 *
 * The wider set stays correct for `diff()`, whose rule is a different one: a
 * derived value's CHANGE is already implied by the source fields that produced
 * it. That is about change reporting; this is about what a snapshot can
 * contain. Do not unify them.
 */
const VIRTUAL_FIELD_TYPES = new Set<string>(['formula']);

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
 * [#7230] Field types whose stored value is a FOREIGN RECORD ID rather than
 * something a human can read. `user` is on the list because it is "a lookup
 * specialized to the `sys_user` system object — stored IDENTICALLY (FK string
 * column → sys_user.id)" (`field.zod.ts`), which is exactly the field class the
 * measured symptom came from (`Rating Owner: ∅ → oBK25…`). `tree` is NOT on the
 * list: it carries no `reference`, so there is no target object to read.
 *
 * The same three types, for the same reason, are what `plugin-approvals`
 * resolves for its inbox display (`resolveLookupFields`) — one vocabulary for
 * "this value is a reference", not two.
 */
const REFERENCE_FIELD_TYPES: ReadonlySet<string> = new Set(['lookup', 'master_detail', 'user']);

/**
 * [#7230] The referenced record ids carried by one lookup-field value.
 *
 * A single-value lookup stores one id; a `multiple: true` one stores an ARRAY
 * (`field.zod.ts`: "Stores as Array/JSON"). Only the in-memory array shape is
 * unpacked — a driver that hands the column back as an unparsed JSON string is
 * left to the raw fallback rather than guessed at here, since parsing it would
 * be this file inventing a storage contract it does not own.
 *
 * Objects are deliberately skipped: since #6656 both sides of the diff are raw
 * driver rows, so an already-expanded `{id, name}` cannot reach here, and
 * writing a limb for it would be consumer-side tolerance for a producer that
 * does not exist (PD #12).
 */
function referenceIdsOf(value: any): string[] {
  const one = (v: any): string | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string') return v.trim() ? v : null;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    return null;
  };
  if (Array.isArray(value)) return value.map(one).filter((v): v is string => v !== null);
  const single = one(value);
  return single === null ? [] : [single];
}

/**
 * Resolve a field value to its display string, preferring a select/picklist
 * option label — or, for a reference field, the referenced record's title —
 * over the raw stored value. Empty/missing → "∅".
 *
 * [#7230] `titlesFor` is the pre-resolved id → title map for THIS field's
 * target object (see `resolveLookupTitles`). It is a lookup into an
 * already-batched result, never a read: this function stays synchronous, and a
 * caller with nothing to resolve passes nothing and keeps today's behaviour
 * exactly. [#7290] Both summary branches now feed it: the tracked-change diff
 * (`renderTrackedChangeSummary`) and the fired-milestone template
 * (`renderMilestoneSummary`), each from its own read plan.
 *
 * An id with no entry in the map — record deleted, object unregistered, title
 * field unresolvable — falls back to the raw id, which is what this function
 * returned before the branch existed. The change is therefore restore-invariant:
 * it can only replace an id with a title, never a title with an id.
 */
function displayFieldValue(field: any, value: any, titlesFor?: Map<string, string>): string {
  if (value === null || value === undefined || value === '') return '∅';
  if (titlesFor && typeof field?.type === 'string' && REFERENCE_FIELD_TYPES.has(field.type)) {
    const ids = referenceIdsOf(value);
    if (ids.length > 0) return ids.map((id) => titlesFor.get(id) ?? id).join(', ');
  }
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
 * [#7230] Every tracked-change field of `fields` that is a reference, grouped
 * by TARGET OBJECT — the tracked-change branch's read plan for
 * {@link resolveLookupTitles}.
 *
 * Grouping by target object (not by field, and emphatically not by row) is what
 * keeps this off the write hot path: N tracked reference fields pointing at one
 * object cost ONE read, and a write that changes no tracked reference field
 * produces an empty plan and therefore no read at all.
 */
function planTrackedLookupReads(
  fields: Record<string, any> | undefined | null,
  oldVals: Record<string, any> | null,
  newVals: Record<string, any> | null,
): Map<string, Set<string>> {
  const byObject = new Map<string, Set<string>>();
  if (!fields || !newVals) return byObject;
  for (const key of Object.keys(newVals)) {
    const field = fields[key];
    if (!field || field.trackHistory !== true) continue;
    if (typeof field.type !== 'string' || !REFERENCE_FIELD_TYPES.has(field.type)) continue;
    const reference = typeof field.reference === 'string' ? field.reference.trim() : '';
    if (!reference) continue;
    for (const raw of [oldVals ? oldVals[key] : undefined, newVals[key]]) {
      for (const id of referenceIdsOf(raw)) {
        let set = byObject.get(reference);
        if (!set) { set = new Set<string>(); byObject.set(reference, set); }
        set.add(id);
      }
    }
  }
  return byObject;
}

/**
 * ADR-0052 §5b — declarative activity. For fields declared `trackHistory: true`,
 * render the diff the writer already captured as a human-readable timeline
 * summary ("Stage: Proposal → Closed Won"; multiple changes joined by "; "),
 * using the field label, select option labels and referenced record titles.
 * Returns null when no tracked field changed, so the caller falls back to the
 * generic "Updated <object>".
 *
 * [#7230] `translate` is the SAME locale-bound translator the three sibling
 * summary branches already resolve through (`messages.activityCreated` /
 * `messages.activityDeleted` / `messages.activityUpdated`, and `displayLabelFor`
 * for the object name). This branch was the one never handed it, so a
 * fully-localized page ended with an English field label — ADR-0053 /
 * framework#3039 write-time localization, applied where it was missed. The key
 * shape is the bundle's own (`objects.<object>.fields.<field>.label`), and a
 * miss returns `undefined` so the authored def label, then the machine key,
 * still answer exactly as before.
 */
function renderTrackedChangeSummary(
  objectName: string,
  fields: Record<string, any> | undefined | null,
  oldVals: Record<string, any> | null,
  newVals: Record<string, any> | null,
  translate: (key: string, params?: Record<string, unknown>) => string | undefined,
  lookupTitles?: Map<string, Map<string, string>>,
): string | null {
  if (!fields || !newVals) return null;
  const parts: string[] = [];
  for (const key of Object.keys(newVals)) {
    const field = fields[key];
    if (!field || field.trackHistory !== true) continue;
    const label =
      translate(`objects.${objectName}.fields.${key}.label`) ??
      (typeof field.label === 'string' && field.label.length > 0 ? field.label : key);
    const reference = typeof field.reference === 'string' ? field.reference : undefined;
    const titlesFor = reference ? lookupTitles?.get(reference) : undefined;
    const from = displayFieldValue(field, oldVals ? oldVals[key] : undefined, titlesFor);
    const to = displayFieldValue(field, newVals[key], titlesFor);
    parts.push(`${label}: ${from} → ${to}`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * [#7290] The `{token}` pattern of an `activityMilestones` summary template.
 *
 * A FRESH instance per call, deliberately: a module-level `/g` regex carries
 * `lastIndex` between callers, and this one is read twice per fired milestone
 * (once to plan the reads, once to render). One definition, no shared cursor.
 */
function milestoneTokenRe(): RegExp {
  return /\{(\w+)\}/g;
}

/**
 * ADR-0052 §5b.2 — declarative semantic milestones. If a watched field
 * transitioned INTO a configured `value` on this update (before ≠ value, after =
 * value), return the matched summary TEMPLATE (and optional activity type).
 * Returns null when no milestone fired (needs the `before` snapshot to detect a
 * transition). Takes precedence over the raw field-change summary.
 *
 * [#7290] Detection only — the `{token}` interpolation moved out to
 * {@link renderMilestoneSummary}, with {@link planMilestoneTokenReads} between
 * them. Splitting it is what keeps the reference read OFF the write hot path
 * and this function synchronous:
 *
 *   match (sync, no I/O) → plan from the MATCHED template's tokens → one read
 *   per distinct target object → render (sync)
 *
 * A read placed BEFORE this function would have to speculate on the whole
 * after-row, and would therefore fire on every update of a milestone-declaring
 * object — including the overwhelming majority where no milestone fires at all.
 * That is the shape #6656 / PR #6977's ruling was obtained to remove from this
 * file, so the plan is built from what actually matched, or not at all.
 */
function matchMilestone(
  objectDef: any,
  before: Record<string, any> | null,
  after: Record<string, any> | null,
): { template: string; type?: string } | null {
  const milestones =
    objectDef && Array.isArray(objectDef.activityMilestones) ? objectDef.activityMilestones : null;
  if (!milestones || !after || !before) return null;
  for (const m of milestones) {
    if (!m || typeof m.field !== 'string' || typeof m.summary !== 'string') continue;
    if (after[m.field] === m.value && before[m.field] !== m.value) {
      return { template: m.summary, type: typeof m.type === 'string' ? m.type : undefined };
    }
  }
  return null;
}

/**
 * [#7290] The read plan for one FIRED milestone template — the referenced ids
 * its `{token}`s actually name, grouped by TARGET OBJECT.
 *
 * Keyed on the matched template rather than on the row: a template naming no
 * reference field (`'Task completed: {title}'` — the shipped showcase example)
 * produces an empty plan and therefore no read, and a token whose value is
 * empty contributes nothing because `referenceIdsOf` yields no ids for it.
 * Grouping by target object gives the same batching as
 * {@link planTrackedLookupReads}: N reference tokens pointing at one object are
 * answered by ONE `id: { $in: [...] }`.
 *
 * Unlike the tracked-change plan this one does NOT filter on `trackHistory`.
 * The token is whatever the milestone author wrote, and `trackHistory` governs
 * the field-change summary — a different branch, which a fired milestone
 * replaces outright. Requiring it here would silently render raw ids for the
 * exact templates authors write (`'Deal won by {owner}'` on an untracked
 * `owner`), which is the defect, not a guard against it.
 *
 * Only the AFTER row is read, because that is the only side the interpolation
 * consults — a milestone summary describes the state the record arrived in.
 */
function planMilestoneTokenReads(
  template: string,
  fields: Record<string, any> | undefined | null,
  after: Record<string, any> | null,
): Map<string, Set<string>> {
  const byObject = new Map<string, Set<string>>();
  if (!fields || !after) return byObject;
  for (const match of template.matchAll(milestoneTokenRe())) {
    const key = match[1];
    const field = fields[key];
    if (!field || typeof field.type !== 'string' || !REFERENCE_FIELD_TYPES.has(field.type)) continue;
    const reference = typeof field.reference === 'string' ? field.reference.trim() : '';
    if (!reference) continue;
    for (const id of referenceIdsOf(after[key])) {
      let set = byObject.get(reference);
      if (!set) { set = new Set<string>(); byObject.set(reference, set); }
      set.add(id);
    }
  }
  return byObject;
}

/**
 * [#7290] Interpolate a fired milestone's `{token}`s from the after-row.
 *
 * The author's template wording is theirs and is not touched — only what a
 * token RESOLVES TO changes: a `lookup` / `master_detail` / `user` token now
 * renders the referenced record's title instead of the raw 32-char id
 * (`'Deal won by oBK25…'` → `'Deal won by 张伟'`), using the already-batched
 * `lookupTitles` from {@link planMilestoneTokenReads}. Everything else is
 * byte-identical to the pre-#7290 behaviour, including the empty-value rule:
 * a token whose value is null/undefined/'' renders as the EMPTY STRING here,
 * not as `displayFieldValue`'s `∅` — a milestone sentence is prose, not a
 * diff row.
 *
 * Restore-invariant for the same reason `displayFieldValue`'s branch is: an id
 * with no resolved title renders exactly as it did before.
 */
function renderMilestoneSummary(
  template: string,
  fields: Record<string, any> | undefined | null,
  after: Record<string, any> | null,
  lookupTitles?: Map<string, Map<string, string>>,
): string {
  return template.replace(milestoneTokenRe(), (_match: string, key: string) => {
    const v = after ? after[key] : undefined;
    if (v === null || v === undefined || v === '') return '';
    const field = fields ? fields[key] : undefined;
    if (!field) return String(v);
    const reference = typeof field.reference === 'string' ? field.reference : undefined;
    const titlesFor = reference ? lookupTitles?.get(reference) : undefined;
    return displayFieldValue(field, v, titlesFor);
  });
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

  /**
   * Write the compliance ledger row (+ its activity mirror).
   *
   * Extracted as a NAMED callee so `pnpm check:durability-log-level` can anchor
   * on it: the gate matches a declared vocabulary of durability-critical calls,
   * and the bare `.create()` this used to be is far too generic a name to put
   * in that vocabulary. Registered in `DURABILITY_CRITICAL_CALLEES`
   * (`scripts/check-durability-degradation-log-level.mjs`) in the same PR, per
   * the AGENTS.md rule — so a future edit cannot quietly walk the level back
   * down to `warn`.
   */
  const persistAuditTrailRow = async (
    api: any,
    auditRow: Record<string, any>,
    activityRow: Record<string, any> | undefined,
  ): Promise<void> => {
    const sys = api.sudo();
    await sys.object('sys_audit_log').create(auditRow);
    if (activityRow) await sys.object('sys_activity').create(activityRow);
  };

  /**
   * Report a lost audit row — once per process, not once per failed write.
   *
   * AGENTS.md: "Say it once, at the first degradation, not once per failed
   * write." An audit write runs on EVERY mutation, so a per-write `error` on a
   * systemic cause (the table is unreachable from this connection) would emit
   * one line per write and train everyone to skim `error` — the exact reflex
   * that made #4420's `warn` unreadable. The first failure carries the full
   * consequence + fix text; subsequent ones degrade to `debug` so the detail is
   * still recoverable at a higher log level without drowning the channel.
   */
  let auditFailureReported = false;
  const reportAuditWriteFailure = (object: string, action: string, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    const logger = (engine as any).logger;
    try {
      if (auditFailureReported) {
        logger?.debug?.('Audit write failed (already reported)', { object, action, err: detail });
        return;
      }
      auditFailureReported = true;
      // The two things an `error` here owes, both in the first line it prints:
      // the CONSEQUENCE, concretely, and the FIX.
      logger?.error?.(
        'Audit write FAILED — the compliance trail is now INCOMPLETE. The audited write itself SUCCEEDED and is on ' +
          'disk, so the API returned success and nothing downstream looks broken; only the `sys_audit_log` row that ' +
          'records who did it never landed, and nothing retries it. Every subsequent audited write is likely losing ' +
          'its row the same way (this is reported ONCE — raise the log level to `debug` to see the rest). ' +
          'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on. Its ADR-0057 §3.6 ' +
          "lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered (`os dev` " +
          'provisions one by default as a SIBLING SQLite file), so a "no such table" here usually means the write ' +
          'executed against a DIFFERENT datasource than the one the table was created in — see framework#5226. ' +
          'Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on the primary datasource.',
        err instanceof Error ? err : new Error(detail),
        { object, action },
      );
    } catch {
      /* logging must never break the audited write */
    }
  };

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

  // Translate function bound to a locale. Returns undefined on any miss
  // (no locale / no i18n / key miss) so callers keep their English fallback
  // (framework#3039).
  const translateWith =
    (locale: string | undefined) =>
    (key: string, params?: Record<string, unknown>): string | undefined => {
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

  // Display label for an object under a given translate fn: translated label
  // → authored def label → API name. Shared by activity summaries and the
  // collaboration notification titles below.
  const displayLabelFor = (
    objectName: string,
    translate: (key: string, params?: Record<string, unknown>) => string | undefined,
  ): string => {
    const def = getObjectDef(objectName);
    return (
      translate(`objects.${objectName}.label`) ??
      (typeof def?.label === 'string' && def.label.length > 0 ? def.label : objectName)
    );
  };

  /**
   * [#7230, #7290] Referenced record TITLES for a summary — id → title, per
   * target object — resolved from a read PLAN its caller built.
   *
   * Taking the plan as a PARAMETER rather than building it here is what keeps
   * the two summary branches one implementation: `planTrackedLookupReads` (the
   * diff, #7230) and `planMilestoneTokenReads` (a fired milestone's tokens,
   * #7290) both end here. The title-field resolution, the masking skip below
   * and the `['id', titleField]` projection are therefore shared by
   * construction — a second copy for the milestone branch would be a second
   * de-facto contract, and the mask is precisely where that must not happen.
   *
   * ## Why this is shaped as a plan + one read per target object
   *
   * `sys_activity.summary` is composed at WRITE time, so anything this function
   * does lands on the write hot path. One day before this change, #6656 / PR
   * #6977 retired `captureBefore`'s redundant pre-image read from this exact
   * path under maintainer ruling Option A+ — measured 2 → 1 reads per single-id
   * write and 3 → 0 per predicate write. A per-row (or worse, per-value) title
   * read here would hand that saving straight back, in the same file. So:
   *
   *  - **Zero reads is the default.** `planTrackedLookupReads` produces an empty
   *    plan unless a field that is BOTH `trackHistory: true` AND a reference
   *    type actually changed in this write. Every other write — the overwhelming
   *    majority, including every create and delete — pays nothing, and
   *    `#6977`'s counts are untouched. Pinned in `audit-lookup-summary.test.ts`.
   *    [#7290] `planMilestoneTokenReads` is empty on the same default: it is
   *    only ever called once a milestone has ALREADY matched, i.e. on the
   *    transition `before !== value && after === value`, and it is empty again
   *    whenever that template names no reference token. Pinned in
   *    `audit-milestone-summary.test.ts`.
   *  - **One read per distinct target object**, never per field and never per
   *    value: N tracked reference fields pointing at one object are answered by
   *    a single `id: { $in: [...] }`. Same batching shape `plugin-approvals`
   *    uses for its inbox display enrichment.
   *  - **Only the id and the title column are selected**, so resolving a title
   *    cannot drag a wide row (or a blob) through the write path.
   *
   * What it cannot batch away: `writeAudit` is dispatched PER ROW, so a
   * predicate update over N rows that changes a tracked reference field on each
   * pays N reads (one per row per distinct target object). That is inherent to
   * per-row summary composition, not to this batching — and it is bounded by
   * "the object declares a tracked reference field", which the audited-object
   * pre-image read #6977 removed was not.
   *
   * ## Masking (#6656 non-regression)
   *
   * An explicit `nameField` pointer is honoured by `resolveDisplayField` even
   * when it points at a title-INELIGIBLE type, so an object could in principle
   * designate a credential field as its title. The read is skipped in that case
   * rather than trusted to mask downstream: `collectMaskedReadFields` is the
   * same contract predicate `ledgerView` masks with, so "no credential value
   * reaches a user-facing activity summary" holds on this path by the same
   * definition, not by a second one.
   *
   * Best-effort throughout: an unregistered object, an unreadable row or a
   * failing driver leaves the id unresolved, and `displayFieldValue` renders the
   * raw id exactly as it did before this branch existed.
   */
  const resolveLookupTitles = async (
    api: any,
    plan: Map<string, Set<string>>,
  ): Promise<Map<string, Map<string, string>> | undefined> => {
    if (plan.size === 0) return undefined;
    const sys = api.sudo();
    const out = new Map<string, Map<string, string>>();
    for (const [objectName, idSet] of plan) {
      const def = getObjectDef(objectName);
      const titleField = resolveDisplayField(def as any);
      if (!titleField || titleField === 'id') continue;
      if (collectMaskedReadFields(def).includes(titleField)) continue;
      const ids = Array.from(idSet);
      try {
        const rows: any[] = await sys.object(objectName).find({
          where: { id: { $in: ids } },
          fields: ['id', titleField],
          limit: ids.length,
        });
        const titles = new Map<string, string>();
        for (const row of rows ?? []) {
          const id = row?.id;
          const title = row?.[titleField];
          if (id === null || id === undefined) continue;
          if (title === null || title === undefined) continue;
          const text = String(title).trim();
          if (text) titles.set(String(id), text);
        }
        if (titles.size > 0) out.set(objectName, titles);
      } catch {
        /* best-effort — an unresolvable reference renders as its raw id */
      }
    }
    return out.size > 0 ? out : undefined;
  };

  /**
   * [#6656, Option A+] The view the ledger records for one record.
   *
   * Retiring `captureBefore` (below) makes both sides of every diff come from
   * the SAME pipeline — the raw driver row — where before they came from two:
   * `before` through the engine's read path (masked, formula-hydrated,
   * file-references resolved) and `after` from the raw write result. That
   * asymmetry, not the redundant read, was the root cause of the phantom diff
   * rows. Same-source is therefore delivered by the retirement itself; this
   * function delivers the second half — same *view* — so levelling the two
   * sides levels them UPWARD rather than down to the raw store contents.
   *
   * Two limbs, and only two, because only two field classes still differ once
   * both sides are raw (each measured, not assumed):
   *
   *  1. **credential fields** (`secret`, and `password` off better-auth
   *     objects). The raw value is a `secret:` ref, or — for `password`, which
   *     ADR-0100 stores PLAINTEXT at rest — the cleartext itself. Masked here
   *     to exactly what the read path substitutes, on BOTH sides. This is the
   *     compliance face the #6656 ruling protects: single-id delete
   *     `old_value` keeps reading `••••••••`, byte-identical to before this
   *     change, and the ref/cleartext that today reaches `new_value` on every
   *     create and update stops doing so.
   *  2. **virtual fields** (`VIRTUAL_FIELD_TYPES` — `formula` only) — dropped
   *     from FULL SNAPSHOTS. `ctx.result` carries hydrated formulas (#5504) so
   *     `new_value` had them; the raw pre-image has no such column, so
   *     `old_value` structurally could not — a fresh asymmetry that the very
   *     change removing the old one would otherwise introduce. Deliberately
   *     NARROWER than the `COMPUTED_FIELD_TYPES` set `diff()` uses: see that
   *     constant's note for why `autonumber` and `summary` are stored,
   *     symmetric, and must stay in the snapshot.
   *
   * **File-reference fields need no limb, and that is a measurement rather
   * than an omission.** They are named in the ruling because today's `before`
   * carries the resolved `{id, name, size, url}` object against a raw id on
   * the `after` side. Once the pre-image is the engine's, both sides hold the
   * stored id token and agree by construction. Writing an "if it looks
   * resolved, take `.id`" limb would be a consumer-side tolerance for a
   * producer that no longer exists (PD #12) — and it could never be shown to
   * go red, because no path reaches it.
   *
   * Non-mutating on purpose: `ctx.previous` and `ctx.result` are the engine's
   * own objects — `result` is the record the caller gets back — and some
   * drivers hand out live store references. Masking in place would rewrite the
   * record, and on such a driver the store itself. (That aliasing is real: it
   * contaminated the first probe run on this card, making the two views look
   * identical.)
   *
   * @param dropComputed pass `true` for full snapshots (create `new_value`,
   *   delete `old_value`); `false` for diff output, which `diff()` has already
   *   filtered, and for the label source, where a formula `name` is the point.
   */
  const ledgerView = (
    objectName: string,
    record: any,
    { dropComputed }: { dropComputed: boolean },
  ): Record<string, any> | null => {
    if (!record || typeof record !== 'object') return null;
    const out: Record<string, any> = { ...record };
    for (const field of collectMaskedReadFields(getObjectDef(objectName))) {
      // `field in out` and the null-preserving branch both mirror
      // `maskSecretFields` exactly: an unset credential stays `null` (so "no
      // secret" and "a secret is set" remain distinguishable), and a field the
      // row does not carry is never invented.
      if (!(field in out)) continue;
      out[field] = out[field] == null ? null : SECRET_MASK;
    }
    if (dropComputed) {
      const defs = getFieldDefs(objectName);
      for (const key of Object.keys(out)) {
        const type = defs?.[key]?.type;
        if (typeof type === 'string' && VIRTUAL_FIELD_TYPES.has(type)) delete out[key];
      }
    }
    return out;
  };

  /**
   * ⛔ RETIRED — `captureBefore` on `beforeUpdate` / `beforeDelete` (#6656,
   * ADR-0049 enforce-or-remove). Do not reintroduce it.
   *
   * It existed because `HookContext.previous` was "officially typed but not
   * always populated by the engine itself". That is no longer true on any
   * path this plugin registers for, and it was verified in code rather than
   * taken from the card (re-measured on `97b079896`; the anchors below moved
   * from the ones #5846 recorded, so they are restated, not copied):
   *
   *   single-id update  `engine.ts:7012` dispatch, bound `:7010` under the
   *                     `wantsPriorRecord` gate at `:6992`
   *   single-id delete  `:7899` dispatch, bound `:7896`/`:7897`
   *                     (`readPreImage` → `bindPreImage`) under `:7857`
   *   predicate update  `:7084` → `dispatchPerRowBeforeHooks`, bound per row `:1825`
   *   predicate delete  `:7962` → `dispatchPerRowBeforeHooks`, bound per row `:1825`
   *
   * and the after phase is bound too — `buildPerRowAfterContexts` (`:1746`)
   * binds `previous` on every per-row `afterUpdate` / `afterDelete` context,
   * which is the one `writeAudit` actually reads.
   *
   * Each demand gate is the SAME predicate as its dispatch gate
   * (`hasHooksFor(before*) || hasHooksFor(after*) || getSummaryDescriptors()`),
   * so there is no path on which an audit hook runs with `previous` unbound.
   * `writeAudit` stays registered on `afterUpdate`/`afterDelete`, so the gates
   * stay open on the after-hook term and the engine still buys the one read.
   *
   * What the retirement removes, measured with a counting driver on this
   * branch point (`driver.findOne` on the audited object, per write):
   *
   *   single-id update  2 → 1      single-id delete  2 → 1
   *   predicate update  3 → 0      predicate delete  3 → 0   (3 matched rows)
   *
   * The predicate column is the larger half and it was pure waste: #5574 binds
   * `input.id` on every per-row *before* context, which defeated the
   * `if (!id) return` bulk guard this handler opened with, so it read every
   * row — and every result was discarded, because `__previous` landed on the
   * per-row *before* context while the per-row *after* contexts never saw it.
   *
   * Retired rather than left as a no-op registration: a hook whose only
   * remaining effect is holding a demand gate open is exactly what
   * `sys_fetch_previous_delete` had become when #5929 removed it from
   * objectql's own plugin — reproducing that shape here, one package over,
   * would re-create the defect the engine lane just closed.
   */

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

    // [#6656] Both sides, RAW — the engine's write result and the engine's
    // bound pre-image, now one pipeline. These two are what CHANGE DETECTION
    // reads (`diff`, `matchMilestone`); what the ledger RECORDS is their
    // `ledgerView`. Keeping those roles apart is what lets a credential
    // rotation still produce a row — the values compare unequal while both
    // render as the mask — instead of masking first and thereby deleting the
    // audit trail of every secret change along with the phantom ones.
    //
    // ⛔ Read `previous` unconditionally. It is a contract value; do NOT gate
    // it on `ctx.input.options.multi` or otherwise re-derive the engine's
    // dispatch ladder here (`asScalarId` is unexported for exactly this
    // reason — #4434 / #4550, restated in the #6656 ruling).
    const after: any = ctx.result;
    const before: any = (ctx as any).previous ?? null;

    // Resolve record id from after (insert/update) or before (delete) or input.
    let recordId: string | undefined =
      (typeof after === 'object' && after?.id) ||
      (typeof before === 'object' && before?.id) ||
      ((ctx.input as any)?.id);
    if (recordId !== undefined) recordId = String(recordId);

    const sess: any = (ctx as any).session ?? {};
    // [#4586] Two channels can name a human, and they mean different things:
    //
    //   session.userId              — the subject the write was AUTHORIZED as.
    //   provenance.attributedUserId — the human CREDITED for a write the
    //                                 system authorized on their behalf.
    //
    // The second exists because better-auth owns every identity-table write
    // and runs them `isSystem` on purpose (the route already authorized under
    // its own ACL), which left every `sys_member` grade change recorded as
    // "system". Reading it here is what makes the history row name the admin
    // who clicked *make admin*. The session subject still WINS when present —
    // attribution never overrides who actually acted — and neither channel
    // widens what the write may touch (no security middleware reads
    // provenance).
    const attributedUserId: string | undefined =
      typeof (ctx as any).provenance?.attributedUserId === 'string' &&
      (ctx as any).provenance.attributedUserId
        ? (ctx as any).provenance.attributedUserId
        : undefined;
    const userId: string | undefined = sess.userId ?? attributedUserId;
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
      (typeof before?.organization_id === 'string' && before.organization_id) ||
      undefined;
    const tenantId: string | undefined = sess.tenantId ?? recordOrgId;

    let oldValue: Record<string, any> | null = null;
    let newValue: Record<string, any> | null = null;
    if (action === 'create') {
      newValue = ledgerView(ctx.object, after, { dropComputed: true });
    } else if (action === 'update') {
      // Detect on the raw values, record the masked ones — see the note on
      // `before`/`after` above. `diff` has already dropped computed fields, so
      // its output needs no second pass for them.
      const d = diff(before || {}, after || {}, getFieldDefs(ctx.object));
      // If nothing meaningfully changed, skip the audit row to avoid noise.
      if (Object.keys(d.next).length === 0) return;
      oldValue = ledgerView(ctx.object, d.old, { dropComputed: false });
      newValue = ledgerView(ctx.object, d.next, { dropComputed: false });
    } else if (action === 'delete') {
      oldValue = ledgerView(ctx.object, before, { dropComputed: true });
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

    // [#6656] Masked, but computed fields KEPT: `recordLabel` reads
    // `name`/`title`/… and an object whose label field is a formula would
    // otherwise degrade to the bare id (#5504 names that exact symptom). The
    // mask still applies, so no credential value can reach a user-facing
    // activity summary through the label.
    const label = recordLabel(
      ledgerView(ctx.object, after, { dropComputed: false }) ??
        ledgerView(ctx.object, before, { dropComputed: false }),
      recordId ?? '',
    );
    // Summaries are user-facing (the record Discussion feed and Setup
    // dashboards render them verbatim), so name the object by its display
    // label ("Semantic Zoo"), not its API name ("showcase_semantic_zoo"), and
    // localize both the verb template and the object label to the workspace
    // default locale (ADR-0053, framework#3039). Every step is best-effort:
    // no locale / no i18n / key miss all degrade to the English literal.
    const locale = await resolveWriteLocale(tenantId, userId);
    const translate = translateWith(locale);
    const objectDisplay = displayLabelFor(ctx.object, translate);
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
      // [#6656] Masked views, not the raw pair. The milestone branch
      // interpolates `{field}` from the after-row straight into a summary the
      // record feed and Setup dashboards render verbatim, so it must never see
      // a raw credential value. Computed fields are kept (a milestone may key on a
      // formula); detection is unaffected for every other class, since the
      // mask touches credential fields only — and a milestone whose declared
      // `value` is a secret's plaintext would be a leak in the metadata
      // itself, not a case worth preserving.
      const summaryFields = getFieldDefs(ctx.object);
      const beforeView = ledgerView(ctx.object, before, { dropComputed: false });
      const afterView = ledgerView(ctx.object, after, { dropComputed: false });
      const milestone = matchMilestone(getObjectDef(ctx.object), beforeView, afterView);
      if (milestone) {
        // [#7290] The read is keyed on the tokens of the template that ACTUALLY
        // FIRED, and is reached only on the transition itself — rare by
        // construction, since a milestone fires on `before !== value && after
        // === value` and never again while the record sits at that value. An
        // update of a milestone-declaring object that fires NOTHING pays zero,
        // which is what keeps #6656 / PR #6977's retirement in place on this
        // branch too; a plan built before the match would have paid on every
        // such update, which is the shape that ruling was obtained to remove.
        //
        // The plan reads the same MASKED after-view the interpolation renders
        // from, so a credential field can no more become a read key here than
        // it can reach the summary text.
        const lookupTitles = await resolveLookupTitles(
          api,
          planMilestoneTokenReads(milestone.template, summaryFields, afterView),
        );
        summary = renderMilestoneSummary(milestone.template, summaryFields, afterView, lookupTitles);
        if (milestone.type) activityType = milestone.type;
      } else {
        // [#7230] The read plan is built from the SAME masked views the summary
        // renders, and only reached once a milestone has declined — a write
        // that changes no tracked reference field issues no read at all.
        const lookupTitles = await resolveLookupTitles(
          api,
          planTrackedLookupReads(summaryFields, oldValue, newValue),
        );
        summary =
          renderTrackedChangeSummary(
            ctx.object,
            summaryFields,
            oldValue,
            newValue,
            translate,
            lookupTitles,
          ) ??
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
      // Assignment notifications are NOT emitted here (framework#3403). Deciding
      // that an owner/assignee change warrants a bell is a business policy, not a
      // platform default — the kernel version guessed "who is the assignee" from
      // field names (`owner_id` et al.), which misfired on system records like
      // `sys_file` (framework#3402). Applications now opt in per object with an
      // automation flow (`record-after-update` + a `notify` node); see the
      // `showcase_task_assigned_notify` flow for a ready-made example.
      //
      // (Comment @mention notifications remain a platform behavior — they are
      //  handled separately by the sys_comment hook below, since SKIP_OBJECTS
      //  excludes it from this writer.)
      await persistAuditTrailRow(api, auditRow, activitiesEnabled ? activityRow : undefined);
    } catch (err) {
      // #5226 — DURABILITY degradation, not a functional one, so it is reported
      // at `error` (AGENTS.md "Degradation log levels"): the audited write
      // itself returned 200 and its row is on disk, so the system looks
      // completely normal from the outside, while the compliance ledger entry
      // that claims to record it never landed. Nothing retries it, and the gap
      // surfaces — if ever — to an auditor who cannot connect it to this line.
      reportAuditWriteFailure(ctx.object, action, err);
    }
  };

  // [#5860] Same subtraction as the before-phase pair above. `afterUpdate` and
  // `afterDelete` are the two the bulk gates (#5038) read, and `afterUpdate` is
  // the one #5284's single-id gate reads.
  engine.registerHook('afterInsert', writeAudit, { excludeObjects: AUDIT_EXCLUDED_OBJECTS, packageId });
  engine.registerHook('afterUpdate', writeAudit, { excludeObjects: AUDIT_EXCLUDED_OBJECTS, packageId });
  engine.registerHook('afterDelete', writeAudit, { excludeObjects: AUDIT_EXCLUDED_OBJECTS, packageId });

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
        // Localized to the mentioned user's locale (same rationale as the
        // assignment titles); miss → English literal.
        const tr = translateWith(await resolveWriteLocale(tenantId ?? undefined, uid));
        const title = actorName
          ? (tr('messages.mentionedYou', { actor: actorName }) ?? `${actorName} mentioned you`)
          : (tr('messages.mentionedYouAnonymous') ?? 'You were mentioned');
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
            title,
            body: bodyPreview,
            actorName,
          },
        });
      } catch (err) {
        try { (engine as any).logger?.warn?.('Mention notification emit failed', { uid, err: String((err as any)?.message ?? err) }); } catch {}
      }
    }
  };
  // [#5860] A CLOSED single-name allow list — the handler's first line already
  // refused every other object, and unlike the skip list above that knowledge
  // was always expressible. Saying it here is behaviour-conserving and takes
  // this registration out of every other object's `afterInsert` demand.
  engine.registerHook('afterInsert', writeCommentMentions, { object: 'sys_comment', packageId });
}

// Re-export for convenience.
export type { IDataEngine };

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * auditHistoryDisplay — pure helpers that turn raw `sys_audit_log`
 * `old_value` / `new_value` payloads into display-ready history diffs for
 * the record page History tab.
 *
 * The audit writer stores raw field values (ISO datetimes, lookup ids,
 * select values), and its `before` snapshot is read back through the query
 * path while `after` is the raw write result — so server-computed fields
 * (formula / summary / autonumber) appear only on one side and would show a
 * phantom "value → —" change on every write. These helpers:
 *
 *  1. drop computed / hidden / system-noise fields from the diff,
 *  2. drop no-op changes where both sides are empty (null vs '' vs []),
 *  3. format values by field type (dates localized, booleans as Yes/No,
 *     select values mapped to option labels, lookup ids mapped to record
 *     names via a caller-resolved id → label map).
 */

import { toDisplayDate } from '@object-ui/core';

/** Minimal structural view of an object field definition. */
export interface AuditFieldDef {
  type?: string;
  label?: string;
  hidden?: boolean;
  options?: unknown[];
  /**
   * Relationship target object. `string`, and only `string` — see
   * {@link lookupTarget} for the census behind both the carrier and the
   * spelling. `reference_to` is deliberately NOT declared here: no contract
   * declares it — `FieldSchema` refuses it by name, and objectui#11070 round 4
   * retired it from ObjectUI's own view/field contract too — and this interface
   * only ever describes an object metadata document.
   */
  reference?: string;
  [k: string]: unknown;
}

export interface RawAuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditValueFormatContext {
  /** i18n translate fn (i18next-style). Optional — falls back to English. */
  t?: (key: string, options?: Record<string, unknown>) => string;
  /**
   * BCP-47 DISPLAY locale for date formatting: a React caller passes
   * `useDisplayLocale()`, never the UI language (objectui#10442). Absent, the
   * runtime default answers.
   */
  locale?: string;
  /** target object name → (record id → display label), for lookup fields. */
  lookupLabels?: Map<string, Map<string, string>>;
}

/** Audit noise: always change, never user-meaningful (mirrors the writer). */
const NOISE_FIELDS = new Set(['id', '_id', 'created_at', 'created_by', 'updated_at', 'updated_by']);

/** Tenant plumbing auto-injected on every record — no business meaning. */
const SYSTEM_FIELDS = new Set(['organization_id', 'tenant_id', 'is_deleted', 'deleted_at', 'space']);

/**
 * Server-computed field types. Their audit snapshots are captured
 * asymmetrically (see module docs), so any diff on them is unreliable —
 * and as derived values their changes are implied by the source fields.
 */
const COMPUTED_FIELD_TYPES = new Set(['formula', 'summary', 'rollup', 'autonumber', 'auto_number']);

const isEmptyValue = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

const safeStringify = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? 'undefined';
  } catch {
    return String(v);
  }
};

/** Parse an old_value/new_value cell (JSON string or already-parsed object). */
export function parseAuditValue(v: unknown): Record<string, unknown> | null {
  if (!v) return null;
  if (typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Union-diff two audit payloads into the changes worth showing. Fields whose
 * definition marks them computed or hidden are dropped, as are system/noise
 * columns and changes where both sides are empty.
 */
export function collectAuditChanges(
  oldObj: Record<string, unknown> | null,
  newObj: Record<string, unknown> | null,
  fields?: Record<string, AuditFieldDef> | null,
): RawAuditChange[] {
  const keys = new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})]);
  const out: RawAuditChange[] = [];
  for (const key of keys) {
    if (NOISE_FIELDS.has(key) || SYSTEM_FIELDS.has(key)) continue;
    const def = fields?.[key];
    if (def) {
      if (def.hidden === true) continue;
      if (typeof def.type === 'string' && COMPUTED_FIELD_TYPES.has(def.type)) continue;
    }
    const from = oldObj?.[key];
    const to = newObj?.[key];
    if (isEmptyValue(from) && isEmptyValue(to)) continue;
    if (safeStringify(from) === safeStringify(to)) continue;
    out.push({ field: key, from, to });
  }
  return out;
}

/**
 * Read a lookup/master_detail field's target object from its raw def.
 *
 * `reference` is the ONLY spelling this reads, and only as a bare `string` —
 * both narrowings are measurements, not preferences (objectui#6719, extending
 * objectui#6528's SPELLING axis and objectui#6648's CARRIER axis to this
 * third reader of the same value).
 *
 * WHAT REACHES HERE. This helper has exactly one caller chain:
 * `RecordDetailView`'s History effect, which passes `objectDef.fields` —
 * `objectDef` being an entry of `useMetadata().objects`, i.e. the metadata
 * cache for type `'object'` (`MetadataProvider`'s `TYPE_BY_STATE_KEY.objects`).
 * That is an OBJECT METADATA DOCUMENT, never ObjectUI's own view/field
 * contract. `plugin-detail` holds defs of that contract
 * (`DetailViewFieldSchema` in `@object-ui/types` `views.zod.ts`, keyed
 * `reference` since objectui#11070 round 4 and `reference_to` before it), built
 * from the object def (`RecordDetailDrawer`, `RecordMetaFooter`), and none of it
 * flows back into `objectDef.fields`.
 *
 *   spelling: `reference` is what `ObjectSchema.safeParse` (spec 17.2.0)
 *             ACCEPTS — the positive control every zero below is measured
 *             against. `reference_to` it REFUSES BY NAME ("Did you mean
 *             `reference_to` -> `reference`?"), as it does `referenceTo` and
 *             `reference_to_object`. Reading `reference_to` FIRST, as the
 *             `reference_to ?? reference` chain here did, preferred the
 *             spelling the contract rejects over the one it defines.
 *   carrier:  `FieldSchema.reference` is `optional -> string`. `safeParse`
 *             REFUSES `reference: ['crm_account']` (`invalid_type: expected
 *             string, received array`) and `reference: { object: 'crm_account' }`
 *             (`received object`) while ACCEPTING the bare name. A
 *             structure-walking, key-position-aware census of both trees found
 *             599 bare-string carriers at the field-def key position and ZERO
 *             array or `{ object }` carriers from any producer, and
 *             `AuditFieldDef` was the ONLY `string | string[]` declaration of
 *             either key in either tree against 43 that declare `string`.
 *
 * Dropping the `reference_to` arm loses nothing even for a def that arrives
 * spelling only the legacy key: `normalizeSchemaReferenceKeys`
 * (`@object-ui/core`) runs over every `'object'` item at the app-shell
 * ingestion choke point and folds whichever legacy spelling arrived onto
 * `reference`. Its own docs give the reason this reader must not keep a
 * second copy of that tolerance — the choke point exists so that no consumer
 * needs a dual-key fallback of its own (AGENTS.md #0.1).
 */
function lookupTarget(def: AuditFieldDef | undefined): string | null {
  const target = def?.reference;
  return typeof target === 'string' && target.length > 0 ? target : null;
}

const asIdList = (v: unknown): Array<string> => {
  if (v === null || v === undefined || v === '') return [];
  const list = Array.isArray(v) ? v : [v];
  return list
    .map((item) =>
      typeof item === 'string' || typeof item === 'number'
        ? String(item)
        : typeof item === 'object' && item !== null && 'id' in (item as any)
          ? String((item as any).id)
          : null,
    )
    .filter((id): id is string => !!id);
};

/**
 * Collect referenced-record ids per lookup target object across a set of
 * changes, so the caller can batch-resolve display labels in one query per
 * target object.
 */
export function collectLookupIds(
  changes: RawAuditChange[],
  fields?: Record<string, AuditFieldDef> | null,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const change of changes) {
    const target = lookupTarget(fields?.[change.field]);
    if (!target) continue;
    const ids = [...asIdList(change.from), ...asIdList(change.to)];
    if (ids.length === 0) continue;
    let set = out.get(target);
    if (!set) out.set(target, (set = new Set()));
    for (const id of ids) set.add(id);
  }
  return out;
}

function formatScalar(def: AuditFieldDef | undefined, value: unknown, ctx: AuditValueFormatContext): string {
  const type = def?.type;

  if (type === 'boolean' || typeof value === 'boolean') {
    const truthy = value === true || value === 'true' || value === 1;
    const key = truthy ? 'common.yes' : 'common.no';
    const fallback = truthy ? 'Yes' : 'No';
    return ctx.t ? ctx.t(key, { defaultValue: fallback }) : fallback;
  }

  if (type === 'date' || type === 'datetime') {
    // The shared parse step, never `new Date(value)`: a date-only value is UTC
    // midnight to the engine and read back below in the viewer's zone, one day
    // early west of UTC (objectui#10183). The faces stay this helper's own.
    const d = toDisplayDate(value as string | number);
    if (!Number.isNaN(d.getTime())) {
      try {
        return type === 'date'
          ? d.toLocaleDateString(ctx.locale)
          : d.toLocaleString(ctx.locale, { dateStyle: 'medium', timeStyle: 'short' });
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  if (Array.isArray(def?.options)) {
    for (const o of def!.options!) {
      const ov = o && typeof o === 'object' ? ((o as any).value ?? (o as any).name) : o;
      if (ov === value || String(ov) === String(value)) {
        const ol = o && typeof o === 'object' ? ((o as any).label ?? (o as any).name ?? ov) : o;
        return String(ol);
      }
    }
  }

  const target = lookupTarget(def);
  if (target) {
    const label = ctx.lookupLabels?.get(target)?.get(String(value));
    if (label) return label;
  }

  if (typeof value === 'object' && value !== null) return safeStringify(value);
  return String(value);
}

/**
 * Format one side of a change for display. Empty → '' (the timeline renders
 * its own em-dash); arrays → per-item formatting joined with ", ".
 */
export function formatAuditValue(
  def: AuditFieldDef | undefined,
  value: unknown,
  ctx: AuditValueFormatContext = {},
): string {
  if (isEmptyValue(value)) return '';
  if (Array.isArray(value)) return value.map((v) => formatScalar(def, v, ctx)).join(', ');
  return formatScalar(def, value, ctx);
}

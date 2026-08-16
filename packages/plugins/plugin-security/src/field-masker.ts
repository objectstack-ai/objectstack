// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { FieldPermission } from '@objectstack/spec/security';
import type { FieldMaskingRule } from '@objectstack/spec/data';

/** The one masking character partial masks are built from (#8993). */
export const MASK_CHAR = '*';

/**
 * Keep the first `keepHead` and last `keepTail` characters (code points) of
 * `s`, masking everything between with {@link MASK_CHAR}. Length-preserving
 * and deterministic — the same input always yields the same output, so list
 * rendering and grouping stay stable (#8993 scope pin). A value too short to
 * keep both ends is masked ENTIRELY: the safe direction is more masking.
 */
function maskSpan(s: string, keepHead: number, keepTail: number): string {
  const chars = Array.from(s);
  const len = chars.length;
  if (len === 0) return s;
  if (len <= keepHead + keepTail) return MASK_CHAR.repeat(len);
  return (
    chars.slice(0, keepHead).join('') +
    MASK_CHAR.repeat(len - keepHead - keepTail) +
    chars.slice(len - keepTail).join('')
  );
}

/** Apply `rule` to a STRING value. Every branch is a {@link maskSpan} — the
 * presets are named parameterizations, so all outputs share one shape and the
 * whole family is idempotent (masking a masked value returns it unchanged),
 * which is what makes {@link FieldMasker.detectMaskedEchoWrites}'s fixed-point
 * test sound. */
function applyRuleToString(s: string, rule: FieldMaskingRule): string {
  if (typeof rule !== 'string') return maskSpan(s, rule.keepHead, rule.keepTail);
  switch (rule) {
    case 'phone': return maskSpan(s, 3, 4);
    case 'id_card': return maskSpan(s, 6, 4);
    case 'bank_account': return maskSpan(s, 0, 4);
    case 'name': return maskSpan(s, 1, 0);
    case 'email': {
      const at = s.indexOf('@');
      // No/leading '@' → treat as an opaque identifier (keep first char).
      if (at <= 0) return maskSpan(s, 1, 0);
      return maskSpan(s.slice(0, at), 1, 0) + s.slice(at);
    }
    default: {
      // Unreachable for a spec-valid rule; an unknown preset that slips
      // through fails CLOSED (full mask), never open.
      return maskSpan(s, 0, 0);
    }
  }
}

/**
 * Apply a partial-masking rule to a stored VALUE (#8993).
 *
 * - `null` / `undefined` pass through (nothing to hide).
 * - strings mask per the rule; numbers/bigints mask their decimal rendering
 *   (a phone stored numerically must not leak on a technicality).
 * - arrays mask element-wise (multi-value fields).
 * - any other shape (boolean, object, date) collapses to a fixed opaque
 *   `'***'` — deterministic and value-independent, so not even a length or a
 *   truthiness bit leaks from a shape the rule was never written for.
 */
export function maskFieldValue(value: unknown, rule: FieldMaskingRule): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => maskFieldValue(v, rule));
  if (typeof value === 'string') return applyRuleToString(value, rule);
  if (typeof value === 'number' || typeof value === 'bigint') {
    return applyRuleToString(String(value), rule);
  }
  return MASK_CHAR.repeat(3);
}

/**
 * FieldMasker
 *
 * Applies field-level security by stripping restricted fields from query
 * results — and, for fields declaring a `maskingRule` the caller has not
 * unmasked (#8993), by REPLACING the value with its partial mask instead.
 */
export class FieldMasker {
  /**
   * Mask fields in query results based on field permissions.
   * Removes fields that the user does not have read access to.
   *
   * `partialRules` (#8993) names the fields to serve MASKED to this caller —
   * the caller-specific applicability (the field's `requiredPermissions` as
   * the unmask gate, strictest-wins against explicit permission-set denies)
   * is decided by the security plugin BEFORE this call; a field present in
   * `partialRules` is served masked even where a `readable: false` entry
   * (from the requiredPermissions fold) would otherwise delete it.
   */
  maskResults(
    results: any | any[],
    fieldPermissions: Record<string, FieldPermission>,
    _objectName: string,
    partialRules?: Record<string, FieldMaskingRule>,
  ): any | any[] {
    const rules = partialRules ?? {};
    const hasRules = Object.keys(rules).length > 0;
    // If no field permissions and no partial rules apply, return results as-is
    if (Object.keys(fieldPermissions).length === 0 && !hasRules) return results;

    // Get list of non-readable fields (a field with an applicable partial
    // rule is REPLACED below, not deleted)
    const hiddenFields = Object.entries(fieldPermissions)
      .filter(([field, perm]) => !perm.readable && !(field in rules))
      .map(([field]) => field);

    if (hiddenFields.length === 0 && !hasRules) return results;

    if (Array.isArray(results)) {
      return results.map(record => this.maskRecord(record, hiddenFields, rules));
    }

    return this.maskRecord(results, hiddenFields, rules);
  }

  /**
   * [#8993] Detect masked-echo writes: payload values that are a FIXED POINT
   * of their own field's masking rule and carry the mask character — i.e. the
   * placeholder a masked read served, round-tripped back by a client that
   * re-submitted a whole record. Writing it through would replace the real
   * stored value with `138****5678` silently; the middleware refuses instead
   * (400 VALIDATION_ERROR), so honest clients get an actionable error.
   *
   * The mask-character requirement is what keeps short legitimate values
   * safe: a 7-character phone is its own mask image (nothing was maskable)
   * but contains no `*`, so it passes. Fields whose caller holds the unmask
   * capability are not in `rules` and are never flagged — a privileged import
   * of literally-starred data stays possible.
   */
  detectMaskedEchoWrites(
    data: Record<string, any> | Record<string, any>[],
    rules: Record<string, FieldMaskingRule>,
  ): string[] {
    const fields = Object.keys(rules);
    if (fields.length === 0) return [];
    const offenders = new Set<string>();
    const rows = Array.isArray(data) ? data : [data];
    const isEcho = (value: unknown, rule: FieldMaskingRule): boolean =>
      typeof value === 'string' &&
      value.includes(MASK_CHAR) &&
      applyRuleToString(value, rule) === value;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const field of fields) {
        if (!(field in row)) continue;
        const value = (row as Record<string, unknown>)[field];
        const rule = rules[field];
        if (isEcho(value, rule) || (Array.isArray(value) && value.some((v) => isEcho(v, rule)))) {
          offenders.add(field);
        }
      }
    }
    return Array.from(offenders).sort();
  }

  /**
   * Get non-editable fields for use in write operations.
   * Returns a list of field names that should be stripped from incoming data.
   */
  getNonEditableFields(
    fieldPermissions: Record<string, FieldPermission>
  ): string[] {
    return Object.entries(fieldPermissions)
      .filter(([, perm]) => !perm.editable)
      .map(([field]) => field);
  }

  /**
   * Strip non-editable fields from write data.
   */
  stripNonEditableFields(
    data: Record<string, any>,
    fieldPermissions: Record<string, FieldPermission>
  ): Record<string, any> {
    const nonEditable = this.getNonEditableFields(fieldPermissions);
    if (nonEditable.length === 0) return data;

    const result = { ...data };
    for (const field of nonEditable) {
      delete result[field];
    }
    return result;
  }

  /**
   * Detect which fields in the caller's write payload would touch a
   * field they are not allowed to edit. Returns the set of offending
   * field names (no duplicates, sorted for stable error messages).
   *
   * Used by the security middleware on insert/update to fail-closed
   * with an explicit 403 rather than silently dropping fields — a
   * silent drop hides the security boundary from honest clients
   * (their update partially "doesn't save") and gives an attacker no
   * negative signal that the field exists. Throwing makes the
   * boundary observable in both directions.
   *
   * `data` may be a single record or an array of records (bulk insert);
   * either way the returned list is the union across all rows.
   *
   * Fields without a permission entry pass through — permission sets
   * are an allow-list at the field level only for fields they
   * explicitly enumerate. Most objects do not declare per-field rules
   * and remain fully editable.
   */
  detectForbiddenWrites(
    data: Record<string, any> | Record<string, any>[],
    fieldPermissions: Record<string, FieldPermission>
  ): string[] {
    if (Object.keys(fieldPermissions).length === 0) return [];
    const nonEditable = new Set(this.getNonEditableFields(fieldPermissions));
    if (nonEditable.size === 0) return [];

    const offenders = new Set<string>();
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const field of Object.keys(row)) {
        if (nonEditable.has(field)) offenders.add(field);
      }
    }
    return Array.from(offenders).sort();
  }

  private maskRecord(
    record: any,
    hiddenFields: string[],
    partialRules: Record<string, FieldMaskingRule> = {},
  ): any {
    if (!record || typeof record !== 'object') return record;

    const result = { ...record };
    for (const field of hiddenFields) {
      delete result[field];
    }
    for (const [field, rule] of Object.entries(partialRules)) {
      if (field in result) {
        result[field] = maskFieldValue(result[field], rule);
      }
    }
    return result;
  }
}

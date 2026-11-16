// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { FieldPermission } from '@objectstack/spec/security';
import { referenceTargetOf, type FieldMaskingRule } from '@objectstack/spec/data';
import { parseCelToAst } from '@objectstack/formula';

/** The one masking character partial masks are built from (#8993). */
export const MASK_CHAR = '*';

/**
 * What one computed field's value is computed from — a field declaring an
 * `expression`: a `formula`, computed on read, or a stored computed field,
 * computed on write.
 *
 * - `reads`: the fields of its own record it reads — as a value, or as the
 *   reference it reads through. `null` when they cannot be named
 *   ({@link readComputedFieldExpression}): it may read any field.
 * - `hops`: per reference field it reads through, the fields of the
 *   referenced record it reads there.
 */
export interface ComputedFieldInput {
  readonly reads: ReadonlySet<string> | null;
  readonly hops: ReadonlyMap<string, ReadonlySet<string>>;
}

/** {@link ComputedFieldInput} by computed field name, for one object. */
export type ComputedFieldInputs = Readonly<Record<string, ComputedFieldInput>>;

/** The scope root a field's `expression` reads its own record through. */
const RECORD_ROOT = 'record';
const MEMBER_OPS = new Set(['.', '.?']);
const INDEX_OPS = new Set(['[]', '[?]']);
const NO_HOPS: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const UNNAMED: ComputedFieldInput = Object.freeze({ reads: null, hops: NO_HOPS });

/** The member a node names literally on its receiver (`x.m`, `x.?m`, `x['m']`, `x[?'m']`), or `undefined`. */
function literalMember(node: unknown): { receiver: unknown; name: string } | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const { op, args } = node as { op?: unknown; args?: unknown };
  if (typeof op !== 'string' || !Array.isArray(args) || args.length < 2) return undefined;
  if (MEMBER_OPS.has(op)) return typeof args[1] === 'string' ? { receiver: args[0], name: args[1] } : undefined;
  if (INDEX_OPS.has(op)) {
    const key = args[1] as { op?: unknown; args?: unknown } | undefined;
    if (key && typeof key === 'object' && key.op === 'value' && typeof key.args === 'string') {
      return { receiver: args[0], name: key.args };
    }
  }
  return undefined;
}

const isRecordRoot = (node: unknown): boolean =>
  !!node && typeof node === 'object'
  && (node as { op?: unknown }).op === 'id' && (node as { args?: unknown }).args === RECORD_ROOT;

/**
 * What a field's declared `expression` reads off its own record, from ONE
 * parse (`parseCelToAst`, the platform's one answer to what parses), in the
 * member spellings the platform's member reader (`analyzeRelationshipTraversals`,
 * the reader the engine plans formula evaluation by) names:
 * `record.x`, `record.?x`, `record['x']`, `record[?'x']`, and one member read
 * on through a reference (`record.ref.y`). `formula-reads-hidden-field-masking.test.ts`
 * holds the two readers equal over every spelling.
 *
 * `undefined` when the field declares no expression (it is not computed). The
 * reads are `null` — "may read any field" — when they cannot be named: another
 * dialect, a source that does not parse, or a use of the `record` root that no
 * literal member describes (a computed key `record[record.k]`, a method or
 * macro on the root, the root handed whole to a function). Every `record`
 * identifier in the parse is accounted for, so a spelling not recognised
 * here counts as such a use: the answer errs toward hiding, never serving.
 * The references such an expression reads through by a literal member are
 * still named in `hops`, so what it reads there is judged as for any other.
 */
export function readComputedFieldExpression(def: unknown): ComputedFieldInput | undefined {
  if (!def || typeof def !== 'object') return undefined;
  const raw = (def as { expression?: unknown }).expression;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'object') return UNNAMED;
  const expr = (typeof raw === 'string' ? { dialect: 'cel', source: raw } : raw) as { dialect?: unknown; source?: unknown };
  if ((expr.dialect !== undefined && expr.dialect !== 'cel') || typeof expr.source !== 'string') return UNNAMED;
  const ast = parseCelToAst(expr.source);
  if (ast == null) return UNNAMED;
  // Every `record` identifier is counted where the walk meets it; one met as
  // the receiver of a literal member is a named read. Any other is the
  // unnamed use.
  let roots = 0;
  let named = 0;
  const reads = new Set<string>();
  const hops = new Map<string, Set<string>>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    if (!node || typeof node !== 'object') return;
    if (isRecordRoot(node)) { roots++; return; }
    const outer = literalMember(node);
    if (outer && isRecordRoot(outer.receiver)) {
      roots++;
      named++;
      reads.add(outer.name);
      return;
    }
    const inner = outer ? literalMember(outer.receiver) : undefined;
    if (outer && inner && isRecordRoot(inner.receiver)) {
      // `record.ref.leaf`: `ref` is read through; `leaf` is read on the referenced record.
      roots++;
      named++;
      reads.add(inner.name);
      let leaves = hops.get(inner.name);
      if (!leaves) hops.set(inner.name, (leaves = new Set()));
      leaves.add(outer.name);
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) walk(value);
  };
  walk(ast);
  // Reads that cannot be named still read through the references they name:
  // those are judged like any other (the engine loads exactly those).
  if (roots > named) return { reads: null, hops };
  return { reads, hops };
}

/** The computed fields that read a field of another record, through a reference. */
export function computedFieldsReadingThroughReferences(inputs: ComputedFieldInputs | undefined): Set<string> {
  const out = new Set<string>();
  for (const [field, input] of Object.entries(inputs ?? {})) if (input.hops.size > 0) out.add(field);
  return out;
}

/**
 * The object each reference field a computed field reads through points at,
 * by reference field name, as the engine resolves a hop's target
 * (`referenceTargetOf`). A reference with no resolvable target is left out:
 * the engine reads nothing through it.
 */
export function computedHopTargetsOf(inputs: ComputedFieldInputs, fields: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const defOf = (name: string): unknown => {
    if (Array.isArray(fields)) return fields.find((f) => f && typeof f === 'object' && (f as { name?: unknown }).name === name);
    return fields && typeof fields === 'object' ? (fields as Record<string, unknown>)[name] : undefined;
  };
  for (const input of Object.values(inputs)) {
    for (const ref of input.hops.keys()) {
      if (ref in out) continue;
      let target: string | undefined;
      try { target = referenceTargetOf(defOf(ref)); } catch { target = undefined; }
      if (target) out[ref] = target;
    }
  }
  return out;
}

/**
 * Field-level security covers what a field's value is computed from: the
 * computed fields a caller may not read because they read a field in
 * `withheld` — a field the caller may not read, or is served only partially
 * masked — directly or through another computed field.
 *
 * A computed field whose reads cannot be named is withheld whenever any other
 * field is. A computed field that is itself served partially masked is
 * withheld whole when it reads a withheld field: a mask written for the field
 * does not describe what it is computed from.
 */
export function computedFieldsReadingWithheld(
  inputs: ComputedFieldInputs | undefined,
  withheld: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  if (!inputs || withheld.size === 0) return out;
  const all = new Set(withheld);
  const readsWithheld = (field: string, reads: ReadonlySet<string> | null): boolean => {
    if (reads === null) return [...all].some((name) => name !== field);
    for (const name of reads) if (name !== field && all.has(name)) return true;
    return false;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const [field, input] of Object.entries(inputs)) {
      if (out.has(field) || !readsWithheld(field, input.reads)) continue;
      out.add(field);
      all.add(field);
      grew = true;
    }
  }
  return out;
}

/**
 * The computed fields a caller is not served WHOLE, read off the query-guard
 * map (`computeQueryGuardFieldPerms`: a field the caller may not read, is
 * served masked, or that is withheld for what it reads, is non-queryable
 * there). The ONE predicate the write side asks: the step 2.5 gate refuses a
 * payload naming one, and the write projection and the record field access
 * leave it out, so the gate and the projections cannot differ.
 */
export function computedFieldsNotServedWhole(
  inputs: ComputedFieldInputs | undefined,
  queryGuard: Record<string, { readable?: boolean }>,
): Set<string> {
  const out = new Set<string>();
  for (const field of Object.keys(inputs ?? {})) if (queryGuard[field]?.readable === false) out.add(field);
  return out;
}

/**
 * `perms` with every computed field the caller may not read marked
 * non-readable — the field map its readers then mask, guard and project by —
 * and those fields: each computed field that reads a field `perms` marks
 * non-readable or `servedMasked` names (fields served partially masked),
 * directly or through another computed field; and each of `withheldOutright`
 * (computed fields withheld for what they read through a reference) with
 * every computed field reading one of them. Returns `perms` itself when none.
 */
export function foldComputedFieldReads(
  perms: Record<string, { readable: boolean; editable: boolean }>,
  inputs: ComputedFieldInputs | undefined,
  servedMasked: Iterable<string> = [],
  withheldOutright: Iterable<string> = [],
): { perms: Record<string, { readable: boolean; editable: boolean }>; withheld: Set<string> } {
  const outright = new Set<string>(withheldOutright);
  const denied = new Set<string>([...servedMasked, ...outright]);
  for (const [field, perm] of Object.entries(perms)) if (perm?.readable === false) denied.add(field);
  const withheld = computedFieldsReadingWithheld(inputs, denied);
  for (const field of outright) withheld.add(field);
  if (withheld.size === 0) return { perms, withheld };
  const out = { ...perms };
  for (const field of withheld) out[field] = { readable: false, editable: perms[field]?.editable ?? false };
  return { perms: out, withheld };
}

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

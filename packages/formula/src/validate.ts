/**
 * Shared expression validator (ADR-0032 §Decision 1/5).
 *
 * One validator, used by every author surface — `objectstack build`,
 * `registerFlow`/metadata registration, and the agent-callable
 * `validate_expression` tool — so a malformed expression is caught the same
 * way everywhere, with a message written for **self-correction** (Decision 1d):
 * it states what is wrong AND the correct form.
 *
 * Field roles map to dialects (Decision 2):
 *   - `predicate`  → bare CEL returning bool (`record.rating >= 4`)
 *   - `value`      → bare CEL of any type   (`daysFromNow(3)`)
 *   - `template`   → text with `{{ path }}` holes (`Hot lead: {{ record.name }}`)
 *
 * The #1 author error (human or LLM) is wrapping a field reference in single
 * `{…}` braces inside a CEL field — `{x}` parses as a CEL map literal and fails.
 * This validator detects that specific mistake and returns the exact fix.
 */

import { celEngine, firstUndeclaredReference, firstTypeMismatch, inferCelType, type FieldCelType } from './cel-engine';
import { templateEngine } from './template-engine';

export type FieldRole = 'predicate' | 'value' | 'template';

/**
 * Loose input accepted by the validator: a bare string, or any object exposing
 * `dialect`/`source` (the Expression envelope, or a not-yet-narrowed value from
 * a `config.condition` / `edge.condition` field). Kept structural so call sites
 * need not pre-narrow to the strict {@link Expression} dialect union.
 */
export type ExprInput = string | { dialect?: string; source?: string } | null | undefined;

/** Optional schema context for field-existence checks (Decision 1b, v1). */
export interface ExprSchemaHint {
  /** Object the expression is authored against (for error text). */
  objectName?: string;
  /** Known top-level field names, so `record.<field>` can be checked. */
  fields?: readonly string[];
  /**
   * #1928 tier 4 — field name → spec field type (`'text'`, `'currency'`,
   * `'boolean'`, `'date'`, …). Enables the advisory type-soundness check: a
   * text or boolean field used with an arithmetic/ordering operator against a
   * number faults at runtime and the expression silently evaluates to `null`,
   * so it is surfaced as a NON-blocking warning. Absent ⇒ the check is skipped.
   * Only consulted for `scope: 'record'` sites (where refs are `record.<field>`).
   */
  fieldTypes?: Readonly<Record<string, string>>;
  /**
   * Evaluation scope of the authoring site — determines whether a bare top-level
   * identifier is legal (#1928):
   *  - `'record'`    → the record is bound only as the `record` namespace, with
   *                    no field flattening (`Field.formula`, object validation
   *                    predicates). A bare `amount` resolves to nothing and the
   *                    expression silently evaluates to `null` / never fires, so
   *                    it MUST be written `record.amount`. We flag bare refs.
   *  - `'flattened'` → the record's own fields are spread to top-level alongside
   *                    flow variables (flow / automation conditions), so bare
   *                    `status` is correct and is NOT an error. Flow variables
   *                    are not schema-knowable, so a non-field bare identifier
   *                    can't be soundly told apart from a typo — but when one is
   *                    a near-miss of a known field we emit a non-blocking
   *                    did-you-mean *warning*. (Default.)
   */
  scope?: 'record' | 'flattened';
  /**
   * ADR-0068 D4 — the closed catalog of valid role names (built-in + declared).
   * When supplied, a role-membership predicate testing a role NOT in this set
   * (e.g. `'org_admni' in current_user.positions`) is flagged as an error. Closes
   * the AI-hallucination hole where a model invents a plausible-but-nonexistent
   * role that then silently never matches. Absent => role checks are skipped.
   */
  roleCatalog?: readonly string[];
}

export interface ExprValidationError {
  /** Self-correcting message: what is wrong + the correct form. */
  message: string;
  /** The offending source, echoed for location. */
  source: string;
}

export interface ExprValidationResult {
  ok: boolean;
  errors: ExprValidationError[];
  /**
   * Non-blocking advisories (#1928 tier 3): a likely-typo'd field reference in a
   * flattened flow condition. Never affects `ok` — callers surface these without
   * failing the build, since a bare identifier there may legitimately be a flow
   * variable.
   */
  warnings: ExprValidationError[];
}

/**
 * #1928 tier 4 — spec field type → the CEL type it is declared as for the
 * type-soundness check. ONLY genuinely-scalar, non-numeric-intent types are
 * pinned to a concrete type (`string` / `bool`); every other type — numbers,
 * dates, selects (option values may be numeric codes), lookups, media, JSON —
 * maps to `dyn` so it can never fault (the runtime rescues all of those). Any
 * field type absent from this map is treated as `dyn`. Keeping the map narrow
 * is the source of the check's near-zero false-positive rate.
 */
const SPEC_TYPE_TO_CEL: Readonly<Record<string, FieldCelType>> = {
  // Free text — arithmetic / ordering against a number is (almost) always a bug.
  text: 'string', textarea: 'string', email: 'string', url: 'string',
  phone: 'string', markdown: 'string', html: 'string', richtext: 'string',
  // Booleans — arithmetic / ordering against a number ALWAYS faults at runtime.
  boolean: 'bool', toggle: 'bool',
};

/** Map an object's field-type hints onto the CEL types the soundness check uses. */
function toCelFieldTypes(fieldTypes: Readonly<Record<string, string>>): Record<string, FieldCelType> {
  const out: Record<string, FieldCelType> = {};
  for (const [name, specType] of Object.entries(fieldTypes)) {
    out[name] = SPEC_TYPE_TO_CEL[specType] ?? 'dyn';
  }
  return out;
}

/**
 * #1928 tier 4 — a NON-blocking warning for a text/boolean field used with an
 * arithmetic/ordering operator against a number (a silent-null bug), or `null`
 * when the expression is type-sound. `scope` selects `record.<field>` vs bare
 * field binding, and shapes the referenced form in the message.
 */
function typeSoundnessWarning(
  source: string,
  fieldTypes: Readonly<Record<string, string>>,
  scope: 'record' | 'flattened',
): ExprValidationError | null {
  const mismatch = firstTypeMismatch(source, toCelFieldTypes(fieldTypes), scope);
  if (!mismatch) return null;
  const held = mismatch.celType === 'bool' ? 'a boolean' : 'text';
  const ref = mismatch.field
    ? (scope === 'record' ? `\`record.${mismatch.field}\`` : `\`${mismatch.field}\``)
    : null;
  const subject = ref ? `${ref} holds ${held}` : `${held === 'a boolean' ? 'a boolean' : 'a text'} field`;
  return {
    source,
    message:
      `type mismatch \`${mismatch.operands}\` — ${subject} but is used with \`${mismatch.operator}\` ` +
      `against a number. This faults at runtime, so the expression silently evaluates to null ` +
      `(unless the value happens to be numeric). Use a number field, or drop the arithmetic/comparison.`,
  };
}

/** A bare `{x}` that is NOT part of a `{{x}}` mustache hole. */
const SINGLE_BRACE_RE = /(?:^|[^{])\{\s*([A-Za-z_$][\w.$]*)\s*\}(?!\})/;
/** `record.<field>` / `previous.<field>` head references for field-existence. */
const RECORD_REF_RE = /\b(?:record|previous)\.([A-Za-z_$][\w$]*)/g;

/** The dialect a field role expects (Decision 2). */
export function expectedDialect(role: FieldRole): 'cel' | 'template' {
  return role === 'template' ? 'template' : 'cel';
}

function toSource(input: ExprInput): { dialect?: string; source: string } {
  if (input == null) return { source: '' };
  if (typeof input === 'string') return { source: input };
  return { dialect: input.dialect, source: input.source ?? '' };
}

function bracesHint(source: string): string | null {
  const m = SINGLE_BRACE_RE.exec(source);
  if (!m) return null;
  const ref = m[1];
  return (
    `it looks like a \`{${ref}}\` template brace was used inside a CEL expression — ` +
    `\`{…}\` parses as a CEL map literal and fails. Write the bare reference instead, e.g. \`${ref}\`.`
  );
}

function checkFieldExistence(source: string, schema: ExprSchemaHint | undefined, errors: ExprValidationError[]): void {
  if (!schema?.fields || schema.fields.length === 0) return;
  const known = new Set(schema.fields);
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  RECORD_REF_RE.lastIndex = 0;
  while ((m = RECORD_REF_RE.exec(source)) !== null) {
    const field = m[1];
    if (seen.has(field) || known.has(field)) continue;
    seen.add(field);
    const suggestion = nearest(field, schema.fields);
    errors.push({
      source,
      message:
        `unknown field \`${field}\`${schema.objectName ? ` on \`${schema.objectName}\`` : ''}` +
        (suggestion ? ` — did you mean \`${suggestion}\`?` : ''),
    });
  }
}

/** Cheap edit-distance suggestion for typo'd field names. */
function nearest(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}

// ADR-0068 D4 — position-membership predicate heads: a position NAME literal
// used in a membership test against a user subject's `.positions`
// (ADR-0090 D3 rename). Matched names are validated against the closed catalog.
const ROLE_IN_RE = /(['"])([a-z0-9_]+)\1\s+in\s+(?:current_user|user|ctx\.user)\.positions\b/g;
const ROLE_CONTAINS_RE = /(?:current_user|user|ctx\.user)\.positions\s*\.\s*contains\(\s*(['"])([a-z0-9_]+)\1\s*\)/g;
// Bounded quantifiers ({0,N}, not * / *?) keep this linear: a CEL `exists`
// body is tiny in practice, and unbounded greedy/lazy scanners here backtrack
// polynomially (O(n^2)) on adversarial input like repeated `user.positions.exists(`
// (ADR-0068 D4 ReDoS hardening). The pre-`==` class excludes `=` so the bounded
// run stops cleanly before the operator without a lazy quantifier.
const ROLE_EXISTS_RE = /(?:current_user|user|ctx\.user)\.positions\s*\.\s*exists\s*\([^,)]{0,64},[^)=]{0,128}==\s*(['"])([a-z0-9_]+)\1/g;
const ROLE_EQ_RE = /(?:current_user|user|ctx\.user)\.position\s*==\s*(['"])([a-z0-9_]+)\1/g;

/**
 * Flag role-membership predicates referencing a role outside the closed catalog
 * (ADR-0068 D4 — anti-hallucination). No-op when no `roleCatalog` is supplied.
 */
function checkRoleCatalog(
  source: string,
  schema: ExprSchemaHint | undefined,
  errors: ExprValidationError[],
): void {
  const catalog = schema?.roleCatalog;
  if (!catalog || catalog.length === 0) return;
  const known = new Set(catalog);
  const seen = new Set<string>();
  for (const re of [ROLE_IN_RE, ROLE_CONTAINS_RE, ROLE_EXISTS_RE, ROLE_EQ_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const name = m[2];
      if (known.has(name) || seen.has(name)) continue;
      seen.add(name);
      const suggestion = nearest(name, catalog);
      errors.push({
        source,
        message:
          `unknown role \`${name}\` — not a defined role` +
          (suggestion ? `; did you mean \`${suggestion}\`?` : '.') +
          ` Valid roles: ${catalog.join(', ')}.`,
      });
    }
  }
}

/**
 * Validate one expression for a given field role. Never throws — returns a
 * structured result. Call sites decide whether to throw (build/registration)
 * or report (agent tool).
 */
export function validateExpression(
  role: FieldRole,
  input: ExprInput,
  schema?: ExprSchemaHint,
): ExprValidationResult {
  const { dialect, source } = toSource(input);
  const errors: ExprValidationError[] = [];
  const warnings: ExprValidationError[] = [];
  if (!source.trim()) return { ok: true, errors, warnings };

  if (role === 'template') {
    // Templates must be the `template` dialect (or untyped string). Reject a
    // CEL envelope mistakenly placed in a text field.
    if (dialect && dialect !== 'template') {
      errors.push({ source, message: `expected a text template but got a \`${dialect}\` expression.` });
      return { ok: false, errors, warnings };
    }
    const compiled = templateEngine.compile(source);
    if (!compiled.ok) {
      errors.push({ source, message: `invalid template: ${compiled.error.message} (holes use \`{{ path }}\`).` });
    }
    // A single `{x}` in a template is the legacy/deprecated form (ADR-0032 §3).
    const hint = SINGLE_BRACE_RE.test(source) ? bracesHintForTemplate(source) : null;
    if (hint) errors.push({ source, message: hint });
    return { ok: errors.length === 0, errors, warnings };
  }

  // predicate | value → CEL
  if (dialect && dialect !== 'cel') {
    errors.push({ source, message: `expected a CEL expression but got a \`${dialect}\` dialect.` });
    return { ok: false, errors, warnings };
  }
  const compiled = celEngine.compile(source);
  if (!compiled.ok) {
    const hint = bracesHint(source);
    errors.push({
      source,
      message:
        `invalid CEL ${role}: ${compiled.error.message}` +
        (hint ? ` — ${hint}` : ` — ${role}s are bare CEL (e.g. \`record.rating >= 4\`).`),
    });
  } else {
    checkFieldExistence(source, schema, errors);
    checkRoleCatalog(source, schema, errors);
    if (schema?.scope === 'record') {
      // In a `record`-scoped site a bare top-level identifier is a silent bug —
      // it must be `record.<field>` (#1928). Hard error.
      const bare = firstUndeclaredReference(source);
      if (bare) {
        errors.push({
          source,
          message:
            `bare reference \`${bare}\` — a formula/validation expression binds the record as the ` +
            `\`record\` namespace, not at top level, so \`${bare}\` resolves to nothing and the ` +
            `expression silently evaluates to null. Write \`record.${bare}\`.`,
        });
      } else if (schema.fieldTypes) {
        // #1928 tier 4 — with per-field types in hand, flag a text/boolean field
        // used with an arithmetic/ordering operator against a number: it faults
        // the runtime overload and the expression silently evaluates to null.
        // Advisory (never blocks the build): the runtime CAN succeed if a text
        // value happens to be numeric, so this is a warning, not an error. Only
        // runs when there is no bare-ref error (the typed check needs the
        // canonical `record.<field>` form).
        const w = typeSoundnessWarning(source, schema.fieldTypes, 'record');
        if (w) warnings.push(w);
      }
    } else if (schema?.fields && schema.fields.length > 0) {
      // Flattened flow/automation condition: the record's fields ARE bound at
      // top-level, so a bare ref is normally correct. But a *non-field* bare
      // identifier is either a flow variable or a typo. When it is a near-miss
      // of a known field, warn (did-you-mean) WITHOUT failing the build —
      // a genuine flow variable won't be edit-distance-close to a field. (#1928)
      const unknown = firstUndeclaredReference(source, schema.fields);
      if (unknown) {
        const suggestion = nearest(unknown, schema.fields);
        if (suggestion) {
          warnings.push({
            source,
            message:
              `\`${unknown}\` is not a field of \`${schema.objectName ?? 'the trigger object'}\` — ` +
              `did you mean \`${suggestion}\`? (flow conditions reference fields bare, e.g. \`${suggestion} == …\`). ` +
              `If \`${unknown}\` is a flow variable this is safe to ignore.`,
          });
        }
      }
      // #1928 tier 4 — the same type-soundness check, for bare-field conditions:
      // a text/boolean field compared/arithmetic'd against a number faults at
      // runtime. Flow variables stay `dyn` (never flagged); equality is
      // runtime-safe (never flagged). Advisory only.
      if (schema.fieldTypes) {
        const w = typeSoundnessWarning(source, schema.fieldTypes, 'flattened');
        if (w) warnings.push(w);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function bracesHintForTemplate(source: string): string {
  const m = SINGLE_BRACE_RE.exec(source);
  const ref = m?.[1] ?? 'field';
  return `single-brace \`{${ref}}\` is not a valid template hole — use double braces: \`{{ ${ref} }}\`.`;
}

/**
 * Introspect what an author (esp. an agent) may use in a field (Decision 1e):
 * the expected dialect, the in-scope field references, and the callable
 * functions. Feeds the authoring context so the model does not guess.
 */
export function introspectScope(role: FieldRole, schema?: ExprSchemaHint): {
  dialect: 'cel' | 'template';
  fields: string[];
  roots: string[];
  roles: string[];
  functions: string[];
} {
  return {
    dialect: expectedDialect(role),
    fields: [...(schema?.fields ?? [])],
    roots: ['record', 'previous', 'input', 'os', 'current_user', 'user', 'vars'],
    roles: [...(schema?.roleCatalog ?? [])],
    functions: CEL_STDLIB_FUNCTIONS,
  };
}

/**
 * Coarse value categories a `value`/formula expression can compute. `'unknown'`
 * means cel-js could not prove a concrete type — either a `dyn` result (an
 * ambiguous expression over untyped operands) or one that does not type-check.
 */
export type InferredValueType = 'number' | 'text' | 'boolean' | 'date' | 'unknown';

/** Map a cel-js type-checker type name onto an ObjectStack field value category. */
function celTypeToValueType(celType: string | null): InferredValueType {
  switch (celType) {
    case 'int':
    case 'uint':
    case 'double':
      return 'number';
    case 'string':
      return 'text';
    case 'bool':
      return 'boolean';
    case 'google.protobuf.Timestamp':
      return 'date';
    default:
      // `dyn`, `google.protobuf.Duration`, list/map, null, or un-type-checkable.
      return 'unknown';
  }
}

/**
 * Infer the coarse value type a `value`/formula expression computes — `'number'`,
 * `'text'`, `'boolean'`, `'date'`, or `'unknown'` when cel-js cannot prove a
 * concrete type. `schema.fields` (the host object's field names) are declared so
 * a bare `<field>` reference resolves the same as `record.<field>`.
 *
 * The motivating use is measure-eligibility: a dataset derives a SUM measure for
 * a `formula` field ONLY when this returns `'number'`, so an ambiguous or
 * non-numeric formula never yields an incoherent measure. Conservative by
 * construction — see {@link inferCelType}.
 */
export function inferExpressionType(input: ExprInput, schema?: ExprSchemaHint): InferredValueType {
  const { source } = toSource(input);
  if (!source.trim()) return 'unknown';
  return celTypeToValueType(inferCelType(source, schema?.fields));
}

/**
 * Public catalog of CEL functions available in expressions — what `introspectScope`
 * advertises to authors (incl. AI). Every entry MUST actually resolve at runtime:
 * either registered in `registerStdLib` or a verified cel-js built-in. Drifting this
 * list ahead of the runtime tells the author to call functions that fault (#1928).
 */
export const CEL_STDLIB_FUNCTIONS: string[] = [
  // Dates (registered stdlib)
  'now', 'today', 'daysFromNow', 'daysAgo', 'daysBetween', 'addDays', 'addMonths', 'date', 'datetime',
  // Numbers (registered stdlib)
  'abs', 'round', 'min', 'max',
  // Strings (registered stdlib)
  'upper', 'lower', 'trim', 'contains', 'startsWith', 'endsWith', 'matches', 'joinNonEmpty',
  // Collections / null-ish (registered stdlib)
  'isBlank', 'isEmpty', 'coalesce', 'len',
  // cel-js built-ins (verified to resolve)
  'size', 'has', 'int', 'string', 'bool', 'double', 'timestamp', 'duration',
];

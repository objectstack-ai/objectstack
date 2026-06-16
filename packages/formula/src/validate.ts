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

import { celEngine, firstUndeclaredReference } from './cel-engine';
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
  functions: string[];
} {
  return {
    dialect: expectedDialect(role),
    fields: [...(schema?.fields ?? [])],
    roots: ['record', 'previous', 'input', 'os', 'vars'],
    functions: CEL_STDLIB_FUNCTIONS,
  };
}

/**
 * Public catalog of CEL functions available in expressions — what `introspectScope`
 * advertises to authors (incl. AI). Every entry MUST actually resolve at runtime:
 * either registered in `registerStdLib` or a verified cel-js built-in. Drifting this
 * list ahead of the runtime tells the author to call functions that fault (#1928).
 */
export const CEL_STDLIB_FUNCTIONS: string[] = [
  // Dates (registered stdlib)
  'now', 'today', 'daysFromNow', 'daysAgo', 'daysBetween', 'date', 'datetime',
  // Numbers (registered stdlib)
  'abs', 'round', 'min', 'max',
  // Strings (registered stdlib)
  'upper', 'lower', 'trim', 'contains', 'startsWith', 'endsWith', 'matches', 'joinNonEmpty',
  // Collections / null-ish (registered stdlib)
  'isBlank', 'isEmpty', 'coalesce', 'len',
  // cel-js built-ins (verified to resolve)
  'size', 'has', 'int', 'string', 'bool', 'double', 'timestamp', 'duration',
];

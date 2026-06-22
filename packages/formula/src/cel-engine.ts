/**
 * CEL dialect engine — wraps `@marcbachmann/cel-js` with the ObjectStack
 * stdlib, bounded execution limits, and result coercion.
 *
 * Why a thin wrapper:
 *
 *  - cel-js returns `BigInt` for ints. The kernel and CRM expect plain
 *    numbers, so we coerce at the boundary.
 *  - cel-js parses dotted names as receiver-typed methods; we register
 *    `now()`, `today()`, `daysFromNow()` as bare functions and let `os.*`
 *    refer to context data only (see {@link buildScope}).
 *  - Bounds (`maxAstNodes`, `maxDepth`, …) are enforced spec-wide so
 *    third-party plugins can't ship runaway predicates.
 */

import { Environment } from '@marcbachmann/cel-js';
import type { Expression } from '@objectstack/spec';

import { buildScope, registerNumericCoercions, registerStdLib } from './stdlib';
import type { DialectEngine, EvalContext, EvalResult } from './types';

/**
 * Default execution bounds. Picked conservatively — every metadata-authored
 * expression we've seen is well under these. If you hit them, the expression
 * is too complex for ObjectStack and should be moved to a hook (`dialect: js`).
 */
export const DEFAULT_LIMITS = {
  maxAstNodes: 256,
  maxDepth: 32,
  maxListElements: 64,
  maxMapEntries: 64,
  maxCallArguments: 16,
} as const;

function buildEnv(now: () => Date, timezone = 'UTC'): Environment {
  const env = new Environment({
    unlistedVariablesAreDyn: true,
    enableOptionalTypes: true,
    limits: DEFAULT_LIMITS,
  });
  return registerNumericCoercions(registerStdLib(env, now, timezone));
}

/**
 * Namespace roots that a `record`-scoped CEL site may legitimately reference.
 * Declared as `map` (dyn values) so member access (`record.foo`) and any
 * arithmetic/comparison on it defers to runtime — the strict env faults ONLY on
 * an *undeclared* top-level identifier, i.e. a bare field reference. Generous on
 * purpose: an unknown root is a missed catch, a missing root is a false positive
 * that would break the build, so we err toward declaring more.
 */
const SCOPE_ROOTS = [
  'record', 'previous', 'input', 'output', 'os', 'vars', 'variables',
  'automation', 'context', 'args', 'item', 'env', 'user', 'step', 'result',
  'trigger', 'event', 'payload', 'data', 'params', 'config', 'settings',
  // UI action / predicate context (ActionEngine, renderers): the current
  // record plus ambient globals exposed to `visible`/`disabled` predicates.
  'ctx', 'features',
  // Master-detail inline grids inject the header record as `parent` for a
  // child field's `readonlyWhen`/`requiredWhen` predicate (ADR-0036, #1581).
  'parent',
] as const;

/**
 * A `record`-scoped environment (`unlistedVariablesAreDyn: false`) for detecting
 * bare field references. It reuses the real stdlib so function calls don't fault;
 * only undeclared *variables* do. Built once — `parse`/`check` do not mutate it.
 */
function buildScopedEnv(knownFields: readonly string[]): Environment {
  const env = new Environment({
    unlistedVariablesAreDyn: false,
    enableOptionalTypes: true,
    limits: DEFAULT_LIMITS,
  });
  registerStdLib(env, () => new Date(0));
  for (const root of SCOPE_ROOTS) {
    try { env.registerVariable(root, 'map'); } catch { /* duplicate — ignore */ }
  }
  // `knownFields` are declared as `dyn` so they (and member/arith/compare on
  // them) never fault — only a genuinely-undeclared top-level identifier does.
  // Empty for a record-scope site (any bare field is a bug); the trigger
  // object's fields for a flattened flow condition (only a NON-field bare ref —
  // a typo or flow variable — is then interesting).
  for (const field of knownFields) {
    try { env.registerVariable(field, 'dyn'); } catch { /* duplicate / reserved — ignore */ }
  }
  return env;
}

// Roots-only env reused for the common record-scope check (no per-call rebuild).
let recordScopeEnv: Environment | undefined;

/**
 * In a `record`-scoped CEL site — a `Field.formula` or an object validation
 * predicate — the evaluation scope binds only the `record`/`previous`/… *namespaces*
 * (no field flattening). A bare top-level identifier like `amount` or `status`
 * therefore resolves to nothing and the expression silently evaluates to `null`
 * / never fires (#1928, the class behind #1927's broken formulas). Returns the
 * first such bare reference, or `null`.
 *
 * Acts ONLY on cel-js's `Unknown variable: X` fault, so it cannot false-positive
 * on arithmetic/comparison overloads — and it must NOT be applied to flow /
 * automation conditions, where the record's fields ARE flattened to top-level
 * and bare references are correct.
 */
export function firstUndeclaredReference(
  source: string,
  knownFields: readonly string[] = [],
): string | null {
  if (typeof source !== 'string' || !source.trim()) return null;
  try {
    const env = knownFields.length === 0
      ? (recordScopeEnv ??= buildScopedEnv([]))
      : buildScopedEnv(knownFields);
    const result = env.parse(source).check?.() as
      | { valid: boolean; error?: { message?: string } }
      | undefined;
    if (result && result.valid === false) {
      const m = /Unknown variable:\s*([A-Za-z_$][\w$]*)/.exec(result.error?.message ?? '');
      if (m) return m[1];
    }
  } catch {
    // Parse/other faults are the syntax checker's job (celEngine.compile); this
    // helper only reports the undeclared-variable case.
  }
  return null;
}

/** @deprecated use {@link firstUndeclaredReference} with no fields. */
export function detectBareReference(source: string): string | null {
  return firstUndeclaredReference(source);
}

/** Coerce cel-js's BigInt-flavored return into spec-friendly JS values. */
function coerce(value: unknown): unknown {
  if (typeof value === 'bigint') {
    // BigInt → number when safe, else string to avoid silent truncation.
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(coerce);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = coerce(v);
    return out;
  }
  return value;
}

/**
 * A string that is *entirely* a JS number literal: optional sign, integer
 * and/or fractional part, optional exponent. Deliberately strict — `"5.0"`,
 * `"250000.00"`, `"-3"`, `"1e3"` match; `"5px"`, `"0x10"`, `" "`, `""`,
 * `"1,000"`, `"v2"` do not.
 */
// The fractional part is a single optional `(?:\.\d*)?` group anchored by the
// literal `.` — never the ambiguous `\d+\.?\d*`, whose adjacent unbounded
// quantifiers (`\d+\d*` when the dot is absent) backtrack polynomially on long
// digit runs (CodeQL ReDoS). This matches the same strings without the hazard.
const NUMERIC_STRING_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A string that is an ISO-8601 date (`"2026-06-20"`) or date-time
 * (`"2026-06-20T08:15:35.244Z"`, `"2026-06-20 08:15"`, `"...+02:00"`). Strict
 * and anchored — no nested unbounded quantifiers, so no ReDoS hazard (every
 * sub-group is bounded or a single `\.\d+`). `Field.date` / `Field.datetime`
 * serialize to these; cel-js compares them as `string` and faults against the
 * `google.protobuf.Timestamp` returned by `today()` / `now()` / `daysFromNow()`.
 */
const ISO_TEMPORAL_STRING_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * cel-js raises `no such overload: dyn <op> int` (and kin) when a comparison
 * or arithmetic operator sees a `string` on one side and a number on the
 * other. ADR-0032 §1c — numeric fields that serialize as strings (`Field.rating`
 * → `"5.0"`, `Field.currency` → `"250000.00"`, `Field.percent`) trip this in
 * flow conditions / formulas (#1530, #1534) even though the schema and the
 * build-time validator treat them as numeric.
 */
function isNumericOverloadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such overload/i.test(message);
}

/**
 * Recursively coerce string values that faulted a CEL overload into their
 * intended primitive: entirely-numeric literals → `number` (#1534), and
 * ISO-8601 date / date-time strings → `Date` (cel-js `google.protobuf.Timestamp`)
 * (#1530). Used only on the {@link isNumericOverloadError} retry path, so it can
 * never change a comparison that already evaluated cleanly — it only rescues one
 * that already faulted. Strings that are neither (a zip like `"02134"`, free
 * text) pass through untouched; if the retry still cannot type-check, the
 * original loud error is preserved.
 */
function hydrateOverloadStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      if (NUMERIC_STRING_RE.test(trimmed)) {
        const n = Number(trimmed);
        if (Number.isFinite(n)) return n;
      } else if (ISO_TEMPORAL_STRING_RE.test(trimmed)) {
        const ms = Date.parse(trimmed);
        if (!Number.isNaN(ms)) return new Date(ms);
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(hydrateOverloadStrings);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = hydrateOverloadStrings(v);
    return out;
  }
  return value;
}

function classifyError(err: unknown): EvalResult<never> {
  const message = err instanceof Error ? err.message : String(err);
  let kind: 'parse' | 'type' | 'runtime' | 'bounds' = 'runtime';
  if (/Exceeded max/i.test(message)) kind = 'bounds';
  else if (/parse|unexpected|syntax/i.test(message)) kind = 'parse';
  else if (/type|unknown variable|undeclared/i.test(message)) kind = 'type';
  return { ok: false, error: { kind, message } };
}

export const celEngine: DialectEngine = {
  dialect: 'cel',

  compile(source: string): EvalResult<unknown> {
    try {
      // We use a wall-clock now() here purely for parse-time stdlib
      // type-checking; the function is never actually called.
      const env = buildEnv(() => new Date(0));
      const compiled = env.parse(source);
      // Surface check errors eagerly. cel-js's `check()` returns a
      // `TypeCheckResult` object (`{ valid, type?, error? }`) — NOT an array —
      // so the type fault (including `found no matching overload for 'PRIOR(dyn)'`
      // when a condition calls an UNKNOWN function) only surfaces when we read
      // `valid === false`. The previous `Array.isArray(...)` guard never matched
      // an object, so unknown-function predicates type-checked clean and were
      // silently accepted by `objectstack build` / `registerFlow`, then no-op'd
      // the flow at runtime (#1877). Reading the documented shape closes that.
      const checkResult = compiled.check?.();
      if (checkResult && checkResult.valid === false) {
        return {
          ok: false,
          error: { kind: 'type', message: checkResult.error?.message ?? 'expression failed type checking' },
        };
      }
      return { ok: true, value: compiled.ast };
    } catch (err) {
      return classifyError(err);
    }
  },

  evaluate<T = unknown>(expr: Expression, ctx: EvalContext): EvalResult<T> {
    if (expr.dialect !== 'cel') {
      return {
        ok: false,
        error: { kind: 'dialect', message: `celEngine cannot evaluate dialect '${expr.dialect}'` },
      };
    }
    const source = expr.source;
    if (typeof source !== 'string' || source.length === 0) {
      // AST-only inputs: cel-js does not currently expose a public API to
      // re-execute a parsed AST without re-serializing. We persist `source`
      // as the canonical form during M9.1 and revisit AST-only execution in
      // M9.7 when we cut the spec persistence over.
      return {
        ok: false,
        error: { kind: 'parse', message: 'AST-only evaluation not yet supported; persist `source`' },
      };
    }

    const now = () => ctx.now ?? new Date();
    try {
      const env = buildEnv(now, ctx.timezone ?? 'UTC');
      const scope = buildScope(ctx);
      try {
        const raw = env.evaluate(source, scope);
        return { ok: true, value: coerce(raw) as T };
      } catch (err) {
        // ADR-0032 §1c — string-serialized fields make CEL raise
        // `no such overload`: numeric fields (`rating` → `"5.0"`,
        // `amount` → `"250000.00"`) on `record.rating >= 4` (#1534), and
        // date/datetime fields (`end_date` → `"2026-06-20"`) on
        // `record.end_date <= daysFromNow(60)` (#1530), since cel-js compares the
        // raw string against the `google.protobuf.Timestamp` from `today()` etc.
        // Hydrate those strings to number / Date and retry ONCE. This only runs
        // after a fault, so a comparison that already evaluated cleanly is never
        // re-interpreted; if the retry still cannot type-check, the original loud
        // error is reported.
        if (!isNumericOverloadError(err)) throw err;
        const hydrated = hydrateOverloadStrings(scope) as Record<string, unknown>;
        try {
          const raw = env.evaluate(source, hydrated);
          return { ok: true, value: coerce(raw) as T };
        } catch {
          // Hydration did not resolve it — surface the original fault, not the
          // retry's, so the message reflects what the author actually wrote.
          throw err;
        }
      }
    } catch (err) {
      return classifyError(err);
    }
  },
};

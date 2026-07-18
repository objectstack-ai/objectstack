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

import { Environment, serialize } from '@marcbachmann/cel-js';
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

/**
 * The result type cel-js's type-checker infers for a `value`/`predicate`
 * expression — its raw CEL type name (`'int'`, `'double'`, `'string'`, `'bool'`,
 * `'google.protobuf.Timestamp'`, `'dyn'`, …) — or `null` when the expression does
 * not type-check. Reuses the SAME record-scoped, stdlib-registered env as
 * {@link firstUndeclaredReference}: namespace roots (`record`, `previous`, …) are
 * declared `map` and `knownFields` are declared `dyn`, so both `record.<field>`
 * and bare `<field>` references resolve while every stdlib call carries its
 * declared return type.
 *
 * Deliberately conservative. A member access (`record.amount`) or a bare field is
 * `dyn`, and an operator over two `dyn` operands stays `dyn` (cel-js cannot prove
 * it numeric), so `record.a + record.b` — which could be string concatenation —
 * infers `dyn`, not a number. A typed literal or a stdlib return DOES pin the
 * type, so the common computed-number formulas resolve concretely:
 * `daysBetween(start_date, end_date) + 1` → `int`, `amount * 0.1` → `double`. A
 * caller keying off a concrete numeric type therefore never mis-classifies an
 * ambiguous formula.
 */
export function inferCelType(source: string, knownFields: readonly string[] = []): string | null {
  if (typeof source !== 'string' || !source.trim()) return null;
  try {
    const env = knownFields.length === 0
      ? (recordScopeEnv ??= buildScopedEnv([]))
      : buildScopedEnv(knownFields);
    const result = env.parse(source).check?.() as
      | { valid?: boolean; type?: unknown }
      | undefined;
    if (!result || result.valid === false) return null;
    return typeof result.type === 'string' ? result.type : null;
  } catch {
    // Parse/other faults mean we cannot prove a type — the conservative `null`.
    return null;
  }
}

/** @deprecated use {@link firstUndeclaredReference} with no fields. */
export function detectBareReference(source: string): string | null {
  return firstUndeclaredReference(source);
}

/**
 * The CEL type a field is declared as for the Tier-4 type-soundness check
 * (#1928). Deliberately coarse: only genuinely-scalar, non-numeric-intent
 * fields are pinned to a concrete type; everything the runtime rescues stays
 * `dyn` and can therefore never fault. See {@link firstTypeMismatch}.
 */
export type FieldCelType = 'string' | 'bool' | 'dyn';

/**
 * A `no such overload` fault for an ARITHMETIC (`+ - * / %`) or ORDERING
 * (`< > <= >=`) operator, with the two operand types captured. Equality
 * (`==` / `!=`) is intentionally excluded: cel-js's checker faults on a
 * heterogeneous equality (`string == int`) but the runtime evaluates it
 * cleanly to `false` — so a fault there is NOT a runtime failure and must not
 * warn. Linear (no nested quantifiers) — no ReDoS. Operand types are `[\w.]+`
 * (e.g. `string`, `int`, `google.protobuf.Timestamp`); the operator token is
 * punctuation, so the two never overlap.
 */
const UNSOUND_OVERLOAD_RE = /no such overload:\s*([\w.]+)\s*(<=|>=|<|>|\+|-|\*|\/|%)\s*([\w.]+)/;

/**
 * A typed environment for the soundness check. Each field carries a concrete
 * CEL type (`string`/`bool`) or `dyn`, so cel-js's checker faults an
 * arithmetic/ordering operator applied across incompatible types. The `scope`
 * mirrors how the authoring site binds fields:
 *  - `'record'`    → `record.<field>` member access, via a typed struct on the
 *                    `record`/`previous`/`input` namespaces (formula fields,
 *                    validations, action/hook/sharing predicates).
 *  - `'flattened'` → bare `<field>` top-level variables (flow / automation
 *                    conditions). Unlisted identifiers stay `dyn`
 *                    (`unlistedVariablesAreDyn: true`) so a flow variable never
 *                    faults — only a typed field misused does.
 * Built per call — cheap, and only used at build time.
 */
function buildTypedEnv(
  fieldCelTypes: Readonly<Record<string, FieldCelType>>,
  scope: 'record' | 'flattened',
): Environment {
  if (scope === 'flattened') {
    const env = new Environment({
      unlistedVariablesAreDyn: true,
      enableOptionalTypes: true,
      limits: DEFAULT_LIMITS,
    });
    registerStdLib(env, () => new Date(0));
    for (const root of SCOPE_ROOTS) {
      try { env.registerVariable(root, 'map'); } catch { /* duplicate — ignore */ }
    }
    // Fields are bound bare at top level; a name that collides with a root
    // (unlikely) is skipped by the duplicate guard.
    for (const [name, t] of Object.entries(fieldCelTypes)) {
      try { env.registerVariable(name, t); } catch { /* duplicate / reserved — ignore */ }
    }
    return env;
  }
  const env = new Environment({
    unlistedVariablesAreDyn: false,
    enableOptionalTypes: true,
    limits: DEFAULT_LIMITS,
  });
  registerStdLib(env, () => new Date(0));
  const fields: Record<string, string> = {};
  for (const [name, t] of Object.entries(fieldCelTypes)) fields[name] = t;
  try { env.registerType('OsRecordScope', { fields }); } catch { /* invalid field name — ignore */ }
  // The record namespaces carry the typed struct; every other root stays a
  // `map` (dyn members) so a reference through it never faults.
  for (const root of ['record', 'previous', 'input']) {
    try { env.registerVariable(root, 'OsRecordScope'); } catch { /* duplicate — ignore */ }
  }
  for (const root of SCOPE_ROOTS) {
    try { env.registerVariable(root, 'map'); } catch { /* already typed above / duplicate — ignore */ }
  }
  return env;
}

/**
 * The first field reference in `source` whose declared CEL type matches
 * `celType` — best-effort attribution of an overload fault to the offending
 * field. In `'record'` scope it looks for `record.<field>` (or `previous.`/
 * `input.`); in `'flattened'` scope for a bare `<field>` not preceded by a dot.
 * Returns `null` if none is found.
 */
function offendingField(
  source: string,
  fieldCelTypes: Readonly<Record<string, FieldCelType>>,
  celType: FieldCelType,
  scope: 'record' | 'flattened',
): string | null {
  for (const [name, t] of Object.entries(fieldCelTypes)) {
    if (t !== celType) continue;
    // Word-bounded so `amount` does not match `amount_total`; in flattened
    // scope the leading lookbehind excludes a member ref like `previous.amount`.
    const re = scope === 'flattened'
      ? new RegExp(`(?<![\\w$.])${name}(?![\\w$])`)
      : new RegExp(`(?:record|previous|input)\\.${name}(?![\\w$])`);
    if (re.test(source)) return name;
  }
  return null;
}

/**
 * Tier-4 type-soundness (#1928): detect a `record`-scoped expression that
 * type-checks structurally but faults a runtime operator overload because a
 * text (`string`) or boolean (`bool`) field is used with an arithmetic or
 * ordering operator against a number. Such an expression evaluates to `null`
 * at runtime (unless the text value happens to be numeric), so it is surfaced
 * as a NON-blocking warning.
 *
 * Soundness (the ADR-0032 design law — never flag what the runtime tolerates):
 *  - Number / currency / percent / date / datetime fields are declared `dyn`,
 *    because the runtime rescues every mixed case for them — `registerOperator`
 *    for `double`×`int` arithmetic and the string-hydration retry for
 *    numeric-string / ISO-date values — so they can never fault here.
 *  - Equality (`==` / `!=`) is excluded ({@link UNSOUND_OVERLOAD_RE}): a
 *    heterogeneous equality is runtime-safe.
 *
 * Returns the operand types, the faulting operator, the concrete operand CEL
 * type, and (best-effort) the offending field — or `null` when type-sound.
 *
 * `scope` selects how fields are bound: `'record'` (default) for
 * `record.<field>` sites; `'flattened'` for bare-field flow/automation
 * conditions.
 */
export function firstTypeMismatch(
  source: string,
  fieldCelTypes: Readonly<Record<string, FieldCelType>>,
  scope: 'record' | 'flattened' = 'record',
): { operator: string; operands: string; celType: FieldCelType; field: string | null } | null {
  if (typeof source !== 'string' || !source.trim()) return null;
  // An all-`dyn` record can never fault an overload — skip the parse entirely.
  if (!Object.values(fieldCelTypes).some((t) => t === 'string' || t === 'bool')) return null;
  try {
    const env = buildTypedEnv(fieldCelTypes, scope);
    const result = env.parse(source).check?.() as
      | { valid?: boolean; error?: { message?: string } }
      | undefined;
    if (!result || result.valid !== false) return null;
    const m = UNSOUND_OVERLOAD_RE.exec(result.error?.message ?? '');
    if (!m) return null;
    const operator = m[2];
    const celType: FieldCelType | null =
      m[1] === 'string' || m[1] === 'bool' ? (m[1] as FieldCelType)
      : m[3] === 'string' || m[3] === 'bool' ? (m[3] as FieldCelType)
      : null;
    if (!celType) return null;
    return {
      operator,
      operands: `${m[1]} ${operator} ${m[3]}`,
      celType,
      field: offendingField(source, fieldCelTypes, celType, scope),
    };
  } catch {
    // A parse/other fault is the syntax checker's job (celEngine.compile); this
    // helper only reports a clean type-soundness verdict.
    return null;
  }
}

/** cel-js temporal functions that return a calendar Timestamp (for #3183). */
const TEMPORAL_FNS = new Set(['today', 'daysFromNow', 'daysAgo', 'now']);

/** A cel-js AST node is `{ op, args }`; `args` is a node[], or a leaf string. */
type CelNode = { op: string; args: unknown };

function isCelNode(v: unknown): v is CelNode {
  return typeof v === 'object' && v !== null && typeof (v as CelNode).op === 'string';
}

/** True when `node` is a call to a temporal function (`today()`/`daysFromNow(…)`/…). */
function isTemporalCall(node: unknown): boolean {
  return isCelNode(node) && node.op === 'call'
    && Array.isArray(node.args) && typeof node.args[0] === 'string'
    && TEMPORAL_FNS.has(node.args[0]);
}

/**
 * If `node` is a field reference — `record.<f>` / `previous.<f>` (member access)
 * or a bare `<f>` (flattened flow scope) — return the field name `<f>`, else null.
 */
function fieldRefName(node: unknown): string | null {
  if (!isCelNode(node)) return null;
  if (node.op === 'id' && typeof node.args === 'string') return node.args; // bare `<f>`
  if (node.op === '.' && Array.isArray(node.args) && node.args.length === 2) {
    const [base, member] = node.args;
    if (isCelNode(base) && base.op === 'id'
      && (base.args === 'record' || base.args === 'previous')
      && typeof member === 'string') {
      return member;
    }
  }
  return null;
}

/** Wrap an AST field-reference node in a `date(...)` call (the stdlib coercion). */
function wrapInDate(node: CelNode): CelNode {
  return { op: 'call', args: ['date', [node]] };
}

/**
 * #3183 — rewrite each `<field> ==/!= <temporal>()` (either operand order) so the
 * FIELD operand is coerced with `date(...)`. A `Field.date` reads back as a
 * `YYYY-MM-DD` string and cel-js equality never matches a string against the
 * Timestamp that `today()` etc. return, so the bare comparison silently misses;
 * `date(record.d) == today()` compares two Timestamps and matches on the calendar
 * day. The rewrite is:
 *   - **per-occurrence** — only the operand paired with a temporal call is wrapped,
 *     so `record.d == "2026-06-20" || record.d == today()` keeps the string-literal
 *     comparison intact while fixing the temporal one (no field-wide trade-off);
 *   - **type-blind-safe** — `date()`/`toDate` degrades gracefully (an already-`Date`
 *     datetime field passes through; a non-date string / null → `Invalid Date` →
 *     the comparison stays `false`, exactly as today), so no field-type info is
 *     needed and a currently-correct result is never worsened;
 *   - **idempotent** — `date(record.d)` is a `call`, not a field ref, so it is not
 *     re-wrapped.
 *
 * Returns the (possibly rewritten) source. Only reserializes when a rewrite
 * actually happened — the ~99% case that needs no rewrite evaluates the original
 * source untouched. Memoized per source string; a parse fault returns the source
 * unchanged (compile()/evaluate() report it).
 */
export function rewriteTemporalEquality(source: string): string {
  if (typeof source !== 'string' || !source.trim()) return source;
  const cached = temporalRewriteCache.get(source);
  if (cached !== undefined) return cached;
  // Cheap gate: a rewrite needs an equality operator AND a temporal call.
  const gated = (source.includes('==') || source.includes('!='))
    && (source.includes('today') || source.includes('daysFromNow')
      || source.includes('daysAgo') || source.includes('now'));
  if (!gated) { rememberRewrite(source, source); return source; }

  let ast: unknown;
  try {
    ast = (recordScopeEnv ??= buildScopedEnv([])).parse(source).ast;
  } catch {
    rememberRewrite(source, source);
    return source;
  }
  let changed = false;
  const visit = (node: unknown): void => {
    if (!isCelNode(node)) return;
    if ((node.op === '==' || node.op === '!=') && Array.isArray(node.args) && node.args.length === 2) {
      const args = node.args as unknown[];
      const [left, right] = args;
      // Wrap the field operand paired with a temporal call. Guard `fieldRefName`
      // so we never wrap a literal, another call, or an arithmetic sub-tree.
      if (isTemporalCall(left) && isCelNode(right) && fieldRefName(right)) { args[1] = wrapInDate(right); changed = true; }
      else if (isTemporalCall(right) && isCelNode(left) && fieldRefName(left)) { args[0] = wrapInDate(left); changed = true; }
    }
    if (Array.isArray(node.args)) for (const child of node.args) visit(child);
  };
  visit(ast);
  const out = changed ? serialize(ast as Parameters<typeof serialize>[0]) : source;
  rememberRewrite(source, out);
  return out;
}

/** Bounded memo of source → temporal-equality-rewritten source (#3183). */
const temporalRewriteCache = new Map<string, string>();
const TEMPORAL_REWRITE_CACHE_MAX = 500;
function rememberRewrite(source: string, rewritten: string): void {
  // Simple FIFO cap — expression sources are few and long-lived; this only guards
  // against an unbounded set of one-off dynamic strings.
  if (temporalRewriteCache.size >= TEMPORAL_REWRITE_CACHE_MAX) {
    const first = temporalRewriteCache.keys().next().value;
    if (first !== undefined) temporalRewriteCache.delete(first);
  }
  temporalRewriteCache.set(source, rewritten);
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
      // #3183 — coerce a date-field operand compared with `==`/`!=` against a
      // temporal function (`date(record.d) == today()`), so a `Field.date` string
      // matches the Timestamp instead of silently never equalling it. No-op (and
      // no reserialize) for any source without such a comparison.
      const evalSource = rewriteTemporalEquality(source);
      try {
        const raw = env.evaluate(evalSource, scope);
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
          const raw = env.evaluate(evalSource, hydrated);
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

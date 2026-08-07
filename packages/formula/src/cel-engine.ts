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
import type { ASTNode } from '@marcbachmann/cel-js';
import type { Expression } from '@objectstack/spec';

import { buildScope, registerNumericCoercions, registerStdLib } from './stdlib';
import type { DialectEngine, EvalContext, EvalResult } from './types';

/**
 * Default execution bounds. Picked conservatively — every metadata-authored
 * expression we've seen is well under these. If you hit them, the expression
 * is too complex for a CEL formula and should move to a hook/action body
 * (`ScriptBody { language: 'js' }`, the L2 sandboxed surface).
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
  // Approval-node `expression` approvers (#3447 P2): the record's LIVE state
  // at node entry — bound only in that evaluation site, alongside `trigger`
  // (the submit-time snapshot) and `vars`. Declared here so the strict lint
  // env doesn't misread `current.x` as a bare field reference.
  'current',
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
 * The distinct top-level identifiers (namespace roots) a CEL expression
 * references — `current.x + vars.step.y` → `['current', 'vars']`, a bare
 * `amount > 100` → `['amount']`. Member names and function names are not
 * identifiers and are never reported.
 *
 * Built for evaluation sites that expose a CLOSED set of roots (#3447 P2:
 * approval-node `expression` approvers allow only `current`/`trigger`/`vars`).
 * Such a site must reject any other root BEFORE evaluating: the runtime env is
 * `unlistedVariablesAreDyn: true`, so an out-of-contract root (`record.x`, a
 * bare field) would otherwise evaluate to `null` and silently produce an empty
 * result instead of an error. Both the lint rule and the runtime pre-check
 * consume this one helper so the two can never drift.
 *
 * Returns `{ ok: false }` with the classifier's message when the source does
 * not parse — callers surface that as a config error, not an empty root set.
 */
export function collectCelRootIdentifiers(
  source: string,
): { ok: true; roots: string[] } | { ok: false; error: string } {
  if (typeof source !== 'string' || !source.trim()) {
    return { ok: false, error: 'expression is empty' };
  }
  try {
    // Same nullable-ternary rewrite as compile/evaluate so "what parses" agrees
    // across build, lint, and runtime (#3306).
    const compiled = buildEnv(() => new Date(0)).parse(rewriteNullableTernary(source));
    const roots = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { for (const child of node) walk(child); return; }
      if (!isCelNode(node)) return; // member/function-name strings, literals
      if (node.op === 'id' && typeof node.args === 'string') { roots.add(node.args); return; }
      // Member access: only the receiver can hold identifiers — `args[1]` is the
      // member NAME, which must not be reported as a root.
      if (node.op === '.' && Array.isArray(node.args)) { walk(node.args[0]); return; }
      walk(node.args);
    };
    walk(compiled.ast);
    return { ok: true, roots: [...roots] };
  } catch (err) {
    const classified = classifyError(err);
    return { ok: false, error: classified.ok === false ? classified.error.message : String(err) };
  }
}

/**
 * A parsed CEL AST node, re-exported so a consumer can name the type this
 * package already hands it without importing `@marcbachmann/cel-js` itself.
 *
 * The alias is not cosmetic. {@link lowerCelAst} has always *taken* a cel-js
 * `ASTNode` while the type stayed unexported, so every caller that wanted to
 * hold an AST had to reach past this package to the parser — which is precisely
 * how a second, differently-configured parse entry gets built (#4812). Prefixed
 * `Cel` to match the package's other CEL-domain public names
 * (`CelFilterCompileResult`, `collectCelRootIdentifiers`, `isPushdownableCel`);
 * bare `ASTNode` would be ambiguous in a package that also owns the cron and
 * template dialects.
 */
export type CelAstNode = ASTNode;

/**
 * The canonical parse env. Identical in configuration to the one
 * {@link celEngine.compile} builds per call — same `unlistedVariablesAreDyn`,
 * same `enableOptionalTypes`, same {@link DEFAULT_LIMITS}, same stdlib — and
 * built once because `parse` neither mutates the environment nor depends on the
 * `now()` it was given (the same reasoning `recordScopeEnv` already relies on).
 * The parity suite pins the equivalence against a freshly-built env, so this
 * memo cannot silently drift away from `compile`.
 */
let canonicalParseEnv: Environment | undefined;

/**
 * Parse a CEL source to its AST through the **canonical** front end — the one
 * answer in this repo to "what parses" (#4812).
 *
 * Every other entry point in this package (`compile`, `evaluate`,
 * {@link collectCelRootIdentifiers}) reaches the parser through the same three
 * things, and so does this one:
 *
 *  1. {@link rewriteNullableTernary} — the #3306 `cond ? value : null` rewrite,
 *     so the AST a consumer analyses is the AST the runtime will execute, not
 *     the shape the author happened to type;
 *  2. {@link DEFAULT_LIMITS} — the platform's bounds. A source over
 *     `maxAstNodes` / `maxDepth` / `maxListElements` does **not** parse here,
 *     because it does not parse anywhere else on the platform either;
 *  3. the registered stdlib and `unlistedVariablesAreDyn: true` env.
 *
 * A consumer that built its own `new Environment(...)` instead got a different
 * answer to (2) in particular — it would happily parse, and then reason about,
 * a predicate `compile()` rejects outright. That is not a hypothetical: it is
 * what `@objectstack/lint`'s null-guard pass did until #4812.
 *
 * Returns `null` — never throws — when the source is empty or does not parse,
 * so a caller whose job is *not* to adjudicate syntax can skip it in one line
 * and leave the verdict to the gate that owns it (`validateExpression`, which
 * reports both the syntax fault and the bounds fault with a message written for
 * self-correction).
 *
 * This is `parse` only, deliberately **not** `parse + check`: `compile()` is the
 * entry that also type-checks. A caller that wants the AST of an expression
 * which parses but does not type-check (a great many predicates over `dyn`
 * operands) must not be denied it, and a caller that wants the type verdict
 * should ask `compile()` for it. The parity suite pins both halves of that
 * asymmetry so neither side drifts.
 */
export function parseCelToAst(source: string): CelAstNode | null {
  if (typeof source !== 'string' || !source.trim()) return null;
  try {
    // A wall-clock-free `now()` — the stdlib is registered for parse-time shape
    // only and is never called on this path.
    canonicalParseEnv ??= buildEnv(() => new Date(0));
    return canonicalParseEnv.parse(rewriteNullableTernary(source)).ast;
  } catch {
    return null;
  }
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
 * (#1928). Deliberately coarse: only genuinely-scalar fields whose *misuse
 * always faults the runtime* are pinned to a concrete type; everything the
 * runtime rescues stays `dyn` and can therefore never fault.
 *  - `string`/`bool` — text/boolean fields; arithmetic/ordering against a number
 *    faults (unless a text value happens to be numeric) → advisory warning.
 *  - `timestamp` — `date`/`datetime` fields; ARITHMETIC against a number always
 *    nulls at runtime (`date − date + 1`, `today() + 30`, #3306) → hard error.
 *    Ordering/equality/concatenation of a date field is runtime-tolerated and
 *    is never flagged (see {@link firstTypeMismatch}).
 * See {@link firstTypeMismatch}.
 */
export type FieldCelType = 'string' | 'bool' | 'timestamp' | 'dyn';

/** The cel-js type name a {@link FieldCelType} declares in a typed env. */
function celTypeName(t: FieldCelType): string {
  return t === 'timestamp' ? 'google.protobuf.Timestamp' : t;
}

/** CEL types produced by date subtraction / temporal fns — arith on these nulls. */
const DATE_CEL_TYPES = new Set(['google.protobuf.Timestamp', 'google.protobuf.Duration']);
/** Numeric CEL types — the RHS that turns date arithmetic into a runtime fault. */
const NUMERIC_CEL_TYPES = new Set(['int', 'uint', 'double']);
/** Arithmetic operators (excludes ordering `< > <= >=`, which dates tolerate). */
const ARITH_OPS = new Set(['+', '-', '*', '/', '%']);

/** Concrete types the soundness env pins — each needs a `== null` overload below. */
const NULL_GUARD_TYPES = ['string', 'bool', 'google.protobuf.Timestamp', 'google.protobuf.Duration'];

/**
 * cel-js has no `<scalar/message> == null` overload, so a `record.<field> != null`
 * guard faults the typed check for any pinned field — and because `check()` reports
 * only its FIRST error, that fault MASKS a real arithmetic fault later in the same
 * expression (the ubiquitous `guard ? <date arith> : null` shape, #3306). Register
 * no-op `== null` overloads (this env is check-only, never evaluated; `!=` desugars
 * to `==`) so the guard type-checks and the real fault surfaces. `==`/`!=` are never
 * flagged themselves ({@link UNSOUND_OVERLOAD_RE} excludes them), so this only
 * unmasks — it can never introduce a false positive.
 */
function registerNullComparisons(env: Environment): void {
  for (const t of NULL_GUARD_TYPES) {
    try { env.registerOperator(`${t} == null`, () => false); } catch { /* already/invalid — ignore */ }
    try { env.registerOperator(`null == ${t}`, () => false); } catch { /* already/invalid — ignore */ }
  }
}

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
    registerNullComparisons(env);
    for (const root of SCOPE_ROOTS) {
      try { env.registerVariable(root, 'map'); } catch { /* duplicate — ignore */ }
    }
    // Fields are bound bare at top level; a name that collides with a root
    // (unlikely) is skipped by the duplicate guard.
    for (const [name, t] of Object.entries(fieldCelTypes)) {
      try { env.registerVariable(name, celTypeName(t)); } catch { /* duplicate / reserved — ignore */ }
    }
    return env;
  }
  const env = new Environment({
    unlistedVariablesAreDyn: false,
    enableOptionalTypes: true,
    limits: DEFAULT_LIMITS,
  });
  registerStdLib(env, () => new Date(0));
  registerNullComparisons(env);
  const fields: Record<string, string> = {};
  for (const [name, t] of Object.entries(fieldCelTypes)) fields[name] = celTypeName(t);
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
 *  - Number / currency / percent fields are declared `dyn`, because the runtime
 *    rescues every mixed case for them — `registerOperator` for `double`×`int`
 *    arithmetic and the string-hydration retry for numeric strings — so they can
 *    never fault here.
 *  - `date`/`datetime` fields are `timestamp`, but ONLY ARITHMETIC (`+ − * / %`)
 *    against a NUMBER is flagged (#3306): `date − date + 1`, `date + n`, `today()
 *    + 30` all null at runtime and never recover (a date string is not numeric,
 *    so hydration can't rescue it). Ordering (`date < today()` → Timestamp<Timestamp
 *    overload; `date < "2026-01-01"` → runtime string-lex), equality (excluded by
 *    {@link UNSOUND_OVERLOAD_RE}), and concatenation (`"Due: " + date` → runtime
 *    string+string) are all runtime-tolerated, so they are never flagged. Two
 *    date fields (`date − date` → Duration, `date + date` → runtime string concat)
 *    also aren't flagged — only date/duration paired with a NUMBER.
 *  - Equality (`==` / `!=`) is excluded ({@link UNSOUND_OVERLOAD_RE}): a
 *    heterogeneous equality is runtime-safe.
 *
 * Returns the operand types, the faulting operator, the concrete operand CEL
 * type, the (best-effort) offending field, and a `category` — `'date-arith'`
 * (a hard error: always nulls) vs `'type-mismatch'` (an advisory string/bool
 * warning) — or `null` when type-sound.
 *
 * `scope` selects how fields are bound: `'record'` (default) for
 * `record.<field>` sites; `'flattened'` for bare-field flow/automation
 * conditions.
 */
export function firstTypeMismatch(
  source: string,
  fieldCelTypes: Readonly<Record<string, FieldCelType>>,
  scope: 'record' | 'flattened' = 'record',
): { operator: string; operands: string; celType: FieldCelType; field: string | null; category: 'date-arith' | 'type-mismatch' } | null {
  if (typeof source !== 'string' || !source.trim()) return null;
  // An all-`dyn` record can never fault an overload — skip the parse entirely.
  if (!Object.values(fieldCelTypes).some((t) => t === 'string' || t === 'bool' || t === 'timestamp')) return null;
  try {
    // A null-guarded numeric branch (`cond ? n : null`) faults cel-js's ternary
    // unifier *before* the check reaches an inner date-arith overload; rewrite it
    // first (same pass the runtime uses) so the real fault surfaces (#3306).
    const env = buildTypedEnv(fieldCelTypes, scope);
    const result = env.parse(rewriteNullableTernary(source)).check?.() as
      | { valid?: boolean; error?: { message?: string } }
      | undefined;
    if (!result || result.valid !== false) return null;
    const m = UNSOUND_OVERLOAD_RE.exec(result.error?.message ?? '');
    if (!m) return null;
    const operator = m[2];
    const operands = `${m[1]} ${operator} ${m[3]}`;
    // #3306 — date/duration ARITHMETIC against a number: always nulls, hard error.
    if (ARITH_OPS.has(operator)
      && ((DATE_CEL_TYPES.has(m[1]) && NUMERIC_CEL_TYPES.has(m[3]))
        || (NUMERIC_CEL_TYPES.has(m[1]) && DATE_CEL_TYPES.has(m[3])))) {
      return {
        operator, operands, celType: 'timestamp', category: 'date-arith',
        field: offendingField(source, fieldCelTypes, 'timestamp', scope),
      };
    }
    // #1928 — text/boolean field in arithmetic/ordering against a number: warning.
    const celType: FieldCelType | null =
      m[1] === 'string' || m[1] === 'bool' ? (m[1] as FieldCelType)
      : m[3] === 'string' || m[3] === 'bool' ? (m[3] as FieldCelType)
      : null;
    if (!celType) return null;
    return {
      operator, operands, celType, category: 'type-mismatch',
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

/** True when `node` is the CEL `null` literal (`{ op: 'value', args: null }`). */
function isNullLiteral(node: unknown): boolean {
  return isCelNode(node) && node.op === 'value' && node.args === null;
}

/** True when `node` is already a `dyn(...)` call — so the wrap is idempotent. */
function isDynCall(node: unknown): boolean {
  return isCelNode(node) && node.op === 'call'
    && Array.isArray(node.args) && node.args[0] === 'dyn';
}

/** Wrap a branch in `dyn(...)` so a concrete-typed branch unifies with `null`. */
function wrapInDyn(node: CelNode): CelNode {
  return { op: 'call', args: ['dyn', [node]] };
}

/**
 * #3306 — make the blessed null-guard idiom `cond ? <value> : null` compile and
 * evaluate. cel-js's ternary type-unifier requires both branches to share a type,
 * and a concrete `int`/`double`/`string` branch does NOT unify with `null` — so
 * even `true ? 5 : null` faults *"Ternary branches must have the same type"* and
 * the whole formula silently evaluates to null. But a `Field.formula` is inherently
 * nullable — `guard ? value : null` is the canonical "compute value, else blank"
 * shape (and the catalog blesses both ternary and `== null`). We restore it by
 * wrapping the non-null branch in `dyn(...)`: `dyn(x)` returns `x` unchanged at
 * runtime and only relaxes its STATIC type to `dyn`, which unifies with `null`.
 *
 * The rewrite is:
 *   - **null-only** — fires ONLY when exactly one ternary branch is a `null`
 *     literal, so a genuine mismatch (`cond ? "a" : 5`) is left to error as before;
 *   - **value-preserving** — `dyn(x)` never changes the runtime value, and the
 *     wrapped branch's own sub-expression is still type-checked (an inner
 *     date-arith fault still surfaces — the soundness gate relies on this);
 *   - **idempotent** — a branch already `dyn(...)` (or itself `null`) is not
 *     re-wrapped, and nested ternaries are handled by the recursive walk.
 *
 * Returns the (possibly rewritten) source; only reserializes when a rewrite
 * actually happened. Memoized; a parse fault returns the source unchanged.
 */
export function rewriteNullableTernary(source: string): string {
  if (typeof source !== 'string' || !source.trim()) return source;
  const cached = nullableTernaryCache.get(source);
  if (cached !== undefined) return cached;
  // Cheap gate: a rewrite needs a ternary AND a `null` literal branch.
  if (!source.includes('?') || !source.includes('null')) {
    rememberNullableRewrite(source, source);
    return source;
  }
  let ast: unknown;
  try {
    ast = (recordScopeEnv ??= buildScopedEnv([])).parse(source).ast;
  } catch {
    rememberNullableRewrite(source, source);
    return source;
  }
  let changed = false;
  const visit = (node: unknown): void => {
    if (!isCelNode(node)) return;
    if (node.op === '?:' && Array.isArray(node.args) && node.args.length === 3) {
      const args = node.args as unknown[];
      const left = args[1];
      const right = args[2];
      // Exactly one branch is `null` → wrap the other so the pair unifies to `dyn`.
      // Skip when the non-null branch is already `dyn(...)` or itself a null literal.
      if (isNullLiteral(right) && !isNullLiteral(left) && isCelNode(left) && !isDynCall(left)) {
        args[1] = wrapInDyn(left); changed = true;
      } else if (isNullLiteral(left) && !isNullLiteral(right) && isCelNode(right) && !isDynCall(right)) {
        args[2] = wrapInDyn(right); changed = true;
      }
    }
    if (Array.isArray(node.args)) for (const child of node.args) visit(child);
  };
  visit(ast);
  const out = changed ? serialize(ast as Parameters<typeof serialize>[0]) : source;
  rememberNullableRewrite(source, out);
  return out;
}

/** Bounded memo of source → null-guard-rewritten source (#3306). */
const nullableTernaryCache = new Map<string, string>();
const NULLABLE_TERNARY_CACHE_MAX = 500;
function rememberNullableRewrite(source: string, rewritten: string): void {
  if (nullableTernaryCache.size >= NULLABLE_TERNARY_CACHE_MAX) {
    const first = nullableTernaryCache.keys().next().value;
    if (first !== undefined) nullableTernaryCache.delete(first);
  }
  nullableTernaryCache.set(source, rewritten);
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
      // #3306 — accept the null-guard idiom `cond ? <value> : null`, which cel-js's
      // ternary unifier otherwise rejects (`int`/`double`/`string` ≠ `null`). Same
      // rewrite the runtime uses, so build and eval agree on what is valid.
      const compiled = env.parse(rewriteNullableTernary(source));
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
      // #3306 — then relax the null-guard idiom `cond ? <value> : null` so a
      // nullable numeric/string formula evaluates instead of faulting cel-js's
      // ternary unifier. Both rewrites are no-ops for sources that don't need them.
      const evalSource = rewriteNullableTernary(rewriteTemporalEquality(source));
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

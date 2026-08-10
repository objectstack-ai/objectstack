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

import { Environment, EvaluationError, ParseError, serialize } from '@marcbachmann/cel-js';
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
 *
 * ## Why this list is PUBLISHED (#6713)
 *
 * Exported for the same reason as {@link collectCelRootIdentifiers} and
 * {@link firstUndeclaredReference}: a surface that binds a CLOSED set of roots
 * has to name the roots it does NOT bind, and that complement is
 * `SCOPE_ROOTS` minus its own allowlist. `@objectstack/lint`'s field-level
 * `*When` gate is exactly such a surface — it binds `record` / `previous` /
 * `parent` and nothing else — and it used to carry a hand-written DENYLIST of
 * three roots instead. A denylist structurally cannot track this list: every
 * root added here (`current_user` arrived in #6290) is silently unreported at
 * that surface until somebody remembers to copy it over, and #6713 measured 21
 * roots sitting in that gap.
 *
 * Consuming the list is NOT the same as consuming {@link firstUndeclaredReference}
 * and the difference is load-bearing. The strict env also declares CEL's own
 * TYPE names (`int`, `string`, `bool`, `type`, `map`, …), so
 * `type(record.x) == string` reports `string` as a root that "resolves" —
 * legitimate CEL a declaredness oracle cannot tell apart from an unbound
 * namespace. Membership of THIS list can.
 */
export const SCOPE_ROOTS = [
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
  // ADR-0068 D1's CANONICAL user root, and the last one this list was missing
  // (#6290). `buildScope` mounts the same `EvalUser` object under
  // `current_user` / `user` / `ctx.user` / `os.user` whenever the evaluation
  // carries a user, and this package already told the rest of the platform so:
  // `introspectScope` lists `current_user` among the roots it hands an author,
  // and `checkRoleCatalog`'s four position-membership regexes all lead with it.
  // Only this list disagreed — so the one spelling ADR-0068 calls canonical was
  // the one spelling the strict env read as a BARE FIELD, while its two aliases
  // (`user`, `ctx`) passed. One package, two accounts of the same root.
  'current_user',
] as const;

/*
 * Why widening this list is the safe direction, and where the narrow verdict
 * lives instead (#6290).
 *
 * This list is a "never faults" BASELINE, not a per-surface contract — the
 * doc-comment above says so, and every entry is generous by construction. A
 * surface that binds a CLOSED set of roots does not express that by hoping the
 * baseline omits the others; it says so at the surface, through
 * `collectCelRootIdentifiers` (that helper reads the AST and is completely
 * independent of this list — see the approval-node approvers in #3447 P2, and
 * `@objectstack/lint`'s field-level `*When` gate for `current_user`).
 *
 * That matters here because field- and section-level `visibleWhen` genuinely do
 * NOT bind `current_user` (#6146, measured at both ends: `evalFieldPredicate`
 * binds `record` + `previous` + `parent` and nothing else). Before #6290 that
 * surface's rejection came out of this list's omission as a SIDE EFFECT, and it
 * showed: the diagnostic was the generic bare-field one, so it prescribed
 * "Write `record.current_user`" — a shape that binds on no layer at all. A
 * verdict that belongs to one surface now reads as that surface's own rule,
 * with that surface's own prescription.
 */

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
  const parsed = parseCelToAstWithReason(source);
  return parsed.ok ? parsed.ast : null;
}

// ---------------------------------------------------------------------------
// The reason-carrying sister entrance (#6132)
// ---------------------------------------------------------------------------

/** A key of {@link DEFAULT_LIMITS} — the platform bounds a source can overrun. */
export type CelLimitKey = keyof typeof DEFAULT_LIMITS;

const CEL_LIMIT_KEYS = Object.keys(DEFAULT_LIMITS) as readonly CelLimitKey[];

/** How far past a {@link DEFAULT_LIMITS} bound a source actually reaches. */
export interface CelBoundsOverrun {
  /**
   * WHICH bound was exceeded — `maxAstNodes` / `maxDepth` / `maxListElements` / …
   * `null` only if cel-js reports a limit fault this package cannot name (see
   * {@link limitKeyOf}); a guessed key would send the author to shorten the
   * wrong axis, so the honest answer is "we know it was a bound, not which".
   */
  limit: CelLimitKey | null;
  /** The platform's value for that bound, i.e. what the source had to stay under. */
  limitValue: number | null;
  /**
   * What the source itself measures on that axis: the smallest value of
   * `limits[limit]` under which it parses, every OTHER bound lifted, so the
   * number is cel-js's own accounting rather than a second implementation of
   * it. `null` when the measurement was capped (see {@link CEL_BOUNDS_MEASURE_CAP_FACTOR})
   * or is not being taken — a bounds *refusal* never measures, because
   * measuring means re-parsing a source we have just decided is too big.
   */
  measured: number | null;
  /**
   * cel-js's own one-line summary — `Exceeded maxAstNodes (256)`. Taken from
   * `ParseError#summary`, NOT `#message`: the latter is
   * `formatErrorWithHighlight`'s rendering, which interpolates the author's own
   * source line (the #6223 hazard).
   */
  summary: string;
}

/**
 * The verdict {@link parseCelToAstWithReason} returns — the same three-way
 * answer {@link classifyCelFault} already grades a thrown fault into, made
 * available to a caller that has to ACT differently on `bounds` than on
 * `parse`, rather than collapsing both to `null`.
 */
export type CelParseResult =
  | { ok: true; ast: CelAstNode }
  /** Empty / whitespace-only source. Not a fault — "no expression". */
  | { ok: false; kind: 'empty'; message: string }
  /** A syntax fault. `message` is cel-js's rendered message, verbatim. */
  | { ok: false; kind: 'parse'; message: string }
  | {
      ok: false;
      kind: 'bounds';
      /** cel-js's rendered message, verbatim — same string `parse` carries. */
      message: string;
      /** WHICH bound, and by how much. */
      overrun: CelBoundsOverrun;
      /**
       * The AST an otherwise-identical but **unbounded** parse yields, when the
       * caller asked for it (`{ admitOverLimit: true }`) — the 17.0.0-rc.x
       * grace window's input, and nothing else's. `null` otherwise.
       */
      unboundedAst: CelAstNode | null;
    };

export interface ParseCelToAstOptions {
  /**
   * Also perform the unbounded parse and hand back its AST + the measured
   * overrun. **Only** the 17.0.0-rc.x pushdown grace window sets this (see
   * `cel-pushdown-limits.ts`); it is what lets that window keep compiling a
   * predicate the platform's bounds refuse, while still naming the bound. It
   * disappears with the grace window at v17 GA.
   *
   * Off by default, deliberately: an unbounded parse of a source we have just
   * measured as over-budget is work proportional to the source, so a caller
   * that only wants the verdict must not pay for it.
   */
  admitOverLimit?: boolean;
}

/**
 * How far above the exceeded bound {@link measureOverrun} will search before it
 * gives up and reports `measured: null`. Bounds the diagnostic's own cost:
 * without a cap, describing a pathological source means parsing it at whatever
 * size it happens to be.
 */
export const CEL_BOUNDS_MEASURE_CAP_FACTOR = 64;

/**
 * The canonical env with ONE bound lifted, used only to measure an overrun.
 * Configured identically to {@link canonicalParseEnv} in every other respect —
 * same stdlib, same `unlistedVariablesAreDyn`, same `enableOptionalTypes` — so
 * "the smallest bound this source parses under" is a fact about the source and
 * not about a second, differently-shaped front end.
 */
function buildProbeEnv(limits: Record<string, number>): Environment {
  const env = new Environment({
    unlistedVariablesAreDyn: true,
    enableOptionalTypes: true,
    limits: limits as unknown as typeof DEFAULT_LIMITS,
  });
  return registerNumericCoercions(registerStdLib(env, () => new Date(0), 'UTC'));
}

/** Every bound lifted out of the way except `key`, which is set to `value`. */
function probeLimits(key: CelLimitKey, value: number): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const k of CEL_LIMIT_KEYS) limits[k] = Number.MAX_SAFE_INTEGER;
  limits[key] = value;
  return limits;
}

function parsesUnder(source: string, key: CelLimitKey, value: number): boolean {
  try {
    buildProbeEnv(probeLimits(key, value)).parse(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * The smallest `limits[key]` under which `source` parses — i.e. what the source
 * measures on that axis, in cel-js's own units.
 *
 * Measured rather than computed. cel-js decrements each counter at its own call
 * sites (`Parser#node` for `maxAstNodes`, three separate recursion points for
 * `maxDepth`, …), and `maxDepth` in particular counts parenthesised recursion
 * that leaves no AST node behind — so a node-walk over the parsed tree would
 * report `3` for a 60-deep parenthesis nest. Asking the parser is the only way
 * the number in the WARN means what it says.
 *
 * Exponential probe from the exceeded bound, then binary search: `O(log n)`
 * parses, capped at {@link CEL_BOUNDS_MEASURE_CAP_FACTOR}× the bound.
 */
function measureOverrun(source: string, key: CelLimitKey, limitValue: number): number | null {
  const cap = limitValue * CEL_BOUNDS_MEASURE_CAP_FACTOR;
  let hi = limitValue * 2;
  while (hi <= cap && !parsesUnder(source, key, hi)) hi *= 2;
  if (hi > cap) return null;
  // It parses at `hi` and (by construction) not at `lo`. Narrow to the boundary.
  let lo = hi / 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (parsesUnder(source, key, mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Read the exceeded bound's key out of cel-js's structured limit fault. */
function limitKeyOf(err: ParseError): CelLimitKey | null {
  // `summary` is `Exceeded ${limitKey} (${limit})`, built by `Parser#limitExceeded`
  // from a fixed set of keys — the author's source never reaches it (that is
  // `message`, via `formatErrorWithHighlight`). We still validate the capture
  // against `DEFAULT_LIMITS` rather than trusting the shape, so a cel-js that
  // rephrases the sentence degrades to "we know it was a bounds fault, not which
  // bound" instead of inventing a limit name.
  const key = /^Exceeded (\w+) /.exec(err.summary ?? '')?.[1];
  return key && (CEL_LIMIT_KEYS as readonly string[]).includes(key) ? (key as CelLimitKey) : null;
}

/**
 * {@link parseCelToAst}, but it says WHY it refused (#6132).
 *
 * `parseCelToAst` collapses "this is not valid CEL" and "this is valid CEL that
 * is over the platform's budget" into the same `null`, which is right for a
 * caller whose job is not to adjudicate syntax. It is wrong for a caller whose
 * job is to *report* the refusal: the RLS / sharing pushdown path fails closed
 * on a refusal, and "your policy was rejected: parse error" for a predicate
 * that is perfectly well-formed but 431 AST nodes long sends the author
 * hunting for a typo that does not exist. This entrance names the bound
 * (`maxAstNodes` / `maxDepth` / `maxListElements` / …), the platform's value
 * for it, and what their source actually measures.
 *
 * The verdict is graded by the SAME {@link classifyCelFault} the engine's
 * `compile` / `evaluate` use — error class plus structured `code`, never prose
 * (#6223). A `bounds` verdict here and a `bounds` verdict from
 * `celEngine.compile()` are therefore the same judgement of the same fault,
 * which is the property `cel-parse-reason.test.ts` pins.
 */
export function parseCelToAstWithReason(
  source: string,
  opts: ParseCelToAstOptions = {},
): CelParseResult {
  if (typeof source !== 'string' || !source.trim()) {
    return { ok: false, kind: 'empty', message: 'empty expression' };
  }
  // The #3306 rewrite is part of the canonical front end, so it happens before
  // the parse whose verdict we are reporting — and the measurement below probes
  // the SAME rewritten source, so the number describes what actually parsed.
  const rewritten = rewriteNullableTernary(source);
  try {
    // A wall-clock-free `now()` — the stdlib is registered for parse-time shape
    // only and is never called on this path.
    canonicalParseEnv ??= buildEnv(() => new Date(0));
    return { ok: true, ast: canonicalParseEnv.parse(rewritten).ast };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (classifyCelFault(err) !== 'bounds') return { ok: false, kind: 'parse', message };
    const parseErr = err as ParseError;
    const limit = limitKeyOf(parseErr);
    const summary = parseErr.summary ?? message.split('\n')[0];
    if (!limit) {
      // A bounds fault we cannot NAME — unreachable on cel-js 8.0.0, where
      // `Parser#limitExceeded` always phrases it `Exceeded <key> (<n>)`, but a
      // rephrasing upstream has to degrade honestly. Still reported as `bounds`
      // (the class is not in doubt) and never as a syntax fault, which is the
      // exact mislabel this entrance exists to stop — but with `limit: null`
      // rather than a guessed key, and with no AST to admit, so the pushdown
      // path fails closed on it in either position of the switch.
      return {
        ok: false,
        kind: 'bounds',
        message,
        overrun: { limit: null, limitValue: null, measured: null, summary },
        unboundedAst: null,
      };
    }
    const limitValue = DEFAULT_LIMITS[limit];
    let unboundedAst: CelAstNode | null = null;
    let measured: number | null = null;
    if (opts.admitOverLimit) {
      try {
        unboundedAst = buildProbeEnv(probeLimits(limit, Number.MAX_SAFE_INTEGER)).parse(rewritten).ast;
        measured = measureOverrun(rewritten, limit, limitValue);
      } catch {
        // Unbounded still refuses ⇒ a second, non-`limit` bound or a fault the
        // bounded parse never got far enough to raise. No AST to admit.
        unboundedAst = null;
      }
    }
    return { ok: false, kind: 'bounds', message, overrun: { limit, limitValue, measured, summary }, unboundedAst };
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
 * cel-js's code for the operand-type fault this engine accommodates. Raised
 * from `lib/operators.js` when a comparison or arithmetic operator sees a
 * `string` on one side and a number on the other, and phrased
 * `no such overload: dyn<string> >= int`.
 */
const CEL_NO_SUCH_OVERLOAD_CODE = 'no_such_overload';

/**
 * Whether a fault is the one ADR-0032 §1c accommodates — numeric and date
 * fields that serialize as strings (`Field.rating` → `"5.0"`, `Field.currency`
 * → `"250000.00"`, `Field.date` → `"2026-06-20"`) tripping a cel-js operand
 * overload in flow conditions / formulas (#1530, #1534) even though the schema
 * and the build-time validator treat them as numeric / temporal.
 *
 * Read off the error CLASS and its structured `code`, never off its prose —
 * the same rule {@link classifyCelFault} follows one function below, and for a
 * sharper reason than symmetry (#6679). This predicate was the last
 * message-text read in this file that armed behaviour after #6223 / PR #6677,
 * and the phrase it matched is reachable from a **native** throw: our own
 * `matches()` stdlib binding is `new RegExp(String(re)).test(...)`, so an
 * uncompilable pattern escapes cel-js unwrapped as a `SyntaxError` echoing the
 * pattern verbatim — `Invalid regular expression: /no such overload(/`. The
 * pattern can come from the source or, via `matches(record.name, record.re)`,
 * from a row.
 *
 * That armed the retry on a fault ADR-0032 §1c never claimed, and the
 * consequence is not cosmetic: when hydration lets the expression
 * short-circuit around the throwing call, the retry *succeeds* and returns a
 * value where the fault was the right answer, so two expressions differing
 * only in whether a regex literal contains the phrase disagree about whether
 * they fault at all. Pinned both ways in `cel-overload-retry-trigger.test.ts`.
 */
function isNumericOverloadError(err: unknown): boolean {
  return err instanceof EvaluationError && err.code === CEL_NO_SUCH_OVERLOAD_CODE;
}

/**
 * The operators that RAISE on a string-versus-number/Timestamp operand pair
 * instead of answering one. This membership is the entire basis of the §1c
 * rescue below — for these operators a mixed pair cannot have produced an
 * answer, so rewriting the operand cannot change one.
 *
 * Measured per operator on cel-js 8.0.0 (#7098), against an int literal, a
 * number-valued field, a `today()` Timestamp and a Date-valued field:
 *
 *  - `<` `<=` `>` `>=` `+` `-` `*` `/` `%` — **fault**, every shape:
 *    `no such overload: dyn<string> >= int`. Listed.
 *  - `==` `!=` — **answer**, `false` / `true`. CEL equality is defined across
 *    types, so `record.s == 5` over `{ s: "5" }` is a clean `false`, not a
 *    fault. DELIBERATELY ABSENT: coercing an equality is exactly the defect
 *    this function closes — the author's string equality already had an answer.
 *    The separate problem that a `Field.date` string never equals a Timestamp is
 *    owned by {@link rewriteTemporalEquality}, which wraps it statically and
 *    per-occurrence on the CLEAN path, where the two sides are known from the
 *    source rather than guessed from an unrelated conjunct's fault.
 *  - `in` — **answers** too (`"7" in [1, 7]` is a clean `false`). Absent for the
 *    same reason.
 */
const COERCIBLE_OPS: ReadonlySet<string> = new Set([
  '<', '<=', '>', '>=', '+', '-', '*', '/', '%',
]);

/** What an operand will actually BE at evaluation time — see {@link operandKind}. */
type OperandKind = 'number' | 'temporal' | 'string' | 'unknown';

/**
 * The scope path a node names, or null when it names none: `record.n` →
 * `['record','n']`, a bare `status` (the flattened flow scope) → `['status']`,
 * and `record.items[0].price` / `record["n"]` → the same walk through a CONSTANT
 * index. Null for everything else — a call, an arithmetic sub-tree, a variable
 * bound by a comprehension — which is what keeps the rewrite below to operands
 * whose runtime value we can actually read before deciding.
 */
function scopePath(node: unknown): string[] | null {
  if (!isCelNode(node)) return null;
  if (node.op === 'id' && typeof node.args === 'string') return [node.args];
  if (node.op === '.' && Array.isArray(node.args) && node.args.length === 2) {
    const [base, member] = node.args;
    if (typeof member !== 'string') return null;
    const head = scopePath(base);
    return head ? [...head, member] : null;
  }
  if (node.op === '[]' && Array.isArray(node.args) && node.args.length === 2) {
    const [base, index] = node.args;
    if (!isCelNode(index) || index.op !== 'value') return null;
    const key = index.args;
    if (typeof key !== 'string' && typeof key !== 'bigint' && typeof key !== 'number') return null;
    const head = scopePath(base);
    return head ? [...head, String(key)] : null;
  }
  return null;
}

/** Resolve a {@link scopePath} against the scope; `undefined` when any hop is absent. */
function resolveScopePath(scope: Record<string, unknown>, path: readonly string[]): unknown {
  let cur: unknown = scope;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** The {@link OperandKind} of a concrete runtime value. */
function valueKind(v: unknown): OperandKind {
  if (typeof v === 'number' || typeof v === 'bigint') return 'number';
  if (v instanceof Date) return 'temporal';
  if (typeof v === 'string') return 'string';
  return 'unknown';
}

/**
 * What the operand will actually be when cel-js evaluates it — read off the
 * literal, off the known return type of a stdlib call, or (for a scope path) off
 * the value ALREADY IN HAND in this scope. Reading the scope rather than the
 * static type is what makes the "this comparison provably faulted" test exact
 * under `unlistedVariablesAreDyn`, where every field is statically `dyn`.
 *
 * `unknown` is the safe answer and the common one: an arithmetic sub-tree, a
 * comprehension variable, an absent key. An `unknown` counterpart never licenses
 * a rewrite.
 */
function operandKind(node: unknown, scope: Record<string, unknown>): OperandKind {
  if (!isCelNode(node)) return 'unknown';
  if (node.op === 'value') return valueKind(node.args);
  if (isTemporalCall(node)) return 'temporal';
  if (node.op === 'call' && Array.isArray(node.args) && typeof node.args[0] === 'string') {
    const fn = node.args[0];
    if (fn === 'date' || fn === 'datetime') return 'temporal';
    if (fn === 'double' || fn === 'int' || fn === 'uint') return 'number';
    return 'unknown';
  }
  const path = scopePath(node);
  if (!path) return 'unknown';
  const resolved = resolveScopePath(scope, path);
  return resolved === undefined ? 'unknown' : valueKind(resolved);
}

/**
 * The coercion this operand needs to meet `counterpart`, or null when it is not
 * one ADR-0032 §1c rescues: entirely-numeric literals → `double(…)` (#1534) and
 * ISO-8601 date / date-time strings → `date(…)` (#1530). Strings that are
 * neither — a zip like `"02134"`, free text — return null and the original loud
 * fault is preserved, exactly as before.
 *
 * The coercion must MATCH the counterpart: a numeric string opposite a Timestamp
 * (or an ISO string opposite a number) is a genuine mismatch, not a §1c
 * serialization artifact, and is left to fault.
 */
function coercionFor(value: unknown, counterpart: OperandKind): 'double' | 'date' | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (counterpart === 'number' && NUMERIC_STRING_RE.test(trimmed)) {
    return Number.isFinite(Number(trimmed)) ? 'double' : null;
  }
  if (counterpart === 'temporal' && ISO_TEMPORAL_STRING_RE.test(trimmed)) {
    return Number.isNaN(Date.parse(trimmed)) ? null : 'date';
  }
  return null;
}

/** Wrap an AST node in a one-argument stdlib call (`double(x)` / `date(x)`). */
function wrapInCall(fn: string, node: CelNode): CelNode {
  return { op: 'call', args: [fn, [node]] };
}

/**
 * #7098 — coerce the operands that PROVABLY faulted, and only those.
 *
 * The predecessor of this function hydrated the whole scope and re-ran the
 * expression, on a docblock claim that "it can never change a comparison that
 * already evaluated cleanly". That claim was false and load-bearing: the retry
 * knows only that the WHOLE expression faulted, so rewriting the scope
 * re-interprets every OTHER comparison too. `record.n >= 4 && record.s == "5.0"`
 * over `{ n: "7", s: "5.0" }` faults on the first conjunct, hydrates BOTH fields,
 * and answers `false` — the author's deliberate string equality was `true` in
 * evaluation 1, and nothing reports that it was overruled.
 *
 * So the rewrite is now **per-occurrence**, the same discipline
 * {@link rewriteTemporalEquality} already documents ("no field-wide trade-off"),
 * and one step stricter — it is per operand POSITION, so a field compared to an
 * int in one conjunct and to a string literal in another keeps both answers.
 *
 * An operand is rewritten only where all three hold, which together make the
 * docblock's guarantee true by construction rather than by assertion:
 *  1. the operator is one of {@link COERCIBLE_OPS} — no string↔number/Timestamp
 *     overload exists, so a mixed pair cannot have produced an answer;
 *  2. the counterpart is a number or a Timestamp *in this scope*, established by
 *     {@link operandKind} against the values in hand, not by static type;
 *  3. this operand's own value is a §1c serialization artifact
 *     ({@link coercionFor}).
 *
 * Returns the rewritten source, or null when no operand qualifies — in which
 * case the caller preserves the original loud error rather than guessing. That
 * is the deliberate trade: shapes the walk cannot read (a comprehension
 * variable, a computed index) now FAULT where they were once silently rescued,
 * because a silent rescue of an operand we cannot prove faulted is precisely the
 * defect this closes.
 */
function rewriteFaultedOperands(source: string, scope: Record<string, unknown>): string | null {
  let ast: unknown;
  try {
    ast = (recordScopeEnv ??= buildScopedEnv([])).parse(source).ast;
  } catch {
    return null;
  }
  let changed = false;
  const visit = (node: unknown): void => {
    if (!isCelNode(node)) return;
    if (COERCIBLE_OPS.has(node.op) && Array.isArray(node.args) && node.args.length === 2) {
      const args = node.args as unknown[];
      for (const side of [0, 1] as const) {
        const operand = args[side];
        const path = scopePath(operand);
        if (!path) continue;
        const counterpart = operandKind(args[1 - side], scope);
        if (counterpart !== 'number' && counterpart !== 'temporal') continue;
        const fn = coercionFor(resolveScopePath(scope, path), counterpart);
        if (!fn) continue;
        args[side] = wrapInCall(fn, operand as CelNode);
        changed = true;
      }
    }
    if (Array.isArray(node.args)) for (const child of node.args) visit(child);
  };
  visit(ast);
  return changed ? serialize(ast as Parameters<typeof serialize>[0]) : null;
}

/**
 * cel-js's code for a bounds violation. Raised **only** from the parser
 * (`Parser#limitExceeded`, one call site per limit key), so it always arrives as
 * a {@link ParseError} and must be read before the ParseError → `parse` rule
 * below — otherwise every `maxAstNodes` / `maxDepth` overrun would be reported
 * as a syntax fault.
 */
const CEL_LIMIT_EXCEEDED_CODE = 'limit_exceeded';

/**
 * The evaluate-time cel-js codes that describe the EXPRESSION rather than the
 * DATA, and therefore stay `type` instead of falling to `runtime`.
 *
 * The membership test is "would this fault reproduce on every input?". At
 * evaluate time cel-js runs its checker with `isEvaluating: true`
 * (`Environment#evaluate` → `#evalTypeChecker`, built as
 * `new TypeChecker(opts, true)`), so *every* fault — including the ones the
 * checker raises — arrives as an {@link EvaluationError}. The phase therefore
 * cannot separate the two, and the code has to.
 *
 * Exactly one code qualifies on cel-js 8.0.0, measured per code (#6223):
 * `unknown_variable` means the ROOT identifier the expression names is not
 * bound in this scope at all — a property of the expression against the call
 * site's contract, not of any row. `@objectstack/objectql`'s `cel-fault`
 * already gives it its own author advice ("the field is fine; the thing you
 * hung it off isn't available here").
 *
 * Deliberately NOT here, each with the reason:
 *  - `no_such_key` — a record may carry a key on one row and not the next, so
 *    it is a fact about the data. `cel-fault` gives it its own sentence too.
 *  - `no_such_overload` — this is ADR-0032 §1c, the string-serialized numeric /
 *    date field (`record.rating >= 4` where `rating` is `"5.0"`). Data.
 *  - `int_conversion_error` / `uint_conversion_error` /
 *    `double_conversion_error` — cel-js phrases these as `int() type error: …`,
 *    which is what put them on `type` before #6223. Converting a value that
 *    cannot convert is a data fault; the word "type" in the prose was the only
 *    reason they were graded otherwise.
 *  - `no_matching_overload` — genuinely ambiguous: it covers both an unknown
 *    function (`PRIOR(x)`) and a known one called with the wrong runtime types
 *    (`size(record.x)` on a scalar). Under `unlistedVariablesAreDyn` the second
 *    is data-dependent, so it stays `runtime` — which is also its verdict
 *    before #6223, i.e. this is not a re-grade. The unknown-function case is
 *    already caught earlier and louder: {@link celEngine.compile} reads
 *    `check()`'s `{ valid: false }` and answers `type` at build time (#1877).
 *  - `heterogeneous_list_element`, `invalid_index_type`,
 *    `invalid_comprehension_range`, `invalid_condition_type`,
 *    `invalid_logical_operand` — all "this VALUE has the wrong type", decided
 *    against the row, not against the source.
 */
const CEL_DECLARATION_CODES: ReadonlySet<string> = new Set(['unknown_variable']);

/**
 * Grade a cel-js fault off the error **class** it was thrown as and its
 * structured `code` — never off its prose. Returns `undefined` for anything
 * that is not a cel-js error.
 *
 * Why not the message (#6133, #6223): `classifyError` used to decide between
 * `parse` / `type` / `runtime` / `bounds` by regex-matching the error text, and
 * cel-js embeds the **author's own source line** in `message` (see
 * `formatErrorWithHighlight` in `lib/errors.js`). The text being matched is
 * therefore text the author writes. `kind` is not an internal field — it is
 * interpolated verbatim into the author-facing rejection text (`objectql`'s
 * `rule-validator` / `cel-fault`) and into the REST error body's `reason` — so
 * the author is told which of *their* mistakes this was, by a rule their own
 * field names can flip. Measured on cel-js 8.0.0, one `no such overload`
 * evaluation fault, four field names, one wrong answer per polluted name:
 *
 * ```text
 * record.status        > 1  ->  runtime   (right)
 * record.parse_status  > 1  ->  parse     (wrong — "your expression is broken")
 * record.syntax_mode   > 1  ->  parse     (wrong)
 * record.type_code     > 1  ->  type      (wrong)
 * ```
 *
 * #6133 / PR #6202 closed the ParseError arm this way and left `type` /
 * `runtime` on the keyword table pending a per-code audit. #6223 is that audit,
 * and it deletes the table outright: see {@link CEL_DECLARATION_CODES} for the
 * evaluate-time verdicts and {@link classifyError} for why nothing is left for
 * a keyword to decide.
 *
 * There is deliberately no `TypeError` arm. cel-js's `TypeError` is raised only
 * by the non-evaluating `TypeChecker` (`createError = isEvaluating ?
 * evaluationError : typeError`), which runs only inside `Environment#check` —
 * and that method catches it and *returns* `{ valid: false, error }` rather
 * than throwing. So a cel-js `TypeError` can never reach a `catch` block here;
 * an arm for it would be dead code. The check-time `TypeError → type` mapping
 * does exist, in {@link celEngine.compile}, where that returned object is read.
 */
function classifyCelFault(err: unknown): 'parse' | 'bounds' | 'type' | 'runtime' | undefined {
  if (err instanceof ParseError) {
    return err.code === CEL_LIMIT_EXCEEDED_CODE ? 'bounds' : 'parse';
  }
  if (err instanceof EvaluationError) {
    return CEL_DECLARATION_CODES.has(err.code) ? 'type' : 'runtime';
  }
  return undefined;
}

/**
 * Resolve a thrown fault into the {@link EvalError} the caller reports.
 *
 * Everything that is not a cel-js error faulted *while evaluating* and carries
 * no structured contract at all — our own stdlib bindings, a caller-supplied
 * `os.*` API, a native JS throw — so `runtime` is the honest answer and the
 * only one. It is not a fallback worth "improving" with a keyword table: the
 * residual arm was never dormant, and its prose is author- and *data*-
 * controlled through our own `matches()` binding, which hands cel-js a native
 * `SyntaxError` whose message echoes the pattern (measured, #6223):
 *
 * ```text
 * matches(record.name, "type(")                  ->  type    (was)
 * matches(record.name, "Exceeded maxAstNodes(")  ->  bounds  (was)
 * matches(record.name, "unexpected(")            ->  parse   (was)
 * matches(record.name, record.re)                ->  type    (was) — from a ROW
 * ```
 *
 * All four are one native regex-compilation failure, i.e. `runtime`.
 */
function classifyError(err: unknown): EvalResult<never> {
  const message = err instanceof Error ? err.message : String(err);
  const kind = classifyCelFault(err) ?? 'runtime';
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
        // Coerce those operands — and ONLY those — and retry ONCE. #7098: the
        // coercion is per operand POSITION, not scope-wide, so a comparison that
        // already evaluated cleanly is never re-interpreted; the scope itself is
        // never rewritten, so a numeric-looking string RETURNED by the expression
        // keeps its type too. When no operand provably faulted, or the retry still
        // cannot type-check, the original loud error is reported.
        if (!isNumericOverloadError(err)) throw err;
        const coercedSource = rewriteFaultedOperands(evalSource, scope);
        if (coercedSource === null) throw err;
        try {
          const raw = env.evaluate(coercedSource, scope);
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

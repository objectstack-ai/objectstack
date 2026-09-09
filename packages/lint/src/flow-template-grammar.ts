// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module flow-template-grammar
 *
 * **Which `{…}` dialect owns a whole-string token in a FLOW node's filter, and
 * which spellings neither dialect can resolve** (#16096).
 *
 * A filter value position inside a flow node is the one place two `{…}`
 * vocabularies meet, and `interpolateFilter`
 * (`@objectstack/service-automation`, `src/builtin/template.ts`, #3810) is the
 * function that arbitrates them. Its own header states the split:
 *
 * > A whole-string token that (a) no flow variable resolves and (b) IS a
 * > recognised filter placeholder is passed through **verbatim** for the engine
 * > to expand. That is a transfer of ownership, not a lenient fallback.
 *
 * So a token in this position falls in exactly one of three classes:
 *
 * | class | resolved by | example | judged here? |
 * |---|---|---|---|
 * | flow template dialect | the automation template evaluator, BEFORE the query | `{TODAY() - 45}`, `{record.id}`, `{$User.Id}`, `{round(x)}` | ⛔ no |
 * | filter placeholder dialect | ObjectQL, after hand-off (`isKnownFilterToken`) | `{current_user_id}`, `{30_days_ago}` | ⛔ no — `filter-token-unknown` owns it |
 * | **neither** | nothing — the run fails or the condition collapses | `{TOMORROW()}`, `{ROUND(x)}` | ✅ the third class, and only it |
 *
 * ## Why only the CALL-POSITION half of the third class is decidable here
 *
 * The flow dialect's vocabulary is closed in three of its four arms and OPEN in
 * the fourth:
 *
 * - `NOW()` / `TODAY()` with an optional `± N` day offset — closed, two names.
 * - `$User.<path>` — closed prefix.
 * - `round` / `floor` / `ceil` / `abs` / `min` / `max` in CALL position —
 *   closed by maintainer ruling on #11060 ("exactly … every name and semantic
 *   mirrored **1:1 from the CEL stdlib**, ⛔ no second semantics invented").
 * - a bare or dotted identifier (`{recordId}`, `{record.id}`, `{status}`) —
 *   **OPEN**: it addresses the run's `VariableMap`, which holds the flow's
 *   declared variables, every node's `outputVariable`, and — via
 *   `seedRunVariables` — the trigger record's own fields flattened to top
 *   level. None of that is decidable from authored metadata alone, and a flow
 *   bound to an object another package defines cannot be resolved here at all.
 *
 * That asymmetry is the whole reason this module reports the call-position arm
 * and nothing else. Measured on this repo's own examples, judging the OPEN arm
 * against the ObjectQL vocabulary — the shape #16096 calls "the obvious fix" —
 * reports **7 findings at `error`, all 7 false positives** (`{recordId}` ×3,
 * `{record.id}` ×3, `{currentTask.id}` ×1, across app-todo / app-crm /
 * app-showcase). Every one is a legitimate flow variable that resolves at run
 * time. A reference set that reds working sweeps is worse than the silence
 * #16096 reports, so the open arm stays unjudged and says so.
 *
 * ## Dispatch ORDER is load-bearing, not incidental
 *
 * `resolveToken` tries the date-function form BEFORE it scans for call
 * positions. `{TODAY() - 45}` therefore never reaches the scan — which is the
 * only reason the legitimate spelling stays silent, because `TODAY` sitting in
 * front of a `(` is otherwise indistinguishable from `TOMORROW`. This module
 * mirrors that order exactly and `flow-template-grammar.test.ts` pins the
 * negative control against it.
 *
 * ## This is a MIRROR, and the drift is pinned
 *
 * `@objectstack/lint` depends on `@objectstack/spec` and never on a runtime
 * (its own package description), so the dialect cannot be imported from the
 * package that owns it. The five regexes and the function table below are
 * therefore copied, and `flow-template-grammar.test.ts` reads
 * `packages/services/service-automation/src/builtin/template.ts` from disk and
 * fails when any of them stops matching the original — a cross-package test
 * input already declared on `@objectstack/lint#test` in `turbo.json`, so the
 * graph can see it. ⛔ Do not "simplify" a regex here: it is not this module's
 * to choose, and an equivalent-looking rewrite breaks the pin that keeps the
 * two readers honest.
 */

/**
 * The two whole-token date functions, with their `± N day` offset grammar.
 * Verbatim from `resolveToken`'s `dateFnMatch`.
 */
export const DATE_FUNCTION_RE = /^(NOW|TODAY)\s*\(\s*\)\s*(?:([+\-])\s*(\S+))?$/;

/** Direct variable / dotted-path lookup, numeric segments included (#1872). */
export const VARIABLE_PATH_RE = /^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/;

/**
 * The character set `resolveToken` will attempt arithmetic on. A token outside
 * it resolves to `undefined` without ever reaching the call-position scan.
 */
export const SAFE_EXPRESSION_RE = /^[\w\s+\-*/%().,?:<>=!&|"'$]+$/;

/** Identifier / dotted-identifier occurrences inside a mixed expression. */
export const IDENTIFIER_SCAN_RE = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;

/** An identifier is in CALL position when a `(` follows it. */
export const CALL_POSITION_RE = /^\s*\(/;

/** Literals `resolveToken` never substitutes, checked BEFORE call position. */
const RESERVED_LITERALS: ReadonlySet<string> = new Set(['true', 'false', 'null', 'undefined']);

/** The two names legal only as a whole token (`{TODAY() + 7}`), never in a call. */
export const FLOW_TEMPLATE_DATE_FUNCTIONS: readonly string[] = ['NOW', 'TODAY'];

/**
 * The value-expression function table — the CEL stdlib's numeric six, by the
 * #11060 ruling. Mirrors `EXPRESSION_FUNCTION_ARITY`'s key set.
 */
export const FLOW_TEMPLATE_VALUE_FUNCTIONS: readonly string[] = [
  'round', 'floor', 'ceil', 'abs', 'min', 'max',
];

const VALUE_FUNCTION_SET: ReadonlySet<string> = new Set(FLOW_TEMPLATE_VALUE_FUNCTIONS);

/** What the flow template dialect does with one whole-string `{…}` token. */
export type FlowTemplateTokenVerdict =
  /** `{NOW()}` / `{TODAY() - 45}` — the evaluator resolves it. Legitimate. */
  | { kind: 'date-function'; name: string }
  /** `{$User.Id}` — the evaluator resolves it from the run context. */
  | { kind: 'user-context' }
  /**
   * `{recordId}` / `{record.id}` — a `VariableMap` lookup, and the position
   * from which an unresolved name is handed to the filter dialect. OPEN: not
   * decidable from authored metadata, so never a finding.
   */
  | { kind: 'variable-path'; head: string }
  /**
   * A call to a name in NEITHER table. `resolveToken` throws
   * `FlowExpressionFunctionError` here (a guard refusal — a `fault` edge must
   * not swallow it), so the node cannot run. THIS is the finding.
   */
  | { kind: 'unknown-function'; name: string }
  /**
   * Anything else — junk shapes (`{30 days ago}`) and arithmetic over names
   * this module cannot resolve. `resolveToken` answers `undefined` and the
   * CRUD collapse guard (#3810) reports it at run time. Open, not judged.
   */
  | { kind: 'unresolvable-shape' };

/**
 * Classify the INSIDE of one whole-string `{…}` filter token — `inner` is the
 * text between the braces, exactly as authored.
 *
 * Mirrors `resolveToken`'s dispatch order (see the module header). Holds no
 * severity and knows nothing about where the token was found.
 */
export function classifyFlowTemplateToken(inner: string): FlowTemplateTokenVerdict {
  const trimmed = inner.trim();
  if (!trimmed) return { kind: 'unresolvable-shape' };

  // 1. Whole-token date functions, BEFORE any call-position reasoning.
  const dateMatch = DATE_FUNCTION_RE.exec(trimmed);
  if (dateMatch) return { kind: 'date-function', name: dateMatch[1] };

  // 2. `$User.*` shortcuts.
  if (trimmed.startsWith('$User.')) return { kind: 'user-context' };

  // 3. Direct variable / dotted path — the open arm.
  if (VARIABLE_PATH_RE.test(trimmed)) {
    return { kind: 'variable-path', head: trimmed.split('.')[0] };
  }

  // 4. Outside the arithmetic character set: `undefined`, no throw.
  if (!SAFE_EXPRESSION_RE.test(trimmed)) return { kind: 'unresolvable-shape' };

  // 5. The call-position scan. `resolveToken` throws on the FIRST unknown name
  //    it reaches, so the first is what an author sees and what is reported.
  for (const match of trimmed.matchAll(IDENTIFIER_SCAN_RE)) {
    const name = match[0];
    if (RESERVED_LITERALS.has(name)) continue;
    const rest = trimmed.slice((match.index ?? 0) + name.length);
    if (!CALL_POSITION_RE.test(rest)) continue;
    if (VALUE_FUNCTION_SET.has(name)) continue;
    return { kind: 'unknown-function', name };
  }

  return { kind: 'unresolvable-shape' };
}

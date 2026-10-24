/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Expression Evaluator
 * 
 * Evaluates template string expressions like ${data.amount > 1000} for dynamic UI behavior.
 * Supports variable substitution, comparison operators, and basic JavaScript expressions.
 * 
 * @module evaluator
 * @packageDocumentation
 */

import { ExpressionContext } from './ExpressionContext.js';
import { ExpressionCache } from './ExpressionCache.js';
import { FormulaFunctions } from './FormulaFunctions.js';
import { evalFieldPredicate } from './fieldRules.js';
import { isBlankPredicateText } from './declaredPredicate.js';
import { isUnevaluablePredicate, UNEVALUABLE_PREDICATE_REASON } from './unevaluablePredicate.js';

/**
 * Options for expression evaluation
 */
export interface EvaluationOptions {
  /**
   * Default value to return if evaluation fails
   */
  defaultValue?: any;
  
  /**
   * Whether to throw errors on evaluation failure
   * @default false
   */
  throwOnError?: boolean;
  
  /**
   * Whether to sanitize the expression before evaluation
   * @default true
   */
  sanitize?: boolean;

  /**
   * Fault passback: called with the failure reason when this evaluation could
   * not be performed, at the moment the evaluator ALREADY knows it faulted.
   *
   * ## Why a passback and not a second evaluation (objectui#6038)
   *
   * The only fault-detection channel this class used to offer a fail-soft
   * caller was `throwOnError`, and on the CEL branch `evaluateCelCondition`
   * implements that by evaluating TWICE (once with each fallback — a value
   * that tracks the fallback both times is a fault). A caller that wants to
   * *observe* a fault while keeping the fail-soft verdict therefore had to pay
   * for a second engine call per predicate per node per render. That price is
   * exactly why the node gate in `SchemaRenderer` bought its diagnostic with a
   * `__DEV__` gate and shipped production silent.
   *
   * This option costs nothing: every fault site below is already inside a
   * `catch`, or already holds the engine's own failure reason. The verdict is
   * untouched on every path — `onFault` is invoked for its side effect and its
   * return value is ignored.
   *
   * ## Supplying it TRANSFERS reporting to the caller
   *
   * The built-in `console.warn`s on these paths are suppressed while it is
   * set, so one fault stays one line — the caller's, which can name the node
   * the predicate belongs to. This mirrors, one layer up, the contract
   * `FieldPredicateDiagnostic` (`fieldRules.ts`) already documents for the
   * canonical CEL engine: `warn: false` plus an `onFault` passback, so
   * silencing the generic line never discards the description of *why* the
   * predicate failed. On the CEL branch this option is forwarded to exactly
   * that seam rather than reimplementing it.
   *
   * Independent of {@link throwOnError}, which converts a fault into a throw
   * and is the fail-CLOSED contract; this one keeps the historical fail-soft
   * answer and merely says so out loud. `throwOnError` still wins where both
   * are set: the throw happens first and is the caller's own signal.
   *
   * Must not throw — it is invoked outside the evaluation guard, so an
   * exception here propagates to the caller rather than being reported as an
   * evaluation fault.
   */
  onFault?: (reason: string) => void;
}

/**
 * The two built-in fault sites of {@link ExpressionEvaluator.evaluate}, tagged
 * so they cannot silence each other through the dedupe below. They describe
 * different faults — one PART of a multi-part template failed to evaluate,
 * versus the WHOLE expression did — and each owns its message text.
 */
type EvaluationFaultSite = 'template-part' | 'whole-expression';

/**
 * Authored sources already reported by {@link reportEvaluationFault}, keyed on
 * `[site, source]`.
 *
 * ## Why a rate limit at all (objectui#6444)
 *
 * `evaluate` is the hottest of the three predicate paths in this area:
 * `SchemaRenderer` calls it for every `properties.*` value, every `props.*`
 * value and `content`, for every node, on every render — and both sites below
 * used to log on EVERY evaluation. Measured on the built evaluator at
 * `830ed5803`: three identical faulting `evaluateCondition` calls produced
 * **3** console lines where the `{ dialect: 'cel' }` envelope produced **1**,
 * and one broken `${…}` prop rendered across a 200-row list produced **200**
 * lines — then 200 more on the next render.
 *
 * This is the one-per-source ceiling both sibling reporters already carry, not
 * a third mechanism: `warnPredicateFailure` in `./fieldRules.js` (keyed on
 * dialect + source) and `visibilityDiagnostic.ts` in `@object-ui/react` (keyed
 * on type + key + source).
 *
 * ## Why the key is the source TEXT, and never the scope
 *
 * Both siblings key on the AUTHORING identity of the predicate, and neither
 * keys on the data it was evaluated against: "a broken predicate is
 * re-evaluated on every render/keystroke, and the point is one loud line, not
 * a scrolling wall". Here that precedent is also the defect itself — the
 * 200-row flood is ONE authored source evaluated against 200 DIFFERENT scopes,
 * so a scope-sensitive key reproduces all 200 lines and fixes nothing.
 *
 * The key is JSON-encoded, never joined with a control character — that is
 * what made a sibling of this file binary to grep (objectstack#5450).
 *
 * Unbounded, exactly like both siblings: entries are distinct AUTHORED
 * expressions, a count an app's metadata bounds; a row count does not.
 */
const warnedEvaluationFaults = new Set<string>();

/**
 * One fault, one report: hand the reason to the caller's {@link
 * EvaluationOptions.onFault} when it supplied one, otherwise fall back to this
 * class's historical `console.warn` — now at most once per authored source.
 *
 * Kept as a module-local function rather than repeating the ternary at each
 * catch, so the "supplying `onFault` suppresses the built-in line" rule is
 * stated once and cannot drift between the three sites that implement it. The
 * two message texts moved in here for the same reason: the dedupe key and the
 * line a reader sees are now built from the same `source`, so the stated
 * ceiling cannot drift from what the console actually prints.
 *
 * The rate limit governs the built-in line ONLY. `onFault` still fires on
 * every fault, matching the passback contract `./fieldRules.js` already
 * documents for the canonical engine — "independent of … the one-time-warning
 * dedupe: it fires on every fault, so a caller doing its own warn-once
 * bookkeeping keeps control of it". A caller that reports per node must not
 * have its faults swallowed by this module's bookkeeping.
 */
function reportEvaluationFault(
  onFault: ((reason: string) => void) | undefined,
  site: EvaluationFaultSite,
  source: string,
  error: unknown,
): void {
  const reason = error instanceof Error ? error.message : String(error);
  if (onFault) {
    onFault(reason);
    return;
  }
  const key = JSON.stringify([site, source]);
  if (warnedEvaluationFaults.has(key)) return;
  warnedEvaluationFaults.add(key);
  console.warn(
    site === 'template-part'
      ? `Expression evaluation failed for: ${source}`
      : `Failed to evaluate expression: ${source}`,
    error,
  );
}

/**
 * Expression evaluator for dynamic UI expressions
 */
export class ExpressionEvaluator {
  private context: ExpressionContext;
  private cache: ExpressionCache;
  private formulas: FormulaFunctions;

  constructor(
    context?: ExpressionContext | Record<string, any>,
    cache?: ExpressionCache,
    formulas?: FormulaFunctions,
  ) {
    if (context instanceof ExpressionContext) {
      this.context = context;
    } else {
      this.context = new ExpressionContext(context || {});
    }
    
    // Use provided cache or create a new one
    this.cache = cache || new ExpressionCache();
    this.formulas = formulas || new FormulaFunctions();
  }

  /**
   * Evaluate a string that may contain template expressions like ${...}
   * 
   * @example
   * ```ts
   * const evaluator = new ExpressionEvaluator({ data: { amount: 1500 } });
   * evaluator.evaluate('${data.amount > 1000}'); // Returns: true
   * evaluator.evaluate('Amount is ${data.amount}'); // Returns: "Amount is 1500"
   * ```
   */
  evaluate(expression: string | boolean | number | null | undefined | { dialect?: string; source?: string }, options: EvaluationOptions = {}): any {
    // Unwrap Expression envelope produced by `@objectstack/spec`'s normalized
    // template/CEL inputs: `{ dialect: 'cel' | 'template', source: '...' }`.
    // We only consume `source` — the underlying syntax (`${expr}` or `{var}`)
    // is identical to what we already supported as plain strings.
    if (expression && typeof expression === 'object' && typeof (expression as any).source === 'string') {
      expression = (expression as any).source as string;
    }

    // Handle non-string primitives
    if (typeof expression !== 'string') {
      return expression;
    }

    const { defaultValue, throwOnError = false, sanitize = true, onFault } = options;

    try {
      // Check if string contains template expressions
      const hasTemplates = expression.includes('${');
      
      if (!hasTemplates) {
        // No templates, return as-is
        return expression;
      }

      // Special case: if the entire string is a single template expression, return the value directly
      const singleTemplateMatch = expression.match(/^\$\{([^}]+)\}$/);
      if (singleTemplateMatch) {
        return this.evaluateExpression(singleTemplateMatch[1].trim(), { sanitize });
      }

      // Replace all ${...} expressions in a string with multiple parts
      return expression.replace(/\$\{([^}]+)\}/g, (match, expr) => {
        try {
          const result = this.evaluateExpression(expr.trim(), { sanitize });
          return String(result ?? '');
        } catch (error) {
          if (throwOnError) {
            throw error;
          }
          reportEvaluationFault(onFault, 'template-part', expr, error);
          return match; // Return original if evaluation fails
        }
      });
    } catch (error) {
      if (throwOnError) {
        throw error;
      }
      reportEvaluationFault(onFault, 'whole-expression', expression, error);
      return defaultValue ?? expression;
    }
  }

  /**
   * Evaluate a single expression (without ${} wrapper)
   * 
   * @example
   * ```ts
   * evaluator.evaluateExpression('data.amount > 1000'); // Returns: true
   * evaluator.evaluateExpression('data.user.name'); // Returns: "John"
   * ```
   */
  evaluateExpression(expression: string, options: { sanitize?: boolean } = {}): any {
    const { sanitize = true } = options;

    if (!expression || expression.trim() === '') {
      return undefined;
    }

    // Sanitize expression to prevent dangerous code execution
    if (sanitize && this.isDangerous(expression)) {
      throw new Error(`Potentially dangerous expression detected: ${expression}`);
    }

    try {
      // Create a safe evaluation function
      const contextObj = this.context.toObject();
      
      // Inject formula functions into the evaluation context
      const formulaObj = this.formulas.toObject();
      const mergedContext = { ...formulaObj, ...contextObj };
      
      // Build safe function with context variables
      const varNames = Object.keys(mergedContext);
      const varValues = Object.values(mergedContext);
      
      // Use cached compilation
      const compiled = this.cache.compile(expression, varNames);
      
      // Execute with context values
      return compiled.fn(...varValues);
    } catch (error) {
      // The original error's message is inlined below. We can't pass it as the
      // `Error` `cause` option because this package targets ES2020, whose lib
      // types the 1-arg `Error` constructor only; hence the scoped disable.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Failed to evaluate expression "${expression}": ${(error as Error).message}`);
    }
  }

  /**
   * Check if expression contains potentially dangerous code
   */
  private isDangerous(expression: string): boolean {
    const dangerousPatterns = [
      /eval\s*\(/i,
      /Function\s*\(/i,
      /setTimeout\s*\(/i,
      /setInterval\s*\(/i,
      /import\s*\(/i,
      /require\s*\(/i,
      /process\./i,
      /global\./i,
      /window\./i,
      /document\./i,
      /__proto__/i,
      /constructor\s*\(/i,
      /prototype\./i,
    ];

    return dangerousPatterns.some(pattern => pattern.test(expression));
  }

  /**
   * Evaluate a conditional expression and return boolean
   * 
   * @example
   * ```ts
   * evaluator.evaluateCondition('${data.age >= 18}'); // Returns: true/false
   * ```
   */
  evaluateCondition(condition: string | boolean | undefined | { dialect?: string; source?: string }, options: EvaluationOptions = {}): boolean {
    if (typeof condition === 'boolean') {
      return condition;
    }

    // objectui#11358 — a gate that is DECLARED but has nothing to evaluate: an
    // envelope with no string `source` (`{ dialect: 'cel', ast }`, or the
    // `{ dialect: 'cel' }` the normalizer now returns for every such value), a
    // number, `{}`, an array. It is a FAULT, answered on the same terms as a
    // predicate that faults with text in it: thrown to a `throwOnError` caller,
    // whose catch is its fail-closed answer and its report, and otherwise
    // reported once and answered with the fail-soft `true`. Before, these fell
    // through to `if (!condition)` / `Boolean(condition)` below and came back
    // `true` in silence — the "silent `true`" ADR-0137 D4 forbids.
    if (isUnevaluablePredicate(condition)) {
      return this.answerUnevaluableGate(condition, options);
    }

    // #2661 — a CEL-dialect envelope routes to the canonical `@objectstack/formula`
    // engine (the one `fieldRules` / list conditionals already use), NOT the legacy
    // JS evaluator below. This makes a component / action `visible` / `disabled`
    // predicate reach the SAME verdict as server enforcement — including CEL-only
    // behavior like `record.due_date == today()` (framework#3205). Bare strings and
    // `${…}` templates stay on the legacy path (back-compat deprecation window);
    // only an explicit `{ dialect: 'cel' }` envelope is rerouted.
    if (
      condition && typeof condition === 'object'
      && (condition as { dialect?: string }).dialect === 'cel'
      && typeof (condition as { source?: string }).source === 'string'
    ) {
      return this.evaluateCelCondition((condition as { source: string }).source, options);
    }

    // Unwrap Expression envelope (see `evaluate` for rationale).
    if (condition && typeof condition === 'object' && typeof (condition as any).source === 'string') {
      condition = (condition as any).source as string;
    }

    // A BLANK gate — `''`, whitespace-only text, or an envelope whose `source`
    // is either (unwrapped just above) — is "no gate": visible/enabled, as it
    // always was here. It is answered by the SAME diagnosed guard the
    // `{ dialect: 'cel' }` route above uses (objectui#11262, ADR-0137 D4: a
    // blank gate predicate is "diagnosed, never a silent `true`"), so a bare
    // blank, a dialect-less blank envelope and a blank CEL envelope are one
    // report on one dedupe key. This used to be two silent returns — an
    // `if (!condition)` and a whitespace-only `trim()` — on the path
    // `SchemaRenderer`'s visibility legs reach with the raw authored value.
    if (isBlankPredicateText(condition)) {
      return this.answerBlankGate(condition as string, options);
    }

    // No condition at all → default to visible/enabled (`undefined`, `null`).
    // Not blank TEXT, so nothing was declared here to report. Every other
    // non-string value was answered above, as unevaluable (objectui#11358).
    if (!condition) {
      return true;
    }

    if (typeof condition !== 'string') {
      // Unreachable since objectui#11358 — kept so a future shape that slips
      // past `isUnevaluablePredicate` cannot reach the string code below.
      return Boolean(condition);
    }

    const trimmed = condition.trim();

    // A condition is semantically a single boolean expression. When it's a
    // `${...}` template, evaluate via the template path. Otherwise treat the
    // ENTIRE string as one expression (bare CEL like `record.status == "x"`):
    // `evaluate` would short-circuit a non-`${}` string and return it verbatim,
    // so `Boolean('record.status == "x"')` was ALWAYS true — silently making
    // every bare-expression `disabled`/`condition`/`visible` predicate truthy.
    if (trimmed.includes('${')) {
      return Boolean(this.evaluate(trimmed, options));
    }
    try {
      return Boolean(this.evaluateExpression(trimmed, { sanitize: options.sanitize !== false }));
    } catch (error) {
      // Unparseable predicate — preserve the historical "default to
      // visible/enabled" behaviour rather than hiding/blocking on a typo,
      // UNLESS the caller opted into fail-closed semantics (mirrors the
      // `${...}` template path above, which already honors this).
      if (options.throwOnError) {
        throw error;
      }
      // objectui#6038 — the dialect that reported NOTHING. Measured on the
      // built evaluator against the other two: a `{ dialect: 'cel' }` envelope
      // already warns here in production (`evalFieldPredicate`, deduped per
      // source) and a `${…}` template already warns (the generic line above),
      // while a BARE-STRING predicate that faults returned its fail-soft `true`
      // in complete silence. That is the dialect objectstack#11254 measured a
      // real gate breaking on, and the reason a node gate could stop biting
      // with nothing on the console to say so. `onFault` is the only new
      // channel: absent it this catch behaves exactly as it always has, so no
      // existing caller's console output moves.
      options.onFault?.(error instanceof Error ? error.message : String(error));
      return true;
    }
  }

  /**
   * Evaluate a `{ dialect: 'cel' }` predicate on the canonical `@objectstack/formula`
   * engine (via `evalFieldPredicate`), binding this evaluator's context: the
   * `record` key as the `record` namespace and the whole context bag as top-level
   * scope so `record.*`, `features.*`, `user.*`, `app.*` all resolve. Fail-soft to
   * `true` (visible/enabled — the legacy default) unless the caller opted into
   * `throwOnError`, in which case a *faulting* predicate (bad field / non-CEL
   * syntax) throws; a genuine `false` never throws.
   */
  private evaluateCelCondition(source: string, options: EvaluationOptions): boolean {
    if (isBlankPredicateText(source)) return this.answerBlankGate(source, options);
    const bag = this.context.toObject();
    const rec = bag.record;
    const record = (rec && typeof rec === 'object' && !Array.isArray(rec))
      ? (rec as Record<string, unknown>)
      : (bag as Record<string, unknown>);
    if (!options.throwOnError) {
      // Fast path: ONE evaluation, fail-soft to visible/enabled (legacy parity).
      //
      // objectui#6038: when the caller passes `onFault`, forward it to the seam
      // `evalFieldPredicate` already exposes for exactly this — `warn: false`
      // plus the reason passback — rather than adding a second reporter. The
      // caller then emits one line that can name the node; without `onFault`
      // the built-in warning fires exactly as before. Either way this stays a
      // SINGLE engine call: the `throwOnError` double-evaluation below is what
      // this branch exists to avoid paying in production.
      return evalFieldPredicate(
        source,
        record,
        true,
        undefined,
        bag,
        options.onFault ? { warn: false, onFault: options.onFault } : undefined,
      );
    }
    // Fail-closed callers need to tell a genuine `false` from a fault. The
    // canonical helper fails soft to the fallback, so a value that tracks the
    // fallback in BOTH runs means the predicate faulted — then we throw.
    // `warn: false`: the throw below IS this path's diagnostic; without it one
    // broken predicate would log AND throw (objectstack-ai/objectstack#5149).
    const asTrue = evalFieldPredicate(source, record, true, undefined, bag, { warn: false });
    const asFalse = evalFieldPredicate(source, record, false, undefined, bag, { warn: false });
    if (asTrue !== asFalse) {
      throw new Error(`CEL predicate failed to evaluate: ${source}`);
    }
    return asTrue;
  }

  /**
   * Answer a BLANK gate predicate — the ONE diagnosed guard of
   * {@link evaluateCondition}, on both of its routes (objectui#8069 put it on
   * the `{ dialect: 'cel' }` route; objectui#11262 routes the legacy path's
   * blank here too, so the two are one report rather than two).
   *
   * The verdict is `true` — no predicate → visible/enabled, exactly as before
   * (objectui#3850 / #3960's verdict) — in EVERY mode, `throwOnError` included,
   * since the author wrote nothing that could fault. What it is not is SILENT
   * (ADR-0137 D4: a blank gate predicate is "diagnosed, never a silent
   * `true`"). The report is `evalFieldPredicate`'s own `[blank]` one — the
   * channel every other predicate fault already uses — so a caller that passed
   * `onFault` receives it there (and prints its own, node-named line), and
   * every other caller gets the deduped built-in warning. No engine call is
   * made: a blank predicate never reaches the engine.
   *
   * The locator names a CEL gate on both routes: a blank has no syntax to put
   * it in either dialect, and a bare-string predicate is CEL by the spec's
   * contract. One locator is also what keeps `''` and `{ dialect: 'cel',
   * source: '' }` on one dedupe key.
   */
  private answerBlankGate(text: string, options: EvaluationOptions): true {
    evalFieldPredicate(
      text,
      {},
      true,
      undefined,
      undefined,
      options.onFault
        ? { warn: false, onFault: options.onFault }
        : { context: 'a CEL gate predicate, read as no gate' },
    );
    return true;
  }

  /**
   * Answer a gate that is DECLARED but cannot be evaluated (objectui#11358) —
   * see `isUnevaluablePredicate` (`./unevaluablePredicate.ts`) for the shapes.
   *
   * It is a fault, not a blank: {@link answerBlankGate} answers `true` in every
   * mode because a blank says nothing, while this value says "there is a gate"
   * and the client cannot read it. So the modes split exactly as they do for a
   * predicate that faults with text in it:
   *
   *   - `throwOnError` → THROW. The caller opted into fail-closed semantics,
   *     and its catch both hides / disables and reports, naming the control —
   *     the same contract `evaluateCelCondition` keeps (no warning AND a throw
   *     for one fault, objectstack-ai/objectstack#5149).
   *   - otherwise → reported once through `evalFieldPredicate`'s own report
   *     (the `[unevaluable]` reason, beside `[blank]`), or handed to the
   *     caller's `onFault`, and answered with the fail-soft `true`. On a
   *     `disabled` / `hidden` leg that `true` is the CLOSED side (greyed out /
   *     hidden), on `visible` / `enabled` / `condition` the open one — each
   *     key's existing fault direction, unchanged.
   *
   * No engine call is made: there is no `source` to hand it.
   */
  private answerUnevaluableGate(condition: unknown, options: EvaluationOptions): boolean {
    if (options.throwOnError) {
      throw new Error(`Gate predicate cannot be evaluated: ${UNEVALUABLE_PREDICATE_REASON}`);
    }
    return evalFieldPredicate(
      condition as never,
      {},
      true,
      undefined,
      undefined,
      options.onFault
        ? { warn: false, onFault: options.onFault }
        : { context: 'a declared gate with nothing to evaluate' },
    );
  }

  /**
   * Update the context with new data
   */
  updateContext(data: Record<string, any>): void {
    Object.entries(data).forEach(([key, value]) => {
      this.context.set(key, value);
    });
  }

  /**
   * Get the current context
   */
  getContext(): ExpressionContext {
    return this.context;
  }

  /**
   * Create a new evaluator with additional context data
   */
  withContext(data: Record<string, any>): ExpressionEvaluator {
    // Share the cache and formulas with the new evaluator for maximum efficiency
    return new ExpressionEvaluator(this.context.createChild(data), this.cache, this.formulas);
  }
  
  /**
   * Get cache statistics (useful for debugging and optimization)
   */
  getCacheStats() {
    return this.cache.getStats();
  }
  
  /**
   * Clear the expression cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the formula functions registry
   */
  getFormulas(): FormulaFunctions {
    return this.formulas;
  }

  /**
   * Register a custom formula function.
   *
   * **The name is case-folded: it is stored — and must be called — in UPPER
   * CASE.** `registerFunction('formatCurrency', fn)` registers
   * `FORMATCURRENCY`, and an expression has to spell it that way:
   * `${FORMATCURRENCY(price)}` resolves, `${formatCurrency(price)}` does not.
   * The fold is deliberate — formula names are spreadsheet-style vocabulary
   * (`SUM`, `IF`, `UPPER`) and the built-ins go through the very same
   * {@link FormulaFunctions.register} — but two things keep it from being
   * self-evident at the call site:
   *
   * 1. The registry API stays case-insensitive, so it never surfaces the fold:
   *    `getFormulas().has('formatCurrency')` is `true` and `.get()` returns the
   *    function. Only expressions see the stored spelling, because the
   *    evaluation scope is built from `FormulaFunctions.toObject()` — a plain
   *    object, whose identifiers expressions match case-sensitively.
   * 2. A wrong-case call site does not raise. {@link evaluate} catches, warns,
   *    and returns `defaultValue ?? expression`, so the template renders its own
   *    `${...}` source as literal text.
   *    {@link ExpressionEvaluator.evaluateExpression} is the throwing sibling,
   *    and reports `'formatCurrency' is not a function`.
   *
   * To keep a name's exact spelling, supply the function as evaluation context
   * data instead: context entries are merged over the formulas and stay verbatim.
   *
   * @param name Function name; folded to upper case for both storage and lookup.
   * @param fn Implementation, invoked with the evaluated call arguments.
   *
   * @example
   * ```ts
   * const evaluator = new ExpressionEvaluator({ price: 1234.5 });
   * evaluator.registerFunction('formatCurrency', fmt);
   *
   * evaluator.evaluate('${FORMATCURRENCY(price)}'); // '$1,234.50'
   * evaluator.evaluate('${formatCurrency(price)}'); // '${formatCurrency(price)}' — the source, verbatim
   *
   * // Case-sensitive alternative — the function travels as context data.
   * // Note the receiver: the call below is the MODULE-LEVEL export (a context
   * // bag as its second parameter), not the method used above.
   * import { evaluateExpression } from '@object-ui/core';
   * evaluateExpression('${formatCurrency(price)}', { formatCurrency: fmt, price: 1234.5 }); // '$1,234.50'
   * ```
   */
  registerFunction(name: string, fn: (...args: any[]) => any): void {
    this.formulas.register(name, fn);
  }
}

/**
 * Shared global cache and formulas for convenience functions
 */
const globalCache = new ExpressionCache();
const globalFormulas = new FormulaFunctions();

/**
 * Convenience function to quickly evaluate an expression
 */
export function evaluateExpression(
  expression: string | boolean | number | null | undefined,
  context: Record<string, any> = {},
  options: EvaluationOptions = {}
): any {
  const evaluator = new ExpressionEvaluator(context, globalCache, globalFormulas);
  return evaluator.evaluate(expression, options);
}

/**
 * Convenience function to evaluate a condition
 */
export function evaluateCondition(
  condition: string | boolean | undefined,
  context: Record<string, any> = {}
): boolean {
  const evaluator = new ExpressionEvaluator(context, globalCache, globalFormulas);
  return evaluator.evaluateCondition(condition);
}

/**
 * Convenience function to evaluate a plain condition string against a data record.
 * Supports both template expressions (e.g., '${data.amount > 1000}') and
 * plain expressions (e.g., "status == 'overdue'").
 * Record fields are available both directly (status) and namespaced (data.status).
 */
export function evaluatePlainCondition(
  condition: string,
  record: Record<string, any>
): boolean {
  const evaluator = new ExpressionEvaluator({ ...record, data: record }, globalCache, globalFormulas);
  try {
    const isTemplate = /\$\{/.test(condition);
    const result = isTemplate
      ? evaluator.evaluate(condition, { throwOnError: true })
      : evaluator.evaluateExpression(condition);
    return result === true;
  } catch {
    return false;
  }
}

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Object-Level Validation Engine — **DEPRECATED** (#3110)
 *
 * A client-side pre-check of the rules an object declares in
 * `ObjectSchema.validations`. The authority is the server
 * (`objectql/src/validation/rule-validator.ts`), which evaluates the same rules
 * on the write path.
 *
 * ## Why this is deprecated rather than finished
 *
 * Validation rules are ENFORCEMENT, and enforcement is single-implementation on
 * the server by design. `evaluator/fieldRules.ts` draws that line explicitly:
 * PRESENTATION predicates (`visibleWhen` / `readonlyWhen` / `requiredWhen`) are
 * evaluated client-side by delegating to the canonical `ExpressionEngine`,
 * "rather than re-implementing a parallel evaluator" (ADR-0036). This module is
 * that parallel evaluator, on the enforcement side of the line.
 *
 * #3103 converged its semantics onto the server rule-for-rule, with eight
 * mutation-tested gates — and it STILL left a known divergence: the server
 * carries ADR-0113's legacy-violation exemption (reject only when the merged
 * state violates AND this write makes it worse, so a pre-existing violation on
 * an old row passes), and this engine does not. Editing an unrelated field on a
 * legacy row would be blocked here and accepted there. That is the argument in
 * one line: mirroring cross-repo behaviour is structurally unreliable, not
 * unreliable-this-time.
 *
 * ## What to use instead
 *
 * Let the write fail and render the server's rejection — it is already
 * structured (`field` / `code` / `message`, plus a label since objectstack#3957).
 * If pre-submit feedback is wanted, the answer is a **validate-only (dry-run)
 * write** on the server: identical UX, zero parity risk, and it also covers the
 * two rule kinds a client can never check — `unique` (needs the database) and
 * `json_schema` (ajv lives server-side).
 *
 * Nothing here has been removed or changed in behaviour; existing callers keep
 * working. `validation-engine-stays-unwired.test.ts` fails if a production
 * module starts importing this one, so the decision is a mechanism rather than
 * this comment (#3017).
 *
 * ## When to revisit
 *
 * Offline writes (`OfflineConfig`). With no server to ask, a client evaluator
 * stops being redundant and becomes necessary. The precondition then is
 * conformance fixtures shipped by `@objectstack/spec` — golden
 * (rule, record, verdict) triples both repos run in CI — because that is the
 * only thing that turns cross-repo parity into a mechanism instead of a habit.
 * Reverse the decision in #3110 before reversing it here.
 *
 * ## Semantics (unchanged, for as long as this exists)
 *
 * The rule types come from `@object-ui/types`, which derives them from
 * `@objectstack/spec/data` (objectstack#4115). Semantics mirrored from the
 * server:
 *
 *  - **Polarity.** A `script` / `cross_field` `condition` and a `conditional`
 *    `when` express the FAILURE condition: predicate TRUE ⇒ rule VIOLATED.
 *  - **Fail-open on broken, fail-closed on violated.** A predicate that cannot
 *    be evaluated (parse error, unknown identifier, unusable expression
 *    envelope) is a broken rule, not a violated one — it is skipped, not
 *    reported. Likewise a malformed `regex`.
 *  - **Spec defaults, not falsy reads.** `active` defaults to `true` and
 *    `events` to `['insert','update']` — they arrive absent from `/meta`
 *    because the spec applies those defaults at parse time. Reading an absent
 *    `active` as "off" would silently disable every rule authored without it.
 *  - **`priority` orders execution** (lower first, stable).
 *  - **`format` and `state_machine` only fire when the write TOUCHES the
 *    field**, matching the server; emptiness and requiredness belong to the
 *    field-shape validator.
 *
 * Two documented divergences from the server, both in the safe direction:
 *
 *  1. The default evaluator is a small non-CEL parser (see
 *     `SimpleExpressionEvaluator`), so a predicate using real CEL constructs
 *     evaluates to nothing and fails open. Pass a CEL-backed
 *     `ValidationExpressionEvaluator` to close that gap.
 *  2. `unique` / `async` / `range` rules are still dispatched. They are
 *     @deprecated objectui-local variants that the spec's `ValidationRuleSchema`
 *     rejects outright, so they cannot arrive from `/meta` — only a caller
 *     building rules by hand can produce one.
 *
 * @module object-validation-engine
 * @packageDocumentation
 */

import type {
  ScriptValidation,
  UniquenessValidation,
  StateMachineValidation,
  CrossFieldValidation,
  AsyncValidation,
  ConditionalValidation,
  FormatValidation,
  RangeValidation,
  ObjectValidationRule,
} from '@object-ui/types';

/** Write contexts a rule can run on. The spec retired `delete` (objectstack#3184). */
export type ObjectValidationEvent = 'insert' | 'update';

/** The spec's `events` default, applied here because `/meta` ships it absent. */
const DEFAULT_EVENTS: readonly ObjectValidationEvent[] = ['insert', 'update'];

/** The spec's `priority` default (lower runs first). */
const DEFAULT_PRIORITY = 100;

/**
 * Read a predicate out of an `ExpressionInput` — the spec's wire shape for every
 * expression-valued key, which is `string | { dialect, source?, ast? }`.
 *
 * Returns `null` when there is nothing evaluable (an `ast`-only envelope, an
 * empty source, a non-CEL dialect). `null` means BROKEN, and every caller
 * fails open on it, mirroring the server.
 */
function expressionSource(input: unknown): string | null {
  if (typeof input === 'string') return input.trim() === '' ? null : input;
  if (input && typeof input === 'object') {
    const { dialect, source } = input as { dialect?: unknown; source?: unknown };
    // `cron` / `template` are not predicates, and an absent dialect is not the
    // spec's envelope at all. Either way there is nothing to evaluate here.
    if (dialect !== undefined && dialect !== 'cel') return null;
    if (typeof source === 'string' && source.trim() !== '') return source;
  }
  return null;
}

// The three readers below take `unknown` on purpose. They run against metadata
// as it arrives over `/meta`, where any of these keys may be absent, and an
// absent key must resolve to the SPEC's default rather than to JavaScript's
// falsiness. Narrowing here keeps that decision in one place.

/** `active` defaults to `true`; only an explicit `false` disables a rule. */
function isActive(rule: unknown): boolean {
  return (rule as { active?: unknown } | null)?.active !== false;
}

/** `events` defaults to `['insert','update']`. */
function eventsOf(rule: unknown): readonly string[] {
  const events = (rule as { events?: unknown } | null)?.events;
  return Array.isArray(events) && events.length > 0 ? (events as string[]) : DEFAULT_EVENTS;
}

/** `priority` defaults to 100 (lower runs first). */
function priorityOf(rule: unknown): number {
  const priority = (rule as { priority?: unknown } | null)?.priority;
  return typeof priority === 'number' ? priority : DEFAULT_PRIORITY;
}

/**
 * Validation context for object-level validations
 */
export interface ObjectValidationContext {
  /** Current record data */
  record: Record<string, any>;
  
  /** Previous record data (for updates) */
  oldRecord?: Record<string, any>;
  
  /** Current user */
  user?: Record<string, any>;
  
  /** Additional context data */
  [key: string]: any;
}

/**
 * Validation result
 */
export interface ObjectValidationResult {
  /** Whether validation passed */
  valid: boolean;
  
  /** Error message if validation failed */
  message?: string;
  
  /** Validation rule that failed */
  rule?: string;
  
  /** Severity */
  severity?: 'error' | 'warning' | 'info';
}

/**
 * Validation expression evaluator interface
 */
export interface ValidationExpressionEvaluator {
  evaluate(expression: string, context: Record<string, any>): any;
}

/**
 * Simple expression evaluator using a simple parser (no dynamic code execution)
 *
 * SECURITY: This implementation parses expressions into an AST and evaluates them
 * without using eval() or new Function(). That is a remediation, not a style
 * preference: an earlier revision compiled the predicate with
 * `new Function(...contextKeys, "'use strict'; return (" + expression + ")")`,
 * and CodeQL flagged it as "Unsafe code constructed from library input" —
 * expressions reach this class from validation metadata, so that shape is a
 * code-injection vector in any consumer that renders metadata it does not
 * control. Never reintroduce eval(), new Function() or any other dynamic-code
 * path here to buy expressiveness or speed; extend the parser, or inject a
 * richer evaluator through the constructor (see NOT CEL below). Supports:
 * - Comparison operators: ==, !=, >, <, >=, <=
 * - Logical operators: &&, ||, !
 * - Property access: record.field, record['field']
 * - Literals: true, false, null, numbers, strings
 *
 * LIMITATIONS:
 * - Single comparison operator per expression (no chaining like a > b > c)
 * - Simple escape sequence handling (doesn't handle escaped backslashes)
 * - Field names in bracket notation cannot contain escaped quotes
 *
 * NOT CEL. The spec's `dialect: 'cel'` predicates are evaluated server-side by
 * `@objectstack/formula`; this parser understands the common comparison shape
 * and nothing more. Anything it cannot parse yields a falsy value, which under
 * this engine's polarity (TRUE ⇒ violated) means the rule fails OPEN — the same
 * outcome the server produces for an un-evaluable predicate. To make the
 * pre-check agree with the server on richer predicates, pass a CEL-backed
 * `ValidationExpressionEvaluator` to the constructor.
 *
 * The write-up this block used to link to (`SECURITY_FIX_SUMMARY.md`) was
 * deleted with no successor; its load-bearing reasoning is inline above, and
 * the original text remains readable at
 * `git show ea72f1886^:SECURITY_FIX_SUMMARY.md`.
 */
class SimpleExpressionEvaluator implements ValidationExpressionEvaluator {
  evaluate(expression: string, context: Record<string, any>): any {
    try {
      return this.evaluateSafeExpression(expression.trim(), context);
    } catch (error) {
      console.error('Expression evaluation error:', error);
      return false;
    }
  }

  /**
   * Safely evaluate an expression without using dynamic code execution
   */
  private evaluateSafeExpression(expr: string, context: Record<string, any>): any {
    // Handle boolean literals
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    
    // Handle string literals
    if ((expr.startsWith('"') && expr.endsWith('"')) || 
        (expr.startsWith("'") && expr.endsWith("'"))) {
      return expr.slice(1, -1);
    }
    
    // Handle numeric literals
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      return parseFloat(expr);
    }
    
    // Handle logical NOT
    if (expr.startsWith('!')) {
      return !this.evaluateSafeExpression(expr.slice(1).trim(), context);
    }
    
    // Handle logical AND
    if (expr.includes('&&')) {
      const parts = this.splitOnOperator(expr, '&&');
      return parts.every(part => this.evaluateSafeExpression(part, context));
    }
    
    // Handle logical OR
    if (expr.includes('||')) {
      const parts = this.splitOnOperator(expr, '||');
      return parts.some(part => this.evaluateSafeExpression(part, context));
    }
    
    // Handle comparison operators
    const comparisonMatch = expr.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
    if (comparisonMatch) {
      const [, left, op, right] = comparisonMatch;
      const leftVal = this.evaluateSafeExpression(left.trim(), context);
      const rightVal = this.evaluateSafeExpression(right.trim(), context);
      
      switch (op) {
        case '===':
          return leftVal === rightVal;
        case '==':
          // Use loose equality for backward compatibility with existing expressions
          return leftVal == rightVal;
        case '!==':
          return leftVal !== rightVal;
        case '!=':
          // Use loose inequality for backward compatibility with existing expressions
          return leftVal != rightVal;
        case '>': return leftVal > rightVal;
        case '<': return leftVal < rightVal;
        case '>=': return leftVal >= rightVal;
        case '<=': return leftVal <= rightVal;
        default: return false;
      }
    }
    
    // Handle property access (e.g., record.field or context.field)
    return this.getValueFromContext(expr, context);
  }

  /**
   * Split expression on operator, respecting parentheses and quotes
   */
  private splitOnOperator(expr: string, operator: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < expr.length; i++) {
      const char = expr[i];
      const nextChar = expr[i + 1];
      const prevChar = i > 0 ? expr[i - 1] : '';
      
      // Handle string quotes, checking for escape sequences
      if ((char === '"' || char === "'") && !inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar && inString && prevChar !== '\\') {
        // Only close string if quote is not escaped
        inString = false;
      }
      
      if (!inString) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        
        if (depth === 0 && char === operator[0] && nextChar === operator[1]) {
          parts.push(current.trim());
          current = '';
          i++; // Skip next character
          continue;
        }
      }
      
      current += char;
    }
    
    if (current) {
      parts.push(current.trim());
    }
    
    return parts;
  }

  /**
   * Get value from context by path (e.g., "record.age" or "age")
   */
  private getValueFromContext(path: string, context: Record<string, any>): any {
    // Handle bracket notation: record['field']
    const bracketMatch = path.match(/^(\w+)\['([^']+)'\]$/);
    if (bracketMatch) {
      const [, obj, field] = bracketMatch;
      return context[obj]?.[field];
    }
    
    // Handle dot notation: record.field or just field
    const parts = path.split('.');
    let value: any = context;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        // Try direct context access for simple identifiers
        if (parts.length === 1 && part in context) {
          return context[part];
        }
        return undefined;
      }
    }
    
    return value;
  }
}

/**
 * Object-Level Validation Engine — the client pre-check described at the top of
 * this module.
 *
 * @deprecated (#3110) Validation rules are enforcement, and enforcement is
 * single-implementation on the server (`objectql`'s rule-validator). Render the
 * server's rejection instead; for pre-submit feedback, use a validate-only
 * (dry-run) write. Still functional and still correct as of #3103 — but it
 * cannot stay in step with the server without a conformance-fixture mechanism
 * that does not exist yet. See the module header.
 */
export class ObjectValidationEngine {
  private expressionEvaluator: ValidationExpressionEvaluator;
  private uniquenessChecker?: (
    fields: string[],
    values: Record<string, any>,
    scope?: string,
    context?: ObjectValidationContext
  ) => Promise<boolean>;

  constructor(
    expressionEvaluator?: ValidationExpressionEvaluator,
    uniquenessChecker?: (
      fields: string[],
      values: Record<string, any>,
      scope?: string,
      context?: ObjectValidationContext
    ) => Promise<boolean>
  ) {
    this.expressionEvaluator = expressionEvaluator || new SimpleExpressionEvaluator();
    this.uniquenessChecker = uniquenessChecker;
  }

  /**
   * Validate a record against a set of validation rules.
   *
   * Rules run in `priority` order (lower first, stable within a priority), and
   * only when `active` is not explicitly `false` and `events` covers this write
   * context — reading the spec's defaults, not the falsiness of an absent key.
   */
  async validateRecord(
    rules: ObjectValidationRule[],
    context: ObjectValidationContext,
    event: ObjectValidationEvent = 'insert'
  ): Promise<ObjectValidationResult[]> {
    const results: ObjectValidationResult[] = [];

    const applicable = rules
      .filter((rule) => isActive(rule) && eventsOf(rule).includes(event))
      // `sort` is stable in every engine objectui targets (ES2019+), so equal
      // priorities keep their authored order.
      .sort((a, b) => priorityOf(a) - priorityOf(b));

    for (const rule of applicable) {
      const result = await this.validateRule(rule, context, event);
      if (!result.valid) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Validate a single rule.
   *
   * `rule` is widened past `ObjectValidationRule` because a `conditional`'s
   * `then` / `otherwise` branch may be any rule the SPEC's union admits —
   * including `json_schema`, which this engine does not implement.
   */
  private async validateRule(
    rule: ObjectValidationRule | { type: string; name?: string },
    context: ObjectValidationContext,
    event: ObjectValidationEvent
  ): Promise<ObjectValidationResult> {
    switch (rule.type) {
      case 'script':
        return this.validatePredicate(rule as ScriptValidation, context, 'Script');

      case 'cross_field':
        return this.validatePredicate(rule as CrossFieldValidation, context, 'Cross-field');

      case 'state_machine':
        return this.validateStateMachine(rule as StateMachineValidation, context, event);

      case 'conditional':
        return this.validateConditional(rule as ConditionalValidation, context, event);

      case 'format':
        return this.validateFormat(rule as FormatValidation, context);

      // Deprecated objectui-local variants — see @object-ui/types. The spec's
      // union rejects these, so they cannot arrive from `/meta`.
      case 'unique':
        return this.validateUniqueness(rule as UniquenessValidation, context);

      case 'async':
        return this.validateAsync(rule as AsyncValidation, context);

      case 'range':
        return this.validateRange(rule as RangeValidation, context);

      default:
        // Loud, not silent. `json_schema` is a real spec variant this engine
        // does not implement; reporting it as valid would let the pre-check
        // green-light a record the server is about to reject, with nothing in
        // the console to explain the disagreement.
        console.warn(
          `[ObjectValidationEngine] rule '${(rule as { name?: string }).name ?? '(unnamed)'}' has ` +
            `type '${rule.type}', which this client engine does not evaluate — ` +
            `not checked here; the server remains the authority.`
        );
        return { valid: true };
    }
  }

  /**
   * The evaluation scope for a predicate.
   *
   * The server binds `{ record, previous }`, so a spec-authored predicate reads
   * `record.amount`. objectui's own rules have always been written against the
   * bare field name (`amount`). Both are bound — the roots last so a field
   * literally called `record` cannot shadow them.
   */
  private scopeFor(context: ObjectValidationContext): Record<string, any> {
    return {
      ...context.record,
      record: context.record,
      previous: context.oldRecord,
      user: context.user,
    };
  }

  /**
   * Evaluate a `script` / `cross_field` predicate.
   *
   * Both variants share one path on the server, and so do they here. The
   * predicate is the FAILURE condition: TRUE means the rule is violated. A
   * predicate that cannot be evaluated is a BROKEN rule and fails open.
   */
  private validatePredicate(
    rule: ScriptValidation | CrossFieldValidation,
    context: ObjectValidationContext,
    label: 'Script' | 'Cross-field'
  ): ObjectValidationResult {
    const source = expressionSource(rule.condition);
    if (source === null) {
      console.warn(
        `[ObjectValidationEngine] ${label.toLowerCase()} rule '${rule.name}' has no evaluable ` +
          `condition — skipped (the server remains the authority).`
      );
      return { valid: true };
    }

    try {
      const violated = this.expressionEvaluator.evaluate(source, this.scopeFor(context));

      if (violated === true) {
        return {
          valid: false,
          message: rule.message,
          rule: rule.name,
          severity: rule.severity,
        };
      }

      return { valid: true };
    } catch (error) {
      // Broken, not violated — mirror the server and fail open.
      console.warn(
        `[ObjectValidationEngine] ${label.toLowerCase()} rule '${rule.name}' failed to ` +
          `evaluate (${error}) — skipped.`
      );
      return { valid: true };
    }
  }

  /**
   * Validate uniqueness constraint
   */
  private async validateUniqueness(
    rule: UniquenessValidation,
    context: ObjectValidationContext
  ): Promise<ObjectValidationResult> {
    if (!this.uniquenessChecker) {
      console.warn('Uniqueness checker not configured');
      return { valid: true };
    }

    const values: Record<string, any> = {};
    for (const field of rule.fields) {
      values[field] = context.record[field];
    }

    const isUnique = await this.uniquenessChecker(
      rule.fields,
      values,
      rule.scope,
      context
    );

    if (!isUnique) {
      return {
        valid: false,
        message: rule.message,
        rule: rule.name,
        severity: rule.severity,
      };
    }

    return { valid: true };
  }

  /**
   * Validate state machine transitions (ADR-0020).
   *
   * A flat `field` plus a `{ from: [allowedTo] }` map. Semantics mirror the
   * server-side rule-validator:
   *
   *   INSERT
   *   - no `initialStates` declared        → allow (legacy no-op)
   *   - field absent from the write        → allow (requiredness is not our job)
   *   - value empty                        → allow (ditto)
   *   - value ∉ initialStates              → reject (the FSM entry point, objectstack-ai/objectstack#3165)
   *
   *   UPDATE
   *   - field absent from the write        → allow (no transition to police)
   *   - no prior record                    → allow (cannot reason)
   *   - field unchanged, or cleared        → allow (no transition)
   *   - `from` not declared in the map     → lenient allow (unconstrained)
   *   - `to` ∉ transitions[from]           → reject
   */
  private validateStateMachine(
    rule: StateMachineValidation,
    context: ObjectValidationContext,
    event: ObjectValidationEvent
  ): ObjectValidationResult {
    const touched = rule.field in context.record;

    if (event === 'insert') {
      const initial = rule.initialStates;
      // No entry-point contract — insert is unconstrained (legacy behavior).
      if (!Array.isArray(initial) || initial.length === 0) return { valid: true };
      if (!touched) return { valid: true };

      const value = context.record[rule.field];
      // Empty is requiredness's problem, not the FSM's.
      if (value === undefined || value === null || value === '') return { valid: true };

      if (initial.includes(String(value))) return { valid: true };

      return {
        valid: false,
        message: rule.message || `'${String(value)}' is not a valid initial state for ${rule.field}`,
        rule: rule.name,
        severity: rule.severity,
      };
    }

    // The state field wasn't part of this write — nothing to police.
    if (!touched) return { valid: true };

    const currentState = context.record[rule.field];
    const previousState = context.oldRecord?.[rule.field];

    // No prior state — cannot reason about a transition.
    if (previousState === undefined || previousState === null) {
      return { valid: true };
    }

    // Unchanged, or cleared — no transition to enforce.
    if (previousState === currentState || currentState === undefined || currentState === null) {
      return { valid: true };
    }

    const allowed = rule.transitions[String(previousState)];

    // `from` state not declared — leave it unconstrained (lenient).
    if (!Array.isArray(allowed)) {
      return { valid: true };
    }

    if (allowed.includes(String(currentState))) {
      return { valid: true };
    }

    return {
      valid: false,
      message: rule.message || `Invalid state transition from ${previousState} to ${currentState}`,
      rule: rule.name,
      severity: rule.severity,
    };
  }

  /**
   * Validate async/remote validation
   */
  private async validateAsync(
    rule: AsyncValidation,
    context: ObjectValidationContext
  ): Promise<ObjectValidationResult> {
    try {
      const method = rule.method || 'POST';
      const response = await fetch(rule.endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: method !== 'GET' ? JSON.stringify(context.record) : undefined,
      });

      const data = await response.json();
      
      if (!data.valid) {
        return {
          valid: false,
          message: data.message || rule.message,
          rule: rule.name,
          severity: rule.severity,
        };
      }
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        message: `Async validation error: ${error}`,
        rule: rule.name,
        severity: 'error',
      };
    }
  }

  /**
   * Validate a conditional rule.
   *
   * Evaluates `when`, then recurses into `then` (TRUE) or `otherwise` (FALSE).
   * The nested rule supplies the violation; an un-evaluable `when` is a broken
   * rule and fails open. A branch whose own `active` is explicitly `false` is
   * skipped, matching the server.
   */
  private async validateConditional(
    rule: ConditionalValidation,
    context: ObjectValidationContext,
    event: ObjectValidationEvent
  ): Promise<ObjectValidationResult> {
    const source = expressionSource(rule.when);
    if (source === null) {
      console.warn(
        `[ObjectValidationEngine] conditional rule '${rule.name}' has no evaluable ` +
          `\`when\` predicate — skipped (the server remains the authority).`
      );
      return { valid: true };
    }

    let conditionMet: unknown;
    try {
      conditionMet = this.expressionEvaluator.evaluate(source, this.scopeFor(context));
    } catch (error) {
      console.warn(
        `[ObjectValidationEngine] conditional rule '${rule.name}' \`when\` predicate failed ` +
          `to evaluate (${error}) — skipped.`
      );
      return { valid: true };
    }

    const branch = conditionMet === true ? rule.then : rule.otherwise;
    if (!branch || !isActive(branch)) {
      return { valid: true };
    }

    return this.validateRule(branch, context, event);
  }

  /**
   * Validate a field's format against `regex` and/or a named `format`.
   *
   * Mirrors the server: the rule only fires when the write TOUCHES the field and
   * the value is non-empty (requiredness and type-shape belong to the
   * field-level validator, so an absent or blank value is not a format
   * violation). Both checks apply when both are declared. A `regex` that will
   * not compile is a BROKEN rule — logged and skipped, never a violation.
   */
  private validateFormat(
    rule: FormatValidation,
    context: ObjectValidationContext
  ): ObjectValidationResult {
    if (!(rule.field in context.record)) {
      return { valid: true };
    }

    const value = context.record[rule.field];
    if (value === null || value === undefined || value === '') {
      return { valid: true };
    }

    const str = String(value);
    const violation: ObjectValidationResult = {
      valid: false,
      message: rule.message || `Invalid format for ${rule.field}`,
      rule: rule.name,
      severity: rule.severity,
    };

    if (rule.regex) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(rule.regex);
      } catch {
        console.warn(
          `[ObjectValidationEngine] format rule '${rule.name}' has an invalid regex — skipped.`
        );
        return { valid: true };
      }
      if (!pattern.test(str)) return violation;
    }

    if (rule.format && !matchesNamedFormat(rule.format, str)) {
      return violation;
    }

    return { valid: true };
  }

  /**
   * Validate range constraints
   */
  private validateRange(
    rule: RangeValidation,
    context: ObjectValidationContext
  ): ObjectValidationResult {
    const value = context.record[rule.field];
    
    if (value === null || value === undefined) {
      return { valid: true };
    }

    try {
      // Convert to comparable values
      let compareValue: number | Date;
      let minValue: number | Date | undefined;
      let maxValue: number | Date | undefined;

      if (value instanceof Date || typeof value === 'string') {
        compareValue = value instanceof Date ? value : new Date(value);
        minValue = rule.min ? (rule.min instanceof Date ? rule.min : new Date(rule.min)) : undefined;
        maxValue = rule.max ? (rule.max instanceof Date ? rule.max : new Date(rule.max)) : undefined;
      } else {
        compareValue = Number(value);
        minValue = rule.min !== undefined ? Number(rule.min) : undefined;
        maxValue = rule.max !== undefined ? Number(rule.max) : undefined;
      }

      // Check minimum
      if (minValue !== undefined) {
        const fails = rule.minExclusive
          ? compareValue <= minValue
          : compareValue < minValue;
        
        if (fails) {
          return {
            valid: false,
            message: rule.message || `Value must be ${rule.minExclusive ? 'greater than' : 'at least'} ${rule.min}`,
            rule: rule.name,
            severity: rule.severity,
          };
        }
      }

      // Check maximum
      if (maxValue !== undefined) {
        const fails = rule.maxExclusive
          ? compareValue >= maxValue
          : compareValue > maxValue;
        
        if (fails) {
          return {
            valid: false,
            message: rule.message || `Value must be ${rule.maxExclusive ? 'less than' : 'at most'} ${rule.max}`,
            rule: rule.name,
            severity: rule.severity,
          };
        }
      }
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        message: `Range validation error: ${error}`,
        rule: rule.name,
        severity: 'error',
      };
    }
  }

}

// Linear-time email check, copied from the server's rule-validator: domain
// labels exclude '.', so the quantifiers either side of each '.' cannot overlap
// — avoiding the polynomial backtracking (ReDoS) of the naive
// `[^\s@]+\.[^\s@]+` shape while still requiring a local part, an '@' and a
// dotted domain.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
// Lenient phone matcher: optional leading +, then 7–20 digits with spaces,
// dashes, dots and parens allowed as separators. Intentionally permissive —
// strict national formats belong in a `regex`.
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;

/**
 * The spec's four named formats, matched the way the server matches them.
 *
 * An unrecognised name returns `true` (no violation): the client must not reject
 * a value over a format only the server knows how to check.
 */
function matchesNamedFormat(format: FormatValidation['format'], str: string): boolean {
  switch (format) {
    case 'email':
      return EMAIL_RE.test(str);
    case 'phone':
      return PHONE_RE.test(str);
    case 'url':
      try {
        new URL(str);
        return true;
      } catch {
        return false;
      }
    case 'json':
      try {
        JSON.parse(str);
        return true;
      } catch {
        return false;
      }
    default:
      return true;
  }
}

/**
 * Default instance
 *
 * @deprecated (#3110) See `ObjectValidationEngine`.
 */
export const defaultObjectValidationEngine = new ObjectValidationEngine();

/**
 * Convenience function to validate a record
 *
 * @deprecated (#3110) See `ObjectValidationEngine`.
 */
export async function validateRecord(
  rules: ObjectValidationRule[],
  context: ObjectValidationContext,
  event: ObjectValidationEvent = 'insert'
): Promise<ObjectValidationResult[]> {
  return defaultObjectValidationEngine.validateRecord(rules, context, event);
}

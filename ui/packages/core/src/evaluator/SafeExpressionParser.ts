/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Safe Expression Parser
 *
 * CSP-safe recursive-descent expression parser for the ObjectUI expression engine.
 * Replaces the `new Function()` / `eval()`-based expression compilation with a
 * sandboxed interpreter that works under strict Content Security Policy headers.
 *
 * Operator precedence (lowest → highest):
 *   1. Ternary          a ? b : c
 *   2. Nullish          a ?? b
 *   3. Logical OR       a || b
 *   4. Logical AND      a && b
 *   5. Equality         ===  !==  ==  !=  >  <  >=  <=
 *   6. Addition         a + b   a - b
 *   7. Multiplication   a * b   a / b   a % b
 *   8. Unary            !a   -a   +a   typeof a
 *   9. Member           a.b   a[b]   a?.b   a?.[b]   a(…)   a.b(…)
 *  10. Primary          literals · identifiers · ( expr ) · [ … ]
 *
 * @module evaluator
 * @packageDocumentation
 */

/**
 * A safe subset of global JavaScript objects that are always available in
 * expressions regardless of the provided context.
 *
 * SECURITY: Only read-only, non-executable primitive utilities are exposed.
 * Constructors (`String`, `Number`, `Boolean`, `Array`) are intentionally
 * omitted: they expose a `.constructor` property that resolves to `Function`,
 * creating a sandbox-escape path even when `Function` itself is not listed.
 * `eval`, `Function`, `window`, `document`, `process`, etc. are NOT included.
 */
const SAFE_GLOBALS: Record<string, unknown> = {
  Math,
  JSON,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
};

/**
 * Property keys that must never be accessed on any object in an expression.
 *
 * SECURITY: `constructor` reaches `Function`; `__proto__`/`prototype` allow
 * prototype-chain manipulation. Access is blocked on both dot and bracket
 * notation to prevent sandbox escapes like `obj['constructor']('...')`.
 */
const BLOCKED_PROPS: ReadonlySet<string> = new Set([
  'constructor',
  '__proto__',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

/**
 * CSP-safe recursive-descent expression parser.
 *
 * Call `evaluate(expression, context)` to parse and execute an expression
 * string against a data context object without any use of `eval()` or
 * `new Function()`.
 *
 * @example
 * ```ts
 * const parser = new SafeExpressionParser();
 * parser.evaluate('data.amount > 1000', { data: { amount: 1500 } }); // true
 * parser.evaluate('stage !== "closed_won" && stage !== "closed_lost"', { stage: 'open' }); // true
 * parser.evaluate('items.filter(i => i.active).length', { items: [{active:true},{active:false}] }); // 1
 * ```
 */
export class SafeExpressionParser {
  private source = '';
  private pos = 0;
  private context: Record<string, unknown> = {};

  /**
   * Evaluation guard.
   *
   * When `false` the parser still advances `this.pos` through the source
   * (maintaining correct position for the caller) but suppresses:
   * - ReferenceErrors from undefined identifiers
   * - actual function / method invocations
   * - constructor calls
   *
   * This implements proper short-circuit semantics for `||`, `&&`, `??`, and
   * the ternary operator without needing a separate AST pass.
   */
  private _evaluating = true;

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Evaluate an expression string against a data context.
   *
   * Safe for use under strict CSP — never uses `eval()` or `new Function()`.
   *
   * @param expression - The expression to evaluate (without `${}` wrapper)
   * @param context    - Variables available to the expression
   * @returns The evaluated result
   * @throws {ReferenceError} When an identifier is not found in the context
   * @throws {TypeError}      On type mismatches (e.g., calling a non-function)
   * @throws {SyntaxError}    On malformed expression syntax
   */
  evaluate(expression: string, context: Record<string, unknown>): unknown {
    this.source = expression.trim();
    this.pos = 0;
    // Safe globals are available but user-provided context takes priority.
    this.context = { ...SAFE_GLOBALS, ...context };

    const result = this.parseTernary();
    this.skipWhitespace();

    if (this.pos < this.source.length) {
      throw new SyntaxError(
        `Unexpected token "${this.source[this.pos]}" at position ${this.pos} in expression "${expression}"`
      );
    }

    return result;
  }

  // ─── Character helpers ────────────────────────────────────────────────────

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos++;
    }
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? '';
  }

  private consume(): string {
    return this.source[this.pos++] ?? '';
  }

  // ─── Evaluation control helpers ───────────────────────────────────────────

  /**
   * Execute `fn` with `_evaluating` temporarily set to `enabled`.
   * Restores the previous value even if `fn` throws.
   *
   * Used to implement short-circuit evaluation: when a branch should not be
   * executed we call `withEvaluation(false, parseX)` which advances the source
   * position without performing any side-effectful evaluations.
   */
  private withEvaluation<T>(enabled: boolean, fn: () => T): T {
    const prev = this._evaluating;
    this._evaluating = enabled;
    try {
      return fn();
    } finally {
      this._evaluating = prev;
    }
  }

  // ─── Security helpers ─────────────────────────────────────────────────────

  /**
   * Guard property accesses against sandbox-escape keys.
   * Throws `TypeError` when the key is in `BLOCKED_PROPS`.
   *
   * Only string keys need checking: all blocked property names are strings,
   * and `BLOCKED_PROPS.has()` with a number or symbol can never match them.
   * Numeric indices (e.g. `arr[0]`) and symbol-keyed properties are therefore
   * safe to access and are intentionally left unchecked.
   */
  private assertSafeProp(key: unknown): void {
    if (typeof key === 'string' && BLOCKED_PROPS.has(key)) {
      throw new TypeError(
        `Access to property "${key}" is not permitted in expressions`
      );
    }
  }

  // ─── Parsing levels ───────────────────────────────────────────────────────

  /** Level 1 — Ternary: `cond ? trueVal : falseVal` (right-associative) */
  private parseTernary(): unknown {
    const cond = this.parseNullish();
    this.skipWhitespace();

    if (this.peek() === '?' && this.peek(1) !== '?') {
      this.pos++; // consume '?'
      this.skipWhitespace();

      if (!this._evaluating) {
        // Dry-run mode: parse both branches for position tracking only.
        this.parseTernary(); // true branch (positional advance)
        this.skipWhitespace();
        if (this.peek() !== ':') {
          throw new SyntaxError('Expected ":" in ternary expression');
        }
        this.pos++; // consume ':'
        this.skipWhitespace();
        this.parseTernary(); // false branch (positional advance)
        return undefined;
      }

      if (cond) {
        // Evaluate true branch; skip false branch without side effects.
        const trueVal = this.parseTernary();
        this.skipWhitespace();
        if (this.peek() !== ':') {
          throw new SyntaxError('Expected ":" in ternary expression');
        }
        this.pos++; // consume ':'
        this.skipWhitespace();
        this.withEvaluation(false, () => this.parseTernary()); // skip false
        return trueVal;
      } else {
        // Skip true branch without side effects; evaluate false branch.
        this.withEvaluation(false, () => this.parseTernary()); // skip true
        this.skipWhitespace();
        if (this.peek() !== ':') {
          throw new SyntaxError('Expected ":" in ternary expression');
        }
        this.pos++; // consume ':'
        this.skipWhitespace();
        return this.parseTernary(); // evaluate false
      }
    }

    return cond;
  }

  /** Level 2 — Nullish coalescing: `a ?? b` */
  private parseNullish(): unknown {
    let left = this.parseOr();
    this.skipWhitespace();

    while (this.peek() === '?' && this.peek(1) === '?') {
      this.pos += 2;
      this.skipWhitespace();

      // Short-circuit: left is non-nullish — skip RHS without evaluating it.
      if (this._evaluating && left != null) {
        this.withEvaluation(false, () => this.parseOr());
      } else {
        const right = this.parseOr();
        if (this._evaluating) left = left ?? right;
      }

      this.skipWhitespace();
    }

    return left;
  }

  /** Level 3 — Logical OR: `a || b` */
  private parseOr(): unknown {
    let left = this.parseAnd();
    this.skipWhitespace();

    while (this.peek() === '|' && this.peek(1) === '|') {
      this.pos += 2;
      this.skipWhitespace();

      // Short-circuit: left is truthy — skip RHS without evaluating it.
      if (this._evaluating && left) {
        this.withEvaluation(false, () => this.parseAnd());
      } else {
        const right = this.parseAnd();
        if (this._evaluating) left = left || right;
      }

      this.skipWhitespace();
    }

    return left;
  }

  /** Level 4 — Logical AND: `a && b` */
  private parseAnd(): unknown {
    let left = this.parseEquality();
    this.skipWhitespace();

    while (this.peek() === '&' && this.peek(1) === '&') {
      this.pos += 2;
      this.skipWhitespace();

      // Short-circuit: left is falsy — skip RHS without evaluating it.
      if (this._evaluating && !left) {
        this.withEvaluation(false, () => this.parseEquality());
      } else {
        const right = this.parseEquality();
        if (this._evaluating) left = left && right;
      }

      this.skipWhitespace();
    }

    return left;
  }

  /** Level 5 — Equality and relational comparisons */
  private parseEquality(): unknown {
    let left = this.parseAddition();
    this.skipWhitespace();

    while (true) {
      // Every branch below either assigns `op` or `break`s out of the loop, so
      // `op` is always set by the time the switch reads it (no null initializer
      // needed).
      let op: string;

      if (this.peek() === '=' && this.peek(1) === '=' && this.peek(2) === '=') {
        op = '==='; this.pos += 3;
      } else if (this.peek() === '!' && this.peek(1) === '=' && this.peek(2) === '=') {
        op = '!=='; this.pos += 3;
      } else if (this.peek() === '=' && this.peek(1) === '=') {
        op = '=='; this.pos += 2;
      } else if (this.peek() === '!' && this.peek(1) === '=') {
        op = '!='; this.pos += 2;
      } else if (this.peek() === '>' && this.peek(1) === '=') {
        op = '>='; this.pos += 2;
      } else if (this.peek() === '<' && this.peek(1) === '=') {
        op = '<='; this.pos += 2;
      } else if (this.peek() === '>' && this.peek(1) !== '>') {
        op = '>'; this.pos++;
      } else if (this.peek() === '<' && this.peek(1) !== '<') {
        op = '<'; this.pos++;
      } else {
        break;
      }

      this.skipWhitespace();
      const right = this.parseAddition();

      switch (op) {
        case '===': left = left === right; break;
        case '!==': left = left !== right; break;
        case '==': left = (left as any) == (right as any); break;
        case '!=': left = (left as any) != (right as any); break;
        case '>': left = (left as any) > (right as any); break;
        case '<': left = (left as any) < (right as any); break;
        case '>=': left = (left as any) >= (right as any); break;
        case '<=': left = (left as any) <= (right as any); break;
      }

      this.skipWhitespace();
    }

    return left;
  }

  /** Level 6 — Addition / Subtraction */
  private parseAddition(): unknown {
    let left = this.parseMultiplication();
    this.skipWhitespace();

    while (
      (this.peek() === '+' || this.peek() === '-') &&
      this.peek(1) !== '=' // avoid consuming += / -=
    ) {
      const op = this.consume();
      this.skipWhitespace();
      const right = this.parseMultiplication();
      left = op === '+' ? (left as any) + (right as any) : (left as any) - (right as any);
      this.skipWhitespace();
    }

    return left;
  }

  /** Level 7 — Multiplication / Division / Modulo */
  private parseMultiplication(): unknown {
    let left = this.parseUnary();
    this.skipWhitespace();

    while (
      (this.peek() === '*' || this.peek() === '/' || this.peek() === '%') &&
      this.peek(1) !== '='
    ) {
      const op = this.consume();
      this.skipWhitespace();
      const right = this.parseUnary();
      if (op === '*') left = (left as any) * (right as any);
      else if (op === '/') left = (left as any) / (right as any);
      else left = (left as any) % (right as any);
      this.skipWhitespace();
    }

    return left;
  }

  /** Level 8 — Unary operators: `!`, `-`, `+`, `typeof` */
  private parseUnary(): unknown {
    this.skipWhitespace();

    // typeof  (must be checked before identifier parsing to avoid consuming it)
    if (
      this.source.startsWith('typeof', this.pos) &&
      !/[\w$]/.test(this.source[this.pos + 6] ?? '')
    ) {
      this.pos += 6;
      this.skipWhitespace();
      try {
        return typeof this.parseUnary();
      } catch {
        // typeof undeclaredVar === 'undefined' in real JS
        return 'undefined';
      }
    }

    if (this.peek() === '!') {
      this.pos++;
      return !this.parseUnary();
    }

    if (this.peek() === '-') {
      this.pos++;
      return -(this.parseUnary() as any);
    }

    if (this.peek() === '+') {
      this.pos++;
      return +(this.parseUnary() as any);
    }

    return this.parseMember();
  }

  /** Level 9 — Member access, method calls, function calls */
  private parseMember(): unknown {
    let obj = this.parsePrimary();

    while (true) {
      this.skipWhitespace();

      const isOptionalDot = this.peek() === '?' && this.peek(1) === '.';
      const isDot = this.peek() === '.' && this.peek(1) !== '.';

      if (isDot || isOptionalDot) {
        // Property / method access:  obj.prop  or  obj?.prop
        if (isOptionalDot) this.pos++; // consume '?' for ?.
        this.pos++; // consume '.'
        this.skipWhitespace();

        const prop = this.parseIdentifierName();
        if (!prop) break;

        // Block sandbox-escape properties regardless of evaluation mode.
        this.assertSafeProp(prop);

        this.skipWhitespace();

        if (this.peek() === '(') {
          // Method call: obj.method(args)
          this.pos++; // consume '('
          const args = this.parseArgList();
          if (this.peek() !== ')') {
            throw new SyntaxError(`Expected ")" after argument list at position ${this.pos}`);
          }
          this.pos++; // consume ')'

          if (!this._evaluating) { obj = undefined; continue; }

          if (obj != null && typeof (obj as any)[prop] === 'function') {
            obj = ((obj as any)[prop] as (...a: unknown[]) => unknown)(...args);
          } else {
            obj = undefined;
          }
        } else {
          // Property access
          if (!this._evaluating) { obj = undefined; continue; }
          obj = obj != null ? (obj as any)[prop] : undefined;
        }

        continue;
      }

      const isOptionalBracket = this.peek() === '?' && this.peek(1) === '[';
      const isBracket = this.peek() === '[';

      if (isBracket || isOptionalBracket) {
        // Bracket access:  obj[key]  or  obj?.[key]
        if (isOptionalBracket) this.pos++; // consume '?' for ?.[
        this.pos++; // consume '['
        this.skipWhitespace();
        const key = this.parseTernary();
        this.skipWhitespace();
        if (this.peek() !== ']') {
          throw new SyntaxError(`Expected "]" after bracket expression at position ${this.pos}`);
        }
        this.pos++; // consume ']'

        // Block sandbox-escape properties regardless of evaluation mode.
        this.assertSafeProp(key);

        if (!this._evaluating) { obj = undefined; continue; }
        obj = obj != null ? (obj as any)[key as string | number] : undefined;
        continue;
      }

      if (this.peek() === '(') {
        // Direct function call on a returned value, e.g.  (getFunc())(args)
        this.pos++; // consume '('
        const args = this.parseArgList();
        if (this.peek() !== ')') {
          throw new SyntaxError(`Expected ")" after argument list at position ${this.pos}`);
        }
        this.pos++; // consume ')'

        if (!this._evaluating) { obj = undefined; continue; }

        if (typeof obj === 'function') {
          obj = (obj as (...a: unknown[]) => unknown)(...args);
        } else {
          throw new TypeError(`${String(obj)} is not a function`);
        }
        continue;
      }

      break;
    }

    return obj;
  }

  /** Level 10 — Primary expressions: literals, identifiers, `(expr)`, `[…]` */
  private parsePrimary(): unknown {
    this.skipWhitespace();
    const ch = this.peek();

    // Parenthesized expression
    if (ch === '(') {
      this.pos++;
      const val = this.parseTernary();
      this.skipWhitespace();
      if (this.peek() !== ')') {
        throw new SyntaxError(
          `Expected ")" to close "(" expression at position ${this.pos}`
        );
      }
      this.pos++;
      return val;
    }

    // Array literal
    if (ch === '[') {
      return this.parseArrayLiteral();
    }

    // String literals
    if (ch === '"' || ch === "'") {
      return this.parseString(ch);
    }

    // Number literals (unary `-` is handled in parseUnary, not here)
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(this.peek(1)))) {
      return this.parseNumber();
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      return this.parseIdentifierOrKeyword();
    }

    throw new SyntaxError(
      `Unexpected character "${ch}" at position ${this.pos}`
    );
  }

  // ─── Literal parsers ──────────────────────────────────────────────────────

  private parseArrayLiteral(): unknown[] {
    this.pos++; // consume '['
    const items: unknown[] = [];
    this.skipWhitespace();

    while (this.peek() !== ']' && this.pos < this.source.length) {
      items.push(this.parseTernary());
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.pos++;
        this.skipWhitespace();
      }
    }

    if (this.peek() !== ']') {
      throw new SyntaxError(`Expected "]" to close array literal at position ${this.pos}`);
    }
    this.pos++;
    return items;
  }

  private parseString(quote: string): string {
    this.pos++; // consume opening quote
    let str = '';

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];

      if (ch === '\\') {
        this.pos++;
        const esc = this.source[this.pos++] ?? '';
        switch (esc) {
          case 'n':  str += '\n'; break;
          case 't':  str += '\t'; break;
          case 'r':  str += '\r'; break;
          case '\\': str += '\\'; break;
          case '"':  str += '"';  break;
          case "'":  str += "'";  break;
          case '`':  str += '`';  break;
          default:   str += esc;
        }
      } else if (ch === quote) {
        this.pos++; // consume closing quote
        break;
      } else {
        str += ch;
        this.pos++;
      }
    }

    return str;
  }

  private parseNumber(): number {
    const start = this.pos;
    let hasDigits = false;

    // Note: `parsePrimary` only calls this method when the first character is
    // a digit OR when it is '.' followed immediately by a digit, so the case
    // of a bare '.' (e.g. `.toString()`) can never reach here.

    // Integer part
    while (this.pos < this.source.length && /\d/.test(this.source[this.pos])) {
      hasDigits = true;
      this.pos++;
    }

    // Optional fractional part (only one decimal point is consumed; a second
    // '.' is left in the stream and will cause an "unexpected token" error at
    // the `evaluate()` level, correctly rejecting inputs like `1.2.3`).
    if (this.source[this.pos] === '.') {
      this.pos++; // consume '.'
      while (this.pos < this.source.length && /\d/.test(this.source[this.pos])) {
        hasDigits = true;
        this.pos++;
      }
    }

    // Optional exponent: e+5, E-3
    if (/[eE]/.test(this.source[this.pos] ?? '')) {
      this.pos++; // consume 'e' or 'E'
      if (/[+-]/.test(this.source[this.pos] ?? '')) this.pos++; // optional sign

      let expDigits = 0;
      while (this.pos < this.source.length && /\d/.test(this.source[this.pos])) {
        expDigits++;
        this.pos++;
      }
      if (expDigits === 0) {
        throw new SyntaxError(`Invalid numeric literal exponent at position ${start}`);
      }
    }

    if (!hasDigits) {
      throw new SyntaxError(`Invalid numeric literal at position ${start}`);
    }

    const raw = this.source.slice(start, this.pos);
    const value = Number(raw);

    // Defensive final check: the strict loop above should never produce a
    // non-finite result, but we guard here so any latent bug surfaces as a
    // clear SyntaxError rather than silently propagating NaN.
    if (!Number.isFinite(value)) {
      throw new SyntaxError(`Invalid numeric literal "${raw}" at position ${start}`);
    }

    return value;
  }

  // ─── Identifier / keyword parsing ────────────────────────────────────────

  /**
   * Parse an identifier name (stops at non-word characters).
   * Does NOT consume any trailing whitespace or operators.
   */
  private parseIdentifierName(): string {
    const start = this.pos;
    while (this.pos < this.source.length && /[\w$]/.test(this.source[this.pos])) {
      this.pos++;
    }
    return this.source.slice(start, this.pos);
  }

  /** Parse an identifier and resolve keywords, `new`, arrows, calls, lookups. */
  private parseIdentifierOrKeyword(): unknown {
    const id = this.parseIdentifierName();

    // Literal keywords
    switch (id) {
      case 'true':      return true;
      case 'false':     return false;
      case 'null':      return null;
      case 'undefined': return undefined;
      case 'NaN':       return NaN;
      case 'Infinity':  return Infinity;
    }

    // `new` keyword: new Date(), new RegExp(...)
    if (id === 'new') {
      return this.parseNewExpression();
    }

    this.skipWhitespace();

    // Single-param arrow function without parentheses: `param => body`
    if (this.peek() === '=' && this.peek(1) === '>') {
      return this.parseArrowFunction(id);
    }

    // Function call: FN(args)
    if (this.peek() === '(') {
      this.pos++; // consume '('
      const args = this.parseArgList();
      if (this.peek() !== ')') {
        throw new SyntaxError(`Expected ")" after argument list at position ${this.pos}`);
      }
      this.pos++; // consume ')'

      if (!this._evaluating) return undefined;

      const fn = this.context[id];
      if (typeof fn === 'function') {
        return (fn as (...a: unknown[]) => unknown)(...args);
      }
      throw new TypeError(`"${id}" is not a function`);
    }

    // Variable lookup.
    // In not-evaluating mode return undefined instead of throwing ReferenceError,
    // so that short-circuited branches do not cause spurious errors.
    if (!this._evaluating) return undefined;

    if (!(id in this.context)) {
      throw new ReferenceError(`${id} is not defined`);
    }

    return this.context[id];
  }

  /**
   * Handle `new ConstructorName(args)` expressions.
   * Only safe constructors (Date, RegExp) are permitted.
   */
  private parseNewExpression(): unknown {
    this.skipWhitespace();
    const constructorName = this.parseIdentifierName();
    this.skipWhitespace();

    let args: unknown[] = [];
    if (this.peek() === '(') {
      this.pos++; // consume '('
      args = this.parseArgList();
      if (this.peek() !== ')') {
        throw new SyntaxError(`Expected ")" after new ${constructorName}() at position ${this.pos}`);
      }
      this.pos++; // consume ')'
    }

    if (!this._evaluating) return undefined;

    switch (constructorName) {
      case 'Date':
        return new Date(...(args as ConstructorParameters<typeof Date>));
      case 'RegExp':
        return new RegExp(args[0] as string, args[1] as string | undefined);
      default:
        throw new TypeError(
          `new ${constructorName}() is not supported in expressions`
        );
    }
  }

  /**
   * Parse a single-param arrow function:  `param => bodyExpression`
   *
   * The body is captured as a source substring (without evaluating it at
   * parse time), so that the parameter is properly bound when the returned
   * function is later invoked (e.g., inside `.filter()`, `.map()`, etc.).
   */
  private parseArrowFunction(param: string): (...args: unknown[]) => unknown {
    this.pos += 2; // consume '=>'
    this.skipWhitespace();

    // Scan the source to find where the body expression ends (depth-0 comma
    // or closing bracket/paren), without evaluating it.
    const bodyStart = this.pos;
    const bodyEnd = this.scanExpressionEnd();
    const bodyStr = this.source.slice(bodyStart, bodyEnd).trim();
    this.pos = bodyEnd;

    // Capture the outer context by value so the returned function can use it.
    const capturedContext = this.context;

    return (arg: unknown) => {
      const parser = new SafeExpressionParser();
      return parser.evaluate(bodyStr, {
        ...capturedContext,
        [param]: arg,
      });
    };
  }

  /**
   * Scan forward from the current position to find the end of a sub-expression
   * without evaluating it.  Stops when a depth-0 `,`, `)`, or `]` is found.
   * Correctly skips over string literals and nested brackets.
   *
   * @returns The index just past the last character of the sub-expression.
   */
  private scanExpressionEnd(): number {
    let i = this.pos;
    let depth = 0;
    let inString = false;
    let stringChar = '';

    while (i < this.source.length) {
      const ch = this.source[i];

      if (inString) {
        if (ch === '\\') {
          i += 2; // skip escaped character
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
        i++;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        i++;
        continue;
      }

      if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        if (depth === 0) break; // end of this sub-expression
        depth--;
      } else if (ch === ',' && depth === 0) {
        break; // argument separator
      }

      i++;
    }

    return i;
  }

  /**
   * Parse a comma-separated argument list up to (but not including) the
   * closing `)`.
   */
  private parseArgList(): unknown[] {
    const args: unknown[] = [];
    this.skipWhitespace();

    while (this.peek() !== ')' && this.pos < this.source.length) {
      args.push(this.parseTernary());
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.pos++;
        this.skipWhitespace();
      }
    }

    return args;
  }
}

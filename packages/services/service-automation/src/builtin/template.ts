// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Template interpolation helpers shared across node executors.
 *
 * Supported syntax (intentionally minimal — no full expression language):
 *
 *   {variable}                → variables.get('variable')
 *   {variable.path.segment}   → walks dotted path on the resolved value
 *   {list.0} / {rec.items.2}   → numeric segments index into arrays
 *   {$User.Id}                → reads from context.userId
 *   {$User.Email}             → reads from context.user?.email
 *   {NOW()}                   → ISO timestamp at evaluation time
 *   {TODAY()}                 → YYYY-MM-DD at evaluation time
 *   {TODAY() + 90}            → date + N days (days only, integer)
 *   {round(x)} {floor(x)} {ceil(x)}
 *   {abs(x)} {min(a, b)} {max(a, b)}
 *                             → the CEL stdlib's numeric six, names and
 *                               semantics mirrored 1:1 (#11060 — see
 *                               KNOWN_EXPRESSION_FUNCTIONS below)
 *
 * Anything that fails to resolve becomes the literal `null` value (for
 * single-token templates) or the empty string (for embedded substitution),
 * matching the behavior of common low-code formula engines — with ONE loud
 * exception (#11060): an identifier in CALL position (`name(…)`) that is not a
 * supported function throws {@link FlowExpressionFunctionError} instead of
 * being rewritten to `null`. Before that diagnostic, `ROUND(…)` /
 * `Math.round(…)` / `(x).toFixed(2)` all compiled to `null(…)`, the TypeError
 * was swallowed, and the field was silently written `undefined` — so a flow
 * could never round a computed money value to its field's declared `scale`,
 * and nothing said why.
 *
 * The interpolator walks objects, arrays, and primitives recursively so it
 * can be applied wholesale to a node's `config.fields`/`config.filter` blocks.
 */

import type { AutomationContext } from '@objectstack/spec/contracts';
import { isKnownFilterToken } from '@objectstack/spec/data';
import { nearestName } from '@objectstack/formula';
import { markGuardRefusal } from '../guard-refusal.js';

export type VariableMap = Map<string, unknown>;

/**
 * A function-shaped defect in a flow VALUE expression (#11060) — an unknown
 * name in call position, a supported name called at the wrong arity, or an
 * argument outside the function's domain.
 *
 * This is the LOUD half of the #11060 ruling: the silent-`null` rewrite of
 * unknown identifiers hid every one of these as an `undefined` field write.
 * The error is a guard refusal (#3863) — the metadata (the authored
 * expression) is wrong, re-running the flow unchanged can never succeed, and
 * a `fault` edge must not be able to swallow it back into silence.
 */
export class FlowExpressionFunctionError extends Error {
    /** The function name as authored (`'ROUND'`, `'Math.round'`, `'round'`). */
    readonly fn: string;
    /** Which contract the call broke. */
    readonly problem: 'unknown-function' | 'arity' | 'argument';

    constructor(fn: string, problem: 'unknown-function' | 'arity' | 'argument', message: string) {
        super(message);
        this.name = 'FlowExpressionFunctionError';
        this.fn = fn;
        this.problem = problem;
        markGuardRefusal(this);
    }
}

/**
 * The value-expression function table (#11060) — maintainer ruling 2026-08-23:
 * exactly `round` / `floor` / `ceil` / `abs` / `min` / `max`, every name and
 * semantic mirrored **1:1 from the CEL stdlib** (`@objectstack/formula`
 * `src/stdlib.ts`, "Numbers" block), ⛔ no second semantics invented. A parity
 * test (`template-functions.test.ts`) drives BOTH engines over one input grid
 * so a divergence cannot land silently.
 *
 * Carrier note — why these return plain JS numbers while the stdlib returns
 * BigInt for `round`/`floor`/`ceil`: cel-js carries CEL `int` as BigInt, and
 * the CEL engine's public boundary (`cel-engine.ts` `coerce`) hands callers a
 * plain number whenever the value fits the safe-integer range. THIS dialect's
 * operators are plain JS, where a BigInt result would throw on the next `/`
 * (`round(x * 100) / 100` — the canonical scale-2 authoring pattern, identical
 * in CEL). So the table returns exactly the post-coercion value the public CEL
 * surface yields. The two edges where that value CANNOT be mirrored into JS
 * arithmetic are named errors instead of silent corruption: a non-finite
 * argument (CEL faults there too — `BigInt(NaN)` throws inside the stdlib) and
 * a result beyond `Number.MAX_SAFE_INTEGER` (CEL's boundary switches carrier
 * to string there; a string riding into `/ 100` would corrupt silently).
 *
 * `NOW()` / `TODAY()` are deliberately NOT in this table: they are whole-token
 * date macros with their own `± N days` grammar, handled before this path.
 */
const EXPRESSION_FUNCTION_ARITY: Record<string, number> = {
    round: 1,
    floor: 1,
    ceil: 1,
    abs: 1,
    min: 2,
    max: 2,
};

function requireArity(fn: string, args: unknown[]): void {
    const want = EXPRESSION_FUNCTION_ARITY[fn];
    if (args.length !== want) {
        // cel-js refuses the same call with "no matching overload" — same
        // outcome, message written for self-correction (ADR-0032 §1d). The
        // `round(x, 2)` precision form is THE anticipated misuse (#11060), so
        // its refusal carries the supported spelling.
        const precisionHint = fn === 'round' && args.length === 2
            ? ' There is no precision form — the CEL stdlib\'s round() is integer-only; for N-decimal rounding write round(x * 100) / 100 (scale 2), matching the CEL authoring pattern.'
            : '';
        throw new FlowExpressionFunctionError(
            fn,
            'arity',
            `flow value expression: ${fn}() takes exactly ${want} argument${want === 1 ? '' : 's'}, got ${args.length}.${precisionHint}`,
        );
    }
}

/** Mirror of the CEL boundary for an int-typed result — see the table note. */
function celIntegerResult(fn: string, result: number): number {
    if (!Number.isFinite(result)) {
        throw new FlowExpressionFunctionError(
            fn,
            'argument',
            `flow value expression: ${fn}() needs a numeric argument, got a value that is not a finite number. ` +
            `(The CEL stdlib faults on the same input.)`,
        );
    }
    if (Math.abs(result) > Number.MAX_SAFE_INTEGER) {
        throw new FlowExpressionFunctionError(
            fn,
            'argument',
            `flow value expression: ${fn}() result ${result} exceeds the safe integer range — ` +
            `it cannot be represented exactly. (The CEL boundary returns a string here, which this ` +
            `dialect's arithmetic cannot compose; refusing loudly instead.)`,
        );
    }
    // JS Math.round(-0.5) / Math.ceil(-0.2) yield -0; the CEL path's
    // BigInt(-0) → Number(0n) collapses it to +0. Mirror that collapse —
    // the parity test compares with Object.is and would red on -0.
    return Object.is(result, -0) ? 0 : result;
}

type TemplateExpressionFunction = (...args: unknown[]) => unknown;

const KNOWN_EXPRESSION_FUNCTIONS: Record<string, TemplateExpressionFunction> = {
    // stdlib: 'abs(dyn): double' → Math.abs(Number(x)) — a non-numeric input
    // yields NaN (a double), same as CEL; no fault, mirrored exactly.
    abs: (...args) => { requireArity('abs', args); return Math.abs(Number(args[0])); },
    // stdlib: 'round(dyn): int' → BigInt(Math.round(Number(x))). JS Math.round
    // rounds half toward +∞ (round(-1.5) === -1) — that IS the mirrored mode.
    round: (...args) => { requireArity('round', args); return celIntegerResult('round', Math.round(Number(args[0]))); },
    // stdlib: floor/ceil round toward −∞ / +∞ (floor(-1.2) === -2, ceil(-1.2) === -1).
    floor: (...args) => { requireArity('floor', args); return celIntegerResult('floor', Math.floor(Number(args[0]))); },
    ceil: (...args) => { requireArity('ceil', args); return celIntegerResult('ceil', Math.ceil(Number(args[0]))); },
    // stdlib: 'min(dyn, dyn): dyn' — returns the smaller/larger OPERAND
    // verbatim (type preserved), comparison numeric. Exact lambda copy.
    min: (...args) => { requireArity('min', args); return Number(args[0]) <= Number(args[1]) ? args[0] : args[1]; },
    max: (...args) => { requireArity('max', args); return Number(args[0]) >= Number(args[1]) ? args[0] : args[1]; },
};

const KNOWN_EXPRESSION_FUNCTION_NAMES = Object.keys(KNOWN_EXPRESSION_FUNCTIONS);

/** Compose the unknown-function refusal, with a did-you-mean when one is near. */
function unknownFunctionError(name: string, expr: string): FlowExpressionFunctionError {
    const last = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    const lower = last.toLowerCase();
    const suggestion = KNOWN_EXPRESSION_FUNCTION_NAMES.includes(lower)
        ? lower
        : nearestName(lower, KNOWN_EXPRESSION_FUNCTION_NAMES);
    const hint = name === 'NOW' || name === 'TODAY'
        ? ` ${name}() is supported only as the whole token, with an optional ± N day offset (e.g. {${name}() + 7}).`
        : suggestion
            ? ` Did you mean '${suggestion}'?${name.includes('.') || name !== last ? ' Method/namespace call syntax is not supported — write the bare form.' : ''}`
            : '';
    return new FlowExpressionFunctionError(
        name,
        'unknown-function',
        `flow value expression: unknown function '${name}' in '${expr}'. ` +
        `Value expressions support round, floor, ceil, abs, min, max (1:1 with the CEL stdlib) ` +
        `and the whole-token date macros NOW() / TODAY().${hint} ` +
        `(Before #11060 this name was silently rewritten to null and the field was written undefined.)`,
    );
}

/**
 * Resolve a dotted path against a base value.
 * Returns `undefined` for any missing intermediate node.
 */
function resolvePath(base: unknown, path: string[]): unknown {
    let cur: unknown = base;
    for (const seg of path) {
        if (cur == null) return undefined;
        if (typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
}

/**
 * Resolve a single template token (without braces) to a value.
 * Returns `undefined` if the token cannot be resolved.
 */
function resolveToken(token: string, variables: VariableMap, context: AutomationContext): unknown {
    const trimmed = token.trim();
    if (!trimmed) return undefined;

    // Built-in date helpers — `NOW()` / `TODAY()` with optional `+ N` day offset.
    // The offset may be a literal integer or any token resolvable from `variables`.
    const dateFnMatch = /^(NOW|TODAY)\s*\(\s*\)\s*(?:([+\-])\s*(\S+))?$/.exec(trimmed);
    if (dateFnMatch) {
        const fn = dateFnMatch[1];
        const sign = dateFnMatch[2] === '-' ? -1 : 1;
        const offsetRaw = dateFnMatch[3];
        let offset = 0;
        if (offsetRaw) {
            const asNum = Number(offsetRaw);
            if (!isNaN(asNum)) {
                offset = asNum;
            } else if (variables.has(offsetRaw)) {
                offset = Number(variables.get(offsetRaw)) || 0;
            }
        }
        const now = new Date();
        if (offset) now.setDate(now.getDate() + sign * offset);
        if (fn === 'NOW') return now.toISOString();
        return now.toISOString().slice(0, 10);
    }

    // $User.* shortcuts
    if (trimmed.startsWith('$User.')) {
        const path = trimmed.slice('$User.'.length).split('.');
        if (path[0] === 'Id') return context.userId;
        if (path[0] === 'Email') return resolvePath((context as any).user, ['email', ...path.slice(1)]) ?? undefined;
        return resolvePath((context as any).user, path);
    }

    // Direct variable / dotted path lookup (fast path, no arithmetic).
    // Path segments after the head may be identifiers OR array indices (`\d+`),
    // so `{list.0}` / `{record.target_channels.0}` resolve into arrays (#1872).
    if (/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(trimmed)) {
        const segments = trimmed.split('.');
        const head = segments[0];
        if (variables.has(head)) {
            return resolvePath(variables.get(head), segments.slice(1));
        }
        if (variables.has(trimmed)) return variables.get(trimmed);
        return undefined;
    }

    // Arithmetic / mixed expression: substitute variable references (foo, foo.bar)
    // with their numeric/string literal forms, then evaluate via Function().
    // Restricted to a safe character set (digits, basic operators, parentheses,
    // dots and identifier characters) — never executed on raw user input.
    if (!/^[\w\s+\-*/%().,?:<>=!&|"'$]+$/.test(trimmed)) return undefined;
    let safe = trimmed;
    safe = safe.replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g, (match, _p1, offset: number, whole: string) => {
        // Don't substitute reserved literals
        if (match === 'true' || match === 'false' || match === 'null' || match === 'undefined') return match;
        // CALL position (`name(…)`) resolves against the function table, never
        // against flow variables (#11060). A known name stays literal — it is
        // bound as a Function parameter below. An unknown one is the loud half
        // of the ruling: refuse with a named error instead of the old `null`
        // rewrite, whose swallowed TypeError wrote the field as `undefined`.
        // (The lookahead reads the ORIGINAL string — String.replace never
        // rescans substituted output, so a variable's value cannot fabricate a
        // call position.)
        if (/^\s*\(/.test(whole.slice(offset + match.length))) {
            if (Object.prototype.hasOwnProperty.call(KNOWN_EXPRESSION_FUNCTIONS, match)) return match;
            throw unknownFunctionError(match, trimmed);
        }
        const segs = match.split('.');
        const head = segs[0];
        let val: unknown;
        if (variables.has(head)) val = resolvePath(variables.get(head), segs.slice(1));
        else if (variables.has(match)) val = variables.get(match);
        if (val === undefined || val === null) return 'null';
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        return JSON.stringify(String(val));
    });
    try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        const fn = new Function(...KNOWN_EXPRESSION_FUNCTION_NAMES, `"use strict"; return (${safe});`);
        return fn(...KNOWN_EXPRESSION_FUNCTION_NAMES.map((n) => KNOWN_EXPRESSION_FUNCTIONS[n]));
    } catch (err) {
        // The named diagnostics (arity / domain, thrown inside a table
        // function) must escape — swallowing them here would re-create the
        // exact silence #11060 removes. Everything else (junk syntax after
        // substitution) keeps the documented fail-soft contract.
        if (err instanceof FlowExpressionFunctionError) throw err;
        return undefined;
    }
}

/**
 * Coerce a resolved token value to its string form for EMBEDDED substitution —
 * a token inside a larger string, where the result is definitionally text.
 *
 * A bare `String(value)` renders an object/array as the useless `[object Object]`
 * / comma-joined form. That is the #3450 trap: a fault handler whose message
 * embeds the engine-set `$error` object (`{nodeId, message, ...}`) surfaced as
 * `[object Object]` instead of a readable error. Objects/arrays are JSON-
 * serialized so the text stays legible (and still carries the message); an
 * author who wants only the message uses the dotted path (`{$error.message}`).
 * `null`/`undefined` render as '' (an unresolved token contributes nothing).
 */
export function stringifyForTemplate(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            // Circular / non-serializable — fall back rather than throw mid-flow.
            return String(value);
        }
    }
    return String(value);
}

/**
 * Replace `{...}` tokens in a string with resolved values.
 * - When the entire string is a single token, returns the raw value (preserving type).
 * - Otherwise concatenates string substitutions, with `null`/`undefined` rendered as ''
 *   and objects/arrays JSON-serialized (never `[object Object]`, #3450).
 */
export function interpolateString(
    input: string,
    variables: VariableMap,
    context: AutomationContext,
): unknown {
    if (!input.includes('{')) return input;
    const single = /^\{([^{}]+)\}$/.exec(input);
    if (single) {
        const value = resolveToken(single[1], variables, context);
        return value;
    }
    return input.replace(/\{([^{}]+)\}/g, (_match, expr) =>
        stringifyForTemplate(resolveToken(expr, variables, context)),
    );
}

/**
 * Recursively interpolate template tokens in arbitrary JSON-like values.
 */
export function interpolate<T = unknown>(
    value: T,
    variables: VariableMap,
    context: AutomationContext,
): T {
    if (typeof value === 'string') {
        return interpolateString(value, variables, context) as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map(v => interpolate(v, variables, context)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = interpolate(v, variables, context);
        }
        return out as unknown as T;
    }
    return value;
}

/**
 * Interpolate a node's **filter** block (framework#3810).
 *
 * A filter value position is the one place where two `{…}` dialects meet: the
 * flow template dialect (`{record.owner}`, `{$User.Id}`) and the filter
 * placeholder dialect (`{current_user_id}`, `{current_year_start}` — declared
 * in `@objectstack/spec` and resolved by `resolveFilterTokens()` in the query
 * engine). Evaluation order decided the winner by accident: the flow
 * interpolator ran first, found no flow variable named `current_year_start`,
 * and returned `undefined` — so the placeholder never reached the engine that
 * knows how to resolve it, and the condition silently vanished from the query.
 *
 * This hands that position back to the dialect that owns it. A whole-string
 * token that (a) no flow variable resolves and (b) IS a recognised filter
 * placeholder is passed through **verbatim** for the engine to expand. That is
 * a transfer of ownership, not a lenient fallback: flow variables still win
 * when both could match, and a token belonging to neither dialect is left to
 * the caller's collapse guard to report.
 *
 * Only filter blocks use this. Everywhere else (`title`, `message`, `fields`,
 * `url`) keeps plain {@link interpolate}, where a bare `{current_year_start}`
 * is a nonsense reference rather than a query bound.
 */
export function interpolateFilter<T = unknown>(
    value: T,
    variables: VariableMap,
    context: AutomationContext,
): T {
    if (typeof value === 'string') {
        const single = /^\{([^{}]+)\}$/.exec(value);
        if (single) {
            const resolved = resolveToken(single[1], variables, context);
            // Flow variables keep precedence — only an unresolved token is
            // considered for hand-off, so a flow variable that happens to share
            // a placeholder's name still shadows it (no silent reinterpretation
            // of a template that works today).
            if (resolved === undefined && isKnownFilterToken(single[1].trim())) {
                return value;
            }
            return resolved as unknown as T;
        }
        return interpolateString(value, variables, context) as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map(v => interpolateFilter(v, variables, context)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = interpolateFilter(v, variables, context);
        }
        return out as unknown as T;
    }
    return value;
}

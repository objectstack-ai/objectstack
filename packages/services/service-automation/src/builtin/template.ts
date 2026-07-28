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
 *
 * Anything that fails to resolve becomes the literal `null` value (for
 * single-token templates) or the empty string (for embedded substitution),
 * matching the behavior of common low-code formula engines.
 *
 * The interpolator walks objects, arrays, and primitives recursively so it
 * can be applied wholesale to a node's `config.fields`/`config.filter` blocks.
 */

import type { AutomationContext } from '@objectstack/spec/contracts';
import { isKnownFilterToken } from '@objectstack/spec/data';

export type VariableMap = Map<string, unknown>;

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
    safe = safe.replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g, (match) => {
        // Don't substitute reserved literals
        if (match === 'true' || match === 'false' || match === 'null' || match === 'undefined') return match;
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
        const fn = new Function(`"use strict"; return (${safe});`);
        return fn();
    } catch {
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

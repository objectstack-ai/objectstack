// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Template interpolation helpers shared across node executors.
 *
 * Supported syntax (intentionally minimal — no full expression language):
 *
 *   {variable}                → variables.get('variable')
 *   {variable.path.segment}   → walks dotted path on the resolved value
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
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(trimmed)) {
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
 * Replace `{...}` tokens in a string with resolved values.
 * - When the entire string is a single token, returns the raw value (preserving type).
 * - Otherwise concatenates string substitutions, with `null`/`undefined` rendered as ''.
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
    return input.replace(/\{([^{}]+)\}/g, (_match, expr) => {
        const value = resolveToken(expr, variables, context);
        if (value === undefined || value === null) return '';
        return String(value);
    });
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

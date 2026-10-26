/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * resolvePageVarTokens — resolve `{{page.<path>}}` tokens against a page-variable
 * snapshot. The data-entry bridge for SDUI forms: an interactive input
 * (`element:text_input`, `element:record_picker`) writes a page variable; a
 * submit action references it in its params/body as `{{page.<var>}}`; this
 * resolves those tokens against the live snapshot — published into the action
 * context by `PageVariableActionBridge` — just before the request body is built.
 *
 * - A WHOLE-VALUE token (`"{{page.amount}}"`) is replaced by the variable's RAW
 *   value, preserving its type — a number stays a number, an object stays an
 *   object — so numeric/boolean/array form fields submit with the right JSON
 *   type rather than being stringified.
 * - An EMBEDDED token (`"/orgs/{{page.slug}}/setup"`) is string-interpolated.
 * - Resolution walks nested objects/arrays. A whole-value miss resolves to ''
 *   (kept as a present-but-empty field); an embedded miss drops to ''.
 *
 * Distinct from the single-brace `{field}` row-record interpolation used in API
 * target URLs (different brace count, different source) so the two never collide.
 */

const WHOLE_RE = /^\s*\{\{\s*page\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}\}\s*$/;

function lookup(path: string, vars: Record<string, any>): unknown {
  let node: any = vars;
  for (const seg of path.split('.')) {
    if (node == null) return undefined;
    node = node[seg];
  }
  return node;
}

function resolveString(str: string, vars: Record<string, any>): unknown {
  if (!str.includes('{{')) return str;
  const whole = str.match(WHOLE_RE);
  if (whole) {
    const v = lookup(whole[1], vars);
    return v === undefined ? '' : v;
  }
  // Fresh global regex per call — avoids shared `lastIndex` state.
  return str.replace(
    /\{\{\s*page\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}\}/g,
    (_m, path) => {
      const v = lookup(path, vars);
      return v == null ? '' : String(v);
    },
  );
}

function walk(value: any, vars: Record<string, any>): any {
  if (typeof value === 'string') return resolveString(value, vars);
  if (Array.isArray(value)) return value.map((v) => walk(v, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, vars);
    return out;
  }
  return value;
}

/**
 * Deep-resolve every `{{page.<var>}}` token in `value` against `pageVariables`.
 * Returns `value` unchanged when there is no snapshot. Non-string leaves pass
 * through untouched; the input is never mutated (objects/arrays are copied).
 */
export function resolvePageVarTokens<T>(
  value: T,
  pageVariables?: Record<string, any> | null,
): T {
  if (!pageVariables) return value;
  return walk(value, pageVariables) as T;
}

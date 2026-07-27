// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { classifyFilterToken, CONTEXT_TOKENS } from '@objectstack/spec/data';

/**
 * Build-time filter-placeholder diagnostics (issue #3574).
 *
 * Filter values travel as JSON, so a user-scoped or time-scoped slice cannot
 * call code inline — it writes a placeholder that the client resolves just
 * before querying:
 *
 *     { owner_id: '{current_user_id}', created_at: { $gte: '{week_start}' } }
 *
 * Exactly two vocabularies resolve inside a filter value: context tokens
 * (`{current_user_id}`, `{current_org_id}` — see `context-tokens.zod.ts`) and
 * date macros (`{today}`, `{30_days_ago}` — see `date-macros.zod.ts`).
 * Anything else is passed to the data engine **verbatim**, matches no row, and
 * the surface renders an empty result.
 *
 * ## Why this is an error, not a warning
 *
 * The runtime failure mode is silent and indistinguishable from success. A
 * metric widget filtered on an unresolved `{current_user}` renders `0`, which
 * looks exactly like a metric that is legitimately zero — no console error, no
 * server log, nothing for a human reviewer to notice. Issue #3574 found a
 * dashboard that had been broken this way since the day it was written.
 *
 * That failure mode is worse for AI authors than for humans. An AI reads a
 * successful query returning `0` as a correct answer and builds on it — it has
 * no instinct that the number looks wrong. Its correction loop is
 * "author → validate → fix", so a diagnostic only reaches it if the diagnostic
 * can fail the build. A runtime warning in a server log is invisible to it.
 * Hence: authoring-time error.
 *
 * The near-miss spellings this catches are not hypothetical. Each is a correct
 * spelling *somewhere else* in the platform, which is precisely why authors
 * reach for them:
 *
 * - `{current_user}` — `current_user.id` is the RLS expression root
 * - `{user_id}` — `{user_id}` is valid `titleFormat` field interpolation
 * - `{current_organization_id}` — `organization_id` is the real column name
 *
 * `CONTEXT_TOKEN_SUGGESTIONS` maps each to what the author meant, so the
 * diagnostic names the fix instead of only reporting the symptom.
 *
 * ## Scope — filter subtrees only
 *
 * The walk descends into `filter` / `filters` / `runtimeFilter` subtrees and
 * classifies string values inside them. It deliberately does NOT check
 * navigation `recordId` / `params`, which resolve an additional vocabulary —
 * `AppContextSelector` ids such as `{active_package}` — that is meaningless in
 * a filter because filters are not evaluated with the sidebar's selector
 * state. Restricting the walk keeps that legitimate usage out of the rule and
 * holds false positives at zero.
 *
 * Only whole-string placeholders are considered (`'{token}'` / `'${token}'`,
 * anchored). A value that merely contains braces is left alone.
 */

export const FILTER_TOKEN_UNKNOWN = 'filter-token-unknown';

export type FilterTokenSeverity = 'error' | 'warning';

export interface FilterTokenFinding {
  /** Always `error` today — an unresolved placeholder silently matches nothing. */
  severity: FilterTokenSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `dashboard "sales" · widget "my_deals"`. */
  where: string;
  /** Config path, e.g. `dashboards[0].widgets[2].filter.owner_id`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Keys whose subtree is a filter — the only place placeholders resolve. */
const FILTER_KEYS = new Set(['filter', 'filters', 'runtimeFilter']);

/**
 * Coerce a collection (array or name-keyed map) to an array of records,
 * injecting `name` from the map key — mirrors the helper in the sibling
 * authoring lints so the rule works on both the parsed (array) and normalized
 * (map) stack shapes.
 */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function label(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

const KNOWN_LIST = CONTEXT_TOKENS.join('}, {');

/**
 * Classify every string inside an already-identified filter subtree.
 *
 * Walks arrays and plain objects uniformly, which is what makes this work
 * across the platform's two filter shapes: the MongoDB-style object a
 * dashboard widget carries (`{ owner_id: '{current_user_id}' }`) and the
 * condition/triple arrays a list view carries
 * (`[{ field, operator, value }]` / `[['owner','=','…']]`). The bug this rule
 * exists for was caused by a resolver that handled only one of those shapes.
 */
function walkFilterValues(
  node: unknown,
  path: string,
  where: string,
  out: FilterTokenFinding[],
  seen: Set<unknown>,
): void {
  if (node === null || node === undefined) return;

  if (typeof node === 'string') {
    const cls = classifyFilterToken(node);
    if (cls?.kind === 'unknown') {
      const suggestion = cls.suggestion;
      out.push({
        severity: 'error',
        rule: FILTER_TOKEN_UNKNOWN,
        where,
        path,
        message:
          `Filter value "${node}" is not a resolvable placeholder. It is sent to the ` +
          `data engine as a literal string, matches no record, and the surface renders empty.`,
        hint: suggestion
          ? `Did you mean "{${suggestion}}"? Context tokens are {${KNOWN_LIST}}; ` +
            `time-based values use date macros such as {today} or {30_days_ago}.`
          : `Resolvable placeholders are the context tokens {${KNOWN_LIST}} and the ` +
            `date macros (e.g. {today}, {week_start}, {30_days_ago}). To filter on a ` +
            `literal value that happens to look like a placeholder, this is not supported — ` +
            `rename the value.`,
      });
    }
    return;
  }

  if (typeof node !== 'object') return;
  // Metadata graphs can be cyclic once normalized; guard the walk.
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((v, i) => walkFilterValues(v, `${path}[${i}]`, where, out, seen));
    return;
  }

  for (const [k, v] of Object.entries(node as AnyRec)) {
    walkFilterValues(v, `${path}.${k}`, where, out, seen);
  }
}

/**
 * Find `filter` / `filters` / `runtimeFilter` subtrees anywhere beneath
 * `node`, then classify the values inside them.
 *
 * Scanning for filter KEYS rather than enumerating known surfaces is
 * deliberate: widget filters, list-view filters, dataset and measure filters,
 * report runtime filters, and SDUI component filters all spell the key the
 * same way, and a new surface that follows the convention is covered the day
 * it ships. Enumerating surfaces is how #3574 happened — the dashboard was
 * simply never added to the list.
 */
function scanForFilters(
  node: unknown,
  path: string,
  where: string,
  out: FilterTokenFinding[],
  seen: Set<unknown>,
): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((v, i) => scanForFilters(v, `${path}[${i}]`, where, out, seen));
    return;
  }

  for (const [k, v] of Object.entries(node as AnyRec)) {
    const childPath = `${path}.${k}`;
    if (FILTER_KEYS.has(k)) {
      walkFilterValues(v, childPath, where, out, new Set());
      continue;
    }
    scanForFilters(v, childPath, where, out, seen);
  }
}

/**
 * Validate filter placeholders across a schema-parsed stack.
 *
 * Pure `(stack) => Finding[]`; no I/O. Covers dashboards (widget + global
 * filters), objects (list views), top-level view containers, reports,
 * datasets, and pages.
 */
export function validateFilterTokens(stack: Record<string, unknown> | undefined | null): FilterTokenFinding[] {
  if (!stack || typeof stack !== 'object') return [];
  const out: FilterTokenFinding[] = [];

  const surfaces: Array<[key: string, kind: string]> = [
    ['dashboards', 'dashboard'],
    ['objects', 'object'],
    ['views', 'view'],
    ['reports', 'report'],
    ['datasets', 'dataset'],
    ['pages', 'page'],
    ['apps', 'app'],
  ];

  for (const [key, kind] of surfaces) {
    const items = asArray((stack as AnyRec)[key]);
    items.forEach((item, i) => {
      const name = label(item.name ?? item.id, `#${i}`);
      // Dashboards are the surface #3574 was filed against; name the widget in
      // `where` so the author can jump straight to it.
      if (kind === 'dashboard') {
        const widgets = Array.isArray(item.widgets) ? (item.widgets as AnyRec[]) : [];
        widgets.forEach((w, wi) => {
          const wName = label(w.id ?? w.title, `#${wi}`);
          scanForFilters(
            w,
            `${key}[${i}].widgets[${wi}]`,
            `dashboard "${name}" · widget "${wName}"`,
            out,
            new Set(),
          );
        });
        // …and everything else on the dashboard (globalFilters, header, etc.)
        // minus the widgets already covered above.
        const { widgets: _skip, ...rest } = item;
        scanForFilters(rest, `${key}[${i}]`, `dashboard "${name}"`, out, new Set());
        return;
      }
      scanForFilters(item, `${key}[${i}]`, `${kind} "${name}"`, out, new Set());
    });
  }

  return out;
}

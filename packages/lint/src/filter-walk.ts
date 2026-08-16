// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared traversal: where the AUTHORED filters are in a metadata stack.
 *
 * Two rules in this package need the same answer to the same question — "which
 * values in this stack were authored as a filter?" — and they need it for
 * different reasons: `validate-filter-tokens.ts` classifies the STRINGS inside
 * those subtrees (#3574), `validate-empty-combinators.ts` classifies their
 * SHAPE (#5330). The subtree-finding half is identical for both, and it is the
 * half with the interesting failure mode: #3574 happened because a resolver
 * enumerated known surfaces and the dashboard was simply never added to the
 * list. `page-walk.ts` (#3583/#5405) and `view-walk.ts` (#6381) are the same
 * argument on two other traversals — with N copies the next author fixes one of
 * N and the survivors keep the old verdict — and this file is written from
 * theirs.
 *
 * ## What is shared, and what deliberately is NOT
 *
 * The MECHANISM is shared: descend a stack item, recognise a filter KEY, hand
 * the subtree to a visitor. The SURFACE LIST is a parameter, not a constant,
 * because the two callers genuinely differ: the token rule scans the seven
 * presentation collections it has always scanned, and adding an eighth to a
 * shared constant would silently widen a live gating rule. A caller declares
 * its own {@link FilterSurface} list and owns that decision.
 *
 * ## Scanning for KEYS rather than enumerating surfaces
 *
 * Widget filters, list-view filters, dataset and measure filters, report
 * runtime filters, flow CRUD node filters and SDUI component filters all spell
 * the key the same way, so a new surface that follows the convention is covered
 * the day it ships. That is the property #3574 lacked.
 *
 * Navigation `recordId` / `params` are NOT filter keys and are never visited:
 * they resolve an additional vocabulary (`AppContextSelector` ids such as
 * `{active_package}`) that is meaningless in a filter, and restricting the walk
 * is what holds false positives at zero.
 */

/** Any plain metadata record. */
type AnyRec = Record<string, unknown>;

/**
 * Keys whose subtree is a filter. The one place a filter is authored.
 *
 * `relatedListFilter` (#8704) is the one member that does not spell the key
 * `filter`: it sits flat on a FIELD beside its `relatedList`/`relatedListTitle`/
 * `relatedListColumns` family, so the family naming wins over the filter-key
 * convention. It carries a canonical Query-DSL `FilterCondition` (the schema
 * door already judges it at parse), and listing it here is what extends the
 * three walking rules — tokens, empty combinators, preset comparands — to the
 * new position instead of leaving a per-rule hole.
 */
export const FILTER_KEYS: ReadonlySet<string> = new Set(['filter', 'filters', 'runtimeFilter', 'relatedListFilter']);

/** One stack collection a caller wants walked. */
export interface FilterSurface {
  /** Stack collection key — `dashboards`, `objects`, `flows`, … */
  key: string;
  /** Singular noun used in the `where` label — `dashboard`, `object`, `flow`, … */
  kind: string;
}

/** One authored filter subtree, with everything a finding needs to name it. */
export interface AuthoredFilter {
  /** The value found under the filter key, exactly as authored. */
  value: unknown;
  /** Config path, e.g. `dashboards[0].widgets[2].filter`. */
  path: string;
  /** Human-readable location, e.g. `dashboard "sales" · widget "my_deals"`. */
  where: string;
}

/**
 * Coerce a collection (array or name-keyed map) to an array of records,
 * injecting `name` from the map key — so a rule works on both the parsed
 * (array) and normalized (map) stack shapes.
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

/**
 * Find filter subtrees anywhere beneath `node` and hand each to `visit`.
 *
 * Exported for a caller that already has a single item in hand (the runtime
 * publish gate's per-write snapshot arrives that way) rather than a whole stack.
 */
export function scanForFilters(
  node: unknown,
  path: string,
  where: string,
  visit: (filter: AuthoredFilter) => void,
  seen: Set<unknown> = new Set(),
): void {
  if (!node || typeof node !== 'object') return;
  // Metadata graphs can be cyclic once normalized; guard the walk.
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((v, i) => scanForFilters(v, `${path}[${i}]`, where, visit, seen));
    return;
  }

  for (const [k, v] of Object.entries(node as AnyRec)) {
    const childPath = `${path}.${k}`;
    if (FILTER_KEYS.has(k)) {
      visit({ value: v, path: childPath, where });
      continue;
    }
    scanForFilters(v, childPath, where, visit, seen);
  }
}

/**
 * Walk every authored filter in `stack` across the caller's surfaces.
 *
 * Pure traversal: it holds no judgement and emits no findings. Dashboards get
 * a per-widget `where` because that is the surface #3574 was filed against and
 * naming the widget is what lets an author jump straight to it; every other
 * surface is named by its collection kind and its own `name` / `id`.
 */
export function walkAuthoredFilters(
  stack: unknown,
  surfaces: readonly FilterSurface[],
  visit: (filter: AuthoredFilter) => void,
): void {
  if (!stack || typeof stack !== 'object') return;

  for (const { key, kind } of surfaces) {
    const items = asArray((stack as AnyRec)[key]);
    items.forEach((item, i) => {
      const name = label(item.name ?? item.id, `#${i}`);
      if (kind === 'dashboard') {
        const widgets = Array.isArray(item.widgets) ? (item.widgets as AnyRec[]) : [];
        widgets.forEach((w, wi) => {
          const wName = label(w.id ?? w.title, `#${wi}`);
          scanForFilters(
            w,
            `${key}[${i}].widgets[${wi}]`,
            `dashboard "${name}" · widget "${wName}"`,
            visit,
            new Set(),
          );
        });
        // ...and everything else on the dashboard (globalFilters, header, etc.)
        // minus the widgets already covered above.
        const { widgets: _skip, ...rest } = item;
        scanForFilters(rest, `${key}[${i}]`, `dashboard "${name}"`, visit, new Set());
        return;
      }
      scanForFilters(item, `${key}[${i}]`, `${kind} "${name}"`, visit, new Set());
    });
  }
}

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
 *
 * ## The two halves of a filter, and where each one is answered
 *
 * `walkAuthoredFilters` finds the SUBTREES. Inside one, a rule wants either the
 * VALUES (`validate-filter-tokens.ts` classifies placeholders in them;
 * `validate-preset-comparands.ts` judges ordering comparands) or the FIELD KEYS
 * — the names the query is filtered BY. {@link walkFilterFieldKeys} is the
 * second half (#14105), and it is here rather than in its first caller because
 * the shape dispatch is identical to the one `validate-preset-comparands.ts`
 * already performs on values: the platform authors filters three ways, and a
 * reader that handles only one shape is the exact bug #3574 was filed against.
 */

import { VALID_AST_OPERATORS } from '@objectstack/spec/data';

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

// ── The FIELD-KEY half of a filter subtree (#14105) ──────────────────────────

/** One field position inside an authored filter. */
export interface FilterFieldKey {
  /**
   * The field the condition filters BY, exactly as authored — a bare name
   * (`status`), or a dotted relationship path (`account.region`, whether
   * spelled that way or reached by descending a nested condition object).
   */
  field: string;
  /** Config path of the position, e.g. `datasets[1].measures[1].filter.last_update_at`. */
  path: string;
}

/** Recursion guard — an authored filter is a bounded document, not a graph. */
const MAX_KEY_DEPTH = 32;

function isPlainObject(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * Emit the field positions of one Mongo-style condition NODE.
 *
 * `prefix` carries the relationship path accumulated by descending nested
 * condition objects, so `{ account: { region: { $eq: 'emea' } } }` reports the
 * single position `account.region` rather than a bare `region` that would
 * resolve against the wrong object. A node whose value carries `$` operators is
 * a leaf condition and ends the descent; a `$`-prefixed key that is not a
 * recognised combinator is skipped and NOT descended, matching
 * `validate-preset-comparands.ts` — an unrecognised operator's operand shape is
 * not ours to guess.
 */
function conditionFieldKeys(
  node: AnyRec,
  path: string,
  prefix: string,
  visit: (key: FilterFieldKey) => void,
  depth: number,
): void {
  if (depth > MAX_KEY_DEPTH) return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        value.forEach((arm, i) => {
          if (isPlainObject(arm)) conditionFieldKeys(arm, `${here}[${i}]`, prefix, visit, depth + 1);
        });
      }
      continue;
    }
    if (key === '$not') {
      if (isPlainObject(value)) conditionFieldKeys(value, here, prefix, visit, depth + 1);
      continue;
    }
    if (key.startsWith('$')) continue; // unrecognised combinator
    const field = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && !Object.keys(value).some((k) => k.startsWith('$'))) {
      // Nested relation / deep equality — the field position is one level
      // deeper, so descend rather than reporting the intermediate hop twice.
      // An EMPTY nested object addresses nothing further; report the hop itself.
      if (Object.keys(value).length > 0) {
        conditionFieldKeys(value, here, field, visit, depth + 1);
        continue;
      }
    }
    visit({ field, path: here });
  }
}

/**
 * Emit every FIELD KEY inside one authored filter subtree, whatever shape it
 * was authored in — the key half of what `validate-preset-comparands.ts` does
 * for values, and the traversal `filter-token-unknown` already performs while
 * reasoning only about the strings it finds.
 *
 * Holds no judgement: it does not know which object the filter is bound to and
 * emits no findings. Resolution is {@link resolveFieldPath}'s job
 * (`object-graph.ts`) and the verdict is the caller's.
 */
export function walkFilterFieldKeys(
  node: unknown,
  path: string,
  visit: (key: FilterFieldKey) => void,
  depth = 0,
): void {
  if (depth > MAX_KEY_DEPTH) return;

  if (Array.isArray(node)) {
    // Triple: ['field', op, value] — the field position is a non-keyword
    // string and the operator position is in the AST vocabulary (the
    // `isFilterAST` test `validate-preset-comparands.ts` uses).
    if (
      typeof node[0] === 'string' && typeof node[1] === 'string'
      && !['and', 'or'].includes(node[0].toLowerCase())
      && VALID_AST_OPERATORS.has(node[1].toLowerCase())
    ) {
      visit({ field: node[0], path: `${path}[0]` });
      return;
    }
    // Group ['and'|'or', ...members] or a bare list — recurse the members.
    node.forEach((member, i) => {
      if (typeof member === 'string') return; // the leading keyword
      walkFilterFieldKeys(member, `${path}[${i}]`, visit, depth + 1);
    });
    return;
  }

  if (!isPlainObject(node)) return;

  // View filter rule: { field, operator[, value] }.
  if (typeof node.field === 'string' && typeof node.operator === 'string') {
    visit({ field: node.field, path: `${path}.field` });
    return;
  }

  conditionFieldKeys(node, path, '', visit, depth);
}

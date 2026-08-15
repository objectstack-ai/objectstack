// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  VALID_AST_OPERATORS,
  bareDateRangePresetComparandMessage,
  canonicalAstOperator,
  isDateRangePresetName,
  type DateRangePreset,
} from '@objectstack/spec/data';
import { normalizeFilterOperator } from '@objectstack/spec/ui';

import { walkAuthoredFilters, type FilterSurface } from './filter-walk.js';

/**
 * Build-time refusal of a bare dashboard date-range PRESET name in an ordering
 * comparand (#8793 — the ruled C half of #8690).
 *
 * `last_7_days` / `last_30_days` / `last_90_days` and their ten calendar
 * siblings are REAL declared names (`DATE_RANGE_PRESETS`,
 * `@objectstack/spec/data`) — but only for the dashboard date-filter positions,
 * where the console lowers them to `{date-macro}` bounds before any query is
 * sent. Authored as a bare filter comparand, nothing resolves them. Measured
 * end to end on #8690 (51 rows seeded / 38 in-window):
 *
 * ```
 * $gte "last_30_days"   HTTP 200  count=0    <- silent zero (the defect)
 * $gte "{30_days_ago}"  HTTP 200  count=38   <- the spelling that works
 * ```
 *
 * The engine now refuses the bare name on a declared temporal field at QUERY
 * time (`INVALID_FILTER` / 400, PR #8808 — the B half). This rule is the
 * AUTHORING-time half the ruling shipped alongside it: the error reaches the
 * author — an AI author in particular, whose correction loop only sees what
 * can fail the build or the publish — instead of the first viewer of an empty
 * chart. The same refusal exists in the schema door
 * (`data/filter.zod.ts`, Mongo-shape carriers only); this rule additionally
 * reaches the shapes no `FilterConditionSchema` parse touches — view filter
 * rules (`{ field, operator, value }`) and filter-array triples
 * (`['created_at', '>=', …]`) — and reports with the located `where` / `path`
 * the CLI commands render.
 *
 * ## The boundary — ordering positions only, in all three shapes
 *
 * This rule is field-agnostic, so the judgement rides on POSITION, exactly as
 * the schema door's #8793 note lays out at length:
 *
 * - **Judged:** `$gt` / `$gte` / `$lt` / `$lte` comparands and `$between`
 *   endpoints (Mongo shape); `>` / `>=` / `<` / `<=` / `between` triples and
 *   every alias `canonicalAstOperator` folds onto them (`gt`, `after`, …);
 *   `greater_than` / `less_than` / `greater_than_or_equal` /
 *   `less_than_or_equal` / `before` / `after` / `between` view filter rules
 *   and every alias `normalizeFilterOperator` folds onto them. An ORDERED
 *   comparison against a declared preset name has no legitimate reading.
 * - **Not judged:** equality and membership (`=`, `equals`, `$eq`, `$ne`,
 *   `$in`, `$nin`, …). A select/picklist column legitimately stores values
 *   that collide with preset names (`GlobalFilterSchema`'s own pins protect
 *   `type: 'select', defaultValue: 'this_quarter'`), and on a declared
 *   temporal field the engine door still refuses these at query time with the
 *   field's type in hand.
 * - **Only the 13 declared names.** A near-miss (`last_60_days`) is not this
 *   rule's business — on a temporal field the engine's field-typed door
 *   catches it; judging undeclared strings here would be a guessed superset.
 *
 * Both vocabularies' `{placeholder}` spellings never collide with a preset
 * name (a preset carries no braces), so this rule and `validate-filter-tokens`
 * cannot double-report one value.
 */

export const FILTER_PRESET_COMPARAND = 'filter-preset-comparand';

export type PresetComparandSeverity = 'error' | 'warning';

export interface PresetComparandFinding {
  /** Always `error` — the runtime refuses the query, or silently returns zero rows. */
  severity: PresetComparandSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `dashboard "sales" · widget "my_deals"`. */
  where: string;
  /** Config path, e.g. `dashboards[0].widgets[2].filter.created_at.$gte`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** The surfaces this rule scans — the same eight `validate-empty-combinators` declares. */
const PRESET_COMPARAND_SURFACES: readonly FilterSurface[] = [
  { key: 'dashboards', kind: 'dashboard' },
  { key: 'objects', kind: 'object' },
  { key: 'views', kind: 'view' },
  { key: 'reports', kind: 'report' },
  { key: 'datasets', kind: 'dataset' },
  { key: 'pages', kind: 'page' },
  { key: 'apps', kind: 'app' },
  { key: 'flows', kind: 'flow' },
];

/** Mongo-shape ordering operators whose scalar comparand is judged. */
const ORDERING_DOLLAR_OPS: ReadonlySet<string> = new Set(['$gt', '$gte', '$lt', '$lte']);

/**
 * Canonical INFIX ordering spellings, post `canonicalAstOperator` fold — the
 * triple-shape twin of {@link ORDERING_DOLLAR_OPS}. `between` is handled apart
 * (its value is the `[min, max]` pair).
 */
const ORDERING_INFIX_OPS: ReadonlySet<string> = new Set(['>', '>=', '<', '<=']);

/**
 * Canonical view-filter-rule ordering operators, post `normalizeFilterOperator`
 * fold. `between` is handled apart for the same reason.
 */
const ORDERING_RULE_OPS: ReadonlySet<string> = new Set([
  'greater_than', 'greater_than_or_equal',
  'less_than', 'less_than_or_equal',
  'before', 'after',
]);

/** Recursion guard — an authored filter is a bounded document, not a general graph. */
const MAX_DEPTH = 32;

function isPlainObject(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function finding(
  where: string,
  path: string,
  preset: DateRangePreset,
  operator: string,
): PresetComparandFinding {
  return {
    severity: 'error',
    rule: FILTER_PRESET_COMPARAND,
    where,
    path,
    message: bareDateRangePresetComparandMessage(preset, operator),
    hint:
      'Presets belong to the dashboard date-filter bar (dateRange.defaultRange, a date '
      + "global filter's defaultValue). In a filter comparand, write the {date-macro} "
      + 'window the message names, or an ISO date.',
  };
}

/** Judge one Mongo-style condition NODE's own field entries. */
function judgeConditionNode(
  node: AnyRec,
  path: string,
  where: string,
  out: PresetComparandFinding[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        value.forEach((arm, i) => {
          if (isPlainObject(arm)) judgeConditionNode(arm, `${here}[${i}]`, where, out, depth + 1);
        });
      }
      continue;
    }
    if (key === '$not') {
      if (isPlainObject(value)) judgeConditionNode(value, here, where, out, depth + 1);
      continue;
    }
    if (key.startsWith('$')) continue; // unrecognised combinator — skipped, not descended
    if (!isPlainObject(value)) continue; // implicit equality — deliberately not judged
    const hasOps = Object.keys(value).some((k) => k.startsWith('$'));
    if (!hasOps) {
      // Nested relation / deep equality — descend.
      judgeConditionNode(value, here, where, out, depth + 1);
      continue;
    }
    for (const [op, comparand] of Object.entries(value)) {
      if (ORDERING_DOLLAR_OPS.has(op) && isDateRangePresetName(comparand)) {
        out.push(finding(where, `${here}.${op}`, comparand, op));
        continue;
      }
      if (op === '$between' && Array.isArray(comparand)) {
        comparand.forEach((endpoint, i) => {
          if (isDateRangePresetName(endpoint)) {
            out.push(finding(where, `${here}.${op}[${i}]`, endpoint, op));
          }
        });
      }
    }
  }
}

/** Judge one `{ field, operator, value }` view filter rule. */
function judgeFilterRule(
  rule: AnyRec,
  path: string,
  where: string,
  out: PresetComparandFinding[],
): void {
  const operator = normalizeFilterOperator(rule.operator);
  if (typeof operator !== 'string') return;
  const value = rule.value;
  if (ORDERING_RULE_OPS.has(operator) && isDateRangePresetName(value)) {
    out.push(finding(where, `${path}.value`, value, operator));
    return;
  }
  if (operator === 'between' && Array.isArray(value)) {
    value.forEach((endpoint, i) => {
      if (isDateRangePresetName(endpoint)) {
        out.push(finding(where, `${path}.value[${i}]`, endpoint, operator));
      }
    });
  }
}

/** Judge one `[field, operator, value]` triple. */
function judgeTriple(
  triple: unknown[],
  path: string,
  where: string,
  out: PresetComparandFinding[],
): void {
  const op = triple[1];
  if (typeof op !== 'string') return;
  const canonical = canonicalAstOperator(op);
  const value = triple[2];
  if (ORDERING_INFIX_OPS.has(canonical) && isDateRangePresetName(value)) {
    out.push(finding(where, `${path}[2]`, value, op));
    return;
  }
  if (canonical === 'between' && Array.isArray(value)) {
    value.forEach((endpoint, i) => {
      if (isDateRangePresetName(endpoint)) {
        out.push(finding(where, `${path}[2][${i}]`, endpoint, op));
      }
    });
  }
}

/**
 * Classify one authored filter subtree, whatever shape it was authored in.
 *
 * The platform authors filters three ways, and the walk visits all of them
 * because a resolver that handles only one shape is the exact bug #3574 was
 * filed against: the Mongo-style object a dashboard widget carries, the
 * `[{ field, operator, value }]` rule arrays a list view carries, and the
 * `[field, op, value]` triples (with `['and'|'or', …]` groups and bare lists)
 * that React block props and the client `FilterBuilder` produce.
 */
function judgeFilterValue(
  node: unknown,
  path: string,
  where: string,
  out: PresetComparandFinding[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;

  if (Array.isArray(node)) {
    // Triple: ['field', op, value] — field position is a non-keyword string,
    // operator position is in the AST vocabulary (the `isFilterAST` test).
    if (
      typeof node[0] === 'string' && typeof node[1] === 'string'
      && !['and', 'or'].includes(node[0].toLowerCase())
      && VALID_AST_OPERATORS.has(node[1].toLowerCase())
    ) {
      judgeTriple(node, path, where, out);
      return;
    }
    // Group ['and'|'or', ...members] or bare list — recurse the members.
    node.forEach((member, i) => {
      if (typeof member === 'string') return; // the leading keyword
      judgeFilterValue(member, `${path}[${i}]`, where, out, depth + 1);
    });
    return;
  }

  if (!isPlainObject(node)) return;

  // View filter rule: { field, operator[, value] }.
  if (typeof node.field === 'string' && typeof node.operator === 'string') {
    judgeFilterRule(node, path, where, out);
    return;
  }

  judgeConditionNode(node, path, where, out, depth);
}

/**
 * Validate every authored filter across a stack for bare preset comparands.
 *
 * Pure `(stack) => Finding[]`; no I/O. Needs no resolution context — the
 * judgement is on the filter literal alone — which is what qualifies it for
 * the runtime publish gate's per-write snapshot.
 */
export function validatePresetComparands(
  stack: Record<string, unknown> | undefined | null,
): PresetComparandFinding[] {
  if (!stack || typeof stack !== 'object') return [];
  const out: PresetComparandFinding[] = [];

  walkAuthoredFilters(stack, PRESET_COMPARAND_SURFACES, ({ value, path, where }) => {
    judgeFilterValue(value, path, where, out, 0);
  });

  return out;
}

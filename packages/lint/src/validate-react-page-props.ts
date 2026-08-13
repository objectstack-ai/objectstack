// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time prop check for `kind:'react'` pages (ADR-0081 Phase 2). The syntax
// gate (validate-react-pages) confirms the source parses; this confirms the
// AUTHOR USED THE COMPONENT CONTRACT correctly — it parses the real JSX with the
// TypeScript compiler, finds usages of the injected blocks (<ObjectForm>,
// <ListView>, …), and checks each against the react-tier contract
// (REACT_BLOCKS in @objectstack/spec):
//
//   - missing a required binding prop (e.g. <ObjectForm> with no objectName)
//     → error. (Only the React-enforceable overlay props are required-checked;
//      a spread `{...props}` escapes the check since props may come from it.)
//   - a prop that is a near-miss (edit distance ≤ 2) of a known prop
//     (e.g. `onSucces` → `onSuccess`) → warning. We do NOT flag arbitrary
//     unknown props (the contract's data props are a curated subset) — only the
//     likely typos, to keep false positives near zero.
//   - <ObjectChart>'s data BINDINGS, by reading the attribute VALUES (#3701,
//     retargeted to the spec shape in #3729). See the block comment above
//     `checkObjectChart`.
//   - <ListView>'s `searchableFields` entries, resolved against the bound
//     object's declared fields (#4329) — the react-surface twin of the
//     metadata rule `searchable-field-unknown`, sharing its core.
//   - EVERY OTHER field-bearing prop a react block can author (#4340) — see
//     `REACT_FIELD_SPECS` below and the ledger beside it.
//   - a `record:*` block on this surface at all (#4413) → error. They render
//     from a record page's shared record context, which a react page does not
//     mount, so they come back empty however they are bound. See
//     `recordContextFinding`.
//
// Reading values is opt-in per block and per prop: everything below evaluates
// only STATIC literals (`objectName="invoice"`, an `aggregate={{…}}` object
// literal). A value that comes from a variable, a call, or a spread is not
// knowable at build time and is skipped silently — an unresolvable binding is
// not a wrong one (ADR-0072 D1).

import { createRequire } from 'node:module';
import type ts from 'typescript';
import {
  REACT_BLOCKS,
  RECORD_CONTEXT_BLOCK_TAGS,
  REACT_RECORD_BLOCK_ALTERNATIVES,
  ChartAggregateSchema,
  ChartDrillDownSchema,
  chartAggregateResultKeys,
  isRecordContextBlockType,
} from '@objectstack/spec/ui';
import { VALID_AST_OPERATORS } from '@objectstack/spec/data';
import {
  checkSearchableFieldList,
  indexObjectSearchTargets,
} from './validate-searchable-fields.js';
import {
  COMPONENT_FIELD_SPECS,
  checkFieldRefs,
  componentFieldRefs,
  fieldRefsFrom,
  indexObjectFields,
  sortFieldRefs,
  type FieldRef,
  type PageFieldFinding,
} from './validate-page-field-bindings.js';
// #5020's zod-rejection renderer, shared with the SDUI component-props gate
// since #5068 — see `zod-issue-format.ts` for why one copy matters here.
import { describeIssue } from './zod-issue-format.js';

import {
  SYSTEM_FIELDS,
  indexUnprovisionedAnchors,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';

// The TypeScript compiler must NOT be imported at module top level: it is
// ~9 MB of CJS (~70 ms+ to parse, worse on container cold starts), and
// @objectstack/lint sits on the kernel boot path — while this gate only runs
// when a `kind:'react'` page is actually validated (rare, trusted tier). An
// eager import also hard-crashes boot in deployments that prune the package
// from the image (cloud's Docker pruner did exactly that). So the compiler is
// loaded lazily, on first use, and stays a regular dependency in package.json.
// Guarded by lazy-deps.test.ts.
//
// `node:module` is a Node builtin, untouched by esbuild/tsup, so the static
// `createRequire` import survives bundling; the `createRequire(...)` call is
// deferred because `import.meta.url` is rewritten to an empty stub in the CJS
// build (same pattern as driver-sqlite-wasm's knex-wasm-dialect).
let cachedTs: typeof ts | null = null;
function loadTypeScript(): typeof ts {
  if (cachedTs) return cachedTs;
  const anchor =
    typeof import.meta !== 'undefined' && import.meta.url
      ? import.meta.url
      : typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/';
  try {
    cachedTs = createRequire(anchor)('typescript') as typeof ts;
  } catch (err) {
    throw new Error(
      `@objectstack/lint: validating a kind:'react' page requires the "typescript" package, which could not be loaded ` +
        `(${err instanceof Error ? err.message : String(err)}). It is a declared dependency of @objectstack/lint — ` +
        `if this deployment prunes packages, keep "typescript" in the image; it is only loaded when a react-source page is validated.`,
    );
  }
  return cachedTs;
}

export type ReactPropSeverity = 'error' | 'warning';

export interface ReactPropFinding {
  severity: ReactPropSeverity;
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;
const asArray = (v: unknown): AnyRec[] => (Array.isArray(v) ? (v as AnyRec[]) : []);

interface BlockSpec {
  requiredBindings: string[];
  knownProps: Set<string>;
}
const BLOCKS: Map<string, BlockSpec> = new Map(
  (REACT_BLOCKS as Array<{ tag: string; interactions: Array<{ name: string; required?: boolean }> }>).map((b) => [
    b.tag,
    {
      requiredBindings: b.interactions.filter((i) => i.required).map((i) => i.name),
      knownProps: new Set(b.interactions.map((i) => i.name)),
    },
  ]),
);

function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

function nearestKnown(prop: string, known: Set<string>): string | null {
  if (known.has(prop)) return null;
  let best: string | null = null;
  let bestD = 3;
  for (const k of known) {
    const d = editDistance(prop, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= 2 ? best : null;
}

// ─── Static attribute values ──────────────────────────────────────────────
//
// The gate above only needed prop NAMES. Checking a binding needs its VALUE,
// and a JSX attribute's value is an arbitrary expression. `NOT_STATIC` is the
// sentinel for "this expression is not knowable at build time" — distinct from
// a literal `undefined`, which IS knowable.

const NOT_STATIC = Symbol('not-static');

/** Evaluate a JSX expression to a plain JS value, or `NOT_STATIC`. */
function staticValue(tsc: typeof ts, sf: ts.SourceFile, node: ts.Node | undefined): unknown {
  if (!node) return NOT_STATIC;
  if (tsc.isParenthesizedExpression(node)) return staticValue(tsc, sf, node.expression);
  if (tsc.isStringLiteral(node) || tsc.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (tsc.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === tsc.SyntaxKind.TrueKeyword) return true;
  if (node.kind === tsc.SyntaxKind.FalseKeyword) return false;
  if (node.kind === tsc.SyntaxKind.NullKeyword) return null;
  if (tsc.isArrayLiteralExpression(node)) {
    const out: unknown[] = [];
    for (const el of node.elements) {
      const v = staticValue(tsc, sf, el);
      if (v === NOT_STATIC) return NOT_STATIC;
      out.push(v);
    }
    return out;
  }
  if (tsc.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const p of node.properties) {
      // A shorthand (`{ field }`) or spread (`{ ...cfg }`) hides its value.
      if (!tsc.isPropertyAssignment(p)) return NOT_STATIC;
      const key = tsc.isIdentifier(p.name) || tsc.isStringLiteral(p.name) ? p.name.text : null;
      if (key === null) return NOT_STATIC;
      const v = staticValue(tsc, sf, p.initializer);
      if (v === NOT_STATIC) return NOT_STATIC;
      out[key] = v;
    }
    return out;
  }
  return NOT_STATIC;
}

/** The static value of one JSX attribute (`x="s"` or `x={…}`), or `NOT_STATIC`. */
function attrValue(tsc: typeof ts, sf: ts.SourceFile, attr: ts.JsxAttribute): unknown {
  const init = attr.initializer;
  if (!init) return true; // bare `showLegend` — JSX shorthand for `={true}`
  if (tsc.isStringLiteral(init)) return init.text;
  if (tsc.isJsxExpression(init)) return staticValue(tsc, sf, init.expression);
  return NOT_STATIC;
}

/**
 * The value of a FILTER attribute, resolved position by position: an array
 * literal survives even when some of its elements do not, each unknowable
 * element left as `NOT_STATIC` in place.
 *
 * `staticValue` collapses such an array to `NOT_STATIC` whole, which is correct
 * where the value only means something entire (an `aggregate={{…}}`) and wrong
 * for a filter, whose positions are independent: `['status', '=', stage]` has a
 * knowable FIELD beside an unknowable VALUE, and that is the shape a react page
 * writes when it drives a list from React state. See `filterFieldRefs`.
 */
function filterAttrValue(tsc: typeof ts, sf: ts.SourceFile, attr: ts.JsxAttribute): unknown {
  const init = attr.initializer;
  if (!init || !tsc.isJsxExpression(init)) return NOT_STATIC;
  const perPosition = (node: ts.Node | undefined): unknown => {
    if (!node) return NOT_STATIC;
    if (tsc.isParenthesizedExpression(node)) return perPosition(node.expression);
    if (tsc.isArrayLiteralExpression(node)) return node.elements.map((el) => perPosition(el));
    return staticValue(tsc, sf, node);
  };
  return perPosition(init.expression);
}

// ─── <ObjectChart> binding integrity (#3701) ──────────────────────────────
//
// `validate-chart-bindings` covers every DATASET-bound chart surface: a
// dataset declares its dimensions/measures by NAME, result rows are keyed by
// those names, and an axis is checked against them. The react `<ObjectChart>`
// block was excluded because it is OBJECT-bound — `objectName` + an inline
// `aggregate` — and nothing said what the aggregated result columns were
// called, so `xAxisKey`/`series[].dataKey` had nothing to resolve against.
//
// #3701 closed that: `chartAggregateResultKeys` in @objectstack/spec/ui now
// records the convention every renderer already implements (rows keyed by the
// RAW FIELD NAMES — `groupBy` for the category, `field` for the value, the
// literal `'count'` for a fieldless count). With the columns pinned, both
// halves of the binding are checkable:
//
//   * `aggregate.field` / `aggregate.groupBy` are RAW FIELD names → check them
//     against the object's declared fields.
//   * the axes are RESULT COLUMN names → check them against what this
//     aggregate produces.
//
// The axes are read in the SPEC spelling — `xAxis.field`, `yAxis[].field`,
// `series[].name` (#3729). #3701 had to read `xAxisKey`/`series[].dataKey`
// because those were the only spellings the renderer honored; objectui#2880
// made it honor ChartConfig, so the gate follows the protocol again. The
// internal spellings are still accepted, silently: dashboards and the console's
// own chart-view wiring emit them, and they remain a valid (if unpublished)
// way to write the same binding.

export const REACT_CHART_FIELD_UNKNOWN = 'react-chart-field-unknown';
export const REACT_CHART_FIELD_UNPROVISIONED = 'react-chart-field-unprovisioned';
export const REACT_CHART_AGGREGATE_INVALID = 'react-chart-aggregate-invalid';
export const REACT_CHART_AXIS_UNKNOWN = 'react-chart-axis-unknown';
export const REACT_CHART_DRILLDOWN_INVALID = 'react-chart-drilldown-invalid';

/**
 * `<ObjectChart drillDown={{…}}>` against `ChartDrillDownSchema` (#5022).
 *
 * The block's segment drill is the one react-tier prop whose whole VALUE is a
 * declared protocol shape, so this is the gate that makes `declared = enforced`
 * true for it: without a parse, a strict schema is just a type — `.strict()` is
 * a property of a parse, and nothing else on this surface calls one.
 *
 * Only a fully static object literal is judged. `staticValue` collapses an
 * object to `NOT_STATIC` when ANY member is unresolvable, which is the right
 * conservatism here: a `filter` built from React state makes the surrounding
 * keys unknowable too, and an unresolvable binding is not a wrong one
 * (ADR-0072 D1).
 */
function checkChartDrillDown(
  raw: unknown,
  push: (severity: ReactPropSeverity, rule: string, message: string, hint: string) => void,
): void {
  if (raw === undefined || raw === NOT_STATIC) return;
  if (!isRec(raw)) {
    push(
      'error',
      REACT_CHART_DRILLDOWN_INVALID,
      `drillDown must be a configuration object, not ${Array.isArray(raw) ? 'an array' : typeof raw}.`,
      "Write drillDown={{ … }} — or, to turn the drill on with all defaults, drillDown={{}}. Omit the prop entirely to leave drill off.",
    );
    return;
  }
  const parsed = ChartDrillDownSchema.safeParse(raw);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    const at = issue.path.length ? `drillDown.${issue.path.join('.')}` : 'drillDown';
    push(
      'error',
      REACT_CHART_DRILLDOWN_INVALID,
      `${at}: ${issue.message}`,
      'The drill config is declared by ChartDrillDownSchema (@objectstack/spec/ui) — the rejection above carries the fix.',
    );
  }
}

/**
 * `<ObjectChart aggregate={{…}}>` against `ChartAggregateSchema` (#5020).
 *
 * The second half of what #5022 started one prop over. This rule used to
 * RE-DERIVE the aggregate's declaration: a local `CHART_FUNCTIONS` copy of the
 * function vocabulary and a hand-written twin of the schema's count/field
 * refinement. Two implementations of one contract that could drift apart
 * independently, and — because unknown-key handling is a property of a PARSE,
 * not of a list of `if`s — a gate that never checked for unknown keys at all.
 * `groupby` for `groupBy` sailed straight through it, the aggregate degraded to
 * ungrouped, and the chart drew axes and a single point with `build`/`validate`
 * fully green (#4001's original failure mode, on the react tier). Parsing makes
 * the schema the single source: the vocabulary, the refinement message and every
 * key's type arrive from `packages/spec` with nothing restated here.
 *
 * ## The unknown-key half, closed at #5583
 *
 * Until #5583 `ChartAggregateSchema` was a STRIP-posture `z.object()` (and
 * `ChartGroupBySchema`'s object arm with it), so an unknown key was *silently
 * dropped by the parse* and this gate had nothing to report. Wiring the parse
 * was the precondition, not the closing — `.strict()` is a property of a parse,
 * and until #5020 there was no parse to make strict. Both are `strictObject`
 * now, so `groupby` arrives here as an `unrecognized_keys` issue carrying the
 * schema's own surface name and rename suggestion, and this rule forwards it
 * verbatim rather than restating anything. The pin that used to record the
 * tolerance in `validate-react-page-props.test.ts` inverted with it.
 *
 * ⚠️ **The rejection reaches the author only because `describeIssue` unpacks
 * `invalid_union`.** An `unrecognized_keys` raised inside `groupBy`'s object arm
 * never reaches `error.issues`; zod 4 collapses the union into one issue whose
 * message is the bare string "Invalid input" (#5014). `zod-issue-format.ts` is
 * what recovers the arm messages, which is why the lint side had to exist before
 * the spec side closed.
 *
 * ## Severity is not uniform, and the split is measured
 *
 * Everything the schema, the published react-blocks type and objectui's
 * renderer agree on gates at `error` (declared = enforced): `function` present
 * and in the enum, `field` a string, `aggregate` an object, and a non-`count`
 * function carrying a `field`. **An absent `groupBy` is a `warning`**, alone
 * among them.
 *
 * #5583 ANSWERED the product question behind that split, and the answer was that
 * an ungrouped single-value chart is **not** a supported `<ObjectChart>` shape:
 * `groupBy` stays declared REQUIRED, because the single-value need is served by
 * the separate `object-metric` block and the renderer's
 * `schema.aggregate?.groupBy || schema.xAxisKey` reads are optional-chained on
 * `aggregate` itself — they serve charts with no aggregate at all, not ungrouped
 * ones. So the `warning` here is a TOLERANCE, not a blessing: it is deliberately
 * not upgraded to `error` in the same change, because promoting a gate is a
 * separate acceptance surface (every consumer's pages, not just the example
 * corpus, which carries zero instances). The upgrade is the follow-up; what must
 * not happen is this warning being read as "the platform supports this".
 */
function checkChartAggregate(
  raw: unknown,
  push: (severity: ReactPropSeverity, rule: string, message: string, hint: string) => void,
): void {
  if (raw === undefined || raw === NOT_STATIC) return;
  if (!isRec(raw)) {
    push(
      'error',
      REACT_CHART_AGGREGATE_INVALID,
      `aggregate must be a configuration object, not ${Array.isArray(raw) ? 'an array' : typeof raw}.`,
      'Write aggregate={{ function: "count", groupBy: "<field>" }} — or bind data={…} instead to chart precomputed rows.',
    );
    return;
  }

  // Absence is judged on the INPUT, not on the issue shape: zod reports a
  // missing `groupBy` as an `invalid_union` indistinguishable at a glance from a
  // wrongly-typed one, and the two get different severities here.
  const groupByAbsent = raw.groupBy === undefined;
  if (groupByAbsent) {
    push(
      'warning',
      REACT_CHART_AGGREGATE_INVALID,
      'aggregate.groupBy is not set, so the aggregate returns ONE ungrouped row and the chart plots a single point.',
      'Add aggregate.groupBy (a field name, or { field, dateGranularity } to bucket dates) to give the chart a category axis. ' +
        'objectstack#5583 ruled that an ungrouped single-value chart is NOT a supported <ObjectChart> shape — groupBy stays required, and a single number belongs in an object-metric block instead. ' +
        'This stays a warning rather than an error only because promoting it is its own step.',
    );
  }

  const parsed = ChartAggregateSchema.safeParse(raw);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    // Already reported above, at warning severity and with the renderer's
    // fallback explained — the raw union rejection would only repeat it as an
    // error and re-gate what this rule deliberately does not gate.
    if (groupByAbsent && issue.path[0] === 'groupBy') continue;
    const at = issue.path.length ? `aggregate.${issue.path.join('.')}` : 'aggregate';
    push(
      'error',
      REACT_CHART_AGGREGATE_INVALID,
      `${at}: ${describeIssue(issue, raw)}`,
      'The aggregate is declared by ChartAggregateSchema (@objectstack/spec/ui) — the rejection above carries the fix.',
    );
  }
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const strOf = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

interface ChartAttrs {
  /** Statically resolved attribute values, keyed by prop name. */
  values: Map<string, unknown>;
  where: string;
  path: string;
}

function checkObjectChart(
  attrs: ChartAttrs,
  objectFields: Map<string, Set<string>>,
  findings: ReactPropFinding[],
  // [#8340] `objectName -> its unprovisioned injected anchors`.
  unprovisionedAnchors: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): void {
  const { values, where, path } = attrs;
  const push = (severity: ReactPropSeverity, rule: string, message: string, hint: string) =>
    findings.push({ severity, rule, where, path, message, hint });

  // 0. `drillDown` — checked by PARSING the schema, not by re-deriving it.
  //
  // Runs before every early return below because the drill config is
  // independent of how the chart is bound: an inline `data={…}` chart drills
  // just as an aggregate-bound one does.
  //
  // This was the FIRST rule in this file to parse its schema instead of
  // restating the vocabulary in local constants; `aggregate` next door was the
  // counter-example the strictness ledger's `chart.zod.ts` row named — a gate
  // that re-derives the rules cannot inherit the schema's unknown-key handling,
  // so `groupby` sailed through it — and #5020 converted it the same way.
  // Parsing inherits all of it for free: the surface name, the near-key
  // guidance, the `target` union. #5435 is the dividend — widening `target` to
  // admit `'navigate'` moved this gate with it, with nothing to edit here.
  checkChartDrillDown(values.get('drillDown'), push);

  // Inline `data` wins over the aggregate query: the columns then come from
  // the author's own rows, which this rule cannot see. Nothing further to say.
  if (values.has('data')) return;

  const aggregate = values.get('aggregate');

  // 1. The aggregate declaration itself — checked by PARSING the schema, not by
  //    re-deriving it (#5020). Runs before the early returns below so a
  //    non-object `aggregate` is reported rather than silently skipped.
  checkChartAggregate(aggregate, push);

  if (aggregate === undefined || aggregate === NOT_STATIC) return;
  if (!isRec(aggregate)) return;

  // The reads below are NOT a second judgement of the declaration: they feed the
  // two questions only this rule can answer — whether the names exist on the
  // bound object, and whether the axes name the columns the aggregate returns.
  const fn = strOf(aggregate.function);
  const field = strOf(aggregate.field);
  const groupBy = aggregate.groupBy;
  const groupByField = strOf(groupBy) ?? (isRec(groupBy) ? strOf(groupBy.field) : undefined);

  // 2. `field` / `groupBy` are RAW field names on the bound object.
  const objectName = strOf(values.get('objectName'));
  const known = objectName ? objectFields.get(objectName) : undefined;
  // No object name, or an object declared in another package: unknowable here
  // — the same skip the widget/flow/page rules take.
  if (objectName && known) {
    const anchors = unprovisionedAnchors.get(objectName);
    const fieldRef = (name: string | undefined, prop: string) => {
      if (!name) return;
      // A relationship path (`account.name`) is resolved by the query engine.
      if (name.includes('.')) return;
      if (known.has(name) || SYSTEM_FIELDS.has(name)) {
        // [#8340] The name resolves — the existence error stays silent and
        // `SYSTEM_FIELDS` keeps owning that decision — but an injected anchor
        // on an ADR-0015 `external` object has no column behind it. Aggregating
        // or grouping by one returns a single empty bucket rather than an
        // error, so the chart renders and says nothing true.
        if (anchors?.has(name)) {
          push(
            'warning',
            REACT_CHART_FIELD_UNPROVISIONED,
            `aggregate.${prop} "${name}" resolves on object "${objectName}", but ` +
              `${unprovisionedAnchorCause(objectName, name)} — the aggregate query reads a column ` +
              `that is empty on every row, so the chart ${prop === 'groupBy' ? 'groups everything into one empty bucket' : 'aggregates nothing'} ` +
              `instead of failing.`,
            unprovisionedAnchorHint(objectName, name),
          );
        }
        return;
      }
      push(
        'error',
        REACT_CHART_FIELD_UNKNOWN,
        `aggregate.${prop} "${name}" is not a field on object "${objectName}" — ` +
          `the aggregate query has nothing to ${prop === 'groupBy' ? 'group by' : 'aggregate'}, so the chart comes back empty.`,
        `Fix the field name, or add "${name}" to ${objectName}.` +
          (known.size > 0 ? ` Object fields: ${[...known].sort().join(', ')}.` : ''),
      );
    };
    fieldRef(field, 'field');
    fieldRef(groupByField, 'groupBy');
  }

  // 3. The axes name RESULT COLUMNS, not fields — the #3701 convention.
  const keys = chartAggregateResultKeys({ field, function: fn, groupBy });
  const columns = [keys.category, keys.value].filter((k): k is string => !!k);
  if (columns.length === 0) return; // an aggregate too incomplete to judge against

  const axisRef = (name: string | undefined, prop: string) => {
    if (!name) return;
    if (columns.includes(name)) return;
    // The comparison overlay's column only exists when `compareTo` is on, but
    // binding it is legitimate — never flag it as unknown.
    if (keys.comparison && name === keys.comparison) return;
    push(
      'error',
      REACT_CHART_AXIS_UNKNOWN,
      `"${name}" is not a column this aggregate returns, so the axis plots nothing. ` +
        `Object-bound aggregate rows are keyed by the RAW FIELD NAMES ` +
        `(unlike a dataset, whose rows are keyed by measure name).`,
      `Result columns: ${columns.join(', ')}` +
        (keys.comparison ? ` (plus "${keys.comparison}" with a comparison overlay)` : '') +
        `. Bind ${prop} to one of them.`,
    );
  };

  // The category axis: spec `xAxis: { field }`, the report surface's bare
  // string, or the internal `xAxisKey`. All three name the same column.
  const xAxisRaw = values.get('xAxis');
  const categoryAxis =
    strOf(values.get('xAxisKey')) ??
    strOf(xAxisRaw) ??
    (isRec(xAxisRaw) ? strOf(xAxisRaw.field) : undefined);
  const categoryProp = values.has('xAxisKey') ? 'xAxisKey' : 'xAxis.field';
  axisRef(categoryAxis, categoryProp);

  // The value axes: spec `yAxis: [{ field }]` (or a single object / bare
  // string) and spec `series: [{ name }]` / internal `series: [{ dataKey }]`.
  const yAxisRaw = values.get('yAxis');
  const yAxisList = Array.isArray(yAxisRaw) ? yAxisRaw : yAxisRaw !== undefined ? [yAxisRaw] : [];
  for (const a of yAxisList) {
    axisRef(strOf(a) ?? (isRec(a) ? strOf(a.field) : undefined), 'yAxis[].field');
  }

  const series = values.get('series');
  if (Array.isArray(series)) {
    for (const s of series) {
      if (!isRec(s)) continue;
      const dataKey = strOf(s.dataKey);
      axisRef(dataKey ?? strOf(s.name), dataKey ? 'series[].dataKey' : 'series[].name');
    }
  }

  // A category axis bound to anything but the groupBy is always wrong, and the
  // check above lets it through when it happens to equal the VALUE column.
  if (categoryAxis && keys.category && categoryAxis !== keys.category && categoryAxis === keys.value) {
    push(
      'error',
      REACT_CHART_AXIS_UNKNOWN,
      `${categoryProp} "${categoryAxis}" is the aggregate's VALUE column, not its category column.`,
      `The category axis is keyed by groupBy — bind it to "${keys.category}".`,
    );
  }
}

// ─── Field-bearing block props (#4340) ────────────────────────────────────
//
// #4329 closed ONE prop — `<ListView searchableFields>` — by running the
// metadata rule's core from here. `searchableFields` was an instance, not the
// class: every other prop a react block binds BY FIELD NAME shipped exactly as
// typed, the same silent drift `validate-page-field-bindings` closes for the
// page-component `properties` bag one surface over. This section closes the
// class.
//
// ## Where the answers come from
//
// `REACT_FIELD_SPECS` below describes the blocks whose metadata twin lives
// under different prop names — `<ListView>` (twin: a list page's
// `interfaceConfig`) and `<ObjectForm>` (twin: `element:form` + the
// form-layout rule) — plus `<ObjectChart>`'s `filter`.
//
// `COMPONENT_FIELD_SPECS`, the table `validate-page-field-bindings` walks on
// the metadata surface, is still read from here, keyed by `schemaType`, so a
// prop added there is checked on both surfaces at once. What reaches it is now
// only `<Block type="element:…">`: this rule read that table mainly for the
// `record:*` blocks, and #4413 withdrew those from the tier entirely (they
// render from a record context this surface does not mount — see
// `recordContextFinding` below). The table's `record:*` rows are not dead,
// they are simply the metadata surface's alone again.
//
// ## What is deliberately NOT checked, and why
//
//   - Anything non-static (a variable, a call, a value behind a spread) —
//     ADR-0072 D1: unresolvable is not wrong. `filters` is the one place this
//     is resolved PER POSITION rather than all-or-nothing; see below.
//   - `<ObjectChart>`'s axes: they name the aggregate's RESULT COLUMNS, not
//     fields, and `checkObjectChart` above already owns them.
//
// `<ObjectForm subforms>` does not ride the table either, but IS checked:
// each entry names its own `childObject`, so its refs are split per entry
// rather than pooled against the block's object (`subformFieldRefs`).

/**
 * Which props of a block carry field names, and in what shape. Each bucket is
 * a different SHAPE, not a different meaning — every entry resolves against the
 * block's own `objectName`.
 */
interface ReactFieldSpec {
  /** Bare names, `{field}`/`{name}` records, or arrays of either. */
  fields?: readonly string[];
  /** A `sort`: structured `{field,order}[]` or the legacy `"field desc"` string. */
  sorts?: readonly string[];
  /** A `{ fields: […] }` wrapper — one level of nesting. */
  nestedFields?: readonly string[];
  /** `{…}[]` sections whose `fields[]` name fields. */
  sections?: readonly string[];
  /** An object literal whose KEYS name fields. */
  keyedByField?: readonly string[];
  /** An ObjectQL FilterArray — its field POSITIONS gate (see `filterFieldRefs`). */
  filterArrays?: readonly string[];
}

const REACT_FIELD_SPECS: Readonly<Record<string, ReactFieldSpec>> = {
  ListView: {
    // `fields` is the React overlay's "limit/order the columns"; `columns` the
    // spec ListView prop. Both name columns on the bound object, and a page may
    // write either. `hiddenFields`/`fieldOrder`/`filterableFields` are schema
    // props outside the curated contract — unadvertised but honored by the
    // renderer, so a stale name there is drift just the same.
    fields: ['fields', 'columns', 'hiddenFields', 'fieldOrder', 'filterableFields'],
    sorts: ['sort'],
    nestedFields: ['userFilters', 'grouping'],
    filterArrays: ['filters'],
  },
  ObjectForm: {
    fields: ['fields'],
    keyedByField: ['initialValues'],
    // `groups` is FormViewSchema's legacy alias for `sections`.
    sections: ['sections', 'groups'],
  },
  ObjectChart: {
    // The axes are result columns (checkObjectChart owns them); `filter` is an
    // ordinary ObjectQL predicate over the bound object, like ListView's.
    filterArrays: ['filter'],
  },
};

/**
 * How a prop name joins onto a react page's `path`. The props live inside one
 * opaque `source` string, so there is no config path to extend — #4329
 * established `pages[0].source › searchableFields[1]` and every prop below
 * follows it.
 */
const PATH_SEP = ' › ';

/** tag → `schemaType`, read from the contract rather than restated. */
const SCHEMA_TYPE_BY_TAG: ReadonlyMap<string, string> = new Map(
  (REACT_BLOCKS as Array<{ tag: string; schemaType: string }>).map((b) => [b.tag, b.schemaType]),
);

/**
 * Attribute names read POSITION BY POSITION rather than all-or-nothing (see
 * `filterAttrValue`). Derived from the specs so a new `filterArrays` entry
 * cannot forget to opt in — the failure mode would be silent, since the
 * all-or-nothing reader simply finds nothing.
 *
 * `<RecordRelatedList filter>` rides along under the same name while holding a
 * different shape (`{field, operator, value}[]`, not a FilterArray). That is
 * harmless: a fully-static array reads identically either way, and the only
 * difference — surviving with `NOT_STATIC` holes — is dropped by
 * `fieldRefsFrom`, which ignores a non-string, non-record entry.
 */
const FILTER_PROPS: ReadonlySet<string> = new Set(
  Object.values(REACT_FIELD_SPECS).flatMap((s) => s.filterArrays ?? []),
);

/** Strip the `NOT_STATIC` sentinel so a shared extractor sees plain data. */
function readableProps(values: ReadonlyMap<string, unknown>): AnyRec {
  const out: AnyRec = {};
  for (const [k, v] of values) if (v !== NOT_STATIC) out[k] = v;
  return out;
}

/**
 * `<ObjectForm subforms>` — inline master-detail child collections. Each entry
 * names the object its own refs resolve against (`childObject`), so unlike
 * every bucket in {@link ReactFieldSpec} these cannot be pooled into one batch
 * checked against the block's `objectName`. `totalField` is the exception
 * inside the exception: it names the PARENT field the child sum rolls up into.
 */
function subformFieldRefs(
  value: unknown,
  basePath: string,
): { child: Array<{ objectName: string | undefined; refs: FieldRef[] }>; parent: FieldRef[] } {
  const child: Array<{ objectName: string | undefined; refs: FieldRef[] }> = [];
  const parent: FieldRef[] = [];
  if (!Array.isArray(value)) return { child, parent };
  for (let i = 0; i < value.length; i++) {
    const sub = value[i];
    if (!isRec(sub)) continue;
    const at = (key: string) => `${basePath}[${i}].${key}`;
    child.push({
      objectName: strOf(sub.childObject),
      refs: [
        ...fieldRefsFrom(sub.columns, at('columns')),
        ...fieldRefsFrom(sub.relationshipField, at('relationshipField')),
        ...fieldRefsFrom(sub.amountField, at('amountField')),
      ],
    });
    parent.push(...fieldRefsFrom(sub.totalField, at('totalField')));
  }
  return { child, parent };
}

/**
 * Field references in an ObjectQL FilterArray, resolved PER POSITION.
 *
 * `staticValue` is all-or-nothing by design: an array containing one unknowable
 * element is not a knowable array. That is right for an `aggregate={{…}}`, and
 * wrong here, because the common react filter is exactly the mixed case —
 * `filters={['status', '=', stage]}` pairs a STATIC field position with a
 * React-state value. Bailing on the whole array would skip the only position
 * this rule can judge, on the shape authors actually write.
 *
 * So the reader keeps each position separate (`filterAttrValue`) and this walk
 * only ever reads position 0, and only when position 1 is a recognised operator
 * — the same test `isFilterAST` makes, using the spec's own operator vocabulary
 * so the two cannot drift. A non-static field position, a non-static operator,
 * or a shape that is not a filter node yields nothing.
 */
function filterFieldRefs(node: unknown, basePath: string, out: FieldRef[]): void {
  if (!Array.isArray(node) || node.length === 0) return;
  const head = node[0];
  if (typeof head === 'string' && (head.toLowerCase() === 'and' || head.toLowerCase() === 'or')) {
    for (let i = 1; i < node.length; i++) filterFieldRefs(node[i], `${basePath}[${i}]`, out);
    return;
  }
  // Legacy flat array of conditions: `[[a,'=',1], [b,'>',2]]`.
  if (Array.isArray(head)) {
    for (let i = 0; i < node.length; i++) filterFieldRefs(node[i], `${basePath}[${i}]`, out);
    return;
  }
  if (
    typeof head === 'string' && head.length > 0 &&
    node.length >= 2 && typeof node[1] === 'string' &&
    VALID_AST_OPERATORS.has(node[1].toLowerCase())
  ) {
    out.push({ name: head, path: `${basePath}[0]` });
  }
}

/** The field refs one block's statically-read attributes hold, by bucket. */
function reactFieldRefs(
  spec: ReactFieldSpec,
  values: ReadonlyMap<string, unknown>,
  basePath: string,
): { own: FieldRef[]; queried: FieldRef[] } {
  const own: FieldRef[] = [];
  const queried: FieldRef[] = [];
  const readable = (key: string): unknown => {
    const v = values.get(key);
    return v === NOT_STATIC ? undefined : v;
  };
  const at = (key: string) => `${basePath}${PATH_SEP}${key}`;

  for (const key of spec.fields ?? []) {
    own.push(...fieldRefsFrom(readable(key), at(key)));
  }
  for (const key of spec.sorts ?? []) {
    own.push(...sortFieldRefs(readable(key), at(key)));
  }
  for (const key of spec.nestedFields ?? []) {
    const v = readable(key);
    if (isRec(v)) own.push(...fieldRefsFrom(v.fields, at(`${key}.fields`)));
  }
  for (const key of spec.sections ?? []) {
    const v = readable(key);
    if (!Array.isArray(v)) continue;
    for (let i = 0; i < v.length; i++) {
      const section = v[i];
      if (!isRec(section)) continue;
      own.push(...fieldRefsFrom(section.fields, at(`${key}[${i}].fields`)));
    }
  }
  for (const key of spec.keyedByField ?? []) {
    const v = readable(key);
    if (!isRec(v)) continue;
    for (const k of Object.keys(v)) own.push({ name: k, path: at(`${key}.${k}`) });
  }
  for (const key of spec.filterArrays ?? []) {
    // Read the raw attribute here, NOT `readable`: a filter whose VALUE is
    // non-static still has a knowable field position, and `filterAttrValue`
    // preserved exactly that.
    filterFieldRefs(values.get(key), at(key), queried);
  }
  return { own, queried };
}

/**
 * Resolve every field-bearing prop of one block usage against its bound object.
 *
 * Three sources feed it, in the order a block can claim them:
 *
 *   1. `REACT_FIELD_SPECS` — the react-only descriptors (`ListView`,
 *      `ObjectForm`, `ObjectChart`'s `filter`).
 *   2. `COMPONENT_FIELD_SPECS`, keyed by the block's `schemaType` — the shared
 *      table the metadata surface already uses. `<Block type="…">` reaches it
 *      by the type the author wrote, which is what makes the escape hatch
 *      checked rather than a hole.
 *
 * Findings come back in this rule's own shape but under the metadata rule's id
 * (`page-field-unknown`): the same question, asked of the same component, with
 * the same fix.
 */
function checkBlockFieldProps(
  tag: string,
  values: ReadonlyMap<string, unknown>,
  objectFields: ReadonlyMap<string, Set<string>>,
  where: string,
  path: string,
  // [#8340] Threaded straight through to the shared `checkFieldRefs` core —
  // this surface asks the same two questions of the same refs as the metadata
  // one, so it must hand over the same index rather than answer differently.
  unprovisionedAnchors?: ReadonlyMap<string, ReadonlySet<string>>,
): ReactPropFinding[] {
  const objectName = strOf(values.get('objectName'));
  const out: PageFieldFinding[] = [];

  const spec = REACT_FIELD_SPECS[tag];
  if (spec) {
    const { own, queried } = reactFieldRefs(spec, values, path);
    out.push(
      ...checkFieldRefs(own, objectName, objectFields, where, 'skipped', unprovisionedAnchors),
    );
    out.push(
      ...checkFieldRefs(queried, objectName, objectFields, where, 'queried', unprovisionedAnchors),
    );
  }

  if (tag === 'ObjectForm') {
    const raw = values.get('subforms');
    const subs = subformFieldRefs(raw === NOT_STATIC ? undefined : raw, `${path}${PATH_SEP}subforms`);
    for (const sub of subs.child) {
      out.push(
        ...checkFieldRefs(sub.refs, sub.objectName, objectFields, where, 'skipped', unprovisionedAnchors),
      );
    }
    // `totalField` names the FORM object's field the child sum rolls up into.
    out.push(
      ...checkFieldRefs(subs.parent, objectName, objectFields, where, 'skipped', unprovisionedAnchors),
    );
  }

  // `<Block type="element:form">` renders the registered component the author
  // names; every other block's type is fixed by its tag. A `record:*` type
  // never arrives here — `recordContextFinding` rejected it upstream.
  const schemaType = tag === 'Block' ? strOf(values.get('type')) : SCHEMA_TYPE_BY_TAG.get(tag);
  if (schemaType && COMPONENT_FIELD_SPECS[schemaType]) {
    out.push(
      ...checkFieldRefs(
        componentFieldRefs(schemaType, readableProps(values), path, PATH_SEP) ?? [],
        objectName,
        objectFields,
        where,
        'skipped',
        unprovisionedAnchors,
      ),
    );
  }

  // The two finding shapes are structurally identical; `where`/`path` are
  // already this surface's, so only the declared type differs.
  return out as ReactPropFinding[];
}

// ─── The `record:*` family is not of this surface (#4413) ─────────────────
//
// Every `record:*` renderer takes its record from the context a RECORD PAGE
// mounts once (`RecordDetailView` fetches, N blocks render it, and they
// coordinate through it — highlights dedupe out of the detail grid, one
// inline-edit save bar commits them all under one version). A `kind:'react'`
// page mounts no such context: `useRecordContext()` returns null, and each
// block renders its designer placeholder — or, for `record:related_list`,
// refuses to fetch because the parent id never arrives.
//
// The react tier had published `objectName`/`recordId` on four of them anyway
// and no renderer read either, so a page authored exactly to contract rendered
// EMPTY with nothing reported anywhere — including by this file, which
// cheerfully resolved those props' field names against the object they named.
// #4413 withdrew the props (see the ledger in `@objectstack/spec/ui`); this
// turns what was a silent blank into a publish-time error, which is the half
// that keeps an AI author from writing them again from memory.
//
// The check is by TYPE, not by the withdrawn tag list: the scope objectui
// injects is built from the whole public registry, so every `record:*`
// component — including the six that were never in the contract
// (`record:activity`, `record:chatter`, …) — is reachable here and equally
// empty. `<Block type="record:…">` is the same reach with the type spelled out.

export const REACT_BLOCK_NEEDS_RECORD_CONTEXT = 'react-block-needs-record-context';

const RECORD_BLOCK_GENERIC_FIX =
  'author the page as `type:\'record\'` — a record page mounts the record context these blocks render from.';

function recordContextFinding(
  tag: string,
  schemaType: string,
  where: string,
  path: string,
): ReactPropFinding {
  return {
    severity: 'error',
    rule: REACT_BLOCK_NEEDS_RECORD_CONTEXT,
    where,
    path,
    message:
      `<${tag}> renders "${schemaType}", which reads its record from the record context a ` +
      `record page mounts — a kind:'react' page never mounts one, so the block renders empty ` +
      `no matter how it is bound (its objectName/recordId are not read by the renderer).`,
    hint:
      `On a react page bind the record yourself: ` +
      `${REACT_RECORD_BLOCK_ALTERNATIVES[schemaType] ?? RECORD_BLOCK_GENERIC_FIX}`,
  };
}

/**
 * Names the page source binds itself — every function/variable declaration,
 * at any depth (a react page declares its helper components INSIDE `Page`).
 *
 * A local declaration SHADOWS the injected scope, so `const RecordPath = …`
 * followed by `<RecordPath/>` is the author's own component and none of this
 * rule's business. Cheap to honor and it removes the whole false-positive
 * class from a gate that BLOCKS a publish — the older prop checks above are
 * left alone deliberately: they only ever warn about a near-miss prop name or
 * a missing required one, which is survivable advice on a shadowed tag.
 */
function localComponentNames(tsc: typeof ts, sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const walk = (node: ts.Node): void => {
    if (tsc.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    else if (tsc.isVariableDeclaration(node) && tsc.isIdentifier(node.name)) names.add(node.name.text);
    else if (tsc.isImportSpecifier(node)) names.add(node.name.text);
    tsc.forEachChild(node, walk);
  };
  walk(sf);
  return names;
}

export function validateReactPageProps(stack: AnyRec): ReactPropFinding[] {
  const findings: ReactPropFinding[] = [];
  const objectFields = indexObjectFields(stack);
  // [#8340] The provenance index alongside the existence one — same keying,
  // asked on the path where the existence check stays silent.
  const unprovisionedAnchors = indexUnprovisionedAnchors(stack);
  // A separate index for the searchableFields check, built by the metadata
  // rule's own indexer: it keeps `null` for an object with no authored field
  // map (external / datasource-introspected), a distinction `indexObjectFields`
  // flattens — and one this check must honor so both surfaces skip alike.
  const searchTargets = indexObjectSearchTargets(stack);
  const pages = asArray(stack.pages);
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    if (!page || page.kind !== 'react') continue;
    const source = page.source;
    if (typeof source !== 'string' || source.trim() === '') continue;
    const name = String(page.name ?? `#${p}`);

    // Outside the try below on purpose: a missing compiler must surface as an
    // error, not be swallowed as "unparseable source".
    const tsc = loadTypeScript();

    let sf: ts.SourceFile;
    try {
      sf = tsc.createSourceFile('page.tsx', source, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TSX);
    } catch {
      continue; // the syntax gate reports unparseable sources
    }

    const locals = localComponentNames(tsc, sf);

    const visit = (node: ts.Node): void => {
      if (tsc.isJsxOpeningElement(node) || tsc.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sf);
        const where = `page "${name}" › <${tag}>`;
        const path = `pages[${p}].source`;
        // A withdrawn `record:*` block, reached by its injected tag. Reported
        // and then dropped: the prop checks below have nothing useful to add
        // about a block that cannot render here at all.
        const recordType = RECORD_CONTEXT_BLOCK_TAGS.get(tag);
        if (recordType && !locals.has(tag)) {
          findings.push(recordContextFinding(tag, recordType, where, path));
          tsc.forEachChild(node, visit);
          return;
        }
        const block = BLOCKS.get(tag);
        if (block) {
          let hasSpread = false;
          const used = new Set<string>();
          const values = new Map<string, unknown>();
          for (const a of node.attributes.properties) {
            if (tsc.isJsxSpreadAttribute(a)) { hasSpread = true; continue; }
            if (tsc.isJsxAttribute(a)) {
              const propName = a.name.getText(sf);
              used.add(propName);
              values.set(
                propName,
                FILTER_PROPS.has(propName)
                  ? filterAttrValue(tsc, sf, a)
                  : attrValue(tsc, sf, a),
              );
            }
          }
          // The escape hatch reaches the same withdrawn components by type —
          // `<Block type="record:highlights">` is `<RecordHighlights>` spelled
          // out, and just as empty. Checked here rather than by tag because
          // the type is an attribute VALUE (and a non-static one is
          // unresolvable, not wrong — ADR-0072 D1).
          if (tag === 'Block') {
            const blockType = strOf(values.get('type'));
            if (blockType && isRecordContextBlockType(blockType)) {
              findings.push(recordContextFinding(tag, blockType, where, path));
              tsc.forEachChild(node, visit);
              return;
            }
          }
          if (!hasSpread) {
            for (const req of block.requiredBindings) {
              if (!used.has(req)) {
                findings.push({
                  severity: 'error',
                  rule: 'react-prop-missing-required',
                  where, path,
                  message: `<${tag}> is missing the required prop "${req}".`,
                  hint: `Pass ${req}={…}. See the react-tier component contract.`,
                });
              }
            }
          }
          for (const u of used) {
            const near = nearestKnown(u, block.knownProps);
            if (near) {
              findings.push({
                severity: 'warning',
                rule: 'react-prop-typo',
                where, path,
                message: `<${tag}> has prop "${u}" — did you mean "${near}"?`,
                hint: 'Likely a typo of a contract prop. Fix it or remove it.',
              });
            }
          }
          // A spread can supply any of the bindings below, so the values we
          // can see are an incomplete picture — skip rather than guess.
          if (tag === 'ObjectChart' && !hasSpread) {
            checkObjectChart({ values, where, path }, objectFields, findings, unprovisionedAnchors);
          }
          // <ListView searchableFields> names fields on the bound object — the
          // react-surface twin of `searchable-field-unknown` (#4329) and, as a
          // view-level narrowing echoed to the runtime as `$searchFields`, of
          // `searchable-field-unsearchable` too (#4830, the checker's default
          // role). It runs the metadata rule's own core, so the skips
          // (cross-package object, no authored field map, system columns) and
          // the dotted-path strictness match by construction. A non-static
          // value — either attribute — bails inside the checker: unresolvable
          // is not wrong.
          if (tag === 'ListView' && !hasSpread) {
            findings.push(
              ...checkSearchableFieldList(
                values.get('searchableFields'),
                strOf(values.get('objectName')),
                searchTargets,
                where,
                `${path} › searchableFields`,
                'searchableFields',
              ),
            );
          }
          // Every other field-bearing prop (#4340). Same skips as the chart
          // and searchableFields checks: a spread hides the picture, and a
          // non-static value is unresolvable rather than wrong.
          if (!hasSpread) {
            findings.push(
              ...checkBlockFieldProps(tag, values, objectFields, where, path, unprovisionedAnchors),
            );
          }
        }
      }
      tsc.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

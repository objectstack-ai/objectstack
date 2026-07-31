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
//
// Reading values is opt-in per block and per prop: everything below evaluates
// only STATIC literals (`objectName="invoice"`, an `aggregate={{…}}` object
// literal). A value that comes from a variable, a call, or a spread is not
// knowable at build time and is skipped silently — an unresolvable binding is
// not a wrong one (ADR-0072 D1).

import { createRequire } from 'node:module';
import type ts from 'typescript';
import { REACT_BLOCKS, chartAggregateResultKeys } from '@objectstack/spec/ui';
import {
  checkSearchableFieldList,
  indexObjectSearchTargets,
} from './validate-searchable-fields.js';

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
export const REACT_CHART_AGGREGATE_INVALID = 'react-chart-aggregate-invalid';
export const REACT_CHART_AXIS_UNKNOWN = 'react-chart-axis-unknown';

const CHART_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;

/**
 * Registry-injected fields present on (almost) every object but absent from
 * `object.fields`. Same set as `validate-page-field-bindings`, for the same
 * reason: over-inclusion costs at worst a missed finding, under-inclusion
 * costs a false one.
 */
const SYSTEM_FIELDS = new Set<string>([
  'id',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'owner_id', 'organization_id', 'tenant_id', 'user_id',
  'deleted_at',
]);

/**
 * Both `objects` and an object's `fields` are authored either as an array of
 * `{ name }` records or as a name-keyed map — normalize to the array form, the
 * same way the other reference-integrity rules do.
 */
function namedArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter((x): x is AnyRec => !!x && typeof x === 'object');
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({
      name,
      ...(def && typeof def === 'object' ? (def as AnyRec) : {}),
    }));
  }
  return [];
}

/** object name → its declared field names. */
function indexObjectFields(stack: AnyRec): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const obj of namedArray(stack.objects)) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const names = new Set<string>();
    for (const f of namedArray(obj.fields)) {
      if (typeof f.name === 'string' && f.name) names.add(f.name);
    }
    out.set(name, names);
  }
  return out;
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
): void {
  const { values, where, path } = attrs;
  const push = (severity: ReactPropSeverity, rule: string, message: string, hint: string) =>
    findings.push({ severity, rule, where, path, message, hint });

  // Inline `data` wins over the aggregate query: the columns then come from
  // the author's own rows, which this rule cannot see. Nothing further to say.
  if (values.has('data')) return;

  const aggregate = values.get('aggregate');
  if (aggregate === undefined || aggregate === NOT_STATIC) return;
  if (!isRec(aggregate)) return;

  const fn = strOf(aggregate.function);
  const field = strOf(aggregate.field);
  const groupBy = aggregate.groupBy;
  const groupByField = strOf(groupBy) ?? (isRec(groupBy) ? strOf(groupBy.field) : undefined);

  // 1. The aggregate declaration itself.
  if (fn && !(CHART_FUNCTIONS as readonly string[]).includes(fn)) {
    push(
      'error',
      REACT_CHART_AGGREGATE_INVALID,
      `aggregate.function "${fn}" is not an aggregation this chart can run.`,
      `Use one of: ${CHART_FUNCTIONS.join(', ')}.`,
    );
  } else if (fn && fn !== 'count' && !field) {
    push(
      'error',
      REACT_CHART_AGGREGATE_INVALID,
      `aggregate.function "${fn}" has no "field" to aggregate.`,
      'Add aggregate.field, or use function "count" (the only one that may omit it).',
    );
  }

  // 2. `field` / `groupBy` are RAW field names on the bound object.
  const objectName = strOf(values.get('objectName'));
  const known = objectName ? objectFields.get(objectName) : undefined;
  // No object name, or an object declared in another package: unknowable here
  // — the same skip the widget/flow/page rules take.
  if (objectName && known) {
    const fieldRef = (name: string | undefined, prop: string) => {
      if (!name) return;
      // A relationship path (`account.name`) is resolved by the query engine.
      if (name.includes('.')) return;
      if (known.has(name) || SYSTEM_FIELDS.has(name)) return;
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

export function validateReactPageProps(stack: AnyRec): ReactPropFinding[] {
  const findings: ReactPropFinding[] = [];
  const objectFields = indexObjectFields(stack);
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

    const visit = (node: ts.Node): void => {
      if (tsc.isJsxOpeningElement(node) || tsc.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sf);
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
              values.set(propName, attrValue(tsc, sf, a));
            }
          }
          const where = `page "${name}" › <${tag}>`;
          const path = `pages[${p}].source`;
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
            checkObjectChart({ values, where, path }, objectFields, findings);
          }
          // <ListView searchableFields> names fields on the bound object — the
          // react-surface twin of `searchable-field-unknown` (#4329). It runs
          // the metadata rule's own core, so the skips (cross-package object,
          // no authored field map, system columns) and the dotted-path
          // strictness match by construction. A non-static value — either
          // attribute — bails inside the checker: unresolvable is not wrong.
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
        }
      }
      tsc.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

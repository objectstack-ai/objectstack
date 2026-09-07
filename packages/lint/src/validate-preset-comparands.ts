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
import { indexObjectGraph, recordsOf, resolveFieldPath, type ObjectGraph } from './object-graph.js';

/**
 * Build-time refusal of a bare dashboard date-range PRESET name authored as a
 * filter comparand — two arms, one wording.
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
 * ## Arm 1 — ordering positions, FIELD-AGNOSTIC (#8793)
 *
 * The judgement rides on POSITION alone, exactly as the schema door's #8793
 * note lays out at length:
 *
 * - **Judged:** `$gt` / `$gte` / `$lt` / `$lte` comparands and `$between`
 *   endpoints (Mongo shape); `>` / `>=` / `<` / `<=` / `between` triples and
 *   every alias `canonicalAstOperator` folds onto them (`gt`, `after`, …);
 *   `greater_than` / `less_than` / `greater_than_or_equal` /
 *   `less_than_or_equal` / `before` / `after` / `between` view filter rules
 *   and every alias `normalizeFilterOperator` folds onto them. An ORDERED
 *   comparison against a declared preset name has no legitimate reading on
 *   ANY column, so no field type is needed to refuse it.
 * - **Only the 13 declared names.** A near-miss (`last_60_days`) is not this
 *   rule's business — on a temporal field the engine's field-typed door
 *   catches it; judging undeclared strings here would be a guessed superset.
 *
 * ## Arm 2 — equality and membership positions, FIELD-TYPED (#16106)
 *
 * Equality (`{ period: 'this_quarter' }`, `$eq`, `$ne`) and membership (`$in`
 * / `$nin`) CANNOT be judged blind: a select/picklist column legitimately
 * stores values that collide with preset names (`GlobalFilterSchema`'s own
 * pins protect `type: 'select', defaultValue: 'this_quarter'`), and equality
 * against such a stored value is a working filter. That is why the schema
 * door — field-agnostic by construction — keeps its ordering-only boundary,
 * and why this arm exists HERE, where the stack's object metadata is in hand:
 * maintainer-ruled 2026-09-06 (#16106, comment 5557019138, adopting
 * recommendation 1′): *at a layer that holds the object metadata, a declared
 * `date` / `datetime` field refuses one of the 13 declared preset names in
 * EVERY comparand position — bare (implicit equality), `$eq` / `$ne`, `$in` /
 * `$nin` and their view-rule and triple spellings, alongside the ordering
 * positions already judged.* Same message, same prescription (the #5240
 * convention): the window the preset already means is exactly what an author
 * writing `close_date == 'last_30_days'` intended.
 *
 * Measured first (ruling item 3), as real queries on a declared `date` field
 * (`close_date`) and a declared `datetime` sibling, on two real drivers —
 * `@objectstack/driver-memory` and `@objectstack/driver-sqlite-wasm` — 30 rows
 * seeded / 20 inside a 30-day window; both drivers answered identically:
 *
 * ```
 * close_date: 'last_30_days'              REFUSED  INVALID_FILTER / 400   (bare)
 * close_date: { $eq:  'last_30_days' }    REFUSED  INVALID_FILTER / 400
 * close_date: { $in: ['last_30_days'] }   REFUSED  INVALID_FILTER / 400
 * close_date: { $ne / $nin … }            REFUSED  INVALID_FILTER / 400
 * close_date: { $gte: '{30_days_ago}' }   200      count=20   <- positive control
 * close_date: '2026-09-03'                200      count=1    <- equality works on a date
 * stage: 'this_quarter'  (select column)  200      count=10   <- the picklist case, alive
 * ```
 *
 * So at QUERY time the engine door already refuses every residue position on a
 * declared temporal field — the residue was purely an AUTHORING-time gap:
 * `objectstack lint` passed and `defineStack` accepted a filter the runtime
 * then refused with a 400 on first render. This arm closes that gap where the
 * AI author's correction loop can see it.
 *
 * ### Which object a filter is judged against
 *
 * `walkAuthoredFilters` finds the subtrees; this arm re-walks each subtree's
 * config path back through its ancestors and binds the filter to the NEAREST
 * ancestor that declares an object, in the spellings the carriers actually
 * use (each one the same read a sibling rule already makes at that position):
 *
 * - a literal `object` / `objectName` — a dataset, a summary field's child
 *   object, a global filter's `optionsFrom`, a page data source, a
 *   `record:related_list`'s `properties`, a time-relative trigger;
 * - a `dataset` name, resolved to that dataset's `object` — dashboard widgets
 *   (`validate-widget-bindings`, #14148), reports and report blocks;
 * - `data: { provider: 'object', object }` — standalone views and list views
 *   (`validate-list-view-field-refs`, #14107); any OTHER provider names no
 *   object, so the position is unjudged;
 * - `config.objectName` / `config.object` — flow CRUD nodes
 *   (`validate-flow-node-writes`), a templated `{…}` value skipped;
 * - `dataSource.object`, then `properties.object` / `properties.objectName`
 *   — page components (`validate-page-field-bindings`);
 * - `publicPicker.object`, else the enclosing form field's `reference`
 *   resolved on the view's object, else NOTHING — a form field's public-lookup
 *   picker (`FormFieldPublicPickerSchema`) queries the REFERENCED object, so
 *   its `filter` must never fall through to the parent form object (#16106
 *   review finding B1: that fall-through was a false refusal wherever the two
 *   objects share a field name with differing types);
 * - and, under `objects`, the object itself — its list views, tabs and
 *   `relatedListFilter` (the filter runs over the CHILD rows, i.e. the object
 *   that owns the field).
 *
 * The field key (a bare name, or a dotted relationship path) is then resolved
 * through `resolveFieldPath` (`object-graph.ts`), and the comparand is judged
 * only when the LEAF resolves to an author-declared field of type `date` or
 * `datetime` — the two types the ruling names.
 *
 * ### What this arm deliberately does NOT judge
 *
 * Every one of these is a MISSED CATCH (the engine door still refuses it at
 * query time, field type in hand), never a false build error:
 *
 * - a position no ancestor binds (an app-level filter, a dashboard-level
 *   filter outside a widget), a dataset or object the stack does not declare,
 *   an object with no readable field map, a view on a non-`object` provider;
 * - a leaf that resolves only as a registry-INJECTED column (`created_at`,
 *   `updated_at`, …): the object graph carries no type for those — their type
 *   is registry-owned and invisible here (`FieldPathVerdict`'s own contract);
 * - a `time` field: the ruling names `date` / `datetime`, and a wall-clock
 *   column has no preset-shaped authoring slip worth a rule of its own;
 * - a field the object does not declare at all (a typo) — that is the
 *   `*-filter-field-unknown` rules' finding, not a second one here.
 *
 * The implicit-equality position is reported under the operator it LOWERS to,
 * `$eq`, at the path of the field itself (`…filter.close_date`, no operator
 * segment), so the located path still says exactly what was authored.
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

/** Mongo-shape ordering operators whose scalar comparand is judged field-agnostically (arm 1). */
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

/**
 * [#16106] Mongo-shape EQUALITY operators whose scalar comparand is judged
 * only with the field type in hand (arm 2). The implicit-equality position
 * (`{ field: value }`) is the third member, spelled by its absence.
 */
const EQUALITY_DOLLAR_OPS: ReadonlySet<string> = new Set(['$eq', '$ne']);

/** [#16106] Mongo-shape MEMBERSHIP operators — every member of the list is a comparand. */
const MEMBERSHIP_DOLLAR_OPS: ReadonlySet<string> = new Set(['$in', '$nin']);

/** [#16106] Canonical infix equality / membership, post `canonicalAstOperator` fold. */
const EQUALITY_INFIX_OPS: ReadonlySet<string> = new Set(['=', '!=']);
const MEMBERSHIP_INFIX_OPS: ReadonlySet<string> = new Set(['in', 'nin']);

/** [#16106] Canonical view-rule equality / membership, post `normalizeFilterOperator` fold. */
const EQUALITY_RULE_OPS: ReadonlySet<string> = new Set(['equals', 'not_equals']);
const MEMBERSHIP_RULE_OPS: ReadonlySet<string> = new Set(['in', 'not_in']);

/**
 * [#16106] The declared field types arm 2 judges — exactly the two the ruling
 * names. `time` is deliberately absent (see the module note).
 */
const FIELD_TYPED_TEMPORAL_TYPES: ReadonlySet<string> = new Set(['date', 'datetime']);

/** Recursion guard — an authored filter is a bounded document, not a general graph. */
const MAX_DEPTH = 32;

function isPlainObject(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * An object name written as a literal. A templated `{…}` value (a flow node
 * resolving its target from variables at run time) is skipped, not guessed —
 * the same read `validate-flow-node-writes.ts` makes.
 */
function literalObjectName(v: unknown): string | undefined {
  const s = strName(v);
  return s && !s.includes('{') ? s : undefined;
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

// ── Arm 2's field-type oracle ─────────────────────────────────────────────────

/**
 * "Is this field key, resolved against the filter's bound object, an
 * author-declared `date` / `datetime` field?" — the one question arm 2 asks.
 * A key it cannot answer (no bound object, an unresolvable path, an injected
 * leaf, any other type) answers `false`, so the position stays unjudged.
 */
type TemporalFieldOracle = (field: string) => boolean;

const UNBOUND: TemporalFieldOracle = () => false;

function temporalFieldOracle(graph: ObjectGraph, object: string | undefined): TemporalFieldOracle {
  if (!object) return UNBOUND;
  return (field) => {
    const verdict = resolveFieldPath(graph, object, field);
    if (!verdict || verdict.kind !== 'ok' || verdict.injected) return false;
    const type = verdict.meta?.type;
    return typeof type === 'string' && FIELD_TYPED_TEMPORAL_TYPES.has(type);
  };
}

/**
 * Split a walk path (`dashboards[0].widgets[2].filter`) into its segments.
 * `null` for a spelling this reader does not understand — a key carrying a
 * `.` or `[` — which leaves the position unbound rather than mis-bound.
 */
function pathSegments(path: string): (string | number)[] | null {
  const out: (string | number)[] = [];
  for (const piece of path.split('.')) {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(piece);
    if (!m) return null;
    out.push(m[1]);
    for (const index of m[2].match(/\d+/g) ?? []) out.push(Number(index));
  }
  return out;
}

/** One record on the way to a filter, with the property NAME it was reached under. */
interface Ancestor {
  /** The nearest enclosing property name — `sections[0]` is reached under `sections`. */
  key: string;
  node: AnyRec;
}

/**
 * The records on the way from the stack collection item down to (but not
 * including) the filter subtree at `path`, outermost first — read back through
 * the SAME `recordsOf` coercion `walkAuthoredFilters` applied to the
 * collection, so a map-form collection's injected `name` is visible here too.
 */
function ancestorsOf(stack: AnyRec, path: string): { collection: string; chain: Ancestor[] } | null {
  const segments = pathSegments(path);
  if (!segments || segments.length < 3) return null;
  const [collection, index, ...rest] = segments;
  if (typeof collection !== 'string' || typeof index !== 'number') return null;
  const item = recordsOf(stack[collection])[index];
  if (!item) return null;
  const chain: Ancestor[] = [{ key: collection, node: item }];
  let node: unknown = item;
  let key = collection;
  // The last segment is the filter key itself; everything before it is an ancestor.
  for (const segment of rest.slice(0, -1)) {
    if (typeof segment === 'string') key = segment;
    node = Array.isArray(node)
      ? node[segment as number]
      : isPlainObject(node) ? node[segment as string] : undefined;
    if (isPlainObject(node)) chain.push({ key, node });
    else if (!Array.isArray(node)) break;
  }
  return { collection, chain };
}

/**
 * The key under which a form field carries its public-lookup picker
 * (`FormFieldPublicPickerSchema`, `ui/view.zod.ts`). Its `filter` is a static
 * pre-filter the public-lookup route runs on the REFERENCED object —
 * `picker.object` when written, else the field definition's `reference` —
 * never on the form's own object.
 */
const PUBLIC_PICKER_KEY = 'publicPicker';

/**
 * Bind one authored filter to the object its conditions address — the NEAREST
 * ancestor that declares one, in the carriers' own spellings (module note,
 * "Which object a filter is judged against"). A reader that CLAIMS the
 * position but cannot resolve it (a `dataset` the stack does not declare, a
 * non-`object` view provider) ends the search: the position is unknowable,
 * and an outer ancestor's object would be the wrong one.
 */
function boundObjectOf(
  stack: AnyRec,
  path: string,
  datasets: ReadonlyMap<string, AnyRec>,
  graph: ObjectGraph,
): string | undefined {
  const located = ancestorsOf(stack, path);
  if (!located) return undefined;
  return bindAncestors(located.collection, located.chain, located.chain.length - 1, datasets, graph);
}

/** The reader loop behind {@link boundObjectOf}, from ancestor `from` outward. */
function bindAncestors(
  collection: string,
  chain: readonly Ancestor[],
  from: number,
  datasets: ReadonlyMap<string, AnyRec>,
  graph: ObjectGraph,
): string | undefined {
  for (let i = from; i >= 0; i--) {
    const { key, node: r } = chain[i];

    // [#16106 B1] A form field's `publicPicker` is a CLAIMING reader: the
    // picker queries the referenced object, so the position binds to
    // `picker.object`, else to the `reference` of the enclosing form field
    // resolved on the view's own object — and to NOTHING otherwise. Falling
    // through to the view's `data.object` (the parent form object) bound the
    // filter to the wrong object and produced a FALSE refusal wherever the
    // parent and the referenced object share a field name with differing
    // types (a `date` on the parent, a `select` whose option value is a
    // preset name on the referenced object).
    if (key === PUBLIC_PICKER_KEY) {
      const override = literalObjectName(r.object);
      if (override) return override;
      const formField = strName(chain[i - 1]?.node.field);
      if (!formField) return undefined;
      const formObject = bindAncestors(collection, chain, i - 2, datasets, graph);
      if (!formObject) return undefined;
      const verdict = resolveFieldPath(graph, formObject, formField);
      return verdict?.kind === 'ok' ? strName(verdict.meta?.reference) : undefined;
    }

    const direct = literalObjectName(r.object) ?? literalObjectName(r.objectName);
    if (direct) return direct;

    const datasetName = strName(r.dataset);
    if (datasetName) {
      const dataset = datasets.get(datasetName);
      return dataset ? literalObjectName(dataset.object) : undefined;
    }

    if (isPlainObject(r.data)) {
      const provider = r.data.provider;
      if (provider !== undefined && provider !== 'object') return undefined;
      const viaData = literalObjectName(r.data.object);
      if (viaData) return viaData;
    }

    if (isPlainObject(r.config)) {
      const viaConfig = literalObjectName(r.config.objectName) ?? literalObjectName(r.config.object);
      if (viaConfig) return viaConfig;
    }

    if (isPlainObject(r.dataSource)) {
      const viaSource = literalObjectName(r.dataSource.object);
      if (viaSource) return viaSource;
    }

    if (isPlainObject(r.properties)) {
      const viaProps = literalObjectName(r.properties.object) ?? literalObjectName(r.properties.objectName);
      if (viaProps) return viaProps;
    }
  }

  // Under `objects`, the collection item IS the object every filter on it
  // addresses — read last, so a nearer declaration (a summary field's child
  // object) wins.
  if (collection === 'objects') return strName(chain[0].node.name);
  return undefined;
}

// ── The three authored shapes ─────────────────────────────────────────────────

/**
 * Judge one Mongo-style condition NODE's own field entries.
 *
 * `prefix` carries the relationship path accumulated by descending nested
 * condition objects (`{ account: { created_at: … } }` is judged as
 * `account.created_at`), so arm 2 resolves the leaf on the object the hop
 * lands on — the same accumulation `walkFilterFieldKeys` performs.
 */
function judgeConditionNode(
  node: AnyRec,
  path: string,
  where: string,
  out: PresetComparandFinding[],
  depth: number,
  isTemporal: TemporalFieldOracle,
  prefix: string,
): void {
  if (depth > MAX_DEPTH) return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        value.forEach((arm, i) => {
          if (isPlainObject(arm)) judgeConditionNode(arm, `${here}[${i}]`, where, out, depth + 1, isTemporal, prefix);
        });
      }
      continue;
    }
    if (key === '$not') {
      if (isPlainObject(value)) judgeConditionNode(value, here, where, out, depth + 1, isTemporal, prefix);
      continue;
    }
    if (key.startsWith('$')) continue; // unrecognised combinator — skipped, not descended
    const field = prefix ? `${prefix}.${key}` : key;
    if (!isPlainObject(value)) {
      // Implicit equality — arm 2, field type in hand (#16106). Reported under
      // the operator it lowers to, at the path of the field itself.
      if (isDateRangePresetName(value) && isTemporal(field)) {
        out.push(finding(where, here, value, '$eq'));
      }
      continue;
    }
    const hasOps = Object.keys(value).some((k) => k.startsWith('$'));
    if (!hasOps) {
      // Nested relation / deep equality — descend.
      judgeConditionNode(value, here, where, out, depth + 1, isTemporal, field);
      continue;
    }
    for (const [op, comparand] of Object.entries(value)) {
      // Arm 1 — ordering, field-agnostic.
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
        continue;
      }
      // Arm 2 — equality / membership, field-typed (#16106).
      if (EQUALITY_DOLLAR_OPS.has(op) && isDateRangePresetName(comparand) && isTemporal(field)) {
        out.push(finding(where, `${here}.${op}`, comparand, op));
        continue;
      }
      if (MEMBERSHIP_DOLLAR_OPS.has(op) && Array.isArray(comparand) && isTemporal(field)) {
        comparand.forEach((member, i) => {
          if (isDateRangePresetName(member)) {
            out.push(finding(where, `${here}.${op}[${i}]`, member, op));
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
  isTemporal: TemporalFieldOracle,
): void {
  const operator = normalizeFilterOperator(rule.operator);
  if (typeof operator !== 'string') return;
  const value = rule.value;
  // Arm 1 — ordering, field-agnostic.
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
    return;
  }
  // Arm 2 — equality / membership, field-typed (#16106).
  const field = strName(rule.field);
  if (!field || !isTemporal(field)) return;
  if (EQUALITY_RULE_OPS.has(operator) && isDateRangePresetName(value)) {
    out.push(finding(where, `${path}.value`, value, operator));
    return;
  }
  if (MEMBERSHIP_RULE_OPS.has(operator) && Array.isArray(value)) {
    value.forEach((member, i) => {
      if (isDateRangePresetName(member)) {
        out.push(finding(where, `${path}.value[${i}]`, member, operator));
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
  isTemporal: TemporalFieldOracle,
): void {
  const op = triple[1];
  if (typeof op !== 'string') return;
  const canonical = canonicalAstOperator(op);
  const value = triple[2];
  // Arm 1 — ordering, field-agnostic.
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
    return;
  }
  // Arm 2 — equality / membership, field-typed (#16106).
  const field = strName(triple[0]);
  if (!field || !isTemporal(field)) return;
  if (EQUALITY_INFIX_OPS.has(canonical) && isDateRangePresetName(value)) {
    out.push(finding(where, `${path}[2]`, value, op));
    return;
  }
  if (MEMBERSHIP_INFIX_OPS.has(canonical) && Array.isArray(value)) {
    value.forEach((member, i) => {
      if (isDateRangePresetName(member)) {
        out.push(finding(where, `${path}[2][${i}]`, member, op));
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
  isTemporal: TemporalFieldOracle,
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
      judgeTriple(node, path, where, out, isTemporal);
      return;
    }
    // Group ['and'|'or', ...members] or bare list — recurse the members.
    node.forEach((member, i) => {
      if (typeof member === 'string') return; // the leading keyword
      judgeFilterValue(member, `${path}[${i}]`, where, out, depth + 1, isTemporal);
    });
    return;
  }

  if (!isPlainObject(node)) return;

  // View filter rule: { field, operator[, value] }.
  if (typeof node.field === 'string' && typeof node.operator === 'string') {
    judgeFilterRule(node, path, where, out, isTemporal);
    return;
  }

  judgeConditionNode(node, path, where, out, depth, isTemporal, '');
}

/**
 * Validate every authored filter across a stack for bare preset comparands.
 *
 * Pure `(stack) => Finding[]`; no I/O. Arm 1 judges the filter literal alone;
 * arm 2 additionally reads the stack's own `objects` (and `datasets`, to bind
 * a widget or report) — both collections the runtime publish gate's per-write
 * snapshot carries — and stays silent wherever they are absent.
 */
export function validatePresetComparands(
  stack: Record<string, unknown> | undefined | null,
): PresetComparandFinding[] {
  if (!stack || typeof stack !== 'object') return [];
  const out: PresetComparandFinding[] = [];

  const graph = indexObjectGraph(stack);
  const datasets = new Map<string, AnyRec>();
  for (const dataset of recordsOf(stack.datasets)) {
    const name = strName(dataset.name);
    if (name) datasets.set(name, dataset);
  }

  walkAuthoredFilters(stack, PRESET_COMPARAND_SURFACES, ({ value, path, where }) => {
    const isTemporal = temporalFieldOracle(graph, boundObjectOf(stack, path, datasets, graph));
    judgeFilterValue(value, path, where, out, 0, isTemporal);
  });

  return out;
}

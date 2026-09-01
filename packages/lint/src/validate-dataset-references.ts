// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14105 — ADR-0021 dataset reference integrity] A dataset's `include` paths,
 * `dimensions[].field` / `measures[].field` paths and filter KEYS must name
 * something the object graph actually has.
 *
 * ## The state this rule ends
 *
 * Measured on `@objectstack/spec` 17.2.0 against a real app (three datasets
 * over one object): every one of these mutations, applied on its own and
 * confirmed on disk, left `objectstack validate` at **exit 0, "Validation
 * passed"**, and `objectstack build` wrote the dangling dataset into
 * `dist/objectstack.json`:
 *
 * | mutation                                          | before | after |
 * |:--------------------------------------------------|:-------|:------|
 * | dimension `field` → a base field that does not exist | passed | `dataset-field-unknown` |
 * | dimension `field` → a joined field that does not exist | passed | `dataset-field-unknown` |
 * | measure `field` → a field that does not exist       | passed | `dataset-field-unknown` |
 * | measure filter KEY → a field that does not exist    | passed | `dataset-filter-field-unknown` |
 * | `include[]` → a relationship that does not exist    | passed | `dataset-include-unknown` |
 * | `object` → an object that does not exist            | passed | `object-reference-unknown` (see below) |
 *
 * The controls in that measurement — a duplicate measure name (`superRefine`)
 * and a bad date macro in a measure filter (`filter-token-unknown`) — BOTH
 * failed the build, so the datasets were demonstrably in the validation path
 * the whole time. That is what makes this a hole rather than an unread file,
 * and it is the sharpest form of the argument: `filter-token-unknown` already
 * stands at `datasets[1].measures[1].filter.last_update_at.$lt` and reasons
 * about the VALUE. Nothing standing in that same position resolved the KEY, or
 * the sibling `field` one level up.
 *
 * ## Why a dataset's dangling reference is worse than most
 *
 * `filter-token-unknown`'s own wording states the failure mode it exists to
 * prevent: the value is *"sent to the data engine as a literal string, matches
 * no record, and the surface renders empty."* A dangling field path produces
 * the same outcome from the same node.
 *
 * A dataset is the semantic layer — dashboards and reports bind its dimensions
 * and measures BY NAME (ADR-0021) — and the CONSUMER end of that binding is
 * already guarded: `widget-dataset-unknown` / `widget-dimension-unknown` /
 * `widget-measure-unknown` (#7529, shipped #8902) refuse a widget that names a
 * dataset, dimension or measure that does not exist. So the surviving hole was
 * the quiet one, one level down: every binding resolves, the board renders, and
 * the charts are empty or subtly wrong because the dataset underneath addresses
 * columns that do not exist.
 *
 * ## Severity: `error`, on every verdict here
 *
 * The bar this package states is "gate when no reading of the metadata behaves
 * as written", and each verdict clears it. A dimension bound to a column that
 * does not exist cannot group by anything; a measure bound to one cannot
 * aggregate anything; a filter key that names nothing either widens the scope
 * (the condition is dropped) or empties it (the engine compares a missing
 * column) — and every one of those outcomes reaches a human as a chart that
 * rendered successfully. This is the same call `dashboard-filter-field-unknown`
 * (#3365) makes one layer up on the identical question, and the reason
 * `validate-searchable-fields` gives for gating rather than advising: a
 * consumer that SKIPS an unknown name and renders the rest may be warned about;
 * a declaration whose whole purpose is to name a column must not ship naming
 * nothing.
 *
 * ## What this rule deliberately does NOT own
 *
 * **`Dataset.object` — the base object itself.** Checked, and it lands in
 * `validate-object-references.ts` instead, because that rule's charter IS
 * object-name reference sites that are plain `z.string()` and therefore ship
 * whatever the author typed. Putting it there buys the curated cross-package
 * severity ladder (`PLATFORM_PROVIDED_OBJECT_NAMES`) rather than a second,
 * naive "not in this stack ⇒ error" — which matters immediately: the platform's
 * own `system.datasets.ts` declares five datasets over `sys_user`,
 * `sys_organization`, `sys_session`, `sys_package_installation` and
 * `sys_audit_log`, three of which live in packages a stack compiling
 * plugin-auth alone cannot see. A local ladder would have reported all five.
 * When the base object does not resolve, THIS rule skips the dataset entirely
 * (skip 1 below) so one typo yields one finding, not five.
 *
 * **Dimension/measure NAMES and the derived-measure graph.** `DatasetSchema`'s
 * own `superRefine` already refuses duplicates and a `derived.of` naming a
 * measure the dataset does not declare, and `validateWidgetBindings` /
 * `validateChartBindings` own the presentation end. Restating either here would
 * double-report.
 *
 * **Aggregate coherence.** `measure-aggregate-incoherent`
 * (`validate-widget-bindings.ts`) already asks whether the aggregate SUITS the
 * field's type. This rule asks only whether the field EXISTS — and the two now
 * compose, because a measure whose field resolves is exactly the input that
 * check was already written to want.
 *
 * ## Skips — the same three every field-existence rule in this package takes
 *
 * Resolution is {@link resolveFieldPath}'s (`object-graph.ts`), and its
 * `unknowable` verdicts are never reported (ADR-0072 D1: one dead finding and
 * authors stop trusting the linter). They are:
 *
 *   1. an object this stack does not define — the `sys_*` datasets above;
 *   2. an object that declares no readable field map — ADR-0015 `external` and
 *      datasource-introspected schemas;
 *   3. a registry-injected system column, and any hop THROUGH one. The shipped
 *      `showcase_task_metrics` dimension `{ field: 'created_at' }` is skip 3's
 *      live case: a real runtime column that appears in no authored `fields`.
 *
 * ## The reusable seam
 *
 * Nothing here is dataset-specific except the positions walked. The two halves
 * — "where are the field keys in this filter?" ({@link walkFilterFieldKeys},
 * `filter-walk.ts`) and "what does this dotted path resolve to?"
 * ({@link resolveFieldPath}, `object-graph.ts`) — are written as shared
 * mechanism with the judgement left to the caller, because the same two
 * questions are asked at a dashboard widget's filter keys and `sortBy` (#14148)
 * and at a list view's field positions (#14107). Those surfaces are NOT
 * implemented here; the seam is what keeps them one mechanism reused rather
 * than three independent rules drifting apart.
 */

import { walkFilterFieldKeys } from './filter-walk.js';
import {
  RELATIONSHIP_FIELD_TYPES,
  describeFieldPathVerdict,
  indexObjectGraph,
  isUnjudgeable,
  joinablePrefixes,
  resolveFieldPath,
  type ObjectGraph,
} from './object-graph.js';

/** An `include[]` entry that does not name a joinable relationship path. */
export const DATASET_INCLUDE_UNKNOWN = 'dataset-include-unknown';
/** A `dimensions[].field` / `measures[].field` path that resolves to no column. */
export const DATASET_FIELD_UNKNOWN = 'dataset-field-unknown';
/** A field path whose relationship prefix was never declared in `include`. */
export const DATASET_FIELD_NOT_INCLUDED = 'dataset-field-not-included';
/** A filter KEY — on the dataset or a measure — that resolves to no column. */
export const DATASET_FILTER_FIELD_UNKNOWN = 'dataset-filter-field-unknown';

export type DatasetRefSeverity = 'error' | 'warning';

export interface DatasetRefFinding {
  /** Always `error` today — see the severity note on this module. */
  severity: DatasetRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `dataset "sales" › dimension "region"`. */
  where: string;
  /** Config path, e.g. `datasets[0].dimensions[2].field`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/** The shared consequence sentence — why an unresolved path is not merely inert. */
const SILENT_EMPTY =
  'The path is compiled into the analytics query as written, so it addresses a column ' +
  'that does not exist: the surface renders successfully with empty or wrong numbers, ' +
  'and nothing reports the miss.';

/**
 * Validate every ADR-0021 dataset's references against the object graph.
 * Returns findings (empty = clean). Pure `(stack) => Finding[]`; no I/O, and
 * safe on both the schema-parsed stack and the raw config the `lint` path
 * carries.
 */
export function validateDatasetReferences(stack: AnyRec): DatasetRefFinding[] {
  const findings: DatasetRefFinding[] = [];
  if (!isRec(stack)) return findings;

  const datasets = asArray(stack.datasets);
  if (datasets.length === 0) return findings;

  const graph: ObjectGraph = indexObjectGraph(stack);

  datasets.forEach((ds, di) => {
    const dsName = strName(ds.name) ?? `#${di}`;
    const where = `dataset "${dsName}"`;
    const dsPath = `datasets[${di}]`;
    const object = strName(ds.object);
    if (!object) return; // no base binding — `DatasetSchema.object` is required; the schema owns it

    // ── Skip 1/2, once for the whole dataset ──
    // An unresolvable base object is `validate-object-references.ts`' finding
    // (see the module note). Resolving anything against it here would turn one
    // typo into a finding per dimension, per measure and per filter key.
    if (!graph.has(object) || !graph.get(object)) return;

    const included = joinablePrefixes(ds.include);

    // ── (1) `include[]` names a real, traversable relationship ──
    const include = Array.isArray(ds.include) ? ds.include : [];
    include.forEach((entry, ii) => {
      if (typeof entry !== 'string' || !entry) return;
      const path = `${dsPath}.include[${ii}]`;
      const verdict = resolveFieldPath(graph, object, entry);
      if (isUnjudgeable(verdict) || !verdict) return;

      const prescription =
        `Declare a relationship (lookup / master_detail) that exists on the join chain from ` +
        `"${object}", or drop the entry. ADR-0071 allows up to 3 hops and declaring "a.b" ` +
        `implicitly includes "a".`;

      if (verdict.kind === 'ok') {
        // The entry resolves to a real field — but `include` joins, so the
        // field must BE a relationship. An injected column's type is
        // registry-owned and invisible here, so it is unanswerable, not a miss.
        if (verdict.injected) return;
        const type = verdict.meta?.type;
        if (type && RELATIONSHIP_FIELD_TYPES.has(type)) return;
        findings.push({
          severity: 'error',
          rule: DATASET_INCLUDE_UNKNOWN,
          where,
          path,
          message:
            `include[${ii}] "${entry}" names a` +
            `${type ? ` \`${type}\`` : 'n ordinary'} field on object "${verdict.object}", ` +
            `not a relationship — no join can be derived from it, so every dimension or ` +
            `measure written against that prefix addresses nothing.`,
          hint: prescription,
        });
        return;
      }

      const account = describeFieldPathVerdict(verdict, entry, `include[${ii}]`);
      if (!account) return;
      findings.push({
        severity: 'error',
        rule: DATASET_INCLUDE_UNKNOWN,
        where,
        path,
        message:
          `${account.message} Joins are COMPILED from \`include\` (ADR-0021), so an entry ` +
          `that resolves to nothing produces no join at all.`,
        hint: `${prescription} ${account.detail}`,
      });
    });

    /**
     * Judge one authored field PATH — the shared core behind a dimension's
     * `field`, a measure's `field` and every filter key. Existence first (it
     * carries the "did you mean"), then the ADR-0021 joinability clause, and at
     * most ONE finding per position either way.
     */
    const checkFieldPath = (
      raw: unknown,
      positionWhere: string,
      path: string,
      subject: string,
      rule: string,
      prescription: string,
    ): void => {
      const written = strName(raw);
      if (!written) return;
      const verdict = resolveFieldPath(graph, object, written);
      if (isUnjudgeable(verdict) || !verdict) return;

      const account = describeFieldPathVerdict(verdict, written, subject);
      if (account) {
        findings.push({
          severity: 'error',
          rule,
          where: positionWhere,
          path,
          message: `${account.message} ${SILENT_EMPTY}`,
          hint: `${prescription} ${account.detail}`,
        });
        return;
      }

      // The path RESOLVES. The second real check: a dotted path is only
      // joinable when its relationship prefix was declared in `include` —
      // ADR-0021 D-C, "only declared paths are joinable". A path whose prefix
      // was never declared compiles to no join, so the column is not in the
      // query's reach however real it is.
      const cut = written.lastIndexOf('.');
      if (cut < 0) return; // a base field needs no join
      const prefix = written.slice(0, cut);
      if (included.has(prefix)) return;
      findings.push({
        severity: 'error',
        rule: DATASET_FIELD_NOT_INCLUDED,
        where: positionWhere,
        path,
        message:
          `${subject} "${written}" resolves on the object graph, but its relationship ` +
          `prefix "${prefix}" is not declared in this dataset's \`include\` — and ADR-0021 ` +
          `joins ONLY declared paths, so no join is compiled and the column is out of the ` +
          `query's reach. ${SILENT_EMPTY}`,
        hint:
          `Add "${prefix}" to include (declaring "a.b" implicitly includes "a"), or bind ` +
          `this position to a field on "${object}" itself. Declared include paths: ` +
          `${included.size > 0 ? [...included].sort().join(', ') : '(none)'}.`,
      });
    };

    // ── (2) `dimensions[].field` ──
    asArray(ds.dimensions).forEach((dim, i) => {
      const name = strName(dim.name) ?? `#${i}`;
      checkFieldPath(
        dim.field,
        `${where} › dimension "${name}"`,
        `${dsPath}.dimensions[${i}].field`,
        'dimension field',
        DATASET_FIELD_UNKNOWN,
        `Bind the dimension to a field on "${object}", or to a ` +
          `\`relationship[.relationship].field\` path whose prefix is declared in \`include\`.`,
      );
    });

    // ── (3) `measures[].field` ──
    // A derived measure combines OTHER measures by name and declares no field;
    // `DatasetSchema.superRefine` owns that graph, and `field` is legitimately
    // absent on a plain `count`. Both fall out of `checkFieldPath`'s own
    // "nothing written, nothing to resolve" guard.
    asArray(ds.measures).forEach((measure, i) => {
      const name = strName(measure.name) ?? `#${i}`;
      checkFieldPath(
        measure.field,
        `${where} › measure "${name}"`,
        `${dsPath}.measures[${i}].field`,
        'measure field',
        DATASET_FIELD_UNKNOWN,
        `Bind the measure to a field on "${object}", or to a ` +
          `\`relationship[.relationship].field\` path whose prefix is declared in \`include\`.`,
      );
    });

    // ── (4) filter KEYS, on the dataset scope filter and on every measure ──
    // The traversal `filter-token-unknown` already performs on the VALUES,
    // asked of the KEYS — the same node, the same walk, the question that was
    // missing. `walkFilterFieldKeys` handles all three authored filter shapes
    // (Mongo condition object, `{ field, operator, value }` rules, and
    // `[field, op, value]` triples) so a filter authored one way is not judged
    // while another is silently skipped (#3574's own failure mode).
    const checkFilter = (filter: unknown, positionWhere: string, path: string): void => {
      if (filter === undefined || filter === null) return;
      walkFilterFieldKeys(filter, path, ({ field, path: at }) => {
        checkFieldPath(
          field,
          positionWhere,
          at,
          'filter key',
          DATASET_FILTER_FIELD_UNKNOWN,
          `Filter on a field that exists on "${object}" (or on a declared \`include\` path).`,
        );
      });
    };

    checkFilter(ds.filter, `${where} › filter`, `${dsPath}.filter`);
    asArray(ds.measures).forEach((measure, i) => {
      const name = strName(measure.name) ?? `#${i}`;
      checkFilter(
        measure.filter,
        `${where} › measure "${name}" › filter`,
        `${dsPath}.measures[${i}].filter`,
      );
    });
  });

  return findings;
}

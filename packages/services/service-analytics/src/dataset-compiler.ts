// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Cube, Metric, Dimension as CubeDimension, CubeJoin } from '@objectstack/spec/data';
import { AggregationFunction } from '@objectstack/spec/data';
import type { Dataset, DatasetMeasure, DatasetDimension } from '@objectstack/spec/ui';
import type { FilterCondition } from '@objectstack/spec/data';

/**
 * Dataset → Cube compiler (ADR-0021 D-A=(c), WS2).
 *
 * Lowers a declarative `dataset` (base object + included relationships +
 * declared dimensions/measures + derived measures) into the existing Cube
 * analytics runtime model. The author never writes an `ON` clause: joins are
 * DERIVED from the `include` relationship names and the dotted `relationship.field`
 * references on dimensions/measures, matching the NativeSQLStrategy convention
 *   `<parentTable>.<relationship> = <relationship>.id`.
 *
 * Safety (D-C): every dotted field reference must point at a relationship that
 * the dataset explicitly declared in `include`; otherwise the compile fails.
 * The returned `allowedRelationships` set is the join allowlist the strategy
 * enforces at SQL-build time.
 */

/** Operators v1 does NOT compile to the Cube SQL switch — surfaced as a clear error. */
export const UNSUPPORTED_AGGREGATES = new Set(['array_agg', 'string_agg']);

/**
 * What v1 *can* lower — derived from the spec's vocabulary rather than restated.
 *
 * The list used to be hand-written prose inside the error message below, which
 * made it a third copy of one vocabulary (after `AggregationFunction` and the
 * `native-sql-strategy` switch) with nothing keeping the three in step. An
 * aggregate added to the spec would have passed this gate, been reported as
 * supported by that message, and then hit the strategy's `default` — returning
 * a row count in place of the requested number. objectui#2945.
 */
export const SUPPORTED_AGGREGATES: string[] = AggregationFunction.options
  .filter((a: string) => !UNSUPPORTED_AGGREGATES.has(a));

export interface DerivedMeasureSpec {
  name: string;
  op: 'ratio' | 'sum' | 'difference' | 'product';
  of: string[];
}

export interface CompiledDataset {
  /** The Cube the dataset compiles to (consumed by the strategy chain). */
  cube: Cube;
  /**
   * Every join alias the dataset may use — each declared `include` path AND its
   * intermediate prefixes (ADR-0071). The join allowlist (D-C): the
   * NativeSQLStrategy rejects any join alias not in this set.
   */
  allowedRelationships: Set<string>;
  /** Derived measures, computed post-aggregation by the executor (Q1). */
  derived: DerivedMeasureSpec[];
  /** Definition-level filter (the dataset's intrinsic scope). */
  filter?: FilterCondition;
  /** Per-measure scoped filters, keyed by measure name (applied by executor). */
  measureFilters: Record<string, FilterCondition>;
}

/**
 * The related object reached by traversing a relationship: its logical object
 * name (used to resolve the NEXT hop in a multi-hop chain — ADR-0071) and its
 * physical table name (the join target).
 */
export interface RelationshipTarget {
  object: string;
  table: string;
}

/**
 * Resolves a relationship name on a base object to the related object/table,
 * using the runtime's object graph. Optional: when omitted the compiler trusts
 * the declared `include` names (the NativeSQLStrategy convention assumes the
 * relationship name equals the related table name).
 *
 * May return a bare table-name `string` (legacy single-hop: object name is
 * assumed equal to the table) or a {@link RelationshipTarget} (required to
 * traverse further along a multi-hop path, where object differs from table for
 * namespaced objects).
 */
export type RelationshipResolver = (
  baseObject: string,
  relationshipName: string,
) => string | RelationshipTarget | undefined;

/**
 * Optional probes the compiler consults to reject metadata that is decidable
 * BEFORE any query runs. Every probe is optional and every one of them is
 * tiered "cannot answer, do not block" (the same stand-down as
 * `isRegisteredObject` / `getObjectFieldNames` on `AnalyticsServiceConfig`):
 * a host without a data engine compiles exactly as it did before.
 */
export interface DatasetCompileOptions {
  /**
   * [#5115] The datasource `objectName` DECLARES (`object.datasource`), or
   * `undefined` when nothing authoritative can answer (no data engine, unknown
   * object).
   *
   * With it the compiler can settle at COMPILE time what #5033 could only
   * report at QUERY time: a dataset whose join crosses datasources declares a
   * statement no driver can execute, because the analytics engine lowers the
   * whole dataset into ONE SQL statement on the base object's datasource.
   *
   * IMPORTANT — `'default'` is not an answer. In `ObjectQL.getDriver`'s
   * resolution order an explicit `object.datasource` other than `'default'`
   * wins outright (step 1); `'default'` is the schema's DEFAULT value and means
   * only "no explicit binding", after which routing is decided by
   * `datasourceMapping` rules, the ADR-0057 §3.6 lifecycle split, and the
   * owning package's `defaultDatasource` — none of which are visible from here.
   * The compiler therefore treats `'default'`/`undefined` as UNANSWERED. See
   * {@link compileDataset}.
   */
  getObjectDatasource?: (objectName: string) => string | undefined;
  /**
   * ADR-0062 D6 — is `objectName` federated (bound to an external datasource)?
   *
   * A federated participant is EXEMPT from the cross-datasource rejection:
   * `NativeSQLStrategy.canHandle` already declines a cube whose base or joined
   * object is external, so such a dataset is served by the ObjectQL FK-expand
   * path (two reads, joined in memory) — which crosses datasources by
   * construction. Rejecting it here would break a path that works today.
   */
  isExternalObject?: (objectName: string) => boolean;
}

/** Map a dataset measure's aggregate to the Cube metric `type`. */
function aggregateToMetricType(m: DatasetMeasure): Metric['type'] {
  // Only reached for non-derived measures, where the spec refinement guarantees
  // an aggregate; guard defensively so the type narrows from `optional`.
  if (!m.aggregate) {
    throw new Error(`[dataset-compiler] non-derived measure "${m.name}" has no aggregate`);
  }
  if (UNSUPPORTED_AGGREGATES.has(m.aggregate)) {
    throw new Error(
      `[dataset-compiler] measure "${m.name}" uses aggregate "${m.aggregate}" which is ` +
      `not supported by the v1 dataset runtime (supported: ${SUPPORTED_AGGREGATES.join(', ')}).`,
    );
  }
  return m.aggregate as Metric['type'];
}

/** Map a dataset dimension type to the Cube dimension `type`. */
function dimensionType(d: DatasetDimension): CubeDimension['type'] {
  switch (d.type) {
    case 'date': return 'time';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'lookup': return 'string';
    case 'string': return 'string';
    default: return 'string';
  }
}

/** The relationship PATH a dotted field traverses — all segments but the final
 *  column — or null for a base-object field. E.g. `account.owner.region` →
 *  `account.owner`; `account.region` → `account`; `region` → null. */
function fieldRelationshipPath(field: string): string | null {
  const idx = field.lastIndexOf('.');
  return idx > 0 ? field.slice(0, idx) : null;
}

/** Max relationship hops in one `include` path — base → 3 hops = 4 objects
 *  (ADR-0071; Salesforce-report-type parity). To-one chains never fan out, so
 *  this is a performance/complexity guard, not a correctness limit. */
const MAX_JOIN_HOPS = 3;

/** SQL-safe join alias for a relationship PATH. The dotted path is the author-
 *  facing form; the alias replaces dots with `__` (Cube.js convention) so each
 *  prefix is one valid identifier — quoted dotted identifiers are rejected by
 *  the read-scope SQL guard (fail-closed). Single-segment paths are unchanged,
 *  so single-hop joins stay byte-for-byte identical. */
const joinAlias = (path: string): string => path.replace(/\./g, '__');

export function compileDataset(
  dataset: Dataset,
  resolver?: RelationshipResolver,
  options?: DatasetCompileOptions,
): CompiledDataset {
  const include = dataset.include ?? [];

  // ── #5115 — cross-datasource joins are rejected HERE, at compile time ──────
  //
  // A dataset lowers to ONE SQL statement executed on the base object's
  // datasource (`plugin.ts` routes raw SQL by object since #5033). So a join
  // whose target lives on a DIFFERENT datasource is not a query that sometimes
  // fails — it is metadata that can never execute, and the question "which
  // datasource is each participant bound to" is fully answerable the moment the
  // dataset is compiled. #5033 made that failure loud at QUERY time (in front of
  // whoever opened the dashboard); this gate moves the same verdict to
  // registration, where the AUTHOR is still holding the metadata.
  //
  // Tiering — "cannot answer, do not block": no probe, no answer for the base
  // object, or no answer for a target ⇒ compile as before and let #5033's
  // query-time defence report it. A false ALLOW costs a loud runtime error that
  // already exists; a false REJECT would blank a working dashboard on upgrade,
  // so this gate fires ONLY on a conflict the metadata itself proves.
  //
  // What counts as an ANSWER (deliberately narrow): an EXPLICIT, non-`'default'`
  // `object.datasource`. That is step 1 of `ObjectQL.getDriver`'s resolution
  // order and it wins outright, so two objects declaring two different names are
  // provably in two databases. `'default'` is the schema's default VALUE, not a
  // routing decision: an object that leaves it alone is still routed by
  // `datasourceMapping` rules, by the ADR-0057 §3.6 lifecycle split
  // (audit/telemetry/event → the `telemetry` datasource), or by its package's
  // `defaultDatasource` — rules this compiler cannot see. Treating `'default'`
  // as "the primary DB" would reject a dataset whose two objects a mapping rule
  // in fact lands on the SAME datasource, and would make the verdict depend on
  // whether the object happened to be Zod-parsed (which materializes the
  // default) — so `'default'` is read as UNANSWERED.
  const declaredDatasource = (objectName: string): string | undefined => {
    const declared = options?.getObjectDatasource?.(objectName);
    return declared && declared.toLowerCase() !== 'default' ? declared : undefined;
  };
  const isExternal = (objectName: string): boolean =>
    options?.isExternalObject?.(objectName) ?? false;
  const baseDatasource = declaredDatasource(dataset.object);
  // Datasource ids are compared case-insensitively: an id differing only in case
  // is not evidence of two different databases, and an uncertain answer must
  // not reject.
  const sameDatasource = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const baseIsFederated = isExternal(dataset.object);
  const assertSameDatasource = (targetObject: string, path: string): void => {
    // Judgeable only when the BASE side is placed and non-federated; it is the
    // side every comparison is made against, so an unplaceable base means no
    // join can be judged (never reject every join for want of the base).
    if (!baseDatasource || baseIsFederated) return;
    if (isExternal(targetObject)) return; // served by the FK-expand path, not by one statement
    const targetDatasource = declaredDatasource(targetObject);
    if (!targetDatasource) return; // cannot answer for this target
    if (sameDatasource(targetDatasource, baseDatasource)) return;
    throw new Error(
      `[dataset-compiler] dataset "${dataset.name}" declares a JOIN that crosses datasources: ` +
      `its base object "${dataset.object}" is on datasource "${baseDatasource}", but the joined ` +
      `object "${targetObject}" — reached via the \`include\` path "${path}" — is on datasource ` +
      `"${targetDatasource}". A dataset JOIN cannot cross datasources: the whole dataset is ` +
      `executed as ONE statement on the base object's datasource, so "${targetObject}" is simply ` +
      `not there. Fix it by binding both objects to the same datasource, or by dropping "${path}" ` +
      `from the dataset's \`include\` (and every dimension/measure that references it).`,
    );
  };

  // Resolve each declared relationship PATH into its ordered join chain, emitting
  // one Cube join per PATH PREFIX (ADR-0071 multi-hop, to-one only). The join
  // ALIAS is the full dotted path (`account.owner`), which self-describes the
  // chain: the parent alias is the path minus its last segment, the FK column is
  // that last segment. So declaring `account.owner` auto-adds the intermediate
  // `account` join, and the strategy can rebuild every `ON` from the alias alone.
  // Without a resolver, each segment's relationship name is assumed to equal both
  // the related object and its table (legacy convention / unit tests).
  const resolveHop = (fromObject: string, rel: string): RelationshipTarget => {
    if (!resolver) return { object: rel, table: rel };
    const resolved = resolver(fromObject, rel);
    if (!resolved) {
      throw new Error(
        `[dataset-compiler] dataset "${dataset.name}" includes relationship "${rel}" ` +
        `which does not exist on object "${fromObject}".`,
      );
    }
    return typeof resolved === 'string' ? { object: resolved, table: resolved } : resolved;
  };
  const joins: Record<string, CubeJoin> = {};
  for (const path of include) {
    const segments = path.split('.');
    if (segments.length > MAX_JOIN_HOPS) {
      throw new Error(
        `[dataset-compiler] dataset "${dataset.name}" include path "${path}" exceeds the ` +
        `${MAX_JOIN_HOPS}-hop limit (${segments.length} hops). Deeper traversal is not supported.`,
      );
    }
    let fromObject = dataset.object;
    let parentAlias = dataset.object;
    let prefix = '';
    for (const seg of segments) {
      prefix = prefix ? `${prefix}.${seg}` : seg;
      const target = resolveHop(fromObject, seg);
      // #5115 — every hop is a join target in the single statement, so each one
      // (not just the last segment of a path) must sit on the base datasource.
      assertSameDatasource(target.object, prefix);
      const alias = joinAlias(prefix);
      if (!joins[alias]) {
        // KEY is the SQL-safe alias; `name` carries the join TABLE; the strategy
        // rebuilds the ON clause from the alias convention (`<parent>.<seg> = <alias>.id`).
        joins[alias] = {
          name: target.table,
          relationship: 'many_to_one',
          sql: `${parentAlias}.${seg} = ${prefix}.id`,
        };
      }
      fromObject = target.object;
      parentAlias = prefix;
    }
  }

  // The join allowlist (D-C) is every registered alias — each declared path AND
  // its intermediate prefixes — so a multi-hop field's intermediate joins pass.
  const allowedRelationships = new Set(Object.keys(joins));

  // Assert any dotted field only traverses a DECLARED relationship PATH (D-C).
  const assertDeclared = (field: string, ownerKind: string, ownerName: string) => {
    const relPath = fieldRelationshipPath(field);
    if (relPath && !joins[joinAlias(relPath)]) {
      throw new Error(
        `[dataset-compiler] ${ownerKind} "${ownerName}" references relationship path "${relPath}" ` +
        `via "${field}", but "${relPath}" is not declared in the dataset's \`include\`. ` +
        `Only fields along a declared relationship path are joinable.`,
      );
    }
  };

  // Compile dimensions.
  const dimensions: Record<string, CubeDimension> = {};
  for (const d of dataset.dimensions) {
    assertDeclared(d.field, 'dimension', d.name);
    const dim: CubeDimension = {
      name: d.name,
      label: typeof d.label === 'string' ? d.label : d.name,
      type: dimensionType(d),
      sql: d.field,
    };
    if (dim.type === 'time') {
      dim.granularities = d.dateGranularity
        ? [d.dateGranularity]
        : ['day', 'week', 'month', 'quarter', 'year'];
    }
    dimensions[d.name] = dim;
  }

  // Compile measures (non-derived → Cube metrics; derived → sidecar).
  const measures: Record<string, Metric> = {};
  const derived: DerivedMeasureSpec[] = [];
  const measureFilters: Record<string, FilterCondition> = {};

  for (const m of dataset.measures) {
    if (m.derived) {
      derived.push({ name: m.name, op: m.derived.op, of: m.derived.of });
      continue;
    }
    if (m.field) assertDeclared(m.field, 'measure', m.name);
    const metric: Metric = {
      name: m.name,
      label: typeof m.label === 'string' ? m.label : m.name,
      type: aggregateToMetricType(m),
      // `count` with no field aggregates over rows (*).
      sql: m.field ?? '*',
    };
    if (typeof m.format === 'string') metric.format = m.format;
    measures[m.name] = metric;
    if (m.filter) measureFilters[m.name] = m.filter;
  }

  const cube: Cube = {
    name: dataset.name,
    title: typeof dataset.label === 'string' ? dataset.label : dataset.name,
    sql: dataset.object,
    measures,
    dimensions,
    public: false,
  };
  if (Object.keys(joins).length > 0) cube.joins = joins;

  return {
    cube,
    allowedRelationships,
    derived,
    filter: dataset.filter,
    measureFilters,
  };
}

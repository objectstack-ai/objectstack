// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30526] The per-measure drill scope a dataset answer carries
 * (`AnalyticsResult.drillScopes`, ADR-0021 D2): for each selected measure, the
 * list filter on the dataset's object that selects the records that measure
 * aggregates.
 *
 * ## Why the server says it
 *
 * A dataset number is computed under three filters at once (`DatasetExecutor`):
 * the dataset's own `filter`, the measure's own `filter` (one supplementary
 * query per filtered measure), and the selection's `runtimeFilter`. A host that
 * drills a clicked number holds only the last one: it has no read of the
 * dataset definition, and ADR-0021 D2 keeps it that way (the server answers the
 * drill bounds, the client never restates dataset semantics). So a drill built
 * from the bucket and the widget filter alone lists a superset of the records
 * a filtered measure counted. This module states the missing two, in the one
 * filter vocabulary both the dataset and the record list speak
 * (`FilterCondition`).
 *
 * ## What a scope is
 *
 * `dataset.filter` AND the measure's `filter` AND, for a measure that
 * aggregates a column, that column holding a value. The last leg is what every
 * aggregate does with an empty value: it skips it, so a `count` over a field is
 * the number of records where the field is set (`COUNT(field)`, #10298), and a
 * duration reads only records with both instants set. A `count` over rows has
 * no such leg. When no leg applies the scope is `{}`.
 *
 * The inputs are the filters AFTER token resolution, at the instant the query
 * resolved them (`queryDataset` resolves once and hands the same trees to the
 * executor and here), and BEFORE the dataset door's field binding
 * (`dataset-filter-field-binding.ts`), whose minted member names are a
 * request-local spelling no record list knows.
 *
 * ## What has no scope (absence means "offers no drill")
 *
 * - A derived measure: it combines other measures, so no single record set is
 *   behind its number.
 * - A measure the dataset neither declares nor mints, which the caller cannot
 *   have been answered for anyway.
 * - A scope naming a RELATIONSHIP PATH, as a dotted filter key
 *   (`account.region`) or a dotted `$field` reference: the dataset door joins
 *   it through `include`, while the record list refuses a dotted filter key
 *   (`INVALID_FIELD`, `@objectstack/objectql`'s explicit filter field gate).
 *   The nested-relation form (`{ account: { region: 'emea' } }`) is kept: the
 *   engine serves it on the list as it does on the analytics face.
 * - A filter that is not a plain condition object.
 *
 * The scope is a deep copy: the filters are the dataset definition's own
 * objects, which outlive the request, and an answer is handed to callers that
 * may compose into it.
 */

import type { FilterCondition } from '@objectstack/spec/data';

/** What one selected measure aggregates, as the executor runs it. */
export type MeasureSource =
  /** Combines other measures; has no record set of its own. */
  | { kind: 'derived' }
  /** `count` over rows: every record in scope counts. */
  | { kind: 'rows' }
  /** An aggregate over one column, which skips an empty value. */
  | { kind: 'field'; field: string }
  /** A duration measure, which reads only records with both instants set. */
  | { kind: 'duration'; from: string; to: string };

/** A plain condition object: not `null`, not an array, not a `Date`. */
function isConditionObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Does `node` name a relationship path anywhere: a dotted field key, or a
 * dotted `$field` reference? Walks `$and` / `$or` / `$not`, operator maps,
 * nested-relation specs and comparand lists alike; a string comparand is data
 * and is never read as a path.
 */
export function namesRelationshipPath(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(namesRelationshipPath);
  if (!isConditionObject(node)) return false;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$field') {
      if (typeof value === 'string' && value.includes('.')) return true;
      continue;
    }
    if (!key.startsWith('$') && key.includes('.')) return true;
    if (namesRelationshipPath(value)) return true;
  }
  return false;
}

/** The value legs of a measure: the column(s) its aggregate reads must hold a value. */
function valueLegs(source: MeasureSource): FilterCondition[] {
  switch (source.kind) {
    case 'field':
      return [{ [source.field]: { $null: false } }];
    case 'duration':
      return [{ [source.from]: { $null: false } }, { [source.to]: { $null: false } }];
    default:
      return [];
  }
}

/**
 * The drill scope of every selected measure that has one, keyed by the
 * selection's measure name. See the module header for what is left out.
 */
export function measureDrillScopes(input: {
  /** The selection's measure names, as the answer's columns are keyed. */
  measures: readonly string[];
  /** The dataset's own `filter`, token-resolved, in object-field names. */
  filter: FilterCondition | undefined;
  /** The measure's own `filter`, token-resolved, or `undefined` for none. */
  measureFilterOf: (measure: string) => FilterCondition | undefined;
  /** What the measure aggregates, or `undefined` when it is not one the dataset answers. */
  sourceOf: (measure: string) => MeasureSource | undefined;
}): Record<string, FilterCondition> {
  // A Map, then `Object.fromEntries`: every key lands as an own property, a
  // measure named like an `Object.prototype` member included.
  const scopes = new Map<string, FilterCondition>();
  for (const measure of input.measures) {
    if (scopes.has(measure)) continue;
    const source = input.sourceOf(measure);
    if (!source || source.kind === 'derived') continue;
    const parts: unknown[] = [input.filter, input.measureFilterOf(measure), ...valueLegs(source)]
      .filter((part) => part !== undefined && !(isConditionObject(part) && Object.keys(part).length === 0));
    if (!parts.every(isConditionObject) || parts.some(namesRelationshipPath)) continue;
    const scope = parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { $and: parts };
    scopes.set(measure, structuredClone(scope) as FilterCondition);
  }
  return Object.fromEntries(scopes);
}

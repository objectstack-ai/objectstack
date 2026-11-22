/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The field definitions a dashboard filter is lowered against.
 *
 * A `select` / `lookup` dashboard filter bound to a field holding several
 * values (`multiple: true`, `multiselect`, …) must be sent as `$contains` per
 * member, never `=` / `$in`, which the server refuses on such a field
 * (`buildWidgetScopedFilter` in `@object-ui/core`). Whether the bound field is
 * one is a fact of the field's DEFINITION, so the dashboard reads it:
 *
 *  - a dataset-bound widget (ADR-0021) names a dataset; its base object is
 *    `Dataset.object`, read through the optional `DataSource.getDataset`;
 *  - a `provider: 'object'` widget names its object itself.
 *
 * The object's fields then come from `DataSource.getObjectSchema`, and the
 * operators a field takes from `jsonColumnFilterOperators`, the one helper
 * the list quick filter and the filter builder read as well.
 *
 * When the definition cannot be read, the filter keeps the `=` / `$in`
 * lowering and the dashboard says so once per filter and source with a
 * console warning, never silently.
 */

import { useEffect, useState } from 'react';
import type { DataSource } from '@object-ui/types';
import type { DashboardFilterJsonColumnOperators } from '@object-ui/core';
import { jsonColumnFilterOperators, type FilterFieldStorageFacts } from '@object-ui/components';
import { isObjectProvider } from './utils';

/** Where a widget's object comes from: a dataset to resolve, or the object itself. */
export interface FilterFieldSource {
  /** Stable key: `dataset:NAME` or `object:NAME`. */
  key: string;
  kind: 'dataset' | 'object';
  name: string;
}

/** What the dashboard knows about one source's field definitions. */
export type FilterFieldFacts =
  | { status: 'pending' }
  | { status: 'ready'; object: string; fields: Readonly<Record<string, FilterFieldStorageFacts>> }
  | { status: 'unavailable'; reason: string };

/**
 * The object source of one widget arm, or `undefined` for a widget with no
 * query to scope (inline rows, a component node).
 *
 * The `provider: 'object'` read is the renderer's own (`widget.data` or
 * `options.data`), so the two cannot name different objects.
 */
export function filterFieldSource(widget: unknown): FilterFieldSource | undefined {
  if (!widget || typeof widget !== 'object') return undefined;
  const w = widget as { dataset?: unknown; data?: unknown; options?: { data?: unknown } };
  if (typeof w.dataset === 'string' && w.dataset) {
    return { key: `dataset:${w.dataset}`, kind: 'dataset', name: w.dataset };
  }
  const data = w.data || w.options?.data;
  if (isObjectProvider(data) && typeof data.object === 'string' && data.object) {
    return { key: `object:${data.object}`, kind: 'object', name: data.object };
  }
  return undefined;
}

/** The storage facts of every field an object schema declares. */
function readFieldFacts(objectSchema: unknown): Record<string, FilterFieldStorageFacts> {
  const fields = (objectSchema as { fields?: unknown } | null | undefined)?.fields;
  const out: Record<string, FilterFieldStorageFacts> = {};
  if (Array.isArray(fields)) {
    for (const f of fields) {
      const name = (f as { name?: unknown })?.name;
      if (typeof name === 'string' && name) out[name] = storageFacts(f);
    }
  } else if (fields && typeof fields === 'object') {
    for (const [name, f] of Object.entries(fields as Record<string, unknown>)) out[name] = storageFacts(f);
  }
  return out;
}

function storageFacts(field: unknown): FilterFieldStorageFacts {
  const f = (field ?? {}) as { type?: unknown; multiple?: unknown };
  return {
    ...(typeof f.type === 'string' ? { type: f.type } : {}),
    ...(f.multiple === true ? { multiple: true } : {}),
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function resolveFacts(
  dataSource: DataSource | undefined,
  source: FilterFieldSource,
  callerPackage: string | undefined,
): Promise<FilterFieldFacts> {
  let object = source.name;
  if (source.kind === 'dataset') {
    if (typeof dataSource?.getDataset !== 'function') {
      return { status: 'unavailable', reason: 'the data source cannot read a dataset definition (no getDataset)' };
    }
    let dataset: Awaited<ReturnType<NonNullable<DataSource['getDataset']>>>;
    try {
      dataset = await dataSource.getDataset(source.name, callerPackage ? { callerPackage } : undefined);
    } catch (error) {
      return { status: 'unavailable', reason: `reading dataset "${source.name}" failed: ${describeError(error)}` };
    }
    if (!dataset || typeof dataset.object !== 'string' || !dataset.object) {
      return { status: 'unavailable', reason: `no dataset "${source.name}" is served` };
    }
    object = dataset.object;
  }
  if (typeof dataSource?.getObjectSchema !== 'function') {
    return { status: 'unavailable', reason: 'the data source cannot read an object definition (no getObjectSchema)' };
  }
  try {
    const schema = await dataSource.getObjectSchema(object);
    return { status: 'ready', object, fields: readFieldFacts(schema) };
  } catch (error) {
    return { status: 'unavailable', reason: `reading object "${object}" failed: ${describeError(error)}` };
  }
}

/**
 * Why a source's definition can never be read from this data source, decided
 * without asking it; `undefined` when it can be asked.
 */
function unreadableReason(dataSource: DataSource | undefined, source: FilterFieldSource): string | undefined {
  if (source.kind === 'dataset' && typeof dataSource?.getDataset !== 'function') {
    return 'the data source cannot read a dataset definition (no getDataset)';
  }
  if (typeof dataSource?.getObjectSchema !== 'function') {
    return 'the data source cannot read an object definition (no getObjectSchema)';
  }
  return undefined;
}

function factsKey(callerPackage: string | undefined, sourceKey: string): string {
  return `${callerPackage ?? ''}\n${sourceKey}`;
}

/**
 * Read the field definitions behind every source in `sources`, once per
 * source and reader package, and answer them through the returned lookup. A
 * source the data source cannot be asked about answers `unavailable` at once;
 * one asked and not yet answered reads `pending`.
 *
 * The effect is keyed on the sources' KEYS joined to one string, never on an
 * array identity (`ui/AGENTS.md` #10), so a re-render with the same widgets
 * asks nothing again.
 */
export function useFilterFieldFacts(
  dataSource: DataSource | undefined,
  sources: readonly FilterFieldSource[],
  callerPackage: string | undefined,
): (source: FilterFieldSource) => FilterFieldFacts {
  const [answers, setAnswers] = useState<ReadonlyMap<string, FilterFieldFacts>>(() => new Map());
  const signature = Array.from(new Set(sources.map((s) => s.key))).sort().join('\n');

  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    for (const key of signature.split('\n')) {
      const kind = key.startsWith('dataset:') ? 'dataset' : 'object';
      const source: FilterFieldSource = { key, kind, name: key.slice(kind.length + 1) };
      if (unreadableReason(dataSource, source)) continue;
      void resolveFacts(dataSource, source, callerPackage).then((answer) => {
        if (cancelled) return;
        setAnswers((prev) => new Map(prev).set(factsKey(callerPackage, key), answer));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [dataSource, signature, callerPackage]);

  return (source) => {
    const reason = unreadableReason(dataSource, source);
    if (reason) return { status: 'unavailable', reason };
    return answers.get(factsKey(callerPackage, source.key)) ?? PENDING;
  };
}

const PENDING: FilterFieldFacts = { status: 'pending' };

/**
 * The per-field operator answer `buildWidgetScopedFilter` takes, for facts
 * that are ready; `undefined` otherwise (the `=` / `$in` lowering stays).
 */
export function jsonColumnOperatorsFor(
  facts: FilterFieldFacts | undefined,
): DashboardFilterJsonColumnOperators | undefined {
  if (facts?.status !== 'ready') return undefined;
  return (field) => (Object.prototype.hasOwnProperty.call(facts.fields, field)
    ? jsonColumnFilterOperators(facts.fields[field])
    : undefined);
}

/**
 * Warn-once memo for filters lowered without their field definition, keyed by
 * filter, source and reason: the renderer reaches this on every render.
 */
const warnedUnavailable = new Set<string>();

/** Reset the warn-once memo. Exported for tests. */
export function resetFilterFieldFactsWarnings(): void {
  warnedUnavailable.clear();
}

/**
 * Say, once, that `filterName` was lowered to `=` / `$in` without the bound
 * field's definition, naming the source and why it could not be read: on a
 * field holding several values the server refuses that query or answers it
 * with no rows.
 */
export function warnFilterLoweredWithoutFacts(filterName: string, source: FilterFieldSource, reason: string): void {
  const memo = `${filterName}\n${source.key}\n${reason}`;
  if (warnedUnavailable.has(memo)) return;
  warnedUnavailable.add(memo);
  if (typeof console === 'undefined') return;
  console.warn(
    `[dashboard-filters] filter "${filterName}" on ${source.kind} "${source.name}" is sent as = / $in ` +
      `without the bound field's definition: ${reason}. If that field holds several values ` +
      `(multiple: true, multiselect), the server refuses the query or answers it with no rows.`,
  );
}

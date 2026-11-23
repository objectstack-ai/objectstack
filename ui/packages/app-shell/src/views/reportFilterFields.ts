// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The fields the report builder's 「+ Filter」 offers (objectstack#36645).
 *
 * A report's `runtimeFilter` is keyed by fields of its dataset's OBJECT — the
 * dataset door lowers it onto that object's columns, not onto the dataset's
 * dimensions (`dataset-filter-field-binding.ts` in `service-analytics`). So
 * the list is the object's own fields, read from the console's data source as
 * a list's Filter panel reads them, and mapped by that panel's one mapping
 * (`conditionCandidatesOf`): the same translated labels, the same option
 * pickers for a select, the same record picker for a lookup.
 *
 * The list's Filter panel also sets the ORDER, and so does this: the business
 * fields first, then the system ones (`isSystemManagedField` — created by,
 * modified at, owner …), each in the definition's order. "Add filter" seeds
 * its row on the first field, so a new condition starts on a business field
 * rather than on 「Created by」.
 *
 * Two narrowings on top of that mapping, both because the builder writes
 * through the console's `FilterCondition` bridge (`datasetFilterCondition`),
 * not through the list's own filter dialect:
 *
 * - a field the object marks `hidden: true` is not offered, as the list's
 *   Filter panel does not offer it;
 * - a `record`-mode amount's currency pairing (`currencyField`) is dropped: the
 *   pairing writes a second, companion condition the bridge reads back as a
 *   row of its own, so the amount is offered as the dataset designer offers
 *   it — a plain number.
 *
 * Only the base object's fields: a relationship path (`account.region`) is
 * out of reach of this first cut, as it is of the dataset designer's filters.
 *
 * @module
 */

import * as React from 'react';
import { isSystemManagedField, type DataSource } from '@object-ui/types';
import { useObjectLabel } from '@object-ui/i18n';
import { conditionCandidatesOf, conditionOptionsOf, type ConditionCandidateField } from '@object-ui/plugin-list';

/** One field the report filter may name. */
export type ReportFilterField = Omit<ConditionCandidateField, 'currencyField'>;

/**
 * The filterable fields of an object definition, as the console serves it
 * (`fields` keyed by name). Pure — the labels are resolved by the caller's
 * resolvers, so a test hands in identity ones.
 */
export function reportFilterFields(
  def: { fields?: Record<string, unknown> } | null | undefined,
  label: (field: string, fallback: string) => string,
  options: (field: string, raw: unknown) => ConditionCandidateField['options'],
): ReportFilterField[] {
  const defs = def?.fields;
  if (!defs || typeof defs !== 'object' || Array.isArray(defs)) return [];
  const business: Array<[string, unknown]> = [];
  const system: Array<[string, unknown]> = [];
  for (const [name, field] of Object.entries(defs)) {
    if (!field || typeof field !== 'object') continue;
    if ((field as { hidden?: unknown }).hidden === true) continue;
    (isSystemManagedField(name, field as { system?: boolean }) ? system : business).push([name, field]);
  }
  const shown: Record<string, unknown> = Object.fromEntries([...business, ...system]);
  return conditionCandidatesOf(shown, label, options).map(({ currencyField: _paired, ...field }) => field);
}

/**
 * Read `object`'s definition through the data source and answer its
 * filterable fields. `loading` while the read is in flight; an object the
 * source cannot serve answers no fields, which the filter says in its popover.
 */
export function useReportFilterFields(
  object: string | undefined,
  dataSource: DataSource | undefined,
): { fields: ReportFilterField[]; loading: boolean } {
  const { fieldLabel, translateOptions } = useObjectLabel();
  const [read, setRead] = React.useState<{ object: string; def: { fields?: Record<string, unknown> } | null } | null>(null);

  React.useEffect(() => {
    if (!object || !dataSource || typeof dataSource.getObjectSchema !== 'function') return;
    let cancelled = false;
    dataSource
      .getObjectSchema(object)
      .then((def: unknown) => {
        if (!cancelled) setRead({ object, def: def && typeof def === 'object' ? (def as { fields?: Record<string, unknown> }) : null });
      })
      .catch(() => {
        if (!cancelled) setRead({ object, def: null });
      });
    return () => {
      cancelled = true;
    };
  }, [object, dataSource]);

  const def = object && read?.object === object ? read.def : undefined;
  const fields = React.useMemo(
    () =>
      object && def
        ? reportFilterFields(
            def,
            (field, fallback) => fieldLabel(object, field, fallback),
            (field, raw) => {
              const list = conditionOptionsOf(raw);
              return list ? translateOptions(object, field, list) : undefined;
            },
          )
        : [],
    [object, def, fieldLabel, translateOptions],
  );
  const canRead = !!dataSource && typeof dataSource.getObjectSchema === 'function';
  return { fields, loading: !!object && canRead && def === undefined };
}

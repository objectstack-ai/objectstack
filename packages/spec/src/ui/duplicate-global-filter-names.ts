// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE predicate behind "a dashboard declares each global filter name once".
 *
 * A global filter's key is its `name`, or its `field` when it has no `name`
 * (`GlobalFilterSchema.name` is declared as defaulting to `field`; the same
 * derivation as `globalFilterKey` in `system/i18n-resolver.ts`, which this
 * module cannot import without a cycle through `ui/component.zod.ts`). That key
 * is the one the filter bar draws a control under, the one a widget's
 * `filterBindings` names, and the `page.<name>` variable the value is
 * published as. Two entries under one key are two definitions behind one
 * control: the board draws a single control, and the value typed into it
 * filters the field of whichever definition the renderer kept, so a tile
 * counts rows the author never asked for and nothing says so.
 *
 * Read by `DashboardSchema`'s `globalFilters` refinement (`dashboard.zod.ts`),
 * so every door that parses a dashboard refuses the pair: `defineStack`,
 * `os validate`, `os build` and the dashboard save door.
 *
 * Scope of {@link duplicateGlobalFilterNames} is ONE dashboard's own
 * `globalFilters` array. The built-in date range is the other declaration a
 * key can collide with: a dashboard that declares `dateRange` declares a
 * filter under the reserved key `dateRange`, ahead of every `globalFilters`
 * entry, and {@link reservedDateRangeGlobalFilters} answers which entries
 * reuse that key.
 */

/** One filter key that a dashboard's `globalFilters` array declares more than once. */
export interface DuplicateGlobalFilterName {
  /** The repeated key (`name`, else `field`). */
  readonly name: string;
  /** Every index of `globalFilters` that declares it, ascending. */
  readonly indexes: readonly number[];
  /**
   * Which key carries the name on the SECOND declaration: `name` when that
   * entry authors one, `field` when the key falls back to it. The refusal is
   * located there.
   */
  readonly secondKey: 'name' | 'field';
  /** The refusal's message, naming the key, every index and the fix. */
  readonly message: string;
}

/** The key a global filter is addressed by: its non-empty `name`, else its non-empty `field`. */
function filterKeyOf(filter: unknown): { name: string; key: 'name' | 'field' } | undefined {
  if (filter === null || typeof filter !== 'object') return undefined;
  const { name, field } = filter as { name?: unknown; field?: unknown };
  if (typeof name === 'string' && name.length > 0) return { name, key: 'name' };
  if (typeof field === 'string' && field.length > 0) return { name: field, key: 'field' };
  return undefined;
}

/** `globalFilters[0] and globalFilters[1]`, `globalFilters[0], globalFilters[2] and globalFilters[5]`. */
function joinIndexes(indexes: readonly number[]): string {
  const sites = indexes.map((i) => `globalFilters[${i}]`);
  if (sites.length <= 1) return sites.join('');
  return `${sites.slice(0, -1).join(', ')} and ${sites[sites.length - 1]}`;
}

/**
 * Every filter key that `globalFilters` declares more than once, in the order
 * each key first appears. An empty list means nothing to refuse. Read on a
 * parsed dashboard or a stored body alike: a non-array, a non-object entry and
 * an entry with neither a string `name` nor a string `field` are left to the
 * schema's own issues.
 */
export function duplicateGlobalFilterNames(globalFilters: unknown): DuplicateGlobalFilterName[] {
  if (!Array.isArray(globalFilters)) return [];
  const sitesByName = new Map<string, { index: number; key: 'name' | 'field' }[]>();
  globalFilters.forEach((filter, index) => {
    const resolved = filterKeyOf(filter);
    if (!resolved) return;
    const list = sitesByName.get(resolved.name);
    if (list) list.push({ index, key: resolved.key });
    else sitesByName.set(resolved.name, [{ index, key: resolved.key }]);
  });
  const out: DuplicateGlobalFilterName[] = [];
  for (const [name, sites] of sitesByName) {
    if (sites.length < 2) continue;
    const indexes = sites.map((s) => s.index);
    const unnamed = sites.some((s) => s.key === 'field');
    out.push({
      name,
      indexes,
      secondKey: sites[1]!.key,
      message:
        `This dashboard declares the global filter '${name}' `
        + `${indexes.length === 2 ? 'twice' : `${indexes.length} times`} in globalFilters: ${joinIndexes(indexes)}. `
        + 'A filter\'s name is the key the filter bar draws its control under and the key widgets bind it by in '
        + '`filterBindings`, so the board would draw one control whose value filters the field of only one of these '
        + 'definitions. '
        + (unnamed ? 'A filter with no `name` is keyed by its `field`. ' : '')
        + 'Rename all but one of them (and every widget `filterBindings` key that means a renamed one), or delete '
        + 'the copy.',
    });
  }
  return out;
}

/** The key the built-in date range (`dashboard.dateRange`) is declared under. */
export const RESERVED_DATE_RANGE_FILTER_NAME = 'dateRange';

/** A `globalFilters` entry keyed by the built-in date range's reserved name. */
export interface ReservedDateRangeGlobalFilter {
  /** The entry's index in `globalFilters`. */
  readonly index: number;
  /** `name` when the entry authors one, `field` when the key falls back to it. The refusal is located there. */
  readonly key: 'name' | 'field';
  /** The refusal's message, naming the reserved word, the built-in date range and the fix. */
  readonly message: string;
}

/**
 * Every `globalFilters` entry keyed `dateRange` (by its `name`, else its
 * `field`) on a dashboard that declares the built-in `dateRange`, ascending.
 *
 * The built-in date range is a filter the board declares under the reserved
 * key `dateRange`, so such an entry is a second definition behind that key:
 * the console's `resolveDashboardFilterDefs` and lint's `dashboardFilterDefs`
 * both build the built-in first and let the later definition win, so the
 * filter bar draws the entry's control in place of the date range, and every
 * widget's `filterBindings.dateRange` binds the entry. The declared
 * `dateRange` is never drawn, while `@objectstack/verify`'s window proof still
 * proves it.
 *
 * On a dashboard that does NOT declare `dateRange` the key is free and the
 * entry is an ordinary filter (the board draws it, `filterBindings.dateRange`
 * binds it), so nothing is reported. `dateRange` is read as declared when it is
 * any non-null object, the shape both resolvers test. Read on a parsed
 * dashboard or a stored body alike.
 */
export function reservedDateRangeGlobalFilters(
  dateRange: unknown,
  globalFilters: unknown,
): ReservedDateRangeGlobalFilter[] {
  if (dateRange === null || typeof dateRange !== 'object') return [];
  if (!Array.isArray(globalFilters)) return [];
  const out: ReservedDateRangeGlobalFilter[] = [];
  globalFilters.forEach((filter, index) => {
    const resolved = filterKeyOf(filter);
    if (!resolved || resolved.name !== RESERVED_DATE_RANGE_FILTER_NAME) return;
    out.push({
      index,
      key: resolved.key,
      message:
        `globalFilters[${index}] is keyed '${RESERVED_DATE_RANGE_FILTER_NAME}'`
        + (resolved.key === 'field' ? ' (a filter with no `name` is keyed by its `field`)' : '')
        + `, the reserved name of the built-in date range this dashboard declares in \`dateRange\`. `
        + 'The filter bar draws one control under that name and widgets bind it as `filterBindings.dateRange`, so '
        + 'this entry would replace the date range: the board would never draw the declared date range, and every '
        + 'widget binding `dateRange` would be filtered by this entry instead. '
        + 'Give this filter another `name` (and rename every widget `filterBindings.dateRange` key that means it), '
        + 'or delete it and keep the built-in `dateRange`.',
    });
  });
  return out;
}

/**
 * ObjectUI — resolveDataSource
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Factory function to create the right DataSource from a ViewData config.
 */

import type { DataSource, ViewData } from '@object-ui/types';
import { ValueDataSource } from './ValueDataSource.js';

export interface ResolveDataSourceOptions {
  /** Custom ID field for ValueDataSource */
  idField?: string;
}

/**
 * Resolve a ViewData configuration into a concrete DataSource instance.
 *
 * - `provider: 'object'` → returns `fallback` (the context DataSource — typically ObjectStackAdapter)
 * - `provider: 'value'`  → returns a new `ValueDataSource`
 *
 * There is no `provider: 'api'` arm. The view-level `api` data source is
 * retired in `@objectstack/spec` (objectstack#23082, ADR-0049): a view binds
 * its object or static rows, and a metadata-declared API call is the page
 * element's `dataSource` binding. A view block that still says `api` is an
 * unknown provider here and gets the same answer as one, so no request is
 * ever built from its `read` / `write` (objectui#12325). Code that needs raw
 * HTTP constructs `ApiDataSource` itself, from an `ApiDataSourceConfig`.
 *
 * @param viewData - The ViewData configuration from the schema
 * @param fallback - The default DataSource from context (for `provider: 'object'`)
 * @param options  - Additional options for adapter construction
 * @returns A DataSource instance, or null if neither viewData nor fallback is available
 *
 * @example
 * ```ts
 * const ds = resolveDataSource(
 *   { provider: 'value', items: [{ id: '1', name: 'Ada' }] },
 *   contextDataSource,
 * );
 * const result = await ds.find('users');
 * ```
 */
export function resolveDataSource<T = any>(
  viewData: ViewData | null | undefined,
  fallback?: DataSource<T> | null,
  options?: ResolveDataSourceOptions,
): DataSource<T> | null {
  if (!viewData) {
    return fallback ?? null;
  }

  switch (viewData.provider) {
    case 'object':
      // Delegate to the context DataSource (ObjectStackAdapter, etc.)
      return fallback ?? null;

    case 'value':
      return new ValueDataSource<T>({
        items: (viewData.items ?? []) as T[],
        idField: options?.idField,
      });

    default:
      // Unknown provider — fall back to context
      return fallback ?? null;
  }
}
